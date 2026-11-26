import type { ChatterDirectory } from "../mentions";

/**
 * What the desk asks each chat site to do: connect, disconnect, and post a message.
 * `chatters` and `mentionsOpen` feed @ mentions. A site with no viewer list, such as a
 * future Kick adapter, returns session names only and leaves `listed` empty.
 */
export interface DeskPlatform {
  readonly id: string;
  readonly label: string;
  start(): void;
  stop(): void;
  deliver(text: string): Promise<"ok" | "not-live">;
  chatters?(): ChatterDirectory;
  mentionsOpen?(): boolean;
}
