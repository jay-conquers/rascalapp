/**
 * Which chat platforms the desk shows and connects.
 *
 * This is the one list the picker, Settings, the chat column, and the bot
 * all read. Kick is already in the catalog so a later build can show it.
 * While `hidden` is true it stays out of the picker and out of the running set.
 * A free-tier build can hide a platform the same way.
 */

export interface PlatformCatalogEntry {
  id: string;
  label: string;
  /** Hidden entries are not offered and cannot be enabled. */
  hidden: boolean;
}

export const PLATFORM_CATALOG: readonly PlatformCatalogEntry[] = [
  { id: "twitch", label: "Twitch", hidden: false },
  { id: "youtube", label: "YouTube", hidden: false },
  { id: "kick", label: "Kick", hidden: true },
];

/** Saved in settings.json. Logins and channel ids live in their own files. */
export interface PlatformSelection {
  /**
   * False only until the first-run picker is confirmed.
   * An older install is migrated with this set, so the picker is not shown.
   */
  confirmed: boolean;
  /** Enabled platform ids, in catalog order. Hidden ids are never stored. */
  enabled: string[];
}

/** A login, channel, or client id that was already on disk before this setting existed. */
export interface PlatformSetupEvidence {
  twitch: boolean;
  youtube: boolean;
}

export function visiblePlatforms(catalog: readonly PlatformCatalogEntry[] = PLATFORM_CATALOG): PlatformCatalogEntry[] {
  return catalog.filter((entry) => !entry.hidden);
}

export function platformLabel(id: string, catalog: readonly PlatformCatalogEntry[] = PLATFORM_CATALOG): string {
  return catalog.find((entry) => entry.id === id)?.label ?? id;
}

/** A new install offers Twitch, already checked, and waits for the picker. */
export function defaultPlatformSelection(): PlatformSelection {
  return { confirmed: false, enabled: ["twitch"] };
}

export function isPlatformEnabled(selection: PlatformSelection | undefined, id: string): boolean {
  return (selection ?? defaultPlatformSelection()).enabled.includes(id);
}

/** Drop unknown and hidden ids. Keep catalog order. */
export function normalizeEnabledIds(ids: readonly string[], catalog: readonly PlatformCatalogEntry[] = PLATFORM_CATALOG): string[] {
  const visible = new Set(visiblePlatforms(catalog).map((entry) => entry.id));
  const wanted = new Set(ids.filter((id) => visible.has(id)));
  return visiblePlatforms(catalog)
    .map((entry) => entry.id)
    .filter((id) => wanted.has(id));
}

export function selectionError(message: string): Error {
  return new Error(message);
}

/**
 * Turn one visible platform on or off.
 * The last visible platform stays on. Hidden platforms cannot be selected.
 */
export function setPlatformEnabled(selection: PlatformSelection, id: string, on: boolean, catalog: readonly PlatformCatalogEntry[] = PLATFORM_CATALOG): PlatformSelection {
  if (!visiblePlatforms(catalog).some((entry) => entry.id === id)) {
    throw selectionError("That platform is not available.");
  }
  const next = new Set(selection.enabled);
  if (on) next.add(id);
  else next.delete(id);
  const enabled = normalizeEnabledIds([...next], catalog);
  if (enabled.length === 0) throw selectionError("Choose at least one platform.");
  return { ...selection, enabled };
}

/** The first-run picker is done. At least one visible platform is on. */
export function confirmPlatformSelection(selection: PlatformSelection, catalog: readonly PlatformCatalogEntry[] = PLATFORM_CATALOG): PlatformSelection {
  const enabled = normalizeEnabledIds(selection.enabled, catalog);
  if (enabled.length === 0) throw selectionError("Choose at least one platform.");
  return { confirmed: true, enabled };
}

export interface ResolvePlatformSelectionInput {
  /** settings.json was present, even if a field in it was invalid. */
  fileExisted: boolean;
  /** The file contained a `platforms` key. */
  keyPresent: boolean;
  /** The raw `platforms` value. */
  saved: unknown;
  setup: PlatformSetupEvidence;
}

/**
 * Fresh install: no file and nothing connected. Show the picker, Twitch checked.
 * Upgrade: a file or an account already exists. Pre-select what is set up.
 * If nothing is set up, Twitch is selected and the picker is not shown.
 * A saved `platforms` value is kept, including a picker the user has not confirmed.
 */
export function resolvePlatformSelection(input: ResolvePlatformSelectionInput, catalog: readonly PlatformCatalogEntry[] = PLATFORM_CATALOG): PlatformSelection {
  if (input.keyPresent) return parseSavedSelection(input.saved, catalog);
  const anything = input.setup.twitch || input.setup.youtube;
  if (!input.fileExisted && !anything) return defaultPlatformSelection();
  return migrateFromSetup(input.setup);
}

export function migrateFromSetup(setup: PlatformSetupEvidence): PlatformSelection {
  const enabled: string[] = [];
  if (setup.twitch) enabled.push("twitch");
  if (setup.youtube) enabled.push("youtube");
  if (enabled.length === 0) enabled.push("twitch");
  return { confirmed: true, enabled };
}

/** Accept `{ enabled, confirmed }` or a hand-written `{ twitch: true, youtube: false }`. */
export function parseSavedSelection(saved: unknown, catalog: readonly PlatformCatalogEntry[] = PLATFORM_CATALOG): PlatformSelection {
  const row = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
  const listed = Array.isArray(row.enabled) ? row.enabled.filter((id): id is string => typeof id === "string") : null;
  const fromFlags: string[] = [];
  if (row.twitch === true) fromFlags.push("twitch");
  if (row.youtube === true) fromFlags.push("youtube");
  const source = listed ?? fromFlags;
  const enabled = normalizeEnabledIds(source, catalog);
  const confirmed = row.confirmed === false ? false : row.confirmed === true || listed !== null || fromFlags.length > 0;
  if (enabled.length === 0) return { confirmed: confirmed || listed !== null, enabled: ["twitch"] };
  return { confirmed, enabled };
}

/**
 * Apply a settings patch. An explicit empty list is rejected.
 * Hidden ids are dropped. Omitting the field keeps the current selection.
 */
export function selectionFromPatch(current: PlatformSelection, patch: unknown, catalog: readonly PlatformCatalogEntry[] = PLATFORM_CATALOG): PlatformSelection {
  if (patch === undefined) return { confirmed: current.confirmed, enabled: [...current.enabled] };
  const row = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : null;
  if (!row) throw selectionError("Choose at least one platform.");
  if (Array.isArray(row.enabled) && normalizeEnabledIds(row.enabled.filter((id): id is string => typeof id === "string"), catalog).length === 0) {
    throw selectionError("Choose at least one platform.");
  }
  return parseSavedSelection(patch, catalog);
}

/** An empty platform, or one this build does not know, stays visible. Known platforms follow the selection. */
export function platformVisible(id: string, selection: PlatformSelection | undefined): boolean {
  if (!id) return true;
  if (!PLATFORM_CATALOG.some((entry) => entry.id === id)) return true;
  return isPlatformEnabled(selection, id);
}

export function filterEnabled<T>(items: readonly T[], platformId: (item: T) => string, selection: PlatformSelection | undefined): T[] {
  const enabled = new Set((selection ?? defaultPlatformSelection()).enabled);
  return items.filter((item) => enabled.has(platformId(item)));
}

/**
 * Keep saved send checks. If every checked platform is off, check the ones that are on
 * so the chat box can still send. A check for a platform that is off stays saved.
 */
export function sendTargetsForSelection(
  selection: PlatformSelection,
  saved: { twitch: boolean; youtube: boolean },
): { twitch: boolean; youtube: boolean } {
  const twitch = saved.twitch === true;
  const youtube = saved.youtube === true;
  const twitchOn = isPlatformEnabled(selection, "twitch");
  const youtubeOn = isPlatformEnabled(selection, "youtube");
  if ((twitchOn && twitch) || (youtubeOn && youtube)) return { twitch, youtube };
  return {
    twitch: twitchOn ? true : twitch,
    youtube: youtubeOn ? true : youtube,
  };
}

/** Saved send checks stay as they were. Delivery uses only platforms that are on. */
export function maskSendTargets<T extends { twitch: boolean; youtube: boolean }>(saved: T, selection: PlatformSelection | undefined): T {
  return {
    ...saved,
    twitch: saved.twitch === true && isPlatformEnabled(selection, "twitch"),
    youtube: saved.youtube === true && isPlatformEnabled(selection, "youtube"),
  };
}

export function emptyFeedCopy(selection: PlatformSelection | undefined): string {
  const enabled = (selection ?? defaultPlatformSelection()).enabled;
  const names = visiblePlatforms().filter((entry) => enabled.includes(entry.id)).map((entry) => entry.label);
  if (names.length === 1 && names[0] === "YouTube") return "YouTube chat attaches when the channel goes live.";
  if (names.length === 1) return "Twitch chat joins on its own.";
  return "Twitch chat joins on its own. YouTube chat attaches when the channel goes live.";
}

/** Platforms that just became active and still need a login. */
export function platformsNeedingLogin(input: {
  previous: PlatformSelection;
  next: PlatformSelection;
  /** First-run confirmation asks for every selected platform that is not signed in. */
  confirm: boolean;
  twitchLoggedIn: boolean;
  youtubeLoggedIn: boolean;
}): string[] {
  const needs: string[] = [];
  const turnedOn = (id: string) => isPlatformEnabled(input.next, id) && (input.confirm || !isPlatformEnabled(input.previous, id));
  if (turnedOn("twitch") && !input.twitchLoggedIn) needs.push("twitch");
  if (turnedOn("youtube") && !input.youtubeLoggedIn) needs.push("youtube");
  return needs;
}
