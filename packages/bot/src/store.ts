import fs from "node:fs";
import path from "node:path";
import { readBrandEnv } from "../../../src/shared/brand.ts";
import { chmodPrivate } from "../../../src/shared/private-mode.ts";
import { defaultBotFile, normalizeBotFile, type BotFile } from "./model.ts";

export interface BotTokens {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  userId: string;
  login: string;
}

export interface YoutubeBotTokens {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  channelId: string;
  title: string;
}

export interface GoogleClientFile {
  clientId: string;
  clientSecret: string;
}

export interface BotSecrets {
  apiKey: string;
  sessionSecret: string;
  seJwt: string;
}

export class BotStore {
  readonly configFile: string;
  readonly tokenFile: string;
  readonly secretFile: string;
  readonly youtubeTokenFile: string;
  readonly deskTwitchTokenFile: string;
  readonly deskYoutubeTokenFile: string;
  readonly googleClientFile: string;

  constructor(dir: string) {
    this.configFile = path.join(dir, "bot.json");
    this.tokenFile = path.join(dir, "bot-tokens.json");
    this.secretFile = path.join(dir, "bot-secrets.json");
    this.youtubeTokenFile = path.join(dir, "bot-youtube-tokens.json");
    this.deskTwitchTokenFile = path.join(dir, "tokens.json");
    this.deskYoutubeTokenFile = path.join(dir, "youtube-tokens.json");
    this.googleClientFile = path.join(dir, "google-client.json");
  }

  loadConfig(): BotFile {
    return normalizeBotFile(readJson(this.configFile));
  }

  saveConfig(file: BotFile): BotFile {
    const next = normalizeBotFile(file);
    writePrivate(this.configFile, next);
    return next;
  }

  loadTokens(): BotTokens | null {
    return this.loadTokenRecord(readJson(this.tokenFile));
  }

  private loadTokenRecord(value: unknown): BotTokens | null {
    const row = asRecord(value);
    if (!row || typeof row.accessToken !== "string" || typeof row.refreshToken !== "string") return null;
    return {
      clientId: typeof row.clientId === "string" ? row.clientId : "",
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      expiresAt: typeof row.expiresAt === "number" ? row.expiresAt : 0,
      scopes: Array.isArray(row.scopes) ? row.scopes.filter((item): item is string => typeof item === "string") : [],
      userId: typeof row.userId === "string" ? row.userId : "",
      login: typeof row.login === "string" ? row.login : "",
    };
  }

  saveTokens(tokens: BotTokens): void {
    writePrivate(this.tokenFile, tokens);
  }

  clearTokens(): void {
    try {
      fs.rmSync(this.tokenFile);
    } catch {
      // Already gone.
    }
  }

  loadYoutubeTokens(): YoutubeBotTokens | null {
    return readYoutubeTokens(readJson(this.youtubeTokenFile));
  }

  saveYoutubeTokens(tokens: YoutubeBotTokens): void {
    writePrivate(this.youtubeTokenFile, tokens);
  }

  clearYoutubeTokens(): void {
    try {
      fs.rmSync(this.youtubeTokenFile);
    } catch {
      // Already gone.
    }
  }

  loadDeskTwitchTokens(): BotTokens | null {
    return this.loadTokenRecord(readJson(this.deskTwitchTokenFile));
  }

  saveDeskTwitchTokens(tokens: BotTokens): void {
    writePrivate(this.deskTwitchTokenFile, tokens);
  }

  loadDeskYoutubeTokens(): YoutubeBotTokens | null {
    return readYoutubeTokens(readJson(this.deskYoutubeTokenFile));
  }

  saveDeskYoutubeTokens(tokens: YoutubeBotTokens): void {
    writePrivate(this.deskYoutubeTokenFile, tokens);
  }

  clearDeskYoutubeTokens(): void {
    try {
      fs.rmSync(this.deskYoutubeTokenFile);
    } catch {
      // Already gone.
    }
  }

  loadGoogleClient(): GoogleClientFile {
    const row = asRecord(readJson(this.googleClientFile));
    return {
      clientId: typeof row?.clientId === "string" ? row.clientId.trim() : "",
      clientSecret: typeof row?.clientSecret === "string" ? row.clientSecret : "",
    };
  }

  saveGoogleClient(client: GoogleClientFile): void {
    const previous = this.loadGoogleClient();
    writePrivate(this.googleClientFile, {
      clientId: client.clientId.trim(),
      clientSecret: client.clientSecret || previous.clientSecret,
    });
  }

  loadSecrets(): BotSecrets {
    const row = asRecord(readJson(this.secretFile));
    const apiKey = secretFromEnv("BOT_API_KEY") || (typeof row?.apiKey === "string" && row.apiKey.length >= 16 ? row.apiKey : randomKey());
    const sessionSecret =
      secretFromEnv("BOT_SESSION_SECRET") ||
      (typeof row?.sessionSecret === "string" && row.sessionSecret.length >= 16 ? row.sessionSecret : randomKey());
    const seJwt = typeof row?.seJwt === "string" ? row.seJwt : "";
    const secrets = { apiKey, sessionSecret, seJwt };
    if (!row || row.apiKey !== apiKey || row.sessionSecret !== sessionSecret) writePrivate(this.secretFile, secrets);
    return secrets;
  }

  saveSecrets(secrets: BotSecrets): void {
    writePrivate(this.secretFile, secrets);
  }
}

export function emptyConfig(): BotFile {
  return defaultBotFile();
}

function secretFromEnv(suffix: string): string {
  const value = readBrandEnv(suffix)?.trim() ?? "";
  return value.length >= 16 ? value : "";
}

function randomKey(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function writePrivate(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // 0700/0600 on POSIX. Windows skips chmod; the profile ACL is the control.
  chmodPrivate(path.dirname(file), 0o700);
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  chmodPrivate(tmp, 0o600);
  fs.renameSync(tmp, file);
  chmodPrivate(file, 0o600);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function readYoutubeTokens(value: unknown): YoutubeBotTokens | null {
  const row = asRecord(value);
  if (!row || typeof row.accessToken !== "string" || typeof row.refreshToken !== "string") return null;
  return {
    clientId: typeof row.clientId === "string" ? row.clientId : "",
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: typeof row.expiresAt === "number" ? row.expiresAt : 0,
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((item): item is string => typeof item === "string") : [],
    channelId: typeof row.channelId === "string" ? row.channelId : "",
    title: typeof row.title === "string" ? row.title : "",
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
