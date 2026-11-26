import { describe, expect, it } from "vitest";
import { buildAlertsPage } from "../src/main/redeems/overlay-page";
import { buildChatOverlayPage } from "../src/main/chat/page";
import { Logger } from "../src/main/logger";
import { OverlayServer } from "../src/main/server";

describe("overlay urls", () => {
  it("still serves /overlay/alerts and /overlay/chat", async () => {
    const server = new OverlayServer(() => [], new Logger(null));
    const alerts = buildAlertsPage("0.5.0");
    const chat = buildChatOverlayPage("0.5.0");
    server.registerRoute("GET", "/overlay/alerts", (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(alerts.html);
    });
    server.registerRoute("GET", "/overlay/chat", (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(chat.html);
    });
    const port = await server.start(0);
    const alertsPage = await fetch(`http://127.0.0.1:${port}/overlay/alerts`);
    const chatPage = await fetch(`http://127.0.0.1:${port}/overlay/chat`);
    expect(alertsPage.status).toBe(200);
    expect(chatPage.status).toBe(200);
    expect(await alertsPage.text()).toContain("Rascal alerts");
    expect(await chatPage.text()).toContain("Rascal chat");
    expect(alertsPage.headers.get("cache-control")).toBe("no-store");
    await server.stop();
  });
});
