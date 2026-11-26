import { describe, expect, it } from "vitest";
import { Runtime } from "../src/main/runtime";
import { YOUTUBE_OAUTH_SCOPE } from "../src/shared/platform/youtube-oauth";
import type { ChatMessage, ConnectionStatus } from "../src/shared/types";
import { bodyOf, fetchRouter, json, noContent, type FetchHandler } from "./helpers/fetch-router";
import { tempDir, writeJson } from "./helpers/bot";

const MESSAGE = "11111111-1111-1111-1111-111111111111";
const VIEWER = "UCviewer0000000000000001";
const OWNER = "UCexamplechannel00000001";

function desk(options: { scopes?: string[]; youtube?: boolean; handler?: FetchHandler } = {}) {
  const dir = tempDir("rascal-mod-");
  writeJson(dir, "settings.json", { twitchChannel: "examplechannel", youtubeChannelId: OWNER, twitchClientId: "client1234567890" });
  writeJson(dir, "tokens.json", {
    clientId: "client1234567890",
    accessToken: "desk-access-TESTTOKEN",
    refreshToken: "desk-refresh-TESTTOKEN",
    expiresAt: Date.now() + 24 * 3600_000,
    scopes: options.scopes ?? [
      "chat:read",
      "user:write:chat",
      "moderator:manage:chat_messages",
      "moderator:manage:banned_users",
      "moderator:read:chatters",
    ],
    userId: "42",
    login: "examplechannel",
  });
  if (options.youtube) {
    writeJson(dir, "youtube-tokens.json", {
      clientId: "google-client",
      accessToken: "ya29.youtube-TESTTOKEN",
      refreshToken: "youtube-refresh-TESTTOKEN",
      expiresAt: Date.now() + 24 * 3600_000,
      scopes: [YOUTUBE_OAUTH_SCOPE],
      channelId: OWNER,
      title: "Example",
    });
  }
  const { fetchImpl, calls } = fetchRouter(async (request) => {
    const handled = options.handler ? await options.handler(request) : undefined;
    if (handled) return handled;
    if (request.where.endsWith("/moderation/chat") && request.method === "DELETE") return noContent();
    if (request.where.endsWith("/moderation/bans") && request.method === "POST") return json({ data: [{ user_id: "99" }] });
    if (request.where.endsWith("/moderation/bans") && request.method === "DELETE") return noContent();
    if (request.where.endsWith("/chat/chatters")) {
      const after = request.query.get("after");
      if (!after) {
        return json({ data: [{ user_id: "1", user_login: "ace", user_name: "Ace" }], pagination: { cursor: "page-2" } });
      }
      return json({ data: [{ user_id: "2", user_login: "cedar", user_name: "Cedar" }], pagination: {} });
    }
    if (request.where.includes("/liveBroadcasts")) {
      return json({
        items: [{ id: "videoid123", snippet: { title: "Example live", liveChatId: "chat-9" }, status: { lifeCycleStatus: "live" } }],
      });
    }
    if (request.where.includes("/liveChat/bans") && request.method === "POST") return json({ id: "ban-9" });
    if (request.where.includes("/liveChat/bans") && request.method === "DELETE") return noContent();
    if (request.where.includes("/liveChat/messages") && request.method === "DELETE") return noContent();
    return undefined;
  });
  const runtime = new Runtime({ dir, version: "0.9.0", fetchImpl });
  const internals = runtime as unknown as {
    acceptChat(message: ChatMessage): void;
    refreshChatters(): Promise<void>;
    status: ConnectionStatus;
  };
  return { runtime, calls, internals };
}

function chat(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: MESSAGE,
    platform: "twitch",
    channel: "examplechannel",
    username: "viewer",
    displayName: "Viewer",
    authorId: "99",
    color: "#ffffff",
    badges: [],
    segments: [{ type: "text", text: "hello" }],
    plainText: "hello",
    timestamp: Date.now(),
    kind: "chat",
    ...patch,
  };
}

describe("desk moderation", () => {
  it("deletes, times out, bans, and unbans through Helix and writes the mod log", async () => {
    const { runtime, calls, internals } = desk();
    internals.acceptChat(chat());
    await runtime.moderate({ action: "delete", messageId: MESSAGE });
    await runtime.moderate({ action: "timeout", messageId: MESSAGE, seconds: 45 });
    await runtime.moderate({ action: "ban", messageId: MESSAGE });
    await runtime.moderate({ action: "unban", messageId: MESSAGE });

    const deleted = calls.find((call) => call.where.endsWith("/moderation/chat"));
    expect(deleted?.method).toBe("DELETE");
    expect(deleted?.query.get("broadcaster_id")).toBe("42");
    expect(deleted?.query.get("moderator_id")).toBe("42");
    expect(deleted?.query.get("message_id")).toBe(MESSAGE);
    expect(bodyOf(deleted)).toBeUndefined();

    const bans = calls.filter((call) => call.where.endsWith("/moderation/bans") && call.method === "POST");
    expect(bodyOf(bans[0])).toEqual({ data: { user_id: "99", duration: 45 } });
    expect(bodyOf(bans[1])).toEqual({ data: { user_id: "99" } });
    const unban = calls.find((call) => call.where.endsWith("/moderation/bans") && call.method === "DELETE");
    expect(unban?.query.get("user_id")).toBe("99");

    const log = runtime.snapshot().modLog;
    expect(log.map((entry) => entry.action)).toEqual(["delete", "timeout", "ban", "unban"]);
    expect(log[1]).toMatchObject({ actor: "examplechannel", target: "Viewer", durationSeconds: 45, platform: "twitch" });
    expect(log[1]?.summary).toBe("examplechannel timed out Viewer for 45s on Twitch.");
    expect(runtime.snapshot().messages[0]?.deleted).toBe(true);
    const leaked = calls.some((call) => `${call.url}\n${call.body}`.includes("desk-access-TESTTOKEN"));
    expect(leaked).toBe(false);
  });

  it("does not call Twitch for the broadcaster or for a login missing the manage scopes", async () => {
    const blocked = desk();
    blocked.internals.acceptChat(chat({ username: "examplechannel", displayName: "Example", authorId: "42" }));
    await expect(blocked.runtime.moderate({ action: "ban", messageId: MESSAGE })).rejects.toThrow(/broadcaster/);
    await expect(blocked.runtime.moderate({ action: "delete", messageId: MESSAGE })).rejects.toThrow(/broadcaster/);
    expect(blocked.calls.filter((call) => call.where.includes("/moderation/"))).toEqual([]);

    const limited = desk({ scopes: ["chat:read", "user:write:chat"] });
    limited.internals.acceptChat(chat({ id: MESSAGE }));
    await expect(limited.runtime.moderate({ action: "timeout", messageId: MESSAGE, seconds: 60 })).rejects.toThrow(
      /moderator:manage:banned_users/,
    );
    await expect(limited.runtime.moderate({ action: "delete", messageId: MESSAGE })).rejects.toThrow(/moderator:manage:chat_messages/);
    expect(limited.calls.filter((call) => call.where.includes("/moderation/"))).toEqual([]);
    expect(limited.runtime.snapshot().auth.missingScopes).toEqual(
      expect.arrayContaining(["moderator:manage:chat_messages", "moderator:manage:banned_users", "moderator:read:chatters"]),
    );
  });

  it("shows the Helix error inline when the request fails", async () => {
    const { runtime, internals } = desk({
      handler: (request) =>
        request.where.endsWith("/moderation/chat")
          ? json({ message: "You may not delete another moderator's messages." }, 400)
          : undefined,
    });
    internals.acceptChat(chat());
    await expect(runtime.moderate({ action: "delete", messageId: MESSAGE })).rejects.toThrow(/another moderator/);
    expect(runtime.snapshot().modLog).toEqual([]);
  });

  it("times out and unbans on YouTube with a temporary ban id, and will not act on the channel", async () => {
    const { runtime, calls, internals } = desk({ youtube: true });
    internals.status.youtube = { ...internals.status.youtube, state: "live" };
    internals.acceptChat(
      chat({
        id: "LCC.Emessage01",
        platform: "youtube",
        username: "Viewer",
        displayName: "Viewer",
        authorId: VIEWER,
      }),
    );
    await expect(runtime.moderate({ action: "unban", messageId: "LCC.Emessage01" })).rejects.toThrow(/created in this session/);
    await runtime.moderate({ action: "timeout", messageId: "LCC.Emessage01", seconds: 60 });
    await runtime.moderate({ action: "delete", messageId: "LCC.Emessage01" });
    await runtime.moderate({ action: "unban", messageId: "LCC.Emessage01" });

    const ban = calls.find((call) => call.where.includes("/liveChat/bans") && call.method === "POST");
    expect(bodyOf(ban)).toEqual({
      snippet: {
        liveChatId: "chat-9",
        type: "temporary",
        banDurationSeconds: 60,
        bannedUserDetails: { channelId: VIEWER },
      },
    });
    const removed = calls.find((call) => call.where.includes("/liveChat/bans") && call.method === "DELETE");
    expect(removed?.query.get("id")).toBe("ban-9");
    const deleted = calls.find((call) => call.where.includes("/liveChat/messages") && call.method === "DELETE");
    expect(deleted?.query.get("id")).toBe("LCC.Emessage01");
    expect(runtime.snapshot().modLog.map((entry) => entry.summary)).toEqual([
      "Example timed out Viewer for 1m on YouTube.",
      "Example deleted a message from Viewer on YouTube.",
      "Example unbanned Viewer on YouTube.",
    ]);

    internals.acceptChat(
      chat({
        id: "LCC.Eowner0001",
        platform: "youtube",
        username: "Example",
        displayName: "Example",
        authorId: OWNER,
        badges: [{ kind: "owner", label: "OWNER" }],
      }),
    );
    await expect(runtime.moderate({ action: "ban", messageId: "LCC.Eowner0001" })).rejects.toThrow(/broadcaster/);
  });
});

describe("desk mentions", () => {
  it("merges paged Twitch chatters with session names and skips a platform that is not enabled", async () => {
    const { runtime, calls, internals } = desk();
    internals.status.twitch = { ...internals.status.twitch, state: "connected" };
    internals.status.youtube = { ...internals.status.youtube, state: "live" };
    internals.acceptChat(chat({ id: "22222222-2222-2222-2222-222222222222", username: "bee", displayName: "Bee", authorId: "8" }));
    internals.acceptChat(
      chat({
        id: "LCC.Emessage02",
        platform: "youtube",
        username: "Dee",
        displayName: "Dee",
        authorId: VIEWER,
      }),
    );
    await internals.refreshChatters();
    expect(calls.filter((call) => call.where.endsWith("/chat/chatters")).map((call) => call.query.get("after") ?? "")).toEqual([
      "",
      "page-2",
    ]);
    const open = runtime.mentions("");
    expect(open.active.map((platform) => platform.id)).toEqual(["twitch"]);
    expect(open.suggestions.map((hit) => hit.name)).toEqual(expect.arrayContaining(["Bee", "Ace", "Cedar"]));
    expect(open.suggestions.some((hit) => hit.name === "Dee")).toBe(false);

    await runtime.updateSettings({ sendTargets: { twitch: true, youtube: true } });
    const both = runtime.mentions("d");
    expect(both.active.map((platform) => platform.id)).toEqual(["twitch", "youtube"]);
    expect(both.suggestions).toEqual([{ platform: "youtube", label: "YouTube", name: "Dee" }]);
    expect(runtime.mentions("ac").suggestions.map((hit) => hit.name)).toEqual(["Ace"]);
  });

  it("does not call Get Chatters when the login is missing moderator:read:chatters", async () => {
    const { runtime, calls, internals } = desk({ scopes: ["chat:read"] });
    internals.status.twitch = { ...internals.status.twitch, state: "connected" };
    await internals.refreshChatters();
    expect(calls.filter((call) => call.where.endsWith("/chat/chatters"))).toEqual([]);
    internals.acceptChat(chat({ username: "bee", displayName: "Bee", authorId: "8" }));
    expect(runtime.mentions("be").suggestions).toEqual([{ platform: "twitch", label: "Twitch", name: "Bee" }]);
  });
});
