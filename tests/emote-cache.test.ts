import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EmoteImageCache, sniffImage } from "../src/main/emotes/image-cache";
import { Logger } from "../src/main/logger";
import { expectPrivateMode } from "./expect-mode";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

describe("emote image cache", () => {
  it("stores an allowlisted image without sending a token and rejects other hosts", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-emotes-"));
    const seen: { url: string; authorization: string | null; cookie: string | null }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: String(input),
        authorization: headers.get("authorization"),
        cookie: headers.get("cookie"),
      });
      if (String(input).includes("evil.example")) return new Response("no", { status: 200 });
      return new Response(PNG, { status: 200, headers: { "Content-Type": "image/svg+xml" } });
    };
    const cache = new EmoteImageCache({ dir, log: new Logger(null), fetchImpl });
    cache.prefetch("https://evil.example/track.png");
    cache.prefetch("http://cdn.betterttv.net/emote/x/1x");
    cache.prefetch("https://cdn.betterttv.net/emote/bttv1/1x");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen.map((call) => call.url)).toEqual(["https://cdn.betterttv.net/emote/bttv1/1x"]);
    expect(seen[0]?.authorization).toBeNull();
    expect(seen[0]?.cookie).toBeNull();
    const local = cache.overlayUrl("https://cdn.betterttv.net/emote/bttv1/1x", 4777);
    expect(local).toMatch(/^http:\/\/127\.0\.0\.1:4777\/emote\/[a-f0-9]{64}$/);
    const hash = local?.split("/").pop() ?? "";
    expect(cache.read(hash)?.type).toBe("image/png");
    expectPrivateMode(path.join(dir, "emote-cache", hash), 0o600);
    expect(sniffImage(Buffer.from("<svg></svg>"))).toBeNull();
  });
});
