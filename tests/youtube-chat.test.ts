import { describe, expect, it } from "vitest";
import {
  detectLiveFromHtml,
  extractEmbeddedJson,
  extractInnertubeConfig,
  findLiveChatRenderer,
  interpretPlayer,
  parseLiveChatResponse,
  pickContinuation,
  readLiveChatPage,
} from "../src/shared/parsers/youtube";
import chatPayload from "./fixtures/youtube-live-chat.json";
import players from "./fixtures/youtube-player.json";

describe("youtube live detection", () => {
  it("treats videoDetails.isLive as live when isLiveNow is absent", () => {
    expect(interpretPlayer(players.live)).toMatchObject({
      live: true,
      videoId: "livevideoli",
      title: "Sunday stream",
      reason: "videoDetails.isLive",
    });
  });

  it("still honours a legacy isLiveNow flag", () => {
    expect(interpretPlayer(players.legacy)).toMatchObject({ live: true, reason: "isLiveNow" });
  });

  it("does not treat a past stream as live just because isLiveContent is set", () => {
    expect(interpretPlayer(players.vod)).toMatchObject({ live: false, reason: "not-live" });
  });

  it("treats an offline playability status as offline", () => {
    expect(interpretPlayer(players.offline).live).toBe(false);
  });
});

describe("youtube chat items", () => {
  it("parses text, emoji, badges, super chat, membership, deletes, and the next timeout", () => {
    const parsed = parseLiveChatResponse(chatPayload);
    expect(parsed.ended).toBe(false);
    expect(parsed.continuation).toEqual({ token: "NEXT_TOKEN_abcdef", timeoutMs: 3200 });
    expect(parsed.deletedIds).toEqual(["yt-msg-1"]);
    expect(parsed.deletedAuthorIds).toEqual(["UCviewer0000000000000001"]);

    const [text, paid, member] = parsed.messages;
    expect(text).toMatchObject({
      id: "yt-msg-1",
      platform: "youtube",
      displayName: "NightOwl",
      authorId: "UCviewer0000000000000001",
      timestamp: 1700000000000,
      plainText: "Hello :wave: chat",
    });
    expect(text?.badges.map((badge) => badge.kind)).toEqual(["mod", "member"]);
    expect(text?.badges[0]?.imageUrl).toBeUndefined();
    expect(text?.badges[1]?.imageUrl).toBe("https://yt3.ggpht.com/badge=s16");
    expect(text?.segments[1]).toMatchObject({
      type: "emote",
      text: ":wave:",
      url: "https://yt3.ggpht.com/emoji-large",
      source: "youtube",
    });
    expect(paid).toMatchObject({ kind: "superchat", amount: "$5.00", plainText: "love the run" });
    expect(member).toMatchObject({
      kind: "membership",
      notice: "Welcome to members!",
      badges: [{ kind: "member", label: "MEMBER" }],
    });
  });

  it("ends the session on a replay continuation or an empty body", () => {
    expect(
      pickContinuation([{ liveChatReplayContinuationData: { continuation: "replay" } }]),
    ).toEqual({ continuation: null, ended: true });
    expect(parseLiveChatResponse({}).ended).toBe(true);
  });

  it("drops emoji images that are not on an allowed host", () => {
    const parsed = parseLiveChatResponse({
      continuationContents: {
        liveChatContinuation: {
          actions: [
            {
              addChatItemAction: {
                item: {
                  liveChatTextMessageRenderer: {
                    id: "bad-emoji",
                    authorName: { simpleText: "Viewer" },
                    message: {
                      runs: [
                        {
                          emoji: {
                            shortcuts: [":x:"],
                            image: { thumbnails: [{ url: "http://evil.example/e.png", width: 32 }] },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          ],
          continuations: [{ invalidationContinuationData: { continuation: "still-live", timeoutMs: 50 } }],
        },
      },
    });
    expect(parsed.messages[0]?.segments).toEqual([{ type: "text", text: ":x:" }]);
    expect(parsed.continuation?.timeoutMs).toBe(1000);
  });
});

describe("youtube page extraction", () => {
  const html = `<html><script>
    var ytInitialPlayerResponse = {"videoDetails":{"videoId":"livevideoli","title":"brace } in title","isLive":true},"playabilityStatus":{"status":"OK"}};
    </script>
    <script>ytInitialData = {"contents":{"liveChatRenderer":{"continuations":[{"reloadContinuationData":{"continuation":"BOOT_TOKEN_123456","timeoutMs":0}}]}}};</script>
    "INNERTUBE_API_KEY":"AIzaSyTESTKEY1234567"
    "INNERTUBE_CLIENT_VERSION":"2.20251120.01.00"
    </html>`;

  it("extracts a player object even when a string contains a brace", () => {
    const player = extractEmbeddedJson(html, "ytInitialPlayerResponse");
    expect(interpretPlayer(player)).toMatchObject({
      live: true,
      videoId: "livevideoli",
      title: "brace } in title",
    });
  });

  it("treats a live chat renderer as live when the player stub has no isLive flag", () => {
    const html = `<title>Sunday stream - YouTube</title>
      <script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"LOGIN_REQUIRED"}};</script>
      <script>ytInitialData = {"contents":{"liveChatRenderer":{"continuations":[{"reloadContinuationData":{"continuation":"BOOT_TOKEN_123456","timeoutMs":0}}],"header":{"liveChatHeaderRenderer":{"overflowMenu":{"menuRenderer":{"items":[{"menuServiceItemRenderer":{"serviceEndpoint":{"popoutLiveChatEndpoint":{"url":"https://www.youtube.com/live_chat?is_popout=1&v=livevideoli"}}}}]}}}}}}};</script>
      "INNERTUBE_API_KEY":"AIzaSyTESTKEY1234567"
      "INNERTUBE_CLIENT_VERSION":"2.20261119.07.00"`;
    expect(detectLiveFromHtml(html)).toMatchObject({
      videoId: "livevideoli",
      title: "Sunday stream",
      apiKey: "AIzaSyTESTKEY1234567",
      clientVersion: "2.20261119.07.00",
      continuation: { token: "BOOT_TOKEN_123456" },
    });
  });

  it("does not treat a bare video id on an offline channel page as live", () => {
    const html = `<title>Example Channel - YouTube</title><script>"videoId":"abcdefghijk"</script>`;
    expect(detectLiveFromHtml(html)).toBeNull();
  });

  it("reads window[\"ytInitialData\"] and prefers it over an earlier empty assignment", () => {
    const page = `<script>var ytInitialData = {"contents":{}};</script>
      <script>window["ytInitialData"] = {"contents":{"liveChatRenderer":{"continuations":[{"invalidationContinuationData":{"continuation":"WIN_TOKEN_123","timeoutMs":2000}}]}}};</script>
      "INNERTUBE_API_KEY":"AIzaSyWINDOWKEY123456"
      "INNERTUBE_CLIENT_VERSION":"2.20261120.01.00"`;
    const read = readLiveChatPage(page);
    expect(read.continuation).toEqual({ token: "WIN_TOKEN_123", timeoutMs: 2000 });
    expect(read.apiKey).toBe("AIzaSyWINDOWKEY123456");
    expect(extractEmbeddedJson(page, "ytInitialPlayerResponse")).toBeNull();
  });

  it("says the chat page could not be parsed when the assignment is missing", () => {
    expect(() => readLiveChatPage("<html>no data</html>")).toThrow(/Couldn't parse the YouTube chat page/);
  });

  it("says chat is off when the renderer has no live continuation", () => {
    const page = `window["ytInitialData"] = {"contents":{"liveChatRenderer":{"continuations":[{"liveChatReplayContinuationData":{"continuation":"replay"}}]}}};`;
    expect(() => readLiveChatPage(page)).toThrow(/Live chat is turned off/);
  });

  it("reads the initial continuation, api key, and client version", () => {
    const data = extractEmbeddedJson(html, "ytInitialData");
    const renderer = findLiveChatRenderer(data);
    expect(renderer?.continuations).toBeTruthy();
    expect(pickContinuation(renderer?.continuations).continuation?.token).toBe("BOOT_TOKEN_123456");
    expect(extractInnertubeConfig(html)).toEqual({
      apiKey: "AIzaSyTESTKEY1234567",
      clientVersion: "2.20251120.01.00",
    });
  });
});
