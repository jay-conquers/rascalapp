import type { KickClientFile, KickTokens } from "./account.ts";
import { KickApi, scopesFromToken } from "./api.ts";
import { waitForKickCallback } from "./callback.ts";
import { kickTimeoutMinutes, mapKickChatEvent, mapKickLiveEvent, mapKickModerationEvent, type KickChatLine, type KickLiveLine, type KickModerationLine } from "./events.ts";
import { createKickAuthRequest, exchangeKickCode, refreshKickAccessToken, type KickAuthRequest } from "./oauth.ts";
import { openRelaySocket } from "./relay-client.ts";
import type { RelayEvent } from "./protocol.ts";

export interface KickConnectionDeps {
  fetchImpl?: typeof fetch;
  client: () => KickClientFile;
  tokens: () => KickTokens | null;
  saveTokens: (tokens: KickTokens) => void;
  clearTokens: () => void;
  relayUrl: () => string;
  relaySecret: () => string;
  log?: (level: "info" | "error", message: string) => void;
  onChat?: (line: KickChatLine) => void;
  onModeration?: (line: KickModerationLine) => void;
  onLive?: (line: KickLiveLine) => void;
  onStatus?: (state: "idle" | "connecting" | "connected" | "reconnecting" | "error", detail: string) => void;
  onChange?: () => void;
  /** Called with the authorize URL. The caller opens the browser. The URL is not logged. */
  onLoginUrl?: (url: string) => void;
}

/**
 * One signed-in Kick account: OAuth, the public API, and the relay socket.
 * Closing the socket does not delete the login.
 */
export class KickConnection {
  private prompt: KickAuthRequest | null = null;
  private abort: AbortController | null = null;
  private socket: { close: () => void } | null = null;
  private generation = 0;
  private stopped = true;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private detail = "Kick is off.";
  private state: "idle" | "connecting" | "connected" | "reconnecting" | "error" = "idle";
  private identity: { userId: string; login: string; slug: string; title: string; category: string; live: boolean; viewers: number | null } | null = null;
  private subscribed = false;

  constructor(private readonly deps: KickConnectionDeps) {}

  snapshot(): { detail: string; state: KickConnection["state"]; account: string | null; userId: string | null; live: boolean; viewers: number | null; title: string } {
    const tokens = this.deps.tokens();
    return {
      detail: this.detail,
      state: this.state,
      account: tokens ? tokens.login || tokens.slug || null : null,
      userId: tokens?.userId || this.identity?.userId || null,
      live: this.identity?.live === true,
      viewers: this.identity?.viewers ?? null,
      title: this.identity?.title ?? "",
    };
  }

  loginPrompt(): { url: string; expiresAt: number } | null {
    return this.prompt ? { url: this.prompt.url, expiresAt: this.prompt.expiresAt } : null;
  }

  broadcasterUserId(): string {
    return this.identity?.userId || this.deps.tokens()?.userId || "";
  }

  scopes(): string[] {
    return this.deps.tokens()?.scopes ?? [];
  }

  /** Start the relay, or say why it cannot start. Does not delete a saved login. */
  async open(): Promise<void> {
    this.stopped = false;
    const generation = ++this.generation;
    this.clearRetry();
    await this.connect(generation);
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.generation += 1;
    this.cancelLogin();
    this.clearRetry();
    this.clearPoll();
    this.socket?.close();
    this.socket = null;
    this.subscribed = false;
    this.setStatus("idle", "Kick is off.");
  }

  cancelLogin(): void {
    this.abort?.abort();
    this.abort = null;
    this.prompt = null;
  }

  logout(): void {
    this.cancelLogin();
    this.deps.clearTokens();
    this.identity = null;
    this.subscribed = false;
    this.stopped = true;
    this.generation += 1;
    this.clearRetry();
    this.clearPoll();
    this.socket?.close();
    this.socket = null;
    this.setStatus("idle", "Log in with Kick.");
    this.deps.onChange?.();
  }

  async beginLogin(): Promise<void> {
    if (this.abort) throw new Error("Kick login is already waiting.");
    const client = this.deps.client();
    const request = createKickAuthRequest(client);
    this.prompt = request;
    this.deps.onLoginUrl?.(request.url);
    const controller = new AbortController();
    this.abort = controller;
    this.deps.onChange?.();
    try {
      const callback = await waitForKickCallback({ signal: controller.signal });
      if (controller.signal.aborted) return;
      if (callback.state !== request.state || !callback.code) throw new Error("That Kick login did not match. Start again.");
      const exchanged = await exchangeKickCode(client, request, callback.code, this.fetchImpl());
      if (!exchanged.refreshToken) throw new Error("Kick did not return a refresh token. Approve the prompt again.");
      const tokens: KickTokens = {
        clientId: client.clientId.trim(),
        accessToken: exchanged.accessToken,
        refreshToken: exchanged.refreshToken,
        expiresAt: Date.now() + exchanged.expiresIn * 1000,
        scopes: scopesFromToken(exchanged),
        userId: "",
        login: "",
        slug: "",
      };
      this.deps.saveTokens(tokens);
      const api = new KickApi({ token: async () => tokens.accessToken, fetchImpl: this.fetchImpl() });
      const who = await api.identity();
      this.deps.saveTokens({ ...tokens, userId: who.userId, login: who.name || who.slug, slug: who.slug });
      this.identity = { userId: who.userId, login: who.name || who.slug, slug: who.slug, title: who.title, category: who.category, live: who.live, viewers: who.viewers };
      this.prompt = null;
      this.deps.log?.("info", "kick login succeeded");
      this.deps.onChange?.();
      this.stopped = false;
      await this.open();
    } catch (err) {
      if (controller.signal.aborted) return;
      this.prompt = null;
      const message = err instanceof Error ? err.message : "Kick login failed.";
      this.deps.log?.("error", "kick login failed");
      this.setStatus("error", message);
      this.deps.onChange?.();
      throw err instanceof Error ? err : new Error(message);
    } finally {
      if (this.abort === controller) this.abort = null;
    }
  }

  async send(text: string): Promise<void> {
    const message = text.replace(/\r/g, "").trim();
    if (!message) throw new Error("Message is empty.");
    if ([...message].length > 500) throw new Error("Kick messages stop at 500 characters.");
    const api = await this.api();
    await api.sendMessage(this.broadcasterUserId(), message);
  }

  async deleteMessage(messageId: string): Promise<void> {
    await (await this.api()).deleteMessage(messageId);
  }

  async timeoutUser(userId: string, seconds: number, reason = ""): Promise<void> {
    await (await this.api()).moderate(this.broadcasterUserId(), userId, kickTimeoutMinutes(seconds), reason);
  }

  async banUser(userId: string, reason = ""): Promise<void> {
    await (await this.api()).moderate(this.broadcasterUserId(), userId, null, reason);
  }

  async unbanUser(userId: string): Promise<void> {
    await (await this.api()).unmoderate(this.broadcasterUserId(), userId);
  }

  async lookupUser(login: string): Promise<string | null> {
    return (await this.api()).lookupSlug(login);
  }

  private async connect(generation: number): Promise<void> {
    if (this.stopped || generation !== this.generation) return;
    const tokens = this.deps.tokens();
    if (!tokens) {
      this.setStatus("idle", "Log in with Kick.");
      return;
    }
    const relayUrl = this.deps.relayUrl().trim();
    const relaySecret = this.deps.relaySecret();
    if (!relayUrl || relaySecret.length < 16) {
      this.setStatus("idle", "No relay configured");
      return;
    }
    this.setStatus(this.socket ? "reconnecting" : "connecting", "Connecting to the relay…");
    try {
      const api = await this.api();
      if (!this.identity) {
        const who = await api.identity();
        this.identity = { userId: who.userId, login: who.name || who.slug, slug: who.slug, title: who.title, category: who.category, live: who.live, viewers: who.viewers };
        this.deps.onLive?.({ live: who.live, title: who.title, broadcasterId: who.userId, channelSlug: who.slug });
      }
      if (!this.subscribed) {
        const problem = await api.ensureSubscriptions();
        this.subscribed = true;
        if (problem) this.deps.log?.("error", "kick subscription was refused");
      }
    } catch (err) {
      if (this.stopped || generation !== this.generation) return;
      const message = err instanceof Error ? err.message : "Kick did not answer.";
      this.setStatus("error", message);
      this.schedule(generation);
      return;
    }
    if (this.stopped || generation !== this.generation) return;
    this.socket?.close();
    this.socket = openRelaySocket({
      url: relayUrl,
      secret: relaySecret,
      onReady: () => {
        if (generation !== this.generation) return;
        this.setStatus("connected", "Relay connected");
        this.armPoll(generation);
      },
      onEvent: (event) => this.take(event),
      onClose: () => {
        if (this.stopped || generation !== this.generation) return;
        this.socket = null;
        this.setStatus("reconnecting", "Reconnecting to the relay…");
        this.schedule(generation);
      },
    });
  }

  private take(event: RelayEvent): void {
    if (event.source !== "kick") return;
    if (event.eventType === "chat.message.sent") {
      const line = mapKickChatEvent(event.body);
      if (line) this.deps.onChat?.(line);
      return;
    }
    if (event.eventType === "moderation.banned") {
      const line = mapKickModerationEvent(event.body);
      if (line) this.deps.onModeration?.(line);
      return;
    }
    if (event.eventType === "livestream.status.updated") {
      const line = mapKickLiveEvent(event.body);
      if (!line) return;
      if (this.identity) this.identity = { ...this.identity, live: line.live, title: line.title || this.identity.title };
      this.deps.onLive?.(line);
    }
  }

  private async api(): Promise<KickApi> {
    const access = await this.accessToken();
    return new KickApi({ token: async () => access, fetchImpl: this.fetchImpl() });
  }

  private async accessToken(): Promise<string> {
    const tokens = this.deps.tokens();
    if (!tokens) throw new Error("Log in with Kick.");
    if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
    const client = this.deps.client();
    const next = await refreshKickAccessToken(client, tokens.refreshToken, this.fetchImpl());
    const saved: KickTokens = {
      ...tokens,
      clientId: client.clientId.trim() || tokens.clientId,
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      expiresAt: Date.now() + next.expiresIn * 1000,
      scopes: scopesFromToken(next).length > 0 ? scopesFromToken(next) : tokens.scopes,
    };
    this.deps.saveTokens(saved);
    return saved.accessToken;
  }

  private schedule(generation: number): void {
    this.clearRetry();
    this.retry = setTimeout(() => {
      if (!this.stopped && generation === this.generation) void this.connect(generation);
    }, 3000);
    this.retry.unref?.();
  }

  private armPoll(generation: number): void {
    this.clearPoll();
    this.poll = setInterval(() => {
      if (this.stopped || generation !== this.generation) return;
      void this.refreshIdentity();
    }, 60_000);
    this.poll.unref?.();
  }

  private async refreshIdentity(): Promise<void> {
    try {
      const who = await (await this.api()).identity();
      this.identity = { userId: who.userId, login: who.name || who.slug, slug: who.slug, title: who.title, category: who.category, live: who.live, viewers: who.viewers };
      this.deps.onLive?.({ live: who.live, title: who.title, broadcasterId: who.userId, channelSlug: who.slug });
    } catch {
      // The next poll tries again. Chat still arrives on the relay.
    }
  }

  private clearRetry(): void {
    if (!this.retry) return;
    clearTimeout(this.retry);
    this.retry = null;
  }

  private clearPoll(): void {
    if (!this.poll) return;
    clearInterval(this.poll);
    this.poll = null;
  }

  private setStatus(state: KickConnection["state"], detail: string): void {
    this.state = state;
    this.detail = detail;
    this.deps.onStatus?.(state, detail);
  }

  private fetchImpl(): typeof fetch {
    return this.deps.fetchImpl ?? fetch;
  }
}
