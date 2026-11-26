import { RELAY_SOCKET_PATH, type RelayEvent } from "./protocol.ts";

/**
 * Outbound client. The secret goes in the first frame, not the URL,
 * so a log of the address does not include it.
 */
export function openRelaySocket(input: {
  url: string;
  secret: string;
  signal?: AbortSignal;
  webSocket?: typeof WebSocket;
  onEvent: (event: RelayEvent) => void;
  onReady?: () => void;
  onClose?: (detail: string) => void;
}): { close: () => void } {
  const Socket = input.webSocket ?? WebSocket;
  const ws = new Socket(socketUrl(input.url));
  let closed = false;
  const finish = (detail: string) => {
    if (closed) return;
    closed = true;
    input.onClose?.(detail);
  };
  const stop = () => {
    closed = true;
    ws.close();
  };
  input.signal?.addEventListener("abort", stop);
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "auth", secret: input.secret }));
  });
  ws.addEventListener("message", (event) => {
    const text = typeof event.data === "string" ? event.data : "";
    let parsed: { type?: unknown; source?: unknown; id?: unknown; eventType?: unknown; version?: unknown; body?: unknown };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      return;
    }
    if (parsed.type === "ready") {
      input.onReady?.();
      return;
    }
    if (parsed.type !== "event" || typeof parsed.id !== "string" || typeof parsed.eventType !== "string") return;
    input.onEvent({
      type: "event",
      source: typeof parsed.source === "string" ? parsed.source : "",
      id: parsed.id,
      eventType: parsed.eventType,
      version: typeof parsed.version === "string" ? parsed.version : "",
      body: parsed.body,
    });
  });
  ws.addEventListener("error", () => finish("The relay connection failed."));
  ws.addEventListener("close", () => finish("The relay connection closed."));
  return {
    close: () => {
      input.signal?.removeEventListener("abort", stop);
      stop();
    },
  };
}

function socketUrl(value: string): string {
  const url = new URL(value);
  if (!url.pathname || url.pathname === "/") url.pathname = RELAY_SOCKET_PATH;
  return url.toString();
}
