import { parseEventSubEnvelope } from "../../shared/eventsub";
import { asRecord } from "../../shared/record";
import { EventSubSocket } from "../twitch/eventsub-socket";

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
  const frame = parseEventSubEnvelope(raw);
  if (frame.type === "welcome") {
    if (!frame.sessionId) return { type: "ignore" };
    return { type: "welcome", sessionId: frame.sessionId, keepaliveSeconds: frame.keepaliveSeconds };
  }
  if (frame.type === "keepalive" || frame.type === "reconnect" || frame.type === "revocation" || frame.type === "ignore") return frame;
  if (frame.subscriptionType !== REDEMPTION) return { type: "ignore" };
  const event = asRecord(asRecord(asRecord(frame.body)?.payload)?.event);
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

export class EventSubClient {
  private readonly socket: EventSubSocket;

  constructor(
    private readonly deps: {
      subscribe: (sessionId: string) => Promise<void>;
      onRedemption: (redemption: EventSubRedemption) => void;
      onStatus: (detail: string) => void;
      log: { info: (message: string) => void; error: (message: string, extra?: Record<string, unknown>) => void };
    },
  ) {
    this.socket = new EventSubSocket({
      onMessage: (raw) => this.onMessage(raw),
      log: deps.log,
      socketError: "eventsub socket error",
      keepaliveMissed: "eventsub keepalive missed",
      onRetry: (wait) => deps.onStatus(`Channel points disconnected. Retrying in ${Math.round(wait / 1000)}s.`),
    });
  }

  start(): void {
    this.socket.start();
  }

  stop(): void {
    this.socket.stop();
  }

  private async onMessage(raw: string): Promise<void> {
    const frame = parseEventSubFrame(raw);
    if (frame.type === "welcome") {
      this.socket.setKeepaliveSeconds(frame.keepaliveSeconds);
      this.socket.arm();
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
    if (frame.type === "keepalive" || frame.type === "notification") this.socket.arm();
    if (frame.type === "reconnect") {
      this.deps.log.info("eventsub asked for a new socket");
      this.socket.open(frame.url);
      return;
    }
    if (frame.type === "notification") this.deps.onRedemption(frame.redemption);
    if (frame.type === "revocation") this.deps.onStatus("Twitch revoked channel point access. Log in again.");
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
