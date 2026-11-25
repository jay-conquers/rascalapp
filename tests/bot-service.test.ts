import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSocket } from "./helpers/fake-socket";
import { bodyOf, json, settle, until } from "./helpers/fetch-router";
import {
  BOT_LOGIN,
  BOT_USER_ID,
  BotService,
  BotStore,
  BROADCASTER_ID,
  CHANNEL,
  CLIENT_ID,
  YT_BOT_CHANNEL,
  YT_CHANNEL,
  YT_CHAT,
  YT_VIDEO,
  connectTwitch,
  createBot,
  readJson,
  tempDir,
  twitchBotTokens,
  twitchChat,
  writeJson,
  youtubeMessage,
  type BotFixture,
} from "./helpers/bot";
import { expectPrivateMode } from "./expect-mode";

const fixtures: BotFixture[] = [];

function bot(options: Parameters<typeof createBot>[0] = {}): BotFixture {
  const created = createBot(options);
  fixtures.push(created);
  return created;
}

afterEach(() => {
  for (const fixture of fixtures) fixture.stop();
  fixtures.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeSocket.reset();
});

const command = (patch: Record<string, unknown>) => ({ cooldownSec: 0, userCooldownSec: 0, enabled: true, ...patch });
const ace = { login: "ace", userId: "7", name: "Ace" };
const coolmod = { login: "coolmod", userId: "8", name: "CoolMod", badges: ["moderator"] };
const troll = { login: "troll", userId: "666", name: "Troll" };

describe("twitch chat through the bot", () => {
  it("subscribes to chat as the bot account and answers a command with live channel facts", async () => {
    const fixture = bot({ config: { commands: [command({ name: "hello", response: "Hi {user}, {count} uses, playing {game}" })] } });
    const socket = await connectTwitch(fixture);
    await until(() => fixture.sent("api.twitch.tv/helix/eventsub/subscriptions").length === 1, "subscription");
    const subscription = fixture.sent("api.twitch.tv/helix/eventsub/subscriptions")[0];
    expect(bodyOf(subscription)).toEqual({
      type: "channel.chat.message",
      version: "1",
      condition: { broadcaster_user_id: BROADCASTER_ID, user_id: BOT_USER_ID },
      transport: { method: "websocket", session_id: "session-1" },
    });
    expect(subscription?.headers.authorization).toBe("Bearer bot-access-TESTTOKEN");
    expect(subscription?.headers["client-id"]).toBe(CLIENT_ID);
    await until(() => fixture.service.snapshot(0).status === `Listening as ${BOT_LOGIN}.`, "listening status");

    socket.receive(twitchChat({ ...ace, text: "!hello" }));
    await until(() => fixture.twitchSays().length === 1, "reply");
    expect(fixture.twitchSays()).toEqual(["Hi Ace, 1 uses, playing Valorant"]);
    expect(bodyOf(fixture.sent("api.twitch.tv/helix/chat/messages")[0])).toEqual({
      broadcaster_id: BROADCASTER_ID,
      sender_id: BOT_USER_ID,
      message: "Hi Ace, 1 uses, playing Valorant",
    });
    expect(readJson(fixture.dir, "bot.json").commands[0].count).toBe(1);
    expect(fixture.service.snapshot(0).log).toEqual([expect.objectContaining({ action: "command", user: "ace", text: "!hello", by: "bot" })]);
    expect(fixture.service.snapshot(0)).toMatchObject({ connected: true, botLogin: BOT_LOGIN });
  });

  it("fires a keyword command inside a normal message", async () => {
    const fixture = bot({ config: { commands: [command({ name: "alot", response: "a lot*", keywords: ["alot"] })] } });
    const socket = await connectTwitch(fixture);
    socket.receive(twitchChat({ ...ace, text: "that is ALOT of damage" }));
    await until(() => fixture.twitchSays().length === 1, "keyword reply");
    expect(fixture.twitchSays()).toEqual(["a lot*"]);
    expect(fixture.service.snapshot(0).log[0]).toMatchObject({ action: "command", text: "alot" });
  });

  it("deletes a link and times the sender out", async () => {
    const fixture = bot({ config: { filters: { links: { enabled: true, action: "timeout", timeoutSec: 30 } } } });
    const socket = await connectTwitch(fixture);
    socket.receive(twitchChat({ ...troll, text: "visit https://spam.example now", messageId: "spam-1" }));
    await until(() => fixture.sent("api.twitch.tv/helix/moderation/bans", "POST").length === 1, "timeout");
    const deleted = fixture.sent("api.twitch.tv/helix/moderation/chat", "DELETE")[0];
    expect(deleted?.query.get("broadcaster_id")).toBe(BROADCASTER_ID);
    expect(deleted?.query.get("moderator_id")).toBe(BOT_USER_ID);
    expect(bodyOf(deleted)).toEqual({ message_id: "spam-1" });
    const timeout = fixture.sent("api.twitch.tv/helix/moderation/bans", "POST")[0];
    expect(bodyOf(timeout)).toEqual({ data: { user_id: "666", reason: "link", duration: 30 } });
    expect(fixture.service.snapshot(0).log[0]).toMatchObject({ action: "timeout", user: "troll", text: "link", by: "filter" });
  });

  it("bans for a blacklisted word, and lets a mod ban and unban by name", async () => {
    const fixture = bot({ config: { filters: { blacklist: [{ word: "badword", action: "ban", timeoutSec: 60 }] } } });
    const socket = await connectTwitch(fixture);
    socket.receive(twitchChat({ ...troll, text: "you BADWORD" }));
    await until(() => fixture.sent("api.twitch.tv/helix/moderation/bans", "POST").length === 1, "filter ban");
    expect(bodyOf(fixture.sent("api.twitch.tv/helix/moderation/bans", "POST")[0])).toEqual({ data: { user_id: "666", reason: "blacklist:badword" } });
    expect(fixture.sent("api.twitch.tv/helix/moderation/chat", "DELETE")).toHaveLength(1);

    socket.receive(twitchChat({ ...coolmod, text: "!ban troll" }));
    await until(() => fixture.sent("api.twitch.tv/helix/moderation/bans", "POST").length === 2, "mod ban");
    expect(bodyOf(fixture.sent("api.twitch.tv/helix/moderation/bans", "POST")[1])).toEqual({ data: { user_id: "666", reason: "Rascal bot" } });

    socket.receive(twitchChat({ ...coolmod, text: "!unban troll" }));
    await until(() => fixture.sent("api.twitch.tv/helix/moderation/bans", "DELETE").length === 1, "unban");
    const unban = fixture.sent("api.twitch.tv/helix/moderation/bans", "DELETE")[0];
    expect(unban?.query.get("user_id")).toBe("666");
    expect(unban?.query.get("moderator_id")).toBe(BOT_USER_ID);
    const log = fixture.service.snapshot(0).log;
    expect(log.map((entry) => entry.action)).toEqual(["ban", "ban", "unban"]);
    expect(log[1]).toMatchObject({ user: "troll", text: "", by: "coolmod" });

    socket.receive(twitchChat({ ...coolmod, text: "!timeout troll 30 spam" }));
    await until(() => fixture.sent("api.twitch.tv/helix/moderation/bans", "POST").length === 3, "mod timeout");
    expect(bodyOf(fixture.sent("api.twitch.tv/helix/moderation/bans", "POST")[2])).toEqual({ data: { user_id: "666", reason: "30s spam", duration: 30 } });
  });

  it("ignores a mod command from a viewer and lets a permit through the link filter", async () => {
    const fixture = bot({ config: { filters: { links: { enabled: true, action: "delete", timeoutSec: 30 } } } });
    const socket = await connectTwitch(fixture);
    socket.receive(twitchChat({ ...ace, text: "!ban troll" }));
    socket.receive(twitchChat({ ...coolmod, text: "!permit ace 30" }));
    await until(() => fixture.twitchSays().length === 1, "permit reply");
    expect(fixture.twitchSays()).toEqual(["ace can post a link for 30s."]);
    socket.receive(twitchChat({ ...ace, text: "here https://example.com" }));
    await settle(60);
    expect(fixture.sent("api.twitch.tv/helix/moderation/chat")).toEqual([]);
    expect(fixture.sent("api.twitch.tv/helix/moderation/bans")).toEqual([]);
  });

  it("adds and reads quotes and saves them to bot.json", async () => {
    const fixture = bot();
    const socket = await connectTwitch(fixture);
    socket.receive(twitchChat({ ...ace, text: "!quote add not a mod" }));
    await until(() => fixture.twitchSays().length === 1, "denied");
    socket.receive(twitchChat({ ...coolmod, text: "!quote add best stream ever" }));
    await until(() => fixture.twitchSays().length === 2, "added");
    socket.receive(twitchChat({ ...ace, text: "!quote 1" }));
    await until(() => fixture.twitchSays().length === 3, "read");
    expect(fixture.twitchSays()).toEqual(["Only a mod can change quotes.", "Added quote #1.", "Quote #1: best stream ever"]);
    expect(readJson(fixture.dir, "bot.json").quotes).toEqual([{ id: 1, text: "best stream ever", by: "coolmod", at: expect.any(Number) }]);
  });

  it("answers followage, account age, and a mod shoutout from Helix", async () => {
    const fixture = bot();
    const socket = await connectTwitch(fixture);
    socket.receive(twitchChat({ ...ace, text: "!followage" }));
    await until(() => fixture.twitchSays().length === 1, "followage");
    socket.receive(twitchChat({ ...ace, text: "!followage troll" }));
    await until(() => fixture.twitchSays().length === 2, "not following");
    socket.receive(twitchChat({ ...ace, text: "!accountage @Friend" }));
    await until(() => fixture.twitchSays().length === 3, "account age");
    socket.receive(twitchChat({ ...coolmod, text: "!so friend" }));
    await until(() => fixture.twitchSays().length === 4, "shoutout");
    const [followage, notFollowing, accountAge, shoutout] = fixture.twitchSays();
    expect(followage).toMatch(/^Ace has been following for \d+ years?( and \d+ months?)?\.$/);
    expect(notFollowing).toBe("Troll is not following.");
    expect(accountAge).toMatch(/^Friend's account is \d+ years?( and \d+ months?)? old\.$/);
    expect(shoutout).toBe("Go follow friend at twitch.tv/friend! They were last playing Valorant.");
    const helixShoutout = fixture.sent("api.twitch.tv/helix/chat/shoutouts", "POST")[0];
    expect(Object.fromEntries(helixShoutout?.query ?? [])).toEqual({ from_broadcaster_id: BROADCASTER_ID, to_broadcaster_id: "55", moderator_id: BOT_USER_ID });
    expect(fixture.service.snapshot(0).log.map((entry) => entry.action)).toEqual(["shoutout"]);
  });

  it("posts a chat hook with a signature, says the reply, and ignores the bot's own echo", async () => {
    const fixture = bot({
      config: {
        hooks: [{ name: "reader", trigger: "ask", url: "https://hooks.example/in", secret: "hook-SECRET", enabled: true, reply: "chat", cooldownSec: 0, userCooldownSec: 0 }],
      },
    });
    const socket = await connectTwitch(fixture);
    socket.receive(twitchChat({ ...ace, text: "!ask what time is it", messageId: "ask-1" }));
    await until(() => fixture.twitchSays().length === 1, "hook reply");
    expect(fixture.twitchSays()).toEqual(["it is noon"]);
    const call = fixture.sent("hooks.example/in", "POST")[0];
    expect(call?.headers["x-rascal-signature"]).toBe(`sha256=${createHmac("sha256", "hook-SECRET").update(call?.body ?? "").digest("hex")}`);
    expect(bodyOf(call)).toEqual({
      hook: "reader",
      platform: "twitch",
      channel: CHANNEL,
      user: { id: "7", login: "ace", displayName: "Ace", roles: ["everyone"] },
      message: "!ask what time is it",
      text: "what time is it",
      timestamp: expect.any(Number),
      messageId: "ask-1",
    });
    socket.receive(twitchChat({ login: BOT_LOGIN, userId: BOT_USER_ID, text: "it is noon" }));
    socket.receive(twitchChat({ login: BOT_LOGIN, userId: BOT_USER_ID, text: "!ask again" }));
    await settle(60);
    expect(fixture.sent("hooks.example/in")).toHaveLength(1);
    expect(fixture.service.snapshot(0).log[0]).toMatchObject({ action: "hook", user: "ace", by: "twitch" });
    expect(fixture.service.snapshot(0).log[0]?.text).toMatch(/^reader HTTP 200 \d+ms$/);
    expect(fixture.logs.join("\n")).not.toContain("hook-SECRET");
  });

  it("posts as the signed-in channel through the desk token bridge", async () => {
    const fixture = bot({ twitch: false, config: { accounts: { twitch: "channel", youtube: "bot" }, commands: [command({ name: "hi", response: "hey {user}" })] } });
    const desk = { ...twitchBotTokens({ accessToken: "desk-access-TESTTOKEN", userId: BROADCASTER_ID, login: CHANNEL }) } as never;
    fixture.service.setChannelTokenBridge({ loadTwitch: () => desk, saveTwitch: () => undefined, loadYoutube: () => null, saveYoutube: () => undefined });
    const socket = await connectTwitch(fixture);
    await until(() => fixture.sent("api.twitch.tv/helix/eventsub/subscriptions").length === 1, "subscription");
    expect(bodyOf(fixture.sent("api.twitch.tv/helix/eventsub/subscriptions")[0])).toMatchObject({ condition: { user_id: BROADCASTER_ID } });
    socket.receive(twitchChat({ ...ace, text: "!hi" }));
    await until(() => fixture.twitchSays().length === 1, "reply");
    const reply = fixture.sent("api.twitch.tv/helix/chat/messages")[0];
    expect(bodyOf(reply)).toMatchObject({ sender_id: BROADCASTER_ID, message: "hey Ace" });
    expect(reply?.headers.authorization).toBe("Bearer desk-access-TESTTOKEN");
    expect(fixture.service.snapshot(0).platforms[0]).toMatchObject({ id: "twitch", accountMode: "channel", account: CHANNEL, separateAccount: null });
  });

  it("refreshes a bot token that is about to expire and logs the bot out when Twitch refuses", async () => {
    let refreshOk = true;
    const fixture = bot({
      files: { "bot-tokens.json": twitchBotTokens({ expiresAt: Date.now() + 60_000 }) },
      extra: (request) => {
        if (request.where !== "id.twitch.tv/oauth2/token") return undefined;
        if (!refreshOk) return json({ status: 400, message: "Invalid refresh token" }, 400);
        return json({ access_token: "bot-access-REFRESHED", refresh_token: "bot-refresh-REFRESHED", expires_in: 14_000 });
      },
    });
    await connectTwitch(fixture);
    await until(() => fixture.sent("api.twitch.tv/helix/eventsub/subscriptions").length === 1, "subscription");
    expect(new URLSearchParams(fixture.sent("id.twitch.tv/oauth2/token")[0]?.body).get("grant_type")).toBe("refresh_token");
    expect(fixture.sent("api.twitch.tv/helix/eventsub/subscriptions")[0]?.headers.authorization).toBe("Bearer bot-access-REFRESHED");
    expect(readJson(fixture.dir, "bot-tokens.json")).toMatchObject({ accessToken: "bot-access-REFRESHED", refreshToken: "bot-refresh-REFRESHED" });

    writeJson(fixture.dir, "bot-tokens.json", twitchBotTokens({ expiresAt: Date.now() + 60_000 }));
    refreshOk = false;
    const logs: string[] = [];
    const again = new BotService(new BotStore(fixture.dir), { clientId: () => CLIENT_ID, fetchImpl: fixture.fetchImpl, log: (_level, message) => logs.push(message) });
    await again.tick();
    expect(fs.existsSync(path.join(fixture.dir, "bot-tokens.json"))).toBe(false);
    expect(again.snapshot(0)).toMatchObject({ status: "Bot logged out.", botLogin: null });
    expect(logs).toContain("stream status failed");
    again.stop();
  });
});

describe("youtube chat through the bot", () => {
  it("answers a YouTube command from the desk page reader with the Data API", async () => {
    const fixture = bot({ youtube: true, config: { commands: [command({ name: "yt", response: "hello {user} on yt", platforms: "youtube" })] } });
    fixture.service.ingestYoutube(youtubeMessage({ authorId: "UCviewer0000000000000001", name: "Night Owl", text: "!yt" }));
    await until(() => fixture.youtubeSays().length === 1, "youtube reply");
    expect(fixture.youtubeSays()).toEqual(["hello Night Owl on yt"]);
    const insert = fixture.sent("www.googleapis.com/youtube/v3/liveChat/messages", "POST")[0];
    expect(insert?.query.get("part")).toBe("snippet");
    expect(bodyOf(insert)).toEqual({ snippet: { liveChatId: YT_CHAT, type: "textMessageEvent", textMessageDetails: { messageText: "hello Night Owl on yt" } } });
    expect(insert?.headers.authorization).toBe("Bearer ya29.YTBOTTOKEN");
    expect(fixture.twitchSays()).toEqual([]);
  });

  it("deletes a YouTube link and times the author out with a temporary ban", async () => {
    const fixture = bot({ youtube: true, config: { filters: { links: { enabled: true, action: "timeout", timeoutSec: 45 }, platforms: "youtube" } } });
    fixture.service.ingestYoutube(youtubeMessage({ authorId: "UCtroll00000000000000001", name: "Troll", text: "buy at spam.com", id: "yt-spam" }));
    await until(() => fixture.sent("www.googleapis.com/youtube/v3/liveChat/bans", "POST").length === 1, "youtube timeout");
    expect(fixture.sent("www.googleapis.com/youtube/v3/liveChat/messages", "DELETE")[0]?.query.get("id")).toBe("yt-spam");
    expect(bodyOf(fixture.sent("www.googleapis.com/youtube/v3/liveChat/bans", "POST")[0])).toEqual({
      snippet: { liveChatId: YT_CHAT, type: "temporary", bannedUserDetails: { channelId: "UCtroll00000000000000001" }, banDurationSeconds: 45 },
    });
    fixture.service.ingestYoutube(youtubeMessage({ authorId: "UCmod0000000000000000001", name: "Cool Mod", text: "!ban Troll", badges: ["mod"] }));
    await until(() => fixture.sent("www.googleapis.com/youtube/v3/liveChat/bans", "POST").length === 2, "named youtube ban");
    expect(bodyOf(fixture.sent("www.googleapis.com/youtube/v3/liveChat/bans", "POST")[1])).toEqual({
      snippet: { liveChatId: YT_CHAT, type: "permanent", bannedUserDetails: { channelId: "UCtroll00000000000000001" } },
    });
  });

  it("reads chat with its own page reader when headless", async () => {
    const page = `<html><title>Headless live - YouTube</title><script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"${YT_VIDEO}","title":"Headless live","isLive":true},"playabilityStatus":{"status":"OK"}};</script>"INNERTUBE_API_KEY":"AIzaSyTESTKEY1234567" "INNERTUBE_CLIENT_VERSION":"2.20261120.01.00"</html>`;
    const chatPage = `<script>window["ytInitialData"] = {"contents":{"liveChatRenderer":{"continuations":[{"timedContinuationData":{"continuation":"CONT_1","timeoutMs":1000}}]}}};</script>"INNERTUBE_API_KEY":"AIzaSyCHATPAGEKEY0001" "INNERTUBE_CLIENT_VERSION":"2.20261121.02.00"`;
    let polls = 0;
    const fixture = bot({
      youtube: true,
      youtubeReader: "own",
      config: { commands: [command({ name: "yt", response: "headless {user}", platforms: "youtube" })] },
      extra: (request) => {
        if (request.where === `www.youtube.com/channel/${YT_CHANNEL}/live`) return new Response(page, { status: 200 });
        if (request.where === "www.youtube.com/live_chat") return new Response(chatPage, { status: 200 });
        if (request.where === "www.youtube.com/youtubei/v1/live_chat/get_live_chat") {
          polls += 1;
          const actions =
            polls === 1
              ? [
                  {
                    addChatItemAction: {
                      item: {
                        liveChatTextMessageRenderer: {
                          id: "yt-headless-1",
                          authorName: { simpleText: "Night Owl" },
                          authorExternalChannelId: "UCviewer0000000000000001",
                          timestampUsec: String(Date.now() * 1000),
                          message: { runs: [{ text: "!yt" }] },
                        },
                      },
                    },
                  },
                ]
              : [];
          return json({ continuationContents: { liveChatContinuation: { actions, continuations: [{ timedContinuationData: { continuation: `CONT_${polls + 1}`, timeoutMs: 1000 } }] } } });
        }
        if (request.where === "www.youtube.com/watch") return new Response("", { status: 404 });
        return undefined;
      },
    });
    await fixture.service.connectYoutube();
    await until(() => fixture.youtubeSays().length === 1, "headless reply");
    expect(fixture.youtubeSays()).toEqual(["headless Night Owl"]);
    const poll = fixture.calls.find((call) => call.where === "www.youtube.com/youtubei/v1/live_chat/get_live_chat");
    expect(poll?.query.get("key")).toBe("AIzaSyCHATPAGEKEY0001");
    expect(bodyOf(poll)).toMatchObject({ continuation: "CONT_1", context: { client: { clientName: "WEB", clientVersion: "2.20261121.02.00" } } });
    expect(fixture.service.snapshot(0).platforms[1]).toMatchObject({ id: "youtube", connected: true });
  });
});

describe("timers through the bot", () => {
  it("posts a due live timer on both platforms, rotates it, and saves the schedule", async () => {
    const fixture = bot({ youtube: true, config: { timers: [{ name: "plug", messages: ["one", "two"], mode: "live", intervalSec: 15, minChatLines: 0, platforms: "all" }] } });
    fixture.service.setYoutubeLive({ live: true, known: true, title: "YouTube live", videoId: YT_VIDEO });
    await fixture.service.tick();
    expect(fixture.twitchSays()).toEqual(["one"]);
    expect(fixture.youtubeSays()).toEqual(["one"]);
    const saved = readJson(fixture.dir, "bot.json").timers[0];
    expect(saved).toMatchObject({ messageIndex: 1, message: "two", linesSince: 0 });
    expect(saved.lastFiredAt).toBeGreaterThan(0);
    expect(fixture.service.snapshot(0).log).toEqual([expect.objectContaining({ action: "timer", text: "plug (live)", by: "bot" })]);
    await fixture.service.tick();
    expect(fixture.twitchSays()).toEqual(["one"]);
  });

  it("posts an offline timer on Twitch and skips YouTube until its chat is live", async () => {
    const fixture = bot({ youtube: true, apis: { live: false }, config: { timers: [{ name: "brb", message: "back soon", mode: "offline", intervalSec: 15, minChatLines: 0, platforms: "all" }] } });
    await fixture.service.tick();
    expect(fixture.twitchSays()).toEqual(["back soon"]);
    expect(fixture.youtubeSays()).toEqual([]);
    expect(fixture.service.snapshot(0).log[0]).toMatchObject({ action: "timer", text: "brb (offline)" });
  });

  it("waits for enough chat lines before a timer posts", async () => {
    const fixture = bot({ config: { timers: [{ name: "plug", message: "hi", mode: "both", intervalSec: 15, minChatLines: 2, platforms: "twitch" }] } });
    const socket = await connectTwitch(fixture);
    await fixture.service.tick();
    expect(fixture.twitchSays()).toEqual([]);
    socket.receive(twitchChat({ ...ace, text: "one" }));
    socket.receive(twitchChat({ ...ace, text: "two" }));
    await settle(60);
    await fixture.service.tick();
    expect(fixture.twitchSays()).toEqual(["hi"]);
  });
});

describe("thank-yous through the bot", () => {
  it("thanks a follow and folds a burst of gifted subs into one line", async () => {
    const fixture = bot({
      config: { thanks: { follow: { enabled: true, template: "Thanks for the follow, {user}!" }, subgift: { enabled: true, template: "Thanks {user} for the gift!" } } },
    });
    fixture.service.noteNotice({ platform: "twitch", kind: "follow", user: "Ace" });
    fixture.service.noteNotice({ platform: "twitch", kind: "raid", user: "Ignored" });
    await until(() => fixture.twitchSays().length === 1, "follow thanks");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fixture.service.noteNotice({ platform: "twitch", kind: "subgift", user: "Gifter" });
    fixture.service.noteNotice({ platform: "twitch", kind: "subgift", user: "Gifter" });
    fixture.service.noteNotice({ platform: "twitch", kind: "subgift", user: "Gifter" });
    await vi.advanceTimersByTimeAsync(4_100);
    vi.useRealTimers();
    await until(() => fixture.twitchSays().length === 2, "gift thanks");
    expect(fixture.twitchSays()).toEqual(["Thanks for the follow, Ace!", "Thanks Gifter for gifting 3 subs!"]);
  });
});

describe("bot state and editing", () => {
  it("reports a fresh bot with no accounts", () => {
    const service = new BotService(new BotStore(tempDir()), { clientId: () => "", log: () => undefined });
    const snap = service.snapshot(4788);
    expect(Object.keys(snap).sort()).toEqual(
      [
        "botLogin",
        "broadcasterId",
        "channelLogin",
        "commands",
        "connected",
        "filters",
        "googleClientFromEnv",
        "googleClientId",
        "googleClientSecretSet",
        "hooks",
        "log",
        "login",
        "platforms",
        "portalUrl",
        "quotes",
        "redirectUri",
        "seJwtSet",
        "shoutout",
        "status",
        "thanks",
        "timers",
        "youtubeApiPoll",
        "youtubeLogin",
        "youtubeRedirectUri",
      ].sort(),
    );
    expect(snap).toMatchObject({
      connected: false,
      status: "Bot is idle.",
      botLogin: null,
      channelLogin: "",
      broadcasterId: "",
      portalUrl: "http://localhost:4788/portal",
      redirectUri: "http://localhost:4788/portal/callback",
      login: null,
      commands: [],
      timers: [],
      quotes: [],
      hooks: [],
      log: [],
      seJwtSet: false,
      youtubeLogin: null,
      youtubeRedirectUri: "http://127.0.0.1:4799/youtube/callback",
      googleClientId: "",
      googleClientSecretSet: false,
      googleClientFromEnv: false,
      youtubeApiPoll: false,
    });
    const capabilities = { send: true, deleteMessage: true, timeout: true, ban: true, unban: true };
    expect(snap.platforms[0]).toEqual({
      id: "twitch",
      label: "Twitch",
      connected: false,
      status: "Bot is idle.",
      account: null,
      accountMode: "bot",
      separateAccount: null,
      capabilities,
      quota: null,
    });
    expect(snap.platforms[1]).toMatchObject({
      id: "youtube",
      label: "YouTube",
      connected: false,
      status: "Waiting for YouTube chat from the page reader.",
      account: null,
      accountMode: "bot",
      separateAccount: null,
      capabilities,
      quota: { dailyLimit: 10_000, pollingIntervalMillis: null },
    });
    expect(snap.platforms[1]?.quota?.detail).toContain("Reading YouTube chat from the page (no quota).");
    service.stop();
  });

  it("names the accounts the chime should ignore", () => {
    const fixture = bot({ youtube: true });
    expect(fixture.service.alertPosters()).toEqual({
      selfNames: [CHANNEL],
      selfIds: [BROADCASTER_ID, YT_CHANNEL],
      botNames: [BOT_LOGIN, "Rascal Bot"],
      botIds: [BOT_USER_ID, YT_BOT_CHANNEL],
    });
  });

  it("cleans identity input and keeps a valid value when the new one is not", () => {
    const fixture = bot({ twitch: false });
    fixture.service.setIdentity({ channelLogin: " #NewChannel ", broadcasterId: "abc", youtubeChannelId: "not-a-channel", publicUrl: " https://bot.example.com/ " });
    expect(readJson(fixture.dir, "bot.json")).toMatchObject({ channelLogin: "newchannel", broadcasterId: BROADCASTER_ID, youtubeChannelId: YT_CHANNEL, publicUrl: "https://bot.example.com" });
    fixture.service.setIdentity({ broadcasterId: "77", youtubeChannelId: "" });
    expect(readJson(fixture.dir, "bot.json")).toMatchObject({ broadcasterId: "77", youtubeChannelId: "" });
    expect(fixture.service.snapshot(0)).toMatchObject({ portalUrl: "https://bot.example.com/portal", youtubeRedirectUri: "https://bot.example.com/youtube/callback" });
  });

  it("merges command, hook, filter, and extras edits the way the editors expect", () => {
    const { service, dir } = bot({ twitch: false });
    service.saveCommand({ name: "!So", response: "first", aliases: ["shout"], keywords: ["shout out"], platforms: "all" });
    service.saveCommand({ name: "so", response: "second" });
    let saved = readJson(dir, "bot.json").commands;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: "so", name: "so", response: "second", aliases: ["shout"], keywords: ["shout out"], platforms: "all", count: 0 });
    service.saveCommand({ name: "so", response: "third", keywords: [], platforms: "youtube" });
    saved = readJson(dir, "bot.json").commands;
    expect(saved[0]).toMatchObject({ response: "third", keywords: [], platforms: "youtube" });
    expect(() => service.saveCommand({ response: "nameless" })).toThrow("That command needs a name and a response.");
    service.deleteCommand("so");
    expect(readJson(dir, "bot.json").commands).toEqual([]);

    service.saveHook({ name: "reader", trigger: "!ask", url: "https://hooks.example/in", secret: "keep-me", keywords: ["hey bot"] });
    service.saveHook({ name: "Reader", trigger: "ask", url: "https://hooks.example/in", secret: "" });
    let hook = readJson(dir, "bot.json").hooks[0];
    expect(hook).toMatchObject({ id: "reader", name: "Reader", secret: "keep-me", keywords: ["hey bot"], enabled: false });
    service.saveHook({ id: "reader", name: "Reader", trigger: "ask", url: "https://hooks.example/in", clearSecret: true, keywords: [] });
    hook = readJson(dir, "bot.json").hooks[0];
    expect(hook).toMatchObject({ secret: "", keywords: [] });
    expect(() => service.saveHook({ name: "bad", trigger: "ask", url: "http://example.com/hook" })).toThrow(
      "A hook needs a name, a command such as !ask, and an https address. http is only allowed for localhost.",
    );
    service.deleteHook("reader");
    expect(readJson(dir, "bot.json").hooks).toEqual([]);

    service.saveFilters({ links: { enabled: true } });
    service.saveFilters({ caps: { maxPercent: 50 }, permitSec: 90, platforms: "all" });
    expect(readJson(dir, "bot.json").filters).toMatchObject({
      links: { enabled: true, action: "delete", timeoutSec: 30 },
      caps: { enabled: false, minLength: 20, maxPercent: 50, action: "delete", timeoutSec: 30 },
      permitSec: 90,
      platforms: "all",
    });

    service.saveExtras({ quotes: ["a", { text: "b", by: "ace" }] });
    service.saveExtras({ quotes: ["a", "c"] });
    expect(readJson(dir, "bot.json").quotes.map((quote: { id: number; text: string }) => `${quote.id}:${quote.text}`)).toEqual(["1:a", "2:b", "3:c"]);
    service.saveExtras({ quotes: ["only"], replaceQuotes: true });
    expect(readJson(dir, "bot.json").quotes).toEqual([{ id: 1, text: "only", by: "", at: 0 }]);
    service.saveExtras({ thanks: { follow: { enabled: true, template: "ty {user}" } } });
    service.saveExtras({ thanks: { raid: { enabled: true, template: "raid {user}" } }, shoutout: { template: "SO {target}", helix: false } });
    const extras = readJson(dir, "bot.json");
    expect(extras.thanks.raid).toEqual({ enabled: true, template: "raid {user}" });
    expect(extras.thanks.follow).toEqual({ enabled: false, template: "Thanks for the follow, {user}!" });
    expect(extras.shoutout).toEqual({ template: "SO {target}", helix: false });
  });

  it("imports and exports the bot config, including StreamElements JSON", () => {
    const { service, dir } = bot({ twitch: false });
    service.importConfig({
      channelLogin: "imported",
      broadcasterId: "99",
      commands: [{ name: "hi", response: "hello" }],
      timers: [{ name: "plug", message: "follow" }],
      filters: { permitSec: 30 },
      quotes: ["q1"],
      thanks: { cheer: { enabled: true, template: "bits {amount}" } },
      shoutout: { template: "go {target}" },
      hooks: [{ name: "reader", trigger: "ask", url: "https://hooks.example/in", secret: "hook-SECRET" }],
    });
    const exported = service.exportConfig() as Record<string, any>;
    expect(Object.keys(exported).sort()).toEqual(
      ["accounts", "broadcasterId", "channelLogin", "commands", "exportedAt", "filters", "hooks", "quotes", "shoutout", "thanks", "timers", "youtubeChannelId"].sort(),
    );
    expect(exported).toMatchObject({ channelLogin: "imported", broadcasterId: "99", youtubeChannelId: YT_CHANNEL });
    expect(exported.commands.map((item: { name: string }) => item.name)).toEqual(["hi"]);
    expect(exported.quotes.map((item: { text: string }) => item.text)).toEqual(["q1"]);
    expect(exported.hooks[0].secret).toBe("hook-SECRET");
    service.importJson({ commands: [{ command: "hi", response: "from SE" }, { command: "new", response: "fresh" }], timers: [] });
    expect(readJson(dir, "bot.json").commands.map((item: { name: string; response: string }) => `${item.name}=${item.response}`)).toEqual(["hi=from SE", "new=fresh"]);
    expect(() => service.importJson({ nothing: true })).toThrow("That JSON did not contain commands or timers.");
  });

  it("imports a Twitch and a YouTube session from files and rejects incomplete ones", () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const { service, dir } = bot({ twitch: false });
    expect(() => service.importTokens({ accessToken: "x" })).toThrow("That token file is missing the bot session.");
    service.importTokens({ accessToken: "a", refreshToken: "r", userId: "900", login: BOT_LOGIN });
    expect(readJson(dir, "bot-tokens.json")).toMatchObject({ clientId: CLIENT_ID, accessToken: "a", refreshToken: "r", userId: "900", login: BOT_LOGIN, scopes: [] });
    expectPrivateMode(path.join(dir, "bot-tokens.json"), 0o600);
    expect(() => service.importYoutubeTokens({ accessToken: "x" })).toThrow("That token file is missing the YouTube session.");
    service.importYoutubeTokens({ accessToken: "ya29.x", refreshToken: "r", channelId: YT_BOT_CHANNEL, title: "Bot" });
    expect(readJson(dir, "bot-youtube-tokens.json")).toMatchObject({ channelId: YT_BOT_CHANNEL, title: "Bot", clientId: "" });
    expect(service.snapshot(0).platforms[1]).toMatchObject({ separateAccount: "Bot", account: "Bot" });
  });

  it("stores a Google client and keeps the secret when only the id changes", () => {
    const { service, dir } = bot({ twitch: false });
    expect(() => service.saveGoogleClient({ clientId: " " })).toThrow("Add a Google client ID.");
    service.saveGoogleClient({ clientId: " first.apps.googleusercontent.com ", clientSecret: "google-SECRET" });
    service.saveGoogleClient({ clientId: "second.apps.googleusercontent.com" });
    expect(readJson(dir, "google-client.json")).toEqual({ clientId: "second.apps.googleusercontent.com", clientSecret: "google-SECRET" });
    expect(service.snapshot(0)).toMatchObject({ googleClientId: "second.apps.googleusercontent.com", googleClientSecretSet: true });
    expect(JSON.stringify(service.snapshot(0))).not.toContain("google-SECRET");
  });

  it("switches posting accounts and the Data API poll", () => {
    const { service, dir } = bot({ twitch: false });
    service.setAccounts({ twitch: "channel", youtube: "nonsense", youtubeApiPoll: true });
    expect(readJson(dir, "bot.json")).toMatchObject({ accounts: { twitch: "channel", youtube: "bot" }, youtubeApiPoll: true });
    expect(service.snapshot(0).youtubeApiPoll).toBe(true);
  });
});
