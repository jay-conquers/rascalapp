import path from "node:path";
import { brand, readBrandEnv } from "../shared/brand";
import { chatFeedConnected, SessionChatters, type ChatterName } from "../shared/mentions";
import { filterEnabled, isPlatformEnabled } from "../shared/platform/selection";
import type { DeskPlatform } from "../shared/platform/desk";
import { PlatformRegistry } from "../shared/platform/registry";
import type {
  AppEvent,
  AppSnapshot,
  ChatBadge,
  ChatMessage,
  ModAction,
  ConnectionStatus,
  StreamInfo,
  WithoutSeq,
} from "../shared/types";
import { ChatBus } from "./chat-bus";
import { EmoteCatalog } from "./emotes/catalog";
import { EmoteImageCache } from "./emotes/image-cache";
import { Logger } from "./logger";
import { OverlayServer } from "./server";
import { SettingsStore } from "./settings";
import type { RedeemSnapshot } from "../shared/redeems";
import { defaultChatOverlayFile } from "../shared/chat-overlay";
import { getBot } from "./stages/bot";
import { getChatOverlay } from "./stages/chat";
import { getRedeemEngine } from "./stages/redemptions";
import { TokenStore } from "./tokens";
import { BadgeCatalog } from "./twitch/badges";
import { Helix } from "./twitch/helix";
import { TwitchIrc } from "./twitch/irc";
import { NoticeSocket } from "./twitch/notices";
import { TwitchAuth } from "./twitch/oauth";
import { normalizeYoutubeReaderMessage } from "../shared/platform/normalize";
import { YoutubeLive } from "../shared/youtube/page-reader";
import { kickChatMessage, kickModAction } from "../shared/kick/chat";
import { KickConnection } from "../shared/kick/connection";
import type { KickModerationLine } from "../shared/kick/events";
import { clearKickTokens, loadKickClient, loadKickRelay, loadKickTokens, saveKickTokens } from "./kick/files";
import { youtubeDesk, type YoutubeDesk } from "./youtube/desk";

export class RuntimeCore {
  readonly settings: SettingsStore;
  readonly log: Logger;
  readonly version: string;
  protected readonly tokens: TokenStore;
  protected readonly bus = new ChatBus();
  protected readonly platforms = new PlatformRegistry<DeskPlatform>();
  protected readonly server: OverlayServer;
  protected readonly auth: TwitchAuth;
  protected readonly helix: Helix;
  protected readonly emotes: EmoteCatalog;
  protected readonly emoteImages: EmoteImageCache;
  protected readonly badges: BadgeCatalog;
  protected readonly irc: TwitchIrc;
  protected readonly notices: NoticeSocket;
  protected readonly youtube: YoutubeLive;
  protected readonly youtubeSend: YoutubeDesk;
  protected readonly kick: KickConnection;
  protected seq = 0;
  protected stream: StreamInfo | null = null;
  protected streamTimer: NodeJS.Timeout | null = null;
  protected viewerTimer: NodeJS.Timeout | null = null;
  protected readonly modLog: ModAction[] = [];
  protected scopeNoted = false;
  protected roomId: string | null = null;
  protected lastAlertAt: number | null = null;
  protected lastSend = 0;
  protected readonly session = new SessionChatters();
  protected listedTwitch: ChatterName[] = [];
  protected chatterTimer: NodeJS.Timeout | null = null;
  protected broadcasterCache: { login: string; id: string } | null = null;
  protected sender: ((event: AppEvent) => void) | null = null;
  protected hooks: { alwaysOnTop?: (value: boolean) => void } = {};
  protected status: ConnectionStatus;

  constructor(deps: {
    dir: string;
    version?: string;
    openExternal?: (url: string) => Promise<void>;
    fetchImpl?: typeof fetch;
  }) {
    this.version = deps.version ?? "0.12.0";
    this.log = new Logger(path.join(deps.dir, "logs", brand.logFile));
    this.youtubeSend = youtubeDesk(deps.dir, { log: this.log, fetchImpl: deps.fetchImpl });
    this.youtubeSend.setOnChange(() => this.publishYoutubeSend());
    this.settings = new SettingsStore(deps.dir);
    this.tokens = new TokenStore(deps.dir);
    const settings = this.settings.load();
    const twitchOn = isPlatformEnabled(settings.platforms, "twitch");
    const youtubeOn = isPlatformEnabled(settings.platforms, "youtube");
    const kickOn = isPlatformEnabled(settings.platforms, "kick");
    this.status = {
      twitch: !twitchOn
        ? { state: "idle", detail: "Twitch is off." }
        : settings.twitchChannel
          ? { state: "connecting", detail: "Connecting to chat…" }
          : { state: "idle", detail: "Set a Twitch channel in Settings." },
      youtube: { state: "idle", detail: youtubeOn ? "Waiting to check YouTube" : "YouTube is off." },
      kick: { state: "idle", detail: kickOn ? "No relay configured" : "Kick is off." },
      overlay: { listening: false, host: "127.0.0.1", port: settings.overlayPort },
    };
    this.kick = new KickConnection({
      fetchImpl: deps.fetchImpl,
      client: () => loadKickClient(deps.dir),
      tokens: () => loadKickTokens(deps.dir),
      saveTokens: (tokens) => saveKickTokens(deps.dir, tokens),
      clearTokens: () => clearKickTokens(deps.dir),
      relayUrl: () => readBrandEnv("KICK_RELAY_URL")?.trim() || this.settings.load().kickRelayUrl,
      relaySecret: () => loadKickRelay(deps.dir).secret,
      log: (level, message) => this.log[level](message),
      onChat: (line) => this.acceptChat(kickChatMessage(line)),
      onModeration: (line) => this.pushKickMod(line),
      onStatus: (state, detail) => this.publishKick(state, detail),
      onLoginUrl: (url) => {
        if (deps.openExternal) void deps.openExternal(url);
      },
    });
    this.server = new OverlayServer(
      () => filterEnabled(this.bus.messages, (message) => message.platform, this.settings.load().platforms),
      this.log,
    );
    this.auth = new TwitchAuth({
      clientId: () => this.settings.load().twitchClientId,
      tokens: this.tokens,
      log: this.log,
      fetchImpl: deps.fetchImpl,
      openBrowser: deps.openExternal,
      onChange: () => {
        this.emit({ type: "auth", auth: this.auth.state() });
        this.emit({ type: "login", login: this.auth.prompt });
        this.applyTwitchChannel();
        this.scopeNoted = false;
        if (this.auth.state().loggedIn && this.twitchOn()) {
          void this.badges.loadGlobal();
          if (this.roomId) void this.loadTwitchEmotes(this.roomId);
          this.notices.start();
          this.notices.retarget();
          void this.refreshViewers();
          this.armViewerPoll();
          this.armChatterPoll();
        } else {
          this.notices.stop();
          this.setTwitchViewers(null);
          this.disarmChatterPoll();
          if (!this.twitchOn()) {
            this.disarmViewerPoll();
            this.disarmStreamPoll();
          }
        }
      },
    });
    this.helix = new Helix({
      clientId: () => this.settings.load().twitchClientId,
      getToken: () => this.auth.ensureFresh(),
      refresh: () => this.auth.forceRefresh(),
      fetchImpl: deps.fetchImpl,
    });
    this.emotes = new EmoteCatalog({ log: this.log, fetchImpl: deps.fetchImpl, flags: settings.feed.emotes });
    this.emoteImages = new EmoteImageCache({ dir: deps.dir, log: this.log, fetchImpl: deps.fetchImpl });
    this.badges = new BadgeCatalog({
      log: this.log,
      loadGlobal: () => this.helix.getGlobalBadges(),
      loadChannel: (broadcasterId) => this.helix.getChannelBadges(broadcasterId),
      onUpdate: () => getChatOverlay()?.refresh(),
    });
    this.irc = new TwitchIrc({
      channel: settings.twitchChannel,
      emotes: () => this.emotes.map,
      onMessage: (message) => this.acceptChat(message),
      onDelete: (id) => this.bus.delete(id),
      onClearUser: (username) => this.bus.clearUser("twitch", username),
      onClearAll: () => this.bus.clearPlatform("twitch"),
      onRoomId: (roomId) => {
        this.roomId = roomId;
        void this.emotes.loadChannel(roomId);
        void this.badges.loadChannel(roomId);
        void this.loadTwitchEmotes(roomId);
      },
      onStatus: (state, detail) => {
        if (!this.twitchOn()) return;
        const viewers = this.status.twitch.viewers;
        this.status = {
          ...this.status,
          twitch: viewers === undefined ? { state, detail } : { state, detail, viewers },
        };
        this.emit({ type: "status", status: this.status });
      },
      log: this.log,
    });
    this.youtube = new YoutubeLive({
      channelId: settings.youtubeChannelId,
      onMessage: (message) => {
        this.acceptChat(message);
        if (message.platform !== "youtube") return;
        const normalized = normalizeYoutubeReaderMessage(message);
        if (normalized) getBot()?.service.ingestYoutube(normalized);
      },
      onDelete: (id) => this.bus.delete(id),
      onDeleteAuthor: (authorId) => this.bus.clearAuthor(authorId),
      onModAction: (action) => this.pushMod(action),
      onViewers: (count) => {
        if (!this.youtubeOn()) return;
        this.setYoutubeViewers(count);
      },
      onHealth: (health) => {
        if (!this.youtubeOn()) return;
        getBot()?.service.noteYoutubeReader(health.ok);
      },
      onStatus: (youtube) => {
        if (!this.youtubeOn()) return;
        const desk = this.youtubeSend.state();
        const ready = this.youtubeSend.sendReadiness();
        this.status = { ...this.status, youtube: { ...youtube, canSend: ready.canSend, sendAccount: desk.account, sendHint: ready.hint } };
        this.emit({ type: "status", status: this.status });
        getBot()?.service.setYoutubeLive({
          live: youtube.state === "live",
          known: youtube.state === "live" || youtube.state === "offline",
          title: youtube.title,
          videoId: youtube.videoId,
        });
      },
      log: this.log,
      fetchImpl: deps.fetchImpl,
    });
    this.notices = new NoticeSocket({
      auth: () => this.auth.state(),
      channel: () => this.chatChannel(),
      feed: () => this.settings.load().feed,
      broadcasterId: (login) => this.helix.getUserId(login),
      subscribe: (type, version, condition, sessionId) => this.helix.subscribeEvent(type, version, condition, sessionId),
      emotes: () => this.emotes.map,
      onChat: (message) => this.acceptChat(message),
      onModAction: (action) => this.pushMod(action),
      onScopeProblem: (text) => this.noteScope(text),
      log: this.log,
    });
    this.bus.setHandlers({
      onMessage: (message) => {
        this.emit({ type: "chat", message });
        if (!message.deskOnly) this.server.broadcast({ type: "chat", message });
      },
      onDelete: (id) => {
        this.emit({ type: "chat-delete", id });
        this.server.broadcast({ type: "chat-delete", id });
      },
      onClear: (platform, username) => {
        this.emit({ type: "chat-clear", platform, username });
        this.server.broadcast({ type: "chat-clear", platform, username });
      },
      onReplace: (message) => {
        this.emit({ type: "chat-replace", message });
      },
    });
    this.platforms.register({
      id: "twitch",
      label: "Twitch",
      start: () => {
        this.irc.start();
        this.notices.start();
      },
      stop: () => {
        this.irc.stop();
        this.notices.stop();
      },
      deliver: async (text) => {
        const user = this.requireUser();
        const channel = this.settings.load().twitchChannel || user.login;
        const broadcasterId = user.login.toLowerCase() === channel ? user.userId : await this.helix.getUserId(channel);
        await this.helix.sendChat(broadcasterId, user.userId, text);
        return "ok";
      },
      chatters: () => ({
        id: "twitch",
        label: "Twitch",
        listed: this.listedTwitch,
        session: this.session.list("twitch"),
      }),
      mentionsOpen: () => this.twitchOn() && this.settings.load().sendTargets.twitch && chatFeedConnected(this.status.twitch.state),
    });
    this.platforms.register({
      id: "youtube",
      label: "YouTube",
      start: () => this.youtube.start(),
      stop: () => this.youtube.stop(),
      deliver: async (text) => {
        try {
          await this.youtubeSend.send(text, this.status.youtube.videoId);
          return "ok";
        } catch (err) {
          const detail = err instanceof Error ? err.message : "YouTube did not accept that message.";
          if (/not live/i.test(detail)) return "not-live";
          throw err;
        }
      },
      chatters: () => ({
        id: "youtube",
        label: "YouTube",
        listed: [],
        session: this.session.list("youtube"),
      }),
      mentionsOpen: () => this.youtubeOn() && this.settings.load().sendTargets.youtube && chatFeedConnected(this.status.youtube.state),
    });
    this.platforms.register({
      id: "kick",
      label: "Kick",
      start: () => {
        void this.kick.open();
      },
      stop: () => {
        void this.kick.close();
      },
      deliver: async (text) => {
        await this.kick.send(text);
        return "ok";
      },
      chatters: () => ({
        id: "kick",
        label: "Kick",
        listed: [],
        session: this.session.list("kick"),
      }),
      mentionsOpen: () => this.kickOn() && this.settings.load().sendTargets.kick === true && chatFeedConnected(this.status.kick.state),
    });
  }

  attachSender(sender: (event: AppEvent) => void): void {
    this.sender = sender;
  }

  setHooks(hooks: { alwaysOnTop?: (value: boolean) => void }): void {
    this.hooks = hooks;
  }


  snapshot(): AppSnapshot {
    return {
      seq: this.seq,
      messages: this.bus.messages.map((message) => ({ ...message })),
      modLog: this.modLog.map((action) => ({ ...action })),
      status: this.status,
      auth: this.auth.state(),
      settings: this.settings.load(),
      stream: this.stream,
      login: this.auth.prompt,
      redeems: getRedeemEngine()?.snapshot() ?? this.emptyRedeems(),
      chatOverlay: getChatOverlay()?.file() ?? defaultChatOverlayFile(),
      version: this.version,
    };
  }


  protected emptyRedeems(): RedeemSnapshot {
    const port = this.server.port || this.settings.load().overlayPort;
    return {
      status: "Starting…",
      scopeMissing: false,
      canManage: false,
      overlayUrl: `http://${this.server.host}:${port}/overlay/alerts`,
      overlayCount: 0,
      overlayVersion: this.version,
      overlayHash: "",
      staleOverlay: false,
      soundFolder: "",
      rewards: [],
      queue: { current: null, pending: [] },
    };
  }


  protected stageContext() {
    return {
      log: this.log,
      settings: this.settings,
      tokens: this.tokens,
      chat: this.bus,
      server: this.server,
      helix: this.helix,
      auth: this.auth,
      emit: (event: WithoutSeq<AppEvent>) => this.emit(event),
      version: this.version,
      badgeImage: (badge: ChatBadge) => this.badges.imageFor(badge),
      youtubeAuthChanged: () => this.publishYoutubeSend(),
      acceptChat: (message: ChatMessage) => this.acceptChat(message),
      emoteForOverlay: (url: string) => this.emoteImages.overlayUrl(url, this.server.port),
    };
  }


  protected requireUser(): { login: string; userId: string } {
    const state = this.auth.state();
    if (!state.loggedIn || !state.login || !state.userId) throw new Error("Log in with Twitch first.");
    return { login: state.login, userId: state.userId };
  }


  protected registerEmoteRoute(): void {
    this.server.registerPrefix("GET", "/emote/", (_req, res, url) => {
      const hash = url.pathname.slice("/emote/".length);
      const image = this.emoteImages.read(hash);
      if (!image) {
        res.writeHead(404, { "Cache-Control": "no-store" });
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": image.type,
        "Content-Length": String(image.body.length),
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(image.body);
    });
  }


  protected emit(event: WithoutSeq<AppEvent>): void {
    this.seq += 1;
    this.sender?.({ ...event, seq: this.seq } as AppEvent);
  }

  protected acceptChat(_message: ChatMessage): void {}
  protected pushMod(_action: ModAction): void {}
  protected pushKickMod(line: KickModerationLine): void {
    this.pushMod(kickModAction(line));
  }

  protected publishKick(state: "idle" | "connecting" | "connected" | "reconnecting" | "error", detail: string): void {
    const snap = this.kick.snapshot();
    this.status = {
      ...this.status,
      kick: {
        state: this.kickOn() ? state : "idle",
        detail: this.kickOn() ? detail : "Kick is off.",
        viewers: snap.viewers,
        account: snap.account,
      },
    };
    this.emit({ type: "status", status: this.status });
  }
  protected applyTwitchChannel(): void {}
  protected loadTwitchEmotes(_id: string): Promise<void> { return Promise.resolve(); }
  protected noteScope(_text: string): void {}
  protected refreshViewers(): Promise<void> { return Promise.resolve(); }
  protected armViewerPoll(): void {}
  protected disarmViewerPoll(): void {}
  protected setTwitchViewers(_count: number | null): void {}
  protected setYoutubeViewers(_count: number | null): void {}
  protected publishYoutubeSend(): void {}
  protected refreshStream(_quiet: boolean): Promise<void> { return Promise.resolve(); }
  protected armStreamPoll(): void {}
  protected disarmStreamPoll(): void {}
  protected armChatterPoll(): void {}
  protected disarmChatterPoll(): void {}
  protected chatChannel(): string { return ""; }

  protected twitchOn(): boolean {
    return isPlatformEnabled(this.settings.load().platforms, "twitch");
  }

  protected youtubeOn(): boolean {
    return isPlatformEnabled(this.settings.load().platforms, "youtube");
  }

  protected kickOn(): boolean {
    return isPlatformEnabled(this.settings.load().platforms, "kick");
  }
}
