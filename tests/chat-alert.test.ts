import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "../src/main/settings";
import { readChatSoundFile } from "../src/main/chat-sound-file";
import {
  CHAT_ALERT_BACKFILL_MS,
  buildChimeWav,
  defaultChatAlert,
  isSafeSoundPath,
  mergeChatAlert,
  shouldPlayChatAlert,
  sniffAudio,
  type AlertIdentity,
  type AlertMessage,
  type ChatAlertSettings,
} from "../src/shared/chat-alert";

const now = 1_700_000_000_000;
const viewer: AlertMessage = {
  platform: "twitch",
  username: "threetimestold",
  displayName: "threetimestold",
  authorId: "42",
  kind: "chat",
  timestamp: now,
};

const identity: AlertIdentity = {
  selfNames: ["Jay"],
  selfIds: ["7"],
  botNames: ["rascalbot"],
  botIds: ["99"],
};

function decide(
  message: AlertMessage,
  patch: Partial<ChatAlertSettings> = {},
  extra: { lastPlayedAt?: number | null; duplicate?: boolean; identity?: AlertIdentity } = {},
) {
  return shouldPlayChatAlert({
    settings: { ...defaultChatAlert(), enabled: true, ...patch },
    message,
    identity: extra.identity ?? identity,
    now,
    lastPlayedAt: extra.lastPlayedAt ?? null,
    duplicate: extra.duplicate ?? false,
  });
}

describe("chat alert", () => {
  it("stays off until enabled, then plays a viewer message from any platform", () => {
    expect(defaultChatAlert().enabled).toBe(false);
    expect(defaultChatAlert().notices).toBe(false);
    expect(decide(viewer, { enabled: false }).reason).toBe("disabled");
    expect(decide(viewer).play).toBe(true);
    expect(decide({ ...viewer, platform: "youtube" }).play).toBe(true);
    expect(decide({ ...viewer, platform: "kick", username: "viewer", authorId: "k1" }).play).toBe(true);
  });

  it("skips the streamer, the bot, duplicates, history, and notices unless asked", () => {
    expect(decide({ ...viewer, username: "Jay", authorId: "7" }).reason).toBe("own");
    expect(decide({ ...viewer, username: "someone", authorId: "7" }).reason).toBe("own");
    expect(decide({ ...viewer, username: "rascalbot", authorId: "99" }).reason).toBe("bot");
    expect(decide(viewer, {}, { duplicate: true }).reason).toBe("duplicate");
    expect(decide({ ...viewer, timestamp: now - CHAT_ALERT_BACKFILL_MS - 1 }).reason).toBe("backfill");
    const resub = { ...viewer, kind: "system", noticeKind: "resub" };
    expect(decide(resub).reason).toBe("notice");
    expect(decide(resub, { notices: true }).play).toBe(true);
  });

  it("waits out the cooldown, then plays again", () => {
    expect(decide(viewer, { cooldownMs: 2_000 }, { lastPlayedAt: now - 500 }).reason).toBe("cooldown");
    expect(decide(viewer, { cooldownMs: 2_000 }, { lastPlayedAt: now - 2_000 }).play).toBe(true);
  });

  it("persists an enabled chime and drops a remote sound path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-alert-"));
    const store = new SettingsStore(dir);
    expect(store.load().chatAlert.enabled).toBe(false);
    store.update({ chatAlert: { ...defaultChatAlert(), enabled: true, volume: 0.4, notices: true, soundPath: "/tmp/chime.wav" } });
    store.update({ twitchChannel: "examplechannel" });
    const loaded = new SettingsStore(dir).load();
    expect(loaded.chatAlert.enabled).toBe(true);
    expect(loaded.chatAlert.volume).toBe(0.4);
    expect(loaded.chatAlert.notices).toBe(true);
    expect(loaded.twitchChannel).toBe("examplechannel");
    expect(mergeChatAlert(loaded.chatAlert, { soundPath: "https://evil.example/beep.wav" }).soundPath).toBe("");
    expect(isSafeSoundPath("https://cdn.example/beep.wav")).toBe(false);
    expect(isSafeSoundPath("/home/jay/beep.wav")).toBe(true);
    expect(isSafeSoundPath("C:\\sounds\\beep.wav")).toBe(true);
  });

  it("builds a wav chime and rejects a file that is not audio", () => {
    const wav = buildChimeWav();
    expect(sniffAudio(wav)).toBe("audio/wav");
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-wav-"));
    const file = path.join(dir, "chime.wav");
    fs.writeFileSync(file, wav);
    expect(readChatSoundFile(file).mime).toBe("audio/wav");
    const text = path.join(dir, "notes.wav");
    fs.writeFileSync(text, "not really a wave file!!!!");
    expect(() => readChatSoundFile(text)).toThrow(/audio/);
    expect(() => readChatSoundFile("https://example.com/beep.wav")).toThrow(/local audio/);
  });
});

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
