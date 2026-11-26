import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatBus } from "../src/main/chat-bus";
import { ChatOverlayEngine } from "../src/main/stages/chat";
import { Logger } from "../src/main/logger";
import { buildChatOverlayPage } from "../src/main/chat/page";
import { overlayHelloMessage, overlayShouldReload } from "../src/main/redeems/overlay-page";
import { OverlayServer } from "../src/main/server";
import { SettingsStore } from "../src/main/settings";
import {
  chatBoxRect,
  chatFlow,
  defaultChatOverlayFile,
  legacyChatBox,
  projectChatOverlay,
  resolvePreset,
  type ChatOverlayStyle,
} from "../src/shared/chat-overlay";
import type { ChatMessage } from "../src/shared/types";
import type { AppContext } from "../src/main/stages/types";

const now = 1_700_000_000_000;

function message(patch: Partial<ChatMessage> & Pick<ChatMessage, "id" | "plainText">): ChatMessage {
  return {
    platform: "twitch",
    channel: "examplechannel",
    username: patch.username ?? "ace",
    displayName: patch.displayName ?? "Ace",
    color: "#bf94ff",
    badges: [{ kind: "sub", label: "SUB", detail: "3" }],
    segments: patch.segments ?? [{ type: "text", text: patch.plainText }],
    timestamp: now,
    kind: "chat",
    ...patch,
  };
}

describe("chat overlay renderer", () => {
  const style = defaultChatOverlayFile().presets[0] as ChatOverlayStyle;

  it("keeps emotes and badge images, and drops text badges, deleted, hidden, and command lines", () => {
    const lines = projectChatOverlay(
      [
        message({
          id: "emote",
          plainText: "hello Pog",
          badges: [{ kind: "sub", label: "SUB", detail: "41", set: "subscriber", version: "12" }],
          segments: [
            { type: "text", text: "hello " },
            { type: "emote", text: "Pog", url: "https://cdn.betterttv.net/emote/pog/2x", source: "bttv" },
            { type: "emote", text: "nope", url: "http://evil.example/x", source: "twitch" },
          ],
        }),
        message({ id: "gone", plainText: "deleted", deleted: true }),
        message({ id: "bot", username: "Nightbot", displayName: "Nightbot", plainText: "bot" }),
        message({ id: "cmd", plainText: "!play" }),
        message({
          id: "yt",
          platform: "youtube",
          username: "owner",
          displayName: "Owner",
          plainText: "hi",
          badges: [
            { kind: "owner", label: "OWNER" },
            { kind: "member", label: "MEMBER", imageUrl: "https://yt3.ggpht.com/member-badge" },
            { kind: "other", label: "X", imageUrl: "https://evil.example/badge.png" },
          ],
          color: "#ff8a4a",
        }),
      ],
      style,
      now,
      (badge) => (badge.set === "subscriber" && badge.version === "12" ? "https://static-cdn.jtvnw.net/badges/v1/sub/2" : badge.imageUrl ?? null),
    );
    expect(lines.map((line) => line.id)).toEqual(["emote", "yt"]);
    expect(lines[0]?.parts).toEqual([
      { type: "text", text: "hello " },
      { type: "emote", text: "Pog", url: "https://cdn.betterttv.net/emote/pog/2x", source: "bttv" },
      { type: "text", text: "nope" },
    ]);
    expect(lines[0]?.badges).toEqual([{ url: "https://static-cdn.jtvnw.net/badges/v1/sub/2" }]);
    expect(JSON.stringify(lines[0])).not.toContain("SUB");
    expect(lines[0]?.nameColor).toBe("#bf94ff");
    expect(lines[1]?.badges).toEqual([{ url: "https://yt3.ggpht.com/member-badge" }]);
  });

  it("honours presets, direction, lifetime, and a custom hidden name", () => {
    const file = defaultChatOverlayFile();
    expect(resolvePreset(file, "vertical").widthPercent).toBe(78);
    expect(resolvePreset(file, "vertical").box.preset).toBe("left-column");
    expect(chatBoxRect(resolvePreset(file, "default").box)).toEqual({ left: 1632, top: 0, width: 288, height: 1080 });
    expect(legacyChatBox(32, "left").preset).toBe("left-column");
    expect(chatBoxRect(legacyChatBox(32, "right")).left).toBeGreaterThan(1000);
    expect(chatBoxRect({ preset: "custom", sizePercent: 15, marginPercent: 0, x: 85, y: 0, width: 15, height: 100, unit: "percent" })).toEqual({
      left: 1632,
      top: 0,
      width: 288,
      height: 1080,
    });
    expect(resolvePreset(file, "missing").id).toBe("default");
    expect(resolvePreset(file, "../vertical").id).toBe("vertical");

    const bottom = projectChatOverlay(
      [message({ id: "a", plainText: "a" }), message({ id: "b", plainText: "b" })],
      { ...style, maxMessages: 1 },
      now,
    );
    expect(bottom.map((line) => line.id)).toEqual(["b"]);

    const top = projectChatOverlay(
      [message({ id: "a", plainText: "a" }), message({ id: "b", plainText: "b" })],
      { ...style, direction: "top", hideCommands: false, hiddenUsers: [] },
      now,
    );
    expect(top.map((line) => line.id)).toEqual(["b", "a"]);

    const fillDown = projectChatOverlay(
      [message({ id: "a", plainText: "a" }), message({ id: "b", plainText: "b" }), message({ id: "c", plainText: "c" })],
      { ...style, direction: "down", maxMessages: 2, hideCommands: false, hiddenUsers: [] },
      now,
    );
    expect(fillDown.map((line) => line.id)).toEqual(["b", "c"]);
    expect(chatFlow("bottom")).toEqual({ reverse: false, anchor: "end", scrollToEnd: false });
    expect(chatFlow("down")).toEqual({ reverse: false, anchor: "start", scrollToEnd: true });
    expect(chatFlow("top")).toEqual({ reverse: true, anchor: "start", scrollToEnd: false });

    const fading = projectChatOverlay(
      [message({ id: "old", plainText: "old", timestamp: now - 19_500 })],
      { ...style, lifetimeSeconds: 20, hiddenUsers: [] },
      now,
    );
    expect(fading[0]?.opacity).toBeLessThan(1);
    expect(fading[0]?.opacity).toBeGreaterThan(0);
    const expired = projectChatOverlay(
      [message({ id: "old", plainText: "old", timestamp: now - 20_000 })],
      { ...style, lifetimeSeconds: 20, hiddenUsers: [] },
      now,
    );
    expect(expired).toEqual([]);

    const named = projectChatOverlay(
      [message({ id: "tts", username: "exampletts", displayName: "ExampleTTS", plainText: "spoken" })],
      { ...style, hiddenUsers: ["exampletts"] },
      now,
    );
    expect(named).toEqual([]);

    const customName = projectChatOverlay([message({ id: "n", plainText: "hi" })], { ...style, useAuthorColor: false, nameColor: "#112233" }, now);
    expect(customName[0]?.nameColor).toBe("#112233");
    const noBadges = projectChatOverlay([message({ id: "n", plainText: "hi" })], { ...style, showBadges: false }, now);
    expect(noBadges[0]?.badges).toEqual([]);
  });
});

describe("chat overlay page handshake", () => {
  it("bakes the build hash and reloads when the server hash differs", () => {
    const page = buildChatOverlayPage("0.3.0");
    expect(page.html).toContain(`const OVERLAY_HASH = "${page.hash}"`);
    expect(page.html).toContain('const OVERLAY_VERSION = "0.3.0"');
    expect(page.html).toContain("no-store");
    expect(page.html).toContain("/ws/overlay-chat");
    expect(page.html).toContain("location.reload");
    expect(overlayShouldReload(page.hash, overlayHelloMessage("0.3.0", page.hash))).toBe(false);
    expect(overlayShouldReload(page.hash, overlayHelloMessage("0.3.0", "stale-page"))).toBe(true);
  });
});

describe("chat overlay socket", () => {
  const dirs: string[] = [];
  const servers: OverlayServer[] = [];
  const engines: ChatOverlayEngine[] = [];

  afterEach(async () => {
    for (const engine of engines) await engine.stop();
    engines.length = 0;
    for (const server of servers) await server.stop();
    servers.length = 0;
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("serves the page with no-store and pushes a filtered frame", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-chat-"));
    dirs.push(dir);
    const bus = new ChatBus();
    const server = new OverlayServer(() => bus.messages, new Logger(null));
    servers.push(server);
    const port = await server.start(0);
    const engine = new ChatOverlayEngine(fakeContext(dir, bus, server));
    engines.push(engine);
    await engine.start();

    const page = await fetch(`http://127.0.0.1:${port}/overlay/chat`);
    expect(page.headers.get("cache-control")).toBe("no-store");
    const html = await page.text();
    expect(html).toContain(engine.overlayHash);

    bus.push(message({ id: "live", plainText: "on stream", timestamp: Date.now() }));
    bus.push(message({ id: "bot", username: "nightbot", displayName: "Nightbot", plainText: "nope", timestamp: Date.now() }));
    bus.delete("live");

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/overlay-chat?preset=vertical`);
    const frames: { type?: string; overlayHash?: string; lines?: { id: string }[]; style?: { id: string } }[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("overlay socket timed out")), 4000);
      ws.addEventListener("message", (event) => {
        frames.push(JSON.parse(String(event.data)) as { type?: string; lines?: { id: string }[]; style?: { id: string } });
        const frame = frames.find((item) => item.type === "chat-frame" && item.style?.id === "vertical");
        if (frame && !frame.lines?.some((line) => line.id === "live" || line.id === "bot")) {
          clearTimeout(timer);
          resolve();
        }
      });
      ws.addEventListener("error", () => reject(new Error("overlay socket failed")));
    });
    expect(frames.some((frame) => frame.type === "hello" && frame.overlayHash === engine.overlayHash)).toBe(true);
    ws.close();
  });
});

function fakeContext(dir: string, chat: ChatBus, server: OverlayServer): AppContext {
  return {
    log: new Logger(null),
    settings: new SettingsStore(dir),
    tokens: {} as AppContext["tokens"],
    chat,
    server,
    helix: {} as AppContext["helix"],
    auth: {} as AppContext["auth"],
    emit: () => {},
    version: "0.3.2",
    badgeImage: () => null,
  };
}
