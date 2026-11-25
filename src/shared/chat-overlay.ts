import { overlayEmoteAllowed, safeEmoteUrl } from "./emote-url";
import type { ChatBadge, ChatMessage, Platform } from "./types";
import { asRecord } from "./record";

export const DEFAULT_TTS_BASE = "http://127.0.0.1:17761";
export const DEFAULT_FONT = "Noto Sans, Liberation Sans, DejaVu Sans, sans-serif";

/** Bots that should not appear on stream. Add the TTS bot's login if it posts into chat. */
export const DEFAULT_HIDDEN_USERS = [
  "streamelements",
  "nightbot",
  "botrix",
  "fossabot",
  "streamlabs",
  "soundalerts",
];

export interface ChatOverlayStyle {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  useAuthorColor: boolean;
  nameColor: string;
  background: "none" | "pill";
  backgroundColor: string;
  backgroundOpacity: number;
  outline: boolean;
  shadow: boolean;
  maxMessages: number;
  /** Seconds before a line leaves. 0 keeps the line until it scrolls off. */
  lifetimeSeconds: number;
  /**
   * bottom: packed at the bottom, newest at the bottom.
   * down: start at the top and grow downward; when the box fills, the oldest leave the top.
   * top: newest message first, packed at the top.
   */
  direction: ChatDirection;
  alignment: "left" | "center" | "right";
  widthPercent: number;
  showPlatformIcons: boolean;
  showBadges: boolean;
  hiddenUsers: string[];
  hideCommands: boolean;
  box: ChatBox;
}

export type ChatDirection = "bottom" | "down" | "top";

export function chatFlow(direction: ChatDirection): { reverse: boolean; anchor: "start" | "end"; scrollToEnd: boolean } {
  if (direction === "top") return { reverse: true, anchor: "start", scrollToEnd: false };
  if (direction === "down") return { reverse: false, anchor: "start", scrollToEnd: true };
  return { reverse: false, anchor: "end", scrollToEnd: false };
}

export const CHAT_BOX_PRESETS = ["right-column", "left-column", "bottom-strip", "full", "custom"] as const;
export type ChatBoxPreset = (typeof CHAT_BOX_PRESETS)[number];

/** Where the chat sits on the 1920×1080 overlay. */
export interface ChatBox {
  preset: ChatBoxPreset;
  /** Column width, or strip height, as a percent of that canvas axis. */
  sizePercent: number;
  marginPercent: number;
  x: number;
  y: number;
  width: number;
  height: number;
  unit: "percent" | "px";
}

export interface ChatBoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ChatOverlayFile {
  ttsBaseUrl: string;
  ttsShortcuts: boolean;
  presets: ChatOverlayStyle[];
}

export interface OverlayLine {
  id: string;
  platform: Platform;
  name: string;
  nameColor: string;
  badges: { url: string }[];
  parts: { type: "text" | "emote"; text: string; url?: string; source?: string }[];
  action: boolean;
  amount?: string;
  notice?: string;
  opacity: number;
}

export function defaultPreset(id = "default"): ChatOverlayStyle {
  const vertical = id === "vertical";
  return {
    id,
    name: vertical ? "Vertical" : id === "default" ? "Main" : id,
    fontFamily: DEFAULT_FONT,
    fontSize: vertical ? 34 : 28,
    textColor: "#f4f6fb",
    useAuthorColor: true,
    nameColor: "#ffffff",
    background: "pill",
    backgroundColor: "#000000",
    backgroundOpacity: 0.5,
    outline: true,
    shadow: true,
    maxMessages: vertical ? 8 : 14,
    lifetimeSeconds: vertical ? 16 : 20,
    direction: "bottom",
    alignment: "left",
    widthPercent: vertical ? 78 : 32,
    showPlatformIcons: true,
    showBadges: true,
    hiddenUsers: [...DEFAULT_HIDDEN_USERS],
    hideCommands: true,
    box: vertical
      ? { preset: "left-column", sizePercent: 78, marginPercent: 0, x: 0, y: 0, width: 78, height: 100, unit: "percent" }
      : { preset: "right-column", sizePercent: 15, marginPercent: 0, x: 85, y: 0, width: 15, height: 100, unit: "percent" },
  };
}

export function defaultChatOverlayFile(): ChatOverlayFile {
  return {
    ttsBaseUrl: DEFAULT_TTS_BASE,
    ttsShortcuts: false,
    presets: [defaultPreset("default"), defaultPreset("vertical")],
  };
}

export function presetQuery(value: string | null | undefined): string {
  const slug = (value ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
  return slug || "default";
}

export function slugPreset(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return slug || "preset";
}

export function uniquePresetId(name: string, existing: readonly string[]): string {
  const base = slugPreset(name);
  if (!existing.includes(base)) return base;
  for (let n = 2; n < 50; n += 1) {
    const next = `${base.slice(0, 28)}-${n}`;
    if (!existing.includes(next)) return next;
  }
  return `${base.slice(0, 20)}-${existing.length + 1}`;
}

export function resolvePreset(file: ChatOverlayFile, id: string | null | undefined): ChatOverlayStyle {
  const wanted = presetQuery(id);
  return (
    file.presets.find((preset) => preset.id === wanted) ??
    file.presets.find((preset) => preset.id === "default") ??
    file.presets[0] ??
    defaultPreset("default")
  );
}

export function normalizeChatOverlayFile(value: unknown): ChatOverlayFile {
  const fallback = defaultChatOverlayFile();
  const row = asRecord(value);
  if (!row) return fallback;
  const presets = Array.isArray(row.presets) ? row.presets.map((item) => normalizePreset(item)).filter((item): item is ChatOverlayStyle => item !== null) : [];
  const unique: ChatOverlayStyle[] = [];
  for (const preset of presets) {
    if (unique.some((item) => item.id === preset.id)) continue;
    unique.push(preset);
  }
  return {
    ttsBaseUrl: readTtsBase(row.ttsBaseUrl),
    ttsShortcuts: row.ttsShortcuts === true,
    presets: unique.length > 0 ? unique : fallback.presets,
  };
}

export function normalizePreset(value: unknown, base?: ChatOverlayStyle): ChatOverlayStyle | null {
  const row = asRecord(value);
  if (!row) return null;
  const seed = base ?? defaultPreset(typeof row.id === "string" ? presetQuery(row.id) : "default");
  const id = typeof row.id === "string" ? presetQuery(row.id) : seed.id;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 40) : seed.name;
  return {
    id,
    name,
    fontFamily: cleanFont(row.fontFamily, seed.fontFamily),
    fontSize: clampInt(row.fontSize, 12, 72, seed.fontSize),
    textColor: colorOr(row.textColor, seed.textColor),
    useAuthorColor: typeof row.useAuthorColor === "boolean" ? row.useAuthorColor : seed.useAuthorColor,
    nameColor: colorOr(row.nameColor, seed.nameColor),
    background: row.background === "none" || row.background === "pill" ? row.background : seed.background,
    backgroundColor: colorOr(row.backgroundColor, seed.backgroundColor),
    backgroundOpacity: clampNumber(row.backgroundOpacity, 0, 1, seed.backgroundOpacity),
    outline: typeof row.outline === "boolean" ? row.outline : seed.outline,
    shadow: typeof row.shadow === "boolean" ? row.shadow : seed.shadow,
    maxMessages: clampInt(row.maxMessages, 1, 40, seed.maxMessages),
    lifetimeSeconds: clampInt(row.lifetimeSeconds, 0, 600, seed.lifetimeSeconds),
    direction: row.direction === "top" || row.direction === "down" || row.direction === "bottom" ? row.direction : seed.direction,
    alignment: row.alignment === "left" || row.alignment === "center" || row.alignment === "right" ? row.alignment : seed.alignment,
    widthPercent: clampInt(row.widthPercent, 12, 100, seed.widthPercent),
    showPlatformIcons: typeof row.showPlatformIcons === "boolean" ? row.showPlatformIcons : seed.showPlatformIcons,
    showBadges: typeof row.showBadges === "boolean" ? row.showBadges : seed.showBadges,
    hiddenUsers: normalizeUsers(row.hiddenUsers, seed.hiddenUsers),
    hideCommands: typeof row.hideCommands === "boolean" ? row.hideCommands : seed.hideCommands,
    box: normalizeChatBox(
      row.box,
      row.box
        ? seed.box
        : legacyChatBox(
            clampInt(row.widthPercent, 5, 100, seed.widthPercent),
            row.alignment === "center" || row.alignment === "right" ? row.alignment : row.alignment === "left" ? "left" : seed.alignment,
          ),
    ),
  };
}

export function legacyChatBox(widthPercent: number, alignment: "left" | "center" | "right"): ChatBox {
  const size = clampInt(widthPercent, 5, 100, 32);
  if (alignment === "right") {
    return { preset: "right-column", sizePercent: size, marginPercent: 0, x: 100 - size, y: 0, width: size, height: 100, unit: "percent" };
  }
  if (alignment === "center") {
    const x = Math.round((100 - size) / 2);
    return { preset: "custom", sizePercent: size, marginPercent: 0, x, y: 0, width: size, height: 100, unit: "percent" };
  }
  return { preset: "left-column", sizePercent: size, marginPercent: 0, x: 0, y: 0, width: size, height: 100, unit: "percent" };
}

export function normalizeChatBox(value: unknown, fallback: ChatBox): ChatBox {
  const row = asRecord(value);
  if (!row) return fallback;
  const preset = CHAT_BOX_PRESETS.find((item) => item === row.preset) ?? fallback.preset;
  return {
    preset,
    sizePercent: clampInt(row.sizePercent, 5, 100, fallback.sizePercent),
    marginPercent: clampNumber(row.marginPercent, 0, 20, fallback.marginPercent),
    x: finite(row.x, fallback.x),
    y: finite(row.y, fallback.y),
    width: finite(row.width, fallback.width),
    height: finite(row.height, fallback.height),
    unit: row.unit === "px" ? "px" : "percent",
  };
}

/** Pixel box on the 1920×1080 canvas. A right column at 15% is x=85%, width=15%, full height. */
export function chatBoxRect(box: ChatBox): ChatBoxRect {
  const item = normalizeChatBox(box, box);
  if (item.preset === "custom") return customRect(item);
  if (item.preset === "full") return insetRect(item.marginPercent);
  if (item.preset === "bottom-strip") return stripRect(item);
  return columnRect(item.preset === "right-column" ? "right" : "left", item);
}

export function parseTtsBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("TTS address must be an http or https URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("TTS address must be an http or https URL.");
  if (url.username || url.password) throw new Error("Don't put a username or password in the TTS address.");
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return url.origin + path;
}

export function hexToRgba(hex: string, opacity: number): string {
  const color = colorOr(hex, "#000000");
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const alpha = Math.round(clampNumber(opacity, 0, 1, 1) * 100) / 100;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function overlayTextShadow(style: ChatOverlayStyle): string {
  const parts: string[] = [];
  if (style.outline) parts.push("1px 1px 0 #000", "-1px 1px 0 #000", "1px -1px 0 #000", "-1px -1px 0 #000");
  if (style.shadow) parts.push("0 2px 4px rgba(0,0,0,.85)");
  return parts.join(", ") || "none";
}

/** Lines the overlay should paint. Deleted, hidden, expired, and command lines are already gone. */
export function projectChatOverlay(
  messages: readonly ChatMessage[],
  style: ChatOverlayStyle,
  now = Date.now(),
  badgeUrl?: (badge: ChatBadge) => string | null,
  emoteUrl?: (url: string) => string | null,
): OverlayLine[] {
  const hidden = new Set(style.hiddenUsers.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const life = style.lifetimeSeconds > 0 ? style.lifetimeSeconds * 1000 : 0;
  const fadeMs = 700;
  const kept: { message: ChatMessage; opacity: number }[] = [];
  for (const message of messages) {
    if (message.deleted || message.deskOnly) continue;
    const names = [message.username, message.displayName].map((name) => name.trim().toLowerCase()).filter(Boolean);
    if (names.some((name) => hidden.has(name))) continue;
    if (style.hideCommands && message.plainText.trim().startsWith("!")) continue;
    let opacity = 1;
    if (life > 0) {
      const age = Math.max(0, now - message.timestamp);
      if (age >= life) continue;
      if (age > life - fadeMs) opacity = Math.max(0, (life - age) / fadeMs);
    }
    kept.push({ message, opacity: Math.round(opacity * 100) / 100 });
  }
  const sliced = kept.slice(-Math.max(1, style.maxMessages));
  const ordered = chatFlow(style.direction).reverse ? [...sliced].reverse() : sliced;
  return ordered.map(({ message, opacity }) => toLine(message, style, opacity, badgeUrl, emoteUrl));
}

function toLine(
  message: ChatMessage,
  style: ChatOverlayStyle,
  opacity: number,
  badgeUrl?: (badge: ChatBadge) => string | null,
  emoteUrl?: (url: string) => string | null,
): OverlayLine {
  const author = /^#[0-9a-fA-F]{6}$/.test(message.color) ? message.color : style.nameColor;
  const parts: OverlayLine["parts"] = [];
  for (const segment of message.segments) {
    if (segment.type === "emote") {
      const rewritten = emoteUrl?.(segment.url) || segment.url;
      if (overlayEmoteAllowed(rewritten)) {
        parts.push({ type: "emote", text: segment.text, url: rewritten, source: segment.source });
        continue;
      }
      parts.push({ type: "text", text: segment.text });
      continue;
    }
    parts.push({ type: "text", text: segment.text });
  }
  if (parts.length === 0 && message.plainText) parts.push({ type: "text", text: message.plainText });
  return {
    id: message.id,
    platform: message.platform,
    name: message.displayName || message.username,
    nameColor: style.useAuthorColor ? author : style.nameColor,
    badges: style.showBadges ? badgeImages(message.badges, badgeUrl) : [],
    parts,
    action: message.kind === "action",
    amount: message.amount,
    notice: message.notice,
    opacity,
  };
}

function badgeImages(badges: ChatBadge[], badgeUrl?: (badge: ChatBadge) => string | null): { url: string }[] {
  const images: { url: string }[] = [];
  for (const badge of badges) {
    const resolved = badgeUrl ? badgeUrl(badge) : badge.imageUrl;
    const safe = resolved ? safeEmoteUrl(resolved) : null;
    if (safe && !images.some((item) => item.url === safe)) images.push({ url: safe });
  }
  return images;
}

function columnRect(side: "left" | "right", box: ChatBox): ChatBoxRect {
  const marginX = (box.marginPercent / 100) * 1920;
  const marginY = (box.marginPercent / 100) * 1080;
  let width = Math.round((box.sizePercent / 100) * 1920);
  const top = Math.round(marginY);
  let height = Math.round(1080 - marginY * 2);
  let left = side === "right" ? Math.round(1920 - marginX - width) : Math.round(marginX);
  if (left < 0) {
    width += left;
    left = 0;
  }
  if (left + width > 1920) width = 1920 - left;
  return { left, top, width: Math.max(1, width), height: Math.max(1, height) };
}

function stripRect(box: ChatBox): ChatBoxRect {
  const marginX = (box.marginPercent / 100) * 1920;
  const marginY = (box.marginPercent / 100) * 1080;
  let height = Math.round((box.sizePercent / 100) * 1080);
  const left = Math.round(marginX);
  const width = Math.max(1, Math.round(1920 - marginX * 2));
  let top = Math.round(1080 - marginY - height);
  if (top < 0) {
    height += top;
    top = 0;
  }
  return { left, top, width, height: Math.max(1, height) };
}

function insetRect(marginPercent: number): ChatBoxRect {
  const marginX = (marginPercent / 100) * 1920;
  const marginY = (marginPercent / 100) * 1080;
  return {
    left: Math.round(marginX),
    top: Math.round(marginY),
    width: Math.max(1, Math.round(1920 - marginX * 2)),
    height: Math.max(1, Math.round(1080 - marginY * 2)),
  };
}

function customRect(box: ChatBox): ChatBoxRect {
  const x = box.unit === "px" ? box.x : (box.x / 100) * 1920;
  const y = box.unit === "px" ? box.y : (box.y / 100) * 1080;
  const width = box.unit === "px" ? box.width : (box.width / 100) * 1920;
  const height = box.unit === "px" ? box.height : (box.height / 100) * 1080;
  const left = clamp(Math.round(x), 0, 1919);
  const top = clamp(Math.round(y), 0, 1079);
  return {
    left,
    top,
    width: Math.max(1, Math.min(Math.round(width), 1920 - left)),
    height: Math.max(1, Math.min(Math.round(height), 1080 - top)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) ? number : fallback;
}

function readTtsBase(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_TTS_BASE;
  try {
    return parseTtsBaseUrl(value);
  } catch {
    return DEFAULT_TTS_BASE;
  }
}

function normalizeUsers(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const name = item.trim().toLowerCase().replace(/^@/, "").slice(0, 40);
    if (name.length < 2 || !/^[\p{L}\p{N}_ .-]+$/u.test(name)) continue;
    if (!out.includes(name)) out.push(name);
    if (out.length >= 80) break;
  }
  return out;
}

function cleanFont(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[;{}<>\\]/g, "").replace(/[\r\n]/g, " ").trim().slice(0, 80);
  return cleaned || fallback;
}

function colorOr(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

