import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { redact } from "../src/shared/redact";
import { assertAllowedExternal } from "../src/main/browser";
import { Logger } from "../src/main/logger";
import { writePrivateJson } from "../src/main/private-file";
import { mergeSettings, SettingsStore } from "../src/main/settings";
import { TokenStore } from "../src/main/tokens";
import { DEFAULT_SETTINGS } from "../src/main/settings";

describe("secret handling", () => {
  it("redacts oauth material and leaves ordinary text alone", () => {
    const raw =
      'Authorization: Bearer access-TESTTOKEN oauth:refresh-TESTTOKEN {"access_token":"access-TESTTOKEN","refresh_token":"refresh-TESTTOKEN"} device_code=device-TEST';
    const cleaned = redact(raw);
    expect(cleaned).not.toContain("access-TESTTOKEN");
    expect(cleaned).not.toContain("refresh-TESTTOKEN");
    expect(cleaned).not.toContain("device-TEST");
    expect(cleaned).toContain("[redacted]");
    expect(redact("joined #examplechannel")).toBe("joined #examplechannel");
  });

  it("writes settings and tokens as mode 0600 in a 0700 directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ember-secret-"));
    const settings = new SettingsStore(dir);
    settings.update({ twitchClientId: "abc1234567890xyz" });
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(settings.file).mode & 0o777).toBe(0o600);

    const tokens = new TokenStore(dir);
    tokens.save({
      clientId: "abc1234567890xyz",
      accessToken: "access-TESTTOKEN",
      refreshToken: "refresh-TESTTOKEN",
      expiresAt: Date.now() + 60_000,
      scopes: ["chat:read"],
      userId: "1",
      login: "examplechannel",
    });
    expect(fs.statSync(tokens.file).mode & 0o777).toBe(0o600);
    expect(tokens.current?.login).toBe("examplechannel");
    tokens.clear();
    expect(fs.existsSync(tokens.file)).toBe(false);

    const log = new Logger(path.join(dir, "logs", "rascal.log"));
    log.info("session ready", { note: "oauth:should-not-leak" });
    const logText = fs.readFileSync(path.join(dir, "logs", "rascal.log"), "utf8");
    expect(logText).not.toContain("should-not-leak");
    expect(fs.statSync(path.join(dir, "logs", "rascal.log")).mode & 0o777).toBe(0o600);
  });

  it("tightens a token file that was left group-readable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ember-mode-"));
    const file = path.join(dir, "tokens.json");
    writePrivateJson(file, { accessToken: "x" });
    fs.chmodSync(file, 0o640);
    new TokenStore(dir);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("rejects a bad channel id without replacing a valid one", () => {
    expect(() => mergeSettings(DEFAULT_SETTINGS, { youtubeChannelId: "not-a-channel" })).toThrow(/YouTube channel ID/);
    expect(DEFAULT_SETTINGS.twitchChannel).toBe("");
    expect(DEFAULT_SETTINGS.youtubeChannelId).toBe("");
    expect(mergeSettings(DEFAULT_SETTINGS, {}).twitchChannel).toBe("");
    expect(mergeSettings(DEFAULT_SETTINGS, { twitchChannel: "#ExampleChannel" }).twitchChannel).toBe("examplechannel");
  });

  it("only opens Twitch console and activate links", () => {
    expect(assertAllowedExternal("https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH")).toContain(
      "twitch.tv/activate",
    );
    expect(assertAllowedExternal("https://dev.twitch.tv/console/apps")).toBe("https://dev.twitch.tv/console/apps");
    expect(() => assertAllowedExternal("https://evil.example/activate")).toThrow(/cannot be opened/);
    expect(() => assertAllowedExternal("https://www.twitch.tv/examplechannel")).toThrow(/cannot be opened/);
  });
});
