import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildChatOverlayPage } from "../src/main/chat/page";
import { buildAlertsPage } from "../src/main/redeems/overlay-page";
import { portalPage } from "../packages/bot/src/portal-page";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * An open OBS browser source reloads itself when the served page hash changes, and the
 * portal is fetched by mods' browsers. These pins make any change to the served HTML deliberate.
 */
describe("served pages", () => {
  it("serves the same alerts and chat overlay pages for this version", () => {
    const alerts = buildAlertsPage("0.8.1");
    const chat = buildChatOverlayPage("0.8.1");
    expect(alerts.hash).toBe("2fd8afc84669");
    expect(sha256(alerts.html)).toBe("47cde53e8df76ea4bbea81b29374a64d1e0a69f8e399e4b07b143c4321e62798");
    expect(chat.hash).toBe("6b53dd86728a");
    expect(sha256(chat.html)).toBe("a421dfa9e0e3664f0bbce382507b894e35b310a94888a46c54fdd5c3679a0640");
  });

  it("serves the same mod portal page", () => {
    expect(sha256(portalPage())).toBe("96500b6c95a3087522bc998fa7755dd17d070d2d962c676389562a35868b8470");
  });
});
