import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { youtubeDesk } from "../src/main/youtube/desk";
import type { YoutubeBotTokens } from "../packages/bot/src/store";
import { YOUTUBE_OAUTH_SCOPE } from "../src/shared/platform/youtube-oauth";
import { youtubeSendStatus } from "../src/shared/platform/youtube-send";

const HINT = /Settings/;
const BOT = /Bot tab/;

describe("youtube send checkbox", () => {
  it("explains a missing client, a missing login, and a missing force-ssl scope", () => {
    const missing = youtubeSendStatus({ clientId: "", account: null, scopes: [] });
    expect(missing.canSend).toBe(false);
    expect(missing.hint).toMatch(HINT);
    expect(missing.hint).toMatch(BOT);
    expect(missing.hint).toMatch(/youtube\.force-ssl/);
    expect(missing.hint).toMatch(/Reading chat/);

    const clientOnly = youtubeSendStatus({ clientId: "app.apps.googleusercontent.com", account: null, scopes: [] });
    expect(clientOnly.canSend).toBe(false);
    expect(clientOnly.hint).toMatch(/isn't authorized/);
    expect(clientOnly.hint).toMatch(HINT);

    const wrongScope = youtubeSendStatus({ clientId: "app.apps.googleusercontent.com", account: "Example", scopes: ["openid"] });
    expect(wrongScope.canSend).toBe(false);
    expect(wrongScope.hint).toMatch(/missing youtube\.force-ssl/);

    const ready = youtubeSendStatus({
      clientId: "app.apps.googleusercontent.com",
      account: "Example",
      scopes: [YOUTUBE_OAUTH_SCOPE],
    });
    expect(ready).toEqual({ canSend: true, hint: "" });
    expect(youtubeSendStatus({ clientId: "app.apps.googleusercontent.com", account: "Example", scopes: [] }).canSend).toBe(true);
  });

  it("keeps the YouTube check available until the desk has a force-ssl account", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-yt-send-"));
    const desk = youtubeDesk(dir);
    const blocked = desk.sendReadiness();
    expect(blocked.canSend).toBe(false);
    expect(blocked.hint).toMatch(HINT);
    expect(desk.state().connected).toBe(false);
    const source = fs.readFileSync(new URL("../src/renderer/components/Composer.tsx", import.meta.url), "utf8");
    expect(source).toContain("sendHint");
    expect(source).toContain("checked={targets.youtube}");
    expect(source).not.toContain("disabled={!canSendYoutube}");
    expect(source).toContain("Open Settings");
    expect(source).toContain("plan.deliver");
  });
});

describe("desk youtube send", () => {
  it("uses the current video's active chat instead of a stale upcoming broadcast", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-yt-insert-"));
    const posts: { url: string; body: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/videos")) {
        return json({
          items: [
            {
              id: "Cg9VaXE-Q18",
              snippet: { title: "Kingdom Come Deliverance 2 - Part 5" },
              liveStreamingDetails: { activeLiveChatId: "active-chat" },
            },
          ],
        });
      }
      if (url.includes("/liveBroadcasts")) {
        return json({
          items: [
            {
              id: "upcoming0001",
              snippet: { title: "Waiting room", liveChatId: "stale-chat" },
              status: { lifeCycleStatus: "ready" },
            },
            {
              id: "Cg9VaXE-Q18",
              snippet: { title: "Kingdom Come Deliverance 2 - Part 5", liveChatId: "broadcast-chat" },
              status: { lifeCycleStatus: "live" },
            },
          ],
        });
      }
      if (method === "POST" && url.includes("/liveChat/messages")) {
        posts.push({ url, body: typeof init?.body === "string" ? init.body : "" });
        return json({ id: "sent-1" });
      }
      return json({}, 404);
    };
    const desk = youtubeDesk(dir, { fetchImpl });
    desk.replace(tokens());
    await desk.send("hello from the desk", "Cg9VaXE-Q18");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]?.body ?? "{}")).toEqual({
      snippet: {
        liveChatId: "active-chat",
        type: "textMessageEvent",
        textMessageDetails: { messageText: "hello from the desk" },
      },
    });
    expect(posts[0]?.url).toContain("part=snippet");
    expect(posts[0]?.body).not.toContain("stale-chat");
  });

  it("drops a cached chat id after YouTube returns 400 and posts to the fresh active chat", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-yt-retry-"));
    let videos = 0;
    const posted: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/videos")) {
        videos += 1;
        const liveChatId = videos === 1 ? "stale-cached" : "active-chat";
        return json({
          items: [{ id: "Cg9VaXE-Q18", liveStreamingDetails: { activeLiveChatId: liveChatId }, snippet: { title: "Live" } }],
        });
      }
      if (method === "POST") {
        const body = typeof init?.body === "string" ? init.body : "";
        posted.push(body);
        if (body.includes("stale-cached")) {
          return json({ error: { code: 400, message: "The live chat is not active.", status: "INVALID_ARGUMENT", errors: [{ reason: "liveChatEnded", message: "The live chat is not active." }] } }, 400);
        }
        return json({ id: "sent-2" });
      }
      return json({ items: [] });
    };
    const desk = youtubeDesk(dir, { fetchImpl });
    desk.replace(tokens());
    await desk.send("still here", "Cg9VaXE-Q18");
    expect(posted.some((body) => body.includes("stale-cached"))).toBe(true);
    expect(posted.some((body) => body.includes("active-chat"))).toBe(true);
  });
});

function tokens(): YoutubeBotTokens {
  return {
    clientId: "client.apps.googleusercontent.com",
    accessToken: "ya29.DESKTOKEN",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 60 * 60 * 1000,
    scopes: [YOUTUBE_OAUTH_SCOPE],
    channelId: "UCbroadcaster000000000001",
    title: "Example",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
