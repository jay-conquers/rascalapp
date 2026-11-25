import crypto from "node:crypto";
import { normalizeKeywords } from "./keywords.ts";
import {
  classifyLiteral,
  isAmbiguousIp,
  isBlockedHookName,
  isSingleLabel,
  literalAllowed,
  normalizeHost,
} from "./hook-guard.ts";
import type { ChatLine, RuntimeMemory, UserLevel } from "./model.ts";
import { normalizePlatformTarget, targetsPlatform, type PlatformTarget } from "../../../src/shared/platform/target.ts";

export const HOOK_BACKFILL_MS = 12_000;
export const HOOK_REPLY_LIMIT = 450;
export const HOOK_BODY_LIMIT = 8_192;
export const HOOK_SIGNATURE_HEADER = "x-rascal-signature";

export interface ChatHook {
  id: string;
  name: string;
  enabled: boolean;
  /** Command name without the leading !. */
  trigger: string;
  keywords: string[];
  url: string;
  method: "POST";
  secret: string;
  /** True in the settings view when a secret is stored. The secret itself is not sent to the window. */
  secretSet?: boolean;
  timeoutMs: number;
  cooldownSec: number;
  userCooldownSec: number;
  level: UserLevel;
  /** none posts nothing. chat posts a short reply when the service returns one. */
  reply: "none" | "chat";
  /** When true, the streamer's own chat lines can fire this hook. Default false. */
  allowBroadcaster: boolean;
  platforms: PlatformTarget;
}

export interface HookPayload {
  hook: string;
  platform: string;
  channel: string;
  user: { id: string; login: string; displayName: string; roles: string[] };
  message: string;
  text: string;
  timestamp: number;
  messageId: string;
}

export interface HookGate {
  platform: string;
  channel: string;
  botUserId: string;
  botLogin: string;
  channelLogin: string;
  broadcasterId: string;
  publishedAt: number;
  duplicate: boolean;
  /** This line is the echo of a message Rascal just posted. */
  sentByRascal?: boolean;
}

export type HookSkip = "own" | "bot" | "backfill" | "duplicate" | "role" | "cooldown" | "none";

export type HookDecision = { action: "fire"; hook: ChatHook; text: string } | { action: "skip"; reason: HookSkip };

export function normalizeHooks(value: unknown): ChatHook[] {
  if (!Array.isArray(value)) return [];
  const out: ChatHook[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const hook = normalizeHook(item);
    if (!hook || seen.has(hook.id)) continue;
    seen.add(hook.id);
    out.push(hook);
    if (out.length >= 20) break;
  }
  return out;
}

export function normalizeHook(value: unknown): ChatHook | null {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!row) return null;
  const name = cleanName(typeof row.name === "string" ? row.name : "");
  const trigger = triggerName(typeof row.trigger === "string" ? row.trigger : typeof row.command === "string" ? row.command : name);
  const url = checkHookUrl(typeof row.url === "string" ? row.url : "");
  if (!name || !trigger || !url) return null;
  const id = slug(typeof row.id === "string" ? row.id : name);
  return {
    id,
    name,
    enabled: row.enabled === true,
    trigger,
    keywords: normalizeKeywords(row.keywords),
    url,
    method: "POST",
    secret: typeof row.secret === "string" ? row.secret.slice(0, 200) : "",
    timeoutMs: clamp(row.timeoutMs ?? row.timeout_ms, 500, 15_000, 5_000),
    cooldownSec: clamp(row.cooldownSec ?? row.cooldown, 0, 86400, 5),
    userCooldownSec: clamp(row.userCooldownSec ?? row.userCooldown, 0, 86400, 15),
    level: hookLevel(row.level ?? row.roles),
    reply: row.reply === "chat" ? "chat" : "none",
    allowBroadcaster: row.allowBroadcaster === true,
    platforms: normalizePlatformTarget(row.platforms),
  };
}

/**
 * https to a public name, or http for this machine.
 * Set RASCAL_HOOK_PRIVATE_HTTP=1 to also allow http to an RFC1918 address or a
 * single-label name such as another container. Link-local, metadata, and
 * non-canonical IP spellings stay blocked. The connect path checks DNS again.
 */
export function checkHookUrl(value: string, allowPrivateHttp = process.env.RASCAL_HOOK_PRIVATE_HTTP === "1"): string {
  const text = value.trim();
  if (!text || text.length > 300) return "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "";
  }
  if (url.username || url.password) return "";
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  const hostname = normalizeHost(url.hostname);
  if (!hostname || isBlockedHookName(hostname) || isAmbiguousIp(hostname)) return "";
  const literal = classifyLiteral(hostname);
  if (literal) return literalAllowed(literal, url.protocol, allowPrivateHttp) ? url.toString() : "";
  if (url.protocol === "https:") return url.toString();
  if (hostname === "localhost") return url.toString();
  if (allowPrivateHttp && isSingleLabel(hostname)) return url.toString();
  return "";
}

/** Origin and path only. Query strings stay out of logs. */
export function redactHookUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid url";
  }
}

export interface SentLine {
  platform: string;
  text: string;
  at: number;
}

const SENT_LINE_MS = 120_000;

/** Remember a line Rascal posted, so the echo cannot fire a hook. */
export function noteOutgoing(sent: readonly SentLine[], platform: string, text: string, now: number): SentLine[] {
  const clean = text.trim().slice(0, HOOK_REPLY_LIMIT);
  const next = sent.filter((item) => now - item.at < SENT_LINE_MS && now - item.at >= 0);
  if (clean) next.push({ platform, text: clean, at: now });
  return next.slice(-100);
}

/** One matching echo is consumed, so a later identical line from a person can still fire. */
export function consumeOutgoing(sent: readonly SentLine[], platform: string, text: string, now: number): { sent: SentLine[]; matched: boolean } {
  const clean = text.trim().slice(0, HOOK_REPLY_LIMIT);
  const kept = sent.filter((item) => now - item.at < SENT_LINE_MS && now - item.at >= 0);
  const index = kept.findIndex((item) => item.platform === platform && item.text === clean);
  if (index < 0) return { sent: kept, matched: false };
  kept.splice(index, 1);
  return { sent: kept, matched: true };
}

export function decideChatHook(hooks: readonly ChatHook[], line: ChatLine, now: number, memory: RuntimeMemory, gate: HookGate): HookDecision {
  if (gate.sentByRascal) return { action: "skip", reason: "bot" };
  if (isSeparateBot(line, gate)) return { action: "skip", reason: "bot" };
  if (gate.publishedAt > 0 && now - gate.publishedAt > HOOK_BACKFILL_MS) return { action: "skip", reason: "backfill" };
  if (gate.duplicate) return { action: "skip", reason: "duplicate" };
  const found = findHook(hooks, line, gate.platform);
  if (!found) return { action: "skip", reason: "none" };
  if (isBroadcasterMessage(line, gate) && !found.hook.allowBroadcaster) return { action: "skip", reason: "own" };
  if (!roleAllows(found.hook.level, line.roles)) return { action: "skip", reason: "role" };
  const globalKey = `hook:${gate.platform}:${found.hook.id}`;
  const userKey = `${globalKey}:${line.userId}`;
  if ((memory.globalCooldown.get(globalKey) ?? 0) > now || (memory.userCooldown.get(userKey) ?? 0) > now) {
    return { action: "skip", reason: "cooldown" };
  }
  if (found.hook.cooldownSec > 0) memory.globalCooldown.set(globalKey, now + found.hook.cooldownSec * 1000);
  if (found.hook.userCooldownSec > 0) memory.userCooldown.set(userKey, now + found.hook.userCooldownSec * 1000);
  return { action: "fire", hook: found.hook, text: found.text };
}

export function buildHookPayload(hook: ChatHook, line: ChatLine, text: string, gate: HookGate, now: number): HookPayload {
  return {
    hook: hook.name,
    platform: gate.platform === "youtube" ? "youtube" : "twitch",
    channel: gate.channel,
    user: {
      id: line.userId,
      login: line.login,
      displayName: line.displayName,
      roles: payloadRoles(line, gate),
    },
    message: line.text.slice(0, 500),
    text: text.slice(0, 500),
    timestamp: now,
    messageId: line.messageId.slice(0, 80),
  };
}

export function parseHookReply(body: string, contentType: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  const json = contentType.toLowerCase().includes("json") || trimmed.startsWith("{");
  if (json) {
    try {
      const row = JSON.parse(trimmed) as { reply?: unknown };
      return typeof row.reply === "string" ? row.reply.trim().slice(0, HOOK_REPLY_LIMIT) : "";
    } catch {
      return "";
    }
  }
  if (/<\s*!doctype|<\s*html/i.test(trimmed)) return "";
  return trimmed.slice(0, HOOK_REPLY_LIMIT);
}

export function sampleHookPayload(hook: ChatHook): HookPayload {
  return {
    hook: hook.name,
    platform: "twitch",
    channel: "channel",
    user: { id: "0", login: "viewer", displayName: "Viewer", roles: ["everyone"] },
    message: `!${hook.trigger} hello`,
    text: "hello",
    timestamp: Date.now(),
    messageId: "test",
  };
}

function findHook(hooks: readonly ChatHook[], line: ChatLine, platform: string): { hook: ChatHook; text: string } | null {
  const command = splitTrigger(line.text);
  if (command) {
    const hook = hooks.find((item) => item.enabled && item.trigger === command.name && targetsPlatform(item.platforms, platform));
    return hook ? { hook, text: command.args } : null;
  }
  let best: { hook: ChatHook; text: string; length: number } | null = null;
  for (const hook of hooks) {
    if (!hook.enabled || !targetsPlatform(hook.platforms, platform)) continue;
    for (const keyword of hook.keywords) {
      const after = textAfterKeyword(line.text, keyword);
      if (after === null) continue;
      if (!best || keyword.length > best.length) best = { hook, text: after, length: keyword.length };
    }
  }
  return best ? { hook: best.hook, text: best.text } : null;
}

function textAfterKeyword(message: string, keyword: string): string | null {
  const phrase = keyword.trim();
  if (phrase.length < 2) return null;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const match = new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_])`, "iu").exec(message);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length;
  return message.slice(start).trim();
}

function splitTrigger(text: string): { name: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("!")) return null;
  const space = trimmed.search(/\s/);
  const name = triggerName(space === -1 ? trimmed : trimmed.slice(0, space));
  if (!name) return null;
  return { name, args: space === -1 ? "" : trimmed.slice(space + 1).trim() };
}

function payloadRoles(line: ChatLine, gate: HookGate): string[] {
  const roles = [...line.roles];
  if (isBroadcasterMessage(line, gate) && !roles.includes("broadcaster")) roles.push("broadcaster");
  return roles;
}

function isBroadcasterMessage(line: ChatLine, gate: HookGate): boolean {
  const login = line.login.toLowerCase();
  const channel = gate.channelLogin.toLowerCase();
  if (channel && login === channel) return true;
  if (gate.broadcasterId && line.userId === gate.broadcasterId) return true;
  return line.roles.includes("broadcaster");
}

function isBotIdentity(line: ChatLine, gate: HookGate): boolean {
  if (gate.botUserId && line.userId === gate.botUserId) return true;
  const bot = gate.botLogin.toLowerCase();
  return Boolean(bot) && line.login.toLowerCase() === bot;
}

/** The bot account is a different login from the streamer, so every line from it is the bot speaking. */
function isSeparateBot(line: ChatLine, gate: HookGate): boolean {
  if (!isBotIdentity(line, gate)) return false;
  if (gate.botUserId && gate.broadcasterId && gate.botUserId === gate.broadcasterId) return false;
  const bot = gate.botLogin.toLowerCase();
  const channel = gate.channelLogin.toLowerCase();
  if (bot && channel && bot === channel) return false;
  return true;
}

function roleAllows(required: UserLevel, roles: readonly UserLevel[]): boolean {
  if (required === "everyone") return true;
  if (roles.includes("broadcaster")) return true;
  if (required === "mod") return roles.includes("mod");
  if (required === "vip") return roles.includes("vip") || roles.includes("mod");
  return roles.includes("sub") || roles.includes("vip") || roles.includes("mod");
}

function hookLevel(value: unknown): UserLevel {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "mod" || text === "mods" || text === "moderator") return "mod";
  if (text === "sub" || text === "subs" || text === "subscriber") return "sub";
  if (text === "vip") return "vip";
  if (text === "broadcaster") return "broadcaster";
  return "everyone";
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 40);
}

function triggerName(value: string): string {
  return value.trim().replace(/^!+/, "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
}

function slug(value: string): string {
  const clean = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return clean || `hook${crypto.randomBytes(4).toString("hex")}`;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
