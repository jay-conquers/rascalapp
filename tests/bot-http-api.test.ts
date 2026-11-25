import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSocket } from "./helpers/fake-socket";
import { json, until } from "./helpers/fetch-router";
import { BOT_LOGIN, BOT_USER_ID, BROADCASTER_ID, CHANNEL, CLIENT_ID, YT_BOT_CHANNEL, createBot, readJson, startHttp, type BotFixture } from "./helpers/bot";
import type { FetchHandler } from "./helpers/fetch-router";

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: any;
}

function call(port: number, options: { method?: string; path: string; headers?: Record<string, string>; body?: unknown; host?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path,
        headers: { Host: options.host ?? `localhost:${port}`, ...(payload === undefined ? {} : { "Content-Type": "application/json" }), ...(options.headers ?? {}) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = undefined;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: parsed });
        });
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const portalUser = { id: "8", login: "coolmod", display_name: "CoolMod" };

const portalApis: FetchHandler = (request) => {
  if (request.where === "id.twitch.tv/oauth2/token" && new URLSearchParams(request.body).get("grant_type") === "authorization_code") {
    return json({ access_token: "portal-access-TESTTOKEN" });
  }
  if (request.where === "api.twitch.tv/helix/users" && !request.query.get("login")) return json({ data: [portalUser] });
  if (request.where === "api.twitch.tv/helix/moderation/channels") {
    return json({ data: request.query.get("user_id") === "8" ? [{ broadcaster_id: BROADCASTER_ID, broadcaster_login: CHANNEL }] : [] });
  }
  if (request.where === "id.twitch.tv/oauth2/device") {
    return json({ device_code: "device-TEST", user_code: "ABCD1234", verification_uri: "https://www.twitch.tv/activate", expires_in: 1800, interval: 0 });
  }
  if (request.where === "id.twitch.tv/oauth2/token" && new URLSearchParams(request.body).get("grant_type") === "urn:ietf:params:oauth:grant-type:device_code") {
    return json({ access_token: "bot-access-NEW", refresh_token: "bot-refresh-NEW", expires_in: 14_000 });
  }
  if (request.where === "id.twitch.tv/oauth2/validate") return json({ login: BOT_LOGIN, user_id: BOT_USER_ID, scopes: ["user:bot"] });
  if (request.where === "api.streamelements.com/kappa/v2/bot/commands/" + "a".repeat(24)) return json([{ command: "se", response: "from SE" }]);
  if (request.where === "api.streamelements.com/kappa/v2/bot/timers/" + "a".repeat(24)) return json([]);
  return undefined;
};

const servers: { close: () => Promise<void> }[] = [];
const fixtures: BotFixture[] = [];

async function serve(options: Parameters<typeof createBot>[0] = {}, clientId = CLIENT_ID) {
  const fixture = createBot({ twitch: false, extra: portalApis, ...options });
  fixtures.push(fixture);
  const server = await startHttp(fixture.service, { host: "127.0.0.1", port: 0, clientId: () => clientId, fetchImpl: fixture.fetchImpl });
  servers.push(server);
  const auth = { Authorization: `Bearer ${fixture.service.apiKey()}` };
  return { ...fixture, port: server.port, auth };
}

afterEach(async () => {
  for (const server of servers) await server.close();
  servers.length = 0;
  for (const fixture of fixtures) fixture.stop();
  fixtures.length = 0;
  vi.unstubAllGlobals();
  FakeSocket.reset();
});

describe("bot http api", () => {
  it("answers health checks without a key", async () => {
    const { port } = await serve();
    for (const pathname of ["/healthz", "/health"]) {
      const reply = await call(port, { path: pathname });
      expect(reply.status).toBe(200);
      expect(reply.json).toEqual({ ok: true, service: "rascal-bot" });
      expect(reply.headers["cache-control"]).toBe("no-store");
    }
  });

  it("requires the admin key for /api and returns the snapshot with it", async () => {
    const { port, auth } = await serve();
    expect(await call(port, { path: "/api/state" })).toMatchObject({ status: 401, json: { error: "Missing bot API key." } });
    expect((await call(port, { path: "/api/state", headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    const state = await call(port, { path: "/api/state", headers: auth });
    expect(state.status).toBe(200);
    expect(state.json).toMatchObject({ connected: false, channelLogin: CHANNEL, broadcasterId: BROADCASTER_ID, portalUrl: `http://localhost:${port}/portal` });
    expect((await call(port, { path: "/api/nope", headers: auth })).json).toEqual({ error: "Not found" });
    expect(await call(port, { path: "/nope" })).toMatchObject({ status: 404, json: { error: "Not found" } });
  });

  it("edits commands, timers, filters, extras, hooks, and accounts and returns the new snapshot", async () => {
    const { port, auth, dir } = await serve();
    const post = (pathname: string, body: unknown) => call(port, { method: "POST", path: pathname, headers: auth, body });
    expect((await post("/api/commands", { name: "hi", response: "hello" })).json.commands.map((item: { name: string }) => item.name)).toEqual(["hi"]);
    expect((await post("/api/commands/delete", { id: "hi" })).json.commands).toEqual([]);
    expect((await post("/api/timers", { name: "plug", message: "follow" })).json.timers[0]).toMatchObject({ name: "plug", messages: ["follow"] });
    expect((await post("/api/timers/delete", { id: "plug" })).json.timers).toEqual([]);
    expect((await post("/api/filters", { permitSec: 120 })).json.filters.permitSec).toBe(120);
    expect((await post("/api/extras", { shoutout: { template: "SO {target}" } })).json.shoutout).toEqual({ template: "SO {target}", helix: true });
    const hooked = await post("/api/hooks", { name: "reader", trigger: "ask", url: "https://hooks.example/in", secret: "hook-SECRET", reply: "chat" });
    expect(hooked.json.hooks[0]).toMatchObject({ id: "reader", secret: "", secretSet: true });
    expect(hooked.text).not.toContain("hook-SECRET");
    const tested = await post("/api/hooks/test", { id: "reader" });
    expect(tested.json).toMatchObject({ ok: true, status: 200, detail: "it is noon" });
    expect((await post("/api/hooks/delete", { id: "reader" })).json.hooks).toEqual([]);
    expect((await post("/api/accounts", { twitch: "channel" })).json.platforms[0].accountMode).toBe("channel");
    expect((await post("/api/google-client", { clientId: "id.apps.googleusercontent.com", clientSecret: "google-SECRET" })).json).toMatchObject({
      googleClientId: "id.apps.googleusercontent.com",
      googleClientSecretSet: true,
    });
    expect(readJson(dir, "google-client.json").clientSecret).toBe("google-SECRET");
    expect(await post("/api/commands", {})).toMatchObject({ status: 500, json: { error: "That command needs a name and a response." } });
    expect(await call(port, { method: "POST", path: "/api/commands", headers: auth, body: "not json" })).toMatchObject({ status: 500 });
  });

  it("exports and imports config, JSON, StreamElements, and sessions", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const { port, auth, dir } = await serve();
    const post = (pathname: string, body: unknown) => call(port, { method: "POST", path: pathname, headers: auth, body });
    await post("/api/import/config", { commands: [{ name: "one", response: "1" }], channelLogin: "imported" });
    const exported = await call(port, { path: "/api/export", headers: auth });
    expect(exported.json).toMatchObject({ channelLogin: "imported", commands: [expect.objectContaining({ name: "one" })] });
    expect((await post("/api/import/json", { commands: [{ command: "two", response: "2" }] })).json.commands.map((item: { name: string }) => item.name)).toEqual(["one", "two"]);
    const jwt = `header.${Buffer.from(JSON.stringify({ channel: "a".repeat(24) })).toString("base64url")}.sig-SECRET`;
    const imported = await post("/api/import/streamelements", { jwt });
    expect(imported.json.commands.map((item: { name: string }) => item.name)).toEqual(["one", "two", "se"]);
    expect(imported.json.seJwtSet).toBe(true);
    expect(imported.text).not.toContain("sig-SECRET");
    expect((await post("/api/import/tokens", { accessToken: "a", refreshToken: "r", userId: BOT_USER_ID, login: BOT_LOGIN })).json.botLogin).toBe(BOT_LOGIN);
    expect((await post("/api/import/youtube-tokens", { accessToken: "ya29.a", refreshToken: "r", channelId: YT_BOT_CHANNEL, title: "Bot" })).json.platforms[1].separateAccount).toBe("Bot");
    expect(readJson(dir, "bot-youtube-tokens.json").channelId).toBe(YT_BOT_CHANNEL);
  });

  it("runs the Twitch device login for the bot account and logs it out", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const { port, auth, dir, sent } = await serve();
    const started = await call(port, { method: "POST", path: "/api/login", headers: auth });
    expect(started.json.login).toMatchObject({ userCode: "ABCD1234", verificationUri: "https://www.twitch.tv/activate", expiresAt: expect.any(Number) });
    expect(new URLSearchParams(sent("id.twitch.tv/oauth2/device")[0]?.body).get("scopes")).toBe(
      "user:read:chat user:write:chat user:bot moderator:manage:chat_messages moderator:manage:banned_users moderator:read:followers",
    );
    await until(() => fs.existsSync(path.join(dir, "bot-tokens.json")), "bot tokens");
    const state = await call(port, { path: "/api/state", headers: auth });
    expect(state.json).toMatchObject({ botLogin: BOT_LOGIN, login: null, status: "Connecting to Twitch chat…" });
    const out = await call(port, { method: "POST", path: "/api/logout", headers: auth });
    expect(out.json).toMatchObject({ botLogin: null, status: "Bot logged out." });
    expect(fs.existsSync(path.join(dir, "bot-tokens.json"))).toBe(false);
  });

  it("finishes a YouTube bot login on the public callback and checks the host", async () => {
    const { port, auth, dir, service } = await serve({ youtube: false, files: { "google-client.json": { clientId: "web.apps.googleusercontent.com", clientSecret: "google-SECRET" } } });
    service.setIdentity({ publicUrl: "https://bot.example.com" });
    const started = await call(port, { method: "POST", path: "/api/youtube/login", headers: auth });
    const authorize = new URL(started.json.youtubeLogin.verificationUri);
    expect(authorize.origin + authorize.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(authorize.searchParams.get("redirect_uri")).toBe("https://bot.example.com/youtube/callback");
    const state = authorize.searchParams.get("state") ?? "";
    expect(await call(port, { path: `/youtube/callback?code=c&state=${state}`, host: "evil.example" })).toMatchObject({ status: 400, text: "Open the YouTube login from its public address." });
    const wrong = await call(port, { path: "/youtube/callback?code=c&state=unknown", host: "bot.example.com" });
    expect(wrong.status).toBe(400);
    expect(wrong.text).toContain("That YouTube login was not waiting. Start it again from Rascal.");
    const done = await call(port, { path: `/youtube/callback?code=c&state=${state}`, host: "bot.example.com" });
    expect(done.status).toBe(200);
    expect(done.text).toContain("YouTube is connected. You can close this window.");
    await until(() => fs.existsSync(path.join(dir, "bot-youtube-tokens.json")), "youtube tokens");
    expect(readJson(dir, "bot-youtube-tokens.json")).toMatchObject({ channelId: YT_BOT_CHANNEL, title: "Rascal Bot", refreshToken: "yt-refresh-NEW", clientId: "web.apps.googleusercontent.com" });
    const after = await call(port, { path: "/api/state", headers: auth });
    expect(after.json).toMatchObject({ youtubeLogin: null });
    expect(after.json.platforms[1]).toMatchObject({ separateAccount: "Rascal Bot" });
    expect((await call(port, { method: "POST", path: "/api/youtube/logout", headers: auth })).json.platforms[1].separateAccount).toBeNull();
    const again = await call(port, { method: "POST", path: "/api/youtube/login", headers: auth });
    expect(again.json.youtubeLogin).not.toBeNull();
    expect((await call(port, { method: "POST", path: "/api/youtube/cancel", headers: auth })).json.youtubeLogin).toBeNull();
  });
});

describe("mod portal", () => {
  it("serves the page on localhost and redirects 127.0.0.1 there", async () => {
    const { port } = await serve();
    const page = await call(port, { path: "/portal" });
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.text).toContain("Rascal mods");
    const redirected = await call(port, { path: "/portal/login?x=1", host: `127.0.0.1:${port}` });
    expect(redirected.status).toBe(302);
    expect(redirected.headers.location).toBe(`http://localhost:${port}/portal/login?x=1`);
  });

  it("logs a moderator in with PKCE, sets a session cookie, and limits the portal to its own routes", async () => {
    const { port, sent } = await serve();
    const login = await call(port, { path: "/portal/login" });
    expect(login.status).toBe(302);
    const authorize = new URL(String(login.headers.location));
    expect(authorize.origin + authorize.pathname).toBe("https://id.twitch.tv/oauth2/authorize");
    expect(Object.fromEntries([...authorize.searchParams.entries()].filter(([key]) => key !== "state" && key !== "code_challenge"))).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: `http://localhost:${port}/portal/callback`,
      response_type: "code",
      scope: "user:read:moderated_channels",
      code_challenge_method: "S256",
    });
    const state = authorize.searchParams.get("state") ?? "";
    expect(await call(port, { path: `/portal/callback?code=c&state=${state}`, host: "evil.example" })).toMatchObject({
      status: 400,
      json: { error: "Open the portal on its public address and log in again." },
    });
    const ok = await call(port, { path: `/portal/callback?code=c&state=${state}` });
    expect(ok.status).toBe(302);
    expect(await call(port, { path: `/portal/callback?code=c&state=${state}` })).toMatchObject({ status: 400, json: { error: "That login expired. Start again." } });
    expect(ok.headers.location).toBe("/portal");
    const cookie = String(ok.headers["set-cookie"]?.[0] ?? "");
    expect(cookie).toMatch(/^rascal_portal=[^;]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=43200$/);
    const exchange = sent("id.twitch.tv/oauth2/token").at(-1);
    expect(new URLSearchParams(exchange?.body).get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new URLSearchParams(exchange?.body).has("client_secret")).toBe(false);

    const session = { Cookie: cookie.split(";")[0] ?? "" };
    expect(await call(port, { path: "/portal/api/state" })).toMatchObject({ status: 401, json: { error: "Log in with Twitch." } });
    expect((await call(port, { path: "/portal/api/state", headers: session })).json).toMatchObject({ channelLogin: CHANNEL });
    expect((await call(port, { method: "POST", path: "/portal/api/commands", headers: session, body: { name: "modcmd", response: "x" } })).json.commands[0].name).toBe("modcmd");
    expect((await call(port, { path: "/portal/api/export", headers: session })).json.commands[0].name).toBe("modcmd");
    expect((await call(port, { method: "POST", path: "/portal/api/import/config", headers: session, body: {} })).status).toBe(404);
    expect((await call(port, { path: "/api/state", headers: session })).status).toBe(401);
    expect((await call(port, { path: "/portal/api/state", headers: { Cookie: `${session.Cookie}x` } })).status).toBe(401);
    const out = await call(port, { method: "POST", path: "/portal/logout", headers: session });
    expect(out.status).toBe(302);
    expect(String(out.headers["set-cookie"]?.[0])).toBe("rascal_portal=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  });

  it("refuses a Twitch account that does not moderate the channel and a missing client id", async () => {
    const { port } = await serve({
      extra: (request) => {
        if (request.where === "api.twitch.tv/helix/users" && !request.query.get("login")) return json({ data: [{ id: "77", login: "stranger" }] });
        return portalApis(request);
      },
    });
    const state = new URL(String((await call(port, { path: "/portal/login" })).headers.location)).searchParams.get("state") ?? "";
    expect(await call(port, { path: `/portal/callback?code=c&state=${state}` })).toMatchObject({ status: 500, json: { error: "That Twitch account is not a moderator of this channel." } });
    const noClient = await serve({}, "");
    expect(await call(noClient.port, { path: "/portal/login" })).toMatchObject({ status: 400, json: { error: "Set the Twitch client ID before using the portal." } });
  });
});
