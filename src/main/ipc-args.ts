import type { SettingsPatch } from "../shared/api";
import { asRecord } from "../shared/record";

/** Arguments for `app:update-settings`. Unknown keys are dropped. */
export function asSettingsPatch(value: unknown): SettingsPatch {
  const row = asRecord(value);
  if (!row) throw new Error("Settings were incomplete.");
  const patch: SettingsPatch = {};
  if (typeof row.twitchClientId === "string") patch.twitchClientId = row.twitchClientId;
  if (typeof row.twitchChannel === "string") patch.twitchChannel = row.twitchChannel;
  if (typeof row.youtubeChannelId === "string") patch.youtubeChannelId = row.youtubeChannelId;
  if (typeof row.kickRelayUrl === "string") patch.kickRelayUrl = row.kickRelayUrl;
  if (typeof row.overlayPort === "number") patch.overlayPort = row.overlayPort;
  if (typeof row.alwaysOnTop === "boolean") patch.alwaysOnTop = row.alwaysOnTop;
  if (typeof row.autoImportFirebot === "boolean") patch.autoImportFirebot = row.autoImportFirebot;
  if (row.feed && typeof row.feed === "object") patch.feed = row.feed as SettingsPatch["feed"];
  if (row.sendTargets && typeof row.sendTargets === "object") patch.sendTargets = row.sendTargets as SettingsPatch["sendTargets"];
  if (row.chatAlert && typeof row.chatAlert === "object") patch.chatAlert = row.chatAlert as SettingsPatch["chatAlert"];
  if (row.platforms && typeof row.platforms === "object") patch.platforms = row.platforms as SettingsPatch["platforms"];
  if (row.tabs && typeof row.tabs === "object") patch.tabs = row.tabs as SettingsPatch["tabs"];
  return patch;
}

/** Arguments for `app:send-chat`. A missing object sends nowhere extra; the runtime then defaults Twitch on. */
export function asDestinations(value: unknown): { twitch?: boolean; youtube?: boolean; kick?: boolean } | undefined {
  const row = asRecord(value);
  if (!row) return undefined;
  const destinations: { twitch?: boolean; youtube?: boolean; kick?: boolean } = {};
  if (typeof row.twitch === "boolean") destinations.twitch = row.twitch;
  if (typeof row.youtube === "boolean") destinations.youtube = row.youtube;
  if (typeof row.kick === "boolean") destinations.kick = row.kick;
  return destinations;
}
