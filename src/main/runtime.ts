import path from "node:path";
import { brand } from "../shared/brand";
import { TWITCH_MESSAGE_MAX } from "../shared/defaults";
import { noticeDedupeKey, noticeEnabled, placeNotice } from "../shared/feed-toggles";
import { indexChannelEmotes } from "../shared/twitch-emotes";
import { shouldPlayChatAlert, type AlertIdentity } from "../shared/chat-alert";
import { redactError } from "../shared/redact";
import type { SettingsPatch } from "../shared/api";
import type { RedeemMapping } from "../shared/redeems";
import type {
  AppEvent,
  AppSnapshot,
  ChatBadge,
  ChatMessage,
  ModAction,
  AuthState,
  CategoryHit,
  ConnectionStatus,
  Settings,
  StreamInfo,
  StreamUpdate,
  WithoutSeq,
} from "../shared/types";
import { ChatBus } from "./chat-bus";
import { EmoteCatalog } from "./emotes/catalog";
import { EmoteImageCache } from "./emotes/image-cache";
import { Logger } from "./logger";
import { OverlayServer } from "./server";
import { SettingsStore } from "./settings";
import type { RedeemSnapshot } from "../shared/redeems";
import { startStages, stopStages } from "./stages";
import { defaultChatOverlayFile } from "../shared/chat-overlay";
import type { ChatOverlayFile } from "../shared/chat-overlay";
import type { TtsPanel } from "../shared/tts";
import type { BotSnapshot } from "../../packages/bot/src/index.ts";
import { botLinkView, loadBotLink, saveBotLink, type BotLinkView } from "./bot-link";
import { RemoteBot } from "./bot-remote";
import { getBot, stopEmbeddedBot, useEmbeddedBot } from "./stages/bot";
import { getChatOverlay } from "./stages/chat";
import { getRedeemEngine } from "./stages/redemptions";
import { TokenStore } from "./tokens";
import { BadgeCatalog } from "./twitch/badges";
import { Helix } from "./twitch/helix";
import { TwitchIrc } from "./twitch/irc";
import { NoticeSocket } from "./twitch/notices";
import { TwitchAuth } from "./twitch/oauth";
import { normalizeYoutubeReaderMessage } from "../shared/platform/normalize";
import { YoutubeLive } from "./youtube/live";
import { youtubeDesk, type YoutubeDesk, type YoutubeDeskState } from "./youtube/desk";

export class Runtime {
  readonly settings: SettingsStore;
  readonly log: Logger;
  readonly version: string;
  private readonly tokens: TokenStore;
  private readonly bus = new ChatBus();
  private readonly server: OverlayServer;
  private readonly auth: TwitchAuth;
  private readonly helix: Helix;
  private readonly emotes: EmoteCatalog;
  private readonly emoteImages: EmoteImageCache;
  private readonly badges: BadgeCatalog;
  private readonly irc: TwitchIrc;
  private readonly notices: NoticeSocket;
  private readonly youtube: YoutubeLive;
  private readonly youtubeSend: YoutubeDesk;
  private seq = 0;
  private stream: StreamInfo | null = null;
  private streamTimer: NodeJS.Timeout | null = null;
  private viewerTimer: NodeJS.Timeout | null = null;
  private readonly modLog: ModAction[] = [];
  private readonly noticeKeys = new Set<string>();
  private scopeNoted = false;
  private roomId: string | null = null;
  private lastAlertAt: number | null = null;
  private lastSend = 0;
  private sender: ((event: AppEvent) => void) | null = null;
  private hooks: { alwaysOnTop?: (value: boolean) => void } = {};
  private status: ConnectionStatus;

  constructor(deps: {
    dir: string;
    version?: string;
    openExternal?: (url: string) => Promise<void>;
    fetchImpl?: typeof fetch;
  }) {
    this.version = deps.version ?? "0.8.0";
    this.log = new Logger(path.join(deps.dir, "logs", brand.logFile));
    this.youtubeSend = youtubeDesk(deps.dir, { log: this.log, fetchImpl: deps.fetchImpl });
    this.youtubeSend.setOnChange(() => this.publishYoutubeSend());
    this.settings = new SettingsStore(deps.dir);
    this.tokens = new TokenStore(deps.dir);
    const settings = this.settings.load();
    this.status = {
      twitch: settings.twitchChannel
        ? { state: "connecting", detail: "Connecting to chat…" }
        : { state: "idle", detail: "Set a Twitch channel in Settings." },
      youtube: { state: "idle", detail: "Waiting to check YouTube" },
      overlay: { listening: false, host: "127.0.0.1", port: settings.overlayPort },
    };
    this.server = new OverlayServer(() => this.bus.messages, this.log);
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
        if (this.auth.state().loggedIn) {
          void this.badges.loadGlobal();
          if (this.roomId) void this.loadTwitchEmotes(this.roomId);
          this.notices.start();
          this.notices.retarget();
          void this.refreshViewers();
          this.armViewerPoll();
        } else {
          this.notices.stop();
          this.setTwitchViewers(null);
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
        this.status = { ...this.status, twitch: { state, detail } };
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
      onViewers: (count) => this.setYoutubeViewers(count),
      onHealth: (health) => getBot()?.service.noteYoutubeReader(health.ok),
      onStatus: (youtube) => {
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
  }

  attachSender(sender: (event: AppEvent) => void): void {
    this.sender = sender;
  }

  setHooks(hooks: { alwaysOnTop?: (value: boolean) => void }): void {
    this.hooks = hooks;
  }

  async start(): Promise<void> {
    const settings = this.settings.load();
    const port = await this.server.start(settings.overlayPort);
    this.status = {
      ...this.status,
      overlay: { listening: true, host: this.server.host, port },
    };
    await startStages(this.stageContext());
    this.registerEmoteRoute();
    void this.emotes.loadGlobals();
    void this.badges.loadGlobal();
    this.irc.start();
    this.youtube.start();
    this.notices.start();
    this.armViewerPoll();
    void this.refreshViewers();
    this.publishYoutubeSend();
    await this.auth.restore();
    if (this.auth.state().loggedIn) {
      try {
        await this.refreshStream(true);
      } catch (err) {
        this.log.error("initial stream info failed", { message: redactError(err) });
      }
      this.armStreamPoll();
    }
    this.log.info(`${brand.slug} started`, {
      version: this.version,
      overlayPort: port,
      clientIdSet: settings.twitchClientId.length > 0,
    });
  }

  async stop(): Promise<void> {
    this.disarmStreamPoll();
    this.disarmViewerPoll();
    this.irc.stop();
    this.youtube.stop();
    this.notices.stop();
    this.emotes.stop();
    this.badges.stop();
    await stopStages(this.stageContext());
    await this.server.stop();
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

  async sendChat(text: string, destinations?: { twitch?: boolean; youtube?: boolean }): Promise<void> {
    const message = text.replace(/\r/g, "").trim();
    if (!message) throw new Error("Message is empty.");
    const twitch = destinations ? destinations.twitch === true : true;
    const youtube = destinations?.youtube === true;
    if (!twitch && !youtube) throw new Error("Pick Twitch or YouTube.");
    const youtubeLive = this.status.youtube.state === "live" && this.status.youtube.canSend === true && Boolean(this.status.youtube.videoId);
    const sendYoutube = youtube && youtubeLive;
    const sendTwitch = twitch && this.auth.state().loggedIn;
    if (!sendTwitch && !sendYoutube) return;
    if (sendTwitch && message.length > TWITCH_MESSAGE_MAX) throw new Error("Twitch messages stop at 500 characters.");
    if (sendYoutube && message.length > 200) throw new Error("YouTube live chat stops at 200 characters.");
    if (Date.now() - this.lastSend < 800) throw new Error("Wait a moment before sending another message.");
    if (sendTwitch) {
      const user = this.requireUser();
      const channel = this.settings.load().twitchChannel || user.login;
      const broadcasterId = user.login.toLowerCase() === channel ? user.userId : await this.helix.getUserId(channel);
      await this.helix.sendChat(broadcasterId, user.userId, message);
    }
    if (sendYoutube) {
      try {
        await this.youtubeSend.send(message, this.status.youtube.videoId);
      } catch (err) {
        const detail = err instanceof Error ? err.message : "YouTube did not accept that message.";
        if (/not live/i.test(detail)) return;
        if (sendTwitch) throw new Error(`Sent on Twitch. ${detail}`);
        throw err;
      }
    }
    this.lastSend = Date.now();
  }

  searchCategories(query: string): Promise<CategoryHit[]> {
    this.requireUser();
    return this.helix.searchCategories(query);
  }

  async updateStream(update: StreamUpdate): Promise<StreamInfo> {
    const user = this.requireUser();
    await this.helix.updateStream(user.userId, update);
    await this.refreshStream(false);
    if (!this.stream) throw new Error("Saved, but Twitch did not return the channel.");
    this.emit({ type: "toast", tone: "ok", text: "Stream info saved." });
    return this.stream;
  }

  async updateSettings(patch: SettingsPatch): Promise<Settings> {
    const prev = this.settings.load();
    const next = this.settings.update(patch);
    if (next.twitchClientId !== prev.twitchClientId) {
      this.auth.logout();
      this.forgetStream();
    }
    if (next.twitchChannel !== prev.twitchChannel) {
      this.applyTwitchChannel();
      if (loadBotLink(path.dirname(this.settings.file)).mode === "embedded") {
        const login = this.auth.state().loggedIn ? this.auth.state().login ?? "" : "";
        getBot()?.service.setIdentity({ channelLogin: next.twitchChannel || login });
      }
    }
    if (next.youtubeChannelId !== prev.youtubeChannelId) {
      this.youtube.setChannel(next.youtubeChannelId);
      if (loadBotLink(path.dirname(this.settings.file)).mode === "embedded") {
        getBot()?.service.setIdentity({ youtubeChannelId: next.youtubeChannelId });
      }
    }
    if (next.overlayPort !== prev.overlayPort) {
      const port = await this.server.start(next.overlayPort);
      this.status = { ...this.status, overlay: { listening: true, host: this.server.host, port } };
      this.emit({ type: "status", status: this.status });
      const redeems = getRedeemEngine()?.snapshot();
      if (redeems) this.emit({ type: "redeems", redeems });
    }
    if (next.alwaysOnTop !== prev.alwaysOnTop) this.hooks.alwaysOnTop?.(next.alwaysOnTop);
    this.emotes.setFlags(next.feed.emotes);
    if (!next.feed.modLog && prev.feed.modLog) {
      this.modLog.splice(0, this.modLog.length);
      this.emit({ type: "mod-log-clear" });
    }
    if (next.twitchChannel !== prev.twitchChannel) this.notices.retarget();
    this.emit({ type: "auth", auth: this.auth.state() });
    return this.settings.load();
  }

  async startLogin(): Promise<AuthState> {
    await this.auth.login();
    try {
      await this.refreshStream(true);
    } catch (err) {
      this.log.error("stream info after login failed", { message: redactError(err) });
    }
    this.armStreamPoll();
    return this.auth.state();
  }

  cancelLogin(): void {
    this.auth.cancel();
  }

  /** Saved channel wins. Otherwise follow the signed-in login, or nobody. */
  private applyTwitchChannel(): void {
    const configured = this.settings.load().twitchChannel;
    const login = this.auth.state().loggedIn ? this.auth.state().login ?? "" : "";
    this.irc.setChannel(configured || login);
    this.notices.retarget();
    void this.refreshViewers();
  }

  logout(): AuthState {
    this.auth.logout();
    this.forgetStream();
    return this.auth.state();
  }

  setAlwaysOnTop(value: boolean): void {
    this.settings.update({ alwaysOnTop: value });
    this.hooks.alwaysOnTop?.(value);
  }

  refreshRedeems(): Promise<RedeemSnapshot> {
    return this.engine().refresh();
  }

  saveRedeem(mapping: RedeemMapping): Promise<RedeemSnapshot> {
    return this.engine().saveMapping(mapping);
  }

  createReward(title: string, cost: number): Promise<RedeemSnapshot> {
    return this.engine().createReward(title, cost);
  }

  updateReward(rewardId: string, patch: { title?: string; cost?: number; enabled?: boolean }): Promise<RedeemSnapshot> {
    return this.engine().updateTwitchReward(rewardId, patch);
  }

  importFirebot(): Promise<RedeemSnapshot> {
    return this.engine().importFirebot();
  }

  testRedeem(rewardId: string, draft?: RedeemMapping): Promise<void> {
    return this.engine().test(rewardId, draft);
  }

  skipAlert(): RedeemSnapshot {
    return this.engine().skip();
  }

  clearAlerts(): RedeemSnapshot {
    return this.engine().clearQueue();
  }

  saveChatPreset(preset: unknown): ChatOverlayFile {
    return this.chat().savePreset(preset);
  }

  createChatPreset(name: string, basedOnId: string): ChatOverlayFile {
    return this.chat().createPreset(name, basedOnId);
  }

  deleteChatPreset(id: string): ChatOverlayFile {
    return this.chat().deletePreset(id);
  }

  ttsPanel(): Promise<TtsPanel> {
    return this.chat().panel();
  }

  ttsCommand(command: string, id?: string): Promise<TtsPanel> {
    return this.chat().command(command, id);
  }

  ttsInject(payload: unknown): Promise<TtsPanel> {
    return this.chat().inject(payload);
  }

  saveTtsSettings(patch: unknown): Promise<TtsPanel> {
    const row = patch && typeof patch === "object" ? (patch as { baseUrl?: unknown; shortcuts?: unknown }) : {};
    this.chat().saveTts({
      baseUrl: typeof row.baseUrl === "string" ? row.baseUrl : undefined,
      shortcuts: typeof row.shortcuts === "boolean" ? row.shortcuts : undefined,
    });
    return this.chat().panel();
  }

  botLink(): BotLinkView {
    return botLinkView(loadBotLink(path.dirname(this.settings.file)));
  }

  async saveBotLink(patch: unknown): Promise<BotLinkView> {
    const row = patch && typeof patch === "object" ? (patch as { mode?: unknown; serverUrl?: unknown; adminToken?: unknown }) : {};
    const mode = row.mode === "server" ? "server" : "embedded";
    const saved = saveBotLink(path.dirname(this.settings.file), {
      mode,
      serverUrl: typeof row.serverUrl === "string" ? row.serverUrl : "",
      adminToken: typeof row.adminToken === "string" ? row.adminToken : undefined,
    });
    if (saved.mode === "server") await stopEmbeddedBot();
    else await useEmbeddedBot();
    return botLinkView(saved);
  }

  youtubeDeskState(): YoutubeDeskState {
    return this.youtubeSend.state();
  }

  async youtubeConnect(): Promise<YoutubeDeskState> {
    await this.youtubeSend.connectDesk();
    this.publishYoutubeSend();
    return this.youtubeSend.state();
  }

  youtubeCancel(): YoutubeDeskState {
    this.youtubeSend.cancel();
    this.publishYoutubeSend();
    return this.youtubeSend.state();
  }

  youtubeLogout(): YoutubeDeskState {
    this.youtubeSend.logout();
    this.publishYoutubeSend();
    return this.youtubeSend.state();
  }

  botState(): Promise<BotSnapshot> {
    return this.botOps().state();
  }

  botLogin(): Promise<BotSnapshot> {
    return this.botOps().login();
  }

  botLogout(): Promise<BotSnapshot> {
    return this.botOps().logout();
  }

  botSaveCommand(input: unknown): Promise<BotSnapshot> {
    return this.botOps().saveCommand(input);
  }

  botDeleteCommand(id: string): Promise<BotSnapshot> {
    return this.botOps().deleteCommand(id);
  }

  botSaveTimer(input: unknown): Promise<BotSnapshot> {
    return this.botOps().saveTimer(input);
  }

  botDeleteTimer(id: string): Promise<BotSnapshot> {
    return this.botOps().deleteTimer(id);
  }

  botSaveFilters(input: unknown): Promise<BotSnapshot> {
    return this.botOps().saveFilters(input);
  }

  botSaveExtras(input: unknown): Promise<BotSnapshot> {
    return this.botOps().saveExtras(input);
  }

  botSaveHook(input: unknown): Promise<BotSnapshot> {
    return this.botOps().saveHook(input);
  }

  botDeleteHook(id: string): Promise<BotSnapshot> {
    return this.botOps().deleteHook(id);
  }

  botTestHook(id: string): Promise<{ ok: boolean; status: number; ms: number; detail: string }> {
    return this.botOps().testHook(id);
  }

  botImportSe(jwt = ""): Promise<BotSnapshot> {
    return this.botOps().importSe(jwt);
  }

  botImportJson(payload: unknown): Promise<BotSnapshot> {
    return this.botOps().importJson(payload);
  }

  botExport(): Promise<unknown> {
    return this.botOps().exportConfig();
  }

  botYoutubeLogin(): Promise<BotSnapshot> {
    return this.botOps().youtubeLogin();
  }

  botYoutubeLogout(): Promise<BotSnapshot> {
    return this.botOps().youtubeLogout();
  }

  botYoutubeCancel(): Promise<BotSnapshot> {
    return this.botOps().youtubeCancel();
  }

  botSaveAccounts(patch: unknown): Promise<BotSnapshot> {
    return this.botOps().saveAccounts(patch);
  }

  botSaveGoogleClient(patch: unknown): Promise<BotSnapshot> {
    return this.botOps().saveGoogleClient(patch);
  }

  private engine() {
    const engine = getRedeemEngine();
    if (!engine) throw new Error("Channel points are still starting.");
    return engine;
  }

  private chat() {
    const engine = getChatOverlay();
    if (!engine) throw new Error("Chat overlay is still starting.");
    return engine;
  }

  private botOps() {
    const link = loadBotLink(path.dirname(this.settings.file));
    if (link.mode === "server") {
      const remote = new RemoteBot(link.serverUrl, link.adminToken);
      return {
        state: () => remote.state(),
        login: () => remote.login(),
        logout: () => remote.logout(),
        saveCommand: (input: unknown) => remote.saveCommand(input),
        deleteCommand: (id: string) => remote.deleteCommand(id),
        saveTimer: (input: unknown) => remote.saveTimer(input),
        deleteTimer: (id: string) => remote.deleteTimer(id),
        saveFilters: (input: unknown) => remote.saveFilters(input),
        saveExtras: (input: unknown) => remote.saveExtras(input),
        saveHook: (input: unknown) => remote.saveHook(input),
        deleteHook: (id: string) => remote.deleteHook(id),
        testHook: (id: string) => remote.testHook(id),
        importSe: (jwt: string) => remote.importSe(jwt),
        importJson: (payload: unknown) => remote.importJson(payload),
        exportConfig: () => remote.exportConfig(),
        youtubeLogin: () => this.youtubeSend.loginForBot().then((tokens) => remote.importYoutubeTokens(tokens)),
        youtubeLogout: () => remote.youtubeLogout(),
        youtubeCancel: () => remote.youtubeCancel(),
        saveAccounts: (patch: unknown) => remote.saveAccounts(patch),
        saveGoogleClient: (patch: unknown) => remote.saveGoogleClient(patch),
      };
    }
    const bot = getBot();
    if (!bot) throw new Error("The local bot is not running. Switch back to embedded mode.");
    const snap = () => bot.snapshot();
    return {
      state: async () => snap(),
      login: async () => {
        await bot.service.startLogin();
        return snap();
      },
      logout: async () => {
        bot.service.logout();
        return snap();
      },
      saveCommand: async (input: unknown) => {
        bot.service.saveCommand(input);
        return snap();
      },
      deleteCommand: async (id: string) => {
        bot.service.deleteCommand(id);
        return snap();
      },
      saveTimer: async (input: unknown) => {
        bot.service.saveTimer(input);
        return snap();
      },
      deleteTimer: async (id: string) => {
        bot.service.deleteTimer(id);
        return snap();
      },
      saveFilters: async (input: unknown) => {
        bot.service.saveFilters(input);
        return snap();
      },
      saveExtras: async (input: unknown) => {
        bot.service.saveExtras(input);
        return snap();
      },
      saveHook: async (input: unknown) => {
        bot.service.saveHook(input);
        return snap();
      },
      deleteHook: async (id: string) => {
        bot.service.deleteHook(id);
        return snap();
      },
      testHook: async (id: string) => bot.service.testHook(id),
      importSe: async (jwt: string) => {
        await bot.service.importSe(jwt);
        return snap();
      },
      importJson: async (payload: unknown) => {
        bot.service.importJson(payload);
        return snap();
      },
      exportConfig: async () => bot.service.exportConfig(),
      youtubeLogin: async () => {
        await bot.service.startYoutubeLogin();
        return snap();
      },
      youtubeLogout: async () => {
        bot.service.logoutYoutube();
        return snap();
      },
      youtubeCancel: async () => {
        bot.service.cancelYoutubeLogin();
        return snap();
      },
      saveAccounts: async (patch: unknown) => {
        const row = patch && typeof patch === "object" ? (patch as { twitch?: unknown; youtube?: unknown }) : {};
        bot.service.setAccounts(row);
        return snap();
      },
      saveGoogleClient: async (patch: unknown) => {
        bot.service.saveGoogleClient(patch);
        return snap();
      },
    };
  }

  private publishYoutubeSend(): void {
    const desk = this.youtubeSend.state();
    const ready = this.youtubeSend.sendReadiness();
    this.status = {
      ...this.status,
      youtube: { ...this.status.youtube, canSend: ready.canSend, sendAccount: desk.account, sendHint: ready.hint },
    };
    this.emit({ type: "status", status: this.status });
  }

  private emptyRedeems(): RedeemSnapshot {
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

  private stageContext() {
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

  private requireUser(): { login: string; userId: string } {
    const state = this.auth.state();
    if (!state.loggedIn || !state.login || !state.userId) throw new Error("Log in with Twitch first.");
    return { login: state.login, userId: state.userId };
  }

  private async refreshStream(quiet: boolean): Promise<void> {
    const state = this.auth.state();
    if (!state.loggedIn || !state.userId) return;
    try {
      this.stream = await this.helix.getStreamInfo(state.userId);
      this.emit({ type: "stream", stream: this.stream });
    } catch (err) {
      this.log.error("stream info failed", { message: redactError(err) });
      if (!quiet) throw err;
    }
  }

  private armStreamPoll(): void {
    if (this.streamTimer) return;
    this.streamTimer = setInterval(() => {
      void this.refreshStream(true);
    }, 60_000);
  }

  private disarmStreamPoll(): void {
    if (!this.streamTimer) return;
    clearInterval(this.streamTimer);
    this.streamTimer = null;
  }

  private acceptChat(message: ChatMessage): void {
    const feed = this.settings.load().feed;
    if (message.noticeKind && !noticeEnabled(feed, message.noticeKind)) return;
    const placed = placeNotice(this.bus.messages, message);
    if (placed.action === "drop") return;
    for (const segment of placed.message.segments) {
      if (segment.type === "emote") this.emoteImages.prefetch(segment.url);
    }
    if (placed.action === "replace") {
      this.bus.replace(placed.id, placed.message);
      return;
    }
    this.maybeAlert(placed.message);
    if (placed.message.noticeKind) {
      getBot()?.service.noteNotice({
        platform: placed.message.platform,
        kind: placed.message.noticeKind,
        user: placed.message.displayName || placed.message.username,
        amount: placed.message.amount,
        text: placed.message.plainText,
      });
    }
    const key = noticeDedupeKey(placed.message);
    if (key) {
      this.noticeKeys.add(key);
      if (this.noticeKeys.size > 500) {
        const first = this.noticeKeys.values().next().value;
        if (first) this.noticeKeys.delete(first);
      }
    }
    this.bus.push(placed.message);
  }

  private maybeAlert(message: ChatMessage): void {
    const settings = this.settings.load().chatAlert;
    const now = Date.now();
    const decision = shouldPlayChatAlert({
      settings,
      message: {
        platform: message.platform,
        username: message.username,
        displayName: message.displayName,
        authorId: message.authorId,
        kind: message.kind,
        noticeKind: message.noticeKind,
        timestamp: message.timestamp,
      },
      identity: this.alertIdentity(),
      now,
      lastPlayedAt: this.lastAlertAt,
      duplicate: false,
    });
    if (!decision.play) return;
    this.lastAlertAt = now;
    this.emit({ type: "chat-alert" });
  }

  private alertIdentity(): AlertIdentity {
    const selfNames: string[] = [];
    const selfIds: string[] = [];
    const botNames: string[] = [];
    const botIds: string[] = [];
    const add = (bucket: string[], value?: string | null) => {
      if (value && value.trim()) bucket.push(value.trim());
    };
    const auth = this.auth.state();
    add(selfNames, auth.login);
    add(selfIds, auth.userId);
    const desk = this.youtubeSend.state();
    add(selfNames, desk.account);
    add(selfIds, desk.channelId);
    add(selfIds, this.settings.load().youtubeChannelId);
    const posters = getBot()?.service.alertPosters();
    if (posters) {
      selfNames.push(...posters.selfNames);
      selfIds.push(...posters.selfIds);
      botNames.push(...posters.botNames);
      botIds.push(...posters.botIds);
    }
    return { selfNames, selfIds, botNames, botIds };
  }

  private async loadTwitchEmotes(broadcasterId: string): Promise<void> {
    if (!this.auth.state().loggedIn) return;
    try {
      this.emotes.setTwitch(indexChannelEmotes(await this.helix.getChannelEmotes(broadcasterId)));
    } catch (err) {
      this.log.error("channel emotes failed", { message: redactError(err) });
    }
  }

  private pushMod(action: ModAction): void {
    if (!this.settings.load().feed.modLog) return;
    if (this.modLog.some((item) => item.id === action.id)) return;
    this.modLog.push(action);
    if (this.modLog.length > 300) this.modLog.splice(0, this.modLog.length - 300);
    this.emit({ type: "mod-log", action });
  }

  private noteScope(text: string): void {
    if (this.scopeNoted) return;
    this.scopeNoted = true;
    this.emit({ type: "toast", tone: "error", text });
  }

  private chatChannel(): string {
    const configured = this.settings.load().twitchChannel;
    const login = this.auth.state().loggedIn ? this.auth.state().login ?? "" : "";
    return (configured || login).toLowerCase();
  }

  private async refreshViewers(): Promise<void> {
    if (!this.auth.state().loggedIn) {
      this.setTwitchViewers(null);
      return;
    }
    const channel = this.chatChannel();
    if (!channel) {
      this.setTwitchViewers(null);
      return;
    }
    try {
      this.setTwitchViewers(await this.helix.getViewerCount(channel));
    } catch (err) {
      this.log.error("viewer count failed", { message: redactError(err) });
    }
  }

  private setTwitchViewers(count: number | null): void {
    if (this.status.twitch.viewers === count) return;
    this.status = { ...this.status, twitch: { ...this.status.twitch, viewers: count } };
    this.emit({ type: "status", status: this.status });
  }

  private setYoutubeViewers(count: number | null): void {
    if (this.status.youtube.viewers === count) return;
    this.status = { ...this.status, youtube: { ...this.status.youtube, viewers: count } };
    this.emit({ type: "status", status: this.status });
  }

  private armViewerPoll(): void {
    if (this.viewerTimer) return;
    this.viewerTimer = setInterval(() => {
      void this.refreshViewers();
    }, 60_000);
  }

  private disarmViewerPoll(): void {
    if (!this.viewerTimer) return;
    clearInterval(this.viewerTimer);
    this.viewerTimer = null;
  }

  private registerEmoteRoute(): void {
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

  private forgetStream(): void {
    this.disarmStreamPoll();
    this.stream = null;
    this.emit({ type: "stream", stream: null });
  }

  private emit(event: WithoutSeq<AppEvent>): void {
    this.seq += 1;
    this.sender?.({ ...event, seq: this.seq } as AppEvent);
  }
}
