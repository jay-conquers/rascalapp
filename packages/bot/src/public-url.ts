import { readBrandEnv } from "../../../src/shared/brand.ts";
import { YOUTUBE_OAUTH_PATH, youtubeRedirectUri } from "../../../src/shared/platform/youtube-oauth.ts";

/**
 * The origin browsers and the desktop app use.
 * PUBLIC_BASE_URL is the name in the self-host example.
 * RASCAL_PUBLIC_BASE_URL and RASCAL_BOT_PUBLIC_URL are the same setting.
 */
export function readConfiguredPublicBase(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PUBLIC_BASE_URL || readBrandEnv("PUBLIC_BASE_URL") || readBrandEnv("BOT_PUBLIC_URL") || "";
  return parsePublicBaseUrl(raw);
}

/** https origin, or http only for this computer. Path, query, and userinfo are dropped. */
export function parsePublicBaseUrl(value: string): string {
  const text = value.trim();
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "";
  }
  if (url.username || url.password) return "";
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) return url.origin;
  return "";
}

export function portalRedirectUri(base: string, port: number): string {
  const origin = parsePublicBaseUrl(base);
  if (origin) return `${origin}/portal/callback`;
  return `http://localhost:${port}/portal/callback`;
}

export function youtubePublicRedirect(base: string): string {
  const origin = parsePublicBaseUrl(base);
  if (origin) return `${origin}${YOUTUBE_OAUTH_PATH}`;
  return youtubeRedirectUri();
}

export function isLoopbackRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}
