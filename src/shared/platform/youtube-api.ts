import { redact } from "../redact";
import type { NormalizedChatMessage } from "./types";
import { normalizeYoutubeLiveChatItem } from "./normalize";
import { YOUTUBE_QUOTA_COSTS, type YoutubeQuotaMeter } from "./youtube-quota";

const API = "https://www.googleapis.com/youtube/v3";

export class YoutubeApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(publicMessage(status, reason));
  }
}

export interface YoutubeBroadcast {
  videoId: string;
  title: string;
  liveChatId: string;
}

export interface YoutubeChatPage {
  messages: NormalizedChatMessage[];
  pollingIntervalMillis: number | null;
  nextPageToken: string;
  offline: boolean;
}

export interface YoutubeChannelIdentity {
  channelId: string;
  title: string;
}

export class YoutubeDataApi {
  constructor(
    private readonly deps: {
      token: () => Promise<string>;
      fetchImpl?: typeof fetch;
      meter?: YoutubeQuotaMeter;
    },
  ) {}

  async listActiveBroadcast(): Promise<YoutubeBroadcast | null> {
    const json = await this.request("GET", "/liveBroadcasts", YOUTUBE_QUOTA_COSTS.liveBroadcastsList, {
      part: "snippet,status",
      mine: "true",
      broadcastStatus: "active",
      maxResults: "5",
    });
    const items = arrayOf(json.items);
    for (const item of items) {
      const row = asRecord(item);
      const snippet = asRecord(row?.snippet);
      const liveChatId = text(snippet?.liveChatId);
      const videoId = text(row?.id);
      if (!liveChatId || !videoId) continue;
      return { videoId, title: text(snippet?.title), liveChatId };
    }
    return null;
  }

  async liveChatForVideo(videoId: string): Promise<YoutubeBroadcast | null> {
    const id = videoId.trim();
    if (!id) return null;
    const json = await this.request("GET", "/videos", YOUTUBE_QUOTA_COSTS.videosList, {
      part: "snippet,liveStreamingDetails",
      id,
    });
    const row = asRecord(arrayOf(json.items)[0]);
    const details = asRecord(row?.liveStreamingDetails);
    const liveChatId = text(details?.activeLiveChatId);
    if (!liveChatId) return null;
    const snippet = asRecord(row?.snippet);
    return { videoId: id, title: text(snippet?.title), liveChatId };
  }

  async listMessages(liveChatId: string, pageToken: string): Promise<YoutubeChatPage> {
    const query: Record<string, string> = {
      part: "snippet,authorDetails",
      liveChatId,
      maxResults: "500",
    };
    if (pageToken) query.pageToken = pageToken;
    const json = await this.request("GET", "/liveChat/messages", YOUTUBE_QUOTA_COSTS.liveChatMessagesList, query);
    const messages: NormalizedChatMessage[] = [];
    for (const item of arrayOf(json.items)) {
      const normalized = normalizeYoutubeLiveChatItem(item, liveChatId);
      if (normalized) messages.push(normalized);
    }
    const offline = text(json.offlineAt).length > 0;
    return {
      messages,
      pollingIntervalMillis: numberOrNull(json.pollingIntervalMillis),
      nextPageToken: text(json.nextPageToken),
      offline,
    };
  }

  async insertMessage(liveChatId: string, message: string): Promise<void> {
    const messageText = message.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!messageText) return;
    await this.request(
      "POST",
      "/liveChat/messages",
      YOUTUBE_QUOTA_COSTS.liveChatMessagesInsert,
      { part: "snippet" },
      {
        snippet: {
          liveChatId,
          type: "textMessageEvent",
          textMessageDetails: { messageText },
        },
      },
    );
  }

  async deleteMessage(messageId: string): Promise<void> {
    if (!messageId) return;
    await this.request("DELETE", "/liveChat/messages", YOUTUBE_QUOTA_COSTS.liveChatMessagesDelete, { id: messageId });
  }

  /** Temporary ban when seconds is set. Permanent ban when it is null. Returns the ban id. */
  async banUser(liveChatId: string, channelId: string, seconds: number | null): Promise<string> {
    const snippet: Record<string, unknown> = {
      liveChatId,
      type: seconds === null ? "permanent" : "temporary",
      bannedUserDetails: { channelId },
    };
    if (seconds !== null) snippet.banDurationSeconds = Math.min(1_209_600, Math.max(1, Math.round(seconds)));
    const json = await this.request("POST", "/liveChat/bans", YOUTUBE_QUOTA_COSTS.liveChatBansInsert, { part: "snippet" }, { snippet });
    return text(json.id);
  }

  async unban(banId: string): Promise<void> {
    if (!banId) throw new YoutubeApiError(400, "banNotTracked");
    await this.request("DELETE", "/liveChat/bans", YOUTUBE_QUOTA_COSTS.liveChatBansDelete, { id: banId });
  }

  async myChannel(): Promise<YoutubeChannelIdentity> {
    const json = await this.request("GET", "/channels", YOUTUBE_QUOTA_COSTS.channelsList, {
      part: "snippet",
      mine: "true",
      maxResults: "1",
    });
    const row = asRecord(arrayOf(json.items)[0]);
    const channelId = text(row?.id);
    const title = text(asRecord(row?.snippet)?.title);
    if (!channelId) throw new YoutubeApiError(404, "channelNotFound");
    return { channelId, title: title || channelId };
  }

  private async request(
    method: string,
    path: string,
    units: number,
    query: Record<string, string>,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    this.deps.meter?.add(units);
    const token = await this.deps.token();
    const url = new URL(`${API}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new YoutubeApiError(0, redact(err instanceof Error ? err.message : "network"));
    }
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const reason = errorReason(json) || `http${response.status}`;
      throw new YoutubeApiError(response.status, reason);
    }
    return json;
  }
}

export function isQuotaError(err: unknown): boolean {
  if (!(err instanceof YoutubeApiError)) return false;
  return err.reason === "quotaExceeded" || err.status === 429;
}

export function isChatClosedError(err: unknown): boolean {
  if (!(err instanceof YoutubeApiError)) return false;
  return err.reason === "liveChatEnded" || err.reason === "liveChatNotFound" || err.reason === "liveChatDisabled";
}

function publicMessage(status: number, reason: string): string {
  if (reason === "quotaExceeded" || status === 429) return "YouTube quota is used up for today.";
  if (reason === "liveChatEnded" || reason === "liveChatDisabled") return "That YouTube live chat has ended.";
  if (reason === "forbidden" || status === 403) return "YouTube refused that action. The account needs to own the chat or be a moderator.";
  if (reason === "banNotTracked") return "YouTube can only lift a ban this bot created in this session.";
  if (status === 0) return "YouTube chat could not be reached.";
  return `YouTube returned HTTP ${status}.`;
}

function errorReason(json: Record<string, unknown>): string {
  const error = asRecord(json.error);
  const errors = arrayOf(error?.errors);
  const first = asRecord(errors[0]);
  return text(first?.reason) || text(error?.status);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
