import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { brand } from "./brand";

/**
 * Platform paths for the desktop app and the headless bot.
 *
 * Linux keeps the locations this app already uses:
 * - config, tokens, and bot files: `$XDG_CONFIG_HOME/rascal` or `~/.config/rascal`
 * - Electron window data: `$XDG_CONFIG_HOME/Rascal` or `~/.config/Rascal`
 * - default alert media: `~/Streaming/Rascal-Assets/Sounds`
 *
 * Windows and macOS use the standard per-user app data directory
 * (`app.getPath("appData")` when the desktop app supplies it):
 * `%APPDATA%\Rascal` and `~/Library/Application Support/Rascal`.
 * Those file systems treat `rascal` and `Rascal` as one folder, so the
 * lowercase XDG name is not used there.
 *
 * A saved asset folder (redeems.json `soundFolder`) is never passed through
 * these helpers. Callers only use `defaultAssetFolder` when the file has none.
 */
export interface PathHost {
  platform: NodeJS.Platform;
  homedir: string;
  env: NodeJS.ProcessEnv;
  /** `app.getPath("appData")` from the desktop app. Ignored on Linux. */
  appData?: string;
  /** `app.getPath("documents")`. */
  documents?: string;
  /** `app.getPath("music")`. */
  music?: string;
  /** `app.getPath("temp")`. */
  temp?: string;
}

let activeHost: PathHost | null = null;

/** Desktop startup calls this after `app.whenReady()` so later reads see Electron's paths. */
export function usePathHost(host: PathHost | null): void {
  activeHost = host;
}

export function currentPathHost(): PathHost {
  if (activeHost) return activeHost;
  return {
    platform: process.platform,
    homedir: os.homedir(),
    env: process.env,
  };
}

export function configHome(host: PathHost = currentPathHost()): string {
  if (host.platform === "win32") {
    if (host.appData) return host.appData;
    return host.env.APPDATA || path.join(host.homedir, "AppData", "Roaming");
  }
  if (host.platform === "darwin") {
    if (host.appData) return host.appData;
    return path.join(host.homedir, "Library", "Application Support");
  }
  return host.env.XDG_CONFIG_HOME || path.join(host.homedir, ".config");
}

/** Folder that holds settings, tokens, redeems, and the bot files. */
export function configDir(host: PathHost = currentPathHost()): string {
  const name = host.platform === "win32" || host.platform === "darwin" ? brand.displayName : brand.configDirName;
  return path.join(configHome(host), name);
}

/** Electron `userData`. On Linux this stays `~/.config/Rascal`, separate from `~/.config/rascal`. */
export function electronUserDataDir(host: PathHost = currentPathHost()): string {
  if (host.platform === "win32" || host.platform === "darwin") return configDir(host);
  return path.join(configHome(host), brand.displayName);
}

/**
 * Default folder for alert sounds and videos when redeems.json has no `soundFolder`.
 * Linux stays `~/Streaming/Rascal-Assets/Sounds`. Other platforms use Music, then Documents.
 */
export function defaultAssetFolder(host: PathHost = currentPathHost()): string {
  const tail = [brand.soundFolderName, "Sounds"];
  if (host.platform !== "win32" && host.platform !== "darwin") {
    return path.join(host.homedir, "Streaming", ...tail);
  }
  const base = host.music || host.documents || path.join(host.homedir, "Music");
  return path.join(base, ...tail);
}

export function firebotRewardsFile(host: PathHost = currentPathHost()): string {
  const rest = ["Firebot", "v5", "profiles", "Main", "channel-rewards.json"];
  if (host.platform === "win32") {
    const base = host.appData || host.env.APPDATA || path.join(host.homedir, "AppData", "Roaming");
    return path.join(base, ...rest);
  }
  if (host.platform === "darwin") {
    return path.join(host.homedir, "Library", "Application Support", ...rest);
  }
  const config = host.env.XDG_CONFIG_HOME || path.join(host.homedir, ".config");
  return path.join(config, ...rest);
}

/** `app.getPath("temp")` when the desktop app supplied it, otherwise `os.tmpdir()`. */
export function tempDir(host: PathHost = currentPathHost()): string {
  return host.temp || os.tmpdir();
}

/** `file:` URL for a filesystem path. Handles Windows drive letters and spaces. */
export function fileUrl(filePath: string): string {
  return pathToFileURL(filePath).href;
}
