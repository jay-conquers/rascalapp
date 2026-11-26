import { TWITCH_EVENTSUB_URL, isTwitchEventSubUrl } from "../../shared/eventsub-url";
import { applyWordEmotes, type WordEmote } from "../../shared/word-emotes";
import { filterWordEmotes, type EmoteFlags, type FeedToggles } from "../../shared/feed-toggles";
import { chatFromFollow, chatFromNotification, modActionFromModerate } from "../../shared/parsers/eventsub-events";
import { MODERATE_READ_SCOPES } from "../../shared/scopes";
import { redactError } from "../../shared/redact";
import type { ChatMessage, ModAction } from "../../shared/types";
import { asRecord } from "../../shared/record";

/**
 * One EventSub socket for the private mod log, chat notices, and follows.
 * Channel point redeems stay on the redeem engine's own socket.
 */
export class NoticeSocket {
  private socket: WebSocket | null = null;
  private stopped = true;
  private keepalive: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private keepaliveSeconds = 10;
  private channelKey = "";

  constructor(
    private readonly deps: {
      auth: () => { userId: string | null; login: string | null; scopes: string[] };
      channel: () => string;
      feed: () => FeedToggles;
      broadcasterId: (login: string) => Promise<string>;
      subscribe: (type: string, version: string, condition: Record<string, string>, sessionId: string) => Promise<void>;
      emotes: () => ReadonlyMap<string, WordEmote>;
      onChat: (message: ChatMessage) => void;
      onModAction: (action: ModAction) => void;
      onScopeProblem: (text: string) => void;
      log: { info: (message: string, extra?: Record<string, unknown>) => void; error: (message: string, extra?: Record<string, unknown>) => void };
    },
  ) {}

  start(): void {
    if (!this.stopped) return;
    const auth = this.deps.auth();
    if (!auth.userId) return;
    this.stopped = false;
    this.attempt = 0;
    this.channelKey = this.deps.channel();
    this.open(TWITCH_EVENTSUB_URL);
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
  }

  /** Reconnect when the chat channel changes so conditions follow that channel. */
  retarget(): void {
    const next = this.deps.channel();
    if (next === this.channelKey && !this.stopped) return;
    this.channelKey = next;
    if (this.stopped) return;
    this.open(TWITCH_EVENTSUB_URL);
  }

  private open(url: string): void {
    if (this.stopped) return;
    if (!isTwitchEventSubUrl(url)) {
      this.deps.log.error("ignored eventsub reconnect url");
      return;
    }
    this.clearTimers();
    this.socket?.close();
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      void this.onMessage(String(event.data), socket);
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.stopped) return;
      this.scheduleRetry();
    });
    socket.addEventListener("error", () => {
      this.deps.log.error("notice eventsub socket error");
    });
  }

  private async onMessage(raw: string, socket: WebSocket): Promise<void> {
    if (this.socket !== socket || this.stopped) return;
    const body = parseJson(raw);
    const metadata = asRecord(asRecord(body)?.metadata);
    const messageType = asString(metadata?.message_type);
    if (messageType === "session_welcome") {
      const session = asRecord(asRecord(body)?.payload)?.session;
      const sessionId = asString(asRecord(session)?.id);
      const keepalive = Number(asRecord(session)?.keepalive_timeout_seconds);
      this.keepaliveSeconds = Number.isFinite(keepalive) && keepalive > 0 ? keepalive : 10;
      this.arm();
      if (sessionId) await this.subscribeAll(sessionId);
      return;
    }
    if (messageType === "session_keepalive") {
      this.arm();
      return;
    }
    if (messageType === "session_reconnect") {
      const url = asString(asRecord(asRecord(asRecord(body)?.payload)?.session)?.reconnect_url);
      if (url) this.open(url);
      return;
    }
    if (messageType === "revocation") {
      this.deps.onScopeProblem("Twitch revoked a chat or moderation subscription. Log in again to grant it.");
      return;
    }
    if (messageType !== "notification") return;
    this.arm();
    const type = asString(metadata?.subscription_type);
    const channel = this.deps.channel();
    if (type === "channel.moderate") {
      const action = modActionFromModerate(body);
      if (action) this.deps.onModAction(action);
      return;
    }
    if (type === "channel.follow") {
      const message = chatFromFollow(body, channel);
      if (message) this.deps.onChat(message);
      return;
    }
    if (type === "channel.chat.notification") {
      const message = chatFromNotification(body, channel);
      if (!message) return;
      const flags: EmoteFlags = this.deps.feed().emotes;
      this.deps.onChat({
        ...message,
        segments: applyWordEmotes(message.segments, filterWordEmotes(this.deps.emotes(), flags)),
      });
    }
  }

  private async subscribeAll(sessionId: string): Promise<void> {
    const auth = this.deps.auth();
    if (!auth.userId) return;
    const login = (this.deps.channel() || auth.login || "").toLowerCase();
    let broadcasterId = auth.userId;
    if (login && login !== (auth.login || "").toLowerCase()) {
      try {
        broadcasterId = await this.deps.broadcasterId(login);
      } catch (err) {
        this.deps.log.error("notice channel lookup failed", { message: redactError(err) });
        return;
      }
    }
    const granted = new Set(auth.scopes);
    const missing: string[] = [];
    const missingMod = MODERATE_READ_SCOPES.filter((scope) => !granted.has(scope));
    if (missingMod.length > 0) missing.push("the moderator read scopes for the private mod log");
    if (!granted.has("user:read:chat")) missing.push("user:read:chat for watch streaks, mod anniversaries, and EventSub notices");
    if (!granted.has("moderator:read:followers")) missing.push("moderator:read:followers for new follows");
    if (missing.length > 0) {
      this.deps.onScopeProblem(`Log in again to grant ${missing.join("; ")}. Chat keeps working until you do.`);
    }
    if (missingMod.length === 0) {
      await this.trySubscribe(
        "channel.moderate",
        "2",
        { broadcaster_user_id: broadcasterId, moderator_user_id: auth.userId },
        sessionId,
        "Log in again to grant moderator read scopes. The private mod log needs them.",
      );
    }
    if (granted.has("user:read:chat")) {
      await this.trySubscribe(
        "channel.chat.notification",
        "1",
        { broadcaster_user_id: broadcasterId, user_id: auth.userId },
        sessionId,
        "Log in again to grant user:read:chat so subs, raids, watch streaks, and mod anniversaries can arrive.",
      );
    }
    if (granted.has("moderator:read:followers")) {
      await this.trySubscribe(
        "channel.follow",
        "2",
        { broadcaster_user_id: broadcasterId, moderator_user_id: auth.userId },
        sessionId,
        "Log in again to grant moderator:read:followers so new follows show in chat.",
      );
    }
  }

  private async trySubscribe(
    type: string,
    version: string,
    condition: Record<string, string>,
    sessionId: string,
    failure: string,
  ): Promise<void> {
    try {
      await this.deps.subscribe(type, version, condition, sessionId);
      this.deps.log.info("eventsub subscription ready", { type });
    } catch (err) {
      const message = redactError(err);
      if (/409|already exists/i.test(message)) return;
      this.deps.log.error("eventsub subscribe failed", { type, message });
      this.deps.onScopeProblem(/403|scope|auth/i.test(message) ? failure : message);
    }
  }

  private arm(): void {
    if (this.keepalive) clearTimeout(this.keepalive);
    this.keepalive = setTimeout(() => {
      this.deps.log.error("notice eventsub keepalive missed");
      this.open(TWITCH_EVENTSUB_URL);
    }, (this.keepaliveSeconds + 5) * 1000);
  }

  private scheduleRetry(): void {
    this.attempt += 1;
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt, 5));
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => this.open(TWITCH_EVENTSUB_URL), wait);
  }

  private clearTimers(): void {
    if (this.keepalive) clearTimeout(this.keepalive);
    if (this.retry) clearTimeout(this.retry);
    this.keepalive = null;
    this.retry = null;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}


function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
