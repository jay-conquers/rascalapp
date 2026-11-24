/**
 * Requested on every login. A token from an older install is missing the
 * moderator and chat-notice scopes until the account logs in again.
 * channel.moderate v2 rejects the subscription unless every moderator:read
 * scope below is present. Read scopes are enough; manage scopes are not requested.
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

export const REQUIRED_SCOPES = [
  "chat:read",
  "chat:edit",
  "user:write:chat",
  "user:read:chat",
  "channel:manage:broadcast",
  "channel:read:redemptions",
  "channel:manage:redemptions",
  "moderator:read:followers",
  ...MODERATE_READ_SCOPES,
] as const;

export type RequiredScope = (typeof REQUIRED_SCOPES)[number];

export function missingScopes(granted: readonly string[]): RequiredScope[] {
  const have = new Set(granted);
  return REQUIRED_SCOPES.filter((scope) => !have.has(scope));
}
