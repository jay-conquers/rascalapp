import { createHash, randomBytes } from "node:crypto";

/** Loopback port for Kick's redirect. Not the overlay (4777), the bot (4788), or YouTube (4799). */
export const KICK_OAUTH_PORT = 4801;
export const KICK_OAUTH_PATH = "/kick/callback";

/**
 * Kick's authorize page rewrites 127.0.0.1 to localhost.
 * The registered redirect uses localhost. The process still listens on 127.0.0.1.
 */
export const KICK_SCOPES = [
  "user:read",
  "channel:read",
  "chat:write",
  "events:subscribe",
  "moderation:ban",
  "moderation:chat_message:manage",
].join(" ");

export interface KickOAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface KickAuthRequest {
  url: string;
  state: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
}

export interface KickTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

export function kickRedirectUri(port = KICK_OAUTH_PORT): string {
  return `http://localhost:${port}${KICK_OAUTH_PATH}`;
}

export function createKickAuthRequest(client: KickOAuthClient, redirectUri = kickRedirectUri()): KickAuthRequest {
  const clientId = client.clientId.trim();
  if (!clientId) throw new Error("Add a Kick client ID before logging in.");
  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://id.kick.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", KICK_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), state, verifier, redirectUri, expiresAt: Date.now() + 5 * 60_000 };
}

export async function exchangeKickCode(
  client: KickOAuthClient,
  request: Pick<KickAuthRequest, "verifier" | "redirectUri">,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KickTokenResult> {
  return tokenRequest(
    client,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: request.redirectUri,
      code_verifier: request.verifier,
    },
    fetchImpl,
  );
}

export async function refreshKickAccessToken(
  client: KickOAuthClient,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KickTokenResult> {
  const next = await tokenRequest(client, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
  return { ...next, refreshToken: next.refreshToken || refreshToken };
}

async function tokenRequest(client: KickOAuthClient, fields: Record<string, string>, fetchImpl: typeof fetch): Promise<KickTokenResult> {
  const body = new URLSearchParams({
    client_id: client.clientId.trim(),
    client_secret: client.clientSecret,
    ...fields,
  });
  const response = await fetchImpl("https://id.kick.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
    scope?: string;
    error?: string;
    message?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error === "invalid_client" ? "Kick rejected the client ID or secret." : "Kick did not finish the login.");
  }
  const expiresIn = Number(json.expires_in);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? "",
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
    scope: json.scope ?? KICK_SCOPES,
  };
}
