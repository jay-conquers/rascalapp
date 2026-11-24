import { TWITCH_TITLE_MAX } from "../../shared/defaults";
import { redact } from "../../shared/redact";
import type { CategoryHit, StreamInfo, StreamUpdate } from "../../shared/types";

interface HelixDeps {
  clientId: () => string;
  getToken: () => Promise<string>;
  refresh: () => Promise<void>;
  fetchImpl?: typeof fetch;
}

export function buildChannelPatch(update: StreamUpdate): { title: string; game_id: string; tags: string[] } {
  const title = update.title.trim();
  if (!title) throw new Error("Title cannot be empty.");
  if (title.length > TWITCH_TITLE_MAX) {
    throw new Error(`Title must be ${TWITCH_TITLE_MAX} characters or fewer.`);
  }
  if (!/^\d+$/.test(update.gameId)) throw new Error("Pick a category from the search results.");
  if (update.tags.length > 10) throw new Error("Twitch allows up to 10 tags.");
  const tags = update.tags.map((tag) => tag.trim());
  for (const tag of tags) {
    if (!/^[A-Za-z0-9]{1,25}$/.test(tag)) {
      throw new Error(`Tag "${tag}" must be letters and numbers, up to 25 characters, with no spaces.`);
    }
  }
  return { title, game_id: update.gameId, tags };
}

export class Helix {
  constructor(private readonly deps: HelixDeps) {}

  async getStreamInfo(userId: string): Promise<StreamInfo> {
    const channel = await this.request("GET", `/channels?broadcaster_id=${encodeURIComponent(userId)}`);
    const row = first(channel);
    if (!row) throw new Error("Twitch did not return the channel.");
    const streams = await this.request("GET", `/streams?user_id=${encodeURIComponent(userId)}`);
    const live = first(streams);
    return {
      title: str(row.title),
      gameId: str(row.game_id),
      gameName: str(row.game_name),
      tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
      language: str(row.broadcaster_language) || "en",
      live: Boolean(live),
      viewerCount: live && typeof live.viewer_count === "number" ? live.viewer_count : null,
      startedAt: live ? str(live.started_at) || null : null,
    };
  }

  async searchCategories(query: string): Promise<CategoryHit[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    const json = await this.request("GET", `/search/categories?query=${encodeURIComponent(trimmed)}&first=8`);
    const rows = Array.isArray(json.data) ? json.data : [];
    return rows.map((row) => {
      const record = asRecord(row);
      const box = str(record?.box_art_url).replace("{width}", "52").replace("{height}", "72");
      return { id: str(record?.id), name: str(record?.name), boxArtUrl: box };
    }).filter((hit) => hit.id && hit.name);
  }

  async updateStream(userId: string, update: StreamUpdate): Promise<void> {
    const body = buildChannelPatch(update);
    await this.request("PATCH", `/channels?broadcaster_id=${encodeURIComponent(userId)}`, body);
  }

  async sendChat(broadcasterId: string, senderId: string, message: string): Promise<void> {
    const json = await this.request("POST", "/chat/messages", {
      broadcaster_id: broadcasterId,
      sender_id: senderId,
      message,
    });
    const row = first(json);
    if (row && row.is_sent === false) {
      const reason = asRecord(row.drop_reason);
      throw new Error(str(reason?.message) || "Twitch did not send that message.");
    }
  }

  getGlobalBadges(): Promise<unknown> {
    return this.request("GET", "/chat/badges/global");
  }

  /** Broadcaster emotes: follower, subscriber, and the channel's own prefix set. */
  getChannelEmotes(broadcasterId: string): Promise<unknown> {
    if (!/^\d+$/.test(broadcasterId)) return Promise.resolve({ data: [] });
    return this.request("GET", `/chat/emotes?broadcaster_id=${encodeURIComponent(broadcasterId)}`);
  }

  getChannelBadges(broadcasterId: string): Promise<unknown> {
    if (!/^\d+$/.test(broadcasterId)) return Promise.resolve({ data: [] });
    return this.request("GET", `/chat/badges?broadcaster_id=${encodeURIComponent(broadcasterId)}`);
  }

  async getUserId(login: string): Promise<string> {
    const json = await this.request("GET", `/users?login=${encodeURIComponent(login)}`);
    const id = str(first(json)?.id);
    if (!id) throw new Error(`Twitch user ${login} was not found.`);
    return id;
  }

  async listCustomRewards(broadcasterId: string, onlyManageable: boolean): Promise<TwitchReward[]> {
    const flag = onlyManageable ? "&only_manageable_rewards=true" : "";
    const json = await this.request(
      "GET",
      `/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}${flag}`,
    );
    return (json.data ?? []).map(parseReward).filter((reward): reward is TwitchReward => reward !== null);
  }

  async createCustomReward(broadcasterId: string, title: string, cost: number): Promise<TwitchReward> {
    const json = await this.request(
      "POST",
      `/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}`,
      buildRewardBody(title, cost, true),
    );
    const reward = parseReward(first(json));
    if (!reward) throw new Error("Twitch did not return the new reward.");
    return reward;
  }

  async updateCustomReward(
    broadcasterId: string,
    rewardId: string,
    patch: { title?: string; cost?: number; enabled?: boolean },
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.title = buildRewardBody(patch.title, patch.cost ?? 1, true).title;
    if (patch.cost !== undefined) body.cost = buildRewardBody(patch.title ?? "Reward", patch.cost, true).cost;
    if (patch.enabled !== undefined) body.is_enabled = patch.enabled;
    await this.request(
      "PATCH",
      `/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}&id=${encodeURIComponent(rewardId)}`,
      body,
    );
  }

  async fulfillRedemption(broadcasterId: string, rewardId: string, redemptionId: string): Promise<void> {
    await this.request(
      "PATCH",
      `/channel_points/custom_rewards/redemptions?broadcaster_id=${encodeURIComponent(broadcasterId)}&reward_id=${encodeURIComponent(rewardId)}&id=${encodeURIComponent(redemptionId)}`,
      { status: "FULFILLED" },
    );
  }

  async subscribeRedemptions(broadcasterId: string, sessionId: string): Promise<void> {
    await this.subscribeEvent(
      "channel.channel_points_custom_reward_redemption.add",
      "1",
      { broadcaster_user_id: broadcasterId },
      sessionId,
    );
  }

  /** Helix Get Streams. An empty list means the channel is offline, so the count is null. */
  async getViewerCount(login: string): Promise<number | null> {
    if (!/^[a-z0-9_]{3,25}$/.test(login)) return null;
    const json = await this.request("GET", `/streams?user_login=${encodeURIComponent(login)}`);
    const row = first(json);
    if (!row || typeof row.viewer_count !== "number") return null;
    return row.viewer_count;
  }

  async subscribeEvent(
    type: string,
    version: string,
    condition: Record<string, string>,
    sessionId: string,
  ): Promise<void> {
    await this.request(
      "POST",
      "/eventsub/subscriptions",
      {
        type,
        version,
        condition,
        transport: { method: "websocket", session_id: sessionId },
      },
      false,
      [409],
    );
  }

  private async request(
    method: string,
    pathname: string,
    body?: unknown,
    retried = false,
    tolerate: number[] = [],
  ): Promise<HelixBody> {
    const token = await this.deps.getToken();
    const response = await this.fetch(method, pathname, token, body);
    if (response.status === 401 && !retried) {
      await this.deps.refresh();
      return this.request(method, pathname, body, true, tolerate);
    }
    const text = await response.text();
    let json: HelixBody = {};
    if (text) {
      try {
        json = JSON.parse(text) as HelixBody;
      } catch {
        json = { message: text.slice(0, 240) };
      }
    }
    if (!response.ok && !tolerate.includes(response.status)) {
      throw new Error(redact(str(json.message) || `Twitch returned HTTP ${response.status}.`));
    }
    return json;
  }

  private fetch(method: string, pathname: string, token: string, body?: unknown): Promise<Response> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    return fetchImpl(`https://api.twitch.tv/helix${pathname}`, {
      method,
      headers: {
        "Client-Id": this.deps.clientId(),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}

export interface TwitchReward {
  id: string;
  title: string;
  cost: number;
  enabled: boolean;
  prompt: string;
}

export function buildRewardBody(title: string, cost: number, enabled: boolean): {
  title: string;
  cost: number;
  is_enabled: boolean;
} {
  const name = title.trim();
  if (!name || name.length > 45) throw new Error("Reward titles must be 1 to 45 characters.");
  if (!Number.isInteger(cost) || cost < 1 || cost > 10_000_000) {
    throw new Error("Cost must be a whole number from 1 to 10000000.");
  }
  return { title: name, cost, is_enabled: enabled };
}

function parseReward(value: unknown): TwitchReward | null {
  const row = asRecord(value);
  const id = str(row?.id);
  const title = str(row?.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    cost: typeof row?.cost === "number" ? row.cost : 0,
    enabled: row?.is_enabled !== false,
    prompt: str(row?.prompt),
  };
}

interface HelixBody {
  data?: unknown[];
  message?: string;
  [key: string]: unknown;
}

function first(body: HelixBody): Record<string, unknown> | null {
  const row = body.data?.[0];
  return asRecord(row);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
