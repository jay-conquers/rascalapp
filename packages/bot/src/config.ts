import { normalizeHooks, type ChatHook } from "./chat-hook.ts";
import { normalizeKeywords } from "./keywords.ts";
import { normalizeQuotes, type Quote } from "./quotes.ts";
import { normalizePlatformTarget, type PlatformTarget } from "../../../src/shared/platform/target.ts";
import { defaultThanks, normalizeThanks, type ThanksSettings } from "./thanks.ts";
import { asRecord, clampInt } from "./values.ts";

export type { ChatHook, Quote, ThanksSettings };

export type UserLevel = "everyone" | "sub" | "vip" | "mod" | "broadcaster";
export type FilterAction = "delete" | "timeout" | "ban";
export type { PlatformTarget };
export type BotAccountMode = "channel" | "bot";

export interface BotAccounts {
  twitch: BotAccountMode;
  youtube: BotAccountMode;
}

export interface BotCommand {
  id: string;
  name: string;
  response: string;
  enabled: boolean;
  cooldownSec: number;
  userCooldownSec: number;
  level: UserLevel;
  aliases: string[];
  /**
   * Words or phrases that fire this command inside a normal message.
   * Matched on a word boundary, ignoring case. A missing list matches nothing.
   */
  keywords?: string[];
  count: number;
  /** Missing or unknown values stay on Twitch, which is how older files behave. */
  platforms: PlatformTarget;
}

export interface ShoutoutSettings {
  template: string;
  /** Try Helix Send a Shoutout when the token has moderator:manage:shoutouts. */
  helix: boolean;
}

export interface HelixLookup {
  kind: "followage" | "accountage" | "shoutout";
  login: string;
}

/** When a timer is allowed to post. "both" uses the live schedule and the offline schedule separately. */
export type TimerMode = "live" | "offline" | "both";
export type TimerPhase = "live" | "offline";

export interface BotTimer {
  id: string;
  name: string;
  enabled: boolean;
  /** Rotating lines. `message` is the one that will be sent next. */
  messages: string[];
  messageIndex: number;
  message: string;
  mode: TimerMode;
  intervalSec: number;
  minChatLines: number;
  linesSince: number;
  lastFiredAt: number;
  offlineIntervalSec: number;
  offlineMinChatLines: number;
  offlineLinesSince: number;
  offlineLastFiredAt: number;
  platforms: PlatformTarget;
}

export interface FilterWord {
  word: string;
  action: FilterAction;
  timeoutSec: number;
}

export interface BotFilters {
  blacklist: FilterWord[];
  whitelist: string[];
  links: { enabled: boolean; action: "delete" | "timeout"; timeoutSec: number };
  caps: { enabled: boolean; minLength: number; maxPercent: number; action: "delete" | "timeout"; timeoutSec: number };
  symbols: { enabled: boolean; minLength: number; maxPercent: number; action: "delete" | "timeout"; timeoutSec: number };
  permitSec: number;
  platforms: PlatformTarget;
}

export interface ModLogEntry {
  t: number;
  action: string;
  user: string;
  text: string;
  by: string;
}

export interface BotFile {
  channelLogin: string;
  broadcasterId: string;
  /** YouTube channel the bot watches when it is not the signed-in channel. */
  youtubeChannelId: string;
  portalPort: number;
  bindHost: string;
  publicUrl: string;
  accounts: BotAccounts;
  /** Spend Data API quota to poll live chat. Off unless the page reader keeps failing. */
  youtubeApiPoll: boolean;
  commands: BotCommand[];
  timers: BotTimer[];
  filters: BotFilters;
  quotes: Quote[];
  thanks: ThanksSettings;
  shoutout: ShoutoutSettings;
  /** External chat services. Off until a streamer turns one on. */
  hooks: ChatHook[];
}

export interface ChatLine {
  messageId: string;
  userId: string;
  login: string;
  displayName: string;
  text: string;
  roles: UserLevel[];
}

export interface BotDecision {
  say: string[];
  deleteMessage: boolean;
  timeoutSec: number | null;
  ban: boolean;
  unban: boolean;
  targetLogin: string;
  targetUserId: string;
  log: { action: string; user: string; text: string; by: string } | null;
  permitLogin: string | null;
  permitSec: number;
  countCommandId: string | null;
  chatLine: boolean;
  /** Filled in by the service with a Helix result before the line is sent. */
  lookup: HelixLookup | null;
  /** The quote list to save, when !quote add or !quote remove changed it. */
  quotes: Quote[] | null;
}

export interface ChannelFacts {
  title: string;
  game: string;
  uptime: string;
  followage: string;
}

export const BOT_SCOPES = [
  "user:read:chat",
  "user:write:chat",
  "user:bot",
  "moderator:manage:chat_messages",
  "moderator:manage:banned_users",
  "moderator:read:followers",
] as const;

export const PORTAL_SCOPES = ["user:read:moderated_channels"] as const;
export const DEFAULT_PORTAL_PORT = 4788;

/** Browser-facing origin. Twitch only accepts localhost, not 127.0.0.1, as a redirect. The socket still binds 127.0.0.1. */
export function portalBase(publicUrl: string, port: number): string {
  const trimmed = publicUrl.trim().replace(/\/$/, "");
  if (trimmed) return trimmed;
  return `http://localhost:${port}`;
}

/** The desk sends the admin token to this origin. Public servers must be https. */
export function validateBotServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("The bot server URL must be https://bot.example.com, or http://localhost for a server on this computer.");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("The bot server URL must be https, except on localhost.");
  }
  if (url.username || url.password) throw new Error("Don't put a password in the bot server URL.");
  return url.origin;
}

export function defaultFilters(): BotFilters {
  return {
    blacklist: [],
    whitelist: [],
    links: { enabled: false, action: "delete", timeoutSec: 30 },
    caps: { enabled: false, minLength: 20, maxPercent: 80, action: "delete", timeoutSec: 30 },
    symbols: { enabled: false, minLength: 20, maxPercent: 70, action: "delete", timeoutSec: 30 },
    permitSec: 60,
    platforms: "twitch",
  };
}

export function defaultAccounts(): BotAccounts {
  return { twitch: "bot", youtube: "bot" };
}

export function defaultShoutout(): ShoutoutSettings {
  return {
    template: "Go follow {target} at twitch.tv/{target}! They were last playing {game}.",
    helix: true,
  };
}

export function normalizeShoutout(value: unknown): ShoutoutSettings {
  const base = defaultShoutout();
  const row = asRecord(value);
  if (!row) return base;
  const template = typeof row.template === "string" && row.template.trim() ? row.template.trim().slice(0, 450) : base.template;
  return { template, helix: row.helix !== false };
}

export function defaultBotFile(): BotFile {
  return {
    channelLogin: "",
    broadcasterId: "",
    youtubeChannelId: "",
    accounts: defaultAccounts(),
    youtubeApiPoll: false,
    portalPort: DEFAULT_PORTAL_PORT,
    bindHost: "127.0.0.1",
    publicUrl: "",
    commands: [],
    timers: [],
    filters: defaultFilters(),
    quotes: [],
    thanks: defaultThanks(),
    shoutout: defaultShoutout(),
    hooks: [],
  };
}

const LEVELS: UserLevel[] = ["everyone", "sub", "vip", "mod", "broadcaster"];

export function normalizeBotFile(value: unknown): BotFile {
  const row = asRecord(value);
  const base = defaultBotFile();
  if (!row) return base;
  return {
    channelLogin: cleanLogin(row.channelLogin) || base.channelLogin,
    broadcasterId: digits(row.broadcasterId),
    youtubeChannelId: youtubeChannelId(row.youtubeChannelId),
    accounts: normalizeAccounts(row.accounts),
    youtubeApiPoll: row.youtubeApiPoll === true,
    portalPort: clampInt(row.portalPort, 1024, 65535, base.portalPort),
    bindHost: row.bindHost === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1",
    publicUrl: typeof row.publicUrl === "string" ? row.publicUrl.trim().slice(0, 200) : "",
    commands: Array.isArray(row.commands) ? uniqueCommands(row.commands.map(normalizeCommand).filter((item): item is BotCommand => item !== null)) : [],
    timers: Array.isArray(row.timers) ? row.timers.map(normalizeTimer).filter((item): item is BotTimer => item !== null) : [],
    filters: normalizeFilters(row.filters),
    quotes: normalizeQuotes(row.quotes),
    thanks: normalizeThanks(row.thanks),
    shoutout: normalizeShoutout(row.shoutout),
    hooks: normalizeHooks(row.hooks),
  };
}

export function normalizeCommand(value: unknown): BotCommand | null {
  const row = asRecord(value);
  if (!row) return null;
  const name = commandName(typeof row.name === "string" ? row.name : "");
  if (!name) return null;
  const aliases = Array.isArray(row.aliases)
    ? row.aliases.map((item) => commandName(typeof item === "string" ? item : "")).filter((item) => item && item !== name)
    : [];
  return {
    id: slugId(typeof row.id === "string" ? row.id : name),
    name,
    response: typeof row.response === "string" ? row.response.slice(0, 450) : "",
    enabled: row.enabled !== false,
    cooldownSec: clampInt(row.cooldownSec, 0, 86400, 5),
    userCooldownSec: clampInt(row.userCooldownSec, 0, 86400, 15),
    level: LEVELS.includes(row.level as UserLevel) ? (row.level as UserLevel) : "everyone",
    aliases,
    keywords: normalizeKeywords(row.keywords),
    count: clampInt(row.count, 0, 1_000_000_000, 0),
    platforms: normalizePlatformTarget(row.platforms),
  };
}

export function normalizeTimer(value: unknown): BotTimer | null {
  const row = asRecord(value);
  if (!row) return null;
  const name = typeof row.name === "string" ? row.name.trim().slice(0, 40) : "";
  const messages = timerMessagesFrom(row);
  if (!name || messages.length === 0) return null;
  const mode: TimerMode = row.mode === "live" || row.mode === "offline" || row.mode === "both" ? row.mode : "both";
  const intervalSec = clampInt(row.intervalSec, 15, 86400, 600);
  const minChatLines = clampInt(row.minChatLines, 0, 500, 5);
  const messageIndex = clampInt(row.messageIndex, 0, messages.length - 1, 0);
  return {
    id: slugId(typeof row.id === "string" ? row.id : name),
    name,
    enabled: row.enabled !== false,
    messages,
    messageIndex,
    message: messages[messageIndex] ?? messages[0] ?? "",
    mode,
    intervalSec,
    minChatLines,
    linesSince: clampInt(row.linesSince, 0, 100000, 0),
    lastFiredAt: finiteTime(row.lastFiredAt),
    offlineIntervalSec: clampInt(row.offlineIntervalSec, 15, 86400, intervalSec),
    offlineMinChatLines: clampInt(row.offlineMinChatLines, 0, 500, minChatLines),
    offlineLinesSince: clampInt(row.offlineLinesSince, 0, 100000, 0),
    offlineLastFiredAt: finiteTime(row.offlineLastFiredAt),
    platforms: normalizePlatformTarget(row.platforms),
  };
}

/** Older timers have one message and no mode. They keep posting on that same interval live or offline. */
export function timerMessagesFrom(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (value: unknown): void => {
    const text = timerLine(value);
    if (!text || out.length >= 30) return;
    out.push(text.slice(0, 450));
  };
  if (Array.isArray(row.messages)) {
    for (const item of row.messages) push(item);
  }
  if (out.length === 0) push(row.message);
  return out;
}

export function normalizeFilters(value: unknown): BotFilters {
  const row = asRecord(value);
  const base = defaultFilters();
  if (!row) return base;
  const links = asRecord(row.links);
  const caps = asRecord(row.caps);
  const symbols = asRecord(row.symbols);
  return {
    blacklist: Array.isArray(row.blacklist) ? row.blacklist.map(normalizeWord).filter((item): item is FilterWord => item !== null).slice(0, 200) : [],
    whitelist: stringList(row.whitelist),
    links: {
      enabled: links?.enabled === true,
      action: links?.action === "timeout" ? "timeout" : "delete",
      timeoutSec: clampInt(links?.timeoutSec, 1, 1209600, 30),
    },
    caps: ratioRule(caps, base.caps),
    symbols: ratioRule(symbols, base.symbols),
    permitSec: clampInt(row.permitSec, 5, 3600, 60),
    platforms: normalizePlatformTarget(row.platforms),
  };
}

export function commandName(value: string): string {
  return value.trim().replace(/^!+/, "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
}

function normalizeWord(value: unknown): FilterWord | null {
  const row = asRecord(value);
  if (!row || typeof row.word !== "string") return null;
  const word = row.word.trim().toLowerCase().slice(0, 60);
  if (word.length < 2) return null;
  const action: FilterAction = row.action === "timeout" || row.action === "ban" ? row.action : "delete";
  return { word, action, timeoutSec: clampInt(row.timeoutSec, 1, 1209600, 60) };
}

function ratioRule(
  row: Record<string, unknown> | null,
  fallback: BotFilters["caps"],
): BotFilters["caps"] {
  if (!row) return fallback;
  return {
    enabled: row.enabled === true,
    minLength: clampInt(row.minLength, 5, 200, fallback.minLength),
    maxPercent: clampInt(row.maxPercent, 10, 100, fallback.maxPercent),
    action: row.action === "timeout" ? "timeout" : "delete",
    timeoutSec: clampInt(row.timeoutSec, 1, 1209600, fallback.timeoutSec),
  };
}

function uniqueCommands(commands: BotCommand[]): BotCommand[] {
  const seen = new Set<string>();
  const out: BotCommand[] = [];
  for (const command of commands) {
    if (seen.has(command.name)) continue;
    seen.add(command.name);
    out.push(command);
  }
  return out.slice(0, 400);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const word = item.trim().toLowerCase().slice(0, 60);
    if (word.length < 2 || out.includes(word)) continue;
    out.push(word);
    if (out.length >= 100) break;
  }
  return out;
}

function timerLine(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const row = asRecord(value);
  if (!row || row.enabled === false) return "";
  const text = row.message ?? row.text ?? row.content;
  return typeof text === "string" ? text.trim() : "";
}

function finiteTime(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function slugId(value: string): string {
  const clean = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return clean || `id${Math.random().toString(36).slice(2, 8)}`;
}

function cleanLogin(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^#/, "").toLowerCase().slice(0, 25) : "";
}

function digits(value: unknown): string {
  return typeof value === "string" && /^\d{1,20}$/.test(value) ? value : "";
}

function youtubeChannelId(value: unknown): string {
  return typeof value === "string" && /^UC[\w-]{22}$/.test(value.trim()) ? value.trim() : "";
}

function normalizeAccounts(value: unknown): BotAccounts {
  const row = asRecord(value);
  const base = defaultAccounts();
  if (!row) return base;
  return {
    twitch: row.twitch === "channel" ? "channel" : "bot",
    youtube: row.youtube === "channel" ? "channel" : "bot",
  };
}
