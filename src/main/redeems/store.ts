import path from "node:path";
import { brand } from "../../shared/brand";
import { clampVolume, normalizePlacement, type RedeemMapping } from "../../shared/redeems";
import { readJson, writePrivateJson } from "../private-file";

export interface RedeemFile {
  soundFolder: string;
  mappings: RedeemMapping[];
}

export function defaultSoundFolder(home: string): string {
  return path.join(home, "Streaming", brand.soundFolderName, "Sounds");
}

export function loadRedeemFile(file: string, soundFolder: string): RedeemFile {
  const raw = readJson(file);
  const root = raw && typeof raw === "object" ? (raw as Partial<RedeemFile>) : {};
  const mappings = Array.isArray(root.mappings) ? root.mappings.map(normalizeMapping).filter((item) => item.title) : [];
  return {
    soundFolder: typeof root.soundFolder === "string" && root.soundFolder.trim() ? root.soundFolder : soundFolder,
    mappings,
  };
}

export function saveRedeemFile(file: string, data: RedeemFile): void {
  writePrivateJson(file, {
    soundFolder: data.soundFolder,
    mappings: data.mappings.map(normalizeMapping),
  });
}

export function normalizeMapping(value: unknown): RedeemMapping {
  const row = value && typeof value === "object" ? (value as Partial<RedeemMapping>) : {};
  const action = row.action === "video" || row.action === "sound" || row.action === "none" ? row.action : "none";
  const max = typeof row.maxDurationMs === "number" && row.maxDurationMs > 0 ? Math.round(row.maxDurationMs) : null;
  return {
    rewardId: typeof row.rewardId === "string" ? row.rewardId : "",
    title: typeof row.title === "string" ? row.title.trim() : "",
    action,
    filePath: typeof row.filePath === "string" ? row.filePath : "",
    volume: clampVolume(row.volume),
    maxDurationMs: max,
    enabled: row.enabled !== false,
    placement: normalizePlacement(row.placement),
  };
}
