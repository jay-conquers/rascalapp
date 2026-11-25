import type { BotPlatform, HookSubject, LoginPromptView, PlatformAccountCard, PlatformFacts } from "../../../../src/shared/platform/bot-platform.ts";
import { normalizeTwitchChatFields } from "../../../../src/shared/platform/normalize.ts";
import type { NormalizedChatMessage, PlatformCapabilities, PlatformLiveStatus } from "../../../../src/shared/platform/types.ts";
import type { ChatLine, ShoutoutSettings } from "../model.ts";
import type { BotTokens } from "../store.ts";
import { chatSubscription, HelixBot, parseChatFrame } from "../twitch.ts";
import { TwitchSession } from "./twitch-session.ts";

const CAPABILITIES: PlatformCapabilities = {
  send: true,
  deleteMessage: true,
  timeout: true,
  ban: true,
  unban: true,
};

export class TwitchChatPlatform implements BotPlatform {
  readonly id = "twitch";
  readonly label = "Twitch";
  readonly capabilities = CAPABILITIES;
  private socket: WebSocket | null = null;
  private stopped = false;
  private status = "Bot is idle.";
  /** Null until Helix `/streams` has answered. Chat connected does not mean the channel is live. */
  private streamLive: boolean | null = null;
  private readonly listeners = new Set<(message: NormalizedChatMessage) => void>();
  private readonly session: TwitchSession;

  constructor(
    private readonly deps: {
      helix: HelixBot;
      clientId: () => string;
      accessToken: () => Promise<string>;
      broadcasterId: () => string;
      botUserId: () => string;
      botLogin: () => string;
      fetchImpl: typeof fetch;
      log: (level: "info" | "error", message: string, extra?: Record<string, string>) => void;
      onBroadcasterId: (id: string) => void;
      session?: () => BotTokens | null;
      botAccount?: () => BotTokens | null;
      accountMode?: () => "bot" | "channel";
      channelLogin?: () => string;
      statusOverride?: () => string | null;
      setStatus?: (status: string | null) => void;
      saveBotTokens?: (tokens: BotTokens) => void;
      clearBotTokens?: () => void;
      validate?: (accessToken: string) => Promise<{ login: string; userId: string; scopes: string[] }>;
      shoutout?: () => ShoutoutSettings;
      pushLog?: (entry: { t: number; action: string; user: string; text: string; by: string }) => void;
      productName?: () => string;
      serviceStopped?: () => boolean;
    },
  ) {
    const noop = () => undefined;
    this.session = new TwitchSession({
      helix: deps.helix,
      clientId: deps.clientId,
      fetchImpl: () => deps.fetchImpl,
      session: deps.session ?? (() => null),
      botAccount: deps.botAccount ?? (() => null),
      accountMode: deps.accountMode ?? (() => "bot"),
      broadcasterId: deps.broadcasterId,
      channelLogin: deps.channelLogin ?? (() => ""),
      statusOverride: deps.statusOverride ?? (() => null),
      setStatus: deps.setStatus ?? noop,
      saveBotTokens: deps.saveBotTokens ?? noop,
      clearBotTokens: deps.clearBotTokens ?? noop,
      validate: deps.validate ?? (async () => ({ login: "", userId: "", scopes: [] })),
      shoutout: deps.shoutout ?? (() => ({ template: "", helix: false })),
      log: deps.log,
      pushLog: deps.pushLog ?? noop,
      productName: deps.productName ?? (() => "Rascal"),
      stopped: deps.serviceStopped ?? (() => false),
      open: () => this.open(),
      disconnect: () => this.disconnect(),
      setStreamLive: (live) => this.setStreamLive(live),
      liveKnown: () => this.liveStatus().liveKnown !== false,
    });
  }

  accountCard(): PlatformAccountCard {
    return this.session.accountCard(this.liveStatus());
  }

  acceptsTimers(): boolean {
    return this.session.acceptsTimers();
  }

  postingIdentity(): { userId: string; login: string } | null {
    return this.session.postingIdentity();
  }

  factsFor(userId: string): Promise<PlatformFacts> {
    return this.session.factsFor(userId);
  }

  currentFacts(): PlatformFacts {
    return this.session.currentFacts();
  }

  builtinLookup(kind: "followage" | "accountage" | "shoutout", login: string, speakerName: string): Promise<string> {
    return this.session.builtinLookup(kind, login, speakerName);
  }

  hookSubject(): HookSubject {
    return this.session.hookSubject();
  }

  echoIds(): HookSubject {
    return this.session.hookSubject();
  }

  async open(): Promise<void> {
    if (!this.deps.session?.() || this.deps.serviceStopped?.()) return;
    this.deps.setStatus?.(null);
    await this.connect();
  }

  async reconnect(): Promise<void> {
    await this.open();
  }

  loginPrompt(): LoginPromptView | null {
    return this.session.loginPrompt();
  }

  startAccountLogin(): Promise<void> {
    return this.session.startLogin();
  }

  cancelAccountLogin(): void {
    this.session.cancelLogin();
  }

  logoutAccount(): void {
    this.session.logout();
  }

  ingest(): void {}

  noteReader(): void {}

  setLive(): void {}

  setOptIn(): void {}

  setStreamLive(live: boolean): void {
    this.streamLive = live;
  }

  liveStatus(): PlatformLiveStatus {
    return {
      connected: this.socket !== null,
      live: this.streamLive === true,
      liveKnown: this.streamLive !== null,
      detail: this.status,
    };
  }

  async connect(): Promise<void> {
    this.stopped = false;
    const url = "wss://eventsub.wss.twitch.tv/ws";
    const socket = new WebSocket(url);
    const previous = this.socket;
    this.socket = socket;
    previous?.close();
    this.status = "Connecting to Twitch chat…";
    socket.addEventListener("message", (event) => {
      void this.onFrame(String(event.data));
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.stopped) return;
      this.socket = null;
      this.status = "Chat disconnected. Reconnecting…";
      setTimeout(() => void this.connect(), 3000);
    });
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
  }

  async sendMessage(text: string): Promise<void> {
    const message = text.trim().slice(0, 450);
    const broadcaster = this.deps.broadcasterId();
    const sender = this.deps.botUserId();
    if (!message || !broadcaster || !sender) return;
    await this.deps.helix.send(broadcaster, sender, message);
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.deps.helix.deleteMessage(this.deps.broadcasterId(), this.deps.botUserId(), messageId);
  }

  async timeoutUser(userId: string, seconds: number, reason: string): Promise<void> {
    await this.deps.helix.moderate(this.deps.broadcasterId(), this.deps.botUserId(), userId, seconds, reason);
  }

  async banUser(userId: string, reason: string): Promise<void> {
    await this.deps.helix.moderate(this.deps.broadcasterId(), this.deps.botUserId(), userId, null, reason);
  }

  async unbanUser(userId: string): Promise<void> {
    await this.deps.helix.unban(this.deps.broadcasterId(), this.deps.botUserId(), userId);
  }

  async lookupUser(login: string): Promise<string | null> {
    const user = await this.deps.helix.userByLogin(login);
    return user?.id || null;
  }

  onMessage(listener: (message: NormalizedChatMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async onFrame(raw: string): Promise<void> {
    const frame = parseChatFrame(raw);
    if (frame.kind === "welcome") {
      await this.subscribe(frame.sessionId);
      return;
    }
    if (frame.kind === "reconnect") {
      this.socket?.close();
      return;
    }
    if (frame.kind !== "chat") return;
    if (frame.broadcasterId) this.deps.onBroadcasterId(frame.broadcasterId);
    const message = fromLine(frame.line, frame.broadcasterId);
    for (const listener of this.listeners) listener(message);
  }

  private async subscribe(sessionId: string): Promise<void> {
    const broadcaster = this.deps.broadcasterId();
    const botUser = this.deps.botUserId();
    if (!broadcaster || !botUser) {
      this.status = "Set the channel, then connect the bot.";
      return;
    }
    const token = await this.deps.accessToken();
    const response = await this.deps.fetchImpl("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: { "Client-Id": this.deps.clientId(), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(chatSubscription(sessionId, broadcaster, botUser)),
    });
    const login = this.deps.botLogin();
    this.status = response.ok ? `Listening as ${login || "the bot"}.` : "Twitch did not subscribe the bot to chat.";
    if (!response.ok) this.deps.log("error", "bot chat subscription failed", { status: String(response.status) });
  }
}

function fromLine(line: ChatLine, channelId: string): NormalizedChatMessage {
  return normalizeTwitchChatFields({
    messageId: line.messageId,
    channelId,
    text: line.text,
    userId: line.userId,
    login: line.login,
    displayName: line.displayName,
    roles: line.roles,
  });
}
