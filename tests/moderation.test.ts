import { describe, expect, it } from "vitest";
import { NOTICE_KINDS } from "../src/shared/feed-toggles";
import {
  TIMEOUT_PRESETS,
  describeDeskMod,
  deletableMessageId,
  moderationOffer,
  parseModerationCommand,
  parseTimeoutDuration,
  youtubeModLogConnected,
  type ModerationContext,
  type ModerationSubject,
} from "../src/shared/moderation";
import { REQUIRED_SCOPES, missingScopes, twitchLoginMissesReadScopes } from "../src/shared/scopes";

const viewer: ModerationSubject = {
  platform: "twitch",
  id: "11111111-1111-1111-1111-111111111111",
  username: "viewer",
  displayName: "Viewer",
  authorId: "99",
  badges: [],
};

function ctx(patch: Partial<ModerationContext> = {}): ModerationContext {
  return {
    twitch: {
      loggedIn: true,
      scopes: [...REQUIRED_SCOPES],
      login: "examplechannel",
      userId: "42",
      channelLogin: "examplechannel",
      broadcasterId: "42",
      ...patch.twitch,
    },
    youtube: {
      canModerate: false,
      live: false,
      channelId: "",
      accountChannelId: null,
      ...patch.youtube,
    },
  };
}

describe("scope detection", () => {
  it("flags the new moderation and chatter scopes until a token includes them", () => {
    expect(REQUIRED_SCOPES).toEqual(
      expect.arrayContaining([
        "moderator:manage:chat_messages",
        "moderator:manage:banned_users",
        "moderator:read:chatters",
      ]),
    );
    const previous = REQUIRED_SCOPES.filter(
      (scope) =>
        scope !== "moderator:manage:chat_messages" &&
        scope !== "moderator:manage:banned_users" &&
        scope !== "moderator:read:chatters",
    );
    expect(missingScopes(previous)).toEqual([
      "moderator:read:chatters",
      "moderator:manage:chat_messages",
      "moderator:manage:banned_users",
    ]);
    expect(missingScopes(REQUIRED_SCOPES)).toEqual([]);
    expect(twitchLoginMissesReadScopes({ loggedIn: false, missingScopes: ["moderator:read:chat_messages"] })).toBe(false);
    expect(twitchLoginMissesReadScopes({ loggedIn: true, missingScopes: ["moderator:read:banned_users"] })).toBe(true);
    expect(twitchLoginMissesReadScopes({ loggedIn: true, missingScopes: ["moderator:manage:banned_users"] })).toBe(false);
    expect(twitchLoginMissesReadScopes({ loggedIn: true, missingScopes: [] })).toBe(false);
  });
});

describe("timeout parsing", () => {
  it("accepts the presets and written durations, and rejects anything past 14 days", () => {
    expect(TIMEOUT_PRESETS.map((preset) => preset.seconds)).toEqual([60, 600, 3600, 86_400]);
    expect(parseTimeoutDuration("90")).toBe(90);
    expect(parseTimeoutDuration("90s")).toBe(90);
    expect(parseTimeoutDuration("10 min")).toBe(600);
    expect(parseTimeoutDuration("1 hour")).toBe(3600);
    expect(parseTimeoutDuration("24 hours")).toBe(86_400);
    expect(parseTimeoutDuration("2d")).toBe(172_800);
    expect(parseTimeoutDuration("15d")).toBeNull();
    expect(parseTimeoutDuration("0")).toBeNull();
    expect(parseTimeoutDuration("")).toBeNull();
    expect(parseTimeoutDuration("1.5m")).toBeNull();
    expect(parseModerationCommand({ action: "timeout", messageId: "m", seconds: "5m" })).toEqual({
      action: "timeout",
      messageId: "m",
      seconds: 300,
    });
    expect(() => parseModerationCommand({ action: "timeout", messageId: "m", seconds: 0 })).toThrow(/14 days/);
    expect(() => parseModerationCommand({ action: "clear", messageId: "m" })).toThrow(/not supported/);
  });
});

describe("moderation offer", () => {
  it("disables actions the login cannot perform and never offers the broadcaster", () => {
    const ready = moderationOffer(viewer, ctx());
    expect(ready.delete.enabled).toBe(true);
    expect(ready.timeout.enabled).toBe(true);
    expect(ready.ban.enabled).toBe(true);
    expect(ready.unban.enabled).toBe(true);

    const unread = moderationOffer(viewer, ctx({ twitch: { ...ctx().twitch, scopes: ["chat:read"] } }));
    expect(unread.delete.enabled).toBe(false);
    expect(unread.delete.reason).toContain("moderator:manage:chat_messages");
    expect(unread.ban.enabled).toBe(false);
    expect(unread.ban.reason).toContain("moderator:manage:banned_users");
    expect(unread.timeout.enabled).toBe(false);

    const loggedOut = moderationOffer(viewer, ctx({ twitch: { ...ctx().twitch, loggedIn: false, scopes: [] } }));
    expect(loggedOut.delete.reason).toMatch(/Log in with Twitch/);

    const broadcaster = moderationOffer({ ...viewer, username: "examplechannel", authorId: "42", badges: [{ kind: "broadcaster" }] }, ctx());
    expect(broadcaster.ban.enabled).toBe(false);
    expect(broadcaster.delete.enabled).toBe(false);
    expect(broadcaster.ban.reason).toMatch(/broadcaster/);

    const byLogin = moderationOffer({ ...viewer, username: "ExampleChannel", authorId: "100" }, ctx());
    expect(byLogin.timeout.enabled).toBe(false);

    expect(deletableMessageId("twitch", viewer.id)).toBe(true);
    expect(deletableMessageId("twitch", "redeem-1")).toBe(false);
    expect(moderationOffer({ ...viewer, id: "redeem-1" }, ctx()).delete.enabled).toBe(false);
    expect(moderationOffer({ ...viewer, authorId: undefined }, ctx()).timeout.enabled).toBe(false);
  });

  it("uses the YouTube account only when that chat is live", () => {
    const message: ModerationSubject = {
      platform: "youtube",
      id: "LCC.Emessage01",
      username: "Viewer",
      displayName: "Viewer",
      authorId: "UCviewer00000000000000001",
      badges: [],
    };
    const offline = moderationOffer(message, ctx({ youtube: { canModerate: true, live: false, channelId: "UCbroadcaster000000000001", accountChannelId: "UCbroadcaster000000000001" } }));
    expect(offline.delete.reason).toMatch(/not live/);
    const live = moderationOffer(message, ctx({ youtube: { canModerate: true, live: true, channelId: "UCbroadcaster000000000001", accountChannelId: "UCmod0000000000000000001" } }));
    expect(live.delete.enabled).toBe(true);
    expect(live.timeout.enabled).toBe(true);
    const owner = moderationOffer(
      { ...message, authorId: "UCbroadcaster000000000001", badges: [{ kind: "owner" }] },
      ctx({ youtube: { canModerate: true, live: true, channelId: "UCbroadcaster000000000001", accountChannelId: "UCbroadcaster000000000001" } }),
    );
    expect(owner.ban.enabled).toBe(false);
    const disconnected = moderationOffer(message, ctx());
    expect(disconnected.delete.reason).toMatch(/Connect a YouTube account/);
  });

  it("writes who, what, target, duration, and platform into the mod log summary", () => {
    expect(
      describeDeskMod({ platform: "twitch", actor: "Example", target: "Viewer", action: "timeout", durationSeconds: 600 }),
    ).toBe("Example timed out Viewer for 10m on Twitch.");
    expect(describeDeskMod({ platform: "youtube", actor: "Example", target: "Viewer", action: "ban", durationSeconds: null })).toBe(
      "Example banned Viewer on YouTube.",
    );
    expect(describeDeskMod({ platform: "twitch", actor: "Example", target: "Viewer", action: "delete", durationSeconds: null })).toContain(
      "deleted a message from Viewer",
    );
    expect(describeDeskMod({ platform: "youtube", actor: "Example", target: "Viewer", action: "unban", durationSeconds: null })).toContain(
      "unbanned Viewer on YouTube",
    );
  });
});

describe("mod log hints", () => {
  it("shows the YouTube note only while that chat is connected", () => {
    expect(youtubeModLogConnected("live")).toBe(true);
    expect(youtubeModLogConnected("reconnecting")).toBe(true);
    expect(youtubeModLogConnected("idle")).toBe(false);
    expect(youtubeModLogConnected("offline")).toBe(false);
    expect(NOTICE_KINDS.length).toBeGreaterThan(0);
  });
});
