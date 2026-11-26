import { formatDuration } from "./parsers/eventsub-events";
import { asRecord } from "./record";
import { CHATTER_SCOPE, MODERATE_MANAGE_SCOPES } from "./scopes";
import type { Platform } from "./types";

export const TIMEOUT_LIMIT_SECONDS = 1_209_600;

export const TIMEOUT_PRESETS = [
  { id: "1m", label: "1 min", seconds: 60 },
  { id: "10m", label: "10 min", seconds: 600 },
  { id: "1h", label: "1 hour", seconds: 3600 },
  { id: "24h", label: "24 hours", seconds: 86_400 },
] as const;

const DELETE_SCOPE = MODERATE_MANAGE_SCOPES[0];
const BAN_SCOPE = MODERATE_MANAGE_SCOPES[1];

export type DeskModerationAction = "delete" | "timeout" | "ban" | "unban";

export interface ModerationCommand {
  action: DeskModerationAction;
  messageId: string;
  seconds?: number;
}

export interface ModerationSubject {
  platform: Platform;
  id: string;
  username: string;
  displayName: string;
  authorId?: string;
  badges: readonly { kind: string }[];
  deleted?: boolean;
}

export interface ModerationContext {
  twitch: {
    loggedIn: boolean;
    scopes: readonly string[];
    login: string | null;
    userId: string | null;
    channelLogin: string;
    broadcasterId: string | null;
  };
  youtube: {
    canModerate: boolean;
    live: boolean;
    channelId: string;
    accountChannelId: string | null;
  };
  kick?: {
    loggedIn: boolean;
    scopes: readonly string[];
    userId: string | null;
    broadcasterUserId: string | null;
  };
}

export interface ActionAvailability {
  enabled: boolean;
  reason: string;
}

export interface ModerationOffer {
  delete: ActionAvailability;
  timeout: ActionAvailability;
  ban: ActionAvailability;
  unban: ActionAvailability;
}

const PROTECTED = "The broadcaster's account cannot be moderated from here.";

export function validTimeoutSeconds(value: number): number | null {
  if (!Number.isInteger(value) || value < 1 || value > TIMEOUT_LIMIT_SECONDS) return null;
  return value;
}

/** "90", "90s", "5m", "2h", "1d", and the same words written out. Over 14 days is rejected. */
export function parseTimeoutDuration(input: string): number | null {
  const match = /^(\d{1,7})\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/i.exec(
    input.trim(),
  );
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount < 1) return null;
  const unit = (match[2] ?? "s").toLowerCase();
  const seconds = unit.startsWith("d")
    ? amount * 86_400
    : unit.startsWith("h")
      ? amount * 3600
      : unit.startsWith("m")
        ? amount * 60
        : amount;
  return validTimeoutSeconds(seconds);
}

export function parseModerationCommand(value: unknown): ModerationCommand {
  const row = asRecord(value);
  if (!row) throw new Error("That moderation action is incomplete.");
  const action = row.action;
  if (action !== "delete" && action !== "timeout" && action !== "ban" && action !== "unban") {
    throw new Error("That moderation action is not supported.");
  }
  if (typeof row.messageId !== "string" || !row.messageId.trim() || row.messageId.length > 500) {
    throw new Error("Choose a chat message first.");
  }
  const messageId = row.messageId.trim();
  if (action === "timeout") {
    const seconds = typeof row.seconds === "number" ? validTimeoutSeconds(row.seconds) : parseTimeoutDuration(String(row.seconds ?? ""));
    if (seconds === null) throw new Error("Enter a timeout from 1 second to 14 days.");
    return { action, messageId, seconds };
  }
  return { action, messageId };
}

export function moderationOffer(message: ModerationSubject, ctx: ModerationContext): ModerationOffer {
  if (isBroadcasterTarget(message, ctx)) {
    const blocked = deny(PROTECTED);
    return { delete: blocked, timeout: blocked, ban: blocked, unban: blocked };
  }
  if (message.platform === "youtube") return youtubeOffer(message, ctx);
  if (message.platform === "kick") return kickOffer(message, ctx);
  return twitchOffer(message, ctx);
}

export function isBroadcasterTarget(message: ModerationSubject, ctx: ModerationContext): boolean {
  if (message.badges.some((badge) => badge.kind === "broadcaster" || badge.kind === "owner")) return true;
  if (message.platform === "twitch") {
    const login = message.username.trim().toLowerCase();
    const channel = ctx.twitch.channelLogin.trim().toLowerCase();
    if (login && channel && login === channel) return true;
    if (message.authorId && ctx.twitch.broadcasterId && message.authorId === ctx.twitch.broadcasterId) return true;
    const signedIn = ctx.twitch.login?.trim().toLowerCase() ?? "";
    if (message.authorId && ctx.twitch.userId && channel && signedIn && channel === signedIn && message.authorId === ctx.twitch.userId) {
      return true;
    }
    return false;
  }
  if (message.platform === "kick") {
    return Boolean(message.authorId && ctx.kick?.broadcasterUserId && message.authorId === ctx.kick.broadcasterUserId);
  }
  if (message.authorId && ctx.youtube.channelId && message.authorId === ctx.youtube.channelId) return true;
  if (
    message.authorId &&
    message.authorId === ctx.youtube.accountChannelId &&
    protectYoutubeAccount(ctx.youtube.channelId, ctx.youtube.accountChannelId)
  ) {
    return true;
  }
  return false;
}

/** The YouTube account that posts is the account that can delete and ban. Don't treat a different moderator as the owner. */
export function protectYoutubeAccount(channelId: string, accountChannelId: string | null): boolean {
  if (!accountChannelId) return false;
  if (!channelId) return true;
  return accountChannelId === channelId;
}

export function describeDeskMod(input: {
  platform: Platform;
  actor: string;
  target: string;
  action: DeskModerationAction;
  durationSeconds: number | null;
}): string {
  const where = input.platform === "twitch" ? "Twitch" : input.platform === "kick" ? "Kick" : "YouTube";
  const who = input.actor.trim() || "A moderator";
  const target = input.target.trim() || "a user";
  if (input.action === "delete") return `${who} deleted a message from ${target} on ${where}.`;
  if (input.action === "timeout") {
    const length = input.durationSeconds ? ` for ${formatDuration(input.durationSeconds)}` : "";
    return `${who} timed out ${target}${length} on ${where}.`;
  }
  if (input.action === "ban") return `${who} banned ${target} on ${where}.`;
  return `${who} unbanned ${target} on ${where}.`;
}

export function offerHint(offer: ModerationOffer): string {
  const reasons = [offer.delete, offer.timeout, offer.ban, offer.unban].filter((action) => !action.enabled).map((action) => action.reason);
  const unique = [...new Set(reasons)];
  return unique.length === 1 ? unique[0] ?? "" : "";
}

/** The page reader is attached to a live chat, which is when its deletes and bans show up. */
export function youtubeModLogConnected(state: string): boolean {
  return state === "live" || state === "connected" || state === "reconnecting";
}

export function hasChatterScope(scopes: readonly string[]): boolean {
  return scopes.includes(CHATTER_SCOPE);
}

function twitchOffer(message: ModerationSubject, ctx: ModerationContext): ModerationOffer {
  if (!ctx.twitch.loggedIn) {
    const blocked = deny("Log in with Twitch to moderate this chat.");
    return { delete: blocked, timeout: blocked, ban: blocked, unban: blocked };
  }
  const scopes = new Set(ctx.twitch.scopes);
  const deleteAction = scopes.has(DELETE_SCOPE)
    ? message.deleted
      ? deny("That message is already deleted.")
      : deletableMessageId("twitch", message.id)
        ? allow()
        : deny("This line has no chat message id to delete.")
    : deny("Log in again to grant moderator:manage:chat_messages.");
  const userAction = scopes.has(BAN_SCOPE)
    ? twitchUserId(message.authorId)
      ? allow()
      : deny("This message has no Twitch user id.")
    : deny("Log in again to grant moderator:manage:banned_users.");
  return { delete: deleteAction, timeout: userAction, ban: userAction, unban: userAction };
}

function kickOffer(message: ModerationSubject, ctx: ModerationContext): ModerationOffer {
  if (!ctx.kick?.loggedIn) {
    const blocked = deny("Log in with Kick to moderate this chat.");
    return { delete: blocked, timeout: blocked, ban: blocked, unban: blocked };
  }
  const scopes = new Set(ctx.kick.scopes);
  const deleteAction = scopes.has("moderation:chat_message:manage")
    ? message.deleted
      ? deny("That message is already deleted.")
      : deletableMessageId("kick", message.id)
        ? allow()
        : deny("This line has no Kick message id to delete.")
    : deny("Log in again to grant moderation:chat_message:manage.");
  const userAction = scopes.has("moderation:ban")
    ? /^\d{1,20}$/.test(message.authorId ?? "")
      ? allow()
      : deny("This message has no Kick user id.")
    : deny("Log in again to grant moderation:ban.");
  return { delete: deleteAction, timeout: userAction, ban: userAction, unban: userAction };
}

function youtubeOffer(message: ModerationSubject, ctx: ModerationContext): ModerationOffer {
  if (!ctx.youtube.canModerate) {
    const blocked = deny("Connect a YouTube account that can moderate this chat.");
    return { delete: blocked, timeout: blocked, ban: blocked, unban: blocked };
  }
  if (!ctx.youtube.live) {
    const blocked = deny("YouTube chat is not live.");
    return { delete: blocked, timeout: blocked, ban: blocked, unban: blocked };
  }
  const deleteAction = message.deleted
    ? deny("That message is already deleted.")
    : deletableMessageId("youtube", message.id)
      ? allow()
      : deny("This line has no YouTube message id to delete.");
  const userAction = youtubeChannelId(message.authorId) ? allow() : deny("This message has no YouTube channel id.");
  return { delete: deleteAction, timeout: userAction, ban: userAction, unban: userAction };
}

export function deletableMessageId(platform: Platform, id: string): boolean {
  if (!id || /^(yt-|twitch-|redeem-|follow-|notice-|mod-)/.test(id)) return false;
  if (platform === "twitch") return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (platform === "kick") return /^[A-Za-z0-9_-]{8,80}$/.test(id);
  return id.length >= 8 && id.length <= 200 && !/\s/.test(id);
}

function twitchUserId(value: string | undefined): boolean {
  return typeof value === "string" && /^\d{1,20}$/.test(value);
}

function youtubeChannelId(value: string | undefined): boolean {
  return typeof value === "string" && /^UC[\w-]{16,}$/.test(value);
}

function allow(): ActionAvailability {
  return { enabled: true, reason: "" };
}

function deny(reason: string): ActionAvailability {
  return { enabled: false, reason };
}
