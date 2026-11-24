import { YoutubeLive } from "../../../../src/main/youtube/live.ts";
import { Logger } from "../../../../src/main/logger.ts";
import { normalizeYoutubeReaderMessage } from "../../../../src/shared/platform/normalize.ts";
import { isChatClosedError, isQuotaError, YoutubeDataApi } from "../../../../src/shared/platform/youtube-api.ts";
import { sharedQuotaMeter, YoutubeQuotaMeter, type QuotaSnapshot } from "../../../../src/shared/platform/youtube-quota.ts";
import { describeYoutubeQuota, shouldUseYoutubeApiPoll } from "../../../../src/shared/platform/youtubei.ts";
import type { ChatPlatform, NormalizedChatMessage, PlatformCapabilities, PlatformLiveStatus } from "../../../../src/shared/platform/types.ts";
import { isAbort, sleep } from "../../../../src/main/sleep.ts";

const CAPABILITIES: PlatformCapabilities = {
  send: true,
  deleteMessage: true,
  timeout: true,
  ban: true,
  unban: true,
};

export class YoutubeChatPlatform implements ChatPlatform {
  readonly id = "youtube";
  readonly label = "YouTube";
  readonly capabilities = CAPABILITIES;
  private readonly listeners = new Set<(message: NormalizedChatMessage) => void>();
  private readonly users = new Map<string, string>();
  private readonly bans = new Map<string, string>();
  private readonly seen = new Set<string>();
  private readonly meter: YoutubeQuotaMeter;
  private readonly api: YoutubeDataApi;
  private abort = new AbortController();
  private generation = 0;
  private apiRunning = false;
  private liveChatId = "";
  private videoId = "";
  private pageToken = "";
  private primed = false;
  private title = "";
  private live = false;
  private liveKnown = false;
  private readerFailures = 0;
  private autoFallback = false;
  private replies = 0;
  private own: YoutubeLive | null = null;
  private status = "Waiting for YouTube chat from the page reader.";

  constructor(
    private readonly deps: {
      accessToken: () => Promise<string>;
      channelId: () => string;
      hasToken: () => boolean;
      fetchImpl: typeof fetch;
      discoverVideo: (channelId: string, signal: AbortSignal) => Promise<{ videoId: string; title: string } | null>;
      log: (level: "info" | "error", message: string, extra?: Record<string, string>) => void;
      meter?: YoutubeQuotaMeter;
      /** Desk already runs the page reader. A headless bot starts its own. */
      ownReader?: boolean;
      optIn?: () => boolean;
    },
  ) {
    this.meter = deps.meter ?? sharedQuotaMeter();
    this.api = new YoutubeDataApi({ token: () => deps.accessToken(), fetchImpl: deps.fetchImpl, meter: this.meter });
  }

  quota(): YoutubeQuotaMeter {
    return this.meter;
  }

  quotaView(): QuotaSnapshot {
    const snap = this.meter.snapshot();
    const apiPoll = this.pollingApi();
    return {
      ...snap,
      pollingIntervalMillis: apiPoll ? snap.pollingIntervalMillis : null,
      detail: describeYoutubeQuota({
        apiPoll,
        fallback: this.autoFallback && !this.optIn(),
        replies: this.replies,
        usedUnits: snap.usedUnits,
      }),
    };
  }

  liveStatus(): PlatformLiveStatus {
    return {
      connected: true,
      live: this.live,
      liveKnown: this.liveKnown,
      detail: this.status,
      title: this.title || undefined,
      liveChatId: this.liveChatId || undefined,
    };
  }

  /** Page-reader lines. Message id and author channel id are kept for delete and ban. */
  ingest(message: NormalizedChatMessage): void {
    if (!this.rememberSeen(message.messageId)) return;
    this.remember(message);
    this.live = true;
    this.liveKnown = true;
    if (!this.pollingApi()) this.status = this.readerStatus();
    for (const listener of this.listeners) listener(message);
  }

  setLive(input: { live: boolean; known?: boolean; title?: string; videoId?: string }): void {
    if (input.known === false) {
      if (input.title) this.title = input.title;
      if (input.videoId && input.videoId !== this.videoId) {
        this.videoId = input.videoId;
        this.liveChatId = "";
      }
      if (!this.pollingApi()) this.status = this.readerStatus();
      return;
    }
    this.live = input.live;
    this.liveKnown = true;
    if (input.title) this.title = input.title;
    if (input.videoId && input.videoId !== this.videoId) {
      this.videoId = input.videoId;
      this.liveChatId = "";
    }
    if (!this.pollingApi()) this.status = this.readerStatus();
  }

  setOptIn(enabled: boolean): void {
    if (enabled) void this.startApiPoll();
    else if (!this.autoFallback) void this.stopApiPoll();
    if (!this.pollingApi()) this.status = this.readerStatus();
  }

  noteReader(ok: boolean): void {
    if (ok) {
      this.readerFailures = 0;
      if (this.autoFallback) {
        this.autoFallback = false;
        if (!this.optIn()) void this.stopApiPoll();
      }
      if (!this.pollingApi()) this.status = this.readerStatus();
      return;
    }
    this.readerFailures += 1;
    if (shouldUseYoutubeApiPoll({ optIn: false, consecutiveReaderFailures: this.readerFailures })) {
      this.autoFallback = true;
      this.status = "The page reader failed, so the bot is polling the Data API until chat recovers.";
      void this.startApiPoll();
    }
  }

  async connect(): Promise<void> {
    if (this.deps.ownReader) this.startOwnReader();
    if (this.optIn()) await this.startApiPoll();
    else this.status = this.readerStatus();
  }

  async disconnect(): Promise<void> {
    this.own?.stop();
    this.own = null;
    await this.stopApiPoll();
    this.live = false;
    this.liveKnown = false;
    this.status = "YouTube bot is idle.";
  }

  async sendMessage(text: string): Promise<void> {
    const liveChatId = await this.ensureChat();
    await this.api.insertMessage(liveChatId, text);
    this.replies += 1;
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.api.deleteMessage(messageId);
  }

  async timeoutUser(userId: string, seconds: number, reason: string): Promise<void> {
    const liveChatId = await this.ensureChat();
    const banId = await this.api.banUser(liveChatId, userId, seconds);
    if (banId) this.bans.set(userId, banId);
    void reason;
  }

  async banUser(userId: string, reason: string): Promise<void> {
    const liveChatId = await this.ensureChat();
    const banId = await this.api.banUser(liveChatId, userId, null);
    if (banId) this.bans.set(userId, banId);
    void reason;
  }

  async unbanUser(userId: string): Promise<void> {
    const banId = this.bans.get(userId);
    if (!banId) throw new Error("YouTube can only lift a ban this bot created in this session.");
    await this.api.unban(banId);
    this.bans.delete(userId);
  }

  async lookupUser(login: string): Promise<string | null> {
    const key = login.trim().toLowerCase();
    return this.users.get(key) ?? null;
  }

  onMessage(listener: (message: NormalizedChatMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private optIn(): boolean {
    return this.deps.optIn?.() === true;
  }

  private pollingApi(): boolean {
    return this.apiRunning && (this.optIn() || this.autoFallback);
  }

  private readerStatus(): string {
    if (!this.deps.hasToken()) return "Reading YouTube chat from the page. Connect an account to reply, delete, or ban.";
    if (!this.live) return "Waiting for YouTube chat from the page reader.";
    return this.title ? `Reading ${this.title} from the page.` : "Reading YouTube chat from the page.";
  }

  private startOwnReader(): void {
    if (this.own) return;
    const channelId = this.deps.channelId().trim();
    if (!channelId) return;
    const reader = new YoutubeLive({
      channelId,
      onMessage: (message) => {
        const normalized = normalizeYoutubeReaderMessage(message);
        if (normalized) this.ingest(normalized);
      },
      onDelete: () => undefined,
      onDeleteAuthor: () => undefined,
      onStatus: (status) => {
        const known = status.state === "live" || status.state === "offline";
        this.setLive({ live: status.state === "live", known, title: status.title, videoId: status.videoId });
      },
      onHealth: (health) => this.noteReader(health.ok),
      log: new Logger(null),
      fetchImpl: this.deps.fetchImpl,
    });
    this.own = reader;
    reader.start();
  }

  private async startApiPoll(): Promise<void> {
    if (this.apiRunning || !this.deps.hasToken()) return;
    this.apiRunning = true;
    this.abort = new AbortController();
    void this.loop(++this.generation, this.abort.signal);
  }

  private async stopApiPoll(): Promise<void> {
    this.apiRunning = false;
    this.generation += 1;
    this.abort.abort();
    this.pageToken = "";
    this.primed = false;
  }

  private async loop(generation: number, signal: AbortSignal): Promise<void> {
    while (this.apiRunning && generation === this.generation && !signal.aborted) {
      try {
        if (!this.liveChatId) {
          const found = await this.findChat(signal);
          if (!found) {
            this.status = "No active YouTube broadcast for the Data API poll.";
            await sleep(this.meter.delay(), signal);
            continue;
          }
          this.liveChatId = found.liveChatId;
          this.videoId = found.videoId;
          this.title = found.title;
          this.pageToken = "";
          this.primed = false;
          this.live = true;
          this.liveKnown = true;
        }
        const page = await this.api.listMessages(this.liveChatId, this.pageToken);
        this.meter.success(page.pollingIntervalMillis);
        if (this.primed) {
          for (const message of page.messages) this.ingest(message);
        } else {
          for (const message of page.messages) {
            this.rememberSeen(message.messageId);
            this.remember(message);
          }
          this.primed = true;
        }
        if (page.nextPageToken) this.pageToken = page.nextPageToken;
        if (page.offline || !page.nextPageToken) {
          this.liveChatId = "";
          this.pageToken = "";
          this.primed = false;
          this.live = false;
          this.liveKnown = true;
          this.status = "YouTube chat ended. The Data API poll is watching for the next broadcast.";
        }
        await sleep(this.meter.delay(), signal);
      } catch (err) {
        if (!this.apiRunning || generation !== this.generation || isAbort(err)) return;
        this.meter.fail(isQuotaError(err));
        if (isChatClosedError(err)) {
          this.liveChatId = "";
          this.pageToken = "";
          this.primed = false;
        }
        const message = err instanceof Error ? err.message : "YouTube chat failed.";
        this.deps.log("error", "youtube api poll failed", { message });
        this.status = message;
        try {
          await sleep(this.meter.delay(), signal);
        } catch {
          return;
        }
      }
    }
  }

  private async findChat(signal: AbortSignal): Promise<{ videoId: string; title: string; liveChatId: string } | null> {
    const own = await this.api.listActiveBroadcast();
    if (own) return own;
    const videoId = this.videoId || (await this.deps.discoverVideo(this.deps.channelId(), signal))?.videoId || "";
    if (!videoId) return null;
    const chat = await this.api.liveChatForVideo(videoId);
    if (!chat) return null;
    return { videoId, title: chat.title || this.title, liveChatId: chat.liveChatId };
  }

  private async ensureChat(): Promise<string> {
    if (this.liveChatId) return this.liveChatId;
    const found = await this.findChat(this.abort.signal);
    if (!found) throw new Error("YouTube is not live, so the bot cannot post yet.");
    this.liveChatId = found.liveChatId;
    this.videoId = found.videoId;
    this.title = found.title || this.title;
    this.live = true;
    this.liveKnown = true;
    return found.liveChatId;
  }

  private rememberSeen(id: string): boolean {
    if (!id || this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > 2_000) {
      const oldest = this.seen.values().next().value;
      if (typeof oldest === "string") this.seen.delete(oldest);
    }
    return true;
  }

  private remember(message: NormalizedChatMessage): void {
    if (message.user.login) this.users.set(message.user.login.toLowerCase(), message.user.id);
    if (message.user.displayName) this.users.set(message.user.displayName.trim().toLowerCase(), message.user.id);
    if (message.user.id) this.users.set(message.user.id.toLowerCase(), message.user.id);
  }
}
