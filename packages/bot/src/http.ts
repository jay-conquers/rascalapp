import crypto from "node:crypto";
import http from "node:http";
import { brand, readBrandEnv } from "../../../src/shared/brand.ts";
import { redact } from "../../../src/shared/redact.ts";
import { classifyIp } from "./hook-guard.ts";
import { PORTAL_SCOPES } from "./model.ts";
import { portalPage } from "./portal-page.ts";
import type { BotService } from "./service.ts";

interface Session {
  userId: string;
  login: string;
  expiresAt: number;
}

interface PendingLogin {
  verifier: string;
  expiresAt: number;
}

const SESSION_MS = 12 * 60 * 60 * 1000;
const OAUTH_COOKIE = `${brand.portalCookie}_oauth`;
const DEFAULT_BODY_LIMIT = 1_048_576;
const DEFAULT_RATE_LIMIT = 600;
const MAX_PENDING = 64;

export interface HttpOptions {
  host: string;
  port: number;
  clientId: () => string;
  fetchImpl?: typeof fetch;
  bodyLimit?: number;
  /** Requests per minute for one client address. */
  rateLimit?: number;
  now?: () => number;
}

export async function startHttp(service: BotService, options: HttpOptions): Promise<{ port: number; close: () => Promise<void> }> {
  const pending = new Map<string, PendingLogin>();
  const sessions = new Map<string, Session>();
  const buckets = new Map<string, number[]>();
  const fetchImpl = options.fetchImpl ?? fetch;
  const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
  const rateLimit = options.rateLimit ?? DEFAULT_RATE_LIMIT;
  const now = options.now ?? (() => Date.now());
  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err) => {
      if (res.writableEnded) return;
      const status = errorStatus(err);
      sendJson(res, status, { error: status === 413 ? "Request body is too large." : publicError(err) });
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 20_000;
  server.maxHeadersCount = 100;

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = requestTarget(req, options.host);
    const method = (req.method ?? "GET").toUpperCase();
    const port = serverPort(server, options.port);
    if (tooMany(buckets, clientAddress(req), rateLimit, now())) {
      sendJson(res, 429, { error: "Too many requests." });
      return;
    }
    if (method === "GET" && redirectLoopbackPortal(req, res, service.snapshot(port).redirectUri, port)) return;
    if (method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
      sendJson(res, 200, { ok: true, service: brand.botHealthService });
      return;
    }
    if (method === "GET" && url.pathname === "/portal") {
      const html = portalPage();
      res.writeHead(200, {
        ...baseHeaders(),
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": portalCsp(),
        "Content-Length": Buffer.byteLength(html),
      });
      res.end(html);
      return;
    }
    if (method === "GET" && url.pathname === "/portal/login") {
      const clientId = options.clientId();
      if (!clientId) {
        sendJson(res, 400, { error: "Set the Twitch client ID before using the portal." });
        return;
      }
      sweep(sessions, pending, now());
      while (pending.size >= MAX_PENDING) {
        const oldest = pending.keys().next().value;
        if (!oldest) break;
        pending.delete(oldest);
      }
      const state = crypto.randomBytes(16).toString("hex");
      const verifier = crypto.randomBytes(32).toString("base64url");
      const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
      pending.set(state, { verifier, expiresAt: now() + 10 * 60 * 1000 });
      const redirect = service.snapshot(serverPort(server, options.port)).redirectUri;
      const authorize = new URL("https://id.twitch.tv/oauth2/authorize");
      authorize.searchParams.set("client_id", clientId);
      authorize.searchParams.set("redirect_uri", redirect);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("scope", PORTAL_SCOPES.join(" "));
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");
      res.writeHead(302, {
        Location: authorize.toString(),
        "Cache-Control": "no-store",
        "Set-Cookie": cookieHeader(OAUTH_COOKIE, state, redirect, 600),
      });
      res.end();
      return;
    }
    if (method === "GET" && url.pathname === "/youtube/callback") {
      const redirect = service.youtubeRedirect();
      if (requestHostname(req) !== new URL(redirect).hostname.toLowerCase()) {
        res.writeHead(400, { ...baseHeaders(), "Content-Type": "text/plain; charset=utf-8" });
        res.end("Open the YouTube login from its public address.");
        return;
      }
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const error = url.searchParams.get("error") ?? "";
      const accepted = service.acceptYoutubeCallback({ code, state, error });
      const page = accepted && !error ? "YouTube is connected. You can close this window." : "That YouTube login was not waiting. Start it again from Rascal.";
      res.writeHead(accepted ? 200 : 400, { ...baseHeaders(), "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><title>YouTube</title><p>${page}</p>`);
      return;
    }
    if (method === "GET" && url.pathname === "/portal/callback") {
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const redirect = service.snapshot(port).redirectUri;
      if (!portalHostMatches(req, redirect)) {
        sendJson(res, 400, { error: "Open the portal on its public address and log in again." });
        return;
      }
      const cookieState = readCookie(req, OAUTH_COOKIE);
      if (!cookieState || !secretsMatch(cookieState, state)) {
        sendJson(res, 400, { error: "That login expired. Start again." });
        return;
      }
      const flow = pending.get(state);
      pending.delete(state);
      if (!flow || flow.expiresAt < now() || !code) {
        sendJson(res, 400, { error: "That login expired. Start again." });
        return;
      }
      const session = await finishPortalLogin(service, options.clientId(), flow.verifier, code, redirect, fetchImpl);
      const cookie = issueSession(sessions, session, now(), service.sessionSecret());
      res.writeHead(302, {
        Location: "/portal",
        "Cache-Control": "no-store",
        "Set-Cookie": [cookieHeader(brand.portalCookie, cookie, redirect, SESSION_MS / 1000), cookieHeader(OAUTH_COOKIE, "", redirect, 0)],
      });
      res.end();
      return;
    }
    if (method === "POST" && url.pathname === "/portal/logout") {
      const redirect = service.snapshot(port).redirectUri;
      const id = openSession(readCookie(req, brand.portalCookie), service.sessionSecret());
      if (id) sessions.delete(id);
      res.writeHead(302, {
        Location: "/portal",
        "Cache-Control": "no-store",
        "Set-Cookie": [cookieHeader(brand.portalCookie, "", redirect, 0), cookieHeader(OAUTH_COOKIE, "", redirect, 0)],
      });
      res.end();
      return;
    }
    const portalSession = readSession(sessions, openSession(readCookie(req, brand.portalCookie), service.sessionSecret()) ?? "", now());
    const local = authorizedLocal(req, service.apiKey());
    if (url.pathname.startsWith("/portal/api/")) {
      if (!portalSession) {
        sendJson(res, 401, { error: "Log in with Twitch." });
        return;
      }
    } else if (url.pathname.startsWith("/api/") && !local) {
      sendJson(res, 401, { error: "Missing bot API key." });
      return;
    }
    if (method === "GET" && (url.pathname === "/api/state" || url.pathname === "/portal/api/state")) {
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method !== "GET" && overLimit(req, bodyLimit)) {
      sendJson(res, 413, { error: "Request body is too large." });
      req.destroy();
      return;
    }
    const body = method === "GET" ? {} : await readBody(req, bodyLimit);
    if (body === "too-big") {
      if (!res.writableEnded) sendJson(res, 413, { error: "Request body is too large." });
      req.destroy();
      return;
    }
    if (method === "POST" && (url.pathname === "/api/login" || url.pathname === "/portal/api/login")) {
      await service.startLogin();
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && url.pathname === "/api/logout") {
      service.logout();
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && (url.pathname === "/api/commands" || url.pathname === "/portal/api/commands")) {
      service.saveCommand(body);
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && (url.pathname === "/api/commands/delete" || url.pathname === "/portal/api/commands/delete")) {
      service.deleteCommand(text(body.id));
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && (url.pathname === "/api/timers" || url.pathname === "/portal/api/timers")) {
      service.saveTimer(body);
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && (url.pathname === "/api/timers/delete" || url.pathname === "/portal/api/timers/delete")) {
      service.deleteTimer(text(body.id));
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && (url.pathname === "/api/filters" || url.pathname === "/portal/api/filters")) {
      service.saveFilters(body);
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && url.pathname === "/api/import/streamelements") {
      // An empty or missing jwt reuses the one already stored. A new value replaces it after a successful import.
      await service.importSe(text(body.jwt).trim());
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && url.pathname === "/api/import/json") {
      service.importJson(body);
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "GET" && (url.pathname === "/api/export" || url.pathname === "/portal/api/export")) {
      sendJson(res, 200, service.exportConfig());
      return;
    }
    if (method === "POST" && url.pathname === "/api/import/config") {
      service.importConfig(body);
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && url.pathname === "/api/import/tokens") {
      service.importTokens(body);
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && url.pathname === "/api/import/youtube-tokens") {
      service.importYoutubeTokens(body);
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && url.pathname === "/api/youtube/login") {
      await service.startYoutubeLogin();
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && url.pathname === "/api/youtube/logout") {
      service.logoutYoutube();
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && url.pathname === "/api/youtube/cancel") {
      service.cancelYoutubeLogin();
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && (url.pathname === "/api/extras" || url.pathname === "/portal/api/extras")) {
      service.saveExtras(body);
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && (url.pathname === "/api/hooks" || url.pathname === "/portal/api/hooks")) {
      service.saveHook(body);
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && (url.pathname === "/api/hooks/delete" || url.pathname === "/portal/api/hooks/delete")) {
      service.deleteHook(typeof body.id === "string" ? body.id : "");
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && (url.pathname === "/api/hooks/test" || url.pathname === "/portal/api/hooks/test")) {
      sendJson(res, 200, await service.testHook(typeof body.id === "string" ? body.id : ""));
      return;
    }
    if (method === "POST" && url.pathname === "/api/accounts") {
      service.setAccounts(body);
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    if (method === "POST" && url.pathname === "/api/google-client") {
      service.saveGoogleClient(body);
      sendJson(res, 200, service.snapshot(port));
      return;
    }
    sendJson(res, 404, { error: "Not found" });
  }

  await listen(server, options.port, options.host);
  const port = serverPort(server, options.port);
  const timer = setInterval(() => {
    sweep(sessions, pending, now());
    void service.tick();
  }, 5000);
  timer.unref?.();
  return {
    port,
    close: async () => {
      clearInterval(timer);
      service.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Hash both sides so the compare does not leak the length or the bytes of the expected secret. */
export function secretsMatch(presented: string, expected: string): boolean {
  if (!presented || !expected) return false;
  const left = crypto.createHash("sha256").update(presented).digest();
  const right = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(left, right);
}

async function finishPortalLogin(service: BotService, clientId: string, verifier: string, code: string, redirect: string, fetchImpl: typeof fetch): Promise<Session> {
  const snap = service.snapshot(0);
  // The client secret stays in this server-side request to Twitch. It is not written to the response, the snapshot, or the log.
  const tokenRes = await fetchImpl("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirect,
      code_verifier: verifier,
      ...(twitchClientSecret() ? { client_secret: twitchClientSecret() } : {}),
    }),
  });
  if (!tokenRes.ok) throw new Error("Twitch did not finish the portal login.");
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("Twitch did not finish the portal login.");
  const headers = { "Client-Id": clientId, Authorization: `Bearer ${tokenJson.access_token}` };
  const userRes = await fetchImpl("https://api.twitch.tv/helix/users", { headers });
  if (!userRes.ok) throw new Error("Twitch did not identify that login.");
  const user = ((await userRes.json()) as { data?: { id?: string; login?: string }[] }).data?.[0];
  if (!user?.id || !user.login) throw new Error("Twitch did not identify that login.");
  const allowed = user.id === snap.broadcasterId || user.login.toLowerCase() === snap.channelLogin.toLowerCase() || (await moderates(fetchImpl, headers, user.id, snap));
  if (!allowed) throw new Error("That Twitch account is not a moderator of this channel.");
  return { userId: user.id, login: user.login, expiresAt: 0 };
}

async function moderates(fetchImpl: typeof fetch, headers: Record<string, string>, userId: string, snap: { broadcasterId: string; channelLogin: string }): Promise<boolean> {
  const response = await fetchImpl(`https://api.twitch.tv/helix/moderation/channels?user_id=${encodeURIComponent(userId)}`, { headers });
  if (!response.ok) return false;
  const rows = ((await response.json()) as { data?: { broadcaster_id?: string; broadcaster_login?: string }[] }).data ?? [];
  return rows.some((row) => row.broadcaster_id === snap.broadcasterId || (row.broadcaster_login ?? "").toLowerCase() === snap.channelLogin.toLowerCase());
}

function twitchClientSecret(): string {
  return readBrandEnv("TWITCH_CLIENT_SECRET") || process.env.TWITCH_CLIENT_SECRET || "";
}

function issueSession(sessions: Map<string, Session>, user: { userId: string; login: string }, nowMs: number, secret: string): string {
  const id = crypto.randomBytes(32).toString("base64url");
  sessions.set(id, { userId: user.userId, login: user.login, expiresAt: nowMs + SESSION_MS });
  return sealSession(id, secret);
}

function sealSession(id: string, secret: string): string {
  const sig = crypto.createHmac("sha256", secret).update(id).digest("base64url");
  return `${id}.${sig}`;
}

function openSession(cookie: string, secret: string): string | null {
  if (!secret || cookie.length < 40 || cookie.length > 200) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(id).digest("base64url");
  if (!secretsMatch(sig, expected)) return null;
  return id;
}

function readSession(sessions: Map<string, Session>, id: string, nowMs: number): Session | null {
  if (id.length < 32) return null;
  const session = sessions.get(id);
  if (!session) return null;
  if (!Number.isFinite(session.expiresAt) || session.expiresAt <= nowMs) {
    sessions.delete(id);
    return null;
  }
  return session;
}

function sweep(sessions: Map<string, Session>, pending: Map<string, PendingLogin>, nowMs: number): void {
  for (const [id, session] of sessions) {
    if (session.expiresAt <= nowMs) sessions.delete(id);
  }
  for (const [state, flow] of pending) {
    if (flow.expiresAt <= nowMs) pending.delete(state);
  }
}

function redirectLoopbackPortal(req: http.IncomingMessage, res: http.ServerResponse, redirectUri: string, port: number): boolean {
  if (new URL(redirectUri).hostname !== "localhost") return false;
  const url = requestTarget(req, "localhost");
  if (url.pathname !== "/portal" && url.pathname !== "/portal/" && url.pathname !== "/portal/login" && url.pathname !== "/portal/callback") return false;
  const host = requestHostname(req);
  if (host === "localhost" || (host !== "127.0.0.1" && host !== "::1")) return false;
  const dest = new URL(`${url.pathname}${url.search}`, `http://localhost:${port}`);
  res.writeHead(302, { Location: dest.toString(), "Cache-Control": "no-store" });
  res.end();
  return true;
}

function portalHostMatches(req: http.IncomingMessage, redirectUri: string): boolean {
  return requestHostname(req) === new URL(redirectUri).hostname.toLowerCase();
}

function cookieHeader(name: string, value: string, redirectUri: string, maxAge: number): string {
  const secure = new URL(redirectUri).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=${maxAge}`;
}

function requestHostname(req: http.IncomingMessage): string {
  const raw = headerValue(req.headers.host);
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return (end === -1 ? raw : raw.slice(1, end)).toLowerCase();
  }
  return (raw.split(":")[0] ?? "").toLowerCase();
}

function requestTarget(req: http.IncomingMessage, host: string): URL {
  const raw = req.url ?? "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return new URL("/invalid", `http://${host}`);
  return new URL(raw, `http://${host}`);
}

function authorizedLocal(req: http.IncomingMessage, apiKey: string): boolean {
  const header = headerValue(req.headers.authorization);
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  return secretsMatch(presented, apiKey);
}

function readCookie(req: http.IncomingMessage, name: string): string {
  const raw = headerValue(req.headers.cookie);
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) return part.slice(separator + 1).trim();
  }
  return "";
}

function overLimit(req: http.IncomingMessage, limit: number): boolean {
  const declared = req.headers["content-length"];
  if (Array.isArray(declared)) return true;
  if (typeof declared !== "string" || !declared) return false;
  const length = Number(declared);
  return !Number.isFinite(length) || length < 0 || length > limit;
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Record<string, unknown> | "too-big"> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        resolve("too-big");
        req.pause();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (failed) return;
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => {
      if (!failed) resolve({});
    });
  });
}

function tooMany(buckets: Map<string, number[]>, ip: string, limit: number, nowMs: number): boolean {
  const recent = (buckets.get(ip) ?? []).filter((at) => nowMs - at < 60_000);
  if (recent.length >= limit) {
    buckets.set(ip, recent);
    return true;
  }
  recent.push(nowMs);
  buckets.set(ip, recent);
  if (buckets.size > 2000) {
    const oldest = buckets.keys().next().value;
    if (oldest) buckets.delete(oldest);
  }
  return false;
}

function clientAddress(req: http.IncomingMessage): string {
  const peer = stripMapped(req.socket.remoteAddress ?? "");
  const kind = peer ? classifyIp(peer) : "blocked";
  // Caddy and Fly connect from a private address and set X-Forwarded-For.
  // A public client cannot pick its own bucket by sending that header.
  if (kind === "loopback" || kind === "private") {
    const forwarded = headerValue(req.headers["x-forwarded-for"]).split(",")[0]?.trim() ?? "";
    if (forwarded && forwarded.length <= 80 && !/[\s/]/.test(forwarded)) return forwarded;
  }
  return peer || "unknown";
}

function stripMapped(address: string): string {
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

function headerValue(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorStatus(err: unknown): number {
  if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode?: number }).statusCode === 413) return 413;
  return 500;
}

function publicError(err: unknown): string {
  if (!(err instanceof Error) || !err.message) return "Bot request failed.";
  return redact(err.message);
}

function portalCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function baseHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...baseHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function serverPort(server: http.Server, fallback: number): number {
  const address = server.address();
  return typeof address === "object" && address ? address.port : fallback;
}

function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}
