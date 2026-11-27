import type { SettingsPatch } from "../shared/api";
import { defaultChatAlert, mergeChatAlert, type ChatAlertSettings } from "../shared/chat-alert";
import { defaultFeed, mergeFeed, type FeedToggles } from "../shared/feed-toggles";
import { normalizeRelayUrl } from "../shared/kick/protocol";
import { CHATTER_SCOPE, MODERATE_MANAGE_SCOPES, MODERATE_READ_SCOPES } from "../shared/scopes";
import type { Settings } from "../shared/types";

/** Shown under Advanced. A normal login does not need this list on screen. */
export const TWITCH_SCOPE_REASONS = [
  ["chat:read", "Read chat while logged in"],
  ["chat:edit", "Send chat over IRC if needed"],
  ["user:write:chat", "Send chat from this desk"],
  ["user:read:chat", "EventSub notices: subs, raids, watch streaks, mod anniversaries"],
  ["channel:manage:broadcast", "Change title, category, and tags"],
  ["channel:read:redemptions", "Hear channel point redeems"],
  ["channel:manage:redemptions", "Create rewards this app owns"],
  ["moderator:read:followers", "Show new follows in the desk"],
  [MODERATE_MANAGE_SCOPES[0], "Delete a chat message from this desk"],
  [MODERATE_MANAGE_SCOPES[1], "Timeout, ban, and unban from this desk"],
  [CHATTER_SCOPE, "Suggest Twitch chatters when you type @"],
  ...MODERATE_READ_SCOPES.map((scope) => [scope, "Private mod log (channel.moderate)"] as const),
] as const;

/** Left-nav order on the Settings screen. */
export const SETTINGS_SECTIONS = [
  { id: "platforms", label: "Platforms" },
  { id: "chat", label: "Chat & Bot" },
  { id: "tabs", label: "Tabs" },
  { id: "alerts", label: "Alerts" },
  { id: "moderation", label: "Moderation" },
  { id: "app", label: "App" },
  { id: "advanced", label: "Advanced" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export function settingsSectionLabel(id: SettingsSectionId): string {
  const found = SETTINGS_SECTIONS.find((section) => section.id === id);
  if (!found) return id;
  return found.label;
}

/** Fields the Settings save button writes. Other controls save on their own. */
export interface SettingsFormDraft {
  twitchClientId: string;
  twitchChannel: string;
  youtubeChannelId: string;
  kickRelayUrl: string;
  overlayPort: string;
  autoImportFirebot: boolean;
  feed: FeedToggles;
  chatAlert: ChatAlertSettings;
}

export function settingsFormFromSettings(settings: Settings): SettingsFormDraft {
  return {
    twitchClientId: settings.twitchClientId,
    twitchChannel: settings.twitchChannel,
    youtubeChannelId: settings.youtubeChannelId,
    kickRelayUrl: settings.kickRelayUrl,
    overlayPort: String(settings.overlayPort),
    autoImportFirebot: settings.autoImportFirebot !== false,
    feed: settings.feed,
    chatAlert: settings.chatAlert ?? defaultChatAlert(),
  };
}

/**
 * True when Save would write something different.
 * A change that stores the same value, such as channel letter case, stays clean.
 */
export function settingsFormDirty(saved: Settings, draft: SettingsFormDraft): boolean {
  return canonicalSettingsForm(settingsFormFromSettings(saved)) !== canonicalSettingsForm(draft);
}

function canonicalSettingsForm(input: SettingsFormDraft): string {
  let relay = input.kickRelayUrl.trim();
  try {
    relay = normalizeRelayUrl(input.kickRelayUrl);
  } catch {
    relay = input.kickRelayUrl.trim();
  }
  const port = Number(input.overlayPort);
  return JSON.stringify({
    twitchClientId: input.twitchClientId.trim(),
    twitchChannel: input.twitchChannel.trim().replace(/^#/, "").toLowerCase(),
    youtubeChannelId: input.youtubeChannelId.trim(),
    kickRelayUrl: relay,
    overlayPort: Number.isFinite(port) ? port : input.overlayPort.trim(),
    autoImportFirebot: input.autoImportFirebot === true,
    feed: mergeFeed(defaultFeed(), input.feed),
    chatAlert: mergeChatAlert(defaultChatAlert(), input.chatAlert),
  });
}

/**
 * Payload for the Settings form's Save button.
 * Keys match settings.json. Trimming matches the form that shipped before 0.14.0.
 * Platforms, tabs, the Kick secret, the Kick app, and the bot link save on their own.
 */
export function settingsFormPatch(input: SettingsFormDraft): SettingsPatch {
  return {
    twitchClientId: input.twitchClientId.trim(),
    twitchChannel: input.twitchChannel.trim(),
    youtubeChannelId: input.youtubeChannelId.trim(),
    kickRelayUrl: input.kickRelayUrl.trim(),
    overlayPort: Number(input.overlayPort),
    autoImportFirebot: input.autoImportFirebot,
    feed: input.feed,
    chatAlert: input.chatAlert,
  };
}
