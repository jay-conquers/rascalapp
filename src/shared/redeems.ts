export type RedeemAction = "none" | "video" | "sound";

export const PLACEMENT_PRESETS = [
  "center",
  "top-left",
  "top",
  "top-right",
  "left",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
  "custom",
] as const;

export type PlacementPreset = (typeof PLACEMENT_PRESETS)[number];

export interface VideoPlacement {
  preset: PlacementPreset;
  /** Percent of the 1920-wide overlay. 10–100. */
  sizePercent: number;
  /** Edge inset for presets, as a percent of each canvas axis. */
  marginPercent: number;
  customX: number;
  customY: number;
  customUnit: "percent" | "px";
}

export interface PlacementBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const OVERLAY_WIDTH = 1920;
export const OVERLAY_HEIGHT = 1080;

export const DEFAULT_VIDEO_PLACEMENT: VideoPlacement = {
  preset: "center",
  sizePercent: 100,
  marginPercent: 2,
  customX: 0,
  customY: 0,
  customUnit: "percent",
};

export interface RedeemMapping {
  rewardId: string;
  title: string;
  action: RedeemAction;
  filePath: string;
  volume: number;
  maxDurationMs: number | null;
  enabled: boolean;
  placement?: VideoPlacement;
}

export interface AlertView {
  id: string;
  rewardId: string;
  title: string;
  action: "video" | "sound";
  filePath: string;
  volume: number;
  maxDurationMs: number | null;
  userName: string;
}

export interface RewardRow {
  id: string;
  title: string;
  cost: number;
  enabledOnTwitch: boolean;
  manageable: boolean;
  prompt: string;
  mapping: RedeemMapping;
}

export interface RedeemSnapshot {
  status: string;
  scopeMissing: boolean;
  canManage: boolean;
  overlayUrl: string;
  overlayCount: number;
  overlayVersion: string;
  overlayHash: string;
  staleOverlay: boolean;
  soundFolder: string;
  rewards: RewardRow[];
  queue: { current: AlertView | null; pending: AlertView[] };
}

/** How long a playing alert may run before the queue moves on without an overlay ack. */
export function alertStallMs(maxDurationMs: number | null): number {
  return maxDurationMs != null && maxDurationMs > 0 ? maxDurationMs + 5_000 : 30_000;
}

export interface ImportedMapping {
  /** Twitch reward id from twitchData.id, then the record id. */
  twitchId: string;
  title: string;
  action: "video" | "sound";
  filePath: string;
  volume: number;
  placement?: VideoPlacement;
}

export interface TwitchRewardRef {
  id: string;
  title: string;
}

/** Firebot's sound/video slider is 0–10. Values above 10 are already a percent. */
export function firebotVolume(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 100;
  const scaled = numeric <= 10 ? numeric * 10 : numeric;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

export function clampVolume(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 100;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

/**
 * Read a Firebot v5 channel-rewards file. The read is the caller's job;
 * this only interprets the JSON. Match twitchData.id first, then title.
 */
export function importFirebotRewards(payload: unknown): ImportedMapping[] {
  const imported: ImportedMapping[] = [];
  for (const reward of rewardRecords(payload)) {
    const title = rewardTitle(reward);
    const effect = pickEffect(reward);
    if (!title || !effect) continue;
    const action = effectKind(effect);
    const filePath = effectPath(effect);
    if (!action || !filePath) continue;
    imported.push({
      twitchId: rewardTwitchId(reward),
      title,
      action,
      filePath,
      volume: firebotVolume(effect.volume),
      placement: action === "video" ? firebotPlacement(effect) : undefined,
    });
  }
  return imported;
}

/** How many mappings gained a file. Existing paths are not counted. */
export function countFilledMappings(before: RedeemMapping[], after: RedeemMapping[]): number {
  let filled = 0;
  for (const item of after) {
    if (!item.filePath) continue;
    const previous = before.find(
      (mapping) =>
        (item.rewardId && mapping.rewardId === item.rewardId) || sameTitle(mapping.title, item.title),
    );
    if (!previous?.filePath) filled += 1;
  }
  return filled;
}

/** Fill empty mappings from an import. Existing file paths are left alone. */
export function mergeImported(
  mappings: RedeemMapping[],
  imported: ImportedMapping[],
  rewards: TwitchRewardRef[],
): RedeemMapping[] {
  const next = mappings.map((mapping) => ({ ...mapping }));
  for (const item of imported) {
    const reward =
      rewards.find((entry) => item.twitchId && entry.id === item.twitchId) ??
      rewards.find((entry) => sameTitle(entry.title, item.title));
    const rewardId = reward?.id ?? item.twitchId;
    const existing = next.find(
      (mapping) =>
        (item.twitchId && mapping.rewardId === item.twitchId) ||
        (rewardId && mapping.rewardId === rewardId) ||
        sameTitle(mapping.title, item.title),
    );
    if (existing) {
      if (rewardId) existing.rewardId = rewardId;
      if (reward) existing.title = reward.title;
      if (!existing.filePath) {
        existing.action = item.action;
        existing.filePath = item.filePath;
        existing.volume = item.volume;
        existing.enabled = true;
        if (item.action === "video") existing.placement = item.placement ?? { ...DEFAULT_VIDEO_PLACEMENT };
      } else if (item.action === "video" && item.placement && placementUntouched(existing.placement)) {
        existing.placement = item.placement;
      }
      continue;
    }
    next.push({
      rewardId,
      title: reward?.title ?? item.title,
      action: item.action,
      filePath: item.filePath,
      volume: item.volume,
      maxDurationMs: null,
      enabled: true,
      placement: item.action === "video" ? (item.placement ?? { ...DEFAULT_VIDEO_PLACEMENT }) : undefined,
    });
  }
  return next;
}

export function normalizePlacement(value: unknown): VideoPlacement {
  const row = asRecord(value);
  const preset = PLACEMENT_PRESETS.find((item) => item === row?.preset) ?? "center";
  return {
    preset,
    sizePercent: clampSize(row?.sizePercent ?? DEFAULT_VIDEO_PLACEMENT.sizePercent),
    marginPercent: clampMargin(row?.marginPercent ?? DEFAULT_VIDEO_PLACEMENT.marginPercent),
    customX: finite(row?.customX, 0),
    customY: finite(row?.customY, 0),
    customUnit: row?.customUnit === "px" ? "px" : "percent",
  };
}

/**
 * Where a video sits on the 1920×1080 overlay. The box is a 16:9 slot unless
 * another aspect is passed. The player keeps the file's real aspect inside it.
 * Center at 100% fills the canvas so older mappings look the same.
 */
export function placementBox(placement: VideoPlacement, aspect = 16 / 9): PlacementBox {
  const normalized = normalizePlacement(placement);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  let width = (normalized.sizePercent / 100) * OVERLAY_WIDTH;
  let height = width / safeAspect;
  if (normalized.preset === "custom") {
    const fitted = fit(width, height, OVERLAY_WIDTH, OVERLAY_HEIGHT);
    const left = normalized.customUnit === "px" ? normalized.customX : (normalized.customX / 100) * OVERLAY_WIDTH;
    const top = normalized.customUnit === "px" ? normalized.customY : (normalized.customY / 100) * OVERLAY_HEIGHT;
    return {
      left: clamp(Math.round(left), 0, Math.max(0, OVERLAY_WIDTH - fitted.width)),
      top: clamp(Math.round(top), 0, Math.max(0, OVERLAY_HEIGHT - fitted.height)),
      width: fitted.width,
      height: fitted.height,
    };
  }
  const marginX = normalized.preset === "center" ? 0 : (normalized.marginPercent / 100) * OVERLAY_WIDTH;
  const marginY = normalized.preset === "center" ? 0 : (normalized.marginPercent / 100) * OVERLAY_HEIGHT;
  const fitted = fit(width, height, Math.max(1, OVERLAY_WIDTH - marginX * 2), Math.max(1, OVERLAY_HEIGHT - marginY * 2));
  width = fitted.width;
  height = fitted.height;
  let left = marginX;
  let top = marginY;
  if (normalized.preset === "center" || normalized.preset === "top" || normalized.preset === "bottom") {
    left = (OVERLAY_WIDTH - width) / 2;
  } else if (normalized.preset === "top-right" || normalized.preset === "right" || normalized.preset === "bottom-right") {
    left = OVERLAY_WIDTH - marginX - width;
  }
  if (normalized.preset === "center" || normalized.preset === "left" || normalized.preset === "right") {
    top = (OVERLAY_HEIGHT - height) / 2;
  } else if (normalized.preset === "bottom-left" || normalized.preset === "bottom" || normalized.preset === "bottom-right") {
    top = OVERLAY_HEIGHT - marginY - height;
  }
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function fit(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function firebotPlacement(effect: Record<string, unknown>): VideoPlacement {
  const preset = mapFirebotPosition(asString(effect.position)) ?? "center";
  const placement: VideoPlacement = {
    ...DEFAULT_VIDEO_PLACEMENT,
    preset,
    sizePercent: firebotSizePercent(effect),
  };
  if (preset !== "custom") return placement;
  const coords = asRecord(effect.customCoords) ?? {};
  const x = readCoord(coords.left ?? effect.x ?? effect.left, OVERLAY_WIDTH);
  const y = readCoord(coords.top ?? effect.y ?? effect.top, OVERLAY_HEIGHT);
  const unit = x.unit === "px" || y.unit === "px" ? "px" : "percent";
  return {
    ...placement,
    customUnit: unit,
    customX: unit === "px" ? x.px : x.percent,
    customY: unit === "px" ? y.px : y.percent,
  };
}

function mapFirebotPosition(raw: string | null): PlacementPreset | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const table: Record<string, PlacementPreset> = {
    middle: "center",
    center: "center",
    "top left": "top-left",
    "top middle": "top",
    "top center": "top",
    top: "top",
    "top right": "top-right",
    "middle left": "left",
    left: "left",
    "middle right": "right",
    right: "right",
    "bottom left": "bottom-left",
    "bottom middle": "bottom",
    "bottom center": "bottom",
    bottom: "bottom",
    "bottom right": "bottom-right",
    custom: "custom",
  };
  return table[key] ?? null;
}

function firebotSizePercent(effect: Record<string, unknown>): number {
  const width = parseAxis(effect.width, OVERLAY_WIDTH);
  if (width != null) return clampSize(width);
  const height = parseAxis(effect.height, OVERLAY_HEIGHT);
  if (height != null) return clampSize(height);
  return 100;
}

function parseAxis(value: unknown, canvas: number): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value <= 100 ? value : (value / canvas) * 100;
  }
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (!text || text === "auto") return null;
  if (text.endsWith("%")) return Number(text.slice(0, -1));
  if (text.endsWith("px")) return (Number(text.slice(0, -2)) / canvas) * 100;
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric <= 100 ? numeric : (numeric / canvas) * 100;
}

function readCoord(value: unknown, canvas: number): { unit: "percent" | "px"; percent: number; px: number } {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Math.abs(value) <= 100) return { unit: "percent", percent: value, px: (value / 100) * canvas };
    return { unit: "px", percent: (value / canvas) * 100, px: value };
  }
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text.endsWith("%")) {
      const percent = Number(text.slice(0, -1));
      return { unit: "percent", percent, px: (percent / 100) * canvas };
    }
    if (text.endsWith("px")) {
      const px = Number(text.slice(0, -2));
      return { unit: "px", percent: (px / canvas) * 100, px };
    }
  }
  return { unit: "percent", percent: 0, px: 0 };
}

function clampSize(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 100;
  return Math.max(10, Math.min(100, Math.round(numeric)));
}

function clampMargin(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 2;
  return Math.max(0, Math.min(20, Math.round(numeric * 10) / 10));
}

function finite(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sameTitle(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function placementUntouched(placement: VideoPlacement | undefined): boolean {
  const current = normalizePlacement(placement);
  return (
    current.preset === DEFAULT_VIDEO_PLACEMENT.preset &&
    current.sizePercent === DEFAULT_VIDEO_PLACEMENT.sizePercent &&
    current.customX === DEFAULT_VIDEO_PLACEMENT.customX &&
    current.customY === DEFAULT_VIDEO_PLACEMENT.customY
  );
}

function rewardRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  const root = asRecord(payload);
  if (!root) return [];
  for (const key of ["rewards", "customRewards", "channelRewards"]) {
    const value = root[key];
    if (Array.isArray(value)) return value.filter(isRecord);
    if (isRecord(value)) return Object.values(value).filter(isRecord);
  }
  const values = Object.values(root).filter(isRecord);
  if (values.some((value) => "twitchData" in value || "effects" in value)) {
    return values.filter((value) => "twitchData" in value || "effects" in value);
  }
  return [];
}

function rewardTwitchId(reward: Record<string, unknown>): string {
  const twitch = asRecord(reward.twitchData) ?? asRecord(reward.twitch);
  return (asString(twitch?.id) || asString(reward.id) || "").trim();
}

function rewardTitle(reward: Record<string, unknown>): string {
  const twitch = asRecord(reward.twitchData) ?? asRecord(reward.twitch);
  return (
    asString(reward.name) ||
    asString(reward.title) ||
    asString(twitch?.title) ||
    asString(twitch?.name) ||
    ""
  ).trim();
}

function pickEffect(reward: Record<string, unknown>): Record<string, unknown> | null {
  const effects = effectList(reward.effects);
  const ranked = effects
    .map((effect) => ({ effect, action: effectKind(effect) }))
    .filter((entry) => entry.action && effectPath(entry.effect));
  return ranked.find((entry) => entry.action === "video")?.effect ?? ranked[0]?.effect ?? null;
}

function effectList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  const root = asRecord(value);
  if (!root) return [];
  if (Array.isArray(root.list)) return root.list.filter(isRecord);
  return [];
}

function effectKind(effect: Record<string, unknown>): "video" | "sound" | null {
  const type = `${asString(effect.type) ?? ""} ${asString(effect.videoType) ?? ""} ${asString(effect.soundType) ?? ""}`.toLowerCase();
  if (/play[-_ ]?video|\bvideo\b/.test(type)) return "video";
  if (/play[-_ ]?sound|\bsound\b/.test(type)) return "sound";
  return null;
}

function effectPath(effect: Record<string, unknown>): string {
  for (const key of ["file", "filepath", "filePath", "path", "videoFile", "soundFile"]) {
    const value = asString(effect[key]);
    if (value && !/^https?:\/\//i.test(value)) return value;
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
