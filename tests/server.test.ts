import { describe, expect, it } from "vitest";
import { Logger } from "../src/main/logger";
import { OverlayServer } from "../src/main/server";
import type { ChatMessage } from "../src/shared/types";

const sample: ChatMessage = {
  id: "m1",
  platform: "twitch",
  channel: "examplechannel",
  username: "ace",
  displayName: "Ace",
  color: "#ffffff",
  badges: [],
  segments: [{ type: "text", text: "hi" }],
  plainText: "hi",
  timestamp: 1,
  kind: "chat",
};

describe("overlay server", () => {
  it("serves health, recent chat, a stage route, and websocket events on loopback", async () => {
    const server = new OverlayServer(() => [sample], new Logger(null));
    server.registerRoute("GET", "/overlays/redeem", (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("stage2");
    });
    const port = await server.start(0);
    expect(port).toBeGreaterThan(0);

    const health = await fetch(`http://127.0.0.1:${port}/health`).then((res) => res.json());
    expect(health).toMatchObject({ ok: true, service: "rascal", stage: 1 });

    const recent = await fetch(`http://127.0.0.1:${port}/api/chat/recent`).then((res) => res.json());
    expect(recent.messages[0].plainText).toBe("hi");

    const slot = await fetch(`http://127.0.0.1:${port}/overlays/redeem`).then((res) => res.text());
    expect(slot).toBe("stage2");

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const received: string[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("message", (event) => {
        received.push(String(event.data));
        if (received.some((line) => line.includes("\"type\":\"ping\""))) resolve();
      });
      ws.addEventListener("error", () => reject(new Error("websocket failed")));
      ws.addEventListener("open", () => server.broadcast({ type: "ping", ok: true }));
    });
    expect(received.some((line) => line.includes("\"stage\":1"))).toBe(true);
    expect(received.some((line) => line.includes("\"type\":\"snapshot\""))).toBe(true);
    ws.close();
    await server.stop();
  });
});
