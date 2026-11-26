import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { contrastRatio, theme } from "../src/shared/theme";
import { streamInfoPlatforms } from "../src/shared/stream-platforms";

describe("tabby theme", () => {
  it("keeps WCAG AA contrast for accent buttons and cream on chocolate", () => {
    expect(contrastRatio(theme.onAccent, theme.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.onAccent, theme.accentDeep)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.cream, theme.chocolate)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.cream, theme.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.accent, theme.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("uses brand-neutral color tokens in the desk stylesheet", () => {
    const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    expect(css).toContain("--accent:");
    expect(css).toContain("--accent-deep:");
    expect(css).toContain("--chocolate:");
    expect(css).toContain("--cream:");
    expect(css.toLowerCase()).toContain(theme.accent.toLowerCase());
    expect(css.toLowerCase()).toContain(theme.accentDeep.toLowerCase());
    expect(css.toLowerCase()).toContain(theme.chocolate.toLowerCase());
    expect(css.toLowerCase()).toContain(theme.cream.toLowerCase());
    expect(css).not.toMatch(/--ember\b/);
    expect(css).not.toContain("#ff7a3c");
    expect(css).not.toContain("#ff8a4a");
  });
});

describe("stream info platforms", () => {
  it("starts with a Twitch section and keeps ids unique", () => {
    expect(streamInfoPlatforms.map((platform) => platform.id)).toContain("twitch");
    expect(new Set(streamInfoPlatforms.map((platform) => platform.id)).size).toBe(streamInfoPlatforms.length);
    for (const platform of streamInfoPlatforms) expect(platform.title.trim().length).toBeGreaterThan(0);
  });
});

describe("cat icon", () => {
  it("draws a charcoal disc with a transparent corner", () => {
    const probe = spawnSync("python3", ["scripts/render-icon.py", "--probe", "--size", "32"], {
      encoding: "utf8",
    });
    expect(probe.status).toBe(0);
    const pixels = JSON.parse(probe.stdout) as { center: number[]; corner: number[]; mid: number[] };
    expect(pixels.corner[3]).toBe(0);
    expect(pixels.center[3]).toBe(255);
    const fur = pixels.mid[0] > pixels.center[0] ? pixels.mid : pixels.center;
    expect(fur[0]).toBeGreaterThan(120);
    expect(fur[1]).toBeGreaterThan(60);
    expect(fur[2]).toBeLessThan(160);
    const svg = readFileSync(new URL("../build/icon.svg", import.meta.url), "utf8");
    expect(svg).toContain("#2F2F2E");
    expect(svg).toContain("#7A502E");
    expect(svg).toContain("#4E3928");
    expect(svg).toContain("#EFE6DA");
    expect(svg.toLowerCase()).not.toMatch(/flame|ember/);
    const mark = readFileSync(new URL("../src/renderer/components/icons.tsx", import.meta.url), "utf8");
    const body = svg.match(/<path d="([^"]+)" fill="#7A502E"/)?.[1];
    expect(body && mark.includes(body)).toBe(true);
  });
});
