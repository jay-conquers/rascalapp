import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertRemoteOrigin, tokenModeWarning, TOKEN_UPLOAD_WARNING } from "../deploy/fly/token-upload";
import { callChatHook } from "../packages/bot/src/chat-hook-send";
import { checkHookUrl } from "../packages/bot/src/chat-hook";
import { chooseHookAddress, classifyIp } from "../packages/bot/src/hook-guard";
import { startHttp } from "../packages/bot/src/http";
import { secretsMatch } from "../src/shared/kick/signature";
import { buildHookPayload, normalizeHook, type ChatHook } from "../packages/bot/src/chat-hook";
import { BotService } from "../packages/bot/src/service";
import { BotStore, generateSecret } from "../packages/bot/src/store";
import { EventSubClient, parseEventSubFrame } from "../src/main/redeems/eventsub";
import { isAllowedOverlayOrigin, isLoopbackHost } from "../src/main/loopback-guard";
import { Logger } from "../src/main/logger";
import { OverlayServer } from "../src/main/server";
import { NoticeSocket } from "../src/main/twitch/notices";
import { YOUTUBE_CONSENT_COOKIE, youtubePageHeaders } from "../src/shared/youtube/page-reader";
import { YOUTUBE_WEB_API_KEY_FALLBACK } from "../src/shared/defaults";
import { isTwitchEventSubUrl } from "../src/shared/eventsub-url";
import { defaultFeed } from "../src/shared/feed-toggles";
import type { ChatMessage } from "../src/shared/types";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entrypoint = require("../packages/bot/docker-entrypoint.cjs") as {
  tightenTree: (dir: string, owner: { uid: number; gid: number } | null) => void;
};

const gate = {
  platform: "twitch",
  channel: "mychannel",
  botUserId: "bot-id",
  botLogin: "rascalbot",
  channelLogin: "mychannel",
  broadcasterId: "42",
  publishedAt: 1_000,
  duplicate: false,
};

function hook(url: string): ChatHook {
  const base = normalizeHook({ name: "reader", trigger: "ask", url, secret: "topsecret", enabled: true, reply: "chat" });
  if (!base) throw new Error("hook fixture failed");
  return base;
}

function rawRequest(
  port: number,
  input: { path: string; method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: input.path,
        method: input.method ?? "GET",
        headers: input.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (input.body) req.write(input.body);
    req.end();
  });
}

describe("hook addresses", () => {
  it("canonicalizes odd IP spellings and blocks metadata, link-local, and private https", () => {
    expect(checkHookUrl("http://2130706433/secret")).toContain("127.0.0.1");
    expect(checkHookUrl("http://0x7f000001/")).toContain("127.0.0.1");
    expect(checkHookUrl("http://0177.0.0.1/")).toContain("127.0.0.1");
    expect(checkHookUrl("https://2130706433/")).toBe("");
    expect(checkHookUrl("https://127.0.0.1/")).toBe("");
    expect(checkHookUrl("https://10.1.2.3/")).toBe("");
    expect(checkHookUrl("https://169.254.169.254/")).toBe("");
    expect(checkHookUrl("https://metadata.google.internal/")).toBe("");
    expect(checkHookUrl("http://2852039166/", true)).toBe("");
    expect(checkHookUrl("http://167772161/hook", true)).toContain("10.0.0.1");
    expect(checkHookUrl("http://[::ffff:169.254.169.254]/", true)).toBe("");
    expect(checkHookUrl("http://[::ffff:7f00:1]/")).toContain("::ffff:7f00:1");
    expect(checkHookUrl("https://[::ffff:7f00:1]/")).toBe("");
    expect(checkHookUrl("http://[fd00::1]/", false)).toBe("");
    expect(checkHookUrl("http://[fd00::1]/", true)).toContain("fd00::1");
    expect(checkHookUrl("http://[fe80::1]/", true)).toBe("");
    expect(checkHookUrl("http://metadata/", true)).toBe("");
    expect(classifyIp("8.8.8.8")).toBe("public");
    expect(classifyIp("0.0.0.0")).toBe("blocked");
  });

  it("rejects a public name that resolves to a private or metadata address", () => {
    expect(chooseHookAddress("hooks.example", "https:", [{ address: "169.254.169.254", family: 4 }], false)).toBeNull();
    expect(chooseHookAddress("hooks.example", "https:", [{ address: "127.0.0.1", family: 4 }], false)).toBeNull();
    expect(chooseHookAddress("hooks.example", "https:", [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }], false)).toBeNull();
    expect(chooseHookAddress("hooks.example", "https:", [{ address: "93.184.216.34", family: 4 }], false)?.address).toBe("93.184.216.34");
    expect(chooseHookAddress("reader", "http:", [{ address: "10.1.2.3", family: 4 }], true)?.address).toBe("10.1.2.3");
    expect(chooseHookAddress("reader", "http:", [{ address: "1.2.3.4", family: 4 }], true)).toBeNull();
    expect(chooseHookAddress("reader", "http:", [{ address: "169.254.169.254", family: 4 }], true)).toBeNull();
    expect(chooseHookAddress("localhost", "http:", [{ address: "8.8.8.8", family: 4 }], true)).toBeNull();
    expect(chooseHookAddress("localhost", "http:", [{ address: "127.0.0.1", family: 4 }], false)?.address).toBe("127.0.0.1");
  });

  it("does not call the hook when DNS answers with a blocked address", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response("no");
    };
    const payload = buildHookPayload(hook("https://hooks.example/in"), { messageId: "m", userId: "u", login: "viewer", displayName: "Viewer", text: "!ask hi", roles: ["everyone"] }, "hi", gate, 5_000);
    await expect(
      callChatHook(hook("https://hooks.example/in"), payload, fetchImpl, {
        resolve: async () => [{ address: "169.254.169.254", family: 4 }],
      }),
    ).rejects.toThrow(/not allowed/);
    expect(called).toBe(false);
  });

  it("refuses a redirect from the pinned connection", async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits += 1;
      res.writeHead(302, { Location: "http://169.254.169.254/latest" });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as { port: number }).port;
    try {
      const data = hook(`http://127.0.0.1:${port}/in`);
      const payload = buildHookPayload(data, { messageId: "m", userId: "u", login: "viewer", displayName: "Viewer", text: "!ask hi", roles: ["everyone"] }, "hi", gate, 5_000);
      await expect(callChatHook(data, payload, fetch)).rejects.toThrow(/redirect/);
      expect(hits).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("connects to the approved address and ignores a later DNS change", async () => {
    const seen: { host?: string; body?: string } = {};
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        seen.host = req.headers.host;
        seen.body = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply: "pinned" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as { port: number }).port;
    try {
      const data = hook(`http://127.0.0.1:${port}/in`);
      const payload = buildHookPayload(data, { messageId: "m", userId: "u", login: "viewer", displayName: "Viewer", text: "!ask hi", roles: ["everyone"] }, "hi", gate, 5_000);
      const result = await callChatHook(data, payload, fetch);
      expect(result.reply).toBe("pinned");
      expect(seen.host).toBe(`127.0.0.1:${port}`);
      expect(seen.body).toContain("\"text\":\"hi\"");

      const previous = process.env.RASCAL_HOOK_PRIVATE_HTTP;
      process.env.RASCAL_HOOK_PRIVATE_HTTP = "1";
      try {
        const named = hook(`http://reader:${port}/in`);
        const again = await callChatHook(named, payload, fetch, { resolve: async () => [{ address: "127.0.0.1", family: 4 }] });
        expect(again.reply).toBe("pinned");
        expect(seen.host).toBe(`reader:${port}`);
      } finally {
        if (previous === undefined) delete process.env.RASCAL_HOOK_PRIVATE_HTTP;
        else process.env.RASCAL_HOOK_PRIVATE_HTTP = previous;
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("overlay loopback guard", () => {
  it("accepts only this machine's host and its own origin", () => {
    expect(isLoopbackHost("127.0.0.1:4777")).toBe(true);
    expect(isLoopbackHost("localhost:4777")).toBe(true);
    expect(isLoopbackHost("[::1]:4777")).toBe(true);
    expect(isLoopbackHost("evil.example")).toBe(false);
    expect(isLoopbackHost("127.0.0.1.evil.example")).toBe(false);
    expect(isAllowedOverlayOrigin(undefined, 4777)).toBe(true);
    expect(isAllowedOverlayOrigin("http://127.0.0.1:4777", 4777)).toBe(true);
    expect(isAllowedOverlayOrigin("http://localhost:4777", 4777)).toBe(true);
    expect(isAllowedOverlayOrigin("https://evil.example", 4777)).toBe(false);
    expect(isAllowedOverlayOrigin("http://127.0.0.1:9", 4777)).toBe(false);
    expect(isAllowedOverlayOrigin("null", 4777)).toBe(false);
  });

  it("refuses a foreign host or origin, including a websocket upgrade", async () => {
    const sample: ChatMessage = {
      id: "m1",
      platform: "twitch",
      channel: "examplechannel",
      username: "ace",
      displayName: "Ace",
      color: "#ffffff",
      badges: [],
      segments: [{ type: "text", text: "hi" }],
      plainText: "hi",
      timestamp: 1,
      kind: "chat",
    };
    const server = new OverlayServer(() => [sample], new Logger(null));
    const port = await server.start(0);
    try {
      const recent = await fetch(`http://127.0.0.1:${port}/api/chat/recent`);
      expect(recent.status).toBe(200);
      expect(recent.headers.get("access-control-allow-origin")).toBeNull();
      const rebound = await rawRequest(port, { path: "/api/chat/recent", headers: { Host: "evil.example" } });
      expect(rebound.status).toBe(403);
      const browser = await rawRequest(port, {
        path: "/api/chat/recent",
        headers: { Host: `127.0.0.1:${port}`, Origin: "https://evil.example" },
      });
      expect(browser.status).toBe(403);
      const upgrade = await rawRequest(port, {
        path: "/ws",
        headers: {
          Host: `127.0.0.1:${port}`,
          Origin: "https://evil.example",
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13",
        },
      });
      expect(upgrade.status).toBe(403);
    } finally {
      await server.stop();
    }
  });
});

describe("bot portal", () => {
  it("compares secrets without accepting an empty key", () => {
    expect(secretsMatch("", "")).toBe(false);
    expect(secretsMatch("present", "")).toBe(false);
    expect(secretsMatch("same-key-value", "same-key-value")).toBe(true);
    expect(secretsMatch("same-key-value", "other-key-value")).toBe(false);
  });

  it("caps request bodies and request rate", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-http-"));
    const service = new BotService(new BotStore(dir), { clientId: () => "client", log: () => {} });
    const started = await startHttp(service, { host: "127.0.0.1", port: 0, clientId: () => "client", bodyLimit: 32, rateLimit: 100 });
    try {
      const huge = await rawRequest(started.port, {
        method: "POST",
        path: "/api/commands",
        headers: {
          Host: `127.0.0.1:${started.port}`,
          Authorization: `Bearer ${service.apiKey()}`,
          "Content-Type": "application/json",
          "Content-Length": "80",
        },
        body: JSON.stringify({ name: "x".repeat(40), response: "y".repeat(40) }),
      });
      expect(huge.status).toBe(413);
      expect(huge.body).not.toContain(service.apiKey());
    } finally {
      await started.close();
    }

    const limited = await startHttp(service, { host: "127.0.0.1", port: 0, clientId: () => "client", rateLimit: 2 });
    try {
      expect((await rawRequest(limited.port, { path: "/healthz", headers: { Host: `127.0.0.1:${limited.port}` } })).status).toBe(200);
      expect((await rawRequest(limited.port, { path: "/healthz", headers: { Host: `127.0.0.1:${limited.port}` } })).status).toBe(200);
      expect((await rawRequest(limited.port, { path: "/healthz", headers: { Host: `127.0.0.1:${limited.port}` } })).status).toBe(429);
    } finally {
      await limited.close();
    }

    const proxied = await startHttp(service, { host: "127.0.0.1", port: 0, clientId: () => "client", rateLimit: 1 });
    try {
      const headers = (forwarded: string) => ({ Host: `127.0.0.1:${proxied.port}`, "X-Forwarded-For": forwarded });
      expect((await rawRequest(proxied.port, { path: "/healthz", headers: headers("203.0.113.4") })).status).toBe(200);
      expect((await rawRequest(proxied.port, { path: "/healthz", headers: headers("203.0.113.5") })).status).toBe(200);
      expect((await rawRequest(proxied.port, { path: "/healthz", headers: headers("203.0.113.4") })).status).toBe(429);
    } finally {
      await proxied.close();
    }
  });

  it("keeps the Twitch client secret on the server and revokes portal sessions", async () => {
    const previous = process.env.RASCAL_TWITCH_CLIENT_SECRET;
    const previousPlain = process.env.TWITCH_CLIENT_SECRET;
    process.env.RASCAL_TWITCH_CLIENT_SECRET = "portal-test-secret-value";
    delete process.env.TWITCH_CLIENT_SECRET;
    const calls: { url: string; body: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = init?.body instanceof URLSearchParams ? init.body.toString() : typeof init?.body === "string" ? init.body : "";
      calls.push({ url, body });
      if (url.includes("id.twitch.tv/oauth2/token")) return Response.json({ access_token: "access-test-token" });
      if (url.includes("helix/users")) return Response.json({ data: [{ id: "42", login: "examplechannel" }] });
      return new Response("no", { status: 404 });
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-portal-"));
    const service = new BotService(new BotStore(dir), { clientId: () => "client-id-test", fetchImpl, log: () => {} });
    service.setIdentity({ channelLogin: "examplechannel", broadcasterId: "42" });
    let clock = Date.now();
    const started = await startHttp(service, { host: "127.0.0.1", port: 0, clientId: () => "client-id-test", fetchImpl, now: () => clock });
    const host = `localhost:${started.port}`;
    try {
      const login = await rawRequest(started.port, { path: "/portal/login", headers: { Host: host } });
      expect(login.status).toBe(302);
      const state = new URL(String(login.headers.location)).searchParams.get("state") ?? "";
      expect(state).toMatch(/^[a-f0-9]{32}$/);
      const oauth = headerList(login.headers["set-cookie"]).find((cookie) => cookie.startsWith("rascal_portal_oauth="));
      expect(oauth).toContain(state);
      expect(oauth).toContain("HttpOnly");

      const missing = await rawRequest(started.port, { path: `/portal/callback?code=abc&state=${state}`, headers: { Host: host } });
      expect(missing.status).toBe(400);
      expect(calls).toHaveLength(0);

      const callback = await rawRequest(started.port, {
        path: `/portal/callback?code=abc&state=${state}`,
        headers: { Host: host, Cookie: `rascal_portal_oauth=${state}` },
      });
      expect(callback.status).toBe(302);
      expect(callback.body).not.toContain("portal-test-secret-value");
      expect(callback.body).not.toContain("access-test-token");
      const tokenCall = calls.find((call) => call.url === "https://id.twitch.tv/oauth2/token");
      expect(tokenCall?.body).toContain("client_secret=portal-test-secret-value");
      expect(tokenCall?.body).toContain("code_verifier=");
      const session = headerList(callback.headers["set-cookie"]).find((cookie) => cookie.startsWith("rascal_portal="));
      expect(session).toContain("HttpOnly");
      expect(session).not.toContain("examplechannel");
      expect(session).not.toContain("portal-test-secret-value");
      const cookie = session?.split(";")[0] ?? "";

      const authed = await rawRequest(started.port, { path: "/portal/api/state", headers: { Host: host, Cookie: cookie } });
      expect(authed.status).toBe(200);
      expect(authed.body).not.toContain("portal-test-secret-value");
      expect(authed.body).not.toContain("access-test-token");

      clock += 13 * 60 * 60 * 1000;
      const expired = await rawRequest(started.port, { path: "/portal/api/state", headers: { Host: host, Cookie: cookie } });
      expect(expired.status).toBe(401);
    } finally {
      await started.close();
      if (previous === undefined) delete process.env.RASCAL_TWITCH_CLIENT_SECRET;
      else process.env.RASCAL_TWITCH_CLIENT_SECRET = previous;
      if (previousPlain === undefined) delete process.env.TWITCH_CLIENT_SECRET;
      else process.env.TWITCH_CLIENT_SECRET = previousPlain;
    }
  });

  it("drops a portal session on logout", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("id.twitch.tv/oauth2/token")) return Response.json({ access_token: "access-test-token" });
      if (url.includes("helix/users")) return Response.json({ data: [{ id: "42", login: "examplechannel" }] });
      return new Response("no", { status: 404 });
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-logout-"));
    const service = new BotService(new BotStore(dir), { clientId: () => "client-id-test", fetchImpl, log: () => {} });
    service.setIdentity({ channelLogin: "examplechannel", broadcasterId: "42" });
    const started = await startHttp(service, { host: "127.0.0.1", port: 0, clientId: () => "client-id-test", fetchImpl });
    const host = `localhost:${started.port}`;
    try {
      const login = await rawRequest(started.port, { path: "/portal/login", headers: { Host: host } });
      const state = new URL(String(login.headers.location)).searchParams.get("state") ?? "";
      const callback = await rawRequest(started.port, {
        path: `/portal/callback?code=abc&state=${state}`,
        headers: { Host: host, Cookie: `rascal_portal_oauth=${state}` },
      });
      const cookie = headerList(callback.headers["set-cookie"]).find((item) => item.startsWith("rascal_portal="))?.split(";")[0] ?? "";
      expect((await rawRequest(started.port, { path: "/portal/api/state", headers: { Host: host, Cookie: cookie } })).status).toBe(200);
      expect((await rawRequest(started.port, { method: "POST", path: "/portal/logout", headers: { Host: host, Cookie: cookie } })).status).toBe(302);
      expect((await rawRequest(started.port, { path: "/portal/api/state", headers: { Host: host, Cookie: cookie } })).status).toBe(401);
      const forged = await rawRequest(started.port, { path: "/portal/api/state", headers: { Host: host, Cookie: "rascal_portal=aaaaaaaa.bbbbbbbb" } });
      expect(forged.status).toBe(401);
    } finally {
      await started.close();
    }
  });
});

describe("eventsub reconnect", () => {
  it("accepts only Twitch's eventsub host", () => {
    expect(isTwitchEventSubUrl("wss://eventsub.wss.twitch.tv/ws")).toBe(true);
    expect(isTwitchEventSubUrl("wss://eventsub.wss.twitch.tv/ws?reconnect=1")).toBe(true);
    expect(isTwitchEventSubUrl("wss://evil.example/ws")).toBe(false);
    expect(isTwitchEventSubUrl("wss://eventsub.wss.twitch.tv.evil.example/ws")).toBe(false);
    expect(isTwitchEventSubUrl("wss://user:pass@eventsub.wss.twitch.tv/ws")).toBe(false);
    expect(isTwitchEventSubUrl("ws://eventsub.wss.twitch.tv/ws")).toBe(false);
    expect(parseEventSubFrame(JSON.stringify({ metadata: { message_type: "session_reconnect" }, payload: { session: { reconnect_url: "wss://evil.example/steal" } } }))).toEqual({
      type: "reconnect",
      url: "wss://evil.example/steal",
    });
  });

  it("opens Twitch's socket when a reconnect frame names another host", async () => {
    const opened: string[] = [];
    const sockets: FakeSocket[] = [];
    const Original = globalThis.WebSocket;
    class FakeSocket {
      listeners = new Map<string, ((event: { data?: string }) => void)[]>();
      constructor(url: string) {
        opened.push(url);
        sockets.push(this);
      }
      addEventListener(type: string, fn: (event: { data?: string }) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
      }
      close() {}
      emit(data: string) {
        for (const fn of this.listeners.get("message") ?? []) fn({ data });
      }
    }
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const client = new EventSubClient({
      subscribe: async () => {},
      onRedemption: () => {},
      onStatus: () => {},
      log: { info() {}, error() {} },
    });
    const notices = new NoticeSocket({
      auth: () => ({ userId: "1", login: "example", scopes: [] }),
      channel: () => "example",
      feed: () => defaultFeed(),
      broadcasterId: async () => "1",
      subscribe: async () => {},
      emotes: () => new Map(),
      onChat: () => {},
      onModAction: () => {},
      onScopeProblem: () => {},
      log: { info() {}, error() {} },
    });
    try {
      client.start();
      sockets[0]?.emit(JSON.stringify({ metadata: { message_type: "session_reconnect" }, payload: { session: { reconnect_url: "wss://evil.example/steal" } } }));
      notices.start();
      sockets.at(-1)?.emit(JSON.stringify({ metadata: { message_type: "session_reconnect" }, payload: { session: { reconnect_url: "wss://evil.example/notice" } } }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(opened.every((url) => url.startsWith("wss://eventsub.wss.twitch.tv/"))).toBe(true);
      expect(opened.some((url) => url.includes("evil.example"))).toBe(false);
    } finally {
      client.stop();
      notices.stop();
      globalThis.WebSocket = Original;
    }
  });
});

describe("token files and the container", () => {
  it("generates API keys with crypto", () => {
    const first = generateSecret();
    const second = generateSecret();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("refuses a plain http upload and warns before copying tokens", () => {
    expect(assertRemoteOrigin("https://bot.example.com/portal")).toBe("https://bot.example.com");
    expect(assertRemoteOrigin("http://127.0.0.1:4788")).toBe("http://127.0.0.1:4788");
    expect(() => assertRemoteOrigin("http://bot.example.com")).toThrow(/https/);
    expect(() => assertRemoteOrigin("https://user:secret@bot.example.com")).toThrow(/password/);
    expect(tokenModeWarning(0o600, "linux")).toBeNull();
    expect(tokenModeWarning(0o644, "linux")).toMatch(/chmod 600/);
    expect(TOKEN_UPLOAD_WARNING).toMatch(/refresh token/);
    expect(TOKEN_UPLOAD_WARNING).not.toMatch(/oauth:/);
  });

  it("tightens data files without following a symlink, and drops root before the bot", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-data-"));
    const file = path.join(dir, "bot-tokens.json");
    fs.writeFileSync(file, "{}\n");
    if (process.platform !== "win32") fs.chmodSync(file, 0o644);
    if (process.platform !== "win32") fs.symlinkSync("/etc/passwd", path.join(dir, "leak"));
    expect(() => entrypoint.tightenTree(dir, null)).not.toThrow();
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.lstatSync(path.join(dir, "leak")).isSymbolicLink()).toBe(true);
    }
    const source = fs.readFileSync(path.join(repoRoot, "packages/bot/docker-entrypoint.cjs"), "utf8");
    expect(source.indexOf("process.setuid")).toBeGreaterThan(0);
    expect(source.indexOf('require("./bot.cjs")')).toBeGreaterThan(source.indexOf("process.setuid"));
    const dockerfile = fs.readFileSync(path.join(repoRoot, "packages/bot/Dockerfile"), "utf8");
    expect(dockerfile).toContain("docker-entrypoint.cjs");
    expect(dockerfile).not.toContain('CMD ["node", "bot.cjs"]');
  });
});

describe("youtube page fetch", () => {
  it("sends the public web client key and a consent cookie, not an account session", () => {
    expect(YOUTUBE_WEB_API_KEY_FALLBACK).toBe("AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8");
    const headers = youtubePageHeaders();
    expect(headers.Cookie).toBe(YOUTUBE_CONSENT_COOKIE);
    expect(headers.Cookie).toContain("CONSENT=");
    expect(headers.Cookie).not.toMatch(/SID=|HSID=|SSID=|LOGIN_INFO|SAPISID|__Secure-/);
    expect(headers.Authorization).toBeUndefined();
  });
});

function headerList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
