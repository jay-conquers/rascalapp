/**
 * Requested on every login. A token from an older install is missing any scope
 * added after that login until the account logs in again.
 * channel.moderate v2 rejects the subscription unless every moderator read
 * scope below is present. Deletes need moderator:manage:chat_messages.
 * Timeouts, bans, and unbans need moderator:manage:banned_users.
 * The @ mention list for Twitch needs moderator:read:chatters.
 */
export const MODERATE_READ_SCOPES = [
  "moderator:read:blocked_terms",
  "moderator:read:chat_settings",
  "moderator:read:unban_requests",
  "moderator:read:banned_users",
  "moderator:read:chat_messages",
  "moderator:read:warnings",
  "moderator:read:moderators",
  "moderator:read:vips",
] as const;

/** Taking action from the desk, not only reading channel.moderate. */
export const MODERATE_MANAGE_SCOPES = [
  "moderator:manage:chat_messages",
  "moderator:manage:banned_users",
] as const;

/** Helix Get Chatters. YouTube has no equivalent viewer-list scope. */
export const CHATTER_SCOPE = "moderator:read:chatters";

export const REQUIRED_SCOPES = [
  "chat:read",
  "chat:edit",
  "user:write:chat",
  "user:read:chat",
  "channel:manage:broadcast",
  "channel:read:redemptions",
  "channel:manage:redemptions",
  "moderator:read:followers",
  CHATTER_SCOPE,
  ...MODERATE_MANAGE_SCOPES,
  ...MODERATE_READ_SCOPES,
] as const;

export type RequiredScope = (typeof REQUIRED_SCOPES)[number];

export function missingScopes(granted: readonly string[]): RequiredScope[] {
  const have = new Set(granted);
  return REQUIRED_SCOPES.filter((scope) => !have.has(scope));
}

/** The private mod log's EventSub subscription needs these, not the manage scopes. */
export function twitchLoginMissesReadScopes(auth: { loggedIn: boolean; missingScopes: readonly string[] }): boolean {
  if (!auth.loggedIn) return false;
  return MODERATE_READ_SCOPES.some((scope) => auth.missingScopes.includes(scope));
}
