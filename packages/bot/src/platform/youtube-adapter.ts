import { isChatClosedError, isQuotaError, YoutubeDataApi } from "../../../../src/shared/platform/youtube-api.ts";
import { sharedQuotaMeter, YoutubeQuotaMeter } from "../../../../src/shared/platform/youtube-quota.ts";
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
  private readonly meter: YoutubeQuotaMeter;
  private readonly api: YoutubeDataApi;
  private abort = new AbortController();
  private generation = 0;
  private running = false;
  private liveChatId = "";
  private pageToken = "";
  private primed = false;
  private title = "";
  private status: PlatformLiveStatus = { connected: false, live: false, detail: "YouTube bot is idle." };

  constructor(
    private readonly deps: {
      accessToken: () => Promise<string>;
      channelId: () => string;
      hasToken: () => boolean;
      fetchImpl: typeof fetch;
      discoverVideo: (channelId: string, signal: AbortSignal) => Promise<{ videoId: string; title: string } | null>;
      log: (level: "info" | "error", message: string, extra?: Record<string, string>) => void;
      meter?: YoutubeQuotaMeter;
    },
  ) {
    this.meter = deps.meter ?? sharedQuotaMeter();
    this.api = new YoutubeDataApi({ token: () => deps.accessToken(), fetchImpl: deps.fetchImpl, meter: this.meter });
  }

  quota(): YoutubeQuotaMeter {
    return this.meter;
  }

  liveStatus(): PlatformLiveStatus {
    return { ...this.status, title: this.title || undefined, liveChatId: this.liveChatId || undefined };
  }

  async connect(): Promise<void> {
    if (!this.deps.hasToken()) {
      this.status = { connected: false, live: false, detail: "Connect a YouTube account to run the bot there." };
      return;
    }
    if (this.running) return;
    this.running = true;
    this.abort = new AbortController();
    void this.loop(++this.generation, this.abort.signal);
  }

  async disconnect(): Promise<void> {
    this.running = false;
    this.generation += 1;
    this.abort.abort();
    this.liveChatId = "";
    this.pageToken = "";
    this.primed = false;
    this.status = { connected: false, live: false, detail: "YouTube bot is idle." };
  }

  async sendMessage(text: string): Promise<void> {
    const liveChatId = await this.ensureChat();
    await this.api.insertMessage(liveChatId, text);
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

  private async loop(generation: number, signal: AbortSignal): Promise<void> {
    while (this.running && generation === this.generation && !signal.aborted) {
      try {
        if (!this.liveChatId) {
          const found = await this.findChat(signal);
          if (!found) {
            this.status = { connected: true, live: false, detail: "No active YouTube broadcast." };
            await sleep(this.meter.delay(), signal);
            continue;
          }
          this.liveChatId = found.liveChatId;
          this.title = found.title;
          this.pageToken = "";
          this.primed = false;
          this.meter.success(this.meter.pollingIntervalMillis);
          this.status = { connected: true, live: true, detail: found.title || "Live", title: found.title, liveChatId: found.liveChatId };
          this.deps.log("info", "youtube bot attached", { videoId: found.videoId });
        }
        const page = await this.api.listMessages(this.liveChatId, this.pageToken);
        this.meter.success(page.pollingIntervalMillis);
        if (this.primed) {
          for (const message of page.messages) this.remember(message);
          for (const message of page.messages) {
            for (const listener of this.listeners) listener(message);
          }
        } else {
          for (const message of page.messages) this.remember(message);
          this.primed = true;
        }
        if (page.nextPageToken) this.pageToken = page.nextPageToken;
        if (page.offline || !page.nextPageToken) {
          this.liveChatId = "";
          this.pageToken = "";
          this.primed = false;
          this.status = { connected: true, live: false, detail: "YouTube chat ended. Watching for the next broadcast." };
        } else {
          this.status = {
            connected: true,
            live: true,
            detail: this.title || "Live",
            title: this.title,
            liveChatId: this.liveChatId,
          };
        }
        await sleep(this.meter.delay(), signal);
      } catch (err) {
        if (!this.running || generation !== this.generation || isAbort(err)) return;
        const quota = isQuotaError(err);
        this.meter.fail(quota);
        if (isChatClosedError(err)) {
          this.liveChatId = "";
          this.pageToken = "";
          this.primed = false;
        }
        const message = err instanceof Error ? err.message : "YouTube chat failed.";
        this.deps.log("error", "youtube bot poll failed", { message });
        this.status = {
          connected: true,
          live: Boolean(this.liveChatId),
          detail: message,
          title: this.title || undefined,
          liveChatId: this.liveChatId || undefined,
        };
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
    const channelId = this.deps.channelId().trim();
    if (!channelId) return null;
    const video = await this.deps.discoverVideo(channelId, signal);
    if (!video) return null;
    const chat = await this.api.liveChatForVideo(video.videoId);
    if (!chat) return null;
    return { videoId: video.videoId, title: chat.title || video.title, liveChatId: chat.liveChatId };
  }

  private async ensureChat(): Promise<string> {
    if (this.liveChatId) return this.liveChatId;
    const found = await this.findChat(this.abort.signal);
    if (!found) throw new Error("YouTube is not live, so the bot cannot post yet.");
    this.liveChatId = found.liveChatId;
    this.title = found.title;
    this.status = { connected: true, live: true, detail: found.title || "Live", title: found.title, liveChatId: found.liveChatId };
    return found.liveChatId;
  }

  private remember(message: NormalizedChatMessage): void {
    this.users.set(message.user.login.toLowerCase(), message.user.id);
    this.users.set(message.user.displayName.trim().toLowerCase(), message.user.id);
    this.users.set(message.user.id.toLowerCase(), message.user.id);
  }
}
