import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "../src/main/settings";
import { SettingsView } from "../src/renderer/components/SettingsView";
import { SETTINGS_SECTIONS, TWITCH_SCOPE_REASONS, settingsFormPatch } from "../src/renderer/settings-form";
import { defaultChatAlert } from "../src/shared/chat-alert";
import { NOTICE_KINDS, NOTICE_LABELS, defaultFeed } from "../src/shared/feed-toggles";
import { CHAT_ALWAYS_NOTE } from "../src/shared/desk-tabs";
import { KICK_RELAY_DOCS_URL } from "../src/shared/kick/docs";
import type { AuthState, ConnectionStatus, Settings } from "../src/shared/types";

const AUTH: AuthState = { loggedIn: false, login: null, userId: null, scopes: [], missingScopes: [], clientIdSet: true };
const LOGGED_IN: AuthState = {
  loggedIn: true,
  login: "examplechannel",
  userId: "1",
  scopes: [],
  missingScopes: ["moderator:read:followers"],
  clientIdSet: true,
};
const STATUS: ConnectionStatus = {
  twitch: { state: "idle", detail: "" },
  youtube: { state: "idle", detail: "" },
  kick: { state: "idle", detail: "Kick is off." },
  overlay: { listening: true, host: "127.0.0.1", port: 4777 },
};

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rascal-settings-screen-"));
}

function loadSettings(patch: Record<string, unknown> = {}): Settings {
  const store = new SettingsStore(tempDir());
  return store.update({
    platforms: { confirmed: true, enabled: ["twitch", "youtube", "kick"], kickAcknowledged: true },
    twitchClientId: "client1234567890",
    twitchChannel: "examplechannel",
    youtubeChannelId: "UCexamplechannel00000001",
    kickRelayUrl: "wss://relay.example.com/v1/events",
    overlayPort: 4777,
    autoImportFirebot: true,
    chatAlert: { ...defaultChatAlert(), enabled: true, soundPath: "/tmp/rascal-chime.wav" },
    ...patch,
  });
}

function htmlFor(settings: Settings, auth: AuthState = AUTH): string {
  return renderToStaticMarkup(
    createElement(SettingsView, {
      settings,
      auth,
      status: STATUS,
      version: "0.14.0",
      onSave: async () => undefined,
      onLogin: () => undefined,
      onLogout: () => undefined,
      onOpenConsole: () => undefined,
    }),
  );
}

function section(html: string, id: string): string {
  const marker = `data-testid="settings-section-${id}"`;
  const start = html.indexOf(marker);
  expect(start, id).toBeGreaterThanOrEqual(0);
  const rest = html.slice(start + marker.length);
  const next = rest.indexOf('data-testid="settings-section-');
  return next === -1 ? rest : rest.slice(0, next);
}

const FORM_KEYS = [
  "autoImportFirebot",
  "chatAlert",
  "feed",
  "kickRelayUrl",
  "overlayPort",
  "twitchChannel",
  "twitchClientId",
  "youtubeChannelId",
] as const;

describe("settings screen sections", () => {
  const settings = loadSettings();
  const html = htmlFor(settings);

  it("lists every section in the nav and in the page, in the same order", () => {
    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toContain('data-testid="settings-nav"');
    let navAt = -1;
    let bodyAt = -1;
    for (const section of SETTINGS_SECTIONS) {
      const encoded = section.label.replaceAll("&", "&amp;");
      const nav = html.indexOf(`id="settings-nav-${section.id}"`);
      const href = html.indexOf(`href="#settings-section-${section.id}"`);
      const panel = html.indexOf(`data-testid="settings-section-${section.id}"`);
      expect(nav, section.id).toBeGreaterThan(navAt);
      expect(href, section.id).toBeGreaterThanOrEqual(0);
      expect(panel, section.id).toBeGreaterThan(bodyAt);
      expect(html).toContain(`id="settings-${section.id}-title">${encoded}</h3>`);
      expect(html).toContain(`tabindex="-1"`);
      expect(html).toContain(`aria-labelledby="settings-${section.id}-title"`);
      navAt = nav;
      bodyAt = panel;
    }
    expect(html).toContain('aria-current="true"');
    expect(html.toLowerCase()).not.toContain("jeeves");
  });

  it("keeps every existing control and puts developer fields under Advanced", () => {
    const platforms = section(html, "platforms");
    const chat = section(html, "chat");
    const tabs = section(html, "tabs");
    const alerts = section(html, "alerts");
    const moderation = section(html, "moderation");
    const app = section(html, "app");
    const advanced = section(html, "advanced");

    expect(platforms).toContain('data-setting="platforms"');
    expect(platforms).toContain('data-testid="platform-picker"');
    expect(platforms).toContain('id="platform-twitch"');
    expect(platforms).toContain('id="platform-youtube"');
    expect(platforms).toContain('id="platform-kick"');
    expect(platforms).toContain('data-setting="twitchChannel"');
    expect(platforms).toContain("Twitch chat channel");
    expect(platforms).toContain('aria-label="Log in to Twitch"');
    expect(platforms).toContain(">Log in<");
    expect(platforms).toContain('data-setting="youtubeChannelId"');
    expect(platforms).toContain("YouTube channel ID");
    expect(platforms).toContain("Find your channel ID in YouTube Studio.");
    expect(platforms).toContain("sending chat requires connecting Google on the Bot tab.");
    expect(platforms).not.toContain("youtube.force-ssl");
    expect(platforms).toContain('data-testid="kick-settings"');
    expect(platforms).toContain('data-testid="kick-relay-status"');
    expect(platforms).toContain("No relay configured");
    expect(platforms).toContain("Rascal hosting is not available yet");
    expect(platforms).toContain(KICK_RELAY_DOCS_URL);
    expect(platforms).toContain('data-setting="kickRelayUrl"');
    expect(platforms).toContain('data-setting="kickRelay.secret"');
    expect(platforms).toContain("Save relay secret");
    expect(platforms).toContain('aria-label="Log in to Kick"');
    expect(platforms).toContain("Not signed in.");
    expect(platforms).not.toContain('data-testid="settings-client-id"');
    expect(platforms).not.toContain('data-setting="kickClient.clientId"');
    expect(platforms).not.toContain('data-setting="overlayPort"');

    expect(chat).toContain("BetterTTV global and channel emotes");
    expect(chat).toContain("FrankerFaceZ global and channel emotes");
    expect(chat).toContain("7TV global and channel emotes");
    expect(chat).toContain('data-setting="feed.emotes.bttv"');
    expect(chat).toContain('data-setting="feed.emotes.ffz"');
    expect(chat).toContain('data-setting="feed.emotes.seventv"');
    for (const item of NOTICE_LABELS) {
      expect(chat).toContain(item.label);
      expect(chat).toContain(`data-setting="feed.notices.${item.key}"`);
    }
    expect(chat).not.toContain("Private mod log");
    expect(chat).toContain("Bot connection");
    expect(chat).toContain("Embedded on this computer");
    expect(chat).toContain("Server you run");
    expect(chat).toContain('data-setting="botLink.mode"');
    expect(chat).toContain('data-setting="botLink.serverUrl"');
    expect(chat).toContain('data-setting="botLink.adminToken"');
    expect(chat).toContain("Save bot connection");
    expect(chat).toContain("Admin token from the server you run");
    expect(chat).not.toContain("RASCAL_BOT_API_KEY");
    expect(chat).not.toContain("youtube.force-ssl");

    expect(tabs).toContain('data-setting="tabs"');
    expect(tabs).toContain('data-testid="tab-picker"');
    expect(tabs).toContain(CHAT_ALWAYS_NOTE);
    expect(tabs).toMatch(/id="tab-chat"[^>]*disabled/);
    expect(tabs).not.toContain('id="tab-settings"');

    expect(alerts).toContain("Message sound");
    expect(alerts).toContain("Play a sound for new messages");
    expect(alerts).toContain("Also play for notices");
    expect(alerts).toContain('data-setting="chatAlert.enabled"');
    expect(alerts).toContain('data-setting="chatAlert.notices"');
    expect(alerts).toContain('data-setting="chatAlert.volume"');
    expect(alerts).toContain('data-setting="chatAlert.cooldownMs"');
    expect(alerts).toContain("Test sound");
    expect(alerts).toContain("Choose sound");
    expect(alerts).toContain("Use built-in chime");
    expect(alerts).toContain("Custom sound selected.");
    expect(alerts).not.toContain("/tmp/rascal-chime.wav");

    expect(moderation).toContain('data-setting="feed.modLog"');
    expect(moderation).toContain("Private mod log");
    expect(moderation).toContain("never posted to chat");

    expect(app).toContain('data-testid="settings-version"');
    expect(app).toContain("0.14.0");
    expect(app).toContain('data-setting="autoImportFirebot"');
    expect(app).toContain("Import Firebot reward files on startup");

    expect(advanced).toContain("Tokens stay in the config folder");
    expect(advanced).toContain("RASCAL_BOT_API_KEY");
    expect(advanced).toContain('data-testid="settings-client-id"');
    expect(advanced).toContain('data-setting="twitchClientId"');
    expect(advanced).toContain("Twitch client ID");
    expect(advanced).toContain("Register the Twitch app");
    expect(advanced).toContain("Open Twitch developer console");
    expect(advanced).toContain("Permissions on the consent screen");
    expect(advanced).toContain("device code flow");
    expect(advanced).toContain("before 0.8.0");
    for (const [scope, reason] of TWITCH_SCOPE_REASONS) {
      expect(advanced).toContain(scope);
      expect(advanced).toContain(reason);
    }
    expect(advanced).toContain('data-setting="kickClient.clientId"');
    expect(advanced).toContain('data-setting="kickClient.clientSecret"');
    expect(advanced).toContain("Kick client ID");
    expect(advanced).toContain("Kick client secret");
    expect(advanced).toContain("Save Kick app");
    expect(advanced).toContain('data-setting="overlayPort"');
    expect(advanced).toContain("Overlay port");
    expect(advanced).toContain("Listening on 127.0.0.1:4777");
    expect(advanced).toContain('data-setting="chatAlert.soundPath"');
    expect(advanced).toContain("/tmp/rascal-chime.wav");
    expect(advanced).not.toContain('data-setting="twitchChannel"');

    expect(html).toContain('data-testid="settings-save"');
    expect(html).toContain("Save settings");
    expect(html).not.toContain("Log in with Twitch");
    expect(html).not.toContain("Log in with Kick");
    expect(html).not.toContain("Log out of Kick");
  });

  it("shows Log out, and the missing-scope warning, for a Twitch account that is already signed in", () => {
    const signedIn = htmlFor(settings, LOGGED_IN);
    const platforms = section(signedIn, "platforms");
    expect(platforms).toContain("Logged in as");
    expect(platforms).toContain("examplechannel");
    expect(platforms).toContain("This login is missing a permission. Log out and log in again to grant it.");
    expect(platforms).not.toContain("moderator:read:followers");
    expect(platforms).toContain('aria-label="Log out of Twitch"');
    expect(platforms).toContain(">Log out<");
    expect(platforms).not.toContain('aria-label="Log in to Twitch"');
    expect(platforms).toContain('aria-label="Log in to Kick"');
  });

  it("hides Twitch and Kick controls when those platforms are off, and still locks Chat", () => {
    const youtubeOnly = htmlFor(
      loadSettings({
        platforms: { confirmed: true, enabled: ["youtube"], kickAcknowledged: false },
        twitchClientId: "",
        twitchChannel: "",
      }),
    );
    expect(youtubeOnly).not.toContain('data-testid="settings-client-id"');
    expect(youtubeOnly).not.toContain('data-testid="kick-settings"');
    expect(youtubeOnly).not.toContain("Import Firebot reward files on startup");
    expect(youtubeOnly).not.toContain('aria-label="Log in to Twitch"');
    expect(youtubeOnly).not.toContain("Kick client ID");
    expect(youtubeOnly).toContain('data-setting="youtubeChannelId"');
    expect(youtubeOnly).toContain('id="tab-chat"');
    expect(youtubeOnly).toMatch(/id="tab-chat"[^>]*disabled/);
    expect(section(youtubeOnly, "advanced")).toContain("Overlay port");
    expect(section(youtubeOnly, "chat")).toContain("Bot connection");
  });
});

describe("settings form keys", () => {
  it("saves the same settings.json keys the old form wrote", () => {
    const feed = defaultFeed();
    feed.emotes.bttv = false;
    feed.notices.sub = false;
    feed.modLog = false;
    const alert = { ...defaultChatAlert(), enabled: true, volume: 0.4, cooldownMs: 3000, notices: true, soundPath: "/tmp/rascal-chime.wav" };
    const patch = settingsFormPatch({
      twitchClientId: "  client1234567890 ",
      twitchChannel: " ExampleChannel ",
      youtubeChannelId: " UCexamplechannel00000001 ",
      kickRelayUrl: " wss://relay.example.com/v1/events ",
      overlayPort: "4777",
      autoImportFirebot: false,
      feed,
      chatAlert: alert,
    });
    expect(Object.keys(patch).sort()).toEqual([...FORM_KEYS].sort());
    expect(patch.twitchClientId).toBe("client1234567890");
    expect(patch.twitchChannel).toBe("ExampleChannel");
    expect(patch.youtubeChannelId).toBe("UCexamplechannel00000001");
    expect(patch.kickRelayUrl).toBe("wss://relay.example.com/v1/events");
    expect(patch.overlayPort).toBe(4777);
    expect(patch.autoImportFirebot).toBe(false);
    expect(Object.keys(patch.chatAlert ?? {}).sort()).toEqual(["cooldownMs", "enabled", "notices", "soundPath", "volume"]);
    expect(Object.keys(patch.feed ?? {}).sort()).toEqual(["emotes", "modLog", "notices"]);
    expect(NOTICE_KINDS.every((kind) => patch.feed?.notices[kind] !== undefined)).toBe(true);

    const dir = tempDir();
    const saved = new SettingsStore(dir).update(patch);
    const file = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")) as Record<string, unknown>;
    expect(file.twitchClientId).toBe("client1234567890");
    expect(file.twitchChannel).toBe("examplechannel");
    expect(file.youtubeChannelId).toBe("UCexamplechannel00000001");
    expect(file.kickRelayUrl).toBe(saved.kickRelayUrl);
    expect(file.overlayPort).toBe(4777);
    expect(file.autoImportFirebot).toBe(false);
    expect(file.feed).toMatchObject({ emotes: { bttv: false }, notices: { sub: false }, modLog: false });
    expect(file.chatAlert).toMatchObject({ enabled: true, volume: 0.4, cooldownMs: 3000, notices: true, soundPath: "/tmp/rascal-chime.wav" });
    expect(file).not.toHaveProperty("twitch_client_id");
    expect(file).not.toHaveProperty("botLink");
  });

  it("still saves platforms, tabs, the Kick relay, the Kick app, and the bot link through the same calls", () => {
    const source = fs.readFileSync("src/renderer/components/SettingsView.tsx", "utf8");
    expect(source).toContain("settingsFormPatch");
    expect(source).toContain("onSave({ platforms: result.next })");
    expect(source).toContain("onSave({ tabs: setTabShown(settings.tabs, id, shown) })");
    expect(source).toContain("onSave({ platforms: enableKick(settings.platforms) })");
    expect(source).toContain("requestPlatformToggle");
    expect(source).toContain("KickRelayDialog");
    expect(source).toContain("kickSaveRelay({ secret: kickSecret })");
    expect(source).toContain("kickSaveClient({ clientId: kickClientId || kickDesk?.clientId || \"\", clientSecret: kickClientSecret })");
    expect(source).toContain("saveBotLink");
    expect(source).toContain("mode: botMode");
    expect(source).toContain("serverUrl: botUrl");
    expect(source).toContain("adminToken: botToken.trim() || undefined");
    expect(source).not.toContain("jeeves");
  });
});
