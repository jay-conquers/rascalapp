import path from "node:path";
import { brand } from "../shared/brand";
import { TWITCH_MESSAGE_MAX } from "../shared/defaults";
import { redactError } from "../shared/redact";
import type { SettingsPatch } from "../shared/api";
import type { RedeemMapping } from "../shared/redeems";
import type {
  AppEvent,
  AppSnapshot,
  ChatBadge,
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
import { TwitchAuth } from "./twitch/oauth";
import { YoutubeLive } from "./youtube/live";

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
  private readonly badges: BadgeCatalog;
  private readonly irc: TwitchIrc;
  private readonly youtube: YoutubeLive;
  private seq = 0;
  private stream: StreamInfo | null = null;
  private streamTimer: NodeJS.Timeout | null = null;
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
    this.version = deps.version ?? "0.5.0";
    this.log = new Logger(path.join(deps.dir, "logs", brand.logFile));
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
        if (this.auth.state().loggedIn) void this.badges.loadGlobal();
      },
    });
    this.helix = new Helix({
      clientId: () => this.settings.load().twitchClientId,
      getToken: () => this.auth.ensureFresh(),
      refresh: () => this.auth.forceRefresh(),
      fetchImpl: deps.fetchImpl,
    });
    this.emotes = new EmoteCatalog({ log: this.log, fetchImpl: deps.fetchImpl });
    this.badges = new BadgeCatalog({
      log: this.log,
      loadGlobal: () => this.helix.getGlobalBadges(),
      loadChannel: (broadcasterId) => this.helix.getChannelBadges(broadcasterId),
      onUpdate: () => getChatOverlay()?.refresh(),
    });
    this.irc = new TwitchIrc({
      channel: settings.twitchChannel,
      emotes: () => this.emotes.map,
      onMessage: (message) => this.bus.push(message),
      onDelete: (id) => this.bus.delete(id),
      onClearUser: (username) => this.bus.clearUser("twitch", username),
      onClearAll: () => this.bus.clearPlatform("twitch"),
      onRoomId: (roomId) => {
        void this.emotes.loadChannel(roomId);
        void this.badges.loadChannel(roomId);
      },
      onStatus: (state, detail) => {
        this.status = { ...this.status, twitch: { state, detail } };
        this.emit({ type: "status", status: this.status });
      },
      log: this.log,
    });
    this.youtube = new YoutubeLive({
      channelId: settings.youtubeChannelId,
      onMessage: (message) => this.bus.push(message),
      onDelete: (id) => this.bus.delete(id),
      onDeleteAuthor: (authorId) => this.bus.clearAuthor(authorId),
      onStatus: (youtube) => {
        this.status = { ...this.status, youtube };
        this.emit({ type: "status", status: this.status });
      },
      log: this.log,
      fetchImpl: deps.fetchImpl,
    });
    this.bus.setHandlers({
      onMessage: (message) => {
        this.emit({ type: "chat", message });
        this.server.broadcast({ type: "chat", message });
      },
      onDelete: (id) => {
        this.emit({ type: "chat-delete", id });
        this.server.broadcast({ type: "chat-delete", id });
      },
      onClear: (platform, username) => {
        this.emit({ type: "chat-clear", platform, username });
        this.server.broadcast({ type: "chat-clear", platform, username });
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
    void this.emotes.loadGlobals();
    void this.badges.loadGlobal();
    this.irc.start();
    this.youtube.start();
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
    this.irc.stop();
    this.youtube.stop();
    this.emotes.stop();
    this.badges.stop();
    await stopStages(this.stageContext());
    await this.server.stop();
  }

  snapshot(): AppSnapshot {
    return {
      seq: this.seq,
      messages: this.bus.messages.map((message) => ({ ...message })),
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

  async sendChat(text: string): Promise<void> {
    const message = text.replace(/\r/g, "").trim();
    if (!message) throw new Error("Message is empty.");
    if (message.length > TWITCH_MESSAGE_MAX) throw new Error("Twitch messages stop at 500 characters.");
    if (Date.now() - this.lastSend < 800) throw new Error("Wait a moment before sending another message.");
    const user = this.requireUser();
    const channel = this.settings.load().twitchChannel || user.login;
    const broadcasterId =
      user.login.toLowerCase() === channel ? user.userId : await this.helix.getUserId(channel);
    await this.helix.sendChat(broadcasterId, user.userId, message);
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
    if (next.youtubeChannelId !== prev.youtubeChannelId) this.youtube.setChannel(next.youtubeChannelId);
    if (next.overlayPort !== prev.overlayPort) {
      const port = await this.server.start(next.overlayPort);
      this.status = { ...this.status, overlay: { listening: true, host: this.server.host, port } };
      this.emit({ type: "status", status: this.status });
      const redeems = getRedeemEngine()?.snapshot();
      if (redeems) this.emit({ type: "redeems", redeems });
    }
    if (next.alwaysOnTop !== prev.alwaysOnTop) this.hooks.alwaysOnTop?.(next.alwaysOnTop);
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

  botImportSe(jwt: string): Promise<BotSnapshot> {
    return this.botOps().importSe(jwt);
  }

  botImportJson(payload: unknown): Promise<BotSnapshot> {
    return this.botOps().importJson(payload);
  }

  botExport(): Promise<unknown> {
    return this.botOps().exportConfig();
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
        importSe: (jwt: string) => remote.importSe(jwt),
        importJson: (payload: unknown) => remote.importJson(payload),
        exportConfig: () => remote.exportConfig(),
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
      importSe: async (jwt: string) => {
        await bot.service.importSe(jwt);
        return snap();
      },
      importJson: async (payload: unknown) => {
        bot.service.importJson(payload);
        return snap();
      },
      exportConfig: async () => bot.service.exportConfig(),
    };
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
