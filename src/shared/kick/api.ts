import { buildKickChannelPatch, kickCategorySearchPath, KICK_TITLE_RELOGIN, parseKickCategories } from "./channel.ts";
import { jsonObject, scalarText } from "../record.ts";
import type { KickTokenResult } from "./oauth.ts";
import type { CategoryHit } from "../types.ts";

const API = "https://api.kick.com/public/v1";

export const KICK_EVENT_SUBSCRIPTIONS = [
  { name: "chat.message.sent", version: 1 },
  { name: "livestream.status.updated", version: 1 },
  { name: "moderation.banned", version: 1 },
] as const;

export interface KickIdentity {
  userId: string;
  name: string;
  slug: string;
  title: string;
  category: string;
  categoryId: string;
  live: boolean;
  viewers: number | null;
  startedAt: string;
}

export class KickApi {
  constructor(private readonly deps: { token: () => Promise<string>; fetchImpl?: typeof fetch }) {}

  async identity(): Promise<KickIdentity> {
    const user = await this.me();
    const channel = await this.channel();
    return {
      userId: user.userId || channel.broadcasterUserId,
      name: user.name || channel.slug,
      slug: channel.slug,
      title: channel.title,
      category: channel.category,
      categoryId: channel.categoryId,
      live: channel.live,
      viewers: channel.viewers,
      startedAt: channel.startedAt,
    };
  }

  async sendMessage(broadcasterUserId: string, content: string): Promise<void> {
    await this.request("POST", "/chat", {
      body: { broadcaster_user_id: asId(broadcasterUserId), content, type: "user" },
    });
  }

  async deleteMessage(messageId: string): Promise<void> {
    const id = messageId.trim();
    if (!id) throw new Error("Choose a message to delete.");
    await this.request("DELETE", `/chat/${encodeURIComponent(id)}`);
  }

  /** `minutes` omitted is a ban. A number is a timeout, already in Kick's minute units. */
  async moderate(broadcasterUserId: string, userId: string, minutes: number | null, reason: string): Promise<void> {
    const body: Record<string, unknown> = {
      broadcaster_user_id: asId(broadcasterUserId),
      user_id: asId(userId),
    };
    const why = reason.trim().slice(0, 100);
    if (why) body.reason = why;
    if (minutes !== null) body.duration = minutes;
    await this.request("POST", "/moderation/bans", { body });
  }

  async unmoderate(broadcasterUserId: string, userId: string): Promise<void> {
    await this.request("DELETE", "/moderation/bans", {
      body: { broadcaster_user_id: asId(broadcasterUserId), user_id: asId(userId) },
    });
  }

  /** PATCH /public/v1/channels. The relay is not involved. */
  async updateChannel(input: { title: string; categoryId?: string }): Promise<void> {
    const body = buildKickChannelPatch(input);
    try {
      await this.request("PATCH", "/channels", { body });
    } catch (err) {
      if (err instanceof KickHttpError && err.status === 403) throw new Error(KICK_TITLE_RELOGIN);
      throw err;
    }
  }

  /** Current category search. A query shorter than 3 characters is not sent. */
  async searchCategories(query: string): Promise<CategoryHit[]> {
    const path = kickCategorySearchPath(query);
    if (!path) return [];
    const payload = await this.request("GET", path, { base: "https://api.kick.com/public/v2" });
    return parseKickCategories(payload);
  }

  async lookupSlug(slug: string): Promise<string | null> {
    const name = slug.trim().toLowerCase();
    if (!name) return null;
    const payload = await this.request("GET", `/channels?slug=${encodeURIComponent(name)}`);
    const channel = firstRecord(payload);
    const id = scalarText(channel?.broadcaster_user_id);
    return id || null;
  }

  /** Subscribe to the events Rascal reads. Returns the first Kick error, if one event was refused. */
  async ensureSubscriptions(): Promise<string> {
    const current = await this.request("GET", "/events/subscriptions");
    const have = new Set(listRecords(current).map((row) => scalarText(row.event)));
    const missing = KICK_EVENT_SUBSCRIPTIONS.filter((event) => !have.has(event.name));
    if (missing.length === 0) return "";
    const created = await this.request("POST", "/events/subscriptions", {
      body: { method: "webhook", events: missing },
    });
    const errors = listRecords(created).map((row) => scalarText(row.error)).filter(Boolean);
    return errors[0] ?? "";
  }

  private async me(): Promise<{ userId: string; name: string }> {
    const payload = await this.request("GET", "/users");
    const user = firstRecord(payload);
    return { userId: scalarText(user?.user_id), name: scalarText(user?.name) };
  }

  private async channel(): Promise<{ broadcasterUserId: string; slug: string; title: string; category: string; categoryId: string; live: boolean; viewers: number | null; startedAt: string }> {
    const payload = await this.request("GET", "/channels");
    const channel = firstRecord(payload);
    const stream = jsonObject(channel?.stream);
    const category = jsonObject(channel?.category);
    const viewers = stream?.viewer_count;
    return {
      broadcasterUserId: scalarText(channel?.broadcaster_user_id),
      slug: scalarText(channel?.slug),
      title: scalarText(channel?.stream_title),
      category: scalarText(category?.name),
      categoryId: scalarText(category?.id),
      live: stream?.is_live === true,
      viewers: typeof viewers === "number" ? viewers : null,
      startedAt: scalarText(stream?.start_time),
    };
  }

  private async request(method: string, path: string, input: { body?: unknown; base?: string } = {}): Promise<unknown> {
    const token = await this.deps.token();
    const response = await (this.deps.fetchImpl ?? fetch)(`${input.base ?? API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    });
    const json = await readBody(response);
    if (!response.ok) throw new KickHttpError(kickFailure(json, response.status), response.status);
    return json;
  }
}

class KickHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function scopesFromToken(result: Pick<KickTokenResult, "scope">): string[] {
  return result.scope.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean);
}

function asId(value: string): number {
  if (!/^\d{1,20}$/.test(value)) throw new Error("Kick needs a numeric user id.");
  return Number(value);
}

function kickFailure(json: unknown, status: number): string {
  const row = jsonObject(json);
  const message = scalarText(row?.message) || scalarText(row?.error);
  if (message && !/token|secret|bearer/i.test(message)) return message.slice(0, 240);
  if (status === 401) return "Kick did not accept the login. Log in again.";
  if (status === 403) return "Kick refused that action for this account.";
  return `Kick returned HTTP ${status}.`;
}

async function readBody(response: Response): Promise<unknown> {
  const textBody = await response.text();
  if (!textBody) return {};
  try {
    return JSON.parse(textBody) as unknown;
  } catch {
    return {};
  }
}

function firstRecord(payload: unknown): Record<string, unknown> | null {
  const data = jsonObject(payload)?.data ?? payload;
  if (Array.isArray(data)) return jsonObject(data[0]);
  return jsonObject(data);
}

function listRecords(payload: unknown): Record<string, unknown>[] {
  const data = jsonObject(payload)?.data ?? payload;
  if (!Array.isArray(data)) {
    const one = jsonObject(data);
    return one ? [one] : [];
  }
  return data.map(jsonObject).filter((item): item is Record<string, unknown> => item !== null);
}
