import type { VideoPlacement } from "../../shared/redeems";

export interface AlertJob {
  id: string;
  rewardId: string;
  title: string;
  action: "video" | "sound";
  filePath: string;
  volume: number;
  maxDurationMs: number | null;
  placement?: VideoPlacement;
  redemptionId?: string;
  owned: boolean;
  userName: string;
}

export interface QueueSnapshot {
  current: AlertJob | null;
  pending: AlertJob[];
}

/** Plays one alert at a time. Skip drops the current item. Clear drops everything. */
export class AlertQueue {
  current: AlertJob | null = null;
  readonly pending: AlertJob[] = [];

  enqueue(job: AlertJob): boolean {
    const started = this.current === null;
    if (started) this.current = job;
    else this.pending.push(job);
    return started;
  }

  /** Finish the current job if the id matches. Returns the job that should start next. */
  complete(id: string): AlertJob | null {
    if (!this.current || this.current.id !== id) return null;
    this.current = this.pending.shift() ?? null;
    return this.current;
  }

  skip(): AlertJob | null {
    this.current = this.pending.shift() ?? null;
    return this.current;
  }

  clear(): void {
    this.pending.length = 0;
    this.current = null;
  }

  snapshot(): QueueSnapshot {
    return {
      current: this.current ? { ...this.current } : null,
      pending: this.pending.map((job) => ({ ...job })),
    };
  }
}
