import { describe, expect, it } from "vitest";
import { buildAlertsPage, overlayHelloMessage, overlayShouldReload } from "../src/main/redeems/overlay-page";
import { normalizePlacement, placementBox } from "../src/shared/redeems";

describe("overlay hello handshake", () => {
  it("reloads only when the server hash differs from the hash baked into the page", () => {
    const page = buildAlertsPage("0.2.3");
    expect(page.hash).toHaveLength(12);
    expect(page.html).toContain(`const OVERLAY_HASH = "${page.hash}"`);
    expect(page.html).toContain('const OVERLAY_VERSION = "0.2.3"');
    expect(page.html).toContain("Cache-Control");
    expect(page.html).toContain('object-fit: contain');
    expect(page.html).toContain("location.reload");

    const hello = overlayHelloMessage("0.2.3", page.hash);
    expect(overlayShouldReload(page.hash, hello)).toBe(false);
    expect(overlayShouldReload(page.hash, { type: "hello", overlayHash: "stale-page" })).toBe(true);
    expect(overlayShouldReload(page.hash, { type: "hello" })).toBe(false);
    expect(overlayShouldReload(page.hash, { type: "alert-play" })).toBe(false);

    const next = buildAlertsPage("0.2.4");
    expect(next.hash).not.toBe(page.hash);
    expect(overlayShouldReload(page.hash, overlayHelloMessage("0.2.4", next.hash))).toBe(true);
  });
});

describe("alert placement payload", () => {
  it("includes a box for video and omits it for sound", () => {
    const placement = normalizePlacement({ preset: "top-left", sizePercent: 47 });
    const box = placementBox(placement);
    expect(box.width).toBeLessThan(1920);
    expect(box.left).toBeGreaterThan(0);
    expect(box.top).toBeGreaterThan(0);
    const video = playJob("video", "/clip.mp4", placement);
    const sound = playJob("sound", "/clip.mp3", placement);
    expect(video.box).toEqual(box);
    expect(sound.box).toBeNull();
  });
});

function playJob(action: "video" | "sound", filePath: string, placement: ReturnType<typeof normalizePlacement>) {
  const media = filePath.endsWith(".mp3") || action === "sound" ? "audio" : "video";
  return {
    media,
    box: media === "audio" ? null : placementBox(placement),
  };
}
