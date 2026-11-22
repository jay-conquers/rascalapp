import { redactError } from "../../shared/redact";
import type { ChatBadge } from "../../shared/types";
import { indexHelixBadges } from "../../shared/twitch-badges";
import type { Logger } from "../logger";

/** Cached Twitch badge art from Helix global and channel badge endpoints. */
export class BadgeCatalog {
  private global: Record<string, string> = {};
  private channel: Record<string, string> = {};
  private roomId: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly deps: {
      log: Logger;
      loadGlobal: () => Promise<unknown>;
      loadChannel: (broadcasterId: string) => Promise<unknown>;
      onUpdate?: () => void;
    },
  ) {}

  imageFor(badge: ChatBadge): string | null {
    if (badge.imageUrl && badge.imageUrl.startsWith("https://")) return badge.imageUrl;
    if (!badge.set || !badge.version) return null;
    const url = this.channel[`${badge.set}/${badge.version}`] ?? this.global[`${badge.set}/${badge.version}`];
    return url && url.startsWith("https://") ? url : null;
  }

  async loadGlobal(): Promise<void> {
    try {
      this.global = indexHelixBadges(await this.deps.loadGlobal());
      this.deps.log.info("twitch badges updated", { scope: "global", count: Object.keys(this.global).length });
      this.deps.onUpdate?.();
    } catch (err) {
      this.deps.log.error("twitch badges failed", { scope: "global", message: redactError(err) });
    }
  }

  async loadChannel(roomId: string): Promise<void> {
    if (!/^\d+$/.test(roomId)) return;
    const changed = this.roomId !== roomId;
    this.roomId = roomId;
    await this.loadChannelNow();
    if (!changed && this.timer) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.loadChannelNow();
    }, 30 * 60 * 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async loadChannelNow(): Promise<void> {
    const roomId = this.roomId;
    if (!roomId) return;
    try {
      this.channel = indexHelixBadges(await this.deps.loadChannel(roomId));
      this.deps.log.info("twitch badges updated", { scope: "channel", count: Object.keys(this.channel).length });
      this.deps.onUpdate?.();
    } catch (err) {
      this.deps.log.error("twitch badges failed", { scope: "channel", message: redactError(err) });
    }
  }
}
