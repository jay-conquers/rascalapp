import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "../src/main/settings";
import { Composer } from "../src/renderer/components/Composer";
import {
  defaultSendTargets,
  planSend,
  twitchLink,
  youtubeLink,
  type SendTargets,
} from "../src/shared/send-targets";

describe("send targets", () => {
  it("defaults to Twitch only and keeps a YouTube check across reloads and unrelated saves", () => {
    expect(defaultSendTargets()).toEqual({ twitch: true, youtube: false, kick: false });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-send-"));
    const store = new SettingsStore(dir);
    expect(store.load().sendTargets).toEqual({ twitch: true, youtube: false, kick: false });
    store.update({ sendTargets: { twitch: true, youtube: true, kick: false } });
    store.update({ twitchChannel: "examplechannel" });
    const loaded = new SettingsStore(dir).load();
    expect(loaded.sendTargets).toEqual({ twitch: true, youtube: true, kick: false });
    expect(loaded.twitchChannel).toBe("examplechannel");
  });

  it("stays checked while YouTube is offline, skips the send, then includes it when live chat returns", () => {
    const saved: SendTargets = { twitch: true, youtube: true, kick: false };
    const offline = planSend(saved, {
      twitch: twitchLink({ state: "connected" }, true),
      youtube: youtubeLink({ state: "offline", canSend: true }),
    });
    expect(offline.saved).toEqual(saved);
    expect(offline.deliver).toEqual({ twitch: true, youtube: false, kick: false });
    expect(offline.offline.youtube).toBe(true);
    expect(saved.youtube).toBe(true);

    const online = planSend(offline.saved, {
      twitch: twitchLink({ state: "connected" }, true),
      youtube: youtubeLink({ state: "live", canSend: true }),
    });
    expect(online.saved.youtube).toBe(true);
    expect(online.deliver).toEqual({ twitch: true, youtube: true, kick: false });
    expect(online.offline.youtube).toBe(false);
  });

  it("keeps the same rule when Twitch chat itself is down", () => {
    const saved: SendTargets = { twitch: true, youtube: false, kick: false };
    const down = planSend(saved, {
      twitch: twitchLink({ state: "reconnecting" }, true),
      youtube: youtubeLink({ state: "idle", canSend: false }),
    });
    expect(down.saved.twitch).toBe(true);
    expect(down.deliver.twitch).toBe(false);
    expect(down.offline.twitch).toBe(true);
    const back = planSend(down.saved, {
      twitch: twitchLink({ state: "connected" }, true),
      youtube: youtubeLink({ state: "idle", canSend: false }),
    });
    expect(back.deliver.twitch).toBe(true);
  });

  it("shows the YouTube check still on after the chat box is remounted while offline", () => {
    const remembered = { current: { twitch: true, youtube: true, kick: false } as SendTargets };
    function mount(youtubeState: "offline" | "live"): string {
      return renderToStaticMarkup(
        createElement(Composer, {
          channel: "examplechannel",
          targets: remembered.current,
          onTargets: (next) => {
            remembered.current = next;
          },
          twitch: twitchLink({ state: "connected" }, true),
          youtube: youtubeLink({ state: youtubeState, canSend: true }),
          canSendYoutube: true,
          youtubeAccount: "Example",
          onSend: async () => undefined,
        }),
      );
    }

    const offlineHtml = mount("offline");
    expect(inputChecked(offlineHtml, "send-youtube")).toBe(true);
    expect(inputDisabled(offlineHtml, "send-youtube")).toBe(false);
    expect(offlineHtml).toContain("offline");

    const remounted = mount("offline");
    expect(inputChecked(remounted, "send-youtube")).toBe(true);
    expect(remembered.current.youtube).toBe(true);

    const liveHtml = mount("live");
    expect(inputChecked(liveHtml, "send-youtube")).toBe(true);
    expect(liveHtml).not.toContain("offline-note");
  });
});

function inputChecked(html: string, id: string): boolean {
  const tag = inputTag(html, id);
  return /checked="[^"]*"/.test(tag) || /\schecked(?:=|>|\s)/.test(tag);
}

function inputDisabled(html: string, id: string): boolean {
  return /\sdisabled(?:=|>|\s)/.test(inputTag(html, id));
}

function inputTag(html: string, id: string): string {
  const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
  expect(tag?.[0]).toBeTruthy();
  return tag?.[0] ?? "";
}
