import { YOUTUBE_TITLE_MAX } from "../defaults";
import { asRecord } from "../record";

/**
 * Live broadcast title updates.
 *
 * Google's liveBroadcasts.update deletes any property that already has a value
 * when the request omits it. The write therefore sends the snippet fetched
 * immediately before, with only `title` changed, and copies contentDetails
 * through so the required monitor-stream fields stay as they were.
 *
 * There is no game field on liveBroadcasts. `snippet.categoryId` is YouTube's
 * video category (for example Gaming), not the game title set in Studio, and
 * it is copied through only so the update does not clear it.
 *
 * https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/update
 */

export const YOUTUBE_TITLE_RELOGIN =
  "Re-login needed. This YouTube login cannot change the stream title. Connect the channel account again on the Bot tab. Reading chat keeps working.";

const YOUTUBE_BROADCAST_SCOPE = "https://www.googleapis.com/auth/youtube";
const YOUTUBE_FORCE_SSL_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

const CONTENT_FLAGS = [
  "enableAutoStart",
  "enableAutoStop",
  "enableClosedCaptions",
  "enableDvr",
  "enableEmbed",
  "recordFromStart",
  "enableContentEncryption",
  "startWithSlate",
] as const;

export interface YoutubeBroadcastContentDetails {
  monitorStream: { enableMonitorStream: boolean; broadcastStreamDelayMs: number };
  enableAutoStart?: boolean;
  enableAutoStop?: boolean;
  enableClosedCaptions?: boolean;
  enableDvr?: boolean;
  enableEmbed?: boolean;
  recordFromStart?: boolean;
  enableContentEncryption?: boolean;
  startWithSlate?: boolean;
  availabilityConfig?: Record<string, unknown>;
}

export interface YoutubeEditableBroadcast {
  id: string;
  life: string;
  channelId: string;
  snippet: {
    title: string;
    description: string;
    scheduledStartTime: string;
    scheduledEndTime?: string;
    categoryId?: string;
  };
  /** Null when the fetch did not include contentDetails. */
  contentDetails: YoutubeBroadcastContentDetails | null;
}

export interface YoutubeBroadcastTitleUpdate {
  part: "snippet" | "snippet,contentDetails";
  body: {
    id: string;
    snippet: {
      title: string;
      description: string;
      scheduledStartTime: string;
      scheduledEndTime?: string;
      categoryId?: string;
    };
    contentDetails?: YoutubeBroadcastContentDetails;
  };
}

/** Active or upcoming. Completed and revoked broadcasts are not edited. */
export function isEditableBroadcastLife(life: string): boolean {
  const value = life.trim().toLowerCase();
  return value !== "complete" && value !== "revoked";
}

/**
 * Prefer a live row. A known video id wins when that row is still editable.
 * An empty life is kept so a payload that omitted status still works.
 */
export function pickEditableBroadcast(items: unknown[], preferredId?: string): YoutubeEditableBroadcast | null {
  const rows = items
    .map(parseYoutubeEditableBroadcast)
    .filter((row): row is YoutubeEditableBroadcast => row !== null)
    .filter((row) => isEditableBroadcastLife(row.life));
  const live = rows.filter((row) => row.life === "live" || row.life === "livestarting");
  const pool = live.length > 0 ? live : rows;
  const preferred = preferredId?.trim();
  if (preferred) {
    const match = pool.find((row) => row.id === preferred);
    if (match) return match;
  }
  return pool[0] ?? null;
}

export function parseYoutubeEditableBroadcast(item: unknown): YoutubeEditableBroadcast | null {
  const row = asRecord(item);
  const id = text(row?.id);
  if (!id) return null;
  const snippet = asRecord(row?.snippet);
  const life = text(asRecord(row?.status)?.lifeCycleStatus).toLowerCase();
  const scheduledEndTime = text(snippet?.scheduledEndTime);
  const categoryId = text(snippet?.categoryId);
  return {
    id,
    life,
    channelId: text(snippet?.channelId),
    snippet: {
      title: text(snippet?.title),
      description: text(snippet?.description),
      scheduledStartTime: text(snippet?.scheduledStartTime),
      ...(scheduledEndTime ? { scheduledEndTime } : {}),
      ...(categoryId ? { categoryId } : {}),
    },
    contentDetails: parseContentDetails(asRecord(row?.contentDetails)),
  };
}

/** Title check only. Does not call YouTube. */
export function assertYoutubeTitle(title: string): string {
  const next = title.trim();
  if (!next) throw new Error("Title cannot be empty.");
  if ([...next].length > YOUTUBE_TITLE_MAX) {
    throw new Error(`YouTube titles stop at ${YOUTUBE_TITLE_MAX} characters.`);
  }
  return next;
}

/**
 * Snippet for liveBroadcasts.update. Description, scheduled start, scheduled
 * end, and category id are the fetched values. Only the title is new.
 */
export function buildYoutubeBroadcastTitleUpdate(
  broadcast: YoutubeEditableBroadcast,
  title: string,
): YoutubeBroadcastTitleUpdate {
  const next = assertYoutubeTitle(title);
  if (!broadcast.id.trim()) throw new Error("YouTube did not return a broadcast id.");
  if (!broadcast.snippet.scheduledStartTime) {
    throw new Error("YouTube did not return a scheduled start time, so the title was not changed.");
  }
  const snippet: YoutubeBroadcastTitleUpdate["body"]["snippet"] = {
    title: next,
    description: broadcast.snippet.description,
    scheduledStartTime: broadcast.snippet.scheduledStartTime,
  };
  if (broadcast.snippet.scheduledEndTime) snippet.scheduledEndTime = broadcast.snippet.scheduledEndTime;
  if (broadcast.snippet.categoryId) snippet.categoryId = broadcast.snippet.categoryId;
  if (!broadcast.contentDetails) return { part: "snippet", body: { id: broadcast.id, snippet } };
  return {
    part: "snippet,contentDetails",
    body: { id: broadcast.id, snippet, contentDetails: broadcast.contentDetails },
  };
}

function parseContentDetails(row: Record<string, unknown> | null): YoutubeBroadcastContentDetails | null {
  if (!row) return null;
  const monitor = asRecord(row.monitorStream);
  if (!monitor || typeof monitor.enableMonitorStream !== "boolean" || typeof monitor.broadcastStreamDelayMs !== "number") {
    return null;
  }
  const details: YoutubeBroadcastContentDetails = {
    monitorStream: {
      enableMonitorStream: monitor.enableMonitorStream,
      broadcastStreamDelayMs: monitor.broadcastStreamDelayMs,
    },
  };
  for (const key of CONTENT_FLAGS) {
    if (typeof row[key] === "boolean") details[key] = row[key];
  }
  const availability = asRecord(row.availabilityConfig);
  if (availability) details.availabilityConfig = availability;
  return details;
}

/**
 * liveBroadcasts.update accepts `youtube` or `youtube.force-ssl`.
 * An empty scope list is an older saved login that did not record scopes.
 * The login Rascal requests is already `youtube.force-ssl`, so an empty list
 * is not treated as missing and the existing token is left in place.
 */
export function youtubeBroadcastScopeMissing(scopes: readonly string[]): boolean {
  if (scopes.length === 0) return false;
  return !scopes.some(scopeAllowsBroadcastEdit);
}

export function youtubeTitleBlock(input: { loggedIn: boolean; scopes: readonly string[] }): string | null {
  if (!input.loggedIn) {
    return "Connect a YouTube account on the Bot tab to change the title. Reading chat does not need that login.";
  }
  if (youtubeBroadcastScopeMissing(input.scopes)) return YOUTUBE_TITLE_RELOGIN;
  return null;
}

export function youtubeResourceId(value: string | undefined): string {
  const id = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : "";
}

function scopeAllowsBroadcastEdit(scope: string): boolean {
  if (scope === "youtube" || scope === YOUTUBE_BROADCAST_SCOPE) return true;
  if (scope === "youtube.force-ssl" || scope === YOUTUBE_FORCE_SSL_SCOPE) return true;
  if (scope.includes("youtube.force-ssl")) return true;
  return /\/auth\/youtube$/.test(scope);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
