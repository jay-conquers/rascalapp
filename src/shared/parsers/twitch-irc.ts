import { colorForName } from "../emote-url";
import { twitchEmoteUrl } from "../twitch-emotes";
import type { NoticeKind } from "../feed-toggles";
import type { ChatBadge, ChatMessage, Segment } from "../types";

export interface IrcEvent {
  type:
    | "privmsg"
    | "usernotice"
    | "notice"
    | "ping"
    | "pong"
    | "clearchat"
    | "clearmsg"
    | "roomstate"
    | "reconnect"
    | "welcome"
    | "other";
  message?: ChatMessage;
  pingPayload?: string;
  roomId?: string;
  channel?: string;
  targetUser?: string;
  targetMsgId?: string;
  clearAll?: boolean;
  command?: string;
}

const BADGE_MAP: Record<string, { kind: ChatBadge["kind"]; label: string }> = {
  moderator: { kind: "mod", label: "MOD" },
  vip: { kind: "vip", label: "VIP" },
  subscriber: { kind: "sub", label: "SUB" },
  founder: { kind: "sub", label: "SUB" },
  broadcaster: { kind: "broadcaster", label: "HOST" },
  premium: { kind: "prime", label: "PRIME" },
  turbo: { kind: "turbo", label: "TURBO" },
  bits: { kind: "bits", label: "BITS" },
};

/** Incremental IRC line splitter. Twitch frames with CRLF; lone LF is accepted. */
export class IrcFramer {
  private buffer = "";

  reset(): void {
    this.buffer = "";
  }

  push(chunk: string): string[] {
    this.buffer += chunk;
    if (this.buffer.length > 256_000) this.buffer = this.buffer.slice(-64_000);
    const lines: string[] = [];
    while (true) {
      const idx = this.buffer.indexOf("\n");
      if (idx === -1) break;
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      lines.push(line);
    }
    return lines;
  }
}

export function unescapeTag(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && i + 1 < value.length) {
      const next = value[++i];
      if (next === "s") out += " ";
      else if (next === ":") out += ";";
      else if (next === "r") out += "\r";
      else if (next === "n") out += "\n";
      else out += next;
    } else {
      out += value[i];
    }
  }
  return out;
}

export function parseTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  if (!raw) return tags;
  for (const part of raw.split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = eq === -1 ? part : part.slice(0, eq);
    tags[key] = eq === -1 ? "" : unescapeTag(part.slice(eq + 1));
  }
  return tags;
}

export function parseIrcLine(line: string): IrcEvent {
  let rest = line.trim();
  if (!rest) return { type: "other", command: "" };

  let tags: Record<string, string> = {};
  if (rest.startsWith("@")) {
    const space = rest.indexOf(" ");
    if (space === -1) return { type: "other", command: "" };
    tags = parseTags(rest.slice(1, space));
    rest = rest.slice(space + 1);
  }

  let prefix = "";
  if (rest.startsWith(":")) {
    const space = rest.indexOf(" ");
    if (space === -1) return { type: "other", command: "" };
    prefix = rest.slice(1, space);
    rest = rest.slice(space + 1);
  }

  let trailing: string | undefined;
  const trailingAt = rest.indexOf(" :");
  if (trailingAt !== -1) {
    trailing = rest.slice(trailingAt + 2);
    rest = rest.slice(0, trailingAt);
  }
  const parts = rest.split(" ").filter((part) => part.length > 0);
  const command = (parts[0] ?? "").toUpperCase();
  const params = parts.slice(1);
  const channel = channelFrom(params[0]);

  if (command === "PING") {
    return { type: "ping", pingPayload: trailing ?? params[0] ?? "tmi.twitch.tv", command };
  }
  if (command === "PONG") return { type: "pong", command };
  if (command === "RECONNECT") return { type: "reconnect", command };
  if (command === "001") return { type: "welcome", command };
  if (command === "ROOMSTATE") {
    return { type: "roomstate", command, channel, roomId: tags["room-id"] || undefined };
  }
  if (command === "CLEARCHAT") {
    const targetUser = (trailing ?? "").replace(/^#/, "").trim();
    return {
      type: "clearchat",
      command,
      channel,
      targetUser: targetUser || undefined,
      clearAll: !targetUser,
    };
  }
  if (command === "CLEARMSG") {
    return {
      type: "clearmsg",
      command,
      channel,
      targetMsgId: tags["target-msg-id"] || undefined,
      targetUser: tags.login || undefined,
    };
  }
  if (command === "PRIVMSG" || command === "USERNOTICE" || command === "NOTICE") {
    return {
      type: command === "PRIVMSG" ? "privmsg" : command === "USERNOTICE" ? "usernotice" : "notice",
      command,
      channel,
      message: messageFrom({ command, tags, prefix, channel, trailing: trailing ?? "" }),
    };
  }
  return { type: "other", command, channel };
}

function messageFrom(input: {
  command: string;
  tags: Record<string, string>;
  prefix: string;
  channel?: string;
  trailing: string;
}): ChatMessage {
  const nick = input.prefix.split("!")[0] || "twitch";
  const login = (input.tags.login || nick).toLowerCase();
  const displayName = input.tags["display-name"] || nick || login;
  let body = input.trailing;
  let kind: ChatMessage["kind"] = "chat";
  if (body.startsWith("\u0001ACTION ") && body.endsWith("\u0001")) {
    body = body.slice(8, -1);
    kind = "action";
  }
  const notice = input.command === "USERNOTICE" ? input.tags["system-msg"] || "Channel notice" : undefined;
  if (input.command === "NOTICE" || input.command === "USERNOTICE") kind = "system";

  const plain = notice && body ? `${notice} — ${body}` : notice || body;
  const segments = body ? segmentsFromEmotes(body, input.tags.emotes) : [];
  const timestamp = Number(input.tags["tmi-sent-ts"]);
  const noticeKind = classifyIrcNotice(input.command, input.tags);
  const bits = Number(input.tags.bits);
  const amount = noticeKind === "cheer" && Number.isInteger(bits) && bits > 0 ? `${bits} bits` : undefined;
  return {
    id: input.tags.id || `twitch-${login}-${timestamp || Date.now()}-${hashText(plain)}`,
    platform: "twitch",
    channel: (input.channel || "").replace(/^#/, ""),
    username: login,
    displayName,
    authorId: input.tags["user-id"] || undefined,
    color: colorForName(displayName, input.tags.color),
    badges: badgesFrom(input.tags),
    segments,
    plainText: plain,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
    kind,
    notice,
    ...(noticeKind ? { noticeKind } : {}),
    ...(amount ? { amount } : {}),
  };
}

/** Map Twitch IRC msg-id values that the public chat actually sends. Unknown ids stay ordinary notices. */
export function classifyIrcNotice(command: string, tags: Record<string, string>): NoticeKind | undefined {
  const bits = Number(tags.bits);
  if ((command === "PRIVMSG" || command === "USERNOTICE") && Number.isInteger(bits) && bits > 0) return "cheer";
  if (command !== "USERNOTICE") return undefined;
  const id = (tags["msg-id"] || "").toLowerCase();
  const category = (tags["msg-param-category"] || "").toLowerCase();
  if (id === "sub") return "sub";
  if (id === "resub") return "resub";
  if (
    id === "subgift" ||
    id === "anonsubgift" ||
    id === "submysterygift" ||
    id === "giftpaidupgrade" ||
    id === "anongiftpaidupgrade" ||
    id === "rewardgift"
  ) {
    return "subgift";
  }
  if (id === "primepaidupgrade") return "sub";
  if (id === "raid" || id === "unraid") return "raid";
  if (id === "watchstreak" || id === "watch_streak" || id === "watch-streak") return "watch-streak";
  if (id === "viewermilestone" && category.includes("watch")) return "watch-streak";
  if (id === "modiversary" || id === "mod_anniversary") return "mod-anniversary";
  return undefined;
}

export function badgesFrom(tags: Record<string, string>): ChatBadge[] {
  const months = new Map<string, string>();
  for (const piece of (tags["badge-info"] || "").split(",")) {
    const [set, version] = piece.split("/");
    if (set && version) months.set(set, version);
  }
  const badges: ChatBadge[] = [];
  const seen = new Set<string>();
  for (const piece of (tags.badges || "").split(",")) {
    if (!piece) continue;
    const [set, version] = piece.split("/");
    if (!set || !version || seen.has(`${set}/${version}`)) continue;
    seen.add(`${set}/${version}`);
    const mapped = BADGE_MAP[set];
    const detail = set === "subscriber" || set === "founder" ? months.get(set) : undefined;
    badges.push({
      kind: mapped?.kind ?? "other",
      label: mapped?.label ?? set.toUpperCase(),
      ...(detail ? { detail } : {}),
      set,
      version,
    });
  }
  if (tags.mod === "1" && !badges.some((badge) => badge.set === "moderator")) {
    badges.unshift({ kind: "mod", label: "MOD", set: "moderator", version: "1" });
  }
  return badges;
}

export function segmentsFromEmotes(text: string, emoteTag: string | undefined): Segment[] {
  const ranges: { id: string; start: number; end: number }[] = [];
  if (emoteTag) {
    for (const piece of emoteTag.split("/")) {
      const colon = piece.indexOf(":");
      if (colon === -1) continue;
      const id = piece.slice(0, colon);
      if (!twitchEmoteUrl(id)) continue;
      for (const span of piece.slice(colon + 1).split(",")) {
        const [rawStart, rawEnd] = span.split("-");
        const start = Number(rawStart);
        const end = Number(rawEnd);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= text.length) {
          continue;
        }
        ranges.push({ id, start, end });
      }
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) segments.push({ type: "text", text: text.slice(cursor, range.start) });
    const name = text.slice(range.start, range.end + 1);
    segments.push({
      type: "emote",
      text: name,
      url: twitchEmoteUrl(range.id) ?? "",
      source: "twitch",
    });
    cursor = range.end + 1;
  }
  if (cursor < text.length) segments.push({ type: "text", text: text.slice(cursor) });
  if (segments.length === 0) segments.push({ type: "text", text });
  return segments;
}

function channelFrom(param: string | undefined): string | undefined {
  if (!param) return undefined;
  return param.replace(/^#/, "") || undefined;
}

function hashText(text: string): string {
  let hash = 0;
  for (const char of text) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}
