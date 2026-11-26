import type { SettingsPatch } from "../shared/api";
import type { ChatAlertSettings } from "../shared/chat-alert";
import type { FeedToggles } from "../shared/feed-toggles";
import { CHATTER_SCOPE, MODERATE_MANAGE_SCOPES, MODERATE_READ_SCOPES } from "../shared/scopes";

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

/**
 * Payload for the Settings form's Save button.
 * Keys match settings.json. Trimming matches the form that shipped before 0.14.0.
 * Platforms, tabs, the Kick secret, the Kick app, and the bot link save on their own.
 */
export function settingsFormPatch(input: {
  twitchClientId: string;
  twitchChannel: string;
  youtubeChannelId: string;
  kickRelayUrl: string;
  overlayPort: string;
  autoImportFirebot: boolean;
  feed: FeedToggles;
  chatAlert: ChatAlertSettings;
}): SettingsPatch {
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
