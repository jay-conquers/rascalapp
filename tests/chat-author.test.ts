import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatFeed } from "../src/renderer/components/ChatFeed";
import { showsAuthorName } from "../src/shared/chat-author";
import { NOTICE_KINDS } from "../src/shared/feed-toggles";
import { chatFromFollow, chatFromNotification, chatFromRedemption } from "../src/shared/parsers/eventsub-events";
import type { ChatMessage } from "../src/shared/types";

function system(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "sys-1",
    platform: "twitch",
    channel: "examplechannel",
    username: "twitch",
    displayName: "Twitch",
    color: "#ffffff",
    badges: [],
    segments: [],
    plainText: "This room is now in emote-only mode.",
    timestamp: Date.parse("2026-11-25T00:00:00Z"),
    kind: "system",
    notice: "This room is now in emote-only mode.",
    ...patch,
  };
}

describe("chat author name", () => {
  it("shows the viewer on every notice kind that names one, including a redeem with no text", () => {
    const redeem = chatFromRedemption(
      { redemptionId: "r1", rewardTitle: "Hydrate", rewardCost: 100, userName: "Ace", userInput: "" },
      "examplechannel",
    );
    expect(redeem.segments).toEqual([]);
    expect(redeem.noticeKind).toBe("redemption");
    expect(showsAuthorName(redeem)).toBe(true);

    const follow = chatFromFollow(
      { user_id: "9", user_login: "bee", user_name: "Bee", followed_at: "2026-11-01T00:00:00Z" },
      "examplechannel",
    );
    expect(follow?.segments).toEqual([]);
    expect(showsAuthorName(follow!)).toBe(true);

    const sub = chatFromNotification(
      {
        metadata: { message_id: "n-1" },
        payload: {
          event: {
            notice_type: "sub",
            message_id: "n-1",
            chatter_user_login: "ace",
            chatter_user_name: "Ace",
            system_message: "Ace subscribed",
            message: { text: "", fragments: [] },
          },
        },
      },
      "examplechannel",
    );
    expect(sub?.segments).toEqual([]);
    expect(showsAuthorName(sub!)).toBe(true);

    for (const kind of NOTICE_KINDS) {
      expect(showsAuthorName(system({ noticeKind: kind, displayName: "Viewer", username: "viewer" }))).toBe(true);
    }
    expect(showsAuthorName(system())).toBe(false);
    expect(showsAuthorName(system({ segments: [{ type: "text", text: "hello" }] }))).toBe(true);
    expect(showsAuthorName(system({ kind: "chat", displayName: "Viewer", segments: [] }))).toBe(true);
    expect(showsAuthorName(system({ kind: "chat", displayName: "  " }))).toBe(false);
  });

  it("renders the redeemer and follower names, and leaves a nameless system line unnamed", () => {
    const redeem = chatFromRedemption(
      { redemptionId: "r1", rewardTitle: "Hydrate", rewardCost: 100, userName: "Ace", userInput: "" },
      "examplechannel",
      Date.parse("2026-11-25T00:00:00Z"),
    );
    const follow = chatFromFollow(
      { user_id: "9", user_login: "bee", user_name: "Bee", followed_at: "2026-11-01T00:00:00Z" },
      "examplechannel",
      Date.parse("2026-11-25T00:00:00Z"),
    );
    const named = renderToStaticMarkup(createElement(ChatFeed, { messages: [redeem, follow!] }));
    expect(named).toContain("Hydrate");
    expect(named).toContain("100 pts");
    expect(named.match(/data-testid="author-name"[^>]*>Ace</)).toHaveLength(1);
    expect(named.match(/data-testid="author-name"[^>]*>Bee</)).toHaveLength(1);

    const plain = renderToStaticMarkup(createElement(ChatFeed, { messages: [system()] }));
    expect(plain).not.toContain('data-testid="author-name"');
    expect(plain).toContain("This room is now in emote-only mode.");
  });
});
