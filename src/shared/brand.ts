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
  envPrefix: "RASCAL",
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
  soundFolderName: "Rascal-Assets",
  packageName: "rascal",
  botPackageName: "@rascal/bot",
  healthService: "rascal",
  botHealthService: "rascal-bot",
  portalCookie: "rascal_portal",
  overlayPort: 4777,
  portalPort: 4788,
} as const;

/** Read `RASCAL_<suffix>`. An empty value is treated as unset. */
export function readBrandEnv(suffix: string): string | undefined {
  const value = process.env[`${brand.envPrefix}_${suffix}`];
  if (value !== undefined && value !== "") return value;
  return undefined;
}
