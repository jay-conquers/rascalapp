import { describe, expect, it } from "vitest";
import { decideChat, defaultBotFile, emptyMemory, normalizeBotFile, type BotCommand, type BotFile } from "../packages/bot/src/model";
import { normalizeTwitchChatFields, normalizeYoutubeLiveChatItem } from "../src/shared/platform/normalize";
import { PlatformRegistry } from "../src/shared/platform/registry";
import type { ChatPlatform, PlatformLiveStatus } from "../src/shared/platform/types";
import { YoutubeApiError, YoutubeDataApi, isQuotaError } from "../src/shared/platform/youtube-api";
import { YOUTUBE_QUOTA_COSTS, YoutubeQuotaMeter, nextPollDelayMs, youtubeMessagesPerDay, youtubePollsPerDay } from "../src/shared/platform/youtube-quota";

const facts = { title: "Ranked", game: "Valorant", uptime: "2h", followage: "400d" };

function command(name: string, platforms: BotCommand["platforms"]): BotCommand {
  return {
    id: name,
    name,
    response: `${name} for {user}`,
    enabled: true,
    cooldownSec: 0,
    userCooldownSec: 0,
    level: "everyone",
    aliases: [],
    count: 0,
    platforms,
  };
}

function file(commands: BotCommand[]): BotFile {
  return { ...defaultBotFile(), commands };
}

function line(text: string) {
  return { messageId: "m1", userId: "7", login: "ace", displayName: "Ace", text, roles: ["everyone" as const] };
}

describe("platform registry", () => {
  it("registers, lists, and rejects a duplicate id", () => {
    const registry = new PlatformRegistry();
    const twitch = fakePlatform("twitch");
    const youtube = fakePlatform("youtube");
    registry.register(twitch);
    registry.register(youtube);
    expect(registry.list().map((platform) => platform.id)).toEqual(["twitch", "youtube"]);
    expect(registry.get("youtube")).toBe(youtube);
    expect(registry.has("kick")).toBe(false);
    expect(() => registry.register(fakePlatform("twitch"))).toThrow(/already registered/);
    registry.unregister("youtube");
    expect(registry.get("youtube")).toBeUndefined();
  });
});

describe("message normalization", () => {
  it("maps YouTube owner, member, and moderator badges onto shared roles", () => {
    const message = normalizeYoutubeLiveChatItem({
      id: "msg-1",
      snippet: {
        type: "textMessageEvent",
        liveChatId: "chat-1",
        publishedAt: "2026-01-01T00:00:00.000Z",
        displayMessage: "hello chat",
      },
      authorDetails: {
        channelId: "UCexamplechannelid0000001",
        displayName: "Ace Example",
        isChatOwner: true,
        isChatModerator: true,
        isChatSponsor: true,
        isVerified: true,
      },
    });
    expect(message).toMatchObject({
      platform: "youtube",
      messageId: "msg-1",
      channelId: "chat-1",
      text: "hello chat",
      user: {
        id: "UCexamplechannelid0000001",
        login: "aceexample",
        displayName: "Ace Example",
      },
    });
    expect(message?.user.roles).toEqual(["everyone", "sub", "mod", "broadcaster"]);
    expect(message?.user.badges.map((badge) => badge.id)).toEqual(["member", "moderator", "owner", "verified"]);
  });

  it("maps a Twitch chat line onto the same shape", () => {
    const message = normalizeTwitchChatFields({
      messageId: "m1",
      channelId: "42",
      text: "hello",
      userId: "7",
      login: "ace",
      displayName: "Ace",
      roles: ["everyone", "mod"],
      publishedAt: 10,
    });
    expect(message.platform).toBe("twitch");
    expect(message.user.roles).toContain("mod");
    expect(message.user.badges.map((badge) => badge.label)).toEqual(["Moderator"]);
    expect(message.channelId).toBe("42");
  });
});

describe("command dispatch across platforms", () => {
  it("keeps an untitled command on Twitch and runs a YouTube or all command on the matching chat", () => {
    const data = file([command("so", "twitch"), command("yt", "youtube"), command("both", "all")]);
    const memory = emptyMemory();
    expect(decideChat(data, memory, line("!so"), 1_000, facts, "bot").say).toEqual(["so for Ace"]);
    expect(decideChat(data, memory, line("!so"), 1_000, facts, "bot", "youtube").say).toEqual([]);
    expect(decideChat(data, memory, line("!yt"), 1_000, facts, "bot").say).toEqual([]);
    expect(decideChat(data, memory, line("!yt"), 1_000, facts, "bot", "youtube").say).toEqual(["yt for Ace"]);
    expect(decideChat(data, memory, line("!both"), 1_000, facts, "bot").say[0]).toContain("both for Ace");
    expect(decideChat(data, emptyMemory(), line("!both"), 1_000, facts, "bot", "youtube").say[0]).toContain("both for Ace");
  });

  it("keeps an older command file on Twitch", () => {
    const loaded = normalizeBotFile({
      commands: [{ name: "so", response: "hi" }],
      timers: [{ name: "plug", message: "hey", intervalSec: 30 }],
    });
    expect(loaded.commands[0]?.platforms).toBe("twitch");
    expect(loaded.timers[0]?.platforms).toBe("twitch");
    expect(loaded.filters.platforms).toBe("twitch");
    expect(loaded.accounts).toEqual({ twitch: "bot", youtube: "bot" });
    expect(loaded.youtubeApiPoll).toBe(false);
  });

  it("does not let a YouTube cooldown block the same command on Twitch", () => {
    const data = file([{ ...command("both", "all"), cooldownSec: 30 }]);
    const memory = emptyMemory();
    expect(decideChat(data, memory, line("!both"), 1_000, facts, "bot", "youtube").say).toHaveLength(1);
    expect(decideChat(data, memory, line("!both"), 2_000, facts, "bot", "youtube").say).toEqual([]);
    expect(decideChat(data, memory, line("!both"), 2_000, facts, "bot", "twitch").say).toHaveLength(1);
  });
});

describe("youtube polling backoff", () => {
  it("waits for pollingIntervalMillis, stretches on errors, and pauses when quota is gone", () => {
    expect(nextPollDelayMs({ pollingIntervalMillis: 5000, consecutiveErrors: 0, quotaExceeded: false, unitsRemaining: 10_000 })).toBe(5000);
    expect(nextPollDelayMs({ pollingIntervalMillis: 8000, consecutiveErrors: 0, quotaExceeded: false, unitsRemaining: 10_000 })).toBe(8000);
    expect(nextPollDelayMs({ pollingIntervalMillis: 100, consecutiveErrors: 0, quotaExceeded: false, unitsRemaining: 10_000 })).toBe(1000);
    expect(nextPollDelayMs({ pollingIntervalMillis: 5000, consecutiveErrors: 2, quotaExceeded: false, unitsRemaining: 10_000 })).toBe(20_000);
    expect(nextPollDelayMs({ pollingIntervalMillis: 5000, consecutiveErrors: 1, quotaExceeded: true, unitsRemaining: 0 })).toBe(15 * 60_000);
    expect(nextPollDelayMs({ pollingIntervalMillis: 5000, consecutiveErrors: 0, quotaExceeded: false, unitsRemaining: 20 })).toBeGreaterThanOrEqual(60_000);
    const meter = new YoutubeQuotaMeter();
    meter.add(YOUTUBE_QUOTA_COSTS.liveChatMessagesList);
    meter.success(6000);
    expect(meter.snapshot().state).toBe("ok");
    meter.fail(true);
    expect(meter.snapshot().state).toBe("exhausted");
    expect(meter.delay()).toBe(15 * 60_000);
  });

  it("states the default daily quota in polls and messages", () => {
    expect(youtubePollsPerDay()).toBe(2_000);
    expect(youtubeMessagesPerDay()).toBe(500);
    expect(YOUTUBE_QUOTA_COSTS.liveChatBansInsert).toBe(200);
    expect(YOUTUBE_QUOTA_COSTS.liveChatMessagesDelete).toBe(20);
  });
});

describe("mocked youtube api", () => {
  it("reads the active broadcast, normalizes chat, and sends, deletes, and bans", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ url, method, body });
      if (url.includes("/liveBroadcasts")) {
        return json({
          items: [{ id: "videoid123", snippet: { title: "Example live", liveChatId: "chat-9" }, status: { lifeCycleStatus: "live" } }],
        });
      }
      if (url.includes("/liveChat/messages") && method === "GET") {
        return json({
          pollingIntervalMillis: 7500,
          nextPageToken: "next-1",
          items: [
            {
              id: "m-9",
              snippet: { type: "textMessageEvent", liveChatId: "chat-9", displayMessage: "!so" },
              authorDetails: { channelId: "UCviewer00000000000000001", displayName: "Viewer", isChatModerator: false },
            },
          ],
        });
      }
      if (url.includes("/liveChat/messages") && method === "POST") return json({ id: "sent" });
      if (url.includes("/liveChat/messages") && method === "DELETE") return json({});
      if (url.includes("/liveChat/bans") && method === "POST") return json({ id: "ban-1" });
      if (url.includes("/channels")) return json({ items: [{ id: "UCbroadcaster000000000001", snippet: { title: "Example channel" } }] });
      return json({}, 404);
    };
    const meter = new YoutubeQuotaMeter();
    const api = new YoutubeDataApi({ token: async () => "token-not-logged", fetchImpl, meter });
    const broadcast = await api.listActiveBroadcast();
    expect(broadcast).toEqual({ videoId: "videoid123", title: "Example live", liveChatId: "chat-9" });
    const page = await api.listMessages("chat-9", "");
    expect(page.pollingIntervalMillis).toBe(7500);
    expect(page.messages[0]?.text).toBe("!so");
    expect(page.messages[0]?.user.login).toBe("viewer");
    await api.insertMessage("chat-9", "hello there");
    await api.deleteMessage("m-9");
    const banId = await api.banUser("chat-9", "UCviewer00000000000000001", 30);
    expect(banId).toBe("ban-1");
    const identity = await api.myChannel();
    expect(identity).toEqual({ channelId: "UCbroadcaster000000000001", title: "Example channel" });
    expect(meter.usedUnits).toBe(
      YOUTUBE_QUOTA_COSTS.liveBroadcastsList +
        YOUTUBE_QUOTA_COSTS.liveChatMessagesList +
        YOUTUBE_QUOTA_COSTS.liveChatMessagesInsert +
        YOUTUBE_QUOTA_COSTS.liveChatMessagesDelete +
        YOUTUBE_QUOTA_COSTS.liveChatBansInsert +
        YOUTUBE_QUOTA_COSTS.channelsList,
    );
    const insert = calls.find((call) => call.method === "POST" && call.url.includes("/liveChat/messages"));
    expect(insert?.body).toContain("hello there");
    expect(JSON.stringify(calls)).not.toContain("token-not-logged");
  });

  it("treats quotaExceeded as a pause, not a token problem", async () => {
    const fetchImpl: typeof fetch = async () => json({ error: { errors: [{ reason: "quotaExceeded" }], message: "quota" } }, 403);
    const api = new YoutubeDataApi({ token: async () => "secret-token", fetchImpl, meter: new YoutubeQuotaMeter() });
    await expect(api.listMessages("chat", "")).rejects.toBeInstanceOf(YoutubeApiError);
    try {
      await api.listMessages("chat", "");
    } catch (err) {
      expect(isQuotaError(err)).toBe(true);
      expect(err instanceof Error ? err.message : "").not.toContain("secret-token");
      expect(String(err)).toMatch(/quota/i);
    }
  });
});

function fakePlatform(id: string): ChatPlatform {
  const status: PlatformLiveStatus = { connected: false, live: false, detail: id };
  return {
    id,
    label: id,
    capabilities: { send: true, deleteMessage: true, timeout: true, ban: true, unban: true },
    connect: async () => undefined,
    disconnect: async () => undefined,
    liveStatus: () => status,
    sendMessage: async () => undefined,
    deleteMessage: async () => undefined,
    timeoutUser: async () => undefined,
    banUser: async () => undefined,
    unbanUser: async () => undefined,
    lookupUser: async () => null,
    onMessage: () => () => undefined,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
