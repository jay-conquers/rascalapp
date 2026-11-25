import { normalizeKeywords } from "./keywords.ts";
import { commandName, normalizeCommand, normalizeTimer, type BotCommand, type BotTimer, type TimerMode, type UserLevel } from "./model.ts";
import { asRecord } from "../../../src/shared/record.ts";

/** Map a StreamElements commands/timers payload. The JWT itself is never read here. */
export function importStreamElements(commandsPayload: unknown, timersPayload: unknown): { commands: BotCommand[]; timers: BotTimer[] } {
  return {
    commands: commandRows(commandsPayload).map(mapCommand).filter((item): item is BotCommand => item !== null),
    timers: timerRows(timersPayload).map(mapTimer).filter((item): item is BotTimer => item !== null),
  };
}

export function channelIdFromJwt(jwt: string): string {
  const parts = jwt.split(".");
  if (parts.length < 2) return "";
  try {
    const json = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")) as { channel?: unknown; channelId?: unknown };
    const id = typeof json.channel === "string" ? json.channel : typeof json.channelId === "string" ? json.channelId : "";
    return /^[a-f0-9]{24}$/i.test(id) ? id : "";
  } catch {
    return "";
  }
}

function mapCommand(value: unknown): BotCommand | null {
  const row = asRecord(value);
  if (!row) return null;
  const name = commandName(text(row.command) || text(row.name));
  const response = commandResponse(row);
  if (!name || !response) return null;
  const cooldown = asRecord(row.cooldown);
  const aliases = uniqueNames(nameList(row.aliases), name);
  const keywords = normalizeKeywords(row.keywords);
  const online = typeof row.enabledOnline === "boolean" ? row.enabledOnline : true;
  const offline = typeof row.enabledOffline === "boolean" ? row.enabledOffline : true;
  return normalizeCommand({
    id: text(row._id) || name,
    name,
    response,
    enabled: row.enabled !== false && (online || offline),
    cooldownSec: numberOr(cooldown?.global, numberOr(row.cooldown, 5)),
    userCooldownSec: numberOr(cooldown?.user, 15),
    level: mapLevel(row.accessLevel),
    aliases,
    keywords,
    count: numberOr(row.count, 0),
    platforms: "twitch",
  });
}

function mapTimer(value: unknown): BotTimer | null {
  const row = asRecord(value);
  if (!row) return null;
  const messages = timerMessages(row);
  const name = text(row.name) || "timer";
  if (messages.length === 0) return null;
  const online = asRecord(row.online);
  const offline = asRecord(row.offline);
  const hasSchedule = Boolean(online || offline || typeof row.enabledOnline === "boolean" || typeof row.enabledOffline === "boolean");
  const onlineEnabled = flag(online?.enabled, flag(row.enabledOnline, true));
  const offlineEnabled = flag(offline?.enabled, flag(row.enabledOffline, hasSchedule ? false : true));
  let mode: TimerMode = "both";
  let enabled = row.enabled !== false;
  if (hasSchedule) {
    if (onlineEnabled && offlineEnabled) mode = "both";
    else if (offlineEnabled) mode = "offline";
    else if (onlineEnabled) mode = "live";
    else {
      mode = "live";
      enabled = false;
    }
  }
  // Nested online.interval / offline.interval are minutes (StreamElements API).
  // Flat onlineInterval / interval are seconds, which is what earlier Rascal imports stored.
  const liveSeconds = online ? minutesToSeconds(online.interval, 5) : secondsField(row.onlineInterval, row.interval, 600);
  const offlineSeconds = offline ? minutesToSeconds(offline.interval, 30) : secondsField(row.offlineInterval, liveSeconds, liveSeconds);
  const lines = numberOr(row.chatLines, numberOr(row.minChatLines, 0));
  return normalizeTimer({
    id: text(row._id) || commandName(name) || "timer",
    name: name.slice(0, 40),
    enabled,
    messages,
    message: messages[0],
    mode,
    intervalSec: liveSeconds,
    offlineIntervalSec: offlineSeconds,
    minChatLines: lines,
    offlineMinChatLines: lines,
    linesSince: 0,
    lastFiredAt: 0,
    offlineLinesSince: 0,
    offlineLastFiredAt: 0,
    platforms: "twitch",
  });
}

function mapLevel(value: unknown): UserLevel {
  const level = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(level) || level <= 100) return "everyone";
  if (level < 300) return "sub";
  if (level < 400) return "vip";
  if (level < 1000) return "mod";
  return "broadcaster";
}

function commandRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const row = asRecord(value);
  if (Array.isArray(row?.commands)) return row.commands;
  if (Array.isArray(row?.docs)) return row.docs;
  return [];
}

function timerRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const row = asRecord(value);
  if (Array.isArray(row?.timers)) return row.timers;
  if (Array.isArray(row?.docs)) return row.docs;
  return [];
}

function timerMessages(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (value: unknown): void => {
    const line = messageText(value);
    if (!line || out.includes(line) || out.length >= 30) return;
    out.push(line.slice(0, 450));
  };
  if (Array.isArray(row.messages)) {
    for (const item of row.messages) push(item);
  }
  if (out.length === 0) push(row.message);
  if (out.length === 0) push(row.response);
  return out;
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const row = asRecord(value);
  if (!row || row.enabled === false) return "";
  return text(row.message) || text(row.text) || text(row.content);
}

function commandResponse(row: Record<string, unknown>): string {
  const many = responseList(row.responses).length > 0 ? responseList(row.responses) : responseList(row.response);
  if (many.length > 1 && many.every((line) => !/[{}|]/.test(line))) return `{random:${many.join("|")}}`;
  if (many.length === 1) return many[0] ?? "";
  return text(row.response) || text(row.reply);
}

function responseList(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.map((item) => messageText(item)).filter(Boolean);
}

function nameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => commandName(typeof item === "string" ? item : text(asRecord(item)?.name) || text(asRecord(item)?.command) || text(asRecord(item)?.alias)));
}

function uniqueNames(names: string[], command: string): string[] {
  const out: string[] = [];
  for (const name of names) {
    if (!name || name === command || out.includes(name)) continue;
    out.push(name);
  }
  return out;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function minutesToSeconds(value: unknown, fallbackMinutes: number): number {
  return Math.min(86400, Math.max(15, numberOr(value, fallbackMinutes) * 60));
}

function secondsField(primary: unknown, secondary: unknown, fallback: number): number {
  const value = typeof primary === "number" || typeof primary === "string" ? numberOr(primary, Number.NaN) : Number.NaN;
  const picked = Number.isFinite(value) ? value : typeof secondary === "number" ? secondary : fallback;
  return Math.min(86400, Math.max(15, Math.round(picked)));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOr(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

