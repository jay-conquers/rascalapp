import { describe, expect, it } from "vitest";
import { decideChat, defaultBotFile, emptyMemory, type BotCommand } from "../packages/bot/src/model";
import { YoutubeChatPlatform } from "../packages/bot/src/platform/youtube-adapter";
import { normalizeYoutubeReaderMessage } from "../src/shared/platform/normalize";
import { nextPollDelayMs } from "../src/shared/platform/youtube-quota";
import {
  YOUTUBE_READER_FAILURES_BEFORE_API,
  YOUTUBEI_POLL_DEFAULT_MS,
  describeYoutubeQuota,
  nextYoutubeiPressure,
  pollGapLatencyMs,
  shouldUseYoutubeApiPoll,
  youtubeStreamUnits,
  youtubeiPollTargetMs,
  youtubeiWaitMs,
} from "../src/shared/platform/youtubei";

const facts = { title: "Ranked", game: "Valorant", uptime: "2h", followage: "" };

describe("youtube page reader pace", () => {
  it("polls about every 1.5s instead of a longer YouTube timeout, and never faster than 1s", () => {
    expect(youtubeiPollTargetMs()).toBe(YOUTUBEI_POLL_DEFAULT_MS);
    expect(youtubeiPollTargetMs(undefined, "900")).toBe(1_000);
    expect(youtubeiPollTargetMs(2_000)).toBe(2_000);
    expect(youtubeiWaitMs({ suggestedMs: 5_000, pressure: 0 })).toBe(1_500);
    expect(youtubeiWaitMs({ suggestedMs: 5_000, pressure: 1 })).toBe(5_000);
    const afterLimit = nextYoutubeiPressure(0, "rate-limit");
    expect(afterLimit).toBe(1);
    expect(youtubeiWaitMs({ suggestedMs: 5_000, pressure: afterLimit })).toBe(5_000);
    const eased = nextYoutubeiPressure(nextYoutubeiPressure(nextYoutubeiPressure(1, "ok"), "ok"), "ok");
    expect(eased).toBe(0);
    expect(youtubeiWaitMs({ suggestedMs: 5_000, pressure: eased })).toBe(1_500);
  });

  it("measures the gap before and after for a 5 second YouTube timeout", () => {
    const before = pollGapLatencyMs(5_000);
    const after = pollGapLatencyMs(YOUTUBEI_POLL_DEFAULT_MS);
    expect(before).toEqual({ meanMs: 2_500, maxMs: 5_000 });
    expect(after).toEqual({ meanMs: 750, maxMs: 1_500 });
    expect(after.maxMs).toBeLessThan(before.meanMs);
  });

  it("does not speed up the Data API poll", () => {
    expect(nextPollDelayMs({ pollingIntervalMillis: 5_000, consecutiveErrors: 0, quotaExceeded: false, unitsRemaining: 10_000 })).toBe(5_000);
  });
});

describe("reader messages drive the bot", () => {
  it("keeps the message id and author channel id and answers a YouTube command", async () => {
    const line = normalizeYoutubeReaderMessage({
      id: "yt-msg-1",
      authorId: "UCviewer0000000000000001",
      username: "NightOwl",
      displayName: "NightOwl",
      plainText: "!so",
      timestamp: 1_700_000_000_000,
      badges: [{ kind: "mod" }],
      channel: "UCchannel00000000000000001",
    });
    expect(line?.messageId).toBe("yt-msg-1");
    expect(line?.user.id).toBe("UCviewer0000000000000001");
    expect(line?.user.roles).toContain("mod");
    const command: BotCommand = {
      id: "so",
      name: "so",
      response: "hello {user}",
      enabled: true,
      cooldownSec: 0,
      userCooldownSec: 0,
      level: "everyone",
      aliases: [],
      count: 0,
      platforms: "youtube",
    };
    const heard: { id: string; author: string; say: string[] }[] = [];
    let fetches = 0;
    const platform = new YoutubeChatPlatform({
      ownReader: false,
      hasToken: () => true,
      optIn: () => false,
      accessToken: async () => "token",
      channelId: () => "UCchannel00000000000000001",
      fetchImpl: async () => {
        fetches += 1;
        return new Response("{}", { status: 500 });
      },
      discoverVideo: async () => null,
      log: () => undefined,
    });
    platform.onMessage((message) => {
      const decision = decideChat({ ...defaultBotFile(), commands: [command] }, emptyMemory(), {
        messageId: message.messageId,
        userId: message.user.id,
        login: message.user.login,
        displayName: message.user.displayName,
        text: message.text,
        roles: message.user.roles,
      }, 1_000, facts, "bot-channel", "youtube");
      heard.push({ id: message.messageId, author: message.user.id, say: decision.say });
    });
    if (!line) throw new Error("missing line");
    platform.ingest(line);
    platform.ingest(line);
    expect(fetches).toBe(0);
    expect(heard).toEqual([{ id: "yt-msg-1", author: "UCviewer0000000000000001", say: ["hello NightOwl"] }]);
    await platform.disconnect();
  });
});

describe("data api fallback", () => {
  it("stays off until the page reader fails repeatedly, and can be opted in", async () => {
    expect(shouldUseYoutubeApiPoll({ optIn: false, consecutiveReaderFailures: YOUTUBE_READER_FAILURES_BEFORE_API - 1 })).toBe(false);
    expect(shouldUseYoutubeApiPoll({ optIn: false, consecutiveReaderFailures: YOUTUBE_READER_FAILURES_BEFORE_API })).toBe(true);
    expect(shouldUseYoutubeApiPoll({ optIn: true, consecutiveReaderFailures: 0 })).toBe(true);

    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/liveBroadcasts")) {
        return json({ items: [{ id: "videoid12345", snippet: { title: "Live", liveChatId: "chat-1" } }] });
      }
      if (url.includes("/liveChat/messages")) {
        return json({ pollingIntervalMillis: 5_000, nextPageToken: "next", items: [] });
      }
      return json({});
    };
    const quiet = platform(fetchImpl, () => false);
    quiet.noteReader(false);
    quiet.noteReader(false);
    await delay(40);
    expect(calls.some((url) => url.includes("/liveChat/messages"))).toBe(false);
    quiet.noteReader(false);
    await delay(40);
    expect(calls.some((url) => url.includes("/liveChat/messages"))).toBe(true);
    await quiet.disconnect();

    const opted: string[] = [];
    const optedPlatform = platform(async (input) => {
      opted.push(String(input));
      if (String(input).includes("/liveBroadcasts")) {
        return json({ items: [{ id: "videoid12345", snippet: { title: "Live", liveChatId: "chat-2" } }] });
      }
      return json({ pollingIntervalMillis: 5_000, nextPageToken: "next", items: [] });
    }, () => true);
    await optedPlatform.connect();
    await delay(40);
    expect(opted.some((url) => url.includes("/liveChat/messages"))).toBe(true);
    await optedPlatform.disconnect();
  });

  it("prices a 5 hour stream from replies instead of a poll loop", () => {
    expect(youtubeStreamUnits({ hours: 5, replies: 30 })).toEqual({ units: 601, polls: 0 });
    expect(youtubeStreamUnits({ hours: 5, replies: 30, apiPoll: true, pollIntervalMs: 5_000 }).polls).toBe(3_600);
    expect(youtubeStreamUnits({ hours: 5, replies: 30, apiPoll: true, pollIntervalMs: 5_000 }).units).toBe(601 + 18_000);
    expect(describeYoutubeQuota({ apiPoll: false, fallback: false, replies: 30, usedUnits: 601 })).toContain("601");
    expect(describeYoutubeQuota({ apiPoll: false, fallback: false, replies: 30, usedUnits: 601 })).toContain("18,601");
  });
});

function platform(fetchImpl: typeof fetch, optIn: () => boolean): YoutubeChatPlatform {
  return new YoutubeChatPlatform({
    ownReader: false,
    hasToken: () => true,
    optIn,
    accessToken: async () => "token",
    channelId: () => "UCchannel00000000000000001",
    fetchImpl,
    discoverVideo: async () => null,
    log: () => undefined,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
