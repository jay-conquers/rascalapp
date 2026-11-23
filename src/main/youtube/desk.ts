import { readBrandEnv } from "../../shared/brand";
import { YoutubeDataApi } from "../../shared/platform/youtube-api";
import {
  createYoutubeAuthRequest,
  exchangeYoutubeCode,
  refreshYoutubeAccessToken,
  type YoutubeAuthRequest,
  type YoutubeOAuthClient,
} from "../../shared/platform/youtube-oauth";
import { sharedQuotaMeter } from "../../shared/platform/youtube-quota";
import { BotStore, type YoutubeBotTokens } from "../../../packages/bot/src/store";
import { waitForYoutubeCallback } from "../../../packages/bot/src/youtube-login";
import type { Logger } from "../logger";

export interface YoutubeDeskState {
  connected: boolean;
  account: string | null;
  channelId: string | null;
  status: string;
  login: { verificationUri: string; expiresAt: number } | null;
  /** Which connect button is waiting on the Google redirect. */
  purpose: "desk" | "bot" | null;
}

const desks = new Map<string, YoutubeDesk>();

export function youtubeDesk(dir: string, deps?: { log?: Logger; fetchImpl?: typeof fetch }): YoutubeDesk {
  const existing = desks.get(dir);
  if (existing) {
    if (deps?.log) existing.setLog(deps.log);
    if (deps?.fetchImpl) existing.setFetch(deps.fetchImpl);
    return existing;
  }
  const created = new YoutubeDesk(dir, deps?.log, deps?.fetchImpl);
  desks.set(dir, created);
  return created;
}

/** Channel-account YouTube session for the chat box, stored like the Twitch tokens. */
export class YoutubeDesk {
  private tokens: YoutubeBotTokens | null;
  private prompt: YoutubeAuthRequest | null = null;
  private purpose: "desk" | "bot" | null = null;
  private abort: AbortController | null = null;
  private failBot: ((err: Error) => void) | null = null;
  private note = "";
  private readonly chats = new Map<string, string>();
  private readonly store: BotStore;
  private log: Logger | null;
  private fetchImpl: typeof fetch;
  private onChange: (() => void) | null = null;

  constructor(
    dir: string,
    log?: Logger,
    fetchImpl?: typeof fetch,
  ) {
    this.store = new BotStore(dir);
    this.tokens = this.store.loadDeskYoutubeTokens();
    this.log = log ?? null;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  setLog(log: Logger): void {
    this.log = log;
  }

  setFetch(fetchImpl: typeof fetch): void {
    this.fetchImpl = fetchImpl;
  }

  setOnChange(listener: (() => void) | null): void {
    this.onChange = listener;
  }

  current(): YoutubeBotTokens | null {
    return this.tokens;
  }

  replace(tokens: YoutubeBotTokens): void {
    this.tokens = tokens;
    this.store.saveDeskYoutubeTokens(tokens);
  }

  state(): YoutubeDeskState {
    const sender = this.sender();
    return {
      connected: sender !== null,
      account: sender ? sender.title || sender.channelId : null,
      channelId: sender?.channelId || null,
      status: this.note || (sender ? `Signed in as ${sender.title || sender.channelId}.` : "YouTube send is not connected."),
      login: this.prompt ? { verificationUri: this.prompt.url, expiresAt: this.prompt.expiresAt } : null,
      purpose: this.purpose,
    };
  }

  /** Google login for the account the chat box sends as. */
  async connectDesk(): Promise<void> {
    await this.begin("desk");
  }

  /**
   * Google login that resolves to tokens for a bot process.
   * The chat-box session is left as it was.
   */
  loginForBot(): Promise<YoutubeBotTokens> {
    return new Promise((resolve, reject) => {
      this.failBot = reject;
      void this.begin("bot", resolve).catch((err: unknown) => {
        this.failBot = null;
        reject(err instanceof Error ? err : new Error("YouTube login failed."));
      });
    });
  }

  cancel(): void {
    this.abort?.abort();
    this.abort = null;
    this.prompt = null;
    this.purpose = null;
    this.failBot?.(new Error("The YouTube login was cancelled."));
    this.failBot = null;
    this.onChange?.();
  }

  logout(): void {
    this.cancel();
    this.tokens = null;
    this.store.clearDeskYoutubeTokens();
    this.note = "YouTube account logged out.";
    this.chats.clear();
    this.onChange?.();
  }

  async send(text: string, videoId: string | undefined): Promise<void> {
    const message = text.replace(/\s+/g, " ").trim();
    if (!message) throw new Error("Message is empty.");
    if (message.length > 200) throw new Error("YouTube live chat stops at 200 characters.");
    const api = this.api();
    let liveChatId = videoId ? this.chats.get(videoId) : undefined;
    if (!liveChatId) {
      const own = await api.listActiveBroadcast();
      if (own && (!videoId || own.videoId === videoId)) {
        liveChatId = own.liveChatId;
        this.chats.set(own.videoId, own.liveChatId);
      } else if (videoId) {
        const chat = await api.liveChatForVideo(videoId);
        if (chat) {
          liveChatId = chat.liveChatId;
          this.chats.set(videoId, chat.liveChatId);
        }
      }
    }
    if (!liveChatId) throw new Error("YouTube is not live, so this message cannot be sent.");
    await api.insertMessage(liveChatId, message);
  }

  private sender(): YoutubeBotTokens | null {
    return this.tokens ?? this.store.loadYoutubeTokens();
  }

  private async begin(purpose: "desk" | "bot", onBot?: (tokens: YoutubeBotTokens) => void): Promise<void> {
    if (this.abort) throw new Error("YouTube login is already waiting.");
    const client = this.google();
    const request = createYoutubeAuthRequest(client);
    this.prompt = request;
    this.purpose = purpose;
    this.note = "Waiting for Google to approve YouTube.";
    const controller = new AbortController();
    this.abort = controller;
    this.onChange?.();
    void this.finish(client, request, controller, purpose, onBot);
  }

  private async finish(
    client: YoutubeOAuthClient,
    request: YoutubeAuthRequest,
    controller: AbortController,
    purpose: "desk" | "bot",
    onBot?: (tokens: YoutubeBotTokens) => void,
  ): Promise<void> {
    try {
      const callback = await waitForYoutubeCallback({ signal: controller.signal });
      if (controller.signal.aborted) return;
      if (callback.state !== request.state || !callback.code) throw new Error("That YouTube login did not match. Start again.");
      const exchanged = await exchangeYoutubeCode(client, request, callback.code, this.fetchImpl);
      const api = new YoutubeDataApi({
        token: async () => exchanged.accessToken,
        fetchImpl: this.fetchImpl,
        meter: sharedQuotaMeter(),
      });
      const identity = await api.myChannel();
      const tokens: YoutubeBotTokens = {
        clientId: client.clientId,
        accessToken: exchanged.accessToken,
        refreshToken: exchanged.refreshToken || "",
        expiresAt: Date.now() + exchanged.expiresIn * 1000,
        scopes: exchanged.scope.split(/\s+/).filter(Boolean),
        channelId: identity.channelId,
        title: identity.title,
      };
      if (!tokens.refreshToken) throw new Error("Google did not return a refresh token. Approve the prompt again.");
      if (purpose === "desk") this.replace(tokens);
      onBot?.(tokens);
      this.failBot = null;
      this.prompt = null;
      this.purpose = null;
      this.note = "";
      this.log?.info("youtube desk login succeeded", { channel: identity.channelId });
      this.onChange?.();
    } catch (err) {
      if (controller.signal.aborted) return;
      this.prompt = null;
      this.purpose = null;
      this.note = err instanceof Error ? err.message : "YouTube login failed.";
      this.failBot?.(err instanceof Error ? err : new Error(this.note));
      this.failBot = null;
      this.log?.error("youtube desk login failed", { message: this.note });
      this.onChange?.();
    } finally {
      if (this.abort === controller) this.abort = null;
    }
  }

  private async freshToken(): Promise<string> {
    const tokens = this.sender();
    if (!tokens) throw new Error("Connect a YouTube account in the Bot tab before sending.");
    if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
    const next = await refreshYoutubeAccessToken(this.google(), tokens.refreshToken, this.fetchImpl);
    const saved: YoutubeBotTokens = {
      ...tokens,
      accessToken: next.accessToken,
      refreshToken: next.refreshToken || tokens.refreshToken,
      expiresAt: Date.now() + next.expiresIn * 1000,
    };
    if (this.tokens && this.tokens.channelId === tokens.channelId && this.tokens.accessToken === tokens.accessToken) this.replace(saved);
    else this.store.saveYoutubeTokens(saved);
    return saved.accessToken;
  }

  private api(): YoutubeDataApi {
    return new YoutubeDataApi({
      token: () => this.freshToken(),
      fetchImpl: this.fetchImpl,
      meter: sharedQuotaMeter(),
    });
  }

  private google(): YoutubeOAuthClient {
    const clientId = readBrandEnv("GOOGLE_CLIENT_ID")?.trim() ?? "";
    const clientSecret = readBrandEnv("GOOGLE_CLIENT_SECRET") ?? "";
    if (clientId) return { clientId, clientSecret };
    const stored = this.store.loadGoogleClient();
    if (!stored.clientId) throw new Error("Add a Google client ID in the Bot tab first.");
    return stored;
  }
}
