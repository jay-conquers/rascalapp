import { describe, expect, it } from "vitest";
import { defaultFeed, mergeFeed, noticeDedupeKey, noticeEnabled } from "../src/shared/feed-toggles";
import { overlayEmoteAllowed, safeEmoteUrl } from "../src/shared/emote-url";
import {
  chatFromFollow,
  chatFromNotification,
  chatFromRedemption,
  modActionFromModerate,
  segmentsFromFragments,
} from "../src/shared/parsers/eventsub-events";
import { twitchEmoteUrl } from "../src/shared/twitch-emotes";
import { classifyIrcNotice, parseIrcLine } from "../src/shared/parsers/twitch-irc";
import { parseLiveChatResponse, readConcurrentViewers } from "../src/shared/parsers/youtube";
import { defaultChatOverlayFile, projectChatOverlay, type ChatOverlayStyle } from "../src/shared/chat-overlay";
import type { ChatMessage } from "../src/shared/types";
import { SettingsStore } from "../src/main/settings";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("emote fragments", () => {
  it("renders twitch emote ids from eventsub fragments and rejects unsafe ids", () => {
    const segments = segmentsFromFragments([
      { type: "text", text: "hi " },
      { type: "emote", text: "channelKEK", emote: { id: "305954156", emote_set_id: "channel-set", owner_id: "4242" } },
      { type: "emote", text: "<img src=x>", emote: { id: "../etc" } },
      { type: "text", text: " Kappa" },
    ]);
    expect(segments[1]).toEqual({
      type: "emote",
      text: "channelKEK",
      url: "https://static-cdn.jtvnw.net/emoticons/v2/305954156/default/dark/2.0",
      source: "twitch",
    });
    expect(segments.some((segment) => segment.type === "emote" && segment.text.includes("<"))).toBe(false);
    expect(twitchEmoteUrl("../25")).toBeNull();
    expect(safeEmoteUrl("https://user:pass@static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0")).toBeNull();
    expect(safeEmoteUrl("https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0?access_token=secret")).toBeNull();
  });

  it("classifies irc subs, cheers, and watch streaks from tags", () => {
    expect(classifyIrcNotice("USERNOTICE", { "msg-id": "resub" })).toBe("resub");
    expect(classifyIrcNotice("USERNOTICE", { "msg-id": "subgift" })).toBe("subgift");
    expect(classifyIrcNotice("USERNOTICE", { "msg-id": "raid" })).toBe("raid");
    expect(classifyIrcNotice("PRIVMSG", { bits: "100" })).toBe("cheer");
    expect(classifyIrcNotice("USERNOTICE", { "msg-id": "viewermilestone", "msg-param-category": "watch-streak" })).toBe("watch-streak");
    expect(classifyIrcNotice("USERNOTICE", { "msg-id": "modiversary" })).toBe("mod-anniversary");
    expect(classifyIrcNotice("USERNOTICE", { "msg-id": "ritual" })).toBeUndefined();
    expect(classifyIrcNotice("USERNOTICE", { "msg-id": "primepaidupgrade" })).toBe("sub");
    const cheer = parseIrcLine(
      "@badges=;bits=100;color=#FFFFFF;display-name=Ace;emotes=25:0-4;id=cheer-1;tmi-sent-ts=1700000000000;user-id=7 :ace!ace@ace.tmi.twitch.tv PRIVMSG #examplechannel :Kappa 100",
    );
    expect(cheer.message?.noticeKind).toBe("cheer");
    expect(cheer.message?.amount).toBe("100 bits");
    expect(cheer.message?.segments[0]).toMatchObject({ type: "emote", text: "Kappa" });
  });
});

describe("eventsub notices and moderation", () => {
  const now = Date.parse("2026-11-23T18:00:00.000Z");

  it("reads a redemption, a follow, a watch streak, and a mod anniversary", () => {
    const redeem = chatFromRedemption(
      { redemptionId: "red-1", rewardTitle: "Hydrate <b>", rewardCost: 50, userName: "Ace", userInput: "with ice" },
      "examplechannel",
      now,
    );
    expect(redeem.deskOnly).toBe(true);
    expect(redeem.notice).toBe("Hydrate <b>");
    expect(redeem.plainText).toContain("with ice");
    expect(redeem.amount).toBe("50 pts");
    expect(redeem.segments).toEqual([{ type: "text", text: "with ice" }]);

    const follow = chatFromFollow(
      { event: { user_id: "9", user_login: "ace", user_name: "Ace", followed_at: "2026-11-23T18:00:00.000Z", broadcaster_user_login: "examplechannel" } },
      "examplechannel",
      now,
    );
    expect(follow?.noticeKind).toBe("follow");
    expect(follow?.deskOnly).toBe(true);

    const streak = chatFromNotification(
      {
        metadata: { message_id: "streak-1", message_timestamp: "2026-11-23T18:00:00.000Z" },
        payload: {
          event: {
            notice_type: "watch_streak",
            message_id: "streak-1",
            chatter_user_id: "9",
            chatter_user_login: "ace",
            chatter_user_name: "Ace",
            system_message: "Ace watched 5 streams in a row",
            watch_streak: { streak_count: 5, channel_points_awarded: 250 },
            message: { text: "", fragments: [] },
          },
        },
      },
      "examplechannel",
      now,
    );
    expect(streak).toMatchObject({ id: "streak-1", noticeKind: "watch-streak", amount: "250 pts" });

    const anniversary = chatFromNotification(
      {
        payload: {
          event: {
            notice_type: "shared_chat_modiversary",
            message_id: "mod-1",
            chatter_user_login: "ace",
            chatter_user_name: "Ace",
            source_broadcaster_user_name: "Other",
            shared_chat_modiversary: { months: 12 },
            message: { text: "", fragments: [] },
          },
        },
      },
      "examplechannel",
      now,
    );
    expect(anniversary?.noticeKind).toBe("mod-anniversary");
    expect(anniversary?.notice).toContain("shared from Other");
    expect(chatFromNotification({ payload: { event: { notice_type: "charity_donation", system_message: "donated" } } }, "examplechannel")).toBeNull();
  });

  it("parses channel.moderate v2 timeout, delete, warn, and mode changes", () => {
    const timeout = modActionFromModerate(
      {
        metadata: { message_id: "m-1", message_timestamp: "2026-11-23T18:00:00.000Z" },
        payload: {
          event: {
            broadcaster_user_login: "examplechannel",
            moderator_user_name: "Cool Mod",
            action: "timeout",
            timeout: {
              user_login: "troll",
              user_name: "Troll",
              reason: "spam",
              expires_at: "2026-11-23T18:10:00.000Z",
            },
          },
        },
      },
      now,
    );
    expect(timeout).toMatchObject({
      id: "mod-m-1",
      action: "timeout",
      actor: "Cool Mod",
      target: "Troll",
      durationSeconds: 600,
      reason: "spam",
    });
    expect(timeout?.summary).toContain("timed out Troll for 10m");
    expect(timeout?.summary).toContain("spam");

    const deleted = modActionFromModerate(
      {
        metadata: { message_id: "m-2" },
        payload: {
          event: {
            moderator_user_name: "Cool Mod",
            action: "delete",
            delete: { user_name: "Troll", message_id: "msg", message_body: "<script>alert(1)</script> hi" },
          },
        },
      },
      now,
    );
    expect(deleted?.action).toBe("delete");
    expect(deleted?.summary).toContain("<script>alert(1)</script> hi");

    const warn = modActionFromModerate(
      {
        metadata: { message_id: "m-3" },
        payload: { event: { moderator_user_name: "Cool Mod", action: "warn", warn: { user_name: "Troll", reason: "be kind", chat_rules_cited: ["no slurs"] } } },
      },
      now,
    );
    expect(warn?.summary).toContain("warned Troll");
    expect(warn?.summary).toContain("no slurs");

    const slow = modActionFromModerate(
      { metadata: { message_id: "m-4" }, payload: { event: { moderator_user_name: "Cool Mod", action: "slow", slow: { wait_time_seconds: 5 } } } },
      now,
    );
    expect(slow?.action).toBe("mode");
    expect(slow?.summary).toContain("Slow mode on (5s)");

    expect(modActionFromModerate({ payload: { event: { action: "vip", vip: { user_name: "Ace" } } } }, now)).toBeNull();
  });
});

describe("notice toggles", () => {
  it("defaults on, persists an off switch, and ignores unknown keys", () => {
    const defaults = defaultFeed();
    expect(defaults.emotes).toEqual({ bttv: true, ffz: true, seventv: true });
    expect(defaults.modLog).toBe(true);
    expect(noticeEnabled(defaults, "watch-streak")).toBe(true);
    const next = mergeFeed(defaults, { notices: { cheer: false, notARealOne: false }, emotes: { bttv: false }, modLog: false });
    expect(next.notices.cheer).toBe(false);
    expect(next.notices.sub).toBe(true);
    expect(next.emotes.bttv).toBe(false);
    expect(next.emotes.ffz).toBe(true);
    expect(next.modLog).toBe(false);
    expect("notARealOne" in next.notices).toBe(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-feed-"));
    const store = new SettingsStore(dir);
    store.update({ feed: next });
    expect(store.load().feed.notices.cheer).toBe(false);
    expect(store.load().feed.emotes.bttv).toBe(false);
    expect(noticeDedupeKey({ ...chat(), noticeKind: "sub", notice: "Ace subscribed" })).toBe("sub|ace|ace subscribed");
    expect(noticeDedupeKey({ ...chat(), noticeKind: "cheer" })).toBeNull();
  });
});

describe("overlay privacy", () => {
  it("drops desk-only lines and refuses emote urls outside the allowlist", () => {
    const lines = projectChatOverlay(
      [
        chat({ id: "chat", plainText: "hello" }),
        chat({ id: "redeem", plainText: "secret input", deskOnly: true, noticeKind: "redemption" }),
      ],
      style(),
      1_700_000_000_000,
    );
    expect(lines.map((line) => line.id)).toEqual(["chat"]);
    const emote = projectChatOverlay(
      [
        chat({
          id: "emote",
          plainText: "nope",
          segments: [
            { type: "emote", text: "<b>", url: "https://evil.example/x.png", source: "twitch" },
            { type: "emote", text: "Kappa", url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0", source: "twitch" },
          ],
        }),
      ],
      style(),
      1_700_000_000_000,
      undefined,
      () => "http://169.254.1.1/emote/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(emote[0]?.parts[0]).toMatchObject({ type: "text", text: "<b>" });
    expect(emote[0]?.parts[1]).toMatchObject({ type: "text" });
    expect(overlayEmoteAllowed("http://127.0.0.1:4777/emote/" + "ab".repeat(32))).toBe(true);
  });
});

describe("youtube alerts and viewers", () => {
  it("reads gifted memberships, milestones, sticker kind, mod deletes, and live viewer count", () => {
    const parsed = parseLiveChatResponse({
      continuationContents: {
        liveChatContinuation: {
          continuations: [{ timedContinuationData: { continuation: "NEXT", timeoutMs: 1000 } }],
          actions: [
            {
              addChatItemAction: {
                item: {
                  liveChatSponsorshipsGiftPurchaseAnnouncementRenderer: {
                    id: "gift-1",
                    timestampUsec: "1700000000000000",
                    authorName: { simpleText: "Gifter" },
                    header: { liveChatSponsorshipsHeaderRenderer: { primaryText: { simpleText: "Gifter gifted 5 memberships" } } },
                  },
                },
              },
            },
            {
              addChatItemAction: {
                item: {
                  liveChatViewerEngagementMessageRenderer: {
                    id: "mile-1",
                    timestampUsec: "1700000001000000",
                    authorName: { simpleText: "YouTube" },
                    message: { runs: [{ text: "NightOwl has been a member for 12 months" }] },
                  },
                },
              },
            },
            {
              addChatItemAction: {
                item: {
                  liveChatPaidStickerRenderer: {
                    id: "stick-1",
                    timestampUsec: "1700000002000000",
                    authorName: { simpleText: "Fan" },
                    purchaseAmountText: { simpleText: "$2.00" },
                  },
                },
              },
            },
            { markChatItemAsDeletedAction: { targetItemId: "stick-1" } },
            {
              addBannerToLiveChatCommand: {
                bannerRenderer: {
                  liveChatBannerRenderer: {
                    header: { liveChatBannerHeaderRenderer: { text: { simpleText: "Troll was banned from the chat" } } },
                  },
                },
              },
            },
          ],
        },
      },
    });
    expect(parsed.messages.map((message) => message.noticeKind)).toEqual(["gifted-membership", "milestone", "supersticker"]);
    expect(parsed.messages[0]?.notice).toBe("Gifter gifted 5 memberships");
    expect(parsed.messages[1]?.plainText).toContain("12 months");
    expect(parsed.modActions.map((action) => action.action)).toEqual(["delete", "ban"]);
    expect(parsed.modActions[0]?.actor).toBe("");
    expect(parsed.modActions[1]?.summary).toContain("banned");
    expect(readConcurrentViewers({ videoDetails: { isLive: true, viewCount: "1234" } })).toBe(1234);
    expect(readConcurrentViewers({ videoDetails: { isLive: true, viewCount: "1,234" } })).toBe(1234);
    expect(readConcurrentViewers({ videoDetails: { isLive: false, viewCount: "99999" } })).toBeNull();
  });
});

function chat(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: patch.id ?? "m",
    platform: "twitch",
    channel: "examplechannel",
    username: "ace",
    displayName: "Ace",
    color: "#bf94ff",
    badges: [],
    segments: patch.segments ?? [{ type: "text", text: patch.plainText ?? "hi" }],
    plainText: patch.plainText ?? "hi",
    timestamp: 1_700_000_000_000,
    kind: "chat",
    ...patch,
  };
}

function style(): ChatOverlayStyle {
  return defaultChatOverlayFile().presets[0]!;
}
