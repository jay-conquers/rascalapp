import { clipPlain } from "../plain";
import type { NoticeKind } from "../feed-toggles";
import type { ChatMessage, ModAction, ModActionKind, Segment } from "../types";
import { colorForName } from "../emote-url";
import { twitchEmoteUrl } from "../twitch-emotes";

export { twitchEmoteUrl } from "../twitch-emotes";

/**
 * EventSub `message.fragments`. Channel, sub, follower, and global emotes all use the fragment emote id.
 * A fragment whose id is not a safe token stays text, so a name cannot become an image URL.
 */
export function segmentsFromFragments(fragments: unknown): Segment[] {
  if (!Array.isArray(fragments)) return [];
  const segments: Segment[] = [];
  for (const fragment of fragments) {
    const record = asRecord(fragment);
    if (!record) continue;
    const text = clipPlain(record.text, 200, true);
    const emote = asRecord(record.emote);
    const id = typeof emote?.id === "string" ? emote.id : "";
    const url = id ? twitchEmoteUrl(id) : null;
    if (url && text) {
      segments.push({ type: "emote", text, url, source: "twitch" });
      continue;
    }
    if (text) segments.push({ type: "text", text });
  }
  return segments;
}

export function chatFromRedemption(
  redemption: {
    redemptionId: string;
    rewardTitle: string;
    rewardCost: number;
    userName: string;
    userInput: string;
  },
  channel: string,
  now = Date.now(),
): ChatMessage {
  const title = clipPlain(redemption.rewardTitle, 80) || "Reward";
  const user = clipPlain(redemption.userName, 40) || "someone";
  const input = clipPlain(redemption.userInput, 500, true);
  const cost = Number.isFinite(redemption.rewardCost) && redemption.rewardCost > 0 ? Math.floor(redemption.rewardCost) : 0;
  return {
    id: `redeem-${clipPlain(redemption.redemptionId, 80) || String(now)}`,
    platform: "twitch",
    channel,
    username: user.toLowerCase(),
    displayName: user,
    color: colorForName(user),
    badges: [],
    segments: input ? [{ type: "text", text: input }] : [],
    plainText: input ? `${user} redeemed ${title}: ${input}` : `${user} redeemed ${title}`,
    timestamp: now,
    kind: "system",
    noticeKind: "redemption",
    notice: title,
    amount: cost > 0 ? `${cost} pts` : undefined,
    deskOnly: true,
  };
}

interface NoticeDraft {
  kind: NoticeKind;
  notice: string;
  user: string;
  login: string;
  userId: string;
  color: string;
  text: string;
  amount?: string;
}

/** channel.chat.notification. Returns null for notice types this desk does not show. */
export function chatFromNotification(body: unknown, channel: string, now = Date.now()): ChatMessage | null {
  const root = asRecord(body);
  const event = asRecord(asRecord(root?.payload)?.event) ?? asRecord(root?.event) ?? asRecord(root);
  if (!event) return null;
  const noticeType = asString(event.notice_type);
  if (!noticeType) return null;
  const draft = describeNotice(event, noticeType);
  if (!draft) return null;
  const messageId = asString(event.message_id) || asString(asRecord(root?.metadata)?.message_id);
  const fragments = segmentsFromFragments(asRecord(event.message)?.fragments);
  const typed = fragments.map((segment) => segment.text).join("").trim();
  const bodyText = draft.text || typed;
  const segments = fragments.length > 0 ? fragments : bodyText ? [{ type: "text" as const, text: bodyText }] : [];
  const source = clipPlain(event.source_broadcaster_user_name, 40);
  const notice = source ? `${draft.notice} · shared from ${source}` : draft.notice;
  return {
    id: messageId || `notice-${draft.kind}-${draft.userId || draft.login}-${now}`,
    platform: "twitch",
    channel: clipPlain(event.broadcaster_user_login, 25) || channel,
    username: draft.login || draft.user.toLowerCase() || "twitch",
    displayName: draft.user || "Twitch",
    authorId: draft.userId || undefined,
    color: colorForName(draft.user || "Twitch", draft.color),
    badges: [],
    segments,
    plainText: bodyText ? `${notice} — ${bodyText}` : notice,
    timestamp: timestampFrom(asRecord(root?.metadata)?.message_timestamp, now),
    kind: "system",
    noticeKind: draft.kind,
    notice,
    amount: draft.amount,
  };
}

export function chatFromFollow(body: unknown, channel: string, now = Date.now()): ChatMessage | null {
  const root = asRecord(body);
  const event = asRecord(asRecord(root?.payload)?.event) ?? asRecord(root?.event) ?? asRecord(root);
  if (!event) return null;
  const userId = asString(event.user_id);
  const login = clipPlain(event.user_login, 25).toLowerCase();
  const name = clipPlain(event.user_name, 40) || login || "someone";
  if (!userId && !login) return null;
  const followedAt = asString(event.followed_at) || "";
  return {
    id: `follow-${userId || login}-${followedAt || now}`,
    platform: "twitch",
    channel: clipPlain(event.broadcaster_user_login, 25) || channel,
    username: login || name.toLowerCase(),
    displayName: name,
    authorId: userId || undefined,
    color: colorForName(name),
    badges: [],
    segments: [],
    plainText: `${name} followed`,
    timestamp: timestampFrom(followedAt, now),
    kind: "system",
    noticeKind: "follow",
    notice: "New follower",
    deskOnly: true,
  };
}

const MODERATE_ACTIONS = new Set([
  "ban",
  "timeout",
  "unban",
  "untimeout",
  "clear",
  "emoteonly",
  "emoteonlyoff",
  "followers",
  "followersoff",
  "uniquechat",
  "uniquechatoff",
  "slow",
  "slowoff",
  "subscribers",
  "subscribersoff",
  "delete",
  "mod",
  "unmod",
  "warn",
  "shared_chat_ban",
  "shared_chat_timeout",
  "shared_chat_unban",
  "shared_chat_untimeout",
  "shared_chat_delete",
]);

/** channel.moderate version 2. Unknown actions are ignored rather than labelled as something else. */
export function modActionFromModerate(body: unknown, now = Date.now()): ModAction | null {
  const root = asRecord(body);
  const event = asRecord(asRecord(root?.payload)?.event) ?? asRecord(root?.event);
  if (!event) return null;
  const actionName = asString(event.action);
  if (!actionName || !MODERATE_ACTIONS.has(actionName)) return null;
  const kind = moderateKind(actionName);
  if (!kind) return null;
  const actor = clipPlain(event.moderator_user_name, 40) || clipPlain(event.moderator_user_login, 25);
  const detail = asRecord(event[actionName]);
  const target = clipPlain(detail?.user_name, 40) || clipPlain(detail?.user_login, 25);
  const reason = clipPlain(detail?.reason, 200);
  const durationSeconds = timeoutSeconds(detail?.expires_at, now);
  const modeDetail = modeSummary(actionName, detail);
  const rules = Array.isArray(detail?.chat_rules_cited)
    ? detail.chat_rules_cited.map((rule) => clipPlain(rule, 80)).filter(Boolean).slice(0, 2)
    : [];
  const deleted = clipPlain(detail?.message_body, 120);
  const summary = buildModerateSummary({ kind, actionName, actor, target, reason, durationSeconds, modeDetail, rules, deleted });
  const metadata = asRecord(root?.metadata);
  const id = asString(metadata?.message_id) || `${actionName}-${target}-${asString(detail?.message_id) || now}`;
  return {
    id: `mod-${id}`,
    platform: "twitch",
    channel: clipPlain(event.broadcaster_user_login, 25),
    timestamp: timestampFrom(metadata?.message_timestamp, now),
    action: kind,
    actor,
    target,
    durationSeconds,
    reason,
    summary,
  };
}

function describeNotice(event: Record<string, unknown>, noticeType: string): NoticeDraft | null {
  const user = clipPlain(event.chatter_user_name, 40) || clipPlain(event.chatter_user_login, 25) || "Someone";
  const login = clipPlain(event.chatter_user_login, 25).toLowerCase();
  const userId = asString(event.chatter_user_id) || "";
  const color = asString(event.color) || "";
  const system = clipPlain(event.system_message, 300);
  const text = clipPlain(asRecord(event.message)?.text, 500, true);
  const base = { user, login, userId, color, text };
  if (noticeType === "sub" || noticeType === "shared_chat_sub") {
    return { ...base, kind: "sub", notice: system || `${user} subscribed` };
  }
  if (noticeType === "resub" || noticeType === "shared_chat_resub") {
    const months = positiveInt(asRecord(event.resub)?.cumulative_months ?? asRecord(event.shared_chat_resub)?.cumulative_months);
    return { ...base, kind: "resub", notice: system || `${user} resubscribed${months ? ` for ${months} months` : ""}` };
  }
  if (
    noticeType === "sub_gift" ||
    noticeType === "community_sub_gift" ||
    noticeType === "gift_paid_upgrade" ||
    noticeType === "shared_chat_sub_gift" ||
    noticeType === "shared_chat_community_sub_gift" ||
    noticeType === "shared_chat_gift_paid_upgrade"
  ) {
    return { ...base, kind: "subgift", notice: system || `${user} gifted a sub` };
  }
  if (noticeType === "prime_paid_upgrade" || noticeType === "shared_chat_prime_paid_upgrade") {
    return { ...base, kind: "sub", notice: system || `${user} upgraded a Prime sub` };
  }
  if (noticeType === "raid" || noticeType === "shared_chat_raid" || noticeType === "unraid") {
    const viewers = positiveInt(asRecord(event.raid)?.viewer_count ?? asRecord(event.shared_chat_raid)?.viewer_count);
    return {
      ...base,
      kind: "raid",
      notice: system || (noticeType === "unraid" ? `${user} raid ended` : `${user} is raiding${viewers ? ` with ${viewers}` : ""}`),
      amount: viewers ? `${viewers} viewers` : undefined,
    };
  }
  if (noticeType === "watch_streak") {
    const streak = asRecord(event.watch_streak);
    const count = positiveInt(streak?.streak_count);
    const points = positiveInt(streak?.channel_points_awarded);
    if (!count && !system) return null;
    const notice = system || `${user} reached a ${count ?? ""} watch streak`.replace("  ", " ");
    return { ...base, kind: "watch-streak", notice, amount: points ? `${points} pts` : count ? `${count} streams` : undefined };
  }
  if (noticeType === "modiversary" || noticeType === "shared_chat_modiversary") {
    const months = positiveInt(asRecord(event.modiversary)?.months ?? asRecord(event.shared_chat_modiversary)?.months);
    if (!months && !system) return null;
    return {
      ...base,
      kind: "mod-anniversary",
      notice: system || `${user} has been a mod for ${months} months`,
      amount: months ? `${months} mo` : undefined,
    };
  }
  return null;
}

function moderateKind(action: string): ModActionKind | null {
  if (action === "ban" || action === "shared_chat_ban") return "ban";
  if (action === "unban" || action === "shared_chat_unban") return "unban";
  if (action === "timeout" || action === "shared_chat_timeout") return "timeout";
  if (action === "untimeout" || action === "shared_chat_untimeout") return "untimeout";
  if (action === "delete" || action === "shared_chat_delete") return "delete";
  if (action === "warn") return "warn";
  if (action === "clear") return "clear";
  if (action === "mod") return "mod";
  if (action === "unmod") return "unmod";
  if (
    action === "emoteonly" ||
    action === "emoteonlyoff" ||
    action === "followers" ||
    action === "followersoff" ||
    action === "uniquechat" ||
    action === "uniquechatoff" ||
    action === "slow" ||
    action === "slowoff" ||
    action === "subscribers" ||
    action === "subscribersoff"
  ) {
    return "mode";
  }
  return null;
}

function modeSummary(action: string, detail: Record<string, unknown> | null): string {
  if (action === "emoteonly") return "Emote-only chat on";
  if (action === "emoteonlyoff") return "Emote-only chat off";
  if (action === "followers") {
    const minutes = positiveInt(detail?.follow_duration_minutes);
    return minutes ? `Followers-only chat on (${minutes} min)` : "Followers-only chat on";
  }
  if (action === "followersoff") return "Followers-only chat off";
  if (action === "slow") {
    const seconds = positiveInt(detail?.wait_time_seconds);
    return seconds ? `Slow mode on (${seconds}s)` : "Slow mode on";
  }
  if (action === "slowoff") return "Slow mode off";
  if (action === "subscribers") return "Subscriber-only chat on";
  if (action === "subscribersoff") return "Subscriber-only chat off";
  if (action === "uniquechat") return "Unique chat on";
  if (action === "uniquechatoff") return "Unique chat off";
  return "";
}

function buildModerateSummary(input: {
  kind: ModActionKind;
  actionName: string;
  actor: string;
  target: string;
  reason: string;
  durationSeconds: number | null;
  modeDetail: string;
  rules: string[];
  deleted: string;
}): string {
  const who = input.actor || "A moderator";
  const shared = input.actionName.startsWith("shared_chat_") ? " in shared chat" : "";
  const because = input.reason ? ` Reason: ${input.reason}` : "";
  if (input.kind === "mode") return `${who}: ${input.modeDetail}${shared}.`;
  if (input.kind === "clear") return `${who} cleared chat${shared}.`;
  if (input.kind === "mod") return `${who} modded ${input.target || "a user"}${shared}.`;
  if (input.kind === "unmod") return `${who} removed mod from ${input.target || "a user"}${shared}.`;
  if (input.kind === "ban") return `${who} banned ${input.target || "a user"}${shared}.${because}`;
  if (input.kind === "unban") return `${who} unbanned ${input.target || "a user"}${shared}.`;
  if (input.kind === "timeout") {
    const length = input.durationSeconds ? ` for ${formatDuration(input.durationSeconds)}` : "";
    return `${who} timed out ${input.target || "a user"}${length}${shared}.${because}`;
  }
  if (input.kind === "untimeout") return `${who} removed a timeout from ${input.target || "a user"}${shared}.`;
  if (input.kind === "warn") {
    const cited = input.rules.length > 0 ? ` Rules: ${input.rules.join("; ")}` : "";
    return `${who} warned ${input.target || "a user"}${shared}.${because}${cited}`;
  }
  const snippet = input.deleted ? ` “${input.deleted}”` : "";
  return `${who} deleted a message from ${input.target || "a user"}${shared}.${snippet}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${Math.round(seconds / 60)}m`;
}

function timeoutSeconds(value: unknown, now: number): number | null {
  if (typeof value !== "string") return null;
  const end = Date.parse(value);
  if (!Number.isFinite(end)) return null;
  const seconds = Math.round((end - now) / 1000);
  if (seconds <= 0 || seconds > 60 * 60 * 24 * 14) return null;
  return seconds;
}

function timestampFrom(value: unknown, now: number): number {
  if (typeof value !== "string") return now;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : now;
}

function positiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
