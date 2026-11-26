import { colorForName } from "../emote-url";
import type { ChatRole, NormalizedBadge, NormalizedChatMessage } from "../platform/types";
import { asRecord, scalarText } from "../record";

/** Kick counts a timeout in minutes, from 1 minute through 7 days. */
export const KICK_TIMEOUT_MAX_MINUTES = 10_080;
export const KICK_CHAT_MAX = 500;

const KICK_EMOTE = /\[emote:(\d+):([^\]]+)\]/g;

export interface KickEmotePiece {
  name: string;
  url: string;
}

export interface KickChatLine {
  messageId: string;
  channelId: string;
  channelSlug: string;
  text: string;
  publishedAt: number;
  color: string;
  emotes: KickEmotePiece[];
  user: {
    id: string;
    login: string;
    displayName: string;
    roles: ChatRole[];
    badges: NormalizedBadge[];
  };
}

export interface KickModerationLine {
  action: "ban" | "timeout";
  actor: string;
  target: string;
  targetId: string;
  broadcasterId: string;
  channelSlug: string;
  reason: string;
  durationSeconds: number | null;
  timestamp: number;
}

export interface KickLiveLine {
  live: boolean;
  title: string;
  broadcasterId: string;
  channelSlug: string;
}

/** Shorter than a minute rounds up. Longer than 7 days is rejected. */
export function kickTimeoutMinutes(seconds: number): number {
  if (!Number.isInteger(seconds) || seconds < 1) throw new Error("Enter a timeout from 1 second to 14 days.");
  const minutes = Math.ceil(seconds / 60);
  if (minutes > KICK_TIMEOUT_MAX_MINUTES) throw new Error("Kick timeouts stop at 7 days.");
  return minutes;
}

export function kickEmoteUrl(id: string): string {
  return `https://files.kick.com/emotes/${id}/fullsize`;
}

/**
 * `chat.message.sent` becomes the shared chat line.
 * Emote tokens become the emote name, which is what a command should see.
 */
export function mapKickChatEvent(body: unknown, now = Date.now()): KickChatLine | null {
  const row = asRecord(body);
  if (!row || Array.isArray(body)) return null;
  const messageId = scalarText(row.message_id);
  const content = typeof row.content === "string" ? row.content : "";
  if (!messageId || !content.trim()) return null;
  const broadcaster = asRecord(row.broadcaster);
  const sender = asRecord(row.sender);
  const identity = asRecord(sender?.identity);
  const userId = sender?.is_anonymous === true ? "" : scalarText(sender?.user_id);
  const username = sender?.is_anonymous === true ? "anonymous" : scalarText(sender?.username) || "kick";
  const broadcasterId = scalarText(broadcaster?.user_id);
  const roles = rolesFor(identity, userId, broadcasterId);
  const badges = badgesFor(identity, roles);
  const pieces = splitKickContent(content);
  const published = Date.parse(scalarText(row.created_at));
  return {
    messageId,
    channelId: broadcasterId,
    channelSlug: scalarText(broadcaster?.channel_slug),
    text: pieces.plain,
    publishedAt: Number.isFinite(published) ? published : now,
    color: colorForName(username, scalarText(identity?.username_color)),
    emotes: pieces.emotes,
    user: {
      id: userId,
      login: username.toLowerCase(),
      displayName: username,
      roles,
      badges,
    },
  };
}

export function kickLineToNormalized(line: KickChatLine): NormalizedChatMessage {
  return {
    platform: "kick",
    messageId: line.messageId,
    channelId: line.channelId,
    text: line.text,
    publishedAt: line.publishedAt,
    user: {
      id: line.user.id,
      login: line.user.login,
      displayName: line.user.displayName,
      roles: line.user.roles,
      badges: line.user.badges,
    },
  };
}

/** `moderation.banned`. A missing expiry is a ban. An expiry is a timeout. */
export function mapKickModerationEvent(body: unknown, now = Date.now()): KickModerationLine | null {
  const row = asRecord(body);
  if (!row || Array.isArray(body)) return null;
  const metadata = asRecord(row.metadata);
  const banned = asRecord(row.banned_user);
  const moderator = asRecord(row.moderator);
  const broadcaster = asRecord(row.broadcaster);
  const target = scalarText(banned?.username);
  const targetId = scalarText(banned?.user_id);
  if (!target && !targetId) return null;
  const expires = scalarText(metadata?.expires_at);
  const created = Date.parse(scalarText(metadata?.created_at));
  const expiry = expires ? Date.parse(expires) : Number.NaN;
  const timeout = Boolean(expires) && Number.isFinite(expiry);
  const durationSeconds = timeout ? Math.max(1, Math.round((expiry - (Number.isFinite(created) ? created : now)) / 1000)) : null;
  return {
    action: timeout ? "timeout" : "ban",
    actor: scalarText(moderator?.username),
    target: target || targetId,
    targetId,
    broadcasterId: scalarText(broadcaster?.user_id),
    channelSlug: scalarText(broadcaster?.channel_slug),
    reason: scalarText(metadata?.reason).slice(0, 200),
    durationSeconds,
    timestamp: Number.isFinite(created) ? created : now,
  };
}

export function mapKickLiveEvent(body: unknown): KickLiveLine | null {
  const row = asRecord(body);
  if (!row || Array.isArray(body) || typeof row.is_live !== "boolean") return null;
  const broadcaster = asRecord(row.broadcaster);
  return {
    live: row.is_live,
    title: scalarText(row.title).slice(0, 200),
    broadcasterId: scalarText(broadcaster?.user_id),
    channelSlug: scalarText(broadcaster?.channel_slug),
  };
}

function splitKickContent(content: string): { plain: string; emotes: KickEmotePiece[] } {
  const emotes: KickEmotePiece[] = [];
  const plain = content
    .replace(KICK_EMOTE, (_full, id: string, name: string) => {
      const label = name.trim() || id;
      emotes.push({ name: label, url: kickEmoteUrl(id) });
      return label;
    })
    .replace(/\s+/g, " ")
    .trim();
  return { plain, emotes };
}

function rolesFor(identity: Record<string, unknown> | null, userId: string, broadcasterId: string): ChatRole[] {
  const roles: ChatRole[] = ["everyone"];
  const badges = Array.isArray(identity?.badges) ? identity.badges : [];
  for (const item of badges) {
    const badge = asRecord(item);
    const type = scalarText(badge?.type).toLowerCase();
    if ((type === "moderator" || type === "mod") && !roles.includes("mod")) roles.push("mod");
    if ((type === "subscriber" || type === "sub" || type === "founder") && !roles.includes("sub")) roles.push("sub");
    if (type === "vip" && !roles.includes("vip")) roles.push("vip");
    if ((type === "broadcaster" || type === "owner") && !roles.includes("broadcaster")) roles.push("broadcaster");
  }
  if (userId && broadcasterId && userId === broadcasterId && !roles.includes("broadcaster")) roles.push("broadcaster");
  return roles;
}

function badgesFor(identity: Record<string, unknown> | null, roles: readonly ChatRole[]): NormalizedBadge[] {
  const badges: NormalizedBadge[] = [];
  const raw = Array.isArray(identity?.badges) ? identity.badges : [];
  for (const item of raw) {
    const badge = asRecord(item);
    const label = scalarText(badge?.text) || scalarText(badge?.type);
    if (!label) continue;
    badges.push({ id: scalarText(badge?.type).toLowerCase() || label.toLowerCase(), label });
  }
  if (roles.includes("broadcaster") && !badges.some((badge) => badge.id === "broadcaster" || badge.id === "owner")) {
    badges.push({ id: "broadcaster", label: "Broadcaster" });
  }
  return badges;
}
