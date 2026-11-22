export interface TtsItem {
  id: string;
  platform: string;
  user: string;
  text: string;
}

export interface TtsRecent {
  t: string;
  result: string;
  platform: string;
  user: string;
  text: string;
  reason: string;
}

export interface TtsState {
  paused: boolean;
  hold: boolean;
  status: { twitch: string; youtube: string; askjeeves: string; youtube_subs: string };
  overlays_connected: number;
  current: TtsItem | null;
  queue: TtsItem[];
  pending: TtsItem[];
  stats: {
    accepted: number;
    blocked: number;
    cooldown: number;
    played: number;
    skipped: number;
    expired: number;
    failed: number;
  };
  recent: TtsRecent[];
}

export interface TtsShortcutState {
  enabled: boolean;
  supported: boolean;
  detail: string;
}

export interface TtsPanel {
  baseUrl: string;
  ok: boolean;
  error: string;
  state: TtsState | null;
  shortcuts: TtsShortcutState;
}

export function parseTtsState(value: unknown): TtsState | null {
  const row = asRecord(value);
  if (!row) return null;
  if (typeof row.paused !== "boolean" && !Array.isArray(row.queue) && !Array.isArray(row.pending)) return null;
  const status = asRecord(row.status) ?? {};
  const stats = asRecord(row.stats) ?? {};
  return {
    paused: row.paused === true,
    hold: row.hold === true,
    status: {
      twitch: text(status.twitch),
      youtube: text(status.youtube),
      askjeeves: text(status.askjeeves),
      youtube_subs: text(status.youtube_subs),
    },
    overlays_connected: numberOr(row.overlays_connected),
    current: asItem(row.current, 0),
    queue: asItems(row.queue),
    pending: asItems(row.pending),
    stats: {
      accepted: numberOr(stats.accepted),
      blocked: numberOr(stats.blocked),
      cooldown: numberOr(stats.cooldown),
      played: numberOr(stats.played),
      skipped: numberOr(stats.skipped),
      expired: numberOr(stats.expired),
      failed: numberOr(stats.failed),
    },
    recent: asRecent(row.recent),
  };
}

export function safeTtsId(id: string): string | null {
  const trimmed = id.trim();
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(trimmed)) return null;
  if (trimmed.includes("..")) return null;
  return trimmed;
}

function asItems(value: unknown): TtsItem[] {
  if (!Array.isArray(value)) return [];
  const items: TtsItem[] = [];
  value.forEach((item, index) => {
    const parsed = asItem(item, index);
    if (parsed) items.push(parsed);
  });
  return items;
}

function asItem(value: unknown, index: number): TtsItem | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : String(index);
  return {
    id,
    platform: text(row.platform),
    user: text(row.user) || text(row.username),
    text: text(row.text) || text(row.message),
  };
}

function asRecent(value: unknown): TtsRecent[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-80).map((item) => {
    const row = asRecord(item) ?? {};
    return {
      t: formatWhen(row.t),
      result: text(row.result),
      platform: text(row.platform),
      user: text(row.user),
      text: text(row.text),
      reason: text(row.reason),
    };
  });
}

function formatWhen(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 40);
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : value;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toISOString();
  }
  return "";
}

function numberOr(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
