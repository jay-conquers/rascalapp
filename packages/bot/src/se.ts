import { commandName, type BotCommand, type BotTimer, type UserLevel } from "./model.ts";

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
  const response = text(row.response) || text(row.reply);
  if (!name || !response) return null;
  const cooldown = asRecord(row.cooldown);
  const aliases = Array.isArray(row.aliases) ? row.aliases.map((item) => commandName(text(item))).filter((item) => item && item !== name) : [];
  return {
    id: text(row._id) || name,
    name,
    response: response.slice(0, 450),
    enabled: row.enabled !== false,
    cooldownSec: numberOr(cooldown?.global, numberOr(row.cooldown, 5)),
    userCooldownSec: numberOr(cooldown?.user, 15),
    level: mapLevel(row.accessLevel),
    aliases,
    count: numberOr(row.count, 0),
    platforms: "twitch",
  };
}

function mapTimer(value: unknown): BotTimer | null {
  const row = asRecord(value);
  if (!row) return null;
  const messages = Array.isArray(row.messages) ? row.messages.map(text).filter(Boolean) : [];
  const message = messages[0] || text(row.message) || text(row.response);
  const name = text(row.name) || "timer";
  if (!message) return null;
  const interval = numberOr(row.onlineInterval, numberOr(row.interval, 600));
  return {
    id: text(row._id) || commandName(name) || "timer",
    name: name.slice(0, 40),
    enabled: row.enabled !== false,
    message: message.slice(0, 450),
    intervalSec: Math.min(86400, Math.max(15, interval)),
    minChatLines: numberOr(row.chatLines, 0),
    linesSince: 0,
    lastFiredAt: 0,
    platforms: "twitch",
  };
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

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOr(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
