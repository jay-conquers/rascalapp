import { brand, readBrandEnv } from "../../../src/shared/brand.ts";
import { PlatformRegistry } from "../../../src/shared/platform/registry.ts";
import { targetsPlatform } from "../../../src/shared/platform/target.ts";
import type { ChatPlatform, NormalizedChatMessage } from "../../../src/shared/platform/types.ts";
import { YoutubeDataApi } from "../../../src/shared/platform/youtube-api.ts";
import {
  createYoutubeAuthRequest,
  exchangeYoutubeCode,
  refreshYoutubeAccessToken,
  youtubeRedirectUri,
  type YoutubeAuthRequest,
  type YoutubeOAuthClient,
} from "../../../src/shared/platform/youtube-oauth.ts";
import type { QuotaSnapshot } from "../../../src/shared/platform/youtube-quota.ts";
import type { PlatformCapabilities } from "../../../src/shared/platform/types.ts";
import { detectLive } from "../../../src/main/youtube/live.ts";
import {
  activePhase,
  advanceTimer,
  countTimerLine,
  decideChat,
  emptyMemory,
  expandTemplate,
  normalizeBotFile,
  normalizeShoutout,
  portalBase,
  normalizeCommand,
  normalizeFilters,
  normalizeTimer,
  timerIsDue,
  timerMessage,
  type BotAccountMode,
  type BotCommand,
  type BotDecision,
  type BotFile,
  type BotFilters,
  type BotTimer,
  type ChannelFacts,
  type ChatLine,
  type ModLogEntry,
  type TimerPhase,
} from "./model.ts";
import { TwitchChatPlatform } from "./platform/twitch-adapter.ts";
import { YoutubeChatPlatform } from "./platform/youtube-adapter.ts";
import { accountAgeLine, followageLine } from "./duration.ts";
import { importQuoteList, normalizeQuotes } from "./quotes.ts";
import { buildHookPayload, consumeOutgoing, decideChatHook, normalizeHook, normalizeHooks, noteOutgoing, redactHookUrl, sampleHookPayload, type SentLine } from "./chat-hook.ts";
import { callChatHook } from "./chat-hook-send.ts";
import { channelIdFromJwt, importStreamElements } from "./se.ts";
import { flushGiftHold, normalizeThanks, planThankYou, thankKind, type GiftHold } from "./thanks.ts";
import { BotStore, readYoutubeTokens, type BotTokens, type YoutubeBotTokens } from "./store.ts";
import { age, HelixBot, pollDevice, startDevice, type DevicePrompt } from "./twitch.ts";
import { waitForYoutubeCallback } from "./youtube-login.ts";

export interface BotLoginPrompt {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}

export interface PlatformSection {
  id: string;
  label: string;
  connected: boolean;
  status: string;
  account: string | null;
  accountMode: BotAccountMode;
  separateAccount: string | null;
  capabilities: PlatformCapabilities;
  quota: QuotaSnapshot | null;
}

export interface BotSnapshot {
  connected: boolean;
  status: string;
  botLogin: string | null;
  channelLogin: string;
  broadcasterId: string;
  portalUrl: string;
  redirectUri: string;
  login: BotLoginPrompt | null;
  commands: BotCommand[];
  timers: BotTimer[];
  filters: BotFilters;
  quotes: BotFile["quotes"];
  thanks: BotFile["thanks"];
  shoutout: BotFile["shoutout"];
  hooks: BotFile["hooks"];
  log: ModLogEntry[];
  seJwtSet: boolean;
  /** Present so a later build can forward Ask Jeeves lines. Unused in 0.4.0. */
  askJeevesHook: boolean;
  platforms: PlatformSection[];
  youtubeLogin: BotLoginPrompt | null;
  youtubeRedirectUri: string;
  googleClientId: string;
  googleClientSecretSet: boolean;
  googleClientFromEnv: boolean;
  youtubeApiPoll: boolean;
}

export interface AskJeevesHook {
  (line: { user: string; text: string; platform: "twitch" }): void;
}

export interface ChannelTokenBridge {
  loadTwitch(): BotTokens | null;
  saveTwitch(tokens: BotTokens): void;
  loadYoutube(): YoutubeBotTokens | null;
  saveYoutube(tokens: YoutubeBotTokens): void;
}

const EMPTY_FACTS: ChannelFacts = { title: "", game: "", uptime: "offline", followage: "" };
const CHATTER_MS = 10 * 60_000;
const BOT_NAMES = new Set([
  "streamelements",
  "nightbot",
  "fossabot",
  "moobot",
  "streamlabs",
  "soundalerts",
  "wizebot",
  "sery_bot",
  "commanderroot",
  "botisimo",
  "streamholics",
  "kofistreambot",
  "rainmaker",
  "tangia",
  "own3d",
]);

export class BotService {
  private file: BotFile;
  private tokens: BotTokens | null;
  private youtubeTokens: YoutubeBotTokens | null;
  private secrets: { apiKey: string; sessionSecret: string; seJwt: string };
  private memory = emptyMemory();
  private log: ModLogEntry[] = [];
  private prompt: DevicePrompt | null = null;
  private youtubePrompt: YoutubeAuthRequest | null = null;
  private loginAbort: AbortController | null = null;
  private youtubeLoginAbort: AbortController | null = null;
  private statusOverride: string | null = null;
  private youtubeNote = "";
  private stopped = false;
  private facts: ChannelFacts = { ...EMPTY_FACTS };
  private streamLiveAt = 0;
  private followCache = new Map<string, { at: number; text: string }>();
  private recentChatters = new Map<string, { name: string; at: number }>();
  private seenHookIds = new Set<string>();
  private outgoing: SentLine[] = [];
  private giftHold: GiftHold | null = null;
  private giftTimer: ReturnType<typeof setTimeout> | null = null;
  private askJeeves: AskJeevesHook | null = null;
  private bridge: ChannelTokenBridge | null = null;
  private readonly helix: HelixBot;
  private readonly twitch: TwitchChatPlatform;
  private readonly youtube: YoutubeChatPlatform;
  private readonly registry = new PlatformRegistry();

  constructor(
    private readonly store: BotStore,
    private readonly deps: {
      clientId: () => string;
      fetchImpl?: typeof fetch;
      log: (level: "info" | "error", message: string, extra?: Record<string, string>) => void;
      onAccountsChanged?: () => void;
      /** Embedded desk already reads YouTube. Headless mode reads for itself. */
      youtubeReader?: "external" | "own";
    },
  ) {
    this.file = store.loadConfig();
    this.tokens = store.loadTokens();
    this.youtubeTokens = store.loadYoutubeTokens();
    this.secrets = store.loadSecrets();
    const fetchImpl = deps.fetchImpl ?? fetch;
    this.helix = new HelixBot(() => this.deps.clientId(), () => this.accessToken(), fetchImpl);
    this.twitch = new TwitchChatPlatform({
      helix: this.helix,
      clientId: () => this.deps.clientId(),
      accessToken: () => this.accessToken(),
      broadcasterId: () => this.file.broadcasterId,
      botUserId: () => this.activeTwitch()?.userId ?? "",
      botLogin: () => this.activeTwitch()?.login ?? "",
      fetchImpl,
      log: (level, message, extra) => this.deps.log(level, message, extra),
      onBroadcasterId: (id) => {
        if (this.file.broadcasterId || !id) return;
        this.file.broadcasterId = id;
        this.file = this.store.saveConfig(this.file);
      },
    });
    this.youtube = new YoutubeChatPlatform({
      accessToken: () => this.youtubeAccessToken(),
      channelId: () => this.file.youtubeChannelId,
      hasToken: () => this.youtubeSession() !== null,
      fetchImpl,
      discoverVideo: async (channelId, signal) => {
        const live = await detectLive(channelId, fetchImpl, signal);
        return live ? { videoId: live.videoId, title: live.title } : null;
      },
      log: (level, message, extra) => this.deps.log(level, message, extra),
      ownReader: this.deps.youtubeReader !== "external",
      optIn: () => this.file.youtubeApiPoll,
    });
    this.registry.register(this.twitch);
    this.registry.register(this.youtube);
    this.twitch.onMessage((message) => {
      void this.onPlatformMessage(message);
    });
    this.youtube.onMessage((message) => {
      void this.onPlatformMessage(message);
    });
  }

  /** The desk passes its live token store so a "post as my channel" choice shares that login. */
  setChannelTokenBridge(bridge: ChannelTokenBridge | null): void {
    this.bridge = bridge;
  }

  /** Later integration point for the separate tts-queue Ask Jeeves feature. */
  setAskJeeves(hook: AskJeevesHook | null): void {
    this.askJeeves = hook;
  }

  apiKey(): string {
    return this.secrets.apiKey;
  }

  sessionSecret(): string {
    return this.secrets.sessionSecret;
  }

  exportConfig(): Record<string, unknown> {
    return {
      exportedAt: new Date().toISOString(),
      channelLogin: this.file.channelLogin,
      broadcasterId: this.file.broadcasterId,
      youtubeChannelId: this.file.youtubeChannelId,
      accounts: this.file.accounts,
      commands: this.file.commands,
      timers: this.file.timers,
      filters: this.file.filters,
      quotes: this.file.quotes,
      thanks: this.file.thanks,
      shoutout: this.file.shoutout,
      hooks: this.file.hooks,
    };
  }

  importConfig(payload: unknown): void {
    const row = asRecord(payload) ?? {};
    const commands = Array.isArray(row.commands) ? row.commands.map(normalizeCommand).filter((item): item is BotCommand => item !== null) : this.file.commands;
    const timers = Array.isArray(row.timers) ? row.timers.map(normalizeTimer).filter((item): item is BotTimer => item !== null) : this.file.timers;
    const filters = row.filters ? normalizeFilters(row.filters) : this.file.filters;
    const channelLogin = typeof row.channelLogin === "string" ? row.channelLogin : this.file.channelLogin;
    const broadcasterId = typeof row.broadcasterId === "string" ? row.broadcasterId : this.file.broadcasterId;
    const quotes = Array.isArray(row.quotes) ? (row.replaceQuotes === true ? normalizeQuotes(row.quotes) : importQuoteList(row.quotes, this.file.quotes)) : this.file.quotes;
    const thanks = row.thanks ? normalizeThanks(row.thanks) : this.file.thanks;
    const shoutout = row.shoutout ? normalizeShoutout(row.shoutout) : this.file.shoutout;
    const hooks = Array.isArray(row.hooks) ? normalizeHooks(row.hooks) : this.file.hooks;
    this.file = this.store.saveConfig({ ...this.file, commands, timers, filters, channelLogin, broadcasterId, quotes, thanks, shoutout, hooks });
  }

  importTokens(payload: unknown): void {
    const row = asRecord(payload) ?? {};
    if (typeof row.accessToken !== "string" || typeof row.refreshToken !== "string" || typeof row.userId !== "string" || typeof row.login !== "string") {
      throw new Error("That token file is missing the bot session.");
    }
    this.tokens = {
      clientId: typeof row.clientId === "string" ? row.clientId : this.deps.clientId(),
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      expiresAt: typeof row.expiresAt === "number" ? row.expiresAt : Date.now() + 3600_000,
      scopes: Array.isArray(row.scopes) ? row.scopes.filter((item): item is string => typeof item === "string") : [],
      userId: row.userId,
      login: row.login,
    };
    this.store.saveTokens(this.tokens);
    void this.connect();
  }

  importYoutubeTokens(payload: unknown): void {
    const tokens = readYoutubeTokens(payload);
    if (!tokens) throw new Error("That token file is missing the YouTube session.");
    this.youtubeTokens = tokens;
    this.store.saveYoutubeTokens(tokens);
    this.deps.onAccountsChanged?.();
    void this.reconnectYoutube();
  }

  snapshot(portalPort: number): BotSnapshot {
    const base = portalBase(this.file.publicUrl, portalPort);
    const client = this.google();
    const twitchLive = this.twitch.liveStatus();
    const active = this.activeTwitch();
    return {
      connected: Boolean(active && twitchLive.connected),
      status: this.statusOverride ?? twitchLive.detail,
      botLogin: active?.login ?? null,
      channelLogin: this.file.channelLogin,
      broadcasterId: this.file.broadcasterId,
      portalUrl: `${base}/portal`,
      redirectUri: `${base}/portal/callback`,
      login: this.prompt
        ? { userCode: this.prompt.userCode, verificationUri: this.prompt.verificationUri, expiresAt: this.prompt.expiresAt }
        : null,
      commands: this.file.commands,
      timers: this.file.timers,
      filters: this.file.filters,
      quotes: this.file.quotes,
      thanks: this.file.thanks,
      shoutout: this.file.shoutout,
      hooks: this.file.hooks.map((hook) => ({ ...hook, secret: "", secretSet: hook.secret.length > 0 })),
      log: this.log.slice(-80),
      seJwtSet: this.secrets.seJwt.length > 0,
      askJeevesHook: this.askJeeves !== null,
      platforms: this.platformSections(),
      youtubeLogin: this.youtubePrompt
        ? { userCode: "", verificationUri: this.youtubePrompt.url, expiresAt: this.youtubePrompt.expiresAt }
        : null,
      youtubeRedirectUri: youtubeRedirectUri(),
      googleClientId: client.clientId,
      googleClientSecretSet: client.clientSecret.length > 0,
      googleClientFromEnv: Boolean(readBrandEnv("GOOGLE_CLIENT_ID")),
      youtubeApiPoll: this.file.youtubeApiPoll,
    };
  }

  /** Names and ids Rascal posts as, so a message chime can ignore them. */
  alertPosters(): { selfNames: string[]; selfIds: string[]; botNames: string[]; botIds: string[] } {
    const selfNames: string[] = [];
    const selfIds: string[] = [];
    const botNames: string[] = [];
    const botIds: string[] = [];
    if (this.file.channelLogin) selfNames.push(this.file.channelLogin);
    if (this.file.broadcasterId) selfIds.push(this.file.broadcasterId);
    if (this.file.youtubeChannelId) selfIds.push(this.file.youtubeChannelId);
    const posting = this.activeTwitch();
    if (this.file.accounts.twitch === "bot" && posting) {
      botNames.push(posting.login);
      botIds.push(posting.userId);
    } else if (this.tokens) {
      botNames.push(this.tokens.login);
      botIds.push(this.tokens.userId);
    }
    const youtube = this.file.accounts.youtube === "bot" ? this.youtubeSession() : this.youtubeTokens;
    if (youtube) {
      if (youtube.title) botNames.push(youtube.title);
      botIds.push(youtube.channelId);
    }
    return { selfNames, selfIds, botNames, botIds };
  }

  setIdentity(patch: { channelLogin?: string; broadcasterId?: string; publicUrl?: string; youtubeChannelId?: string }): void {
    const previousChannel = this.file.youtubeChannelId;
    if (typeof patch.channelLogin === "string") this.file.channelLogin = patch.channelLogin.trim().replace(/^#/, "").toLowerCase();
    if (typeof patch.broadcasterId === "string" && /^\d*$/.test(patch.broadcasterId)) this.file.broadcasterId = patch.broadcasterId;
    if (typeof patch.publicUrl === "string") this.file.publicUrl = patch.publicUrl.trim().replace(/\/$/, "").slice(0, 200);
    if (typeof patch.youtubeChannelId === "string") {
      const value = patch.youtubeChannelId.trim();
      this.file.youtubeChannelId = /^UC[\w-]{22}$/.test(value) || value === "" ? value : this.file.youtubeChannelId;
    }
    this.file = this.store.saveConfig(this.file);
    if (this.activeTwitch()) void this.connect();
    if (previousChannel !== this.file.youtubeChannelId) void this.reconnectYoutube();
  }

  setAccounts(patch: { twitch?: unknown; youtube?: unknown; youtubeApiPoll?: unknown }): void {
    const twitch = patch.twitch === "channel" ? "channel" : patch.twitch === "bot" ? "bot" : this.file.accounts.twitch;
    const youtube = patch.youtube === "channel" ? "channel" : patch.youtube === "bot" ? "bot" : this.file.accounts.youtube;
    const youtubeApiPoll = typeof patch.youtubeApiPoll === "boolean" ? patch.youtubeApiPoll : this.file.youtubeApiPoll;
    this.file = this.store.saveConfig({ ...this.file, accounts: { twitch, youtube }, youtubeApiPoll });
    this.youtube.setOptIn(youtubeApiPoll);
    this.statusOverride = null;
    if (patch.twitch !== undefined) void this.connect();
    if (patch.youtube !== undefined) void this.reconnectYoutube();
  }

  ingestYoutube(message: NormalizedChatMessage): void {
    this.youtube.ingest(message);
  }

  noteYoutubeReader(ok: boolean): void {
    this.youtube.noteReader(ok);
  }

  setYoutubeLive(input: { live: boolean; known?: boolean; title?: string; videoId?: string }): void {
    this.youtube.setLive(input);
  }

  saveGoogleClient(input: unknown): void {
    const row = asRecord(input) ?? {};
    const current = this.store.loadGoogleClient();
    const clientId = typeof row.clientId === "string" ? row.clientId.trim() : current.clientId;
    const clientSecret = typeof row.clientSecret === "string" ? row.clientSecret : "";
    if (!clientId) throw new Error("Add a Google client ID.");
    this.store.saveGoogleClient({ clientId, clientSecret });
  }

  async startLogin(): Promise<void> {
    if (this.loginAbort) return;
    const clientId = this.deps.clientId();
    if (!clientId) throw new Error(`Add the Twitch client ID in ${brand.displayName} settings first.`);
    const fetchImpl = this.fetchImpl();
    this.prompt = await startDevice(clientId, fetchImpl);
    this.statusOverride = "Waiting for the bot account to approve the code.";
    const controller = new AbortController();
    this.loginAbort = controller;
    void this.finishLogin(clientId, controller);
  }

  cancelLogin(): void {
    this.loginAbort?.abort();
    this.loginAbort = null;
    this.prompt = null;
  }

  logout(): void {
    this.cancelLogin();
    this.tokens = null;
    this.store.clearTokens();
    this.statusOverride = "Bot logged out.";
    if (this.file.accounts.twitch === "channel" && this.activeTwitch()) {
      this.statusOverride = null;
      void this.connect();
    } else {
      void this.twitch.disconnect();
    }
    this.deps.log("info", "bot logged out");
  }

  async startYoutubeLogin(): Promise<void> {
    if (this.youtubeLoginAbort) return;
    const client = this.google();
    const request = createYoutubeAuthRequest(client);
    this.youtubePrompt = request;
    this.youtubeNote = "Waiting for Google to approve YouTube.";
    const controller = new AbortController();
    this.youtubeLoginAbort = controller;
    void this.finishYoutubeLogin(client, request, controller);
  }

  cancelYoutubeLogin(): void {
    this.youtubeLoginAbort?.abort();
    this.youtubeLoginAbort = null;
    this.youtubePrompt = null;
  }

  logoutYoutube(): void {
    this.cancelYoutubeLogin();
    this.youtubeTokens = null;
    this.store.clearYoutubeTokens();
    this.youtubeNote = "YouTube bot logged out.";
    void this.reconnectYoutube();
    this.deps.onAccountsChanged?.();
    this.deps.log("info", "youtube bot logged out");
  }

  saveCommand(input: unknown): void {
    const command = normalizeCommand(input);
    if (!command) throw new Error("That command needs a name and a response.");
    const index = this.file.commands.findIndex((item) => item.id === command.id || item.name === command.name);
    const commands = [...this.file.commands];
    const row = asRecord(input);
    if (index >= 0) {
      const previous = commands[index];
      commands[index] = {
        ...command,
        id: previous?.id ?? command.id,
        aliases: command.aliases.length > 0 ? command.aliases : previous?.aliases ?? [],
        keywords: Array.isArray(row?.keywords) ? command.keywords ?? [] : previous?.keywords ?? command.keywords ?? [],
        count: previous?.count ?? command.count,
        platforms: row && "platforms" in row ? command.platforms : previous?.platforms ?? command.platforms,
      };
    } else commands.push(command);
    this.file = this.store.saveConfig({ ...this.file, commands });
  }

  deleteCommand(id: string): void {
    this.file = this.store.saveConfig({ ...this.file, commands: this.file.commands.filter((item) => item.id !== id) });
  }

  saveHook(input: unknown): void {
    const hook = normalizeHook(input);
    if (!hook) throw new Error("A hook needs a name, a command such as !ask, and an https address. http is only allowed for localhost.");
    const row = asRecord(input);
    const index = this.file.hooks.findIndex((item) => item.id === hook.id || item.name.toLowerCase() === hook.name.toLowerCase());
    const hooks = [...this.file.hooks];
    if (index >= 0) {
      const previous = hooks[index];
      const clearSecret = row?.clearSecret === true;
      hooks[index] = {
        ...hook,
        id: previous?.id ?? hook.id,
        secret: clearSecret ? "" : hook.secret || previous?.secret || "",
        keywords: Array.isArray(row?.keywords) ? hook.keywords : previous?.keywords ?? hook.keywords,
      };
    } else hooks.push(hook);
    this.file = this.store.saveConfig({ ...this.file, hooks: hooks.slice(0, 20) });
  }

  deleteHook(id: string): void {
    this.file = this.store.saveConfig({ ...this.file, hooks: this.file.hooks.filter((item) => item.id !== id) });
  }

  async testHook(id: string): Promise<{ ok: boolean; status: number; ms: number; detail: string }> {
    const hook = this.file.hooks.find((item) => item.id === id);
    if (!hook) throw new Error("That hook is not saved.");
    const started = Date.now();
    try {
      const result = await callChatHook(hook, sampleHookPayload(hook), this.fetchImpl());
      const detail = result.reply ? result.reply.slice(0, 120) : "No chat reply.";
      this.pushLog({ t: Date.now(), action: "hook", user: "", text: `${hook.name} test HTTP ${result.status} ${result.ms}ms`, by: "bot" });
      return { ok: true, status: result.status, ms: result.ms, detail };
    } catch (err) {
      const detail = hookError(err);
      this.pushLog({ t: Date.now(), action: "hook", user: "", text: `${hook.name} test failed: ${detail}`, by: "bot" });
      this.deps.log("error", "chat hook test failed", { hook: hook.name, url: redactHookUrl(hook.url), message: detail });
      return { ok: false, status: 0, ms: Date.now() - started, detail };
    }
  }

  saveExtras(input: unknown): void {
    const row = asRecord(input) ?? {};
    const thanks = "thanks" in row ? normalizeThanks(row.thanks) : this.file.thanks;
    const shoutout = "shoutout" in row ? normalizeShoutout(row.shoutout) : this.file.shoutout;
    let quotes = this.file.quotes;
    if (Array.isArray(row.quotes)) quotes = row.replaceQuotes === true ? normalizeQuotes(row.quotes) : importQuoteList(row.quotes, this.file.quotes);
    this.file = this.store.saveConfig({ ...this.file, thanks, shoutout, quotes });
  }

  /** A notice the desk already kept (toggle on, not a duplicate). The bot may thank them. */
  noteNotice(input: { platform: string; kind?: string; user: string; amount?: string; text?: string }): void {
    const kind = thankKind(input.kind);
    if (!kind || this.stopped) return;
    const planned = planThankYou({
      thanks: this.file.thanks,
      kind,
      user: input.user,
      amount: input.amount ?? "",
      text: input.text ?? "",
      now: Date.now(),
      hold: this.giftHold,
      facts: this.facts,
    });
    this.giftHold = planned.hold;
    if (planned.waitMs > 0) this.armGift(planned.waitMs);
    if (planned.say) void this.postBot(input.platform === "youtube" ? "youtube" : "twitch", planned.say);
  }

  saveTimer(input: unknown, now = Date.now()): void {
    const timer = normalizeTimer(input);
    if (!timer) throw new Error("That timer needs a name and at least one message.");
    const row = asRecord(input);
    const explicitId = typeof row?.id === "string" && row.id.trim() ? timer.id : "";
    const timers = [...this.file.timers];
    let index = explicitId ? timers.findIndex((item) => item.id === explicitId) : -1;
    if (index < 0 && !explicitId) index = timers.findIndex((item) => item.name.toLowerCase() === timer.name.toLowerCase());
    if (index >= 0) {
      const previous = timers[index];
      if (!previous) return;
      const messagesChanged = previous.messages.join("\n") !== timer.messages.join("\n");
      const liveTimingChanged = previous.intervalSec !== timer.intervalSec || previous.minChatLines !== timer.minChatLines || previous.mode !== timer.mode;
      const offlineTimingChanged =
        previous.offlineIntervalSec !== timer.offlineIntervalSec || previous.offlineMinChatLines !== timer.offlineMinChatLines || previous.mode !== timer.mode;
      const messageIndex = messagesChanged ? 0 : Math.min(previous.messageIndex, Math.max(0, timer.messages.length - 1));
      timers[index] = {
        ...timer,
        id: previous.id,
        messageIndex,
        message: timer.messages[messageIndex] ?? timer.message,
        linesSince: liveTimingChanged ? 0 : previous.linesSince,
        lastFiredAt: liveTimingChanged ? now : previous.lastFiredAt,
        offlineLinesSince: offlineTimingChanged ? 0 : previous.offlineLinesSince,
        offlineLastFiredAt: offlineTimingChanged ? now : previous.offlineLastFiredAt,
        platforms: row && "platforms" in row ? timer.platforms : previous.platforms,
      };
    } else timers.push(timer);
    this.file = this.store.saveConfig({ ...this.file, timers });
  }

  deleteTimer(id: string): void {
    this.file = this.store.saveConfig({ ...this.file, timers: this.file.timers.filter((item) => item.id !== id) });
  }

  saveFilters(input: unknown): void {
    const row = asRecord(input) ?? {};
    const links = asRecord(row.links);
    const caps = asRecord(row.caps);
    const symbols = asRecord(row.symbols);
    this.file = this.store.saveConfig({
      ...this.file,
      filters: normalizeFilters({
        ...this.file.filters,
        ...row,
        links: { ...this.file.filters.links, ...(links ?? {}) },
        caps: { ...this.file.filters.caps, ...(caps ?? {}) },
        symbols: { ...this.file.filters.symbols, ...(symbols ?? {}) },
      }),
    });
  }

  async importSe(jwt?: string): Promise<void> {
    const typed = typeof jwt === "string" ? jwt.trim() : "";
    const token = typed || this.secrets.seJwt.trim();
    if (!token) throw new Error("Paste a StreamElements JWT. None is stored yet.");
    if (token.split(".").length < 3) throw new Error("That does not look like a StreamElements JWT.");
    const fetchImpl = this.fetchImpl();
    let channel = channelIdFromJwt(token);
    if (!channel) {
      const me = await fetchImpl("https://api.streamelements.com/kappa/v2/channels/me", { headers: { Authorization: `Bearer ${token}` } });
      if (!me.ok) throw new Error("StreamElements rejected that JWT.");
      const body = (await me.json()) as { _id?: string };
      channel = typeof body._id === "string" ? body._id : "";
    }
    if (!/^[a-f0-9]{24}$/i.test(channel)) throw new Error("StreamElements did not say which channel this JWT belongs to.");
    const headers = { Authorization: `Bearer ${token}` };
    const [commandsRes, timersRes] = await Promise.all([
      fetchImpl(`https://api.streamelements.com/kappa/v2/bot/commands/${channel}`, { headers }),
      fetchImpl(`https://api.streamelements.com/kappa/v2/bot/timers/${channel}`, { headers }),
    ]);
    if (!commandsRes.ok) throw new Error("StreamElements did not return commands.");
    const imported = importStreamElements(await commandsRes.json(), timersRes.ok ? await timersRes.json() : []);
    this.mergeImport(imported.commands, imported.timers);
    this.secrets = { ...this.secrets, seJwt: token };
    this.store.saveSecrets(this.secrets);
    this.deps.log("info", "imported streamelements bot data", { commands: String(imported.commands.length), timers: String(imported.timers.length) });
  }

  importJson(payload: unknown): void {
    const imported = importStreamElements(payload, payload);
    const row = asRecord(payload) ?? {};
    const commands = imported.commands.length ? imported.commands : (Array.isArray(row.commands) ? row.commands.map(normalizeCommand).filter((item): item is BotCommand => item !== null) : []);
    const timers = imported.timers.length ? imported.timers : (Array.isArray(row.timers) ? row.timers.map(normalizeTimer).filter((item): item is BotTimer => item !== null) : []);
    if (commands.length === 0 && timers.length === 0) throw new Error("That JSON did not contain commands or timers.");
    this.mergeImport(commands, timers);
  }

  async tick(): Promise<void> {
    if (this.stopped) return;
    const now = Date.now();
    const facts = await this.channelFacts("twitch", "");
    let changed = false;
    const timers = [...this.file.timers];
    for (let index = 0; index < timers.length; index += 1) {
      let timer = timers[index];
      if (!timer) continue;
      const buckets = new Map<TimerPhase, ChatPlatform[]>();
      for (const platform of this.registry.list()) {
        if (!targetsPlatform(timer.platforms, platform.id)) continue;
        if (platform.id === "twitch" && !this.activeTwitch()) continue;
        const live = this.liveFlag(platform);
        if (platform.id === "youtube" && live !== true) continue;
        const phase = activePhase(timer, live);
        if (!phase || !timerIsDue(timer, now, phase)) continue;
        const list = buckets.get(phase) ?? [];
        list.push(platform);
        buckets.set(phase, list);
      }
      for (const phase of ["live", "offline"] as const) {
        const targets = buckets.get(phase);
        if (!targets || targets.length === 0) continue;
        const text = expandTemplate(timerMessage(timer), { user: "chat", touser: "", count: "0", randomPool: "", facts });
        if (!text.trim()) continue;
        for (const platform of targets) {
          try {
            await this.say(platform, text);
          } catch (err) {
            this.pushLog({ t: now, action: "error", user: "", text: safeError(err), by: platform.id });
          }
        }
        timer = advanceTimer(timer, now, phase);
        changed = true;
        this.pushLog({ t: now, action: "timer", user: "", text: `${timer.name} (${phase})`, by: "bot" });
      }
      timers[index] = timer;
    }
    if (!changed) return;
    this.file = this.store.saveConfig({ ...this.file, timers });
  }

  stop(): void {
    this.stopped = true;
    if (this.giftTimer) clearTimeout(this.giftTimer);
    this.giftTimer = null;
    this.cancelLogin();
    this.cancelYoutubeLogin();
    void this.twitch.disconnect();
    void this.youtube.disconnect();
  }

  async connect(): Promise<void> {
    if (!this.activeTwitch() || this.stopped) return;
    this.statusOverride = null;
    await this.twitch.connect();
  }

  async connectYoutube(): Promise<void> {
    if (this.stopped) return;
    this.youtubeNote = "";
    await this.youtube.connect();
  }

  private async reconnectYoutube(): Promise<void> {
    await this.youtube.disconnect();
    await this.connectYoutube();
  }

  private async finishLogin(clientId: string, controller: AbortController): Promise<void> {
    const prompt = this.prompt;
    if (!prompt) return;
    const fetchImpl = this.fetchImpl();
    try {
      const deadline = prompt.expiresAt;
      while (!controller.signal.aborted && Date.now() < deadline) {
        await sleep(prompt.interval * 1000);
        const result = await pollDevice(clientId, prompt.deviceCode, fetchImpl);
        if (result === "pending") continue;
        if (result === "denied") throw new Error("The bot login was denied.");
        const identity = await this.validate(result.accessToken);
        this.tokens = {
          clientId,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: Date.now() + result.expiresIn * 1000,
          scopes: identity.scopes,
          userId: identity.userId,
          login: identity.login,
        };
        this.store.saveTokens(this.tokens);
        this.prompt = null;
        this.statusOverride = `Logged in as ${identity.login}. Mod that account in your channel so it can timeout and delete.`;
        this.deps.log("info", "bot login succeeded", { login: identity.login });
        await this.connect();
        return;
      }
    } catch (err) {
      this.prompt = null;
      this.statusOverride = err instanceof Error ? err.message : "Bot login failed.";
      this.deps.log("error", "bot login failed", { message: safeError(err) });
    } finally {
      this.loginAbort = null;
    }
  }

  private async finishYoutubeLogin(client: YoutubeOAuthClient, request: YoutubeAuthRequest, controller: AbortController): Promise<void> {
    try {
      const callback = await waitForYoutubeCallback({ signal: controller.signal });
      if (controller.signal.aborted) return;
      if (callback.state !== request.state || !callback.code) throw new Error("That YouTube login did not match. Start again.");
      const exchanged = await exchangeYoutubeCode(client, request, callback.code, this.fetchImpl());
      const api = new YoutubeDataApi({
        token: async () => exchanged.accessToken,
        fetchImpl: this.fetchImpl(),
        meter: this.youtube.quota(),
      });
      const identity = await api.myChannel();
      this.youtubeTokens = {
        clientId: client.clientId,
        accessToken: exchanged.accessToken,
        refreshToken: exchanged.refreshToken,
        expiresAt: Date.now() + exchanged.expiresIn * 1000,
        scopes: exchanged.scope.split(/\s+/).filter(Boolean),
        channelId: identity.channelId,
        title: identity.title,
      };
      this.store.saveYoutubeTokens(this.youtubeTokens);
      this.youtubePrompt = null;
      this.youtubeNote = "";
      this.deps.log("info", "youtube login succeeded", { channel: identity.channelId });
      this.deps.onAccountsChanged?.();
      await this.reconnectYoutube();
    } catch (err) {
      if (controller.signal.aborted) return;
      this.youtubePrompt = null;
      this.youtubeNote = err instanceof Error ? err.message : "YouTube login failed.";
      this.deps.log("error", "youtube login failed", { message: safeError(err) });
    } finally {
      if (this.youtubeLoginAbort === controller) this.youtubeLoginAbort = null;
    }
  }

  private async onPlatformMessage(message: NormalizedChatMessage): Promise<void> {
    const platform = this.registry.get(message.platform);
    if (!platform) return;
    const line: ChatLine = {
      messageId: message.messageId,
      userId: message.user.id,
      login: message.user.login,
      displayName: message.user.displayName,
      text: message.text,
      roles: message.user.roles,
    };
    const facts = await this.channelFacts(message.platform, line.userId);
    const botUserId = message.platform === "youtube" ? this.youtubeSession()?.channelId ?? "" : this.activeTwitch()?.userId ?? "";
    const now = Date.now();
    const decision = decideChat(this.file, this.memory, line, now, facts, botUserId, message.platform, { chatters: this.rememberChatter(line, now, botUserId) });
    if (decision.quotes) this.file = this.store.saveConfig({ ...this.file, quotes: decision.quotes });
    if (decision.lookup && message.platform === "twitch") {
      const looked = await this.answerLookup(decision.lookup, line);
      if (looked) decision.say.push(looked.slice(0, 450));
    }
    if (decision.countCommandId) {
      const command = this.file.commands.find((item) => item.id === decision.countCommandId);
      if (command) command.count += 1;
      if (command?.name === "askjeeves" && message.platform === "twitch") this.askJeeves?.({ user: line.displayName, text: line.text, platform: "twitch" });
      this.file = this.store.saveConfig(this.file);
    }
    if (decision.chatLine) {
      const live = this.liveFlag(platform);
      this.file.timers = this.file.timers.map((timer) => (targetsPlatform(timer.platforms, message.platform) ? countTimerLine(timer, live) : timer));
    }
    if (decision.log) this.pushLog({ t: Date.now(), ...decision.log });
    const gate = {
      platform: message.platform,
      channel: message.platform === "youtube" ? this.file.youtubeChannelId : this.file.channelLogin,
      botUserId,
      botLogin: message.platform === "youtube" ? "" : this.activeTwitch()?.login ?? "",
      channelLogin: message.platform === "youtube" ? "" : this.file.channelLogin,
      broadcasterId: message.platform === "youtube" ? this.file.youtubeChannelId : this.file.broadcasterId,
      publishedAt: message.publishedAt,
      duplicate: this.rememberHookMessage(message.messageId),
      sentByRascal: this.echoOfOurs(message.platform, line, now, botUserId),
    };
    const hookDecision = decideChatHook(this.file.hooks, line, now, this.memory, gate);
    if (hookDecision.action === "fire") void this.dispatchHook(platform, hookDecision.hook, line, hookDecision.text, now, gate);
    await this.execute(platform, decision, line);
  }

  private rememberHookMessage(id: string): boolean {
    const key = id.trim();
    if (!key) return false;
    if (this.seenHookIds.has(key)) return true;
    this.seenHookIds.add(key);
    if (this.seenHookIds.size > 500) {
      const first = this.seenHookIds.values().next().value;
      if (first) this.seenHookIds.delete(first);
    }
    return false;
  }

  private async dispatchHook(
    platform: ChatPlatform,
    hook: BotFile["hooks"][number],
    line: ChatLine,
    text: string,
    now: number,
    gate: { platform: string; channel: string; botUserId: string; botLogin: string; channelLogin: string; broadcasterId: string; publishedAt: number; duplicate: boolean },
  ): Promise<void> {
    try {
      const result = await callChatHook(hook, buildHookPayload(hook, line, text, gate, now), this.fetchImpl());
      this.pushLog({ t: Date.now(), action: "hook", user: line.login, text: `${hook.name} HTTP ${result.status} ${result.ms}ms`, by: platform.id });
      if (result.reply && !this.stopped && platform.capabilities.send) await this.say(platform, result.reply);
    } catch (err) {
      const detail = hookError(err);
      this.pushLog({ t: Date.now(), action: "hook", user: line.login, text: `${hook.name} failed: ${detail}`, by: platform.id });
      this.deps.log("error", "chat hook failed", { hook: hook.name, url: redactHookUrl(hook.url), message: detail });
    }
  }

  private async execute(platform: ChatPlatform, decision: BotDecision, line: ChatLine): Promise<void> {
    try {
      if (decision.deleteMessage) {
        if (platform.capabilities.deleteMessage) await platform.deleteMessage(line.messageId);
        else this.pushLog({ t: Date.now(), action: "unsupported", user: line.login, text: "delete", by: platform.id });
      }
      if (decision.timeoutSec !== null) {
        if (!platform.capabilities.timeout) {
          this.pushLog({ t: Date.now(), action: "unsupported", user: decision.targetLogin, text: "timeout", by: platform.id });
        } else {
          const userId = await this.actionUser(platform, decision, line, platform.id !== "twitch");
          if (userId) await platform.timeoutUser(userId, decision.timeoutSec, decision.log?.text ?? "");
        }
      }
      if (decision.ban) {
        if (!platform.capabilities.ban) {
          this.pushLog({ t: Date.now(), action: "unsupported", user: decision.targetLogin, text: "ban", by: platform.id });
        } else if (platform.id === "twitch") {
          const userId = (await platform.lookupUser(decision.targetLogin)) || "";
          if (userId) await platform.banUser(userId, decision.log?.text ?? "");
        } else {
          const userId = decision.targetUserId || (await platform.lookupUser(decision.targetLogin)) || "";
          if (userId) await platform.banUser(userId, decision.log?.text ?? "");
        }
      }
      if (decision.unban) {
        if (!platform.capabilities.unban) {
          this.pushLog({ t: Date.now(), action: "unsupported", user: decision.targetLogin, text: "unban", by: platform.id });
        } else if (platform.id === "twitch") {
          const userId = (await platform.lookupUser(decision.targetLogin)) || "";
          if (userId) await platform.unbanUser(userId);
        } else {
          const userId = (await platform.lookupUser(decision.targetLogin)) || decision.targetUserId || "";
          if (userId) await platform.unbanUser(userId);
        }
      }
      for (const text of decision.say) {
        if (platform.capabilities.send) await this.say(platform, text);
      }
    } catch (err) {
      this.pushLog({ t: Date.now(), action: "error", user: line.login, text: safeError(err), by: "bot" });
      this.deps.log("error", "bot action failed", { message: safeError(err) });
    }
  }

  private rememberChatter(line: ChatLine, now: number, botUserId: string): string[] {
    const login = line.login.toLowerCase();
    const botLogin = (this.activeTwitch()?.login ?? "").toLowerCase();
    const channel = this.file.channelLogin.toLowerCase();
    const blocked = !login || line.userId === botUserId || login === channel || login === botLogin || BOT_NAMES.has(login);
    if (!blocked) this.recentChatters.set(login, { name: line.displayName || line.login, at: now });
    const names: string[] = [];
    for (const [key, row] of this.recentChatters) {
      if (now - row.at > CHATTER_MS) this.recentChatters.delete(key);
      else names.push(row.name);
    }
    return names;
  }

  private async answerLookup(lookup: { kind: "followage" | "accountage" | "shoutout"; login: string }, line: ChatLine): Promise<string> {
    try {
      const profile = await this.helix.userByLogin(lookup.login);
      if (!profile) return `I couldn't find ${lookup.login}.`;
      const name = profile.name || profile.login;
      if (lookup.kind === "accountage") return accountAgeLine(name, profile.createdAt, Date.now());
      if (lookup.kind === "followage") {
        if (!this.file.broadcasterId) return "The channel id is not set.";
        const followed = await this.helix.followedAt(this.file.broadcasterId, profile.id);
        return followageLine(name, followed, Date.now());
      }
      const channel = await this.helix.channel(profile.id);
      const text = expandTemplate(this.file.shoutout.template, {
        user: line.displayName,
        touser: profile.login,
        count: "0",
        randomPool: "",
        facts: { ...this.facts, game: channel.game },
      });
      const scopes = this.activeTwitch()?.scopes ?? [];
      const moderatorId = this.activeTwitch()?.userId ?? "";
      if (this.file.shoutout.helix && scopes.includes("moderator:manage:shoutouts") && this.file.broadcasterId && moderatorId) {
        try {
          await this.helix.shoutout(this.file.broadcasterId, profile.id, moderatorId);
        } catch (err) {
          this.pushLog({ t: Date.now(), action: "shoutout", user: profile.login, text: safeError(err), by: "bot" });
        }
      }
      return text;
    } catch (err) {
      this.deps.log("error", "lookup failed", { message: safeError(err) });
      return "I couldn't look that up.";
    }
  }

  private armGift(waitMs: number): void {
    if (this.giftTimer) clearTimeout(this.giftTimer);
    this.giftTimer = setTimeout(() => {
      this.giftTimer = null;
      const flushed = flushGiftHold(this.file.thanks, this.giftHold, Date.now(), this.facts, true);
      this.giftHold = flushed.hold;
      if (flushed.say) void this.postBot("twitch", flushed.say);
    }, waitMs);
    this.giftTimer.unref?.();
  }

  private async say(platform: ChatPlatform, text: string): Promise<void> {
    this.outgoing = noteOutgoing(this.outgoing, platform.id, text, Date.now());
    await platform.sendMessage(text);
  }

  /** A line Rascal just posted, coming back from the same account. A viewer's copy is left alone. */
  private echoOfOurs(platform: string, line: ChatLine, now: number, botUserId: string): boolean {
    const botLogin = (platform === "youtube" ? "" : this.activeTwitch()?.login ?? "").toLowerCase();
    const channel = (platform === "youtube" ? "" : this.file.channelLogin).toLowerCase();
    const broadcasterId = platform === "youtube" ? this.file.youtubeChannelId : this.file.broadcasterId;
    const login = line.login.toLowerCase();
    const fromAccount =
      (botUserId && line.userId === botUserId) ||
      (broadcasterId && line.userId === broadcasterId) ||
      (channel && login === channel) ||
      (botLogin && login === botLogin) ||
      line.roles.includes("broadcaster");
    if (!fromAccount) return false;
    const taken = consumeOutgoing(this.outgoing, platform, line.text, now);
    this.outgoing = taken.sent;
    return taken.matched;
  }

  private async postBot(platformId: string, text: string): Promise<void> {
    const platform = this.registry.get(platformId);
    const line = text.trim().slice(0, 450);
    if (!platform?.capabilities.send || !line || this.stopped) return;
    try {
      await this.say(platform, line);
    } catch (err) {
      this.pushLog({ t: Date.now(), action: "error", user: "", text: safeError(err), by: platformId });
    }
  }

  private async channelFacts(platformId: string, userId: string): Promise<ChannelFacts> {
    if (platformId !== "twitch") {
      const live = this.youtube.liveStatus();
      return { title: live.title ?? "", game: "", uptime: live.live ? "live" : "offline", followage: "" };
    }
    await this.refreshStreamLive();
    if (!this.activeTwitch() || !this.file.broadcasterId) return { ...EMPTY_FACTS, followage: "" };
    let followage = "";
    if (userId) {
      const cached = this.followCache.get(userId);
      if (cached && Date.now() - cached.at < 10 * 60_000) followage = cached.text;
      else {
        try {
          followage = await this.helix.followage(this.file.broadcasterId, userId);
          this.followCache.set(userId, { at: Date.now(), text: followage });
        } catch {
          followage = "unknown";
        }
      }
    }
    return { ...this.facts, followage };
  }

  /** Helix `/streams` says whether the Twitch channel is actually live. Chat being connected is not enough. */
  private async refreshStreamLive(): Promise<void> {
    if (!this.activeTwitch() || !this.file.broadcasterId) return;
    if (Date.now() - this.streamLiveAt < 30_000 && this.twitch.liveStatus().liveKnown !== false) return;
    try {
      const channel = await this.helix.channel(this.file.broadcasterId);
      const live = Boolean(channel.startedAt);
      this.twitch.setStreamLive(live);
      this.facts = { title: channel.title, game: channel.game, uptime: live ? age(channel.startedAt) : "offline", followage: this.facts.followage };
      this.streamLiveAt = Date.now();
    } catch (err) {
      this.deps.log("error", "stream status failed", { message: safeError(err) });
    }
  }

  private liveFlag(platform: ChatPlatform): boolean | null {
    const status = platform.liveStatus();
    if (status.liveKnown === false) return null;
    return status.live;
  }

  private async accessToken(): Promise<string> {
    const tokens = this.activeTwitch();
    if (!tokens) throw new Error("Log in the bot account first.");
    if (tokens.expiresAt - Date.now() > 30 * 60 * 1000) return tokens.accessToken;
    const response = await this.fetchImpl()("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.deps.clientId(), grant_type: "refresh_token", refresh_token: tokens.refreshToken }),
    });
    if (!response.ok) {
      if (this.file.accounts.twitch !== "channel") this.logout();
      throw new Error("Bot session expired. Log in again.");
    }
    const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!json.access_token || !json.refresh_token) throw new Error("Twitch did not refresh the bot session.");
    const next = { ...tokens, accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    this.saveActiveTwitch(next);
    return next.accessToken;
  }

  private async youtubeAccessToken(): Promise<string> {
    const tokens = this.youtubeSession();
    if (!tokens) throw new Error("Connect a YouTube account first.");
    if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
    const next = await refreshYoutubeAccessToken(this.google(), tokens.refreshToken, this.fetchImpl());
    const saved: YoutubeBotTokens = {
      ...tokens,
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      expiresAt: Date.now() + next.expiresIn * 1000,
    };
    this.saveYoutubeSession(saved);
    return saved.accessToken;
  }

  private async validate(accessToken: string): Promise<{ login: string; userId: string; scopes: string[] }> {
    const response = await this.fetchImpl()("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${accessToken}` } });
    if (!response.ok) throw new Error("Twitch did not accept the bot token.");
    const json = (await response.json()) as { login?: string; user_id?: string; scopes?: string[] };
    if (!json.login || !json.user_id) throw new Error("Twitch did not identify the bot account.");
    return { login: json.login, userId: json.user_id, scopes: json.scopes ?? [] };
  }

  private activeTwitch(): BotTokens | null {
    if (this.file.accounts.twitch === "channel") return this.bridge?.loadTwitch() ?? this.store.loadDeskTwitchTokens();
    return this.tokens;
  }

  private saveActiveTwitch(tokens: BotTokens): void {
    if (this.file.accounts.twitch === "channel") {
      if (this.bridge) this.bridge.saveTwitch(tokens);
      else this.store.saveDeskTwitchTokens(tokens);
      return;
    }
    this.tokens = tokens;
    this.store.saveTokens(tokens);
  }

  private youtubeSession(): YoutubeBotTokens | null {
    if (this.file.accounts.youtube === "channel") return this.bridge?.loadYoutube() ?? this.store.loadDeskYoutubeTokens();
    return this.youtubeTokens;
  }

  private saveYoutubeSession(tokens: YoutubeBotTokens): void {
    if (this.file.accounts.youtube === "channel") {
      if (this.bridge) this.bridge.saveYoutube(tokens);
      else this.store.saveDeskYoutubeTokens(tokens);
      return;
    }
    this.youtubeTokens = tokens;
    this.store.saveYoutubeTokens(tokens);
  }

  private google(): YoutubeOAuthClient {
    const clientId = readBrandEnv("GOOGLE_CLIENT_ID")?.trim() ?? "";
    const clientSecret = readBrandEnv("GOOGLE_CLIENT_SECRET") ?? "";
    if (clientId) return { clientId, clientSecret };
    return this.store.loadGoogleClient();
  }

  private platformSections(): PlatformSection[] {
    const twitchTokens = this.activeTwitch();
    const twitchLive = this.twitch.liveStatus();
    const youtubeTokens = this.youtubeSession();
    const youtubeLive = this.youtube.liveStatus();
    return [
      {
        id: "twitch",
        label: "Twitch",
        connected: Boolean(twitchTokens && twitchLive.connected),
        status: this.statusOverride ?? twitchLive.detail,
        account: twitchTokens?.login ?? null,
        accountMode: this.file.accounts.twitch,
        separateAccount: this.tokens?.login ?? null,
        capabilities: this.twitch.capabilities,
        quota: null,
      },
      {
        id: "youtube",
        label: "YouTube",
        connected: Boolean(youtubeTokens) && youtubeLive.connected,
        status: this.youtubeNote || youtubeLive.detail,
        account: youtubeTokens ? youtubeTokens.title || youtubeTokens.channelId : null,
        accountMode: this.file.accounts.youtube,
        separateAccount: this.youtubeTokens ? this.youtubeTokens.title || this.youtubeTokens.channelId : null,
        capabilities: this.youtube.capabilities,
        quota: this.youtube.quotaView(),
      },
    ];
  }

  private async actionUser(platform: ChatPlatform, decision: BotDecision, line: ChatLine, preferNamed: boolean): Promise<string> {
    if (!preferNamed) return decision.targetUserId || (await platform.lookupUser(decision.targetLogin)) || "";
    const named = decision.targetLogin && decision.targetLogin.toLowerCase() !== line.login.toLowerCase();
    if (named) return (await platform.lookupUser(decision.targetLogin)) || "";
    return decision.targetUserId || (await platform.lookupUser(decision.targetLogin)) || "";
  }

  private mergeImport(commands: BotCommand[], timers: BotTimer[]): void {
    const names = new Set(commands.map((command) => command.name));
    const kept = this.file.commands.filter((command) => !names.has(command.name));
    const timerNames = new Set(timers.map((timer) => timer.name));
    const keptTimers = this.file.timers.filter((timer) => !timerNames.has(timer.name));
    this.file = this.store.saveConfig({ ...this.file, commands: [...kept, ...commands], timers: [...keptTimers, ...timers] });
  }

  private pushLog(entry: ModLogEntry): void {
    this.log.push(entry);
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }

  private fetchImpl(): typeof fetch {
    return this.deps.fetchImpl ?? fetch;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hookError(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("The hook ") || message.startsWith("That address ")) return message.slice(0, 180);
  return "The hook did not answer.";
}

function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "Bot request failed.";
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/OAuth\s+\S+/gi, "OAuth [redacted]").replace(/ya29\.[A-Za-z0-9_\-]+/g, "[redacted]").slice(0, 180);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function loadBotFile(value: unknown): BotFile {
  return normalizeBotFile(value);
}
