import { jsonObject } from "../record.ts";

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
  const row = jsonObject(value);
  return {
    clientId: text(row?.clientId),
    clientSecret: typeof row?.clientSecret === "string" ? row.clientSecret : "",
  };
}

export function parseKickTokens(value: unknown): KickTokens | null {
  const row = jsonObject(value);
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
  const row = jsonObject(value);
  return { secret: typeof row?.secret === "string" ? row.secret : "" };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
