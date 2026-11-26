export const DEFAULT_TWITCH_CHANNEL = "";
export const DEFAULT_YOUTUBE_CHANNEL_ID = "";
export const DEFAULT_OVERLAY_PORT = 4777;
export const MAX_CHAT_MESSAGES = 500;
export const TWITCH_TITLE_MAX = 140;
export const YOUTUBE_TITLE_MAX = 100;
export const KICK_TITLE_MAX = 200;
export const TWITCH_MESSAGE_MAX = 500;

/**
 * YouTube's public Innertube key from the youtube.com web client.
 * It is not a Rascal credential and it is not a user's Google key. The live
 * chat page normally includes its own copy; this is only the fallback when
 * that copy is missing. The same value ships in YouTube's public JavaScript.
 * It cannot read a Google account. Quota for it belongs to Google, not the streamer.
 */
export const YOUTUBE_WEB_API_KEY_FALLBACK = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
export const YOUTUBE_CLIENT_VERSION_FALLBACK = "2.20251120.01.00";

export const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Chrome UA for YouTube page fetches. Linux keeps the string this app already sends. */
export function browserUserAgent(platform?: NodeJS.Platform): string {
  const host = platform ?? (typeof process === "undefined" ? "linux" : process.platform);
  if (host === "win32") {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  }
  if (host === "darwin") {
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  }
  return BROWSER_UA;
}
