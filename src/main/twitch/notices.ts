import { TWITCH_EVENTSUB_URL } from "../../shared/eventsub-url";
import { parseEventSubEnvelope } from "../../shared/eventsub";
import { applyWordEmotes, type WordEmote } from "../../shared/word-emotes";
import { filterWordEmotes, type EmoteFlags, type FeedToggles } from "../../shared/feed-toggles";
import { chatFromFollow, chatFromNotification, modActionFromModerate } from "../../shared/parsers/eventsub-events";
import { MODERATE_READ_SCOPES } from "../../shared/scopes";
import { redactError } from "../../shared/redact";
import type { ChatMessage, ModAction } from "../../shared/types";
import { EventSubSocket } from "./eventsub-socket";

/**
 * One EventSub socket for the private mod log, chat notices, and follows.
 * Channel point redeems stay on the redeem engine's own socket.
 */
export class NoticeSocket {
  private readonly socket: EventSubSocket;
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
  ) {
    this.socket = new EventSubSocket({
      onMessage: (raw) => this.onMessage(raw),
      log: deps.log,
      socketError: "notice eventsub socket error",
      keepaliveMissed: "notice eventsub keepalive missed",
    });
  }

  start(): void {
    if (!this.socket.isStopped()) return;
    const auth = this.deps.auth();
    if (!auth.userId) return;
    this.channelKey = this.deps.channel();
    this.socket.start();
  }

  stop(): void {
    this.socket.stop();
  }

  /** Reconnect when the chat channel changes so conditions follow that channel. */
  retarget(): void {
    const next = this.deps.channel();
    if (next === this.channelKey && !this.socket.isStopped()) return;
    this.channelKey = next;
    if (this.socket.isStopped()) return;
    this.socket.open(TWITCH_EVENTSUB_URL);
  }

  private async onMessage(raw: string): Promise<void> {
    const frame = parseEventSubEnvelope(raw);
    if (frame.type === "welcome") {
      this.socket.setKeepaliveSeconds(frame.keepaliveSeconds);
      this.socket.arm();
      if (frame.sessionId) await this.subscribeAll(frame.sessionId);
      return;
    }
    if (frame.type === "keepalive") {
      this.socket.arm();
      return;
    }
    if (frame.type === "reconnect") {
      this.socket.open(frame.url);
      return;
    }
    if (frame.type === "revocation") {
      this.deps.onScopeProblem("Twitch revoked a chat or moderation subscription. Log in again to grant it.");
      return;
    }
    if (frame.type !== "notification") return;
    this.socket.arm();
    const type = frame.subscriptionType;
    const body = frame.body;
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

}
