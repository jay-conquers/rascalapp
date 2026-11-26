import { KickConnection } from "../../../../src/shared/kick/connection.ts";
import type { KickTokens } from "../../../../src/shared/kick/account.ts";
import type { BotPlatform, HookSubject, LoginPromptView, PlatformAccountCard, PlatformFacts } from "../../../../src/shared/platform/bot-platform.ts";
import type { NormalizedChatMessage, PlatformCapabilities, PlatformLiveStatus } from "../../../../src/shared/platform/types.ts";
import { kickLineToNormalized } from "../../../../src/shared/kick/events.ts";
import type { BotStore } from "../store.ts";

const CAPABILITIES: PlatformCapabilities = {
  send: true,
  deleteMessage: true,
  timeout: true,
  ban: true,
  unban: true,
};

/**
 * Kick chat arrives on the relay. Sending and moderation use Kick's API.
 * There is no separate bot account: posts use the signed-in user.
 */
export class KickChatPlatform implements BotPlatform {
  readonly id = "kick";
  readonly label = "Kick";
  readonly capabilities = CAPABILITIES;
  private readonly listeners = new Set<(message: NormalizedChatMessage) => void>();
  private readonly connection: KickConnection;
  private live = false;
  private liveKnown = false;
  private title = "";
  private category = "";

  constructor(private readonly deps: { store: BotStore; fetchImpl: typeof fetch; log: (level: "info" | "error", message: string) => void }) {
    this.connection = new KickConnection({
      fetchImpl: deps.fetchImpl,
      client: () => deps.store.loadKickClient(),
      tokens: () => deps.store.loadKickTokens(),
      saveTokens: (tokens) => deps.store.saveKickTokens(tokens),
      clearTokens: () => deps.store.clearKickTokens(),
      relayUrl: () => deps.store.loadKickRelayUrl(),
      relaySecret: () => deps.store.loadKickRelay().secret,
      log: (level, message) => deps.log(level, message),
      onChat: (line) => {
        const message = kickLineToNormalized(line);
        for (const listener of this.listeners) listener(message);
      },
      onLive: (line) => {
        this.live = line.live;
        this.liveKnown = true;
        if (line.title) this.title = line.title;
      },
    });
  }

  accountCard(): PlatformAccountCard {
    const tokens = this.tokens();
    const snap = this.connection.snapshot();
    return {
      connected: Boolean(tokens) && snap.state === "connected",
      status: snap.detail,
      account: tokens ? tokens.login || tokens.slug || null : null,
      accountMode: "channel",
      separateAccount: null,
      quota: null,
    };
  }

  acceptsTimers(): boolean {
    return this.postingIdentity() !== null;
  }

  postingIdentity(): { userId: string; login: string } | null {
    const tokens = this.tokens();
    if (!tokens?.userId) return null;
    return { userId: tokens.userId, login: tokens.login || tokens.slug };
  }

  currentFacts(): PlatformFacts {
    return { title: this.title, game: this.category, uptime: this.live ? "live" : "offline", followage: "" };
  }

  factsFor(): Promise<PlatformFacts> {
    return Promise.resolve(this.currentFacts());
  }

  builtinLookup(kind: "followage" | "accountage" | "shoutout"): Promise<string> {
    if (kind === "shoutout") return Promise.resolve("Kick does not have a shoutout action.");
    if (kind === "accountage") return Promise.resolve("Kick does not share account age.");
    return Promise.resolve("Kick does not share follow age.");
  }

  hookSubject(): HookSubject {
    const tokens = this.tokens();
    return {
      channel: tokens?.slug || "",
      botUserId: tokens?.userId || "",
      botLogin: tokens?.login || "",
      channelLogin: tokens?.slug || tokens?.login || "",
      broadcasterId: tokens?.userId || "",
    };
  }

  echoIds(): HookSubject {
    return this.hookSubject();
  }

  loginPrompt(): LoginPromptView | null {
    const prompt = this.connection.loginPrompt();
    return prompt ? { userCode: "", verificationUri: prompt.url, expiresAt: prompt.expiresAt } : null;
  }

  async startAccountLogin(): Promise<void> {
    await this.connection.beginLogin();
  }

  cancelAccountLogin(): void {
    this.connection.cancelLogin();
  }

  logoutAccount(): void {
    this.connection.logout();
  }

  async open(): Promise<void> {
    await this.connection.open();
  }

  async reconnect(): Promise<void> {
    await this.connection.close();
    await this.connection.open();
  }

  async connect(): Promise<void> {
    await this.open();
  }

  async disconnect(): Promise<void> {
    await this.connection.close();
  }

  liveStatus(): PlatformLiveStatus {
    const snap = this.connection.snapshot();
    return {
      connected: snap.state === "connected",
      live: this.live,
      liveKnown: this.liveKnown,
      detail: snap.detail,
      title: this.title,
    };
  }

  async sendMessage(text: string): Promise<void> {
    await this.connection.send(text);
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.connection.deleteMessage(messageId);
  }

  async timeoutUser(userId: string, seconds: number, reason: string): Promise<void> {
    await this.connection.timeoutUser(userId, seconds, reason);
  }

  async banUser(userId: string, reason: string): Promise<void> {
    await this.connection.banUser(userId, reason);
  }

  async unbanUser(userId: string): Promise<void> {
    await this.connection.unbanUser(userId);
  }

  async lookupUser(login: string): Promise<string | null> {
    return this.connection.lookupUser(login);
  }

  onMessage(listener: (message: NormalizedChatMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private tokens(): KickTokens | null {
    return this.deps.store.loadKickTokens();
  }
}
