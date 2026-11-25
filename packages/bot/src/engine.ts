import { keywordHits } from "./keywords.ts";
import { handleQuote } from "./quotes.ts";
import { targetsPlatform, type PlatformTarget } from "../../../src/shared/platform/target.ts";
import { expandTemplate } from "./template.ts";
import { clampInt } from "./values.ts";
import {
  commandName,
  type BotCommand,
  type BotDecision,
  type BotFile,
  type BotTimer,
  type ChannelFacts,
  type ChatLine,
  type FilterAction,
  type TimerPhase,
  type UserLevel,
} from "./config.ts";

export function timerMessage(timer: BotTimer): string {
  const messages = timer.messages.length > 0 ? timer.messages : timer.message ? [timer.message] : [];
  if (messages.length === 0) return "";
  const index = ((timer.messageIndex % messages.length) + messages.length) % messages.length;
  return messages[index] ?? timer.message;
}

/**
 * Which schedule applies right now.
 * `live === null` means the platform has not said yet. A timer whose live and offline
 * schedules match can still run; different schedules wait until the status is known.
 */
export function activePhase(timer: BotTimer, live: boolean | null): TimerPhase | null {
  if (!timer.enabled || timerMessage(timer) === "") return null;
  if (timer.mode === "live") return live === true ? "live" : null;
  if (timer.mode === "offline") return live === false ? "offline" : null;
  if (live === true) return "live";
  if (live === false) return "offline";
  if (timer.intervalSec === timer.offlineIntervalSec && timer.minChatLines === timer.offlineMinChatLines) return "live";
  return null;
}

export function timerIsDue(timer: BotTimer, now: number, phase: TimerPhase): boolean {
  if (!timer.enabled || timerMessage(timer) === "") return false;
  if (phase === "offline") {
    return now - timer.offlineLastFiredAt >= timer.offlineIntervalSec * 1000 && timer.offlineLinesSince >= timer.offlineMinChatLines;
  }
  return now - timer.lastFiredAt >= timer.intervalSec * 1000 && timer.linesSince >= timer.minChatLines;
}

/** Rotate to the next message and start that phase's countdown over. */
export function advanceTimer(timer: BotTimer, now: number, phase: TimerPhase): BotTimer {
  const messages = timer.messages.length > 0 ? timer.messages : [timer.message];
  const nextIndex = messages.length === 0 ? 0 : (timer.messageIndex + 1) % messages.length;
  const next = messages[nextIndex] ?? timer.message;
  const rotated = { ...timer, messageIndex: nextIndex, message: next };
  if (phase === "offline") return { ...rotated, offlineLastFiredAt: now, offlineLinesSince: 0 };
  return { ...rotated, lastFiredAt: now, linesSince: 0 };
}

/** Count a chat line toward the schedule that is active on that platform. */
export function countTimerLine(timer: BotTimer, live: boolean | null): BotTimer {
  const phase = activePhase(timer, live);
  if (phase === "offline") return { ...timer, offlineLinesSince: Math.min(100000, timer.offlineLinesSince + 1) };
  if (phase === "live") return { ...timer, linesSince: Math.min(100000, timer.linesSince + 1) };
  return timer;
}

export interface RuntimeMemory {
  globalCooldown: Map<string, number>;
  userCooldown: Map<string, number>;
  permits: Map<string, number>;
}

export function emptyMemory(): RuntimeMemory {
  return { globalCooldown: new Map(), userCooldown: new Map(), permits: new Map() };
}

export interface DecideExtra {
  chatters?: readonly string[];
  rng?: () => number;
}

export function decideChat(
  file: BotFile,
  memory: RuntimeMemory,
  line: ChatLine,
  now: number,
  facts: ChannelFacts,
  botUserId: string,
  platform: PlatformTarget | string = "twitch",
  extra: DecideExtra = {},
): BotDecision {
  const none = emptyDecision(line);
  if (!line.userId || line.userId === botUserId) return { ...none, chatLine: false };
  const builtIn = builtInCommand(file, memory, line, now, platform, extra.rng);
  if (builtIn) return builtIn;
  const filter = targetsPlatform(file.filters.platforms, platform) ? applyFilters(file, memory, line, now) : null;
  if (filter) return filter;
  const command = matchCommand(file, line.text, platform) ?? matchKeyword(file, line.text, platform);
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
  const args = commandArgs(line.text);
  const said = expandTemplate(command.response, {
    user: line.displayName,
    touser: args,
    count: String(command.count + 1),
    randomPool: "",
    facts,
    args: args.split(/\s+/).filter(Boolean),
    chatters: extra.chatters,
    rng: extra.rng,
  });
  const viaKeyword = !splitCommand(line.text);
  return {
    ...none,
    say: said ? [said.slice(0, 450)] : [],
    chatLine: true,
    countCommandId: command.id,
    log: { action: "command", user: line.login, text: viaKeyword ? command.name : `!${command.name}`, by: "bot" },
  };
}

export function dueTimers(file: BotFile, now: number, live: boolean | null = null): BotTimer[] {
  return file.timers.filter((timer) => {
    const phase = activePhase(timer, live);
    return phase !== null && timerIsDue(timer, now, phase);
  });
}

export function levelAllows(required: UserLevel, roles: readonly UserLevel[]): boolean {
  if (required === "everyone") return true;
  if (roles.includes("broadcaster")) return true;
  if (required === "mod") return roles.includes("mod");
  if (required === "vip") return roles.includes("vip") || roles.includes("mod");
  return roles.includes("sub") || roles.includes("vip") || roles.includes("mod");
}

function builtInCommand(file: BotFile, memory: RuntimeMemory, line: ChatLine, now: number, platform: string, rng?: () => number): BotDecision | null {
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
  if (parsed.name === "commands" || parsed.name === "cmds") {
    const names = file.commands.filter((command) => command.enabled && targetsPlatform(command.platforms, platform) && levelAllows(command.level, line.roles)).map((command) => `!${command.name}`);
    return { ...none, say: [names.length ? `Commands: ${names.slice(0, 30).join(" ")}` : "No commands yet."], chatLine: true };
  }
  if (parsed.name === "followage" || parsed.name === "howlong" || parsed.name === "accountage") {
    if (platform !== "twitch") return null;
    const login = mentionLogin(parsed.args.split(/\s+/)[0] ?? "", line.login);
    const kind = parsed.name === "accountage" ? "accountage" : "followage";
    return { ...none, lookup: { kind, login }, chatLine: true };
  }
  if (parsed.name === "so" || parsed.name === "shoutout") {
    if (platform !== "twitch" || !levelAllows("mod", line.roles)) return null;
    const login = mentionLogin(parsed.args.split(/\s+/)[0] ?? "", "");
    if (!login) return { ...none, say: ["Usage: !so username"], chatLine: true };
    return { ...none, lookup: { kind: "shoutout", login }, chatLine: true, log: { action: "shoutout", user: login, text: "", by: line.login } };
  }
  if (parsed.name === "quote") {
    const result = handleQuote(file.quotes ?? [], parsed.args, line.login, levelAllows("mod", line.roles), now, rng);
    return {
      ...none,
      say: result.say ? [result.say.slice(0, 450)] : [],
      quotes: result.quotes,
      chatLine: true,
      log: { action: "quote", user: line.login, text: parsed.args.slice(0, 80), by: "bot" },
    };
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

function matchKeyword(file: BotFile, text: string, platform: string): BotCommand | null {
  if (text.trim().startsWith("!")) return null;
  let best: { command: BotCommand; length: number } | null = null;
  for (const command of file.commands) {
    if (!command.enabled || !targetsPlatform(command.platforms, platform)) continue;
    for (const keyword of command.keywords ?? []) {
      if (!keywordHits(text, keyword)) continue;
      if (!best || keyword.length > best.length) best = { command, length: keyword.length };
    }
  }
  return best?.command ?? null;
}

function mentionLogin(value: string, fallback: string): string {
  const name = commandName(value.replace(/^@/, ""));
  return name || fallback;
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
    lookup: null,
    quotes: null,
  };
}
