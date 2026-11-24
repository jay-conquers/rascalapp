import crypto from "node:crypto";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { brand } from "../shared/brand";
import type { ChatMessage } from "../shared/types";
import type { Logger } from "./logger";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean | void> | boolean | void;

export interface OverlayRoute {
  method: string;
  path: string;
  handler: RouteHandler;
}

export interface SocketOpenInfo {
  id: string;
  preset: string;
}

/**
 * Loopback HTTP + WebSocket server.
 * Stage 2 registers overlay pages with registerRoute().
 * Stage 3's chat overlay subscribes to /ws (also aliased as /ws/chat).
 */
export class OverlayServer {
  port = 0;
  readonly host = "127.0.0.1";
  private httpServer: http.Server | null = null;
  private clients = new Set<WsClient>();
  private routes: OverlayRoute[] = [];
  private prefixes: OverlayRoute[] = [];
  private textListeners = new Set<(text: string) => void>();
  private openListeners = new Set<(pathname: string, info: SocketOpenInfo) => void>();
  private closeListeners = new Set<(pathname: string, info: SocketOpenInfo) => void>();

  constructor(
    private readonly recent: () => ChatMessage[],
    private readonly log: Logger,
  ) {}

  registerRoute(method: string, pathname: string, handler: RouteHandler): void {
    this.routes.push({ method: method.toUpperCase(), path: pathname, handler });
  }

  registerPrefix(method: string, prefix: string, handler: RouteHandler): void {
    this.prefixes.push({ method: method.toUpperCase(), path: prefix, handler });
  }

  onSocketOpen(listener: (pathname: string, info: SocketOpenInfo) => void): () => void {
    this.openListeners.add(listener);
    return () => this.openListeners.delete(listener);
  }

  onSocketClose(listener: (pathname: string, info: SocketOpenInfo) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  sendTo(id: string, event: unknown): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.id === id) client.send(payload);
    }
  }

  clientCount(pathname: string): number {
    let count = 0;
    for (const client of this.clients) if (client.path === pathname) count += 1;
    return count;
  }

  onClientText(listener: (text: string) => void): () => void {
    this.textListeners.add(listener);
    return () => this.textListeners.delete(listener);
  }

  async start(preferredPort: number): Promise<number> {
    if (this.httpServer) await this.stop();
    const server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    server.on("upgrade", (req, socket, head) => this.upgrade(req, socket, head));
    const ports = [preferredPort, ...Array.from({ length: 10 }, (_, index) => preferredPort + 1 + index)];
    let lastError: unknown;
    for (const port of ports) {
      try {
        await listen(server, port, this.host);
        const address = server.address();
        const actual = typeof address === "object" && address ? address.port : port;
        this.httpServer = server;
        this.port = actual;
        this.log.info("overlay server listening", { host: this.host, port: actual });
        return actual;
      } catch (err) {
        lastError = err;
        if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Could not bind the overlay server.");
  }

  async stop(): Promise<void> {
    const server = this.httpServer;
    this.httpServer = null;
    for (const client of this.clients) client.close();
    this.clients.clear();
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  broadcast(event: unknown, onlyPath?: string): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (onlyPath && client.path !== onlyPath) continue;
      client.send(payload);
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", `http://${this.host}`);
      const method = (req.method ?? "GET").toUpperCase();
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      for (const route of this.routes) {
        if (route.method === method && route.path === url.pathname) {
          const handled = await route.handler(req, res, url);
          if (handled === false) continue;
          if (!res.writableEnded) return;
          return;
        }
      }
      for (const route of this.prefixes) {
        if (route.method === method && url.pathname.startsWith(route.path)) {
          const handled = await route.handler(req, res, url);
          if (handled === false) continue;
          if (!res.writableEnded) return;
          return;
        }
      }
      if (method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true, service: brand.healthService, stage: 1, port: this.port });
        return;
      }
      if (method === "GET" && url.pathname === "/api/chat/recent") {
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));
        const messages = this.recent().filter((message) => !message.deskOnly);
        sendJson(res, 200, { messages: messages.slice(-limit) });
        return;
      }
      if (method === "GET" && (url.pathname === "/overlays" || url.pathname === "/overlays/")) {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`${brand.displayName} overlays: /overlay/alerts and /overlay/chat\n`);
        return;
      }
      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      this.log.error("overlay request failed", { message: err instanceof Error ? err.message : String(err) });
      if (!res.writableEnded) sendJson(res, 500, { error: "Overlay request failed." });
    }
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? "/", `http://${this.host}`);
    if (
      url.pathname !== "/ws" &&
      url.pathname !== "/ws/chat" &&
      url.pathname !== "/ws/alerts" &&
      url.pathname !== "/ws/overlay-chat"
    ) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || String(req.headers.upgrade ?? "").toLowerCase() !== "websocket") {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const client = new WsClient(socket, (text) => {
      for (const listener of this.textListeners) listener(text);
    });
    client.id = crypto.randomUUID();
    client.path = url.pathname;
    client.preset = url.searchParams.get("preset") ?? "";
    this.clients.add(client);
    const info: SocketOpenInfo = { id: client.id, preset: client.preset };
    socket.on("close", () => {
      if (!this.clients.delete(client)) return;
      for (const listener of this.closeListeners) listener(client.path, info);
    });
    socket.on("error", () => {
      socket.destroy();
    });
    socket.on("data", (chunk: Buffer) => client.push(chunk));
    if (head.length > 0) client.push(head);
    if (url.pathname === "/ws/alerts" || url.pathname === "/ws/overlay-chat") {
      // The owning stage sends hello with that page's build hash.
    } else {
      client.send(JSON.stringify({ type: "hello", service: brand.healthService, stage: 1 }));
      client.send(JSON.stringify({ type: "snapshot", messages: this.recent().slice(-200) }));
    }
    for (const listener of this.openListeners) listener(url.pathname, info);
  }
}

class WsClient {
  id = "";
  path = "";
  preset = "";
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private closed = false;

  constructor(
    private readonly socket: Duplex,
    private readonly onText: (text: string) => void,
  ) {}

  send(text: string): void {
    if (this.closed || this.socket.destroyed) return;
    try {
      this.socket.write(encodeFrame(0x1, Buffer.from(text)));
    } catch {
      this.close();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.write(encodeFrame(0x8, Buffer.alloc(0)));
    } catch {
      // Already gone.
    }
    this.socket.destroy();
  }

  push(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2 && !this.closed) {
      const first = this.buffer[0] ?? 0;
      const second = this.buffer[1] ?? 0;
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const wide = this.buffer.readBigUInt64BE(2);
        if (wide > BigInt(1_000_000)) {
          this.close();
          return;
        }
        length = Number(wide);
        offset = 10;
      }
      if (length > 1_000_000) {
        this.close();
        return;
      }
      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + length) return;
      let payload = this.buffer.subarray(offset + maskLength, offset + maskLength + length);
      if (masked) {
        const mask = this.buffer.subarray(offset, offset + 4);
        const copy = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) copy[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
        payload = copy;
      } else {
        payload = Buffer.from(payload);
      }
      this.buffer = this.buffer.subarray(offset + maskLength + length);
      this.frame(fin, opcode, payload);
    }
  }

  private frame(fin: boolean, opcode: number, payload: Buffer): void {
    if (opcode === 0x8) {
      this.close();
      return;
    }
    if (opcode === 0x9) {
      if (!this.closed) this.socket.write(encodeFrame(0xa, payload));
      return;
    }
    if (opcode === 0xa) return;
    if (opcode === 0x1 || opcode === 0x0) {
      this.fragments.push(payload);
      if (!fin) return;
      const text = Buffer.concat(this.fragments).toString("utf8");
      this.fragments = [];
      if (opcode === 0x1 || text) this.onText(text);
      return;
    }
    this.fragments = [];
  }
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}
