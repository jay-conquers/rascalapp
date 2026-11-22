import crypto from "node:crypto";
import http from "node:http";
import { brand } from "../../../src/shared/brand.ts";
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

export async function startHttp(service: BotService, options: { host: string; port: number; clientId: () => string; fetchImpl?: typeof fetch }): Promise<{ port: number; close: () => Promise<void> }> {
  const pending = new Map<string, PendingLogin>();
  const fetchImpl = options.fetchImpl ?? fetch;
  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err) => {
      if (!res.writableEnded) sendJson(res, 500, { error: err instanceof Error ? err.message : "Bot request failed." });
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${options.host}`);
    const method = (req.method ?? "GET").toUpperCase();
    const port = serverPort(server, options.port);
    if (method === "GET" && redirectLoopbackPortal(req, res, service.snapshot(port).redirectUri, port)) return;
    if (method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
      sendJson(res, 200, { ok: true, service: brand.botHealthService });
      return;
    }
    if (method === "GET" && url.pathname === "/portal") {
      const html = portalPage();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(html) });
      res.end(html);
      return;
    }
    if (method === "GET" && url.pathname === "/portal/login") {
      const clientId = options.clientId();
      if (!clientId) {
        sendJson(res, 400, { error: "Set the Twitch client ID before using the portal." });
        return;
      }
      const state = crypto.randomBytes(16).toString("hex");
      const verifier = crypto.randomBytes(32).toString("base64url");
      const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
      pending.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });
      const redirect = service.snapshot(serverPort(server, options.port)).redirectUri;
      const authorize = new URL("https://id.twitch.tv/oauth2/authorize");
      authorize.searchParams.set("client_id", clientId);
      authorize.searchParams.set("redirect_uri", redirect);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("scope", PORTAL_SCOPES.join(" "));
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");
      res.writeHead(302, { Location: authorize.toString() });
      res.end();
      return;
    }
    if (method === "GET" && url.pathname === "/portal/callback") {
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      if (!portalHostMatches(req, service.snapshot(port).redirectUri)) {
        sendJson(res, 400, { error: "Open the portal at its localhost address and log in again." });
        return;
      }
      const flow = pending.get(state);
      pending.delete(state);
      if (!flow || flow.expiresAt < Date.now() || !code) {
        sendJson(res, 400, { error: "That login expired. Start again." });
        return;
      }
      const redirect = service.snapshot(serverPort(server, options.port)).redirectUri;
      const session = await finishPortalLogin(service, options.clientId(), flow.verifier, code, redirect, fetchImpl);
      const cookie = signSession(service.sessionSecret(), session);
      res.writeHead(302, { Location: "/portal", "Set-Cookie": portalCookie(cookie, service.snapshot(port).redirectUri, 43200) });
      res.end();
      return;
    }
    if (method === "POST" && url.pathname === "/portal/logout") {
      res.writeHead(302, { Location: "/portal", "Set-Cookie": portalCookie("", service.snapshot(port).redirectUri, 0) });
      res.end();
      return;
    }
    const portalSession = sessionUser(req, service.sessionSecret());
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
    const body = method === "GET" ? {} : await readBody(req);
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
      await service.importSe(text(body.jwt));
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
    sendJson(res, 404, { error: "Not found" });
  }

  await listen(server, options.port, options.host);
  const port = serverPort(server, options.port);
  const timer = setInterval(() => {
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

async function finishPortalLogin(service: BotService, clientId: string, verifier: string, code: string, redirect: string, fetchImpl: typeof fetch): Promise<Session> {
  const snap = service.snapshot(0);
  const tokenRes = await fetchImpl("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirect,
      code_verifier: verifier,
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
  return { userId: user.id, login: user.login, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
}

async function moderates(fetchImpl: typeof fetch, headers: Record<string, string>, userId: string, snap: { broadcasterId: string; channelLogin: string }): Promise<boolean> {
  const response = await fetchImpl(`https://api.twitch.tv/helix/moderation/channels?user_id=${encodeURIComponent(userId)}`, { headers });
  if (!response.ok) return false;
  const rows = ((await response.json()) as { data?: { broadcaster_id?: string; broadcaster_login?: string }[] }).data ?? [];
  return rows.some((row) => row.broadcaster_id === snap.broadcasterId || (row.broadcaster_login ?? "").toLowerCase() === snap.channelLogin.toLowerCase());
}

function redirectLoopbackPortal(req: http.IncomingMessage, res: http.ServerResponse, redirectUri: string, port: number): boolean {
  if (new URL(redirectUri).hostname !== "localhost") return false;
  const path = (req.url ?? "/").split("?")[0] ?? "";
  if (path !== "/portal" && path !== "/portal/" && path !== "/portal/login" && path !== "/portal/callback") return false;
  const host = requestHostname(req);
  if (host === "localhost" || (host !== "127.0.0.1" && host !== "::1")) return false;
  const dest = new URL(req.url ?? "/", `http://localhost:${port}`);
  res.writeHead(302, { Location: dest.toString(), "Cache-Control": "no-store" });
  res.end();
  return true;
}

function portalHostMatches(req: http.IncomingMessage, redirectUri: string): boolean {
  return requestHostname(req) === new URL(redirectUri).hostname.toLowerCase();
}

function portalCookie(value: string, redirectUri: string, maxAge: number): string {
  const secure = new URL(redirectUri).protocol === "https:" ? "; Secure" : "";
  return `${brand.portalCookie}=${value}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=${maxAge}`;
}

function requestHostname(req: http.IncomingMessage): string {
  const raw = req.headers.host ?? "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return (end === -1 ? raw : raw.slice(1, end)).toLowerCase();
  }
  return (raw.split(":")[0] ?? "").toLowerCase();
}

function authorizedLocal(req: http.IncomingMessage, apiKey: string): boolean {
  const header = req.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(apiKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signSession(secret: string, session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function sessionUser(req: http.IncomingMessage, secret: string): Session | null {
  const cookie = readCookie(req, brand.portalCookie);
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (!session.userId || !session.login || session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function readCookie(req: http.IncomingMessage, name: string): string {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [key, value] = part.trim().split("=");
    if (key === name) return value ?? "";
  }
  return "";
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(payload) });
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
