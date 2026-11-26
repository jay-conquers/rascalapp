import { TWITCH_EVENTSUB_URL, isTwitchEventSubUrl } from "../../shared/eventsub-url";

/**
 * EventSub WebSocket lifecycle shared by chat notices and channel-point redeems.
 * The caller reads each frame. Retry status is optional: redeems announce it, notices do not.
 */
export class EventSubSocket {
  private socket: WebSocket | null = null;
  private stopped = true;
  private keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private keepaliveSeconds = 10;

  constructor(
    private readonly deps: {
      onMessage: (raw: string) => void | Promise<void>;
      log: { error: (message: string, extra?: Record<string, unknown>) => void };
      socketError: string;
      keepaliveMissed: string;
      onRetry?: (waitMs: number) => void;
    },
  ) {}

  isStopped(): boolean {
    return this.stopped;
  }

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

  setKeepaliveSeconds(seconds: number): void {
    this.keepaliveSeconds = seconds;
  }

  open(url: string): void {
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
      if (this.socket !== socket || this.stopped) return;
      void this.deps.onMessage(String(event.data));
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.stopped) return;
      this.scheduleRetry();
    });
    socket.addEventListener("error", () => {
      this.deps.log.error(this.deps.socketError);
    });
  }

  arm(): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = setTimeout(() => {
      this.deps.log.error(this.deps.keepaliveMissed);
      this.open(TWITCH_EVENTSUB_URL);
    }, (this.keepaliveSeconds + 5) * 1000);
  }

  private scheduleRetry(): void {
    this.attempt += 1;
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt, 5));
    this.deps.onRetry?.(wait);
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => this.open(TWITCH_EVENTSUB_URL), wait);
  }

  private clearTimers(): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    if (this.retry) clearTimeout(this.retry);
    this.keepaliveTimer = null;
    this.retry = null;
  }
}
