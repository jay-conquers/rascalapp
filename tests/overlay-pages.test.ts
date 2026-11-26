import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildChatOverlayPage } from "../src/main/chat/page";
import { buildAlertsPage } from "../src/main/redeems/overlay-page";
import { portalPage } from "../packages/bot/src/portal-page";
import { ALLOWED_HOSTS } from "../src/shared/emote-url";

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
    expect(chat.hash).toBe("1dc51b363390");
    expect(sha256(chat.html)).toBe("4d3f4db71ab4744d9e8a359621f69f173910be9a93b82b860cf90005748a7b28");
    for (const host of ALLOWED_HOSTS) expect(chat.html).toContain(`"${host}": 1`);
  });

  it("serves the same mod portal page", () => {
    expect(sha256(portalPage())).toBe("96d13390e26248419b1fd3f51490323153974cb7ddeefe49c165c2e8b23f4c6a");
  });
});
