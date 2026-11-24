import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Logger } from "../src/main/logger";
import { TokenStore } from "../src/main/tokens";
import { TwitchAuth } from "../src/main/twitch/oauth";
import { REQUIRED_SCOPES } from "../src/shared/scopes";
import { expectPrivateMode } from "./expect-mode";

describe("twitch device login", () => {
  it("polls until approval, stores a 0600 token, and never logs the token", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ember-oauth-"));
    const tokens = new TokenStore(dir);
    const log = new Logger(null);
    const calls: { url: string; body?: string; authorization?: string }[] = [];
    let polls = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        body: typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : undefined,
        authorization: headers.get("authorization") ?? undefined,
      });
      if (url.endsWith("/device")) {
        return json({
          device_code: "device-TEST",
          user_code: "ABCDEFGH",
          verification_uri: "https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH",
          expires_in: 1800,
          interval: 0,
        });
      }
      if (url.endsWith("/token") && polls === 0) {
        polls += 1;
        return json({ status: 400, message: "authorization pending" }, 400);
      }
      if (url.endsWith("/token")) {
        return json({
          access_token: "access-TESTTOKEN",
          refresh_token: "refresh-TESTTOKEN",
          expires_in: 14000,
          scope: ["chat:read"],
        });
      }
      expect(headers.get("authorization")).toBe("OAuth access-TESTTOKEN");
      return json({
        client_id: "client1234567890",
        login: "examplechannel",
        user_id: "4242",
        scopes: [...REQUIRED_SCOPES],
        expires_in: 14000,
      });
    };
    let opened = "";
    const auth = new TwitchAuth({
      clientId: () => "client1234567890",
      tokens,
      log,
      fetchImpl,
      openBrowser: async (url) => {
        opened = url;
      },
      onChange: () => undefined,
    });
    await auth.login();
    expect(opened).toContain("https://www.twitch.tv/activate");
    expect(calls[0]?.body).toContain("channel%3Amanage%3Abroadcast");
    expect(calls[0]?.body).toContain("user%3Aread%3Achat");
    expect(calls[0]?.body).toContain("moderator%3Aread%3Awarnings");
    expect(calls[0]?.body).toContain("moderator%3Aread%3Afollowers");
    expect(tokens.current?.login).toBe("examplechannel");
    expect(tokens.current?.accessToken).toBe("access-TESTTOKEN");
    expectPrivateMode(tokens.file, 0o600);
    expect(auth.state().missingScopes).toEqual([]);
    const logged = log.lines.join("\n");
    expect(logged).not.toContain("access-TESTTOKEN");
    expect(logged).not.toContain("refresh-TESTTOKEN");
    expect(logged).not.toContain("device-TEST");

    const before = calls.length;
    await auth.ensureFresh();
    expect(calls.length).toBe(before);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
