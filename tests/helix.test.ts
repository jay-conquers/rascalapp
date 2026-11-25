import { describe, expect, it } from "vitest";
import { buildChannelPatch, Helix } from "../src/main/twitch/helix";

describe("helix stream info", () => {
  it("validates title, category, and tags before they are sent", () => {
    expect(buildChannelPatch({ title: "  Sunday  ", gameId: "509658", tags: ["Variety", "chill1"] })).toEqual({
      title: "Sunday",
      game_id: "509658",
      tags: ["Variety", "chill1"],
    });
    expect(() => buildChannelPatch({ title: "", gameId: "1", tags: [] })).toThrow(/empty/);
    expect(() => buildChannelPatch({ title: "x".repeat(141), gameId: "1", tags: [] })).toThrow(/140/);
    expect(() => buildChannelPatch({ title: "ok", gameId: "just chatting", tags: [] })).toThrow(/category/);
    expect(() => buildChannelPatch({ title: "ok", gameId: "1", tags: ["has space"] })).toThrow(/letters and numbers/);
  });

  it("sends a bearer token and redacts it if Twitch echoes it in an error", async () => {
    const seen: { authorization?: string; clientId?: string; body?: string }[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        authorization: headers.get("authorization") ?? undefined,
        clientId: headers.get("client-id") ?? undefined,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(JSON.stringify({ message: "nope access_token=access-TESTTOKEN" }), { status: 500 });
    };
    const helix = new Helix({
      clientId: () => "client1234567890",
      getToken: async () => "access-TESTTOKEN",
      refresh: async () => undefined,
      fetchImpl,
    });
    await expect(helix.updateStream("99", { title: "Hello", gameId: "509658", tags: [] })).rejects.toThrow(
      /access_token=\[redacted\]/,
    );
    expect(seen[0]?.authorization).toBe("Bearer access-TESTTOKEN");
    expect(seen[0]?.clientId).toBe("client1234567890");
    expect(seen[0]?.body).toContain("\"title\":\"Hello\"");
    expect(String(seen[0]?.authorization)).not.toContain("SCHMOOPIIE");
  });

  it("refreshes once after a 401 and then reads channel plus stream", async () => {
    let calls = 0;
    let refreshCount = 0;
    const fetchImpl: typeof fetch = async (input) => {
      calls += 1;
      const url = String(input);
      if (calls === 1) return new Response(JSON.stringify({ message: "invalid token" }), { status: 401 });
      if (url.includes("/channels")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                title: "Boss fight",
                game_id: "1",
                game_name: "Just Chatting",
                tags: ["English"],
                broadcaster_language: "en",
              },
            ],
          }),
        );
      }
      return new Response(JSON.stringify({ data: [{ viewer_count: 12, started_at: "2026-11-21T03:00:00Z" }] }));
    };
    const helix = new Helix({
      clientId: () => "client1234567890",
      getToken: async () => "access-TESTTOKEN",
      refresh: async () => {
        refreshCount += 1;
      },
      fetchImpl,
    });
    const info = await helix.getStreamInfo("42");
    expect(refreshCount).toBe(1);
    expect(info).toMatchObject({ title: "Boss fight", live: true, viewerCount: 12, tags: ["English"] });
  });

  it("deletes one message by query id, and refuses to call Twitch without one", async () => {
    const seen: { url: string; method: string; body?: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(null, { status: 204 });
    };
    const helix = new Helix({
      clientId: () => "client1234567890",
      getToken: async () => "access-TESTTOKEN",
      refresh: async () => undefined,
      fetchImpl,
    });
    await expect(helix.deleteChatMessage("42", "42", "")).rejects.toThrow(/message/);
    expect(seen).toEqual([]);
    await helix.deleteChatMessage("42", "7", "11111111-1111-1111-1111-111111111111");
    expect(seen[0]?.method).toBe("DELETE");
    expect(seen[0]?.url).toContain("/moderation/chat?");
    expect(seen[0]?.url).toContain("broadcaster_id=42");
    expect(seen[0]?.url).toContain("moderator_id=7");
    expect(seen[0]?.url).toContain("message_id=11111111-1111-1111-1111-111111111111");
    expect(seen[0]?.body).toBeUndefined();
  });

  it("bans with a duration, bans without one, and unbans by user id", async () => {
    const seen: { url: string; method: string; body?: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if ((init?.method ?? "GET") === "POST") {
        return new Response(JSON.stringify({ data: [{ user_id: "99" }] }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    };
    const helix = new Helix({
      clientId: () => "client1234567890",
      getToken: async () => "access-TESTTOKEN",
      refresh: async () => undefined,
      fetchImpl,
    });
    await helix.banUser("42", "7", "99", 600, "");
    await helix.banUser("42", "7", "99", null, "spam");
    await helix.unbanUser("42", "7", "99");
    expect(seen[0]?.url).toContain("/moderation/bans?");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ data: { user_id: "99", duration: 600 } });
    expect(JSON.parse(seen[1]?.body ?? "{}")).toEqual({ data: { user_id: "99", reason: "spam" } });
    expect(seen[2]?.method).toBe("DELETE");
    expect(seen[2]?.url).toContain("user_id=99");
    expect(seen[2]?.body).toBeUndefined();
  });

  it("pages through chatters until the cursor runs out", async () => {
    const cursors: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      cursors.push(url.searchParams.get("after") ?? "");
      const after = url.searchParams.get("after");
      if (!after) {
        return new Response(
          JSON.stringify({
            data: [{ user_id: "1", user_login: "ace", user_name: "Ace" }],
            pagination: { cursor: "page-2" },
            total: 2,
          }),
        );
      }
      return new Response(
        JSON.stringify({
          data: [{ user_id: "2", user_login: "cedar", user_name: "Cedar" }, { user_login: "" }],
          pagination: {},
          total: 2,
        }),
      );
    };
    const helix = new Helix({
      clientId: () => "client1234567890",
      getToken: async () => "access-TESTTOKEN",
      refresh: async () => undefined,
      fetchImpl,
    });
    await expect(helix.listChatters("nope", "7")).resolves.toEqual([]);
    const rows = await helix.listChatters("42", "7");
    expect(cursors).toEqual(["", "page-2"]);
    expect(rows).toEqual([
      { name: "Ace", login: "ace" },
      { name: "Cedar", login: "cedar" },
    ]);
    expect(rows).toHaveLength(2);
  });
});
