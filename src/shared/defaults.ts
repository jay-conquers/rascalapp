import { brand } from "./brand";

export const APP_NAME = brand.configDirName;
export const DEFAULT_TWITCH_CHANNEL = "";
export const DEFAULT_YOUTUBE_CHANNEL_ID = "";
export const DEFAULT_OVERLAY_PORT = 4777;
export const MAX_CHAT_MESSAGES = 500;
export const TWITCH_TITLE_MAX = 140;
export const TWITCH_MESSAGE_MAX = 500;

/** YouTube's public web client key, read from the live chat page when present. */
export const YOUTUBE_WEB_API_KEY_FALLBACK = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
export const YOUTUBE_CLIENT_VERSION_FALLBACK = "2.20251120.01.00";

export const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
