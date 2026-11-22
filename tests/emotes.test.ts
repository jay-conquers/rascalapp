import { describe, expect, it } from "vitest";
import { safeEmoteUrl } from "../src/shared/emote-url";
import { indexThirdParty } from "../src/shared/third-party";
import { applyWordEmotes } from "../src/shared/word-emotes";

describe("third-party emotes", () => {
  it("indexes bttv, ffz, and 7tv and skips unknown hosts", () => {
    const map = indexThirdParty({
      bttvGlobal: [{ id: "bttv1", code: "KEKW" }],
      bttvUser: { channelEmotes: [{ id: "bttv2", code: "sampleKEK" }], sharedEmotes: [] },
      ffzGlobal: {
        sets: { "3": { emoticons: [{ name: "Pog", urls: { "1": "//cdn.frankerfacez.com/emote/1/1" } }] } },
      },
      ffzRoom: {
        sets: { "9": { emoticons: [{ name: "Nope", urls: { "1": "https://evil.example/nope.png" } }] } },
      },
      sevenTvGlobal: {
        emotes: [
          {
            name: "OMEGALUL",
            data: { host: { url: "//cdn.7tv.app/emote/seven1", files: [{ name: "2x.webp" }, { name: "1x.webp" }] } },
          },
        ],
      },
      sevenTvUser: { emote_set: { emotes: [] } },
    });
    expect(map.get("KEKW")?.url).toBe("https://cdn.betterttv.net/emote/bttv1/1x");
    expect(map.get("sampleKEK")?.source).toBe("bttv");
    expect(map.get("Pog")?.url).toBe("https://cdn.frankerfacez.com/emote/1/1");
    expect(map.has("Nope")).toBe(false);
    expect(map.get("OMEGALUL")?.url).toBe("https://cdn.7tv.app/emote/seven1/1x.webp");
    expect(safeEmoteUrl("http://cdn.betterttv.net/emote/x/1x")).toBeNull();
  });

  it("replaces whole words and keeps surrounding punctuation", () => {
    const map = indexThirdParty({ bttvGlobal: [{ id: "bttv1", code: "KEKW" }] });
    const segments = applyWordEmotes([{ type: "text", text: "Hello KEKW!" }], map);
    expect(segments).toEqual([
      { type: "text", text: "Hello " },
      {
        type: "emote",
        text: "KEKW",
        url: "https://cdn.betterttv.net/emote/bttv1/1x",
        source: "bttv",
      },
      { type: "text", text: "!" },
    ]);
  });
});
