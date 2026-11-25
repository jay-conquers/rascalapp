export const TWITCH_EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws";
const TWITCH_EVENTSUB_HOST = "eventsub.wss.twitch.tv";

/** Twitch's EventSub WebSocket host. Reconnect frames may not point anywhere else. */
export function isTwitchEventSubUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "wss:" && url.hostname === TWITCH_EVENTSUB_HOST && !url.username && !url.password;
  } catch {
    return false;
  }
}
