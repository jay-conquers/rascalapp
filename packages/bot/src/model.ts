import { normalizePlatformTarget, targetsPlatform, type PlatformTarget } from "../../../src/shared/platform/target.ts";

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
  count: number;
  /** Missing or unknown values stay on Twitch, which is how older files behave. */
  platforms: PlatformTarget;
}

export interface BotTimer {
  id: string;
  name: string;
  enabled: boolean;
  message: string;
  intervalSec: number;
  minChatLines: number;
  linesSince: number;
  lastFiredAt: number;
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
    throw new Error("The bot server URL must be https://your-app.fly.dev.");
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
    count: clampInt(row.count, 0, 1_000_000_000, 0),
    platforms: normalizePlatformTarget(row.platforms),
  };
}

export function normalizeTimer(value: unknown): BotTimer | null {
  const row = asRecord(value);
  if (!row) return null;
  const name = typeof row.name === "string" ? row.name.trim().slice(0, 40) : "";
  const message = typeof row.message === "string" ? row.message.slice(0, 450) : "";
  if (!name || !message) return null;
  return {
    id: slugId(typeof row.id === "string" ? row.id : name),
    name,
    enabled: row.enabled !== false,
    message,
    intervalSec: clampInt(row.intervalSec, 15, 86400, 600),
    minChatLines: clampInt(row.minChatLines, 0, 500, 5),
    linesSince: clampInt(row.linesSince, 0, 100000, 0),
    lastFiredAt: typeof row.lastFiredAt === "number" && Number.isFinite(row.lastFiredAt) ? row.lastFiredAt : 0,
    platforms: normalizePlatformTarget(row.platforms),
  };
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

export interface RuntimeMemory {
  globalCooldown: Map<string, number>;
  userCooldown: Map<string, number>;
  permits: Map<string, number>;
}

export function emptyMemory(): RuntimeMemory {
  return { globalCooldown: new Map(), userCooldown: new Map(), permits: new Map() };
}

export function decideChat(
  file: BotFile,
  memory: RuntimeMemory,
  line: ChatLine,
  now: number,
  facts: ChannelFacts,
  botUserId: string,
  platform: PlatformTarget | string = "twitch",
): BotDecision {
  const none = emptyDecision(line);
  if (!line.userId || line.userId === botUserId) return { ...none, chatLine: false };
  const builtIn = builtInCommand(file, memory, line, now, platform);
  if (builtIn) return builtIn;
  const filter = targetsPlatform(file.filters.platforms, platform) ? applyFilters(file, memory, line, now) : null;
  if (filter) return filter;
  const command = matchCommand(file, line.text, platform);
  if (!command || !command.enabled) return { ...none, chatLine: true };
  if (!levelAllows(command.level, line.roles)) {
    return { ...none, chatLine: true, log: { action: "ignored", user: line.login, text: `!${command.name} needs ${command.level}`, by: "bot" } };
  }
  const globalKey = `${platform}:${command.id}`;
  const userKey = `${platform}:${command.id}:${line.userId}`;
  if ((memory.globalCooldown.get(globalKey) ?? 0) > now || (memory.userCooldown.get(userKey) ?? 0) > now) {
    return { ...none, chatLine: true };
  }
  if (command.cooldownSec > 0) memory.globalCooldown.set(globalKey, now + command.cooldownSec * 1000);
  if (command.userCooldownSec > 0) memory.userCooldown.set(userKey, now + command.userCooldownSec * 1000);
  const said = expandTemplate(command.response, {
    user: line.displayName,
    touser: commandArgs(line.text),
    count: String(command.count + 1),
    randomPool: "",
    facts,
  });
  return {
    ...none,
    say: said ? [said.slice(0, 450)] : [],
    chatLine: true,
    countCommandId: command.id,
    log: { action: "command", user: line.login, text: `!${command.name}`, by: "bot" },
  };
}

export function dueTimers(file: BotFile, now: number): BotTimer[] {
  return file.timers.filter((timer) => timer.enabled && timer.message && now - timer.lastFiredAt >= timer.intervalSec * 1000 && timer.linesSince >= timer.minChatLines);
}

export function expandTemplate(
  template: string,
  ctx: { user: string; touser: string; count: string; randomPool: string; facts: ChannelFacts },
): string {
  return template.replace(/\{([a-z]+)(?::([^}]+))?\}|\$\(([a-z]+)(?:\s+([^)]+))?\)|\$\{([a-z]+)\}/gi, (full, braceName: string | undefined, braceArg: string | undefined, parenName: string | undefined, parenArg: string | undefined, dollarName: string | undefined) => {
    const rawName = braceName || parenName || dollarName || "";
    const rawArg = braceArg || parenArg;
    const name = rawName.toLowerCase();
    if (name === "user" || name === "username") return ctx.user;
    if (name === "touser" || name === "target") return ctx.touser || ctx.user;
    if (name === "count") return ctx.count;
    if (name === "uptime") return ctx.facts.uptime || "offline";
    if (name === "game") return ctx.facts.game || "nothing";
    if (name === "title") return ctx.facts.title || "untitled";
    if (name === "followage") return ctx.facts.followage || "unknown";
    if (name === "random") return pickRandom(rawArg ?? ctx.randomPool);
    return full;
  });
}

export function levelAllows(required: UserLevel, roles: readonly UserLevel[]): boolean {
  if (required === "everyone") return true;
  if (roles.includes("broadcaster")) return true;
  if (required === "mod") return roles.includes("mod");
  if (required === "vip") return roles.includes("vip") || roles.includes("mod");
  return roles.includes("sub") || roles.includes("vip") || roles.includes("mod");
}

export function rolesFromBadges(badges: readonly { set_id?: string }[], login: string, channel: string): UserLevel[] {
  const roles: UserLevel[] = ["everyone"];
  const sets = new Set(badges.map((badge) => (badge.set_id ?? "").toLowerCase()));
  if (sets.has("subscriber") || sets.has("founder")) roles.push("sub");
  if (sets.has("vip")) roles.push("vip");
  if (sets.has("moderator")) roles.push("mod");
  if (sets.has("broadcaster") || login.toLowerCase() === channel.toLowerCase()) roles.push("broadcaster");
  return roles;
}

function builtInCommand(file: BotFile, memory: RuntimeMemory, line: ChatLine, now: number, platform: string): BotDecision | null {
  const parsed = splitCommand(line.text);
  if (!parsed) return null;
  const none = emptyDecision(line);
  if (parsed.name === "permit") {
    if (!levelAllows("mod", line.roles)) return { ...none, chatLine: true };
    const target = commandName(parsed.args.split(/\s+/)[0] ?? "");
    if (!target) return { ...none, say: ["Usage: !permit username"], chatLine: true };
    const seconds = clampInt(Number(parsed.args.split(/\s+/)[1]), 5, 3600, file.filters.permitSec);
    memory.permits.set(target, now + seconds * 1000);
    return { ...none, say: [`${target} can post a link for ${seconds}s.`], permitLogin: target, permitSec: seconds, chatLine: true, log: { action: "permit", user: target, text: `${seconds}s`, by: line.login } };
  }
  if (parsed.name === "timeout" || parsed.name === "ban" || parsed.name === "unban") {
    if (!levelAllows("mod", line.roles)) return { ...none, chatLine: true };
    const [who, rawSeconds, ...reason] = parsed.args.split(/\s+/);
    const target = commandName(who ?? "");
    if (!target) return { ...none, say: [`Usage: !${parsed.name} username`], chatLine: true };
    if (parsed.name === "unban") {
      return { ...none, unban: true, targetLogin: target, chatLine: true, log: { action: "unban", user: target, text: "", by: line.login } };
    }
    if (parsed.name === "ban") {
      return { ...none, ban: true, targetLogin: target, chatLine: true, log: { action: "ban", user: target, text: reason.join(" "), by: line.login } };
    }
    const seconds = clampInt(Number(rawSeconds), 1, 1209600, 600);
    return { ...none, timeoutSec: seconds, targetLogin: target, chatLine: true, log: { action: "timeout", user: target, text: `${seconds}s ${reason.join(" ")}`.trim(), by: line.login } };
  }
  if (parsed.name === "commands") {
    const names = file.commands.filter((command) => command.enabled && targetsPlatform(command.platforms, platform) && levelAllows(command.level, line.roles)).map((command) => `!${command.name}`);
    return { ...none, say: [names.length ? `Commands: ${names.slice(0, 30).join(" ")}` : "No commands yet."], chatLine: true };
  }
  return null;
}

function applyFilters(file: BotFile, memory: RuntimeMemory, line: ChatLine, now: number): BotDecision | null {
  if (levelAllows("mod", line.roles)) return null;
  const permitted = (memory.permits.get(line.login.toLowerCase()) ?? 0) > now;
  const none = emptyDecision(line);
  if (!permitted && file.filters.links.enabled && hasLink(line.text)) {
    return punish(none, line, file.filters.links.action, file.filters.links.timeoutSec, "link");
  }
  if (file.filters.caps.enabled && tooMany(line.text, file.filters.caps.minLength, file.filters.caps.maxPercent, (char) => char >= "A" && char <= "Z", (char) => /[A-Za-z]/.test(char))) {
    return punish(none, line, file.filters.caps.action, file.filters.caps.timeoutSec, "caps");
  }
  if (file.filters.symbols.enabled && tooMany(line.text, file.filters.symbols.minLength, file.filters.symbols.maxPercent, (char) => /[^\p{L}\p{N}\s]/u.test(char), () => true)) {
    return punish(none, line, file.filters.symbols.action, file.filters.symbols.timeoutSec, "symbols");
  }
  const whitelist = new Set(file.filters.whitelist.map((item) => item.toLowerCase()));
  for (const rule of file.filters.blacklist) {
    const word = rule.word.toLowerCase();
    if (!word || whitelist.has(word)) continue;
    if (line.text.toLowerCase().includes(word)) return punish(none, line, rule.action, rule.timeoutSec, `blacklist:${word}`);
  }
  return null;
}

function punish(base: BotDecision, line: ChatLine, action: FilterAction | "delete" | "timeout", seconds: number, why: string): BotDecision {
  return {
    ...base,
    deleteMessage: true,
    timeoutSec: action === "timeout" ? seconds : null,
    ban: action === "ban",
    targetLogin: line.login,
    targetUserId: line.userId,
    chatLine: false,
    log: { action, user: line.login, text: why, by: "filter" },
  };
}

function matchCommand(file: BotFile, text: string, platform: string): BotCommand | null {
  const parsed = splitCommand(text);
  if (!parsed) return null;
  return (
    file.commands.find(
      (command) => (command.name === parsed.name || command.aliases.includes(parsed.name)) && targetsPlatform(command.platforms, platform),
    ) ?? null
  );
}

function splitCommand(text: string): { name: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("!")) return null;
  const space = trimmed.search(/\s/);
  const name = commandName(space === -1 ? trimmed : trimmed.slice(0, space));
  if (!name) return null;
  return { name, args: space === -1 ? "" : trimmed.slice(space + 1).trim() };
}

function commandArgs(text: string): string {
  return splitCommand(text)?.args ?? "";
}

function hasLink(text: string): boolean {
  return /\b(?:https?:\/\/|www\.)\S+/i.test(text) || /\b[\w-]+\.(?:com|net|tv|gg|io|org|link|ly)\b/i.test(text);
}

function tooMany(text: string, minLength: number, maxPercent: number, hit: (char: string) => boolean, base: (char: string) => boolean): boolean {
  const chars = [...text];
  const pool = chars.filter(base);
  if (pool.length < minLength) return false;
  const hits = pool.filter(hit).length;
  return (hits / pool.length) * 100 >= maxPercent;
}

function pickRandom(raw: string): string {
  const arg = raw.trim();
  const range = arg.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    return String(low + Math.floor(Math.random() * (high - low + 1)));
  }
  const choices = arg.split("|").map((item) => item.trim()).filter(Boolean);
  if (choices.length === 0) return "";
  return choices[Math.floor(Math.random() * choices.length)] ?? "";
}

function emptyDecision(line: ChatLine): BotDecision {
  return {
    say: [],
    deleteMessage: false,
    timeoutSec: null,
    ban: false,
    unban: false,
    targetLogin: line.login,
    targetUserId: line.userId,
    log: null,
    permitLogin: null,
    permitSec: 0,
    countCommandId: null,
    chatLine: false,
  };
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

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
