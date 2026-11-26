/**
 * The relay is a small forwarder. Kick posts webhooks to it.
 * Rascal connects out over a WebSocket and authenticates with a shared secret.
 * A future hosted tier runs this same process. The desktop app is just another client.
 */

export const KICK_WEBHOOK_PATH = "/webhooks/kick";
export const RELAY_SOCKET_PATH = "/v1/events";

export interface RelayEvent {
  type: "event";
  source: string;
  id: string;
  eventType: string;
  version: string;
  body: unknown;
}

export function relayEvent(input: { source: string; id: string; eventType: string; version: string; body: unknown }): RelayEvent {
  return { type: "event", source: input.source, id: input.id, eventType: input.eventType, version: input.version, body: input.body };
}

/** wss anywhere. ws only on this machine, so the shared secret is not sent in the clear. */
export function normalizeRelayUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Relay address should be a ws:// or wss:// URL.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Put the relay secret in its own field. The address cannot carry a secret or a query string.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "ws:") {
    if (!local) throw new Error("A relay on another machine needs wss://.");
  } else if (url.protocol !== "wss:") {
    throw new Error("Relay address should start with ws:// or wss://.");
  }
  url.pathname = url.pathname.replace(/\/$/, "") || RELAY_SOCKET_PATH;
  if (url.pathname === "/") url.pathname = RELAY_SOCKET_PATH;
  return url.toString();
}

export function kickRelayStatus(input: { relayUrl: string; secretSet: boolean; detail: string }): string {
  if (!input.relayUrl.trim() || !input.secretSet) return "No relay configured";
  const detail = input.detail.trim();
  return detail || "Relay configured";
}
