/**
 * Requested on every login so stage 2 (channel points) and chat send
 * do not need another consent prompt. Stage 1 uses the chat and broadcast
 * scopes. Redemption scopes are unused until stage 2.
 */
export const REQUIRED_SCOPES = [
  "chat:read",
  "chat:edit",
  "user:write:chat",
  "channel:manage:broadcast",
  "channel:read:redemptions",
  "channel:manage:redemptions",
] as const;

export type RequiredScope = (typeof REQUIRED_SCOPES)[number];

export function missingScopes(granted: readonly string[]): RequiredScope[] {
  const have = new Set(granted);
  return REQUIRED_SCOPES.filter((scope) => !have.has(scope));
}
