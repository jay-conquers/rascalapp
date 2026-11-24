import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { youtubeDesk } from "../src/main/youtube/desk";
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
