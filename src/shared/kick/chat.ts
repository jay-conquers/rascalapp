import type { ChatBadge, ChatMessage, ModAction, Segment } from "../types";
import type { KickChatLine, KickModerationLine } from "./events.ts";

const BADGE_KIND: Record<string, ChatBadge["kind"]> = {
  moderator: "mod",
  mod: "mod",
  subscriber: "sub",
  sub: "sub",
  founder: "sub",
  vip: "vip",
  broadcaster: "broadcaster",
  owner: "broadcaster",
};

export function kickChatMessage(line: KickChatLine): ChatMessage {
  return {
    id: line.messageId,
    platform: "kick",
    channel: line.channelSlug || line.channelId,
    username: line.user.login,
    displayName: line.user.displayName,
    authorId: line.user.id || undefined,
    color: line.color,
    badges: line.user.badges.map((badge) => ({
      kind: BADGE_KIND[badge.id] ?? "other",
      label: badge.label,
    })),
    segments: kickSegments(line),
    plainText: line.text,
    timestamp: line.publishedAt,
    kind: "chat",
  };
}

export function kickModAction(line: KickModerationLine): ModAction {
  const duration = line.action === "timeout" ? line.durationSeconds : null;
  const actor = line.actor || "A moderator";
  const length = duration ? ` for ${duration}s` : "";
  const summary = line.action === "ban" ? `${actor} banned ${line.target} on Kick.` : `${actor} timed out ${line.target}${length} on Kick.`;
  return {
    id: `kick-${line.action}-${line.targetId}-${line.timestamp}`,
    platform: "kick",
    channel: line.channelSlug || line.broadcasterId,
    timestamp: line.timestamp,
    action: line.action,
    actor,
    target: line.target,
    durationSeconds: duration,
    reason: line.reason,
    summary,
  };
}

function kickSegments(line: KickChatLine): Segment[] {
  if (line.emotes.length === 0) return [{ type: "text", text: line.text }];
  const segments: Segment[] = [];
  let rest = line.text;
  for (const emote of line.emotes) {
    const at = rest.indexOf(emote.name);
    if (at < 0) continue;
    if (at > 0) segments.push({ type: "text", text: rest.slice(0, at) });
    segments.push({ type: "emote", text: emote.name, url: emote.url, source: "kick" });
    rest = rest.slice(at + emote.name.length);
  }
  if (rest) segments.push({ type: "text", text: rest });
  return segments.length > 0 ? segments : [{ type: "text", text: line.text }];
}
