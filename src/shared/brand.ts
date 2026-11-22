/**
 * Product branding. A rename is this file plus package.json, electron-builder.yml,
 * and the desktop entry. Overlay paths and ports stay fixed so OBS sources keep working.
 */
export const brand = {
  displayName: "Rascal",
  slug: "rascal",
  productName: "Rascal",
  appId: "app.rascal.desktop",
  configDirName: "rascal",
  legacyConfigDirName: "ember",
  /** Electron's old userData folder used the product name. */
  legacyElectronDirName: "Ember",
  envPrefix: "RASCAL",
  legacyEnvPrefix: "EMBER",
  flyAppName: "rascal",
  flyAppFallback: "rascalapp",
  flyVolume: "rascal_bot_data",
  /** Identifies this app. YouTube page fetches keep a browser user agent separately. */
  userAgent: "Rascal",
  desktopFile: "rascal.desktop",
  executableName: "rascal",
  wmClass: "rascal",
  protocol: "rascal",
  logFile: "rascal.log",
  exportFile: "rascal-bot-config.json",
  legacyExportFile: "ember-bot-config.json",
  soundFolderName: "Rascal-Assets",
  packageName: "rascal",
  botPackageName: "@rascal/bot",
  healthService: "rascal",
  botHealthService: "rascal-bot",
  portalCookie: "rascal_portal",
  overlayPort: 4777,
  portalPort: 4788,
} as const;

const warnedEnv = new Set<string>();

/** Read RASCAL_*, then the old EMBER_* name. The log line names the variables, never the value. */
export function readBrandEnv(suffix: string, log: (message: string) => void = console.warn): string | undefined {
  const nextName = `${brand.envPrefix}_${suffix}`;
  const legacyName = `${brand.legacyEnvPrefix}_${suffix}`;
  const next = process.env[nextName];
  if (next !== undefined && next !== "") return next;
  const legacy = process.env[legacyName];
  if (legacy !== undefined && legacy !== "") {
    if (!warnedEnv.has(legacyName)) {
      warnedEnv.add(legacyName);
      log(`${legacyName} is deprecated; set ${nextName} instead.`);
    }
    return legacy;
  }
  return undefined;
}
