import { asRecord, scalarText } from "./record.ts";

/**
 * The session frames every EventSub socket sees.
 * Welcome, keepalive, reconnect, and revocation are the same for chat, notices, and redeems.
 * A notification keeps the raw body so each caller can read its own event.
 */
export type EventSubEnvelope =
  | { type: "welcome"; sessionId: string | null; keepaliveSeconds: number }
  | { type: "keepalive" }
  | { type: "reconnect"; url: string }
  | { type: "revocation" }
  | { type: "notification"; subscriptionType: string | null; body: unknown }
  | { type: "ignore" };

export function parseEventSubEnvelope(raw: string): EventSubEnvelope {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { type: "ignore" };
  }
  const root = asRecord(body);
  const metadata = asRecord(root?.metadata);
  const payload = asRecord(root?.payload);
  const messageType = text(metadata?.message_type);
  if (messageType === "session_welcome") {
    const session = asRecord(payload?.session);
    const keepalive = Number(session?.keepalive_timeout_seconds);
    return {
      type: "welcome",
      sessionId: text(session?.id),
      keepaliveSeconds: Number.isFinite(keepalive) && keepalive > 0 ? keepalive : 10,
    };
  }
  if (messageType === "session_keepalive") return { type: "keepalive" };
  if (messageType === "session_reconnect") {
    const url = text(asRecord(payload?.session)?.reconnect_url);
    return url ? { type: "reconnect", url } : { type: "ignore" };
  }
  if (messageType === "revocation") return { type: "revocation" };
  if (messageType === "notification") {
    return { type: "notification", subscriptionType: text(metadata?.subscription_type), body };
  }
  return { type: "ignore" };
}

function text(value: unknown): string | null {
  const trimmed = scalarText(value);
  return trimmed.length > 0 ? trimmed : null;
}
