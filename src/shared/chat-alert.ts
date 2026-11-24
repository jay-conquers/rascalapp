/** New-message chime. Off until the streamer turns it on. */
export interface ChatAlertSettings {
  enabled: boolean;
  /** 0 to 1. */
  volume: number;
  /** Minimum gap between chimes. */
  cooldownMs: number;
  /** Subs, raids, cheers, and other notices. Off by default. */
  notices: boolean;
  /** Empty uses the built-in chime. A local audio file only. */
  soundPath: string;
}

export interface AlertMessage {
  platform: string;
  username: string;
  displayName: string;
  authorId?: string;
  kind?: string;
  noticeKind?: string;
  timestamp: number;
}

export interface AlertIdentity {
  /** The streamer's logins, display names, and channel ids. */
  selfNames: string[];
  selfIds: string[];
  /** Accounts Rascal posts as: the bot login and its user or channel id. */
  botNames: string[];
  botIds: string[];
}

export type AlertSkip =
  | "disabled"
  | "own"
  | "bot"
  | "duplicate"
  | "backfill"
  | "notice"
  | "cooldown";

export interface AlertDecision {
  play: boolean;
  reason: AlertSkip | "play";
}

/** Messages older than this on arrival are treated as connect/reconnect history. */
export const CHAT_ALERT_BACKFILL_MS = 12_000;

export function defaultChatAlert(): ChatAlertSettings {
  return { enabled: false, volume: 0.7, cooldownMs: 2_000, notices: false, soundPath: "" };
}

export function mergeChatAlert(current: ChatAlertSettings | undefined, patch: unknown): ChatAlertSettings {
  const base = current ?? defaultChatAlert();
  const row = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
  const volume = typeof row.volume === "number" && Number.isFinite(row.volume) ? row.volume : base.volume;
  const cooldown = typeof row.cooldownMs === "number" && Number.isFinite(row.cooldownMs) ? row.cooldownMs : base.cooldownMs;
  const requestedPath = typeof row.soundPath === "string" ? row.soundPath : base.soundPath;
  return {
    enabled: typeof row.enabled === "boolean" ? row.enabled : base.enabled === true,
    volume: clamp(volume, 0, 1),
    cooldownMs: clamp(Math.round(cooldown), 0, 60_000),
    notices: typeof row.notices === "boolean" ? row.notices : base.notices === true,
    soundPath: isSafeSoundPath(requestedPath) ? requestedPath.trim() : "",
  };
}

export function isSafeSoundPath(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 500 || text.includes("\0")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return false;
  if (text.includes("..") || text.includes("//")) return false;
  if (!/\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(text)) return false;
  return text.startsWith("/") || /^[A-Za-z]:\\/.test(text);
}

/** First bytes of a local audio file. Remote payloads never reach this. */
export function sniffAudio(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const head = ascii(bytes, 0, 4);
  if (head === "RIFF" && ascii(bytes, 8, 12) === "WAVE") return "audio/wav";
  if (head === "OggS") return "audio/ogg";
  if (head === "fLaC") return "audio/flac";
  if (head === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(bytes, 4, 8) === "ftyp") return "audio/mp4";
  return null;
}

/**
 * A short original chime: two quiet sines with a fast decay.
 * Generated here so the app does not ship someone else's recording.
 */
export function buildChimeWav(): Uint8Array {
  const sampleRate = 22050;
  const count = Math.floor(sampleRate * 0.32);
  const pcm = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 7) * (1 - Math.exp(-t * 50));
    const sample = Math.sin(2 * Math.PI * 880 * t) * 0.5 + Math.sin(2 * Math.PI * 1318.5 * t) * 0.22;
    const shaped = Math.max(-1, Math.min(1, sample * env));
    pcm[i] = Math.round(shaped * 12000);
  }
  const dataBytes = pcm.length * 2;
  const buffer = new Uint8Array(44 + dataBytes);
  const view = new DataView(buffer.buffer);
  writeText(buffer, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(buffer, 8, "WAVE");
  writeText(buffer, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(buffer, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i] ?? 0, true);
  return buffer;
}

export function shouldPlayChatAlert(input: {
  settings: ChatAlertSettings;
  message: AlertMessage;
  identity: AlertIdentity;
  now: number;
  lastPlayedAt: number | null;
  duplicate: boolean;
}): AlertDecision {
  const { settings, message, identity, now } = input;
  if (!settings.enabled) return { play: false, reason: "disabled" };
  if (input.duplicate) return { play: false, reason: "duplicate" };
  if (now - message.timestamp > CHAT_ALERT_BACKFILL_MS) return { play: false, reason: "backfill" };
  if (matchesList(message, identity.botNames, identity.botIds)) return { play: false, reason: "bot" };
  if (matchesList(message, identity.selfNames, identity.selfIds)) return { play: false, reason: "own" };
  const notice = Boolean(message.noticeKind) || message.kind === "system";
  if (notice && !settings.notices) return { play: false, reason: "notice" };
  if (input.lastPlayedAt !== null && now - input.lastPlayedAt < settings.cooldownMs) {
    return { play: false, reason: "cooldown" };
  }
  return { play: true, reason: "play" };
}

function matchesList(message: AlertMessage, namesIn: string[], idsIn: string[]): boolean {
  const ids = new Set(idsIn.map((id) => id.trim()).filter(Boolean));
  if (message.authorId && ids.has(message.authorId)) return true;
  const names = new Set(namesIn.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const login = message.username.trim().toLowerCase();
  const display = message.displayName.trim().toLowerCase();
  return (login !== "" && names.has(login)) || (display !== "" && names.has(display));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end && i < bytes.length; i++) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

function writeText(buffer: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) buffer[offset + i] = text.charCodeAt(i);
}
