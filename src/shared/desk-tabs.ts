/**
 * Which panels appear in the desk's top bar.
 *
 * The saved value is `settings.tabs` in settings.json. A missing key, an empty
 * list, or a file from 0.10.0 or earlier shows every tab. Chat is the main
 * panel and is always shown. Settings stays in the bar so a hidden tab can
 * be turned back on; it is not part of this list.
 *
 * Hiding a tab removes its button. If that panel is open, the desk returns
 * to Chat. The bot, platform connections, overlays, and a headless bot keep
 * running. None of them read this setting.
 *
 * Redeems is also absent while Twitch is off in the platform picker. That
 * rule is separate: turning Twitch off does not add Redeems to `hidden`, and
 * turning Twitch back on shows Redeems again unless the user hid it here.
 */

import { isPlatformEnabled, platformLabel, type PlatformSelection } from "./platform/selection";

export type DeskView = "desk" | "settings" | "redeems" | "stream" | "chat" | "tts" | "bot";

export interface DeskTab {
  id: string;
  label: string;
  /** Renderer view. Chat uses the desk. The chat overlay uses "chat". */
  view: DeskView;
  /** Locked tabs are always shown and are never stored in `hidden`. */
  locked: boolean;
  /**
   * When set, the platform picker also hides this tab while that platform is off.
   * The saved `hidden` list is left as the user set it.
   */
  platform?: string;
}

export const DESK_TABS: readonly DeskTab[] = [
  { id: "chat", label: "Chat", view: "desk", locked: true },
  { id: "redeems", label: "Redeems", view: "redeems", locked: false, platform: "twitch" },
  { id: "stream", label: "Stream info", view: "stream", locked: false },
  { id: "overlay", label: "Chat overlay", view: "chat", locked: false },
  { id: "tts", label: "TTS", view: "tts", locked: false },
  { id: "bot", label: "Bot", view: "bot", locked: false },
];

/** Tab ids the user hid, in bar order. Chat is never included. Empty shows every tab. */
export interface TabSettings {
  hidden: string[];
}

export const TABS_SUMMARY =
  "Choose which panels stay in the bar. Chat always stays. Hiding a panel removes it from this window. The bot, overlays, and connections keep running.";

export const CHAT_ALWAYS_NOTE = "Chat always shows.";

export function defaultTabs(): TabSettings {
  return { hidden: [] };
}

/** One sentence per tab that a platform can also hide. Empty when none can. */
export function tabsPlatformSummary(catalog: readonly DeskTab[] = DESK_TABS): string {
  return catalog
    .filter((tab) => tab.platform)
    .map((tab) => {
      const name = platformLabel(tab.platform ?? "");
      return `${tab.label} is also hidden while ${name} is turned off under Platforms. Turning ${name} back on shows ${tab.label} again, unless it is hidden here.`;
    })
    .join(" ");
}

const HIDEABLE_IDS = DESK_TABS.filter((tab) => !tab.locked).map((tab) => tab.id);

function normalizeHidden(ids: readonly string[]): TabSettings {
  const wanted = new Set(ids.filter((id) => HIDEABLE_IDS.includes(id)));
  return { hidden: HIDEABLE_IDS.filter((id) => wanted.has(id)) };
}

/**
 * Accept `{ hidden: string[] }` or a hand-written `{ bot: false, tts: false }`.
 * Chat, unknown ids, and a missing or broken value show every tab.
 * When `hidden` is an array it is the whole list, including an empty one.
 */
export function parseTabs(saved: unknown): TabSettings {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaultTabs();
  const row = saved as Record<string, unknown>;
  if (Array.isArray(row.hidden)) {
    return normalizeHidden(row.hidden.filter((id): id is string => typeof id === "string"));
  }
  const hidden = DESK_TABS.filter((tab) => !tab.locked && row[tab.id] === false).map((tab) => tab.id);
  return { hidden };
}

/** Omit the field to keep the current list. A provided value replaces it. */
export function tabsFromPatch(current: TabSettings | undefined, patch: unknown): TabSettings {
  if (patch === undefined) return parseTabs(current ?? defaultTabs());
  return parseTabs(patch);
}

/** Check a tab on or off. Chat and unknown ids stay as they are. */
export function setTabShown(current: TabSettings | undefined, id: string, shown: boolean): TabSettings {
  const tabs = parseTabs(current ?? defaultTabs());
  const tab = DESK_TABS.find((entry) => entry.id === id);
  if (!tab || tab.locked) return tabs;
  const hidden = new Set(tabs.hidden);
  if (shown) hidden.delete(id);
  else hidden.add(id);
  return normalizeHidden([...hidden]);
}

/** The user's checkbox. Chat is always checked. This ignores the platform picker. */
export function tabChosen(tabs: TabSettings | undefined, id: string): boolean {
  const tab = DESK_TABS.find((entry) => entry.id === id);
  if (!tab) return false;
  if (tab.locked) return true;
  return !parseTabs(tabs ?? defaultTabs()).hidden.includes(id);
}

/** True when the button belongs in the bar: the user left it on, and its platform is on. */
export function tabInBar(tabs: TabSettings | undefined, platforms: PlatformSelection | undefined, id: string): boolean {
  if (!tabChosen(tabs, id)) return false;
  const tab = DESK_TABS.find((entry) => entry.id === id);
  if (!tab) return false;
  if (tab.platform && !isPlatformEnabled(platforms, tab.platform)) return false;
  return true;
}

/**
 * Short note for a tab the platform picker is currently hiding.
 * Empty when the platform is on, or when this tab has no platform gate.
 */
export function platformGateNote(tab: DeskTab, tabs: TabSettings | undefined, platforms: PlatformSelection | undefined): string {
  if (!tab.platform || isPlatformEnabled(platforms, tab.platform)) return "";
  const name = platformLabel(tab.platform);
  if (parseTabs(tabs ?? defaultTabs()).hidden.includes(tab.id)) return `Stays hidden after ${name} is turned back on.`;
  return `Hidden while ${name} is off.`;
}

/** Settings stays open. A hidden or platform-gated panel falls back to Chat. */
export function resolveDeskView(view: string, tabs: TabSettings | undefined, platforms: PlatformSelection | undefined): DeskView {
  if (view === "settings") return "settings";
  const tab = DESK_TABS.find((entry) => entry.view === view);
  if (tab && tabInBar(tabs, platforms, tab.id)) return tab.view;
  return "desk";
}
