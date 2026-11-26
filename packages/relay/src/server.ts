import http from "node:http";
import type { Duplex } from "node:stream";
import { KICK_WEBHOOK_PATH, RELAY_SOCKET_PATH, relayEvent, type RelayEvent } from "../../../src/shared/kick/protocol.ts";
import { pemFromPublicKeyBody, secretsMatch, verifyKickSignature } from "../../../src/shared/kick/signature.ts";
import { acceptKey, encodeServerFrame, MAX_FRAME, readFrames } from "./ws.ts";

const MAX_BODY = 1_000_000;
const MAX_KEY_BYTES = 16_384;
const AUTH_WAIT_MS = 5_000;
const DEDUP_MS = 10 * 60_000;
const KEY_HOUR_MS = 60 * 60_000;
const KEY_RETRY_MS = 60_000;
const DEFAULT_MAX_CLIENTS = 32;

export interface RelayOptions {
  secret: string;
  port?: number;
  host?: string;
  /** Tests inject a key. Production fetches Kick's key so a rotation still verifies. */
  publicKeyPem?: string;
  publicKeyUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Open sockets, including ones still waiting to authenticate. */
  maxClients?: number;
  /** Tests use a short value. An upgraded socket must stay open past it. */
  requestTimeoutMs?: number;
}

export interface RelayHandle {
  port: number;
  close: () => Promise<void>;
}

interface Client {
  socket: Duplex;
  authed: boolean;
  buffer: Buffer;
  timer: NodeJS.Timeout | null;
  closed: boolean;
}

/**
 * Receives Kick webhooks, checks the signature, and fans the event out to
 * authenticated sockets. No account data is stored here.
 */
export async function startRelay(options: RelayOptions): Promise<RelayHandle> {
  const secret = options.secret;
  if (secret.trim().length < 16) throw new Error("RELAY_SECRET must be at least 16 characters.");
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const keyUrl = options.publicKeyUrl ?? "https://api.kick.com/public/v1/public-key";
  const maxClients = options.maxClients && options.maxClients > 0 ? Math.floor(options.maxClients) : DEFAULT_MAX_CLIENTS;
  let pem = options.publicKeyPem?.trim() ?? "";
  let fetchedAt = pem ? now() : 0;
  let nextFetchAt = 0;
  const seen = new Map<string, number>();
  const clients = new Set<Client>();

  async function publicKey(force: boolean): Promise<string> {
    const fresh = Boolean(pem) && (Boolean(options.publicKeyPem) || now() - fetchedAt < KEY_HOUR_MS);
    if (fresh && !force) return pem;
    if (now() < nextFetchAt) {
      if (pem) return pem;
      throw new Error("Kick public key was not available.");
    }
    nextFetchAt = now() + KEY_RETRY_MS;
    const response = await fetchImpl(keyUrl, { redirect: "error" });
    if (!response.ok) throw new Error("Kick public key was not available.");
    const next = pemFromPublicKeyBody(await readPublicKeyBody(response));
    if (!next.includes("BEGIN PUBLIC KEY")) throw new Error("Kick public key was not a PEM key.");
    pem = next;
    fetchedAt = now();
    return pem;
  }

  function remember(id: string): boolean {
    const at = now();
    for (const [key, seenAt] of seen) {
      if (at - seenAt > DEDUP_MS) seen.delete(key);
    }
    if (seen.has(id)) return false;
    seen.set(id, at);
    if (seen.size > 2000) {
      const oldest = seen.keys().next().value;
      if (oldest) seen.delete(oldest);
    }
    return true;
  }

  function broadcast(event: RelayEvent): void {
    const text = JSON.stringify(event);
    const frame = encodeServerFrame(1, Buffer.from(text));
    for (const client of clients) {
      if (!client.authed || client.closed) continue;
      try {
        client.socket.write(frame);
      } catch {
        drop(client);
      }
    }
  }

  function drop(client: Client): void {
    if (client.closed) return;
    client.closed = true;
    if (client.timer) clearTimeout(client.timer);
    clients.delete(client);
    client.socket.destroy();
  }

  function sendJson(client: Client, value: unknown): void {
    if (client.closed) return;
    client.socket.write(encodeServerFrame(1, Buffer.from(JSON.stringify(value))));
  }

  function onFrame(client: Client, opcode: number, payload: Buffer): void {
    if (client.closed) return;
    if (opcode === 0x8) {
      drop(client);
      return;
    }
    if (opcode === 0x9) {
      client.socket.write(encodeServerFrame(0xa, payload));
      return;
    }
    if (opcode !== 0x1) return;
    if (client.authed) return;
    let parsed: { type?: unknown; secret?: unknown };
    try {
      parsed = JSON.parse(payload.toString("utf8")) as { type?: unknown; secret?: unknown };
    } catch {
      drop(client);
      return;
    }
    if (parsed.type !== "auth" || typeof parsed.secret !== "string" || !secretsMatch(parsed.secret, secret)) {
      drop(client);
      return;
    }
    client.authed = true;
    if (client.timer) clearTimeout(client.timer);
    client.timer = null;
    sendJson(client, { type: "ready" });
  }

  function accept(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== RELAY_SOCKET_PATH) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || !key.trim() || String(req.headers.upgrade ?? "").toLowerCase() !== "websocket") {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    if (clients.size >= maxClients) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const authorization = req.headers.authorization;
    let authed = false;
    if (typeof authorization === "string") {
      const match = /^Bearer (.+)$/.exec(authorization);
      if (!match || !secretsMatch(match[1] ?? "", secret)) {
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        return;
      }
      authed = true;
    }
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    const client: Client = { socket, authed, buffer: Buffer.from(head), timer: null, closed: false };
    clients.add(client);
    if (!authed) {
      client.timer = setTimeout(() => drop(client), AUTH_WAIT_MS);
      client.timer.unref?.();
    } else {
      sendJson(client, { type: "ready" });
    }
    const consume = () => {
      if (client.closed) return;
      try {
        const parsed = readFrames(client.buffer);
        client.buffer = parsed.rest;
        if (client.buffer.length > MAX_FRAME + 14) throw new Error("frame too large");
        for (const frame of parsed.frames) onFrame(client, frame.opcode, frame.payload);
      } catch {
        drop(client);
      }
    };
    consume();
    socket.on("data", (chunk: Buffer) => {
      if (client.closed) return;
      client.buffer = Buffer.concat([client.buffer, chunk]);
      consume();
    });
    socket.on("error", () => drop(client));
    socket.on("close", () => {
      if (client.timer) clearTimeout(client.timer);
      client.closed = true;
      clients.delete(client);
    });
  }

  async function webhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const messageId = header(req, "kick-event-message-id");
    const timestamp = header(req, "kick-event-message-timestamp");
    const signature = header(req, "kick-event-signature");
    const eventType = header(req, "kick-event-type");
    const version = header(req, "kick-event-version") || "1";
    if (!messageId || !timestamp || !signature) {
      reject(req, res, 400);
      return;
    }
    let raw = "";
    try {
      raw = (await readBody(req)).toString("utf8");
    } catch (err) {
      const tooBig = err instanceof Error && err.message === "body too large";
      reject(req, res, tooBig ? 413 : 400);
      return;
    }
    let key = "";
    try {
      key = await publicKey(false);
    } catch {
      reject(req, res, 503);
      return;
    }
    let ok = verifyKickSignature({ publicKeyPem: key, messageId, timestamp, rawBody: raw, signature, now: now() });
    if (!ok && !options.publicKeyPem && now() >= nextFetchAt) {
      try {
        key = await publicKey(true);
        ok = verifyKickSignature({ publicKeyPem: key, messageId, timestamp, rawBody: raw, signature, now: now() });
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      reject(req, res, 401);
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      reject(req, res, 400);
      return;
    }
    if (remember(messageId)) {
      broadcast(relayEvent({ source: "kick", id: messageId, eventType, version, body }));
    }
    send(res, 204);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ok: true, service: "relay" }));
      return;
    }
    if (req.method === "POST" && url.pathname === KICK_WEBHOOK_PATH) {
      void webhook(req, res);
      return;
    }
    reject(req, res, 404);
  });
  server.requestTimeout = options.requestTimeoutMs ?? 20_000;
  server.headersTimeout = Math.min(10_000, server.requestTimeout);
  server.on("upgrade", (req, socket, head) => accept(req, socket, head));

  await new Promise<void>((resolve, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : (options.port ?? 0);
  return {
    port,
    close: () =>
      new Promise((resolve) => {
        for (const client of clients) drop(client);
        server.close(() => resolve());
      }),
  };
}

function header(req: http.IncomingMessage, name: string): string {
  const value = req.headers[name];
  return typeof value === "string" ? value.trim() : "";
}

function send(res: http.ServerResponse, status: number): void {
  res.writeHead(status, { "Cache-Control": "no-store" });
  res.end();
}

function reject(req: http.IncomingMessage, res: http.ServerResponse, status: number): void {
  if (!res.writableEnded) {
    res.writeHead(status, { "Cache-Control": "no-store", Connection: "close" });
    res.end(() => req.destroy());
    return;
  }
  req.destroy();
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, rejectBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      req.pause();
      rejectBody(err);
    };
    req.on("data", (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        fail(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on("error", (err: Error) => fail(err));
  });
}

async function readPublicKeyBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_KEY_BYTES) throw new Error("Kick public key was not a PEM key.");
  if (!response.body) {
    const text = await response.text();
    if (text.length > MAX_KEY_BYTES) throw new Error("Kick public key was not a PEM key.");
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    size += step.value.byteLength;
    if (size > MAX_KEY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Kick public key was not a PEM key.");
    }
    chunks.push(step.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
