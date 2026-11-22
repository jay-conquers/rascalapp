import { describe, expect, it } from "vitest";
import { TtsClient } from "../src/main/tts/client";
import { parseTtsState } from "../src/shared/tts";

const state = {
  paused: false,
  hold: true,
  status: { twitch: "live", youtube: "off", askjeeves: "idle", youtube_subs: "on" },
  overlays_connected: 2,
  current: { id: "now", platform: "twitch", user: "ace", text: "hello" },
  queue: [{ id: "q1", platform: "youtube", username: "bee", message: "next" }],
  pending: [{ id: "p1", platform: "twitch", user: "cee", text: "approve me" }],
  stats: { accepted: 4, blocked: 1, cooldown: 0, played: 3, skipped: 1, expired: 0, failed: 0 },
  recent: [{ t: "12:01", result: "played", platform: "twitch", user: "ace", text: "hello", reason: "" }],
};

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
}

describe("tts client", () => {
  it("reads state and posts controls, including approve and a test line", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetchImpl = mockFetch(async (url, init) => {
      calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/api/state")) return Response.json(state);
      if (url.endsWith("/api/pause") && (init?.method ?? "GET") === "POST") return new Response("no", { status: 405 });
      return Response.json({ ok: true });
    });
    const client = new TtsClient(() => "http://127.0.0.1:17761/", fetchImpl);
    const read = await client.state();
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.state.hold).toBe(true);
      expect(read.state.queue[0]?.user).toBe("bee");
      expect(read.state.queue[0]?.text).toBe("next");
      expect(read.state.pending[0]?.id).toBe("p1");
      expect(read.state.status.askjeeves).toBe("idle");
    }
    expect(await client.skip()).toEqual({ ok: true });
    expect(await client.pause()).toEqual({ ok: true });
    expect(await client.approve("p1")).toEqual({ ok: true });
    expect(await client.reject("../etc")).toEqual({ ok: false, error: "That TTS item has no usable id." });
    expect(await client.inject({ platform: "youtube", user: "viewer", text: "test line" })).toEqual({ ok: true });

    const pause = calls.find((call) => call.url.endsWith("/api/pause") && call.method === "GET");
    expect(calls.some((call) => call.url.endsWith("/api/skip") && call.method === "POST")).toBe(true);
    expect(pause).toBeTruthy();
    expect(calls.some((call) => call.url.endsWith("/api/approve/p1") && call.method === "POST")).toBe(true);
    const inject = calls.find((call) => call.url.endsWith("/api/test/inject"));
    expect(inject?.method).toBe("POST");
    expect(JSON.parse(inject?.body ?? "{}")).toEqual({ platform: "youtube", user: "viewer", text: "test line" });
  });

  it("reports a down service without throwing", async () => {
    const client = new TtsClient(
      () => "http://127.0.0.1:17761",
      (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as typeof fetch,
    );
    const result = await client.state();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Can't reach tts-queue");
    expect(parseTtsState("nope")).toBeNull();
  });
});
