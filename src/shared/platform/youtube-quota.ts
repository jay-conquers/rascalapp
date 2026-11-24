/**
 * Costs from Google's YouTube Data API quota calculator
 * (https://developers.google.com/youtube/v3/determine_quota_cost), read November 2026.
 * The default project quota is 10,000 units per day and resets at midnight Pacific Time.
 */
export const YOUTUBE_QUOTA_COSTS = {
  dailyUnits: 10_000,
  liveBroadcastsList: 1,
  videosList: 1,
  channelsList: 1,
  liveChatMessagesList: 5,
  liveChatMessagesInsert: 20,
  liveChatMessagesDelete: 20,
  liveChatBansInsert: 200,
  liveChatBansDelete: 200,
} as const;

export type QuotaState = "idle" | "ok" | "low" | "backoff" | "exhausted";

export interface QuotaSnapshot {
  usedUnits: number;
  dailyLimit: number;
  remainingUnits: number;
  pollingIntervalMillis: number | null;
  waitMs: number;
  state: QuotaState;
  detail: string;
}

/** How many list polls the daily quota covers when nothing else is called. */
export function youtubePollsPerDay(limit = YOUTUBE_QUOTA_COSTS.dailyUnits): number {
  return Math.floor(limit / YOUTUBE_QUOTA_COSTS.liveChatMessagesList);
}

/** How many sent messages the daily quota covers when nothing else is called. */
export function youtubeMessagesPerDay(limit = YOUTUBE_QUOTA_COSTS.dailyUnits): number {
  return Math.floor(limit / YOUTUBE_QUOTA_COSTS.liveChatMessagesInsert);
}

/**
 * Wait at least as long as YouTube asked (`pollingIntervalMillis`).
 * Errors stretch that wait. A used-up quota pauses polling. A thin remainder slows the loop
 * so the last units are not spent in a few seconds.
 */
export function nextPollDelayMs(input: {
  pollingIntervalMillis: number | null;
  consecutiveErrors: number;
  quotaExceeded: boolean;
  unitsRemaining: number;
}): number {
  const hinted = clampInterval(input.pollingIntervalMillis);
  if (input.quotaExceeded) return 15 * 60_000;
  let wait = hinted;
  if (input.consecutiveErrors > 0) {
    const factor = 2 ** Math.min(input.consecutiveErrors, 5);
    wait = Math.min(5 * 60_000, hinted * factor);
  }
  const pollsLeft = Math.floor(Math.max(0, input.unitsRemaining) / YOUTUBE_QUOTA_COSTS.liveChatMessagesList);
  if (pollsLeft <= 8) wait = Math.max(wait, 60_000);
  else if (pollsLeft <= 40) wait = Math.max(wait, 30_000);
  return wait;
}

export class YoutubeQuotaMeter {
  usedUnits = 0;
  quotaExceeded = false;
  consecutiveErrors = 0;
  pollingIntervalMillis: number | null = null;
  lastWaitMs = 0;
  readonly dailyLimit = YOUTUBE_QUOTA_COSTS.dailyUnits;

  add(units: number): void {
    if (Number.isFinite(units) && units > 0) this.usedUnits += Math.round(units);
  }

  remaining(): number {
    return Math.max(0, this.dailyLimit - this.usedUnits);
  }

  success(interval: number | null): void {
    this.consecutiveErrors = 0;
    this.quotaExceeded = false;
    if (interval !== null && Number.isFinite(interval)) this.pollingIntervalMillis = interval;
  }

  fail(quota: boolean): void {
    this.consecutiveErrors += 1;
    if (quota) this.quotaExceeded = true;
  }

  delay(): number {
    const wait = nextPollDelayMs({
      pollingIntervalMillis: this.pollingIntervalMillis,
      consecutiveErrors: this.consecutiveErrors,
      quotaExceeded: this.quotaExceeded,
      unitsRemaining: this.remaining(),
    });
    this.lastWaitMs = wait;
    return wait;
  }

  snapshot(): QuotaSnapshot {
    const remaining = this.remaining();
    const state: QuotaState = this.quotaExceeded
      ? "exhausted"
      : this.consecutiveErrors > 0
        ? "backoff"
        : remaining < 500
          ? "low"
          : this.usedUnits > 0
            ? "ok"
            : "idle";
    const interval = this.pollingIntervalMillis === null ? "waiting for YouTube's poll interval" : `polling every ${Math.round(this.pollingIntervalMillis / 1000)}s`;
    const detail =
      state === "exhausted"
        ? "YouTube quota is used up. Polling is paused."
        : state === "backoff"
          ? `YouTube chat hit an error. Backing off (${interval}).`
          : state === "low"
            ? `Quota is low: ${remaining} units left. ${interval}.`
            : `${this.usedUnits} of ${this.dailyLimit} units used this session. ${interval}.`;
    return {
      usedUnits: this.usedUnits,
      dailyLimit: this.dailyLimit,
      remainingUnits: remaining,
      pollingIntervalMillis: this.pollingIntervalMillis,
      waitMs: this.lastWaitMs,
      state,
      detail,
    };
  }
}

const meters = new Map<string, YoutubeQuotaMeter>();

/** One meter per process so the desk send and the bot poll share a session estimate. */
export function sharedQuotaMeter(key = "default"): YoutubeQuotaMeter {
  const existing = meters.get(key);
  if (existing) return existing;
  const created = new YoutubeQuotaMeter();
  meters.set(key, created);
  return created;
}

function clampInterval(value: number | null): number {
  if (value === null || !Number.isFinite(value) || value <= 0) return 5_000;
  return Math.min(120_000, Math.max(1_000, Math.round(value)));
}
