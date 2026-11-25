import type { ChatRole, NormalizedBadge, NormalizedChatMessage, NormalizedChatUser } from "./types.ts";
import { asRecord } from "../record";

/** Desk chat line from the page reader. The id and author channel id are the ones the Data API delete and ban calls use. */
export function normalizeYoutubeReaderMessage(message: {
  id: string;
  authorId?: string;
  username: string;
  displayName: string;
  plainText: string;
  timestamp: number;
  badges?: readonly { kind: string }[];
  channel?: string;
}): NormalizedChatMessage | null {
  const body = message.plainText.trim();
  const messageId = message.id.trim();
  if (!messageId || !body) return null;
  const displayName = message.displayName.trim() || message.username.trim() || "YouTube";
  const userId = message.authorId?.trim() || "";
  const roles: ChatRole[] = ["everyone"];
  const badges: NormalizedBadge[] = [];
  for (const badge of message.badges ?? []) {
    if (badge.kind === "member" && !roles.includes("sub")) {
      roles.push("sub");
      badges.push({ id: "member", label: "Member" });
    }
    if (badge.kind === "mod" && !roles.includes("mod")) {
      roles.push("mod");
      badges.push({ id: "moderator", label: "Moderator" });
    }
    if ((badge.kind === "owner" || badge.kind === "broadcaster") && !roles.includes("broadcaster")) {
      roles.push("broadcaster");
      badges.push({ id: "owner", label: "Owner" });
    }
  }
  return {
    platform: "youtube",
    messageId,
    channelId: message.channel?.trim() || "",
    text: body,
    publishedAt: message.timestamp,
    user: {
      id: userId,
      login: loginFromName(displayName) || userId,
      displayName,
      roles,
      badges,
    },
  };
}

const ROLE_BADGES: { role: ChatRole; id: string; label: string }[] = [
  { role: "broadcaster", id: "broadcaster", label: "Broadcaster" },
  { role: "mod", id: "moderator", label: "Moderator" },
  { role: "vip", id: "vip", label: "VIP" },
  { role: "sub", id: "subscriber", label: "Subscriber" },
];

export function badgesForRoles(roles: readonly ChatRole[]): NormalizedBadge[] {
  const have = new Set(roles);
  return ROLE_BADGES.filter((badge) => have.has(badge.role)).map((badge) => ({ id: badge.id, label: badge.label }));
}

export function normalizeYoutubeLiveChatItem(item: unknown, fallbackChannelId = ""): NormalizedChatMessage | null {
  const row = asRecord(item);
  if (!row) return null;
  const snippet = asRecord(row.snippet);
  const author = asRecord(row.authorDetails);
  const messageId = text(row.id);
  const userId = text(author?.channelId) || text(snippet?.authorChannelId);
  const displayName = text(author?.displayName) || userId;
  const body = messageText(snippet);
  if (!messageId || !userId || !body) return null;
  const roles: ChatRole[] = ["everyone"];
  const badges: NormalizedBadge[] = [];
  if (author?.isChatSponsor === true) {
    roles.push("sub");
    badges.push({ id: "member", label: "Member" });
  }
  if (author?.isChatModerator === true) {
    roles.push("mod");
    badges.push({ id: "moderator", label: "Moderator" });
  }
  if (author?.isChatOwner === true) {
    roles.push("broadcaster");
    badges.push({ id: "owner", label: "Owner" });
  }
  if (author?.isVerified === true) badges.push({ id: "verified", label: "Verified" });
  const published = Date.parse(text(snippet?.publishedAt));
  return {
    platform: "youtube",
    messageId,
    channelId: text(snippet?.liveChatId) || fallbackChannelId,
    text: body,
    publishedAt: Number.isFinite(published) ? published : Date.now(),
    user: {
      id: userId,
      login: loginFromName(displayName) || userId,
      displayName,
      roles,
      badges,
    },
  };
}

export function normalizeTwitchChatFields(input: {
  messageId: string;
  channelId: string;
  text: string;
  userId: string;
  login: string;
  displayName: string;
  roles: readonly ChatRole[];
  publishedAt?: number;
}): NormalizedChatMessage {
  const user: NormalizedChatUser = {
    id: input.userId,
    login: input.login,
    displayName: input.displayName || input.login,
    roles: input.roles.length > 0 ? [...input.roles] : ["everyone"],
    badges: badgesForRoles(input.roles),
  };
  return {
    platform: "twitch",
    messageId: input.messageId,
    channelId: input.channelId,
    text: input.text,
    publishedAt: input.publishedAt ?? Date.now(),
    user,
  };
}

function messageText(snippet: Record<string, unknown> | null): string {
  if (!snippet) return "";
  const shown = text(snippet.displayMessage);
  if (shown) return shown;
  const textDetails = asRecord(snippet.textMessageDetails);
  return text(textDetails?.messageText);
}

function loginFromName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

