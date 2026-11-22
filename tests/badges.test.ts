import { describe, expect, it } from "vitest";
import { BadgeCatalog } from "../src/main/twitch/badges";
import { Logger } from "../src/main/logger";
import { indexHelixBadges } from "../src/shared/twitch-badges";

const globalPayload = {
  data: [
    {
      set_id: "subscriber",
      versions: [{ id: "0", image_url_1x: "https://static-cdn.jtvnw.net/badges/v1/global-sub/1", image_url_2x: "https://static-cdn.jtvnw.net/badges/v1/global-sub/2" }],
    },
    {
      set_id: "broadcaster",
      versions: [{ id: "1", image_url_4x: "https://static-cdn.jtvnw.net/badges/v1/host/4" }],
    },
  ],
};

const channelPayload = {
  data: [
    {
      set_id: "subscriber",
      versions: [{ id: "12", image_url_2x: "https://static-cdn.jtvnw.net/badges/v1/channel-sub-12/2" }],
    },
  ],
};

describe("twitch helix badges", () => {
  it("indexes 2x art and lets a channel badge override the global one", async () => {
    expect(indexHelixBadges(globalPayload)).toEqual({
      "subscriber/0": "https://static-cdn.jtvnw.net/badges/v1/global-sub/2",
      "broadcaster/1": "https://static-cdn.jtvnw.net/badges/v1/host/4",
    });
    const catalog = new BadgeCatalog({
      log: new Logger(null),
      loadGlobal: async () => globalPayload,
      loadChannel: async () => channelPayload,
    });
    await catalog.loadGlobal();
    await catalog.loadChannel("4242");
    expect(catalog.imageFor({ kind: "sub", label: "SUB", detail: "41", set: "subscriber", version: "12" })).toBe(
      "https://static-cdn.jtvnw.net/badges/v1/channel-sub-12/2",
    );
    expect(catalog.imageFor({ kind: "broadcaster", label: "HOST", set: "broadcaster", version: "1" })).toBe(
      "https://static-cdn.jtvnw.net/badges/v1/host/4",
    );
    expect(catalog.imageFor({ kind: "sub", label: "SUB", set: "subscriber", version: "48" })).toBeNull();
    expect(catalog.imageFor({ kind: "member", label: "MEMBER", imageUrl: "https://yt3.ggpht.com/member" })).toBe(
      "https://yt3.ggpht.com/member",
    );
    catalog.stop();
  });
});