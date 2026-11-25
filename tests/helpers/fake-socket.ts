/** Stand-in for the global WebSocket. Tests push server frames with `receive`. */
export class FakeSocket {
  static instances: FakeSocket[] = [];

  readonly url: string;
  closed = false;
  private readonly listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeSocket.instances.push(this);
  }

  static reset(): void {
    FakeSocket.instances = [];
  }

  static latest(): FakeSocket {
    const socket = FakeSocket.instances[FakeSocket.instances.length - 1];
    if (!socket) throw new Error("No socket was opened.");
    return socket;
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(): void {}

  close(): void {
    this.closed = true;
  }

  receive(frame: unknown): void {
    const data = typeof frame === "string" ? frame : JSON.stringify(frame);
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }

  /** The server or the network dropped the socket. */
  drop(): void {
    this.closed = true;
    for (const listener of this.listeners.get("close") ?? []) listener({});
  }
}

export function welcomeFrame(sessionId: string, keepaliveSeconds = 10): unknown {
  return {
    metadata: { message_type: "session_welcome" },
    payload: { session: { id: sessionId, keepalive_timeout_seconds: keepaliveSeconds } },
  };
}

export function notificationFrame(subscriptionType: string, event: unknown, metadata: Record<string, unknown> = {}): unknown {
  return {
    metadata: { message_type: "notification", subscription_type: subscriptionType, ...metadata },
    payload: { event },
  };
}
