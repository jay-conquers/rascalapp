import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModLogPanel } from "../src/renderer/components/ModLogPanel";
import type { ModAction } from "../src/shared/types";

const action: ModAction = {
  id: "desk-1",
  platform: "twitch",
  channel: "examplechannel",
  timestamp: Date.parse("2026-11-25T18:00:00Z"),
  action: "timeout",
  actor: "Example",
  target: "Viewer",
  durationSeconds: 600,
  reason: "",
  summary: "Example timed out Viewer for 10m on Twitch.",
};

function panel(patch: Partial<{ actions: ModAction[]; enabled: boolean; twitchMissingReadScopes: boolean; youtubeConnected: boolean }> = {}): string {
  return renderToStaticMarkup(
    createElement(ModLogPanel, {
      actions: patch.actions ?? [],
      enabled: patch.enabled ?? true,
      twitchMissingReadScopes: patch.twitchMissingReadScopes ?? false,
      youtubeConnected: patch.youtubeConnected ?? false,
    }),
  );
}

describe("mod log empty state", () => {
  it("says only that nothing has happened until a login or YouTube chat actually needs the extra note", () => {
    const empty = panel();
    expect(empty).toContain("No moderation actions yet.");
    expect(empty).not.toContain("fresh login");
    expect(empty).not.toContain("page reader");

    const missing = panel({ twitchMissingReadScopes: true });
    expect(missing).toContain("No moderation actions yet.");
    expect(missing).toContain("Twitch needs a fresh login with the moderator read scopes.");

    const youtube = panel({ youtubeConnected: true });
    expect(youtube).toContain("No moderation actions yet.");
    expect(youtube).toContain('class="count mod-caveat"');
    expect(youtube).toContain("YouTube only lists deletes and bans the page reader includes.");

    const filled = panel({ actions: [action], youtubeConnected: true, twitchMissingReadScopes: true });
    expect(filled).not.toContain("No moderation actions yet.");
    expect(filled).toContain("Example timed out Viewer for 10m on Twitch.");
    expect(filled).toContain("fresh login");
    expect(filled).toContain("page reader");

    const off = panel({ enabled: false, twitchMissingReadScopes: true, youtubeConnected: true });
    expect(off).toContain("The mod log is off.");
    expect(off).not.toContain("No moderation actions yet.");
    expect(off).not.toContain("page reader");
  });
});
