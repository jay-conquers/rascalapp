export interface KickClientFile {
  clientId: string;
  clientSecret: string;
}

export interface KickTokens {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  userId: string;
  login: string;
  slug: string;
}

export interface KickRelayFile {
  secret: string;
}

export function parseKickClient(value: unknown): KickClientFile {
  const row = record(value);
  return {
    clientId: text(row?.clientId),
    clientSecret: typeof row?.clientSecret === "string" ? row.clientSecret : "",
  };
}

export function parseKickTokens(value: unknown): KickTokens | null {
  const row = record(value);
  if (!row || typeof row.accessToken !== "string" || typeof row.refreshToken !== "string" || !row.accessToken) return null;
  return {
    clientId: text(row.clientId),
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: typeof row.expiresAt === "number" ? row.expiresAt : 0,
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((item): item is string => typeof item === "string") : [],
    userId: text(row.userId),
    login: text(row.login),
    slug: text(row.slug),
  };
}

export function parseKickRelay(value: unknown): KickRelayFile {
  const row = record(value);
  return { secret: typeof row?.secret === "string" ? row.secret : "" };
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
