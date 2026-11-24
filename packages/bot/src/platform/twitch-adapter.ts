import { badgesForRoles, normalizeTwitchChatFields } from "../../../../src/shared/platform/normalize.ts";
import type { ChatPlatform, NormalizedChatMessage, PlatformCapabilities, PlatformLiveStatus } from "../../../../src/shared/platform/types.ts";
import type { ChatLine } from "../model.ts";
import { chatSubscription, HelixBot, parseChatFrame } from "../twitch.ts";

const CAPABILITIES: PlatformCapabilities = {
  send: true,
  deleteMessage: true,
  timeout: true,
  ban: true,
  unban: true,
};

export class TwitchChatPlatform implements ChatPlatform {
  readonly id = "twitch";
  readonly label = "Twitch";
  readonly capabilities = CAPABILITIES;
  private socket: WebSocket | null = null;
  private stopped = false;
  private status = "Bot is idle.";
  /** Null until Helix `/streams` has answered. Chat connected does not mean the channel is live. */
  private streamLive: boolean | null = null;
  private readonly listeners = new Set<(message: NormalizedChatMessage) => void>();

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
    },
  ) {}

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

export function twitchBadges(roles: ChatLine["roles"]): ReturnType<typeof badgesForRoles> {
  return badgesForRoles(roles);
}
