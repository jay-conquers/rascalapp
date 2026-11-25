import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  alertStallMs,
  countFilledMappings,
  importFirebotRewards,
  mergeImported,
  normalizePlacement,
  placementBox,
  sameTitle,
  type RedeemMapping,
  type RedeemSnapshot,
} from "../../shared/redeems";
import type { WithoutSeq, AppEvent } from "../../shared/types";
import { brand } from "../../shared/brand";
import { redactError } from "../../shared/redact";
import type { AppContext } from "../stages/types";
import type { TwitchReward } from "../twitch/helix";
import { chatFromRedemption } from "../../shared/parsers/eventsub-events";
import { EventSubClient, type EventSubRedemption } from "./eventsub";
import { buildAlertsPage, overlayHelloMessage } from "./overlay-page";
import { AlertQueue, type AlertJob } from "./queue";
import { firebotRewardsFile } from "../../shared/paths";
import { defaultSoundFolder, loadRedeemFile, normalizeMapping, saveRedeemFile, type RedeemFile } from "./store";

const REWARD_ID = /^[A-Za-z0-9_-]{1,80}$/;

export class RedeemEngine {
  private readonly file: string;
  private data: RedeemFile;
  private rewards: TwitchReward[] = [];
  private manageable = new Set<string>();
  private readonly queue = new AlertQueue();
  private readonly eventsub: EventSubClient;
  private status = "Channel points are idle";
  private started = false;
  private stall: ReturnType<typeof setTimeout> | null = null;
  private playing = false;
  private removeAuth: (() => void) | null = null;
  private removeSocket: (() => void) | null = null;
  private removeSocketClose: (() => void) | null = null;
  private readonly overlay: { html: string; hash: string };
  private staleOverlay = false;

  constructor(private readonly ctx: AppContext) {
    this.overlay = buildAlertsPage(ctx.version);
    this.file = path.join(path.dirname(ctx.settings.file), "redeems.json");
    this.data = loadRedeemFile(this.file, defaultSoundFolder());
    this.eventsub = new EventSubClient({
      subscribe: async (sessionId) => {
        const user = this.user();
        if (!user) throw new Error("Log in with Twitch first.");
        await ctx.helix.subscribeRedemptions(user.userId, sessionId);
      },
      onRedemption: (redemption) => this.onRedemption(redemption),
      onStatus: (detail) => {
        this.status = detail;
        this.publish();
      },
      log: ctx.log,
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const server = this.ctx.server;
    server.registerRoute("GET", "/overlay/alerts", (_req, res) => {
      const html = this.overlay.html;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(html),
      });
      res.end(html);
    });
    server.registerRoute("POST", "/overlay/alerts/log", async (req, res) => {
      const body = await readJsonBody(req);
      const overlayHash = typeof body.overlayHash === "string" ? body.overlayHash : "";
      const jobId = typeof body.jobId === "string" ? body.jobId : "";
      this.ctx.log.error("overlay missing placement box", { overlayHash, jobId });
      this.staleOverlay = true;
      this.publish();
      res.writeHead(204);
      res.end();
    });
    server.registerRoute("POST", "/overlay/alerts/done", async (req, res) => {
      const body = await readBody(req);
      let id = "";
      try {
        const parsed = JSON.parse(body) as { id?: unknown };
        if (typeof parsed.id === "string") id = parsed.id;
      } catch {
        id = "";
      }
      this.finish(id);
      res.writeHead(204);
      res.end();
    });
    server.registerPrefix("GET", "/overlay/media/", (req, res, url) => {
      this.serveMedia(req, res, decodeURIComponent(url.pathname.slice("/overlay/media/".length)));
    });
    this.removeSocket = server.onSocketOpen((pathname) => {
      if (pathname !== "/ws/alerts") return;
      server.broadcast(overlayHelloMessage(this.ctx.version, this.overlay.hash), "/ws/alerts");
      if (this.queue.current && !this.playing && this.overlayCount() > 0) this.begin(this.queue.current);
      else if (this.playing) this.pushCurrent();
      this.publish();
    });
    server.onClientText((text) => {
      let message: { type?: string; overlayHash?: string };
      try {
        message = JSON.parse(text) as { type?: string; overlayHash?: string };
      } catch {
        return;
      }
      if (message.type !== "overlay-hello" || typeof message.overlayHash !== "string") return;
      if (message.overlayHash !== this.overlay.hash) {
        this.staleOverlay = true;
        this.ctx.log.error("stale overlay connected", { overlayHash: message.overlayHash, expected: this.overlay.hash });
      }
      this.publish();
    });
    this.removeSocketClose = server.onSocketClose((pathname) => {
      if (pathname === "/ws/alerts") this.publish();
    });
    this.removeAuth = this.ctx.auth.addListener(() => {
      void this.onAuth();
    });
    this.autoImportFirebot();
    await this.onAuth();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.eventsub.stop();
    if (this.stall) clearTimeout(this.stall);
    this.removeAuth?.();
    this.removeSocket?.();
    this.removeSocketClose?.();
  }

  snapshot(): RedeemSnapshot {
    const auth = this.ctx.auth.state();
    const rows = this.rewards.map((reward) => ({
      id: reward.id,
      title: reward.title,
      cost: reward.cost,
      enabledOnTwitch: reward.enabled,
      manageable: this.manageable.has(reward.id),
      prompt: reward.prompt,
      mapping: this.mappingFor(reward),
    }));
    for (const mapping of this.data.mappings) {
      if (mapping.rewardId && rows.some((row) => row.id === mapping.rewardId)) continue;
      if (rows.some((row) => sameTitle(row.title, mapping.title))) continue;
      rows.push({
        id: mapping.rewardId,
        title: mapping.title,
        cost: 0,
        enabledOnTwitch: false,
        manageable: false,
        prompt: "",
        mapping,
      });
    }
    return {
      status: this.status,
      scopeMissing: auth.loggedIn && auth.missingScopes.includes("channel:read:redemptions"),
      canManage: auth.loggedIn && !auth.missingScopes.includes("channel:manage:redemptions"),
      overlayUrl: `http://${this.ctx.server.host}:${this.ctx.server.port}/overlay/alerts`,
      overlayCount: this.overlayCount(),
      overlayVersion: this.ctx.version,
      overlayHash: this.overlay.hash,
      staleOverlay: this.staleOverlay,
      soundFolder: this.data.soundFolder,
      rewards: rows,
      queue: this.queue.snapshot(),
    };
  }

  async refresh(): Promise<RedeemSnapshot> {
    await this.loadRewards();
    this.publish();
    return this.snapshot();
  }

  async saveMapping(input: RedeemMapping): Promise<RedeemSnapshot> {
    const mapping = normalizeMapping({
      ...input,
      title: input.title.trim(),
      filePath: input.filePath.trim(),
    });
    if (!mapping.title) throw new Error("That reward has no title.");
    const index = this.data.mappings.findIndex(
      (item) => (mapping.rewardId && item.rewardId === mapping.rewardId) || sameTitle(item.title, mapping.title),
    );
    if (index >= 0) this.data.mappings[index] = mapping;
    else this.data.mappings.push(mapping);
    saveRedeemFile(this.file, this.data);
    this.publish();
    return this.snapshot();
  }

  async createReward(title: string, cost: number): Promise<RedeemSnapshot> {
    this.requireManage();
    const user = this.requireUser();
    const reward = await this.ctx.helix.createCustomReward(user.userId, title, cost);
    this.data.mappings.push({
      rewardId: reward.id,
      title: reward.title,
      action: "none",
      filePath: "",
      volume: 100,
      maxDurationMs: null,
      enabled: true,
      placement: undefined,
    });
    saveRedeemFile(this.file, this.data);
    await this.loadRewards();
    this.publish();
    return this.snapshot();
  }

  async updateTwitchReward(rewardId: string, patch: { title?: string; cost?: number; enabled?: boolean }): Promise<RedeemSnapshot> {
    if (!this.manageable.has(rewardId)) throw new Error(`Twitch only lets ${brand.displayName} edit rewards ${brand.displayName} created.`);
    const user = this.requireUser();
    await this.ctx.helix.updateCustomReward(user.userId, rewardId, patch);
    const mapping = this.data.mappings.find((item) => item.rewardId === rewardId);
    if (mapping && patch.title) mapping.title = patch.title.trim();
    if (mapping) saveRedeemFile(this.file, this.data);
    await this.loadRewards();
    this.publish();
    return this.snapshot();
  }

  async importFirebot(): Promise<RedeemSnapshot> {
    const source = firebotRewardsPath();
    let payload: unknown;
    try {
      payload = JSON.parse(fs.readFileSync(source, "utf8"));
    } catch {
      throw new Error(`No Firebot rewards file at ${source}`);
    }
    const imported = importFirebotRewards(payload);
    this.data.mappings = mergeImported(
      this.data.mappings,
      imported,
      this.rewards.map((reward) => ({ id: reward.id, title: reward.title })),
    );
    saveRedeemFile(this.file, this.data);
    this.status = `Imported ${imported.length} Firebot mapping${imported.length === 1 ? "" : "s"}.`;
    this.publish();
    return this.snapshot();
  }

  async test(rewardId: string, draft?: RedeemMapping): Promise<void> {
    const reward = this.rewards.find((item) => item.id === rewardId);
    const stored = this.data.mappings.find((item) => item.rewardId === rewardId) ?? (reward ? this.mappingFor(reward) : null);
    const mapping = draft ? normalizeMapping({ ...stored, ...draft, rewardId: draft.rewardId || rewardId }) : stored;
    if (!mapping || mapping.action === "none") throw new Error("Choose video or sound before testing.");
    if (!mapping.filePath) throw new Error("Choose a file first. Sounds can stay empty until you add them.");
    if (!fs.existsSync(mapping.filePath)) throw new Error("That file is not on disk.");
    this.enqueue({
      id: `test-${Date.now()}`,
      rewardId: mapping.rewardId || rewardId,
      title: mapping.title,
      action: mapping.action,
      filePath: mapping.filePath,
      volume: mapping.volume,
      maxDurationMs: mapping.maxDurationMs,
      placement: mapping.placement,
      emberOwned: false,
      userName: "test",
    });
  }

  skip(): RedeemSnapshot {
    this.queue.skip();
    this.haltAndContinue();
    return this.snapshot();
  }

  clearQueue(): RedeemSnapshot {
    this.queue.clear();
    this.haltAndContinue();
    return this.snapshot();
  }

  private async onAuth(): Promise<void> {
    const auth = this.ctx.auth.state();
    if (!auth.loggedIn || !auth.userId) {
      this.eventsub.stop();
      this.rewards = [];
      this.manageable.clear();
      this.status = "Log in with Twitch to hear channel points.";
      this.publish();
      return;
    }
    if (auth.missingScopes.includes("channel:read:redemptions")) {
      this.eventsub.stop();
      this.status = "Log in again to grant channel point access.";
      this.emit({ type: "toast", tone: "error", text: this.status });
      this.publish();
      return;
    }
    try {
      await this.loadRewards();
    } catch (err) {
      this.status = redactError(err);
      this.ctx.log.error("reward list failed", { message: this.status });
    }
    this.eventsub.start();
    this.publish();
  }

  private async loadRewards(): Promise<void> {
    const user = this.requireUser();
    const [all, owned] = await Promise.all([
      this.ctx.helix.listCustomRewards(user.userId, false),
      this.ctx.helix.listCustomRewards(user.userId, true),
    ]);
    this.rewards = all;
    this.manageable = new Set(owned.map((reward) => reward.id));
    let changed = false;
    for (const reward of all) {
      const byTitle = this.data.mappings.find((item) => !item.rewardId && sameTitle(item.title, reward.title));
      if (byTitle) {
        byTitle.rewardId = reward.id;
        byTitle.title = reward.title;
        changed = true;
      }
    }
    if (changed) saveRedeemFile(this.file, this.data);
  }

  private onRedemption(redemption: EventSubRedemption): void {
    const channel = this.ctx.settings.load().twitchChannel || this.ctx.auth.state().login || "";
    this.ctx.acceptChat?.(chatFromRedemption(redemption, channel));
    const reward = this.rewards.find((item) => item.id === redemption.rewardId);
    const mapping =
      this.data.mappings.find((item) => item.rewardId === redemption.rewardId) ??
      this.data.mappings.find((item) => sameTitle(item.title, redemption.rewardTitle));
    const emberOwned = this.manageable.has(redemption.rewardId);
    if (mapping && !mapping.rewardId) {
      mapping.rewardId = redemption.rewardId;
      saveRedeemFile(this.file, this.data);
    }
    if (!mapping || !mapping.enabled || mapping.action === "none") {
      if (emberOwned) void this.fulfill(redemption.rewardId, redemption.redemptionId);
      return;
    }
    if (!mapping.filePath || !fs.existsSync(mapping.filePath)) {
      this.emit({
        type: "toast",
        tone: "error",
        text: `${mapping.title} has no playable file yet.`,
      });
      return;
    }
    this.enqueue({
      id: `redeem-${redemption.redemptionId}`,
      rewardId: redemption.rewardId,
      title: reward?.title || mapping.title,
      action: mapping.action,
      filePath: mapping.filePath,
      volume: mapping.volume,
      maxDurationMs: mapping.maxDurationMs,
      placement: mapping.placement,
      redemptionId: redemption.redemptionId,
      emberOwned,
      userName: redemption.userName,
    });
  }

  private enqueue(job: AlertJob): void {
    const started = this.queue.enqueue(job);
    if (started && this.overlayCount() > 0) this.begin(job);
    else this.publish();
  }

  private begin(job: AlertJob): void {
    this.playing = true;
    if (job.emberOwned && job.redemptionId) void this.fulfill(job.rewardId, job.redemptionId);
    this.push(job);
    if (this.stall) clearTimeout(this.stall);
    this.stall = setTimeout(() => this.finish(job.id), alertStallMs(job.maxDurationMs));
    this.ctx.log.info("alert started", { title: job.title, user: job.userName });
    this.publish();
  }

  private finish(id: string): void {
    if (this.queue.current?.id !== id) return;
    const next = this.queue.complete(id);
    this.playing = false;
    if (this.stall) clearTimeout(this.stall);
    this.stall = null;
    if (next && this.overlayCount() > 0) this.begin(next);
    else {
      this.ctx.server.broadcast({ type: "alert-stop" }, "/ws/alerts");
      this.publish();
    }
  }

  private haltAndContinue(): void {
    if (this.stall) clearTimeout(this.stall);
    this.stall = null;
    this.playing = false;
    this.ctx.server.broadcast({ type: "alert-stop" }, "/ws/alerts");
    const current = this.queue.current;
    if (current && this.overlayCount() > 0) this.begin(current);
    else this.publish();
  }

  private autoImportFirebot(): void {
    if (this.ctx.settings.load().autoImportFirebot === false) return;
    const source = firebotRewardsPath();
    if (!fs.existsSync(source)) return;
    let payload: unknown;
    try {
      payload = JSON.parse(fs.readFileSync(source, "utf8"));
    } catch (err) {
      this.ctx.log.error("firebot auto-import failed", { message: redactError(err) });
      return;
    }
    const before = this.data.mappings.map((mapping) => ({ ...mapping }));
    const merged = mergeImported(
      before,
      importFirebotRewards(payload),
      this.rewards.map((reward) => ({ id: reward.id, title: reward.title })),
    );
    const filled = countFilledMappings(before, merged);
    if (filled === 0) return;
    this.data.mappings = merged;
    saveRedeemFile(this.file, this.data);
    this.ctx.log.info(`auto-imported ${filled} Firebot mappings`);
  }

  private overlayCount(): number {
    return this.ctx.server.clientCount("/ws/alerts");
  }

  private pushCurrent(): void {
    const current = this.queue.current;
    if (current) this.push(current);
  }

  private push(job: AlertJob): void {
    this.ctx.server.broadcast(
      {
        type: "alert-play",
        job: {
          id: job.id,
          rewardId: job.rewardId,
          title: job.title,
          media: mediaKind(job.filePath, job.action),
          volume: job.volume / 100,
          maxDurationMs: job.maxDurationMs,
          box: mediaKind(job.filePath, job.action) === "audio" ? null : placementBox(normalizePlacement(job.placement)),
        },
      },
      "/ws/alerts",
    );
  }

  private async fulfill(rewardId: string, redemptionId: string): Promise<void> {
    const user = this.user();
    if (!user) return;
    try {
      await this.ctx.helix.fulfillRedemption(user.userId, rewardId, redemptionId);
    } catch (err) {
      this.ctx.log.error("could not fulfill redemption", { message: redactError(err) });
    }
  }

  private serveMedia(req: IncomingMessage, res: ServerResponse, rewardId: string): void {
    if (!REWARD_ID.test(rewardId)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const mapping = this.data.mappings.find((item) => item.rewardId === rewardId);
    if (!mapping?.filePath) {
      res.writeHead(404);
      res.end();
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(mapping.filePath);
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
    if (!stat.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const type = mime(mapping.filePath);
    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      const start = match ? Number(match[1]) : 0;
      const end = match && match[2] ? Number(match[2]) : stat.size - 1;
      if (!match || start >= stat.size || end < start) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Cache-Control": "no-store",
      });
      fs.createReadStream(mapping.filePath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(mapping.filePath).pipe(res);
  }

  private mappingFor(reward: TwitchReward): RedeemMapping {
    return (
      this.data.mappings.find((item) => item.rewardId === reward.id) ??
      this.data.mappings.find((item) => sameTitle(item.title, reward.title)) ?? {
        rewardId: reward.id,
        title: reward.title,
        action: "none",
        filePath: "",
        volume: 100,
        maxDurationMs: null,
        enabled: true,
      }
    );
  }

  private publish(): void {
    this.emit({ type: "redeems", redeems: this.snapshot() });
  }

  private emit(event: WithoutSeq<AppEvent>): void {
    this.ctx.emit(event);
  }

  private requireUser(): { userId: string } {
    const user = this.user();
    if (!user) throw new Error("Log in with Twitch first.");
    return user;
  }

  private requireManage(): void {
    const auth = this.ctx.auth.state();
    if (!auth.loggedIn || auth.missingScopes.includes("channel:manage:redemptions")) {
      throw new Error(`Log in again to let ${brand.displayName} create and edit its own rewards.`);
    }
  }

  private user(): { userId: string } | null {
    const auth = this.ctx.auth.state();
    return auth.loggedIn && auth.userId ? { userId: auth.userId } : null;
  }
}

export function firebotRewardsPath(): string {
  return firebotRewardsFile();
}

function mediaKind(filePath: string, action: "video" | "sound"): "video" | "audio" | "image" {
  if (path.extname(filePath).toLowerCase() === ".gif") return "image";
  return action === "sound" ? "audio" : "video";
}

function mime(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".mkv":
      return "video/x-matroska";
    case ".gif":
      return "image/gif";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".flac":
      return "audio/flac";
    case ".m4a":
      return "audio/mp4";
    default:
      return "application/octet-stream";
  }
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readBody(req)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 20_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
