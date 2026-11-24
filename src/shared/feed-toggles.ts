import type { ChatMessage } from "./types";
import type { WordEmote } from "./word-emotes";

/** Every alert the desk can show or hide. Mod log is separate because it never enters chat. */
export const NOTICE_KINDS = [
  "sub",
  "resub",
  "subgift",
  "raid",
  "cheer",
  "follow",
  "watch-streak",
  "mod-anniversary",
  "redemption",
  "superchat",
  "supersticker",
  "membership",
  "gifted-membership",
  "milestone",
] as const;

export type NoticeKind = (typeof NOTICE_KINDS)[number];

export interface EmoteFlags {
  bttv: boolean;
  ffz: boolean;
  seventv: boolean;
}

export interface FeedToggles {
  emotes: EmoteFlags;
  notices: Record<NoticeKind, boolean>;
  /** Private mod log. Off stops recording. It is never sent to chat or an overlay. */
  modLog: boolean;
}

export const NOTICE_LABELS: { key: NoticeKind; label: string }[] = [
  { key: "sub", label: "Subscriptions" },
  { key: "resub", label: "Resubscriptions" },
  { key: "subgift", label: "Gifted subs" },
  { key: "raid", label: "Raids" },
  { key: "cheer", label: "Cheers" },
  { key: "follow", label: "Follows" },
  { key: "watch-streak", label: "Watch streaks" },
  { key: "mod-anniversary", label: "Mod anniversaries" },
  { key: "redemption", label: "Channel point redeems" },
  { key: "superchat", label: "YouTube Super Chats" },
  { key: "supersticker", label: "YouTube Super Stickers" },
  { key: "membership", label: "YouTube memberships" },
  { key: "gifted-membership", label: "YouTube gifted memberships" },
  { key: "milestone", label: "YouTube milestones" },
];

export function defaultFeed(): FeedToggles {
  const notices = {} as Record<NoticeKind, boolean>;
  for (const kind of NOTICE_KINDS) notices[kind] = true;
  return {
    emotes: { bttv: true, ffz: true, seventv: true },
    notices,
    modLog: true,
  };
}

export function mergeFeed(current: FeedToggles, patch: unknown): FeedToggles {
  const base = current ?? defaultFeed();
  const row = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
  const emotes = row.emotes && typeof row.emotes === "object" ? (row.emotes as Record<string, unknown>) : {};
  const noticesIn = row.notices && typeof row.notices === "object" ? (row.notices as Record<string, unknown>) : {};
  const notices = {} as Record<NoticeKind, boolean>;
  for (const kind of NOTICE_KINDS) {
    notices[kind] = typeof noticesIn[kind] === "boolean" ? noticesIn[kind] : base.notices[kind];
  }
  return {
    emotes: {
      bttv: typeof emotes.bttv === "boolean" ? emotes.bttv : base.emotes.bttv,
      ffz: typeof emotes.ffz === "boolean" ? emotes.ffz : base.emotes.ffz,
      seventv: typeof emotes.seventv === "boolean" ? emotes.seventv : base.emotes.seventv,
    },
    notices,
    modLog: typeof row.modLog === "boolean" ? row.modLog : base.modLog,
  };
}

export function noticeEnabled(feed: FeedToggles, kind: NoticeKind): boolean {
  return feed.notices[kind] !== false;
}

/** Notices that can arrive both from anonymous IRC and from EventSub. */
const DUAL_NOTICE = new Set<NoticeKind>(["sub", "resub", "subgift", "raid", "watch-streak", "mod-anniversary"]);

export function noticeDedupeKey(message: ChatMessage): string | null {
  if (!message.noticeKind || !DUAL_NOTICE.has(message.noticeKind)) return null;
  const who = (message.authorId || message.username || "").toLowerCase();
  const text = (message.notice || message.plainText || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!who && !text) return null;
  return `${message.noticeKind}|${who}|${text}`;
}

export function filterWordEmotes(
  emotes: ReadonlyMap<string, WordEmote>,
  flags: EmoteFlags,
): ReadonlyMap<string, WordEmote> {
  if (flags.bttv && flags.ffz && flags.seventv) return emotes;
  const next = new Map<string, WordEmote>();
  for (const [name, emote] of emotes) {
    if (emote.source === "bttv" && !flags.bttv) continue;
    if (emote.source === "ffz" && !flags.ffz) continue;
    if (emote.source === "7tv" && !flags.seventv) continue;
    next.set(name, emote);
  }
  return next;
}
