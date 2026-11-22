import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrateLegacyConfig } from "../src/main/migrate-config";
import { buildAlertsPage } from "../src/main/redeems/overlay-page";
import { buildChatOverlayPage } from "../src/main/chat/page";
import { Logger } from "../src/main/logger";
import { OverlayServer } from "../src/main/server";

describe("config migration", () => {
  it("copies the Ember config into rascal and leaves the original in place", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-migrate-"));
    const ember = path.join(home, "ember");
    const secret = "access-TESTTOKEN-do-not-log";
    fs.mkdirSync(ember, { recursive: true });
    fs.writeFileSync(path.join(ember, "settings.json"), JSON.stringify({ twitchChannel: "examplechannel" }));
    fs.writeFileSync(path.join(ember, "bot-tokens.json"), JSON.stringify({ accessToken: secret }));
    fs.chmodSync(path.join(ember, "bot-tokens.json"), 0o600);
    fs.writeFileSync(path.join(ember, "chat-overlay.json"), "{\"presets\":[]}\n");
    const lines: string[] = [];
    const copied = migrateLegacyConfig(home);
    for (const item of copied) lines.push(`copied ${item.files} files from ${path.basename(item.from)}`);
    const log = lines.join("\n");
    expect(log).toContain("copied 3 files from ember");
    expect(log).not.toContain(secret);
    const dest = path.join(home, "rascal", "bot-tokens.json");
    expect(fs.readFileSync(dest, "utf8")).toContain(secret);
    expect(fs.statSync(dest).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(path.join(ember, "settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(home, "rascal", "chat-overlay.json"))).toBe(true);
    const again = migrateLegacyConfig(home);
    expect(again).toEqual([]);
  });
});

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
