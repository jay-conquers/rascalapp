const ALLOWED_HOSTS = new Set([
  "static-cdn.jtvnw.net",
  "cdn.betterttv.net",
  "cdn.frankerfacez.com",
  "cdn.7tv.app",
  "yt3.ggpht.com",
  "yt3.googleusercontent.com",
  "i.ytimg.com",
  "lh3.googleusercontent.com",
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
  if (!ALLOWED_HOSTS.has(url.hostname)) return null;
  return url.toString();
}

export function colorForName(name: string, provided?: string): string {
  if (provided && /^#[0-9a-fA-F]{6}$/.test(provided)) return provided;
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 68% 68%)`;
}
