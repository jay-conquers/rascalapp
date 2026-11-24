import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { safeEmoteUrl } from "../../shared/emote-url";
import { chmodPrivate } from "../../shared/private-mode";
import { ensurePrivateDir } from "../private-file";
import type { Logger } from "../logger";

const MAX_BYTES = 512 * 1024;
const MAX_FILES = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface CachedImage {
  type: string;
  at: number;
}

/**
 * Disk cache for emote images. Fetches have no cookies and no auth header.
 * Files live under the account config directory. They are not secrets, but
 * they are still mode 0600 on POSIX so the cache is not world-readable.
 */
export class EmoteImageCache {
  private readonly dir: string;
  private readonly indexFile: string;
  private index = new Map<string, CachedImage>();
  private pending = new Map<string, Promise<void>>();

  constructor(private readonly deps: { dir: string; log: Logger; fetchImpl?: typeof fetch }) {
    this.dir = path.join(deps.dir, "emote-cache");
    this.indexFile = path.join(this.dir, "index.json");
    this.readIndex();
  }

  prefetch(url: string): void {
    const safe = safeEmoteUrl(url);
    if (!safe) return;
    const hash = hashUrl(safe);
    if (this.fresh(hash) || this.pending.has(hash)) return;
    const job = this.fetchOne(safe, hash).finally(() => this.pending.delete(hash));
    this.pending.set(hash, job);
  }

  /** Loopback URL once the bytes are on disk. The desk itself keeps the https CDN URL. */
  overlayUrl(url: string, port: number): string | null {
    const safe = safeEmoteUrl(url);
    if (!safe || !Number.isInteger(port) || port < 1) return null;
    const hash = hashUrl(safe);
    if (!this.fresh(hash)) {
      this.prefetch(safe);
      return null;
    }
    return `http://127.0.0.1:${port}/emote/${hash}`;
  }

  read(hash: string): { body: Buffer; type: string } | null {
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    const meta = this.index.get(hash);
    if (!meta) return null;
    try {
      const body = fs.readFileSync(path.join(this.dir, hash));
      if (body.length === 0 || body.length > MAX_BYTES) return null;
      return { body, type: meta.type };
    } catch {
      return null;
    }
  }

  private fresh(hash: string): boolean {
    const meta = this.index.get(hash);
    if (!meta) return false;
    if (Date.now() - meta.at > 7 * DAY_MS) return false;
    return fs.existsSync(path.join(this.dir, hash));
  }

  private async fetchOne(url: string, hash: string): Promise<void> {
    try {
      const first = await this.fetch(url);
      if (!first) return;
      let response = first;
      if (response.status >= 300 && response.status < 400) {
        const next = safeEmoteUrl(response.headers.get("location"));
        if (!next) return;
        response = await this.fetch(next);
      }
      if (!response.ok) return;
      const bytes = Buffer.from(await response.arrayBuffer());
      const type = sniffImage(bytes);
      if (!type || bytes.length > MAX_BYTES) return;
      this.write(hash, bytes, type);
    } catch (err) {
      const message = err instanceof Error ? err.message : "emote cache failed";
      this.deps.log.error("emote image cache failed", { message });
    }
  }

  private fetch(url: string): Promise<Response> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    return fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "image/png,image/webp,image/gif,image/jpeg" },
    });
  }

  private write(hash: string, body: Buffer, type: string): void {
    ensurePrivateDir(this.dir);
    const file = path.join(this.dir, hash);
    const tmp = `${file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeSync(fd, body);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    chmodPrivate(tmp, 0o600);
    fs.renameSync(tmp, file);
    chmodPrivate(file, 0o600);
    this.index.set(hash, { type, at: Date.now() });
    this.trim();
    this.flush();
  }

  private trim(): void {
    if (this.index.size <= MAX_FILES) return;
    const oldest = [...this.index.entries()].sort((a, b) => a[1].at - b[1].at);
    while (this.index.size > MAX_FILES && oldest.length > 0) {
      const next = oldest.shift();
      if (!next) break;
      this.index.delete(next[0]);
      try {
        fs.rmSync(path.join(this.dir, next[0]), { force: true });
      } catch {
        // A missing file is already gone.
      }
    }
  }

  private readIndex(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexFile, "utf8")) as unknown;
      if (!raw || typeof raw !== "object") return;
      for (const [hash, value] of Object.entries(raw as Record<string, unknown>)) {
        const row = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
        const type = typeof row?.type === "string" ? row.type : "";
        const at = typeof row?.at === "number" ? row.at : 0;
        if (!/^[a-f0-9]{64}$/.test(hash) || !type.startsWith("image/") || type === "image/svg+xml") continue;
        this.index.set(hash, { type, at });
      }
    } catch {
      this.index = new Map();
    }
  }

  private flush(): void {
    ensurePrivateDir(this.dir);
    const payload: Record<string, CachedImage> = {};
    for (const [hash, meta] of this.index) payload[hash] = meta;
    const tmp = `${this.indexFile}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(payload));
    } finally {
      fs.closeSync(fd);
    }
    chmodPrivate(tmp, 0o600);
    fs.renameSync(tmp, this.indexFile);
    chmodPrivate(this.indexFile, 0o600);
  }
}

export function hashUrl(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex");
}

export function sniffImage(body: Buffer): string | null {
  if (body.length >= 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) return "image/png";
  if (body.length >= 6 && body.subarray(0, 6).toString("ascii") === "GIF87a") return "image/gif";
  if (body.length >= 6 && body.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (body.length >= 12 && body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}
