import fs from "node:fs";
import path from "node:path";
import { brand } from "../shared/brand";
import { chmodPrivate } from "../shared/private-mode";

const SECRET_FILES = new Set(["tokens.json", "bot-tokens.json", "bot-secrets.json", "bot-link.json", "settings.json"]);

export interface MigrationResult {
  copied: boolean;
  files: number;
  from: string;
  to: string;
}

/** Copy an old config directory into the new one. The old directory stays. Secret values are not logged. */
export function copyConfigIfMissing(from: string, to: string): MigrationResult {
  const result: MigrationResult = { copied: false, files: 0, from, to };
  if (fs.existsSync(to) || !fs.existsSync(from) || !fs.statSync(from).isDirectory()) return result;
  copyTree(from, to, result);
  result.copied = result.files > 0;
  return result;
}

export function migrateLegacyConfig(configHome: string): MigrationResult[] {
  return [
    copyConfigIfMissing(path.join(configHome, brand.legacyConfigDirName), path.join(configHome, brand.configDirName)),
    copyConfigIfMissing(path.join(configHome, brand.legacyElectronDirName), path.join(configHome, brand.displayName)),
  ].filter((item) => item.copied);
}

function copyTree(from: string, to: string, result: MigrationResult): void {
  fs.mkdirSync(to, { recursive: true, mode: 0o700 });
  chmodPrivate(to, 0o700);
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(source, dest, result);
      continue;
    }
    if (!entry.isFile()) continue;
    fs.copyFileSync(source, dest);
    const mode = fs.statSync(source).mode & 0o777;
    chmodPrivate(dest, SECRET_FILES.has(entry.name) ? 0o600 : mode || 0o600);
    result.files += 1;
  }
}
