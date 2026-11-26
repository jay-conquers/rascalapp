import { asRecord } from "./record";

/** A person who can be inserted as @name. */
export interface ChatterName {
  name: string;
  login?: string;
}

/**
 * One chat site's names for the composer.
 * Twitch fills `listed` from Helix Get Chatters and `session` from people who spoke.
 * YouTube has no viewer-list API, so `listed` stays empty and `session` is the whole list.
 * A future Kick adapter uses this same shape and can supply session names only.
 */
export interface ChatterDirectory {
  id: string;
  label: string;
  listed: readonly ChatterName[];
  session: readonly ChatterName[];
}

export interface MentionSuggestion {
  platform: string;
  label: string;
  name: string;
}

export interface MentionRoster {
  active: { id: string; label: string }[];
  suggestions: MentionSuggestion[];
}

export interface MentionToken {
  start: number;
  query: string;
}

const SESSION_CAP = 500;

/** Names seen in chat this session, per platform id. Oldest names fall off. */
export class SessionChatters {
  private readonly platforms = new Map<string, ChatterName[]>();

  note(platform: string, chatter: ChatterName): void {
    const name = chatter.name.trim();
    const login = chatter.login?.trim();
    if (!platform.trim() || (!name && !login)) return;
    const key = (login || name).toLowerCase();
    const list = this.platforms.get(platform) ?? [];
    const next = list.filter((item) => (item.login || item.name).toLowerCase() !== key);
    next.push({ name: name || login || "", login: login || undefined });
    if (next.length > SESSION_CAP) next.splice(0, next.length - SESSION_CAP);
    this.platforms.set(platform, next);
  }

  list(platform: string): ChatterName[] {
    return [...(this.platforms.get(platform) ?? [])];
  }

  clear(platform: string): void {
    this.platforms.delete(platform);
  }
}

/** Chat is up. `live` is YouTube's connected state. `connected` is Twitch's. */
export function chatFeedConnected(state: string): boolean {
  return state === "connected" || state === "live" || state === "reconnecting";
}

export function mentionName(chatter: ChatterName): string {
  return chatter.name.trim() || chatter.login?.trim() || "";
}

/**
 * Filtered @ suggestions. Session names come before the viewer list.
 * Platforms are interleaved so a second site is not pushed off the end.
 */
export function mentionSuggestions(
  directories: readonly ChatterDirectory[],
  query: string,
  limit = 8,
): MentionSuggestion[] {
  const needle = query.trim().toLowerCase().replace(/^@/, "");
  const pools = directories.map((directory) => ({
    directory,
    names: mergeNames(directory.session, directory.listed).filter((chatter) => matchesChatter(chatter, needle)),
  }));
  const cursors = pools.map(() => 0);
  const seen = new Set<string>();
  const out: MentionSuggestion[] = [];
  let progressed = true;
  while (out.length < limit && progressed) {
    progressed = false;
    for (let i = 0; i < pools.length; i += 1) {
      const pool = pools[i];
      if (!pool) continue;
      while ((cursors[i] ?? 0) < pool.names.length && out.length < limit) {
        const cursor = cursors[i] ?? 0;
        const chatter = pool.names[cursor];
        cursors[i] = cursor + 1;
        if (!chatter) continue;
        const name = mentionName(chatter);
        if (!name) continue;
        const key = `${pool.directory.id}:${(chatter.login || name).toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ platform: pool.directory.id, label: pool.directory.label, name });
        progressed = true;
        break;
      }
    }
  }
  return out;
}

export function mentionToken(text: string, cursor: number): MentionToken | null {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length) return null;
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, cursor));
  if (!match) return null;
  const query = match[1] ?? "";
  return { start: cursor - query.length - 1, query };
}

export function applyMention(text: string, start: number, cursor: number, name: string): { text: string; cursor: number } {
  const clean = name.trim();
  if (!clean || start < 0 || start > cursor || cursor > text.length) return { text, cursor };
  const insert = `@${clean} `;
  return { text: text.slice(0, start) + insert + text.slice(cursor), cursor: start + insert.length };
}

export function stepMention(index: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  const next = index + direction;
  if (next < 0) return count - 1;
  if (next >= count) return 0;
  return next;
}

/** Helix Get Chatters `data` rows. Unknown shapes are skipped. */
export function parseChatterRows(data: unknown): ChatterName[] {
  if (!Array.isArray(data)) return [];
  const out: ChatterName[] = [];
  for (const row of data) {
    const record = asRecord(row);
    if (!record) continue;
    const login = typeof record.user_login === "string" ? record.user_login.trim() : "";
    const name = typeof record.user_name === "string" ? record.user_name.trim() : "";
    if (!login && !name) continue;
    out.push({ name: name || login, login: login || undefined });
  }
  return out;
}

/** Helix pagination cursor. An empty string means there is no further page. */
export function chatterPageCursor(body: unknown): string {
  const pagination = asRecord(asRecord(body)?.pagination);
  return typeof pagination?.cursor === "string" ? pagination.cursor : "";
}

function mergeNames(session: readonly ChatterName[], listed: readonly ChatterName[]): ChatterName[] {
  const out: ChatterName[] = [];
  const seen = new Set<string>();
  const push = (chatter: ChatterName) => {
    const name = mentionName(chatter);
    if (!name) return;
    const key = (chatter.login || name).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(chatter);
  };
  for (let i = session.length - 1; i >= 0; i -= 1) {
    const chatter = session[i];
    if (chatter) push(chatter);
  }
  for (const chatter of listed) push(chatter);
  return out;
}

function matchesChatter(chatter: ChatterName, needle: string): boolean {
  if (!needle) return true;
  const name = chatter.name.trim().toLowerCase();
  const login = chatter.login?.trim().toLowerCase() ?? "";
  return name.startsWith(needle) || login.startsWith(needle);
}
