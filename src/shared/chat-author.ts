import { NOTICE_KINDS, type NoticeKind } from "./feed-toggles";

/**
 * Notice kinds this desk builds all name a viewer: the redeemer, follower,
 * subscriber, raider, or YouTube author. A system line with no notice kind
 * (an IRC NOTICE, for example) stays nameless when it has no message body.
 */
const USER_NOTICES = new Set<string>(NOTICE_KINDS);

export function showsAuthorName(message: {
  kind: string;
  displayName: string;
  segments: readonly unknown[];
  noticeKind?: NoticeKind;
}): boolean {
  if (!message.displayName.trim()) return false;
  if (message.kind !== "system") return true;
  if (message.segments.length > 0) return true;
  return Boolean(message.noticeKind && USER_NOTICES.has(message.noticeKind));
}
