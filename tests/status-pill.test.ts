import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusPill } from "../src/renderer/components/StatusPill";

const detail = "Finished broadcast with a very long title that used to spill out of the pill";

describe("status pills", () => {
  it("keeps the full label for the tooltip and splits the count from the word watching", () => {
    const html = renderToStaticMarkup(
      createElement(StatusPill, { label: "YouTube", state: "live", detail, viewers: 8 }),
    );
    expect(html).toContain('class="pill-name"');
    expect(html).toContain('title="YouTube"');
    expect(html).toContain(`title="${detail}"`);
    expect(html).toContain(detail);
    expect(html).not.toContain(`${detail.slice(0, 40)}…`);
    expect(html).toContain('class="viewer-count"');
    expect(html).toContain('class="viewer-word"');
    expect(html).toContain(">8<");
    expect(html).toContain(" watching");
    expect(html).toContain(`aria-label="${detail} · 8 watching"`);
  });

  it("stays on one line, ellipsizes, and drops watching when the chip is narrow", () => {
    const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.pill \{[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/\.pill \{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.pill \{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.pill-name,\s*\.pill-detail \{[^}]*text-overflow:\s*ellipsis/s);
    expect(css).toMatch(/\.pill \.viewers \{[^}]*flex:\s*none/s);
    expect(css).toMatch(/@container \(max-width: 160px\) \{\s*\.pill-detail \{ display: none; \}/);
    expect(css).toMatch(/@container \(max-width: 120px\) \{\s*\.viewer-word \{ display: none; \}/);
    expect(css).toMatch(/@container \(max-width: 72px\) \{\s*\.pill-name \{ display: none; \}/);
    expect(css).toContain("flex: 0 0 auto");
    expect(css).toMatch(/\.pills \{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(/@media \(max-width: 1180px\) \{\s*\.topbar \{ flex-wrap: wrap; \}/);
  });

  it("keeps dark text on the light green connected chips", () => {
    const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    expect(css).toContain(".redeem-bar p:not(.tts-up):not(.tts-down)");
    expect(css).toMatch(/\.tts-up,\s*\.redeem-bar p\.tts-up \{[^}]*color:\s*#04210f/s);
    expect(css).toMatch(/\.tts-down,\s*\.redeem-bar p\.tts-down \{[^}]*color:\s*#2a0a0e/s);
    expect(css).toMatch(/\.live-pill\.on \{[^}]*color:\s*#04210f;[^}]*background:\s*var\(--ok\)/s);
    expect(css).toMatch(/\.badge\.mod \{[^}]*background:\s*#3dd68c;[^}]*color:\s*#04210f/s);
  });
});
