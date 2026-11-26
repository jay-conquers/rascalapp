import { describe, expect, it } from "vitest";
import { KickApi } from "../src/shared/kick/api";
import { createKickAuthRequest } from "../src/shared/kick/oauth";

describe("Kick API", () => {
  it("sends chat and moderates with Kick's ban, timeout, and delete calls", async () => {
    const calls: { url: string; method: string; body: string; authorization: string }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : "",
        authorization: headers.get("authorization") ?? "",
      });
      return new Response(null, { status: init?.method === "DELETE" ? 204 : 200 });
    };
    const api = new KickApi({ token: async () => "kick-access", fetchImpl });
    await api.sendMessage("5", "hello");
    await api.deleteMessage("unique_message_id_123");
    await api.moderate("5", "9", 2, "spam");
    await api.moderate("5", "9", null, "");
    await api.unmoderate("5", "9");
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /public/v1/chat",
      "DELETE /public/v1/chat/unique_message_id_123",
      "POST /public/v1/moderation/bans",
      "POST /public/v1/moderation/bans",
      "DELETE /public/v1/moderation/bans",
    ]);
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({ broadcaster_user_id: 5, content: "hello", type: "user" });
    expect(JSON.parse(calls[2]?.body ?? "")).toEqual({ broadcaster_user_id: 5, user_id: 9, reason: "spam", duration: 2 });
    expect(JSON.parse(calls[3]?.body ?? "")).toEqual({ broadcaster_user_id: 5, user_id: 9 });
    expect(calls.every((call) => call.authorization === "Bearer kick-access")).toBe(true);
  });

  it("builds an OAuth 2.1 authorize URL with PKCE and without the client secret", () => {
    const request = createKickAuthRequest({ clientId: "client12345", clientSecret: "super-secret-value" });
    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe("https://id.kick.com/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")?.length).toBeGreaterThan(20);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:4801/kick/callback");
    expect(request.url).not.toContain("super-secret-value");
    expect(request.verifier.length).toBeGreaterThan(20);
  });
});