import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "../src/main/settings";
import { KickRelayNotice } from "../src/renderer/components/KickRelayNotice";
import { KICK_RELAY_DOCS_URL } from "../src/shared/kick/docs";
import { moderationOffer, type ModerationContext } from "../src/shared/moderation";
import {
  confirmPlatformSelection,
  defaultPlatformSelection,
  enableKick,
  migrateFromSetup,
  requestPlatformToggle,
  resolvePlatformSelection,
  setPlatformEnabled,
} from "../src/shared/platform/selection";

describe("Kick relay notice", () => {
  it("keeps Enable off until the acknowledgement is ticked", () => {
    const blocked = renderToStaticMarkup(
      createElement(KickRelayNotice, {
        understood: false,
        confirmLabel: "Enable",
        onUnderstand: () => undefined,
        onCancel: () => undefined,
        onConfirm: () => undefined,
      }),
    );
    expect(blocked).toContain("Kick needs a relay");
    expect(blocked).toContain("will not work");
    expect(blocked).toContain("coming later");
    expect(blocked).toContain(KICK_RELAY_DOCS_URL);
    expect(blocked).toContain("I understand");
    expect(blocked).toContain('data-testid="kick-relay-confirm"');
    expect(blocked).toContain("disabled");
    const open = renderToStaticMarkup(
      createElement(KickRelayNotice, {
        understood: true,
        confirmLabel: "Continue",
        onUnderstand: () => undefined,
        onCancel: () => undefined,
        onConfirm: () => undefined,
      }),
    );
    expect(open).toContain(">Continue<");
    expect(open).not.toContain("disabled");
  });

  it("does not turn Kick on until the notice is accepted, and then remembers that", () => {
    const fresh = defaultPlatformSelection();
    const asked = requestPlatformToggle(fresh, "kick", true);
    expect(asked.confirmKick).toBe(true);
    expect(asked.next.enabled).toEqual(["twitch"]);
    const enabled = enableKick(fresh);
    expect(enabled).toMatchObject({ enabled: ["twitch", "kick"], kickAcknowledged: true });
    expect(requestPlatformToggle(setPlatformEnabled(enabled, "kick", false), "kick", true).confirmKick).toBe(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-kick-ack-"));
    const store = new SettingsStore(dir);
    store.update({ platforms: confirmPlatformSelection(enabled) });
    expect(new SettingsStore(dir).load().platforms).toMatchObject({
      confirmed: true,
      enabled: ["twitch", "kick"],
      kickAcknowledged: true,
    });
    const off = store.update({ platforms: setPlatformEnabled(store.load().platforms, "kick", false) });
    expect(off.platforms.enabled).not.toContain("kick");
    expect(off.platforms.kickAcknowledged).toBe(true);
    expect(new SettingsStore(dir).load().platforms.kickAcknowledged).toBe(true);
  });

  it("leaves Kick off when an older install is opened", () => {
    expect(migrateFromSetup({ twitch: true, youtube: true }).enabled).not.toContain("kick");
    expect(migrateFromSetup({ twitch: true, youtube: false }).kickAcknowledged).toBe(false);
    const upgraded = resolvePlatformSelection({
      fileExisted: true,
      keyPresent: true,
      saved: { confirmed: true, enabled: ["twitch", "youtube"] },
      setup: { twitch: true, youtube: true },
    });
    expect(upgraded.enabled).toEqual(["twitch", "youtube"]);
    expect(upgraded.kickAcknowledged).toBe(false);
    expect(
      resolvePlatformSelection({
        fileExisted: true,
        keyPresent: true,
        saved: { confirmed: true, enabled: ["twitch", "kick"] },
        setup: { twitch: true, youtube: false },
      }).enabled,
    ).toEqual(["twitch"]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-kick-migrate-"));
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({ twitchChannel: "examplechannel", platforms: { confirmed: true, enabled: ["twitch", "youtube"] } }),
    );
    const loaded = new SettingsStore(dir).load();
    expect(loaded.platforms.enabled).toEqual(["twitch", "youtube"]);
    expect(loaded.platforms.kickAcknowledged).toBe(false);
    expect(loaded.kickRelayUrl).toBe("");
  });

  it("offers delete, timeout, ban, and unban when the Kick login can moderate", () => {
    const message = {
      platform: "kick" as const,
      id: "unique_message_id_123",
      username: "viewer",
      displayName: "viewer",
      authorId: "99",
      badges: [],
    };
    const ctx: ModerationContext = {
      twitch: { loggedIn: false, scopes: [], login: null, userId: null, channelLogin: "", broadcasterId: null },
      youtube: { canModerate: false, live: false, channelId: "", accountChannelId: null },
      kick: { loggedIn: true, scopes: ["moderation:ban", "moderation:chat_message:manage"], userId: "5", broadcasterUserId: "5" },
    };
    const offer = moderationOffer(message, ctx);
    expect(offer.delete.enabled).toBe(true);
    expect(offer.timeout.enabled).toBe(true);
    expect(offer.ban.enabled).toBe(true);
    expect(offer.unban.enabled).toBe(true);
    expect(moderationOffer({ ...message, authorId: "5", badges: [{ kind: "broadcaster" }] }, ctx).ban.enabled).toBe(false);
    expect(moderationOffer(message, { ...ctx, kick: { ...ctx.kick!, loggedIn: false, scopes: [] } }).delete.reason).toMatch(/Log in with Kick/);
  });
});
