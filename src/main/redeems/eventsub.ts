import { TWITCH_EVENTSUB_URL, isTwitchEventSubUrl } from "../../shared/eventsub-url";
import { asRecord } from "../../shared/record";

export interface EventSubRedemption {
  redemptionId: string;
  rewardId: string;
  rewardTitle: string;
  rewardCost: number;
  userName: string;
  userInput: string;
}

export type EventSubFrame =
  | { type: "welcome"; sessionId: string; keepaliveSeconds: number }
  | { type: "keepalive" }
  | { type: "reconnect"; url: string }
  | { type: "notification"; redemption: EventSubRedemption }
  | { type: "revocation" }
  | { type: "ignore" };

const REDEMPTION = "channel.channel_points_custom_reward_redemption.add";

export function parseEventSubFrame(raw: string): EventSubFrame {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { type: "ignore" };
  }
  const root = asRecord(body);
  const metadata = asRecord(root?.metadata);
  const payload = asRecord(root?.payload);
  const messageType = asString(metadata?.message_type);
  if (messageType === "session_welcome") {
    const session = asRecord(payload?.session);
    const sessionId = asString(session?.id);
    if (!sessionId) return { type: "ignore" };
    const keepalive = Number(session?.keepalive_timeout_seconds);
    return {
      type: "welcome",
      sessionId,
      keepaliveSeconds: Number.isFinite(keepalive) && keepalive > 0 ? keepalive : 10,
    };
  }
  if (messageType === "session_keepalive") return { type: "keepalive" };
  if (messageType === "session_reconnect") {
    const session = asRecord(payload?.session);
    const url = asString(session?.reconnect_url);
    return url ? { type: "reconnect", url } : { type: "ignore" };
  }
  if (messageType === "revocation") return { type: "revocation" };
  if (messageType === "notification" && asString(metadata?.subscription_type) === REDEMPTION) {
    const event = asRecord(payload?.event);
    const reward = asRecord(event?.reward);
    const redemptionId = asString(event?.id);
    const rewardId = asString(reward?.id);
    const rewardTitle = asString(reward?.title);
    if (!redemptionId || !rewardId || !rewardTitle) return { type: "ignore" };
    return {
      type: "notification",
      redemption: {
        redemptionId,
        rewardId,
        rewardTitle,
        rewardCost: typeof reward?.cost === "number" ? reward.cost : 0,
        userName: asString(event?.user_name) || asString(event?.user_login) || "someone",
        userInput: asString(event?.user_input) || "",
      },
    };
  }
  return { type: "ignore" };
}

export class EventSubClient {
  private socket: WebSocket | null = null;
  private stopped = true;
  private keepalive: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private keepaliveSeconds = 10;

  constructor(
    private readonly deps: {
      subscribe: (sessionId: string) => Promise<void>;
      onRedemption: (redemption: EventSubRedemption) => void;
      onStatus: (detail: string) => void;
      log: { info: (message: string) => void; error: (message: string, extra?: Record<string, unknown>) => void };
    },
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.open(TWITCH_EVENTSUB_URL);
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
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
      this.deps.log.error("eventsub socket error");
    });
  }

  private async onMessage(raw: string, socket: WebSocket): Promise<void> {
    if (this.socket !== socket || this.stopped) return;
    const frame = parseEventSubFrame(raw);
    if (frame.type === "welcome") {
      this.keepaliveSeconds = frame.keepaliveSeconds;
      this.arm();
      this.deps.onStatus("Listening for redemptions");
      try {
        await this.deps.subscribe(frame.sessionId);
        this.deps.log.info("eventsub redemption subscription ready");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not subscribe to redemptions.";
        if (/409|already exists/i.test(message)) return;
        this.deps.onStatus(message);
        this.deps.log.error("eventsub subscribe failed", { message });
      }
      return;
    }
    if (frame.type === "keepalive" || frame.type === "notification") this.arm();
    if (frame.type === "reconnect") {
      this.deps.log.info("eventsub asked for a new socket");
      this.open(frame.url);
      return;
    }
    if (frame.type === "notification") this.deps.onRedemption(frame.redemption);
    if (frame.type === "revocation") this.deps.onStatus("Twitch revoked channel point access. Log in again.");
  }

  private arm(): void {
    if (this.keepalive) clearTimeout(this.keepalive);
    this.keepalive = setTimeout(() => {
      this.deps.log.error("eventsub keepalive missed");
      this.open(TWITCH_EVENTSUB_URL);
    }, (this.keepaliveSeconds + 5) * 1000);
  }

  private scheduleRetry(): void {
    this.attempt += 1;
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt, 5));
    this.deps.onStatus(`Channel points disconnected. Retrying in ${Math.round(wait / 1000)}s.`);
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


function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
