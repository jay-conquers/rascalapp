export const ALLOWED_HOSTS = new Set([
  "static-cdn.jtvnw.net",
  "cdn.betterttv.net",
  "cdn.frankerfacez.com",
  "cdn.7tv.app",
  "yt3.ggpht.com",
  "yt3.googleusercontent.com",
  "i.ytimg.com",
  "lh3.googleusercontent.com",
  "files.kick.com",
]);

/** Accept only https emote images on hosts this app already trusts. */
export function safeEmoteUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (value.startsWith("//")) value = `https:${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!ALLOWED_HOSTS.has(url.hostname)) return null;
  for (const key of url.searchParams.keys()) {
    if (/access_token|refresh_token|id_token|^token$|jwt/i.test(key)) return null;
  }
  return url.toString();
}

/** Loopback emote cache, or an allowlisted https image. */
export function overlayEmoteAllowed(raw: string): boolean {
  if (safeEmoteUrl(raw)) return true;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return false;
  const hash = url.pathname.slice("/emote/".length);
  return url.pathname === `/emote/${hash}` && /^[a-f0-9]{64}$/.test(hash);
}

export function colorForName(name: string, provided?: string): string {
  if (provided && /^#[0-9a-fA-F]{6}$/.test(provided)) return provided;
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 68% 68%)`;
}
