import { brand } from "../../../src/shared/brand.ts";
import { BOT_SCOPES, type ChatLine, type UserLevel } from "./model.ts";

export interface DevicePrompt {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  deviceCode: string;
  interval: number;
}

export function parseChatFrame(raw: string): { kind: "welcome"; sessionId: string } | { kind: "keepalive" } | { kind: "reconnect"; url: string } | { kind: "chat"; line: ChatLine; broadcasterId: string } | { kind: "ignore" } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { kind: "ignore" };
  }
  const root = asRecord(body);
  const metadata = asRecord(root?.metadata);
  const payload = asRecord(root?.payload);
  const messageType = text(metadata?.message_type);
  if (messageType === "session_welcome") {
    const sessionId = text(asRecord(payload?.session)?.id);
    return sessionId ? { kind: "welcome", sessionId } : { kind: "ignore" };
  }
  if (messageType === "session_keepalive") return { kind: "keepalive" };
  if (messageType === "session_reconnect") {
    const url = text(asRecord(payload?.session)?.reconnect_url);
    return url ? { kind: "reconnect", url } : { kind: "ignore" };
  }
  if (messageType === "notification" && text(metadata?.subscription_type) === "channel.chat.message") {
    const event = asRecord(payload?.event);
    const message = asRecord(event?.message);
    const login = text(event?.chatter_user_login);
    const userId = text(event?.chatter_user_id);
    const messageId = text(event?.message_id);
    const bodyText = text(message?.text);
    if (!login || !userId || !messageId) return { kind: "ignore" };
    const badges = Array.isArray(event?.badges) ? event.badges.map((badge) => ({ set_id: text(asRecord(badge)?.set_id) })) : [];
    const roles: UserLevel[] = ["everyone"];
    for (const badge of badges) {
      if (badge.set_id === "subscriber" || badge.set_id === "founder") roles.push("sub");
      if (badge.set_id === "vip") roles.push("vip");
      if (badge.set_id === "moderator") roles.push("mod");
      if (badge.set_id === "broadcaster") roles.push("broadcaster");
    }
    return {
      kind: "chat",
      broadcasterId: text(event?.broadcaster_user_id),
      line: {
        messageId,
        userId,
        login,
        displayName: text(event?.chatter_user_name) || login,
        text: bodyText,
        roles,
      },
    };
  }
  return { kind: "ignore" };
}

export function chatSubscription(sessionId: string, broadcasterId: string, botUserId: string): unknown {
  return {
    type: "channel.chat.message",
    version: "1",
    condition: { broadcaster_user_id: broadcasterId, user_id: botUserId },
    transport: { method: "websocket", session_id: sessionId },
  };
}

export async function startDevice(clientId: string, fetchImpl: typeof fetch): Promise<DevicePrompt> {
  const response = await fetchImpl("https://id.twitch.tv/oauth2/device", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scopes: BOT_SCOPES.join(" ") }),
  });
  if (!response.ok) throw new Error("Twitch did not start a bot login.");
  const json = (await response.json()) as { device_code?: string; user_code?: string; verification_uri?: string; expires_in?: number; interval?: number };
  if (!json.device_code || !json.user_code || !json.verification_uri) throw new Error("Twitch did not start a bot login.");
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    expiresAt: Date.now() + (json.expires_in ?? 1800) * 1000,
    interval: json.interval ?? 5,
  };
}

export async function pollDevice(clientId: string, deviceCode: string, fetchImpl: typeof fetch): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | "pending" | "denied"> {
  const response = await fetchImpl("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; message?: string };
  if (response.ok && json.access_token && json.refresh_token) {
    return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresIn: json.expires_in ?? 3600 };
  }
  if (/authorization_pending|slow_down/i.test(json.message ?? "")) return "pending";
  if (response.status === 400) return "denied";
  throw new Error("Twitch bot login failed.");
}

export class HelixBot {
  constructor(
    private readonly clientId: () => string,
    private readonly token: () => Promise<string>,
    private readonly fetchImpl: typeof fetch,
  ) {}

  send(broadcasterId: string, senderId: string, message: string): Promise<void> {
    return this.request("POST", "/chat/messages", { broadcaster_id: broadcasterId, sender_id: senderId, message });
  }

  deleteMessage(broadcasterId: string, moderatorId: string, messageId: string): Promise<void> {
    return this.request("DELETE", `/moderation/chat?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`, { message_id: messageId });
  }

  moderate(broadcasterId: string, moderatorId: string, userId: string, seconds: number | null, reason: string): Promise<void> {
    const data: { user_id: string; reason: string; duration?: number } = { user_id: userId, reason: reason || `${brand.displayName} bot` };
    if (seconds !== null) data.duration = seconds;
    return this.request("POST", `/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`, { data });
  }

  unban(broadcasterId: string, moderatorId: string, userId: string): Promise<void> {
    return this.request("DELETE", `/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}&user_id=${userId}`);
  }

  async userByLogin(login: string): Promise<{ id: string; login: string; name: string; createdAt: string } | null> {
    const json = await this.requestJson("GET", `/users?login=${encodeURIComponent(login)}`);
    const row = first(json);
    if (!row) return null;
    return { id: text(row.id), login: text(row.login), name: text(row.display_name), createdAt: text(row.created_at) };
  }

  async channel(broadcasterId: string): Promise<{ title: string; game: string; startedAt: string }> {
    const info = first(await this.requestJson("GET", `/channels?broadcaster_id=${broadcasterId}`));
    const live = first(await this.requestJson("GET", `/streams?user_id=${broadcasterId}`));
    return { title: text(info?.title), game: text(info?.game_name), startedAt: text(live?.started_at) };
  }

  async followage(broadcasterId: string, userId: string): Promise<string> {
    const followed = await this.followedAt(broadcasterId, userId);
    if (!followed) return "not following";
    return age(followed);
  }

  async followedAt(broadcasterId: string, userId: string): Promise<string> {
    const json = await this.requestJson("GET", `/channels/followers?broadcaster_id=${encodeURIComponent(broadcasterId)}&user_id=${encodeURIComponent(userId)}`);
    return text(first(json)?.followed_at);
  }

  /** Helix Send a Shoutout. Needs moderator:manage:shoutouts. A 204 is success. */
  shoutout(fromBroadcasterId: string, toBroadcasterId: string, moderatorId: string): Promise<void> {
    const query = new URLSearchParams({
      from_broadcaster_id: fromBroadcasterId,
      to_broadcaster_id: toBroadcasterId,
      moderator_id: moderatorId,
    });
    return this.request("POST", `/chat/shoutouts?${query.toString()}`);
  }

  private async request(method: string, pathname: string, body?: unknown): Promise<void> {
    await this.requestJson(method, pathname, body);
  }

  private async requestJson(method: string, pathname: string, body?: unknown): Promise<{ data?: Record<string, unknown>[] }> {
    const token = await this.token();
    const response = await this.fetchImpl(`https://api.twitch.tv/helix${pathname}`, {
      method,
      headers: { "Client-Id": this.clientId(), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return { data: [] };
    if (!response.ok) throw new Error(`Twitch returned HTTP ${response.status}.`);
    return (await response.json().catch(() => ({}))) as { data?: Record<string, unknown>[] };
  }
}

export function age(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "unknown";
  const minutes = Math.max(0, Math.floor((now - then) / 60000));
  const days = Math.floor(minutes / 1440);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 1) return `${hours}h`;
  return `${minutes}m`;
}

function first(json: { data?: Record<string, unknown>[] }): Record<string, unknown> | null {
  return json.data?.[0] ?? null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
