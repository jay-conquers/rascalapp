import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { alertStallMs, DEFAULT_VIDEO_PLACEMENT, importFirebotRewards, mergeImported, normalizePlacement, placementBox } from "../src/shared/redeems";
import { normalizeMapping } from "../src/main/redeems/store";
import { parseEventSubFrame } from "../src/main/redeems/eventsub";
import { AlertQueue } from "../src/main/redeems/queue";
import { defaultSoundFolder, loadRedeemFile, saveRedeemFile } from "../src/main/redeems/store";
import { defaultAssetFolder, type PathHost } from "../src/shared/paths";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import firebot from "./fixtures/firebot-channel-rewards.json";
import keyed from "./fixtures/firebot-keyed-rewards.json";

describe("firebot import", () => {
  it("maps video and sound rewards by title and scales Firebot's 0-10 volume", () => {
    const imported = importFirebotRewards(firebot);
    expect(imported).toEqual([
      {
        twitchId: "local-video",
        title: "Video reward",
        action: "video",
        filePath: "/tmp/example/video.mp4",
        volume: 50,
        placement: { ...DEFAULT_VIDEO_PLACEMENT },
      },
      {
        twitchId: "",
        title: "Rip",
        action: "sound",
        filePath: "/tmp/example/sound.mp3",
        volume: 80,
      },
      {
        twitchId: "",
        title: "Already mapped",
        action: "video",
        filePath: "/tmp/new.mp4",
        volume: 100,
        placement: { ...DEFAULT_VIDEO_PLACEMENT },
      },
    ]);
    const payload = JSON.parse(readFileSync(new URL("./fixtures/firebot-channel-rewards.json", import.meta.url), "utf8"));
    expect(importFirebotRewards(payload)).toHaveLength(3);
  });

  it("fills empty mappings and does not replace a file the editor already has", () => {
    const merged = mergeImported(
      [
        {
          rewardId: "keep",
          title: "Already mapped",
          action: "video",
          filePath: "/tmp/keep.mp4",
          volume: 20,
          maxDurationMs: null,
          enabled: true,
        },
      ],
      importFirebotRewards(firebot),
      [
        { id: "nuts-id", title: "Video reward" },
        { id: "keep", title: "Already mapped" },
      ],
    );
    expect(merged.find((item) => item.title === "Already mapped")).toMatchObject({ filePath: "/tmp/keep.mp4", volume: 20 });
    expect(merged.find((item) => item.title === "Video reward")).toMatchObject({
      rewardId: "nuts-id",
      filePath: "/tmp/example/video.mp4",
      action: "video",
    });
    expect(merged.find((item) => item.title === "Rip")?.action).toBe("sound");
  });

  it("reads a top-level id map and matches twitchData.id before title", () => {
    const imported = importFirebotRewards(keyed);
    expect(imported).toEqual([
      {
        twitchId: "twitch-nuts",
        title: "Video reward",
        action: "video",
        filePath: "/abs/path.mp4",
        volume: 100,
        placement: { ...DEFAULT_VIDEO_PLACEMENT },
      },
      {
        twitchId: "twitch-rip",
        title: "Rip",
        action: "sound",
        filePath: "/abs/rip.mp3",
        volume: 100,
        placement: undefined,
      },
    ]);
    const merged = mergeImported(
      [
        {
          rewardId: "twitch-nuts",
          title: "Old name",
          action: "none",
          filePath: "",
          volume: 100,
          maxDurationMs: null,
          enabled: true,
        },
      ],
      imported,
      [
        { id: "twitch-other", title: "Video reward" },
        { id: "twitch-nuts", title: "Renamed nuts" },
      ],
    );
    expect(merged.find((item) => item.rewardId === "twitch-nuts")).toMatchObject({
      title: "Renamed nuts",
      filePath: "/abs/path.mp4",
      volume: 100,
    });
    expect(merged.some((item) => item.rewardId === "twitch-other")).toBe(false);
  });

  it("moves a default full-screen video to the Firebot position without replacing its file", () => {
    const merged = mergeImported(
      [
        {
          rewardId: "twitch-nuts",
          title: "Video reward",
          action: "video",
          filePath: "/tmp/example/video.mp4",
          volume: 100,
          maxDurationMs: null,
          enabled: true,
          placement: { ...DEFAULT_VIDEO_PLACEMENT },
        },
      ],
      importFirebotRewards({
        nuts: {
          twitchData: { id: "twitch-nuts", title: "Video reward" },
          effects: { list: [{ type: "firebot:playvideo", file: "/other.mp4", volume: 10, position: "Bottom Right", width: 30 }] },
        },
      }),
      [{ id: "twitch-nuts", title: "Video reward" }],
    );
    expect(merged[0]).toMatchObject({
      filePath: "/tmp/example/video.mp4",
      placement: { preset: "bottom-right", sizePercent: 30 },
    });
  });
});

describe("redeem file", () => {
  it("stores mappings as a private json file and reloads them", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "rascal-redeems-"));
    const file = path.join(dir, "redeems.json");
    saveRedeemFile(file, {
      soundFolder: path.join(os.homedir(), "Streaming", "Rascal-Assets", "Sounds"),
      mappings: [
        {
          rewardId: "abc",
          title: "Rip",
          action: "sound",
          filePath: "",
          volume: 70,
          maxDurationMs: 4000,
          enabled: true,
        },
      ],
    });
    const loaded = loadRedeemFile(file, "/fallback");
    expect(loaded.mappings[0]).toMatchObject({ title: "Rip", volume: 70, maxDurationMs: 4000, filePath: "" });
    expect(loaded.soundFolder).toContain("Rascal-Assets");
  });

  it("keeps a saved sound folder and only uses the platform default when none is stored", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "rascal-sounds-"));
    const file = path.join(dir, "redeems.json");
    const saved = path.join("D:", "Clips", "custom");
    saveRedeemFile(file, {
      soundFolder: saved,
      mappings: [{ rewardId: "a", title: "Keep", action: "sound", filePath: "", volume: 10, maxDurationMs: null, enabled: true }],
    });
    const linux: PathHost = { platform: "linux", homedir: path.join("/home", "tester"), env: {} };
    expect(loadRedeemFile(file, defaultSoundFolder(linux)).soundFolder).toBe(saved);
    writeFileSync(file, JSON.stringify({ mappings: [] }));
    const win: PathHost = {
      platform: "win32",
      homedir: path.join("/Users", "tester"),
      env: {},
      music: path.join("/Users", "tester", "Music"),
    };
    expect(loadRedeemFile(file, defaultAssetFolder(win)).soundFolder).toBe(defaultAssetFolder(win));
    expect(loadRedeemFile(file, defaultAssetFolder(linux)).soundFolder).not.toBe(saved);
  });
});

describe("video placement", () => {
  it("fills the canvas at center 100% and insets the other presets", () => {
    expect(placementBox(DEFAULT_VIDEO_PLACEMENT)).toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
    const corner = placementBox({ ...DEFAULT_VIDEO_PLACEMENT, preset: "top-left", sizePercent: 50, marginPercent: 2 });
    expect(corner.width).toBe(960);
    expect(corner.height).toBe(540);
    expect(corner.left).toBe(Math.round(1920 * 0.02));
    expect(corner.top).toBe(Math.round(1080 * 0.02));
    const custom = placementBox({
      ...DEFAULT_VIDEO_PLACEMENT,
      preset: "custom",
      sizePercent: 25,
      customX: 10,
      customY: 20,
      customUnit: "percent",
    });
    expect(custom).toEqual({ left: 192, top: 216, width: 480, height: 270 });
  });

  it("maps Firebot positions and sizes onto the overlay", () => {
    const imported = importFirebotRewards({
      clip: {
        twitchData: { id: "id-a", title: "Clip" },
        effects: {
          list: [{ type: "firebot:playvideo", file: "/a.mp4", volume: 10, position: "Top Left", width: 40 }],
        },
      },
      custom: {
        twitchData: { id: "id-b", title: "Custom spot" },
        effects: {
          list: [
            {
              type: "firebot:playvideo",
              file: "/b.mp4",
              volume: 5,
              position: "Custom",
              width: "640px",
              customCoords: { top: 12, left: 20 },
            },
          ],
        },
      },
    });
    expect(imported[0]?.placement).toMatchObject({ preset: "top-left", sizePercent: 40 });
    expect(imported[1]?.placement).toMatchObject({
      preset: "custom",
      sizePercent: 33,
      customX: 20,
      customY: 12,
      customUnit: "percent",
    });
  });

  it("keeps older redeem files at center and full size", () => {
    const mapping = normalizeMapping({
      rewardId: "abc",
      title: "Old",
      action: "video",
      filePath: "/tmp/old.mp4",
      volume: 80,
    });
    expect(mapping.placement).toEqual(DEFAULT_VIDEO_PLACEMENT);
    expect(normalizePlacement(undefined)).toEqual(DEFAULT_VIDEO_PLACEMENT);
  });
});

describe("alert timing", () => {
  it("advances after the known duration plus 5 seconds, or 30 seconds when unknown", () => {
    expect(alertStallMs(10_000)).toBe(15_000);
    expect(alertStallMs(null)).toBe(30_000);
    expect(alertStallMs(0)).toBe(30_000);
  });
});

describe("alert queue", () => {
  const job = (id: string) => ({
    id,
    rewardId: "reward",
    title: id,
    action: "video" as const,
    filePath: "/tmp/a.mp4",
    volume: 100,
    maxDurationMs: null,
    owned: false,
    userName: "viewer",
  });

  it("plays one alert at a time, then skip and clear", () => {
    const queue = new AlertQueue();
    expect(queue.enqueue(job("a"))).toBe(true);
    expect(queue.enqueue(job("b"))).toBe(false);
    expect(queue.current?.id).toBe("a");
    expect(queue.complete("nope")).toBeNull();
    expect(queue.complete("a")?.id).toBe("b");
    expect(queue.skip()?.id).toBeUndefined();
    queue.enqueue(job("c"));
    queue.enqueue(job("d"));
    queue.clear();
    expect(queue.current).toBeNull();
    expect(queue.pending).toHaveLength(0);
  });
});

describe("eventsub frames", () => {
  it("reads a channel point redemption and ignores other messages", () => {
    const frame = parseEventSubFrame(
      JSON.stringify({
        metadata: {
          message_type: "notification",
          subscription_type: "channel.channel_points_custom_reward_redemption.add",
        },
        payload: {
          event: {
            id: "red-1",
            user_name: "Ace",
            user_input: "",
            reward: { id: "reward-1", title: "Rip", cost: 50 },
          },
        },
      }),
    );
    expect(frame).toMatchObject({
      type: "notification",
      redemption: { redemptionId: "red-1", rewardId: "reward-1", rewardTitle: "Rip", userName: "Ace" },
    });
    expect(parseEventSubFrame(JSON.stringify({ metadata: { message_type: "session_keepalive" } })).type).toBe("keepalive");
    expect(
      parseEventSubFrame(
        JSON.stringify({
          metadata: { message_type: "session_welcome" },
          payload: { session: { id: "sess", keepalive_timeout_seconds: 10 } },
        }),
      ),
    ).toMatchObject({ type: "welcome", sessionId: "sess" });
  });
});
