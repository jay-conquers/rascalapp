import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BotStore } from "./helpers/bot";
import { normalizeBotFile } from "../packages/bot/src/model";
import { SettingsStore } from "../src/main/settings";
import { TokenStore } from "../src/main/tokens";
import { normalizeChatOverlayFile } from "../src/shared/chat-overlay";
import { loadRedeemFile, saveRedeemFile } from "../src/main/redeems/store";

/**
 * Golden files for every config file an existing install can have on disk.
 * `<name>.json` is what an older build or a hand edit left behind; `<name>.expected.json`
 * is what the current loader turns it into. These must not change without a migration.
 */
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "config");

function fixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
}

function inputs(prefix: string): string[] {
  return fs
    .readdirSync(FIXTURES)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json") && !name.includes(".expected."))
    .sort();
}

function expected(name: string): unknown {
  return fixture(name.replace(/\.json$/, ".expected.json"));
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rascal-config-"));
}

describe("bot.json", () => {
  it.each(inputs("bot-"))("loads %s unchanged from the golden file", (name) => {
    expect(normalizeBotFile(fixture(name))).toEqual(expected(name));
  });

  it.each(inputs("bot-"))("loads %s through the store and saves it back the same way", (name) => {
    const dir = tempDir();
    fs.copyFileSync(path.join(FIXTURES, name), path.join(dir, "bot.json"));
    const store = new BotStore(dir);
    const loaded = store.loadConfig();
    expect(loaded).toEqual(expected(name));
    store.saveConfig(loaded);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "bot.json"), "utf8"))).toEqual(expected(name));
    expect(normalizeBotFile(loaded)).toEqual(loaded);
  });

  it("falls back to defaults for a missing, empty, or non-object file", () => {
    const defaults = normalizeBotFile(undefined);
    for (const value of [null, [], "text", 7, {}]) expect(normalizeBotFile(value)).toEqual(defaults);
    const dir = tempDir();
    expect(new BotStore(dir).loadConfig()).toEqual(defaults);
    fs.writeFileSync(path.join(dir, "bot.json"), "{ not json");
    expect(new BotStore(dir).loadConfig()).toEqual(defaults);
  });
});

describe("settings.json", () => {
  it.each(inputs("settings-"))("loads %s unchanged from the golden file", (name) => {
    const dir = tempDir();
    fs.copyFileSync(path.join(FIXTURES, name), path.join(dir, "settings.json"));
    expect(new SettingsStore(dir).load()).toEqual(expected(name));
  });
});

describe("chat-overlay.json and redeems.json", () => {
  it.each(inputs("chat-overlay-"))("loads %s unchanged from the golden file", (name) => {
    expect(normalizeChatOverlayFile(fixture(name))).toEqual(expected(name));
  });

  it.each(inputs("redeems-"))("loads %s unchanged from the golden file and saves it back", (name) => {
    const loaded = loadRedeemFile(path.join(FIXTURES, name), "/fallback/sounds");
    expect(loaded).toEqual(expected(name));
    const file = path.join(tempDir(), "redeems.json");
    saveRedeemFile(file, loaded);
    expect(loadRedeemFile(file, "/other")).toEqual(expected(name));
  });
});

describe("token files", () => {
  const complete = {
    clientId: "client1234567890",
    accessToken: "access-TESTTOKEN",
    refreshToken: "refresh-TESTTOKEN",
    expiresAt: 1_900_000_000_000,
    scopes: ["chat:read"],
    userId: "42",
    login: "examplechannel",
  };

  it("needs a complete desk login in tokens.json, while the bot reads the same file leniently", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify(complete));
    expect(new TokenStore(dir).current).toEqual(complete);
    expect(new BotStore(dir).loadDeskTwitchTokens()).toEqual(complete);
    const partial = { accessToken: "a", refreshToken: "r" };
    fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify(partial));
    expect(new TokenStore(dir).current).toBeNull();
    expect(new BotStore(dir).loadDeskTwitchTokens()).toEqual({ clientId: "", accessToken: "a", refreshToken: "r", expiresAt: 0, scopes: [], userId: "", login: "" });
  });

  it("reads the bot and YouTube session files and the Google client", () => {
    const dir = tempDir();
    const store = new BotStore(dir);
    expect(store.loadTokens()).toBeNull();
    expect(store.loadYoutubeTokens()).toBeNull();
    expect(store.loadGoogleClient()).toEqual({ clientId: "", clientSecret: "" });
    fs.writeFileSync(path.join(dir, "bot-youtube-tokens.json"), JSON.stringify({ accessToken: "ya29.a", refreshToken: "r", scopes: ["s", 1] }));
    expect(store.loadYoutubeTokens()).toEqual({ clientId: "", accessToken: "ya29.a", refreshToken: "r", expiresAt: 0, scopes: ["s"], channelId: "", title: "" });
    fs.writeFileSync(path.join(dir, "google-client.json"), JSON.stringify({ clientId: "  id  ", clientSecret: 5 }));
    expect(store.loadGoogleClient()).toEqual({ clientId: "id", clientSecret: "" });
  });

  it("keeps stored bot secrets, generates missing ones, and prefers the environment", () => {
    const dir = tempDir();
    const first = new BotStore(dir).loadSecrets();
    expect(first.apiKey.length).toBeGreaterThanOrEqual(16);
    expect(first.sessionSecret.length).toBeGreaterThanOrEqual(16);
    expect(new BotStore(dir).loadSecrets()).toEqual(first);
    fs.writeFileSync(path.join(dir, "bot-secrets.json"), JSON.stringify({ apiKey: "short", sessionSecret: "s".repeat(20), seJwt: "jwt" }));
    const replaced = new BotStore(dir).loadSecrets();
    expect(replaced.apiKey).not.toBe("short");
    expect(replaced).toMatchObject({ sessionSecret: "s".repeat(20), seJwt: "jwt" });
    process.env.RASCAL_BOT_API_KEY = "k".repeat(24);
    try {
      expect(new BotStore(dir).loadSecrets().apiKey).toBe("k".repeat(24));
    } finally {
      delete process.env.RASCAL_BOT_API_KEY;
    }
  });
});
