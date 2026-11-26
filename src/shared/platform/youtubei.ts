/** How often the page reader asks for new chat. Not the Data API. */
export const YOUTUBEI_POLL_DEFAULT_MS = 1_500;
export const YOUTUBEI_POLL_MIN_MS = 1_000;

/** Page-reader failures in a row before the bot may spend Data API quota on a fallback poll. */
export const YOUTUBE_READER_FAILURES_BEFORE_API = 3;

export const YOUTUBE_STREAM_HOURS = 5;

export function youtubeiPollTargetMs(explicit?: number, fromEnv?: string): number {
  const env = Number(fromEnv);
  const raw = explicit ?? (Number.isFinite(env) && env > 0 ? env : YOUTUBEI_POLL_DEFAULT_MS);
  return Math.max(YOUTUBEI_POLL_MIN_MS, Math.round(raw));
}

/**
 * Wait `target` while the page reader is healthy, even when YouTube suggests a longer timeout.
 * Errors and HTTP 429 move the wait toward that suggestion. Healthy polls ease it back down.
 */
export function youtubeiWaitMs(input: { targetMs?: number; suggestedMs: number | null; pressure: number }): number {
  const target = youtubeiPollTargetMs(input.targetMs);
  const suggestedRaw = input.suggestedMs;
  const suggested = suggestedRaw !== null && Number.isFinite(suggestedRaw) && suggestedRaw > 0 ? Math.round(suggestedRaw) : target;
  const ceiling = Math.max(target, suggested);
  const pressure = clamp01(input.pressure);
  return Math.round(target + (ceiling - target) * pressure);
}

export function nextYoutubeiPressure(pressure: number, result: "ok" | "error" | "rate-limit"): number {
  const current = clamp01(pressure);
  if (result === "rate-limit") return 1;
  if (result === "error") return Math.min(1, current + 0.5);
  return Math.max(0, current - 0.34);
}

export function shouldUseYoutubeApiPoll(input: { optIn: boolean; consecutiveReaderFailures: number }): boolean {
  if (input.optIn) return true;
  return input.consecutiveReaderFailures >= YOUTUBE_READER_FAILURES_BEFORE_API;
}

/** Ids already shown. Returns only the new ones, in order. */
export function rememberChatIds(seen: Set<string>, ids: readonly string[], limit = 2_000): string[] {
  const fresh: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    fresh.push(id);
  }
  while (seen.size > limit) {
    const oldest = seen.values().next().value;
    if (typeof oldest !== "string") break;
    seen.delete(oldest);
  }
  return fresh;
}

/** Units for a stream that reads chat from the page and uses the Data API only for actions. */
export function youtubeStreamUnits(input: {
  hours?: number;
  replies?: number;
  deletes?: number;
  bans?: number;
  lookups?: number;
  apiPoll?: boolean;
  pollIntervalMs?: number;
}): { units: number; polls: number } {
  const replies = input.replies ?? 0;
  const deletes = input.deletes ?? 0;
  const bans = input.bans ?? 0;
  const lookups = input.lookups ?? 1;
  const actions = lookups + replies * 20 + deletes * 20 + bans * 200;
  if (!input.apiPoll) return { units: actions, polls: 0 };
  const interval = Math.max(1_000, input.pollIntervalMs ?? 5_000);
  const polls = Math.ceil(((input.hours ?? YOUTUBE_STREAM_HOURS) * 3_600_000) / interval);
  return { units: actions + polls * 5, polls };
}

export function describeYoutubeQuota(input: {
  apiPoll: boolean;
  fallback: boolean;
  replies: number;
  usedUnits: number;
}): string {
  const stream = youtubeStreamUnits({ hours: YOUTUBE_STREAM_HOURS, replies: input.replies, apiPoll: input.apiPoll });
  const example = youtubeStreamUnits({ hours: YOUTUBE_STREAM_HOURS, replies: 30, apiPoll: false });
  const burned = youtubeStreamUnits({ hours: YOUTUBE_STREAM_HOURS, replies: input.replies, apiPoll: true, pollIntervalMs: 5_000 });
  if (input.apiPoll && input.fallback) {
    return `The page reader failed, so the bot is polling the Data API until chat recovers. A 5-hour stream at a 5-second poll is about ${burned.units.toLocaleString("en-US")} units.`;
  }
  if (input.apiPoll) {
    return `Data API polling is on. A 5-hour stream at a 5-second poll is about ${burned.units.toLocaleString("en-US")} units, which is more than the daily quota.`;
  }
  const session = input.replies === 0 ? "No bot replies yet" : `${input.replies} bot ${input.replies === 1 ? "reply" : "replies"} so far`;
  return `Reading YouTube chat from the page (no quota). ${session}. A 5-hour stream with ${input.replies} ${input.replies === 1 ? "reply" : "replies"} is about ${stream.units.toLocaleString("en-US")} units. Thirty replies would be about ${example.units.toLocaleString("en-US")}. The same 5 hours polled on the Data API every 5 seconds would be about ${burned.units.toLocaleString("en-US")} units.`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
