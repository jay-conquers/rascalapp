import path from "node:path";
import type { PlatformSetupEvidence } from "../shared/platform/selection";
import { asRecord } from "../shared/record";
import { readJson } from "./private-file";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A saved login or client file counts as that platform already being connected. */
function credential(file: string, keys: string[]): boolean {
  const row = asRecord(readJson(file));
  if (!row) return false;
  return keys.some((key) => text(row[key]).length > 0);
}

/**
 * What an older install already had, before `platforms` existed in settings.
 * A channel, client id, or token file selects that platform. Nothing here deletes those files.
 */
export function readPlatformSetup(
  dir: string,
  settings: { twitchChannel?: string; twitchClientId?: string; youtubeChannelId?: string; sendTargets?: { youtube?: boolean } },
): PlatformSetupEvidence {
  const bot = asRecord(readJson(path.join(dir, "bot.json")));
  return {
    twitch:
      text(settings.twitchChannel).length > 0 ||
      text(settings.twitchClientId).length > 0 ||
      text(bot?.channelLogin).length > 0 ||
      text(bot?.broadcasterId).length > 0 ||
      credential(path.join(dir, "tokens.json"), ["accessToken", "login"]) ||
      credential(path.join(dir, "bot-tokens.json"), ["accessToken", "login"]),
    youtube:
      text(settings.youtubeChannelId).length > 0 ||
      settings.sendTargets?.youtube === true ||
      text(bot?.youtubeChannelId).length > 0 ||
      credential(path.join(dir, "youtube-tokens.json"), ["accessToken", "channelId"]) ||
      credential(path.join(dir, "bot-youtube-tokens.json"), ["accessToken", "channelId"]) ||
      credential(path.join(dir, "google-client.json"), ["clientId"]),
  };
}
