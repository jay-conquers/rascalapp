import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Runtime } from "../src/main/runtime";
import type { AppEvent, ChatMessage, ModAction } from "../src/shared/types";
import { bodyOf, fetchRouter, json, type FetchHandler } from "./helpers/fetch-router";
import { tempDir, writeJson } from "./helpers/bot";

/** The desk runtime without starting its servers or sockets. */
function desk(options: { settings?: Record<string, unknown>; loggedIn?: boolean; handler?: FetchHandler } = {}) {
  const dir = tempDir("rascal-desk-");
  if (options.settings) writeJson(dir, "settings.json", options.settings);
  if (options.loggedIn) {
    writeJson(dir, "tokens.json", {
      clientId: "client1234567890",
      accessToken: "desk-access-TESTTOKEN",
      refreshToken: "desk-refresh-TESTTOKEN",
      expiresAt: Date.now() + 24 * 3600_000,
      scopes: ["chat:read", "user:write:chat"],
      userId: "42",
      login: "examplechannel",
    });
  }
  const { fetchImpl, calls } = fetchRouter(async (request) => {
    const handled = options.handler ? await options.handler(request) : undefined;
    if (handled) return handled;
    if (request.where === "api.twitch.tv/helix/chat/messages") return json({ data: [{ message_id: "m", is_sent: true }] });
    if (request.where === "api.twitch.tv/helix/users") return json({ data: [{ id: "77", login: request.query.get("login") }] });
    return undefined;
  });
  const runtime = new Runtime({ dir, version: "0.8.1", fetchImpl });
  const events: AppEvent[] = [];
  runtime.attachSender((event) => events.push(event));
  const internals = runtime as unknown as { acceptChat(message: ChatMessage): void; pushMod(action: ModAction): void };
  return { dir, runtime, events, calls, internals, types: () => events.map((event) => event.type) };
}

function chat(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: patch.id ?? `m-${Math.random()}`,
    platform: "twitch",
    channel: "examplechannel",
    username: "viewer",
    displayName: "Viewer",
    color: "#ffffff",
    badges: [],
    segments: [{ type: "text", text: patch.plainText ?? "hello" }],
    plainText: "hello",
    timestamp: Date.now(),
    kind: "chat",
    ...patch,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desk runtime snapshot", () => {
  it("starts with idle platforms, default settings, and an empty feed", () => {
    const { runtime } = desk();
    const snap = runtime.snapshot();
    expect(Object.keys(snap).sort()).toEqual(["auth", "chatOverlay", "login", "messages", "modLog", "redeems", "seq", "settings", "status", "stream", "version"]);
    expect(snap).toMatchObject({
      seq: 0,
      messages: [],
      modLog: [],
      stream: null,
      login: null,
      version: "0.8.1",
      auth: { loggedIn: false, login: null, userId: null, scopes: [], missingScopes: [], clientIdSet: false },
      status: {
        twitch: { state: "idle", detail: "Set a Twitch channel in Settings." },
        youtube: { state: "idle", detail: "Waiting to check YouTube" },
        overlay: { listening: false, host: "127.0.0.1", port: 4777 },
      },
      redeems: { status: "Starting…", overlayUrl: "http://127.0.0.1:4777/overlay/alerts", rewards: [], queue: { current: null, pending: [] } },
    });
    expect(snap.settings).toMatchObject({ twitchClientId: "", twitchChannel: "", overlayPort: 4777, sendTargets: { twitch: true, youtube: false } });
    expect(snap.chatOverlay.presets.map((preset) => preset.id)).toEqual(["default", "vertical"]);
  });

  it("names a configured channel as connecting before the reader starts", () => {
    const { runtime } = desk({ settings: { twitchChannel: "examplechannel" } });
    expect(runtime.snapshot().status.twitch).toEqual({ state: "connecting", detail: "Connecting to chat…" });
  });
});

describe("desk chat send", () => {
  it("checks the message, then sends to the signed-in channel with Helix", async () => {
    const { runtime, calls } = desk({ loggedIn: true });
    await expect(runtime.sendChat("   ")).rejects.toThrow("Message is empty.");
    await expect(runtime.sendChat("hi", { twitch: false, youtube: false })).rejects.toThrow("Pick Twitch or YouTube.");
    await expect(runtime.sendChat("x".repeat(501))).rejects.toThrow("Twitch messages stop at 500 characters.");
    await runtime.sendChat("  hello\r\nchat  ");
    const sent = calls.filter((call) => call.where === "api.twitch.tv/helix/chat/messages");
    expect(sent).toHaveLength(1);
    expect(bodyOf(sent[0])).toEqual({ broadcaster_id: "42", sender_id: "42", message: "hello\nchat" });
    expect(sent[0]?.headers.authorization).toBe("Bearer desk-access-TESTTOKEN");
    await expect(runtime.sendChat("again")).rejects.toThrow("Wait a moment before sending another message.");
  });

  it("looks up another configured channel and reports a dropped message", async () => {
    const { runtime, calls } = desk({
      loggedIn: true,
      settings: { twitchChannel: "otherchannel" },
      handler: (request) =>
        request.where === "api.twitch.tv/helix/chat/messages" ? json({ data: [{ is_sent: false, drop_reason: { message: "Your message was blocked." } }] }) : undefined,
    });
    await expect(runtime.sendChat("hi")).rejects.toThrow("Your message was blocked.");
    expect(bodyOf(calls.find((call) => call.where === "api.twitch.tv/helix/chat/messages"))).toMatchObject({ broadcaster_id: "77", sender_id: "42" });
  });

  it("skips quietly when nothing can take the message", async () => {
    const { runtime, calls } = desk();
    await expect(runtime.sendChat("hi")).resolves.toBeUndefined();
    await expect(runtime.sendChat("hi", { twitch: false, youtube: true })).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });
});

describe("desk chat intake", () => {
  it("adds chat, hides switched-off notices, and keeps the emote copy of a duplicate notice", () => {
    const { runtime, internals, types } = desk({ settings: { feed: { notices: { cheer: false } } } });
    internals.acceptChat(chat({ id: "a" }));
    internals.acceptChat(chat({ id: "cheer", kind: "system", noticeKind: "cheer", plainText: "100 bits" }));
    const plain = chat({ id: "resub-irc", kind: "system", noticeKind: "resub", username: "fan", notice: "fan resubscribed", plainText: "fan resubscribed" });
    internals.acceptChat(plain);
    internals.acceptChat({
      ...plain,
      id: "resub-eventsub",
      segments: [{ type: "emote", text: "Kappa", url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0", source: "twitch" }],
    });
    internals.acceptChat({ ...plain, id: "resub-third" });
    expect(types()).toEqual(["chat", "chat", "chat-replace"]);
    const messages = runtime.snapshot().messages;
    expect(messages.map((message) => message.id)).toEqual(["a", "resub-irc"]);
    expect(messages[1]?.segments[0]).toMatchObject({ type: "emote", text: "Kappa" });
  });

  it("chimes for a viewer, but not for the signed-in channel, an old line, or inside the cooldown", () => {
    const { internals, types } = desk({ loggedIn: true, settings: { chatAlert: { enabled: true, cooldownMs: 60_000 } } });
    internals.acceptChat(chat({ id: "own", username: "examplechannel", displayName: "examplechannel", authorId: "42" }));
    internals.acceptChat(chat({ id: "history", timestamp: Date.now() - 60_000 }));
    internals.acceptChat(chat({ id: "viewer" }));
    internals.acceptChat(chat({ id: "viewer-2" }));
    expect(types()).toEqual(["chat", "chat", "chat-alert", "chat", "chat"]);
  });

  it("keeps a private mod log, ignores repeats, and clears it when the log is switched off", async () => {
    const { runtime, internals, types } = desk();
    const action: ModAction = { id: "mod-1", platform: "twitch", channel: "examplechannel", timestamp: 1, action: "timeout", actor: "Mod", target: "Troll", durationSeconds: 60, reason: "", summary: "Mod timed out Troll." };
    internals.pushMod(action);
    internals.pushMod(action);
    expect(runtime.snapshot().modLog).toEqual([action]);
    const settings = runtime.snapshot().settings;
    await runtime.updateSettings({ feed: { ...settings.feed, modLog: false } });
    internals.pushMod({ ...action, id: "mod-2" });
    expect(runtime.snapshot().modLog).toEqual([]);
    expect(types()).toEqual(["mod-log", "mod-log-clear", "auth"]);
  });
});

describe("desk settings and bot link", () => {
  it("rejects a bad setting and logs out when the Twitch client id changes", async () => {
    const { runtime, dir } = desk({ loggedIn: true, settings: { twitchClientId: "client1234567890" } });
    await expect(runtime.updateSettings({ twitchClientId: "bad id" })).rejects.toThrow("That client ID does not look like a Twitch client ID.");
    expect(runtime.snapshot().auth.loggedIn).toBe(true);
    await runtime.updateSettings({ twitchClientId: "other1234567890" });
    expect(runtime.snapshot().auth.loggedIn).toBe(false);
    expect(fs.existsSync(path.join(dir, "tokens.json"))).toBe(false);
  });

  it("validates the server link and talks to a server bot with the admin token", async () => {
    const { runtime } = desk();
    expect(runtime.botLink()).toEqual({ mode: "embedded", serverUrl: "", tokenSet: false });
    await expect(Promise.resolve().then(() => runtime.botState())).rejects.toThrow("The local bot is not running. Switch back to embedded mode.");
    await expect(runtime.saveBotLink({ mode: "server", serverUrl: "http://bot.example.com", adminToken: "t".repeat(20) })).rejects.toThrow(
      "The bot server URL must be https, except on localhost.",
    );
    await expect(runtime.saveBotLink({ mode: "server", serverUrl: "https://bot.example.com", adminToken: "short" })).rejects.toThrow(
      "The admin token needs at least 16 characters.",
    );
    const saved = await runtime.saveBotLink({ mode: "server", serverUrl: "https://bot.example.com/portal", adminToken: "t".repeat(20) });
    expect(saved).toEqual({ mode: "server", serverUrl: "https://bot.example.com", tokenSet: true });
    const remote = fetchRouter((request) => {
      if (request.headers.authorization !== `Bearer ${"t".repeat(20)}`) return json({ error: "Missing bot API key." }, 401);
      if (request.where === "bot.example.com/api/state") return json({ connected: true, botLogin: "rascalbot" });
      if (request.where === "bot.example.com/api/commands") return json({ error: "That command needs a name and a response." }, 500);
      return undefined;
    });
    vi.stubGlobal("fetch", remote.fetchImpl);
    await expect(runtime.botState()).resolves.toMatchObject({ connected: true, botLogin: "rascalbot" });
    await expect(runtime.botSaveCommand({})).rejects.toThrow("That command needs a name and a response.");
    expect(bodyOf(remote.calls.find((call) => call.where === "bot.example.com/api/commands"))).toEqual({});
    vi.stubGlobal("fetch", (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch);
    await expect(runtime.botState()).rejects.toThrow("Can't reach the bot server at https://bot.example.com.");
    vi.stubGlobal("fetch", (async () => json({}, 401)) as typeof fetch);
    await expect(runtime.botState()).rejects.toThrow("The bot server rejected the admin token.");
    vi.stubGlobal("fetch", (async () => json({}, 502)) as typeof fetch);
    await expect(runtime.botState()).rejects.toThrow("The bot server returned HTTP 502.");
  });
});
