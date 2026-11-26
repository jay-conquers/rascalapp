import { describe, expect, it } from "vitest";
import { KickApi } from "../src/shared/kick/api";
import { buildKickChannelPatch, kickArtworkUrl, KICK_TITLE_RELOGIN, parseKickCategories } from "../src/shared/kick/channel";
import { KickConnection } from "../src/shared/kick/connection";
import type { KickTokens } from "../src/shared/kick/account";

describe("Kick channel update", () => {
  it("patches the title and category id, and searches categories on v2", async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : "",
      });
      if (String(url).includes("/public/v2/categories")) {
        return json({
          data: [
            { id: 101, name: "Old School Runescape", thumbnail: "https://kick.com/img/categories/old-school-runescape.jpeg" },
            { id: 0, name: "skip" },
          ],
          message: "OK",
        });
      }
      return new Response(null, { status: 204 });
    };
    const api = new KickApi({ token: async () => "kick-access", fetchImpl });
    expect(await api.searchCategories("os")).toEqual([]);
    expect(calls).toEqual([]);
    expect(await api.searchCategories("old")).toEqual([
      { id: "101", name: "Old School Runescape", boxArtUrl: "https://kick.com/img/categories/old-school-runescape.jpeg" },
    ]);
    await api.updateChannel({ title: "  Night raid  ", categoryId: "101" });
    await api.updateChannel({ title: "Title only" });
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "GET /public/v2/categories",
      "PATCH /public/v1/channels",
      "PATCH /public/v1/channels",
    ]);
    expect(new URL(calls[0]?.url ?? "").searchParams.get("name")).toBe("old");
    expect(JSON.parse(calls[1]?.body ?? "")).toEqual({ stream_title: "Night raid", category_id: 101 });
    expect(JSON.parse(calls[2]?.body ?? "")).toEqual({ stream_title: "Title only" });
  });

  it("turns a 403 on the channel update into a re-login message", async () => {
    const fetchImpl: typeof fetch = async () => json({ message: "Forbidden" }, 403);
    const api = new KickApi({ token: async () => "kick-access", fetchImpl });
    await expect(api.updateChannel({ title: "Hello", categoryId: "5" })).rejects.toThrow(KICK_TITLE_RELOGIN);
  });

  it("updates the channel with no relay, and does not call Kick when channel:write is missing", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if ((init?.method ?? "GET") === "PATCH") return new Response(null, { status: 204 });
      if (String(url).includes("/public/v2/categories")) return json({ data: [{ id: 15, name: "Minecraft", thumbnail: "" }] });
      return json({}, 500);
    };
    const tokens: KickTokens = {
      clientId: "client",
      accessToken: "kick-access",
      refreshToken: "kick-refresh",
      expiresAt: Date.now() + 60 * 60_000,
      scopes: ["user:read", "channel:read", "channel:write", "chat:write"],
      userId: "5",
      login: "rascal",
      slug: "rascal",
    };
    const connection = connectionWith(tokens, fetchImpl);
    await connection.updateStream("Desk title", "101");
    expect(calls.some((call) => call.startsWith("PATCH ") && call.includes("/public/v1/channels"))).toBe(true);
    expect(calls.some((call) => call.includes("relay") || call.startsWith("WS"))).toBe(false);
    expect(connection.snapshot().state).not.toBe("connected");

    calls.length = 0;
    const missing = connectionWith({ ...tokens, scopes: ["user:read", "channel:read", "chat:write"] }, fetchImpl);
    await expect(missing.updateStream("Desk title", "101")).rejects.toThrow(KICK_TITLE_RELOGIN);
    expect(calls).toEqual([]);
    await expect(missing.searchCategories("minecraft")).resolves.toEqual([{ id: "15", name: "Minecraft", boxArtUrl: "" }]);
    expect(calls.some((call) => call.includes("/public/v2/categories"))).toBe(true);
  });

  it("rejects a category id that JSON cannot round-trip and drops art from another host", () => {
    expect(() => buildKickChannelPatch({ title: "Hello", categoryId: "9007199254740993" })).toThrow(/category/);
    expect(JSON.stringify(buildKickChannelPatch({ title: "Hello", categoryId: "101" }))).toBe(
      JSON.stringify({ stream_title: "Hello", category_id: 101 }),
    );
    expect(kickArtworkUrl("https://kick.com/img/categories/minecraft.jpeg")).toContain("kick.com");
    expect(kickArtworkUrl("https://files.kick.com/images/cat.png")).toContain("files.kick.com");
    expect(kickArtworkUrl("http://127.0.0.1:4777/secret")).toBe("");
    expect(kickArtworkUrl("https://evil.example/cat.png")).toBe("");
    expect(kickArtworkUrl("https://user:pass@kick.com/cat.png")).toBe("");
    expect(
      parseKickCategories({
        data: [
          { id: 101, name: "Minecraft", thumbnail: "https://evil.example/cat.png" },
          { id: "9007199254740993", name: "Too big", thumbnail: "https://kick.com/ok.png" },
        ],
      }),
    ).toEqual([{ id: "101", name: "Minecraft", boxArtUrl: "" }]);
  });
});

function connectionWith(tokens: KickTokens, fetchImpl: typeof fetch): KickConnection {
  return new KickConnection({
    fetchImpl,
    client: () => ({ clientId: tokens.clientId, clientSecret: "not-logged" }),
    tokens: () => tokens,
    saveTokens: () => undefined,
    clearTokens: () => undefined,
    relayUrl: () => "",
    relaySecret: () => "",
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
