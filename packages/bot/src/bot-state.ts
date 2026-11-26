import { brand, readBrandEnv } from "../../../src/shared/brand.ts";
import type { BotPlatform } from "../../../src/shared/platform/bot-platform.ts";
import { normalizeEnabledIds } from "../../../src/shared/platform/selection.ts";
import { PlatformRegistry } from "../../../src/shared/platform/registry.ts";
import { refreshYoutubeAccessToken, type YoutubeOAuthClient } from "../../../src/shared/platform/youtube-oauth.ts";
import type { NormalizedChatMessage } from "../../../src/shared/platform/types.ts";
import { detectLive } from "../../../src/shared/youtube/page-reader.ts";
import type { SentLine } from "./chat-hook.ts";
import { emptyMemory, type BotFile, type ModLogEntry } from "./model.ts";
import type { GiftHold } from "./thanks.ts";
import { KickChatPlatform } from "./platform/kick-adapter.ts";
import { TwitchChatPlatform } from "./platform/twitch-adapter.ts";
import { YoutubeChatPlatform } from "./platform/youtube-adapter.ts";
import { BotStore, type BotTokens, type YoutubeBotTokens } from "./store.ts";
import { HelixBot } from "./twitch.ts";
import type { ChannelTokenBridge } from "./service.ts";

export class BotState {
  protected file: BotFile;
  protected tokens: BotTokens | null;
  protected youtubeTokens: YoutubeBotTokens | null;
  protected secrets: { apiKey: string; sessionSecret: string; seJwt: string };
  protected memory = emptyMemory();
  protected log: ModLogEntry[] = [];
  protected statusOverride: string | null = null;
  protected youtubeNote = "";
  protected stopped = false;
  protected recentChatters = new Map<string, { name: string; at: number }>();
  protected seenHookIds = new Set<string>();
  protected outgoing: SentLine[] = [];
  protected giftHold: GiftHold | null = null;
  protected giftTimer: ReturnType<typeof setTimeout> | null = null;
  protected bridge: ChannelTokenBridge | null = null;
  protected readonly registry = new PlatformRegistry<BotPlatform>();
  /** Null until the desk, or a saved file, names the platforms that should connect. */
  protected enabledPlatforms: readonly string[] | null = null;

  constructor(
    protected readonly store: BotStore,
    protected readonly deps: {
      clientId: () => string;
      fetchImpl?: typeof fetch;
      log: (level: "info" | "error", message: string, extra?: Record<string, string>) => void;
      onAccountsChanged?: () => void;
      /** Embedded desk already reads YouTube. Headless mode reads for itself. */
      youtubeReader?: "external" | "own";
    },
  ) {
    this.file = store.loadConfig();
    this.tokens = store.loadTokens();
    this.youtubeTokens = store.loadYoutubeTokens();
    this.secrets = store.loadSecrets();
    const fetchImpl = deps.fetchImpl ?? fetch;
    const helix = new HelixBot(() => this.deps.clientId(), () => this.accessToken(), fetchImpl);
    const twitch = new TwitchChatPlatform({
      helix,
      clientId: () => this.deps.clientId(),
      accessToken: () => this.accessToken(),
      broadcasterId: () => this.file.broadcasterId,
      botUserId: () => this.activeTwitch()?.userId ?? "",
      botLogin: () => this.activeTwitch()?.login ?? "",
      fetchImpl,
      log: (level, message, extra) => this.deps.log(level, message, extra),
      onBroadcasterId: (id) => {
        if (this.file.broadcasterId || !id) return;
        this.file.broadcasterId = id;
        this.file = this.store.saveConfig(this.file);
      },
      session: () => this.activeTwitch(),
      botAccount: () => this.tokens,
      accountMode: () => this.file.accounts.twitch,
      channelLogin: () => this.file.channelLogin,
      statusOverride: () => this.statusOverride,
      setStatus: (status) => {
        this.statusOverride = status;
      },
      saveBotTokens: (tokens) => {
        this.tokens = tokens;
        this.store.saveTokens(tokens);
      },
      clearBotTokens: () => {
        this.tokens = null;
        this.store.clearTokens();
      },
      validate: (accessToken) => this.validate(accessToken),
      shoutout: () => this.file.shoutout,
      pushLog: (entry) => this.pushLog(entry),
      productName: () => brand.displayName,
      serviceStopped: () => this.stopped,
    });
    const youtube = new YoutubeChatPlatform({
      accessToken: () => this.youtubeAccessToken(),
      channelId: () => this.file.youtubeChannelId,
      hasToken: () => this.youtubeSession() !== null,
      fetchImpl,
      discoverVideo: async (channelId, signal) => {
        const live = await detectLive(channelId, fetchImpl, signal);
        return live ? { videoId: live.videoId, title: live.title } : null;
      },
      log: (level, message, extra) => this.deps.log(level, message, extra),
      ownReader: this.deps.youtubeReader !== "external",
      optIn: () => this.file.youtubeApiPoll,
      session: () => this.youtubeSession(),
      separateAccount: () => this.youtubeTokens,
      accountMode: () => this.file.accounts.youtube,
      note: () => this.youtubeNote,
      setNote: (note) => {
        this.youtubeNote = note;
      },
      google: () => this.google(),
      redirect: () => this.youtubeRedirect(),
      saveTokens: (tokens) => {
        this.youtubeTokens = tokens;
        this.store.saveYoutubeTokens(tokens);
      },
      clearTokens: () => {
        this.youtubeTokens = null;
        this.store.clearYoutubeTokens();
      },
      onChanged: () => this.deps.onAccountsChanged?.(),
    });
    const kick = new KickChatPlatform({
      store,
      fetchImpl,
      log: (level, message) => this.deps.log(level, message),
    });
    this.registry.register(twitch);
    this.registry.register(youtube);
    this.registry.register(kick);
    this.enabledPlatforms = store.loadEnabledPlatforms();
    for (const platform of this.registry.list()) {
      platform.onMessage((message) => {
        void this.onPlatformMessage(message);
      });
    }
  }

  /**
   * A missing selection connects Twitch and YouTube, which is what an older bot did.
   * Kick stays off until a saved list names it, so an upgrade does not turn it on.
   */
  protected platformAllowed(id: string): boolean {
    if (id === "kick") return this.enabledPlatforms !== null && this.enabledPlatforms.includes(id);
    return this.enabledPlatforms === null || this.enabledPlatforms.includes(id);
  }

  /** Remember the desk's choice before the first connect, without opening sockets yet. */
  rememberEnabledPlatforms(ids: readonly string[]): void {
    const enabled = normalizeEnabledIds(ids);
    if (enabled.length === 0) throw new Error("Choose at least one platform.");
    this.enabledPlatforms = enabled;
    this.store.saveEnabledPlatforms(enabled);
  }

  /**
   * Connect the chosen platforms and disconnect the rest.
   * Disconnect stops sockets and polls. It does not delete tokens.
   */
  async setEnabledPlatforms(ids: readonly string[]): Promise<void> {
    const enabled = normalizeEnabledIds(ids);
    if (enabled.length === 0) throw new Error("Choose at least one platform.");
    const previous = this.enabledPlatforms;
    const same =
      previous !== null && previous.length === enabled.length && previous.every((id, index) => id === enabled[index]);
    this.enabledPlatforms = enabled;
    this.store.saveEnabledPlatforms(enabled);
    if (same || this.stopped) return;
    for (const platform of this.registry.list()) {
      if (this.platformAllowed(platform.id)) await platform.open();
      else {
        platform.cancelAccountLogin();
        await platform.disconnect();
      }
    }
  }

  protected async accessToken(): Promise<string> {
    const tokens = this.activeTwitch();
    if (!tokens) throw new Error("Log in the bot account first.");
    if (tokens.expiresAt - Date.now() > 30 * 60 * 1000) return tokens.accessToken;
    const response = await this.fetchImpl()("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.deps.clientId(), grant_type: "refresh_token", refresh_token: tokens.refreshToken }),
    });
    if (!response.ok) {
      if (this.file.accounts.twitch !== "channel") this.logout();
      throw new Error("Bot session expired. Log in again.");
    }
    const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!json.access_token || !json.refresh_token) throw new Error("Twitch did not refresh the bot session.");
    const next = { ...tokens, accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    this.saveActiveTwitch(next);
    return next.accessToken;
  }


  protected async youtubeAccessToken(): Promise<string> {
    const tokens = this.youtubeSession();
    if (!tokens) throw new Error("Connect a YouTube account first.");
    if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
    const next = await refreshYoutubeAccessToken(this.google(), tokens.refreshToken, this.fetchImpl());
    const saved: YoutubeBotTokens = {
      ...tokens,
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      expiresAt: Date.now() + next.expiresIn * 1000,
    };
    this.saveYoutubeSession(saved);
    return saved.accessToken;
  }


  protected async validate(accessToken: string): Promise<{ login: string; userId: string; scopes: string[] }> {
    const response = await this.fetchImpl()("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${accessToken}` } });
    if (!response.ok) throw new Error("Twitch did not accept the bot token.");
    const json = (await response.json()) as { login?: string; user_id?: string; scopes?: string[] };
    if (!json.login || !json.user_id) throw new Error("Twitch did not identify the bot account.");
    return { login: json.login, userId: json.user_id, scopes: json.scopes ?? [] };
  }


  protected activeTwitch(): BotTokens | null {
    if (this.file.accounts.twitch === "channel") return this.bridge?.loadTwitch() ?? this.store.loadDeskTwitchTokens();
    return this.tokens;
  }


  protected saveActiveTwitch(tokens: BotTokens): void {
    if (this.file.accounts.twitch === "channel") {
      if (this.bridge) this.bridge.saveTwitch(tokens);
      else this.store.saveDeskTwitchTokens(tokens);
      return;
    }
    this.tokens = tokens;
    this.store.saveTokens(tokens);
  }


  protected youtubeSession(): YoutubeBotTokens | null {
    if (this.file.accounts.youtube === "channel") return this.bridge?.loadYoutube() ?? this.store.loadDeskYoutubeTokens();
    return this.youtubeTokens;
  }


  protected saveYoutubeSession(tokens: YoutubeBotTokens): void {
    if (this.file.accounts.youtube === "channel") {
      if (this.bridge) this.bridge.saveYoutube(tokens);
      else this.store.saveDeskYoutubeTokens(tokens);
      return;
    }
    this.youtubeTokens = tokens;
    this.store.saveYoutubeTokens(tokens);
  }


  protected google(): YoutubeOAuthClient {
    const clientId = readBrandEnv("GOOGLE_CLIENT_ID")?.trim() ?? "";
    const clientSecret = readBrandEnv("GOOGLE_CLIENT_SECRET") ?? "";
    if (clientId) return { clientId, clientSecret };
    return this.store.loadGoogleClient();
  }


  protected pushLog(entry: ModLogEntry): void {
    this.log.push(entry);
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }


  protected fetchImpl(): typeof fetch {
    return this.deps.fetchImpl ?? fetch;
  }

  /** Subclasses replace these. The real instance is a BotService, so the override runs. */
  connect(): Promise<void> {
    return Promise.resolve();
  }

  logout(): void {}

  youtubeRedirect(): string {
    return "";
  }

  protected onPlatformMessage(_message: NormalizedChatMessage): Promise<void> {
    return Promise.resolve();
  }
}
