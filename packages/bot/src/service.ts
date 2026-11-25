import { brand, readBrandEnv } from "../../../src/shared/brand.ts";
import { liveFlag, type BotPlatform } from "../../../src/shared/platform/bot-platform.ts";
import { PlatformRegistry } from "../../../src/shared/platform/registry.ts";
import { targetsPlatform } from "../../../src/shared/platform/target.ts";
import type { ChatPlatform, NormalizedChatMessage } from "../../../src/shared/platform/types.ts";
import { refreshYoutubeAccessToken, type YoutubeOAuthClient } from "../../../src/shared/platform/youtube-oauth.ts";
import type { QuotaSnapshot } from "../../../src/shared/platform/youtube-quota.ts";
import type { PlatformCapabilities } from "../../../src/shared/platform/types.ts";
import { detectLive } from "../../../src/shared/youtube/page-reader.ts";
import {
  activePhase,
  advanceTimer,
  countTimerLine,
  decideChat,
  emptyMemory,
  expandTemplate,
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
import { safeError } from "./errors.ts";
import { importQuoteList, normalizeQuotes } from "./quotes.ts";
import { buildHookPayload, consumeOutgoing, decideChatHook, normalizeHook, normalizeHooks, noteOutgoing, redactHookUrl, sampleHookPayload, type SentLine } from "./chat-hook.ts";
import { callChatHook } from "./chat-hook-send.ts";
import { channelIdFromJwt, importStreamElements } from "./se.ts";
import { flushGiftHold, normalizeThanks, planThankYou, thankKind, type GiftHold } from "./thanks.ts";
import { BotStore, readYoutubeTokens, type BotTokens, type YoutubeBotTokens } from "./store.ts";
import { youtubePublicRedirect } from "./public-url.ts";
import { HelixBot } from "./twitch.ts";

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
  platforms: PlatformSection[];
  youtubeLogin: BotLoginPrompt | null;
  youtubeRedirectUri: string;
  googleClientId: string;
  googleClientSecretSet: boolean;
  googleClientFromEnv: boolean;
  youtubeApiPoll: boolean;
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
  private statusOverride: string | null = null;
  private youtubeNote = "";
  private stopped = false;
  private recentChatters = new Map<string, { name: string; at: number }>();
  private seenHookIds = new Set<string>();
  private outgoing: SentLine[] = [];
  private giftHold: GiftHold | null = null;
  private giftTimer: ReturnType<typeof setTimeout> | null = null;
  private bridge: ChannelTokenBridge | null = null;
  private readonly registry = new PlatformRegistry<BotPlatform>();

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
    const helix = new HelixBot(() => this.deps.clientId(), () => this.accessToken(), fetchImpl);
    const twitch = new TwitchChatPlatform({
      helix,
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
      session: () => this.activeTwitch(),
      botAccount: () => this.tokens,
      accountMode: () => this.file.accounts.twitch,
      channelLogin: () => this.file.channelLogin,
      statusOverride: () => this.statusOverride,
      setStatus: (status) => {
        this.statusOverride = status;
      },
      saveBotTokens: (tokens) => {
        this.tokens = tokens;
        this.store.saveTokens(tokens);
      },
      clearBotTokens: () => {
        this.tokens = null;
        this.store.clearTokens();
      },
      validate: (accessToken) => this.validate(accessToken),
      shoutout: () => this.file.shoutout,
      pushLog: (entry) => this.pushLog(entry),
      productName: () => brand.displayName,
      serviceStopped: () => this.stopped,
    });
    const youtube = new YoutubeChatPlatform({
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
      session: () => this.youtubeSession(),
      separateAccount: () => this.youtubeTokens,
      accountMode: () => this.file.accounts.youtube,
      note: () => this.youtubeNote,
      setNote: (note) => {
        this.youtubeNote = note;
      },
      google: () => this.google(),
      redirect: () => this.youtubeRedirect(),
      saveTokens: (tokens) => {
        this.youtubeTokens = tokens;
        this.store.saveYoutubeTokens(tokens);
      },
      clearTokens: () => {
        this.youtubeTokens = null;
        this.store.clearYoutubeTokens();
      },
      onChanged: () => this.deps.onAccountsChanged?.(),
    });
    this.registry.register(twitch);
    this.registry.register(youtube);
    for (const platform of this.registry.list()) {
      platform.onMessage((message) => {
        void this.onPlatformMessage(message);
      });
    }
  }

  /** The desk passes its live token store so a "post as my channel" choice shares that login. */
  setChannelTokenBridge(bridge: ChannelTokenBridge | null): void {
    this.bridge = bridge;
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
    void this.registry.get("youtube")?.reconnect();
  }

  snapshot(portalPort: number): BotSnapshot {
    const base = portalBase(this.file.publicUrl, portalPort);
    const client = this.google();
    const twitch = this.registry.get("twitch");
    const youtube = this.registry.get("youtube");
    const active = twitch?.postingIdentity() ?? null;
    const twitchLive = twitch?.liveStatus();
    return {
      connected: Boolean(active && twitchLive?.connected),
      status: this.statusOverride ?? twitchLive?.detail ?? "Bot is idle.",
      botLogin: active?.login ?? null,
      channelLogin: this.file.channelLogin,
      broadcasterId: this.file.broadcasterId,
      portalUrl: `${base}/portal`,
      redirectUri: `${base}/portal/callback`,
      login: twitch?.loginPrompt() ?? null,
      commands: this.file.commands,
      timers: this.file.timers,
      filters: this.file.filters,
      quotes: this.file.quotes,
      thanks: this.file.thanks,
      shoutout: this.file.shoutout,
      hooks: this.file.hooks.map((hook) => ({ ...hook, secret: "", secretSet: hook.secret.length > 0 })),
      log: this.log.slice(-80),
      seJwtSet: this.secrets.seJwt.length > 0,
      platforms: this.platformSections(),
      youtubeLogin: youtube?.loginPrompt() ?? null,
      youtubeRedirectUri: this.youtubeRedirect(),
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
    if (this.registry.get("twitch")?.postingIdentity()) void this.connect();
    if (previousChannel !== this.file.youtubeChannelId) void this.registry.get("youtube")?.reconnect();
  }

  setAccounts(patch: { twitch?: unknown; youtube?: unknown; youtubeApiPoll?: unknown }): void {
    const twitch = patch.twitch === "channel" ? "channel" : patch.twitch === "bot" ? "bot" : this.file.accounts.twitch;
    const youtube = patch.youtube === "channel" ? "channel" : patch.youtube === "bot" ? "bot" : this.file.accounts.youtube;
    const youtubeApiPoll = typeof patch.youtubeApiPoll === "boolean" ? patch.youtubeApiPoll : this.file.youtubeApiPoll;
    this.file = this.store.saveConfig({ ...this.file, accounts: { twitch, youtube }, youtubeApiPoll });
    for (const platform of this.registry.list()) platform.setOptIn?.(youtubeApiPoll);
    this.statusOverride = null;
    if (patch.twitch !== undefined) void this.connect();
    if (patch.youtube !== undefined) void this.registry.get("youtube")?.reconnect();
  }

  ingestYoutube(message: NormalizedChatMessage): void {
    this.registry.get("youtube")?.ingest?.(message);
  }

  noteYoutubeReader(ok: boolean): void {
    this.registry.get("youtube")?.noteReader?.(ok);
  }

  setYoutubeLive(input: { live: boolean; known?: boolean; title?: string; videoId?: string }): void {
    this.registry.get("youtube")?.setLive?.(input);
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
    await this.registry.get("twitch")?.startAccountLogin();
  }

  cancelLogin(): void {
    this.registry.get("twitch")?.cancelAccountLogin();
  }

  logout(): void {
    this.registry.get("twitch")?.logoutAccount();
  }

  youtubeRedirect(): string {
    return youtubePublicRedirect(this.file.publicUrl);
  }

  /** The public HTTPS callback lands here. Loopback logins do not. */
  acceptYoutubeCallback(input: { code: string; state: string; error: string }): boolean {
    return this.registry.get("youtube")?.acceptLoginCallback?.(input) ?? false;
  }

  async startYoutubeLogin(): Promise<void> {
    await this.registry.get("youtube")?.startAccountLogin();
  }

  cancelYoutubeLogin(): void {
    this.registry.get("youtube")?.cancelAccountLogin();
  }

  logoutYoutube(): void {
    this.registry.get("youtube")?.logoutAccount();
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
      facts: this.registry.get("twitch")?.currentFacts() ?? { ...EMPTY_FACTS },
    });
    this.giftHold = planned.hold;
    if (planned.waitMs > 0) this.armGift(planned.waitMs);
    if (planned.say) void this.postBot(input.platform === "youtube" ? "youtube" : "twitch", planned.say);
  }

  private armGift(waitMs: number): void {
    if (this.giftTimer) clearTimeout(this.giftTimer);
    this.giftTimer = setTimeout(() => {
      this.giftTimer = null;
      const flushed = flushGiftHold(this.file.thanks, this.giftHold, Date.now(), this.registry.get("twitch")?.currentFacts() ?? { ...EMPTY_FACTS }, true);
      this.giftHold = flushed.hold;
      if (flushed.say) void this.postBot("twitch", flushed.say);
    }, waitMs);
    this.giftTimer.unref?.();
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
    const facts = (await this.registry.get("twitch")?.factsFor("")) ?? { ...EMPTY_FACTS };
    let changed = false;
    const timers = [...this.file.timers];
    for (let index = 0; index < timers.length; index += 1) {
      let timer = timers[index];
      if (!timer) continue;
      const buckets = new Map<TimerPhase, BotPlatform[]>();
      for (const platform of this.registry.list()) {
        if (!targetsPlatform(timer.platforms, platform.id)) continue;
        if (!platform.acceptsTimers()) continue;
        const live = liveFlag(platform.liveStatus());
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
    for (const platform of this.registry.list()) {
      platform.cancelAccountLogin();
      void platform.disconnect();
    }
  }

  /** Opens every registered platform. Twitch no-ops until it has a posting account. */
  async openPlatforms(): Promise<void> {
    if (this.stopped) return;
    for (const platform of this.registry.list()) await platform.open();
  }

  async connect(): Promise<void> {
    await this.registry.get("twitch")?.open();
  }

  async connectYoutube(): Promise<void> {
    await this.registry.get("youtube")?.open();
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
    const facts = await platform.factsFor(line.userId);
    const botUserId = platform.postingIdentity()?.userId ?? "";
    const now = Date.now();
    const decision = decideChat(this.file, this.memory, line, now, facts, botUserId, message.platform, { chatters: this.rememberChatter(line, now, botUserId) });
    if (decision.quotes) this.file = this.store.saveConfig({ ...this.file, quotes: decision.quotes });
    if (decision.lookup) {
      const looked = await platform.builtinLookup(decision.lookup.kind, decision.lookup.login, line.displayName);
      if (looked) decision.say.push(looked.slice(0, 450));
    }
    if (decision.countCommandId) {
      const command = this.file.commands.find((item) => item.id === decision.countCommandId);
      if (command) command.count += 1;
      this.file = this.store.saveConfig(this.file);
    }
    if (decision.chatLine) {
      const live = liveFlag(platform.liveStatus());
      this.file.timers = this.file.timers.map((timer) => (targetsPlatform(timer.platforms, message.platform) ? countTimerLine(timer, live) : timer));
    }
    if (decision.log) this.pushLog({ t: Date.now(), ...decision.log });
    const subject = platform.hookSubject();
    const gate = {
      platform: message.platform,
      channel: subject.channel,
      botUserId: subject.botUserId,
      botLogin: subject.botLogin,
      channelLogin: subject.channelLogin,
      broadcasterId: subject.broadcasterId,
      publishedAt: message.publishedAt,
      duplicate: this.rememberHookMessage(message.messageId),
      sentByRascal: this.echoOfOurs(platform, line, now),
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
          const userId = await this.actionUser(platform, decision, line);
          if (userId) await platform.timeoutUser(userId, decision.timeoutSec, decision.log?.text ?? "");
        }
      }
      if (decision.ban) {
        if (!platform.capabilities.ban) {
          this.pushLog({ t: Date.now(), action: "unsupported", user: decision.targetLogin, text: "ban", by: platform.id });
        } else {
          const userId = await this.actionUser(platform, decision, line);
          if (userId) await platform.banUser(userId, decision.log?.text ?? "");
        }
      }
      if (decision.unban) {
        if (!platform.capabilities.unban) {
          this.pushLog({ t: Date.now(), action: "unsupported", user: decision.targetLogin, text: "unban", by: platform.id });
        } else {
          const userId = await this.actionUser(platform, decision, line);
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

  private async say(platform: ChatPlatform, text: string): Promise<void> {
    this.outgoing = noteOutgoing(this.outgoing, platform.id, text, Date.now());
    await platform.sendMessage(text);
  }

  private echoOfOurs(platform: BotPlatform, line: ChatLine, now: number): boolean {
    const ids = platform.echoIds();
    const login = line.login.toLowerCase();
    const fromAccount =
      (ids.botUserId && line.userId === ids.botUserId) ||
      (ids.broadcasterId && line.userId === ids.broadcasterId) ||
      (ids.channelLogin && login === ids.channelLogin.toLowerCase()) ||
      (ids.botLogin && login === ids.botLogin.toLowerCase()) ||
      line.roles.includes("broadcaster");
    if (!fromAccount) return false;
    const taken = consumeOutgoing(this.outgoing, platform.id, line.text, now);
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

  private rememberChatter(line: ChatLine, now: number, botUserId: string): string[] {
    const login = line.login.toLowerCase();
    const botLogin = (this.registry.get("twitch")?.postingIdentity()?.login ?? "").toLowerCase();
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
    return this.registry.list().map((platform) => ({
      id: platform.id,
      label: platform.label,
      ...platform.accountCard(),
      capabilities: platform.capabilities,
    }));
  }

  /**
   * A built-in command copies the sender's id into the decision, then names the real target.
   * When those two people differ, the named login is the one to act on.
   */
  private async actionUser(platform: ChatPlatform, decision: BotDecision, line: ChatLine): Promise<string> {
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

function hookError(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("The hook ") || message.startsWith("That address ")) return message.slice(0, 180);
  return "The hook did not answer.";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
