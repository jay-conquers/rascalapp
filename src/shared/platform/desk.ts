/** What the desk asks each chat site to do: connect, disconnect, and post a message. */
export interface DeskPlatform {
  readonly id: string;
  readonly label: string;
  start(): void;
  stop(): void;
  deliver(text: string): Promise<"ok" | "not-live">;
}
