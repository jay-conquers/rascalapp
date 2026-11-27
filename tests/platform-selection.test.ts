import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsStore } from "../src/main/settings";
import { ChatFeed } from "../src/renderer/components/ChatFeed";
import { Composer } from "../src/renderer/components/Composer";
import { FirstRunPlatforms, PlatformPicker } from "../src/renderer/components/PlatformPicker";
import { ModLogPanel } from "../src/renderer/components/ModLogPanel";
import { StreamInfoView } from "../src/renderer/components/StreamInfoView";
import { YoutubeStudioButton } from "../src/renderer/components/YoutubeStudioButton";
import {
  PLATFORM_CATALOG,
  confirmPlatformSelection,
  defaultPlatformSelection,
  emptyFeedCopy,
  filterEnabled,
  sendTargetsForSelection,
  migrateFromSetup,
  platformsNeedingLogin,
  resolvePlatformSelection,
  setPlatformEnabled,
  visiblePlatforms,
  type PlatformSelection,
} from "../src/shared/platform/selection";
import { planSend, twitchLink, youtubeLink } from "../src/shared/send-targets";
import type { AuthState, ChatMessage, ModAction } from "../src/shared/types";
import { FakeSocket } from "./helpers/fake-socket";
import { BotService, BotStore, createBot } from "./helpers/bot";

const YOUTUBE_CHANNEL = "UCexamplechannel00000001";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rascal-platforms-"));
}

function writeJson(dir: string, name: string, value: unknown): void {
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value)}\n`);
}

function message(platform: "twitch" | "youtube", id: string): ChatMessage {
  return {
    id,
    platform,
    channel: "examplechannel",
    username: "viewer",
    displayName: "Viewer",
    color: "#fff",
    badges: [],
    segments: [{ type: "text", text: id }],
    plainText: id,
    timestamp: 1,
    kind: "chat",
  };
}

function action(platform: "twitch" | "youtube", id: string): ModAction {
  return {
    id,
    platform,
    channel: "examplechannel",
    timestamp: Date.parse("2026-11-25T18:00:00Z"),
    action: "timeout",
    actor: "Mod",
    target: "Viewer",
    durationSeconds: 60,
    reason: "",
    summary: `${platform} timeout`,
  };
}

describe("platform catalog", () => {
  it("lists Twitch, YouTube, and Kick", () => {
    expect(PLATFORM_CATALOG.map((entry) => entry.id)).toEqual(["twitch", "youtube", "kick"]);
    expect(PLATFORM_CATALOG.find((entry) => entry.id === "kick")?.hidden).toBe(false);
    expect(visiblePlatforms().map((entry) => entry.id)).toEqual(["twitch", "youtube", "kick"]);
    expect(visiblePlatforms().every((entry) => entry.label.trim().length > 0)).toBe(true);
  });

  it("starts a new install on Twitch and waits for the picker", () => {
    expect(defaultPlatformSelection()).toEqual({ confirmed: false, enabled: ["twitch"], kickAcknowledged: false });
  });
});

describe("platform selection rules", () => {
  const fresh = defaultPlatformSelection();

  it("refuses to turn off the last platform and ignores a hidden one", () => {
    expect(() => setPlatformEnabled(fresh, "twitch", false)).toThrow(/at least one platform/i);
    expect(() => setPlatformEnabled(fresh, "kick", true)).toThrow(/relay/i);
    expect(setPlatformEnabled(fresh, "youtube", true)).toEqual({ confirmed: false, enabled: ["twitch", "youtube"], kickAcknowledged: false });
    const both = setPlatformEnabled(fresh, "youtube", true);
    expect(setPlatformEnabled(both, "twitch", false)).toEqual({ confirmed: false, enabled: ["youtube"], kickAcknowledged: false });
  });

  it("confirms the picker only when something visible is selected", () => {
    expect(confirmPlatformSelection(fresh)).toEqual({ confirmed: true, enabled: ["twitch"], kickAcknowledged: false });
    expect(confirmPlatformSelection({ confirmed: false, enabled: ["kick", "youtube"] })).toEqual({ confirmed: true, enabled: ["youtube"], kickAcknowledged: false });
    expect(() => confirmPlatformSelection({ confirmed: false, enabled: ["kick"] })).toThrow(/at least one platform/i);
  });

  it("migrates an older install from what is already set up, and does not show the picker", () => {
    expect(migrateFromSetup({ twitch: false, youtube: false })).toEqual({ confirmed: true, enabled: ["twitch"], kickAcknowledged: false });
    expect(migrateFromSetup({ twitch: true, youtube: false })).toEqual({ confirmed: true, enabled: ["twitch"], kickAcknowledged: false });
    expect(migrateFromSetup({ twitch: false, youtube: true })).toEqual({ confirmed: true, enabled: ["youtube"], kickAcknowledged: false });
    expect(migrateFromSetup({ twitch: true, youtube: true })).toEqual({ confirmed: true, enabled: ["twitch", "youtube"], kickAcknowledged: false });
  });

  it("shows the picker only when nothing has been saved or connected", () => {
    expect(resolvePlatformSelection({ fileExisted: false, keyPresent: false, saved: undefined, setup: { twitch: false, youtube: false } })).toEqual(fresh);
    expect(
      resolvePlatformSelection({ fileExisted: true, keyPresent: false, saved: undefined, setup: { twitch: false, youtube: true } }),
    ).toEqual({ confirmed: true, enabled: ["youtube"], kickAcknowledged: false });
    expect(
      resolvePlatformSelection({ fileExisted: true, keyPresent: false, saved: undefined, setup: { twitch: false, youtube: false } }),
    ).toEqual({ confirmed: true, enabled: ["twitch"], kickAcknowledged: false });
    expect(
      resolvePlatformSelection({ fileExisted: false, keyPresent: false, saved: undefined, setup: { twitch: true, youtube: false } }),
    ).toEqual({ confirmed: true, enabled: ["twitch"], kickAcknowledged: false });
    const saved: PlatformSelection = { confirmed: true, enabled: ["youtube"], kickAcknowledged: false };
    expect(resolvePlatformSelection({ fileExisted: true, keyPresent: true, saved, setup: { twitch: true, youtube: true } })).toEqual(saved);
    expect(
      resolvePlatformSelection({ fileExisted: true, keyPresent: true, saved: { confirmed: false, enabled: ["twitch", "kick"] }, setup: { twitch: false, youtube: false } }),
    ).toEqual({ confirmed: false, enabled: ["twitch"], kickAcknowledged: false });
  });
});

describe("platform filtering", () => {
  const both: PlatformSelection = { confirmed: true, enabled: ["twitch", "youtube"] };
  const twitchOnly: PlatformSelection = { confirmed: true, enabled: ["twitch"] };

  it("keeps rows for enabled platforms and leaves a saved send check untouched", () => {
    const rows = [
      { platform: "twitch", text: "a" },
      { platform: "youtube", text: "b" },
      { platform: "kick", text: "c" },
    ];
    expect(filterEnabled(rows, (row) => row.platform, twitchOnly).map((row) => row.text)).toEqual(["a"]);
    expect(filterEnabled(rows, (row) => row.platform, both).map((row) => row.text)).toEqual(["a", "b"]);
    const saved = { twitch: true, youtube: true, kick: false };
    const plan = planSend(saved, {
      twitch: twitchLink({ state: "connected" }, true),
      youtube: youtubeLink({ state: "live", canSend: true }),
    }, { twitch: true, youtube: false });
    expect(plan.deliver).toEqual({ twitch: true, youtube: false, kick: false });
    expect(plan.saved).toEqual(saved);
    expect(plan.offline.youtube).toBe(false);
    expect(sendTargetsForSelection(twitchOnly, saved)).toEqual(saved);
    expect(sendTargetsForSelection({ confirmed: true, enabled: ["youtube"] }, { twitch: true, youtube: false })).toEqual({
      twitch: true,
      youtube: true,
      kick: false,
    });
    expect(saved).toEqual({ twitch: true, youtube: true, kick: false });
  });

  it("describes the empty feed from the platforms that are on", () => {
    expect(emptyFeedCopy(twitchOnly)).toMatch(/Twitch/);
    expect(emptyFeedCopy(twitchOnly)).not.toMatch(/YouTube/);
    expect(emptyFeedCopy({ confirmed: true, enabled: ["youtube"] })).toMatch(/YouTube/);
    expect(emptyFeedCopy(both)).toMatch(/Twitch/);
    expect(emptyFeedCopy(both)).toMatch(/YouTube/);
  });

  it("asks for a login when a platform is turned on and nobody is signed in", () => {
    expect(platformsNeedingLogin({
      previous: twitchOnly,
      next: both,
      confirm: false,
      twitchLoggedIn: true,
      youtubeLoggedIn: false,
    })).toEqual(["youtube"]);
    expect(platformsNeedingLogin({
      previous: fresh(),
      next: confirmPlatformSelection({ confirmed: false, enabled: ["twitch", "youtube"] }),
      confirm: true,
      twitchLoggedIn: false,
      youtubeLoggedIn: true,
    })).toEqual(["twitch"]);
    expect(platformsNeedingLogin({
      previous: both,
      next: twitchOnly,
      confirm: false,
      twitchLoggedIn: false,
      youtubeLoggedIn: false,
    })).toEqual([]);
  });

  function fresh(): PlatformSelection {
    return defaultPlatformSelection();
  }
});

describe("settings store", () => {
  it("leaves a fresh install unconfirmed and does not write a file until something else is saved", () => {
    const dir = tempDir();
    const loaded = new SettingsStore(dir).load();
    expect(loaded.platforms).toEqual({ confirmed: false, enabled: ["twitch"], kickAcknowledged: false });
    expect(fs.existsSync(path.join(dir, "settings.json"))).toBe(false);
  });

  it("pre-selects platforms that are already set up and does not show the picker", () => {
    const youtubeOnly = tempDir();
    writeJson(youtubeOnly, "settings.json", { youtubeChannelId: YOUTUBE_CHANNEL });
    expect(new SettingsStore(youtubeOnly).load().platforms).toEqual({ confirmed: true, enabled: ["youtube"], kickAcknowledged: false });

    const twitchChannel = tempDir();
    writeJson(twitchChannel, "settings.json", { twitchChannel: "examplechannel" });
    expect(new SettingsStore(twitchChannel).load().platforms).toEqual({ confirmed: true, enabled: ["twitch"], kickAcknowledged: false });

    const both = tempDir();
    writeJson(both, "settings.json", { twitchClientId: "client1234567890", youtubeChannelId: YOUTUBE_CHANNEL });
    writeJson(both, "tokens.json", { accessToken: "desk-access", login: "examplechannel" });
    writeJson(both, "youtube-tokens.json", { accessToken: "ya29.token", channelId: YOUTUBE_CHANNEL });
    expect(new SettingsStore(both).load().platforms).toEqual({ confirmed: true, enabled: ["twitch", "youtube"], kickAcknowledged: false });

    const untouched = tempDir();
    writeJson(untouched, "settings.json", { overlayPort: 4777 });
    expect(new SettingsStore(untouched).load().platforms).toEqual({ confirmed: true, enabled: ["twitch"], kickAcknowledged: false });

    const tokensOnly = tempDir();
    writeJson(tokensOnly, "tokens.json", { accessToken: "desk-access", login: "examplechannel" });
    writeJson(tokensOnly, "bot-youtube-tokens.json", { accessToken: "ya29.token", channelId: YOUTUBE_CHANNEL });
    const fromTokens = new SettingsStore(tokensOnly).load();
    expect(fromTokens.platforms).toEqual({ confirmed: true, enabled: ["twitch", "youtube"], kickAcknowledged: false });
    expect(fs.existsSync(path.join(tokensOnly, "settings.json"))).toBe(false);
  });

  it("keeps at least one platform and does not delete a saved login when one is turned off", () => {
    const dir = tempDir();
    writeJson(dir, "settings.json", { twitchChannel: "examplechannel", youtubeChannelId: YOUTUBE_CHANNEL });
    writeJson(dir, "tokens.json", { accessToken: "desk-access", refreshToken: "desk-refresh", login: "examplechannel" });
    writeJson(dir, "youtube-tokens.json", { accessToken: "ya29.token", channelId: YOUTUBE_CHANNEL, title: "Example" });
    const store = new SettingsStore(dir);
    expect(store.load().platforms.enabled).toEqual(["twitch", "youtube"]);
    expect(() => store.update({ platforms: { confirmed: true, enabled: [] } })).toThrow(/at least one platform/i);
    expect(() => store.update({ platforms: { confirmed: true, enabled: ["kick"] } })).toThrow(/at least one platform/i);
    const saved = store.update({ platforms: { confirmed: true, enabled: ["twitch"] } });
    expect(saved.platforms).toEqual({ confirmed: true, enabled: ["twitch"], kickAcknowledged: false });
    expect(saved.youtubeChannelId).toBe(YOUTUBE_CHANNEL);
    expect(saved.twitchChannel).toBe("examplechannel");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "tokens.json"), "utf8")).login).toBe("examplechannel");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "youtube-tokens.json"), "utf8")).channelId).toBe(YOUTUBE_CHANNEL);
    expect(new SettingsStore(dir).load().platforms).toEqual({ confirmed: true, enabled: ["twitch"], kickAcknowledged: false });
    const restored = store.update({ platforms: { confirmed: true, enabled: ["twitch", "youtube"] } });
    expect(restored.platforms.enabled).toEqual(["twitch", "youtube"]);
    expect(restored.youtubeChannelId).toBe(YOUTUBE_CHANNEL);
  });
});

describe("platform picker and filtered surfaces", () => {
  it("checks Twitch by default and offers YouTube and Kick", () => {
    const html = renderToStaticMarkup(createElement(PlatformPicker, { selection: defaultPlatformSelection(), onToggle: () => undefined }));
    expect(html).toContain("Twitch");
    expect(html).toContain("YouTube");
    expect(html).toContain('id="platform-kick"');
    expect(html).not.toMatch(/id="platform-kick"[^>]*checked/);
    expect(html).toContain("At least one platform stays on.");
    expect(html).toContain('id="platform-twitch"');
    expect(html).toMatch(/id="platform-twitch"[^>]*disabled/);
    expect(html).not.toMatch(/id="platform-youtube"[^>]*disabled/);
  });

  it("asks which platforms the streamer uses before the desk opens", () => {
    const html = renderToStaticMarkup(
      createElement(FirstRunPlatforms, {
        initial: defaultPlatformSelection(),
        busy: false,
        error: null,
        onContinue: () => undefined,
      }),
    );
    expect(html).toContain("Which platforms do you stream on?");
    expect(html).toContain("Continue");
    expect(html).toContain("Twitch");
    expect(html).toContain('id="platform-kick"');
    expect(html).not.toMatch(/id="platform-kick"[^>]*checked/);
    expect(html.toLowerCase()).not.toContain("jeeves");
  });

  it("hides chat rows, mod-log rows, send targets, and stream sections for a platform that is off", () => {
    const feed = renderToStaticMarkup(
      createElement(ChatFeed, {
        messages: [message("twitch", "t"), message("youtube", "y")],
        enabledIds: ["twitch"],
      }),
    );
    expect(feed).toContain("t");
    expect(feed).not.toContain(">y<");
    expect(feed).toContain('data-platform="twitch"');
    expect(feed).not.toContain('data-platform="youtube"');

    const empty = renderToStaticMarkup(createElement(ChatFeed, { messages: [], enabledIds: ["youtube"] }));
    expect(empty).toContain("YouTube chat attaches");
    expect(empty).not.toContain("Twitch chat joins");

    const log = renderToStaticMarkup(
      createElement(ModLogPanel, {
        actions: [action("twitch", "a"), action("youtube", "b")],
        enabled: true,
        enabledIds: ["youtube"],
        twitchMissingReadScopes: true,
        youtubeConnected: true,
      }),
    );
    expect(log).toContain("youtube timeout");
    expect(log).not.toContain("twitch timeout");
    expect(log).not.toContain("fresh login");
    expect(log).toContain("page reader");

    const composer = renderToStaticMarkup(
      createElement(Composer, {
        channel: "examplechannel",
        targets: { twitch: true, youtube: true },
        shown: { twitch: false, youtube: true },
        onTargets: () => undefined,
        twitch: twitchLink({ state: "connected" }, true),
        youtube: youtubeLink({ state: "live", canSend: true }),
        canSendYoutube: true,
        youtubeAccount: "Example",
        onSend: async () => undefined,
      }),
    );
    expect(composer).toContain("send-youtube");
    expect(composer).not.toContain("send-twitch");
    expect(composer).toContain("YouTube as Example");

    const auth: AuthState = { loggedIn: false, login: null, userId: null, scopes: [], missingScopes: [], clientIdSet: false };
    const stream = renderToStaticMarkup(
      createElement(StreamInfoView, {
        auth,
        stream: null,
        chatChannel: "",
        enabledIds: ["youtube"],
        onSave: async () => ({ results: [], stream: null }),
        onSearch: async () => [],
        onLogin: () => undefined,
        onOpenSettings: () => undefined,
      }),
    );
    expect(stream).not.toContain('data-platform="twitch"');
    expect(stream).not.toContain('data-platform="kick"');
    expect(stream).toContain('data-platform="youtube"');
    expect(stream).toContain('data-testid="youtube-studio"');
    expect(stream).toContain("no game field");
    expect(stream).not.toContain("Turn a platform on in Settings");
  });

  it("edits every enabled platform and keeps Studio behind the YouTube switch", () => {
    const auth: AuthState = {
      loggedIn: true,
      login: "example",
      userId: "1",
      scopes: ["channel:manage:broadcast"],
      missingScopes: [],
      clientIdSet: true,
    };
    const saved = async () => ({ results: [], stream: null });
    const both = renderToStaticMarkup(
      createElement(StreamInfoView, {
        auth,
        stream: { title: "Hello", gameId: "1", gameName: "Just Chatting", tags: [], language: "en", live: true, viewerCount: 3, startedAt: null },
        chatChannel: "example",
        enabledIds: ["twitch", "youtube"],
        youtube: {
          loggedIn: true,
          scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
          title: "Live",
          videoId: "abcdefghijk",
          channelId: YOUTUBE_CHANNEL,
        },
        onSave: saved,
        onSearch: async () => [],
        onLogin: () => undefined,
        onOpenSettings: () => undefined,
      }),
    );
    expect(both).toContain('data-platform="twitch"');
    expect(both).toContain('data-platform="youtube"');
    expect(both).not.toContain('data-platform="kick"');
    expect(both).toContain("Apply this title to all enabled platforms");
    expect(both).toContain("Re-login needed");
    expect(both).toContain("https://studio.youtube.com/video/abcdefghijk/livestreaming");
    expect(both).not.toContain('data-testid="kick-category"');

    const twitchOnly = renderToStaticMarkup(
      createElement(StreamInfoView, {
        auth,
        stream: null,
        chatChannel: "example",
        enabledIds: ["twitch"],
        onSave: saved,
        onSearch: async () => [],
        onLogin: () => undefined,
        onOpenSettings: () => undefined,
      }),
    );
    expect(twitchOnly).toContain('data-platform="twitch"');
    expect(twitchOnly).not.toContain("youtube-studio");
    expect(twitchOnly).not.toContain("Apply this title to all enabled platforms");

    const none = renderToStaticMarkup(
      createElement(StreamInfoView, {
        auth,
        stream: null,
        chatChannel: "",
        enabledIds: [],
        onSave: saved,
        onSearch: async () => [],
        onLogin: () => undefined,
        onOpenSettings: () => undefined,
      }),
    );
    expect(none).toContain("Turn a platform on in Settings");
    expect(renderToStaticMarkup(createElement(YoutubeStudioButton, { enabled: false, onOpen: () => undefined }))).toBe("");
  });

  it("keeps YouTube Studio on the stream tab and out of the desk header", () => {
    const app = fs.readFileSync("src/renderer/App.tsx", "utf8");
    expect(app).not.toContain("YoutubeStudioButton");
    expect(app).not.toContain("youtube-status");
    const stream = fs.readFileSync("src/renderer/components/StreamInfoView.tsx", "utf8");
    expect(stream).toContain("YoutubeStudioButton");
    expect(stream).toContain('section.id === "youtube"');
  });
});

describe("bot platform selection", () => {
  it("stops a platform without deleting its login, then connects it again", async () => {
    const fixture = createBot({ youtube: true });
    try {
      await fixture.service.setEnabledPlatforms(["youtube"]);
      expect(fixture.service.snapshot(1).platforms.map((platform) => platform.id)).toEqual(["youtube"]);
      expect(fs.existsSync(path.join(fixture.dir, "bot-tokens.json"))).toBe(true);
      expect(fs.existsSync(path.join(fixture.dir, "bot-youtube-tokens.json"))).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(fixture.dir, "enabled-platforms.json"), "utf8")).enabled).toEqual(["youtube"]);
      await expect(fixture.service.setEnabledPlatforms([])).rejects.toThrow(/at least one platform/i);
      await fixture.service.setEnabledPlatforms(["kick"]);
      expect(fixture.service.snapshot(1).platforms.map((platform) => platform.id)).toEqual(["kick"]);
      expect(fixture.service.snapshot(1).platforms[0]?.status).toMatch(/log in|relay/i);
      expect(fs.existsSync(path.join(fixture.dir, "bot-tokens.json"))).toBe(true);
    } finally {
      fixture.stop();
    }
  });

  it("keeps a restarted bot on the saved list", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const fixture = createBot({ youtube: true });
    try {
      await fixture.service.setEnabledPlatforms(["twitch"]);
      fixture.stop();
      const again = new BotService(new BotStore(fixture.dir), {
        clientId: () => "client1234567890",
        fetchImpl: fixture.fetchImpl,
        log: () => undefined,
        youtubeReader: "external",
      });
      expect(again.snapshot(1).platforms.map((platform) => platform.id)).toEqual(["twitch"]);
      await again.openPlatforms();
      expect(again.snapshot(1).platforms.map((platform) => platform.id)).toEqual(["twitch"]);
      again.stop();
      expect(fs.existsSync(path.join(fixture.dir, "bot-youtube-tokens.json"))).toBe(true);
    } finally {
      fixture.stop();
      vi.unstubAllGlobals();
    }
  });
});
