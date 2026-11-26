import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "../src/main/settings";
import {
  CHAT_ALWAYS_NOTE,
  DESK_TABS,
  TABS_SUMMARY,
  defaultTabs,
  parseTabs,
  platformGateNote,
  resolveDeskView,
  setTabShown,
  tabChosen,
  tabInBar,
  tabsFromPatch,
  tabsPlatformSummary,
  type TabSettings,
} from "../src/shared/desk-tabs";
import type { PlatformSelection } from "../src/shared/platform/selection";

const BOTH: PlatformSelection = { confirmed: true, enabled: ["twitch", "youtube"] };
const YOUTUBE_ONLY: PlatformSelection = { confirmed: true, enabled: ["youtube"] };
const TWITCH_ONLY: PlatformSelection = { confirmed: true, enabled: ["twitch"] };

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rascal-tabs-"));
}

function writeJson(dir: string, name: string, value: unknown): void {
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

describe("desk tab rules", () => {
  it("lists Chat first and locks it, then the panels that can be hidden", () => {
    expect(DESK_TABS.map((tab) => tab.id)).toEqual(["chat", "redeems", "stream", "overlay", "tts", "bot"]);
    expect(DESK_TABS[0]).toMatchObject({ label: "Chat", view: "desk", locked: true });
    expect(DESK_TABS.find((tab) => tab.id === "redeems")).toMatchObject({ label: "Redeems", view: "redeems", platform: "twitch" });
    expect(DESK_TABS.find((tab) => tab.id === "overlay")).toMatchObject({ label: "Chat overlay", view: "chat" });
    expect(defaultTabs()).toEqual({ hidden: [] });
    expect(TABS_SUMMARY).toMatch(/Chat always stays/);
    expect(TABS_SUMMARY).toMatch(/bot, overlays, and connections keep running/);
    expect(tabsPlatformSummary()).toMatch(/Redeems is also hidden while Twitch is turned off/);
    expect(tabsPlatformSummary()).toMatch(/unless it is hidden here/);
    expect(CHAT_ALWAYS_NOTE).toBe("Chat always shows.");
  });

  it("refuses to hide Chat and drops unknown ids", () => {
    const shown = defaultTabs();
    expect(setTabShown(shown, "chat", false)).toEqual({ hidden: [] });
    expect(setTabShown({ hidden: ["bot"] }, "chat", false)).toEqual({ hidden: ["bot"] });
    expect(tabChosen({ hidden: ["chat", "bot"] }, "chat")).toBe(true);
    expect(tabInBar({ hidden: ["chat"] }, BOTH, "chat")).toBe(true);
    expect(parseTabs({ hidden: ["chat", "bot", "nope", "bot"] })).toEqual({ hidden: ["bot"] });
    expect(parseTabs({ chat: false, bot: false, kick: false })).toEqual({ hidden: ["bot"] });
    expect(parseTabs({ hidden: [], bot: false })).toEqual({ hidden: [] });
    expect(setTabShown(shown, "not-a-tab", false)).toEqual({ hidden: [] });
    const hidden = setTabShown(setTabShown(shown, "bot", false), "tts", false);
    expect(hidden).toEqual({ hidden: ["tts", "bot"] });
    expect(setTabShown(hidden, "tts", true)).toEqual({ hidden: ["bot"] });
    expect(shown).toEqual({ hidden: [] });
  });

  it("treats a missing or broken value as every tab shown", () => {
    for (const value of [undefined, null, [], "bot", 7, {}, { hidden: "bot" }, { hidden: [1, false] }]) {
      expect(parseTabs(value)).toEqual({ hidden: [] });
    }
    expect(tabsFromPatch({ hidden: ["stream"] }, undefined)).toEqual({ hidden: ["stream"] });
    expect(tabsFromPatch({ hidden: ["chat", "stream"] }, undefined)).toEqual({ hidden: ["stream"] });
    expect(tabsFromPatch({ hidden: ["bot"] }, { hidden: ["overlay"] })).toEqual({ hidden: ["overlay"] });
  });

  it("keeps a user-hidden tab hidden across the platform picker, and leaves the saved list alone", () => {
    const chosen: TabSettings = { hidden: [] };
    expect(tabInBar(chosen, BOTH, "redeems")).toBe(true);
    expect(tabInBar(chosen, YOUTUBE_ONLY, "redeems")).toBe(false);
    expect(tabChosen(chosen, "redeems")).toBe(true);
    expect(chosen.hidden).toEqual([]);
    expect(platformGateNote(DESK_TABS.find((tab) => tab.id === "redeems")!, chosen, YOUTUBE_ONLY)).toBe("Hidden while Twitch is off.");
    expect(platformGateNote(DESK_TABS.find((tab) => tab.id === "redeems")!, chosen, BOTH)).toBe("");

    const hidden: TabSettings = { hidden: ["redeems"] };
    expect(tabInBar(hidden, YOUTUBE_ONLY, "redeems")).toBe(false);
    expect(tabInBar(hidden, TWITCH_ONLY, "redeems")).toBe(false);
    expect(tabInBar(hidden, BOTH, "redeems")).toBe(false);
    expect(platformGateNote(DESK_TABS.find((tab) => tab.id === "redeems")!, hidden, YOUTUBE_ONLY)).toBe("Stays hidden after Twitch is turned back on.");
    expect(tabInBar(hidden, YOUTUBE_ONLY, "bot")).toBe(true);
    expect(tabInBar(hidden, YOUTUBE_ONLY, "stream")).toBe(true);
  });

  it("falls back to Chat when the open tab is hidden or its platform is off", () => {
    expect(resolveDeskView("bot", { hidden: ["bot"] }, BOTH)).toBe("desk");
    expect(resolveDeskView("tts", { hidden: [] }, BOTH)).toBe("tts");
    expect(resolveDeskView("chat", { hidden: ["overlay"] }, BOTH)).toBe("desk");
    expect(resolveDeskView("redeems", { hidden: [] }, YOUTUBE_ONLY)).toBe("desk");
    expect(resolveDeskView("redeems", { hidden: ["redeems"] }, BOTH)).toBe("desk");
    expect(resolveDeskView("redeems", { hidden: [] }, BOTH)).toBe("redeems");
    expect(resolveDeskView("desk", { hidden: ["chat", "bot"] }, BOTH)).toBe("desk");
    expect(resolveDeskView("settings", { hidden: ["bot", "tts", "stream", "overlay", "redeems"] }, YOUTUBE_ONLY)).toBe("settings");
    expect(resolveDeskView("nope", { hidden: [] }, BOTH)).toBe("desk");
  });
});

describe("desk tab storage", () => {
  it("shows every tab for a fresh install and for an older file with no saved choice", () => {
    const fresh = tempDir();
    const loaded = new SettingsStore(fresh).load();
    expect(loaded.tabs).toEqual({ hidden: [] });
    expect(fs.existsSync(path.join(fresh, "settings.json"))).toBe(false);

    const upgraded = tempDir();
    const older = { twitchChannel: "examplechannel", youtubeChannelId: "UCexamplechannel00000001", platforms: { confirmed: true, enabled: ["twitch", "youtube"] } };
    writeJson(upgraded, "settings.json", older);
    const before = fs.readFileSync(path.join(upgraded, "settings.json"), "utf8");
    const migrated = new SettingsStore(upgraded).load();
    expect(migrated.tabs).toEqual({ hidden: [] });
    expect(migrated.platforms).toEqual({ confirmed: true, enabled: ["twitch", "youtube"] });
    expect(fs.readFileSync(path.join(upgraded, "settings.json"), "utf8")).toBe(before);
  });

  it("persists a hidden list across a reload and leaves platforms, logins, and other settings in place", () => {
    const dir = tempDir();
    writeJson(dir, "settings.json", {
      twitchChannel: "examplechannel",
      youtubeChannelId: "UCexamplechannel00000001",
      platforms: { confirmed: true, enabled: ["twitch", "youtube"] },
    });
    writeJson(dir, "tokens.json", { accessToken: "desk-access", login: "examplechannel" });
    writeJson(dir, "youtube-tokens.json", { accessToken: "ya29.token", channelId: "UCexamplechannel00000001" });
    const store = new SettingsStore(dir);
    const saved = store.update({ tabs: { hidden: ["chat", "bot", "tts", "nope", "bot"] } });
    expect(saved.tabs).toEqual({ hidden: ["tts", "bot"] });
    expect(saved.platforms).toEqual({ confirmed: true, enabled: ["twitch", "youtube"] });
    expect(saved.twitchChannel).toBe("examplechannel");
    expect(saved.youtubeChannelId).toBe("UCexamplechannel00000001");
    const again = new SettingsStore(dir).load();
    expect(again.tabs).toEqual({ hidden: ["tts", "bot"] });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")).tabs).toEqual({ hidden: ["tts", "bot"] });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "tokens.json"), "utf8")).login).toBe("examplechannel");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "youtube-tokens.json"), "utf8")).accessToken).toBe("ya29.token");

    const platforms = store.update({ platforms: { confirmed: true, enabled: ["youtube"] } });
    expect(platforms.tabs).toEqual({ hidden: ["tts", "bot"] });
    expect(platforms.platforms).toEqual({ confirmed: true, enabled: ["youtube"] });
    expect(new SettingsStore(dir).load().tabs).toEqual({ hidden: ["tts", "bot"] });
  });

  it("keeps a hand-written boolean map and still shows Chat", () => {
    const dir = tempDir();
    writeJson(dir, "settings.json", {
      platforms: { confirmed: true, enabled: ["twitch"] },
      tabs: { chat: false, stream: false, overlay: true },
    });
    expect(new SettingsStore(dir).load().tabs).toEqual({ hidden: ["stream"] });
  });
});

describe("desk tabs stay a window choice", () => {
  it("is read by settings storage and not by the bot or the connection runtime", () => {
    const main = sourceFiles("src/main").filter((file) => !file.endsWith(`${path.sep}settings.ts`));
    const bot = sourceFiles("packages/bot/src");
    for (const file of [...main, ...bot]) {
      const text = fs.readFileSync(file, "utf8");
      expect(text, file).not.toContain("desk-tabs");
      expect(text, file).not.toContain("tabInBar");
      expect(text, file).not.toContain("resolveDeskView");
    }
    const ipc = fs.readFileSync("src/main/index.ts", "utf8");
    expect(ipc).toContain("patch.tabs");
    const runtime = fs.readFileSync("src/main/runtime-bot.ts", "utf8");
    expect(runtime).not.toContain("tabs");
  });
});
