import { safeEmoteUrl } from "./emote-url";
import type { WordEmote } from "./word-emotes";

/** Numeric ids and the newer emotesv2 ids. Anything else could change the image URL. */
const EMOTE_ID = /^(?:[0-9]{1,20}|emotesv2_[A-Za-z0-9]{1,80})$/;

/** Twitch emote CDN. Channel, sub, follower, and global emotes share this path. */
export function twitchEmoteUrl(id: string): string | null {
  if (!EMOTE_ID.test(id)) return null;
  return `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`;
}

/** Helix Get Channel Emotes. Names stay exact, including a channel prefix such as jaycon2. */
export function indexChannelEmotes(payload: unknown): Map<string, WordEmote> {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const rows = Array.isArray(root?.data) ? root.data : Array.isArray(payload) ? payload : [];
  const map = new Map<string, WordEmote>();
  for (const item of rows) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const name = typeof row?.name === "string" ? row.name : "";
    const id = typeof row?.id === "string" ? row.id : "";
    if (!/^[\w]{1,50}$/.test(name)) continue;
    const images = row?.images && typeof row.images === "object" ? (row.images as Record<string, unknown>) : null;
    const fromApi =
      (typeof images?.url_2x === "string" && images.url_2x) ||
      (typeof images?.url_1x === "string" && images.url_1x) ||
      (typeof images?.url_4x === "string" && images.url_4x) ||
      "";
    const url = safeEmoteUrl(fromApi) || twitchEmoteUrl(id);
    if (!url) continue;
    map.set(name, { name, url, source: "twitch" });
  }
  return map;
}
