import { createHash, randomBytes } from "node:crypto";

/** Loopback port for Google's redirect. Not the overlay (4777) or the mod portal (4788). */
export const YOUTUBE_OAUTH_PORT = 4799;
export const YOUTUBE_OAUTH_PATH = "/youtube/callback";
export const YOUTUBE_OAUTH_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

export interface YoutubeOAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface YoutubeAuthRequest {
  url: string;
  state: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
}

export interface YoutubeRefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

export function youtubeRedirectUri(port = YOUTUBE_OAUTH_PORT): string {
  return `http://127.0.0.1:${port}${YOUTUBE_OAUTH_PATH}`;
}

export function createYoutubeAuthRequest(client: YoutubeOAuthClient, port = YOUTUBE_OAUTH_PORT, redirectUri = youtubeRedirectUri(port)): YoutubeAuthRequest {
  const clientId = client.clientId.trim();
  if (!clientId) throw new Error("Add a Google client ID before connecting YouTube.");
  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_OAUTH_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return { url: url.toString(), state, verifier, redirectUri, expiresAt: Date.now() + 5 * 60_000 };
}

export async function exchangeYoutubeCode(
  client: YoutubeOAuthClient,
  request: Pick<YoutubeAuthRequest, "verifier" | "redirectUri">,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YoutubeRefreshResult> {
  return tokenRequest(
    client,
    {
      code,
      grant_type: "authorization_code",
      redirect_uri: request.redirectUri,
      code_verifier: request.verifier,
    },
    fetchImpl,
  );
}

export async function refreshYoutubeAccessToken(
  client: YoutubeOAuthClient,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YoutubeRefreshResult> {
  const next = await tokenRequest(client, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
  return { ...next, refreshToken: next.refreshToken || refreshToken };
}

async function tokenRequest(
  client: YoutubeOAuthClient,
  fields: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<YoutubeRefreshResult> {
  const body = new URLSearchParams({ client_id: client.clientId.trim(), ...fields });
  const secret = client.clientSecret.trim();
  if (secret) body.set("client_secret", secret);
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error === "invalid_client" ? "Google rejected the client ID or secret." : "Google did not finish the YouTube login.");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? "",
    expiresIn: json.expires_in ?? 3600,
    scope: json.scope ?? YOUTUBE_OAUTH_SCOPE,
  };
}
