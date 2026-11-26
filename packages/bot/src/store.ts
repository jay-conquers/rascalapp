import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readBrandEnv } from "../../../src/shared/brand.ts";
import { parseKickClient, parseKickRelay, parseKickTokens, type KickClientFile, type KickRelayFile, type KickTokens } from "../../../src/shared/kick/account.ts";
import { chmodPrivate } from "../../../src/shared/private-mode.ts";
import { normalizeEnabledIds } from "../../../src/shared/platform/selection.ts";
import { normalizeBotFile, type BotFile } from "./model.ts";
import { asRecord } from "../../../src/shared/record.ts";

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
  readonly kickClientFile: string;
  readonly kickTokenFile: string;
  readonly kickRelayFile: string;
  readonly enabledPlatformsFile: string;

  constructor(dir: string) {
    this.configFile = path.join(dir, "bot.json");
    this.tokenFile = path.join(dir, "bot-tokens.json");
    this.secretFile = path.join(dir, "bot-secrets.json");
    this.youtubeTokenFile = path.join(dir, "bot-youtube-tokens.json");
    this.deskTwitchTokenFile = path.join(dir, "tokens.json");
    this.deskYoutubeTokenFile = path.join(dir, "youtube-tokens.json");
    this.googleClientFile = path.join(dir, "google-client.json");
    this.kickClientFile = path.join(dir, "kick-client.json");
    this.kickTokenFile = path.join(dir, "kick-tokens.json");
    this.kickRelayFile = path.join(dir, "kick-relay.json");
    this.enabledPlatformsFile = path.join(dir, "enabled-platforms.json");
  }

  /**
   * Null means the bot was never told to hide a platform, so every registered
   * platform stays connected. A saved list is what the desk last chose.
   */
  loadEnabledPlatforms(): string[] | null {
    const row = asRecord(readJson(this.enabledPlatformsFile));
    if (!row || !Array.isArray(row.enabled)) return null;
    const enabled = normalizeEnabledIds(row.enabled.filter((id): id is string => typeof id === "string"));
    return enabled.length > 0 ? enabled : ["twitch"];
  }

  saveEnabledPlatforms(ids: readonly string[]): void {
    writePrivate(this.enabledPlatformsFile, { enabled: [...ids] });
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

  loadKickClient(): KickClientFile {
    const fromFile = parseKickClient(readJson(this.kickClientFile));
    return {
      clientId: readBrandEnv("KICK_CLIENT_ID")?.trim() || fromFile.clientId,
      clientSecret: readBrandEnv("KICK_CLIENT_SECRET") ?? fromFile.clientSecret,
    };
  }

  saveKickClient(client: KickClientFile): void {
    const previous = this.loadKickClient();
    writePrivate(this.kickClientFile, {
      clientId: client.clientId.trim(),
      clientSecret: client.clientSecret || previous.clientSecret,
    });
  }

  loadKickTokens(): KickTokens | null {
    return parseKickTokens(readJson(this.kickTokenFile));
  }

  saveKickTokens(tokens: KickTokens): void {
    writePrivate(this.kickTokenFile, tokens);
  }

  clearKickTokens(): void {
    try {
      fs.rmSync(this.kickTokenFile);
    } catch {
      // Already gone.
    }
  }

  loadKickRelay(): KickRelayFile {
    const fromFile = parseKickRelay(readJson(this.kickRelayFile));
    const secret = readBrandEnv("KICK_RELAY_SECRET") ?? fromFile.secret;
    return { secret };
  }

  saveKickRelay(secret: string): void {
    const previous = this.loadKickRelay();
    writePrivate(this.kickRelayFile, { secret: secret || previous.secret });
  }

  /** The desktop stores the relay address in settings.json. An env value wins. */
  loadKickRelayUrl(): string {
    const fromEnv = readBrandEnv("KICK_RELAY_URL")?.trim();
    if (fromEnv) return fromEnv;
    const settings = asRecord(readJson(path.join(path.dirname(this.configFile), "settings.json")));
    return typeof settings?.kickRelayUrl === "string" ? settings.kickRelayUrl.trim() : "";
  }

  loadSecrets(): BotSecrets {
    const row = asRecord(readJson(this.secretFile));
    const apiKey = secretFromEnv("BOT_API_KEY") || (typeof row?.apiKey === "string" && row.apiKey.length >= 16 ? row.apiKey : generateSecret());
    const sessionSecret =
      secretFromEnv("BOT_SESSION_SECRET") ||
      (typeof row?.sessionSecret === "string" && row.sessionSecret.length >= 16 ? row.sessionSecret : generateSecret());
    const seJwt = typeof row?.seJwt === "string" ? row.seJwt : "";
    const secrets = { apiKey, sessionSecret, seJwt };
    if (!row || row.apiKey !== apiKey || row.sessionSecret !== sessionSecret) writePrivate(this.secretFile, secrets);
    return secrets;
  }

  saveSecrets(secrets: BotSecrets): void {
    writePrivate(this.secretFile, secrets);
  }
}

function secretFromEnv(suffix: string): string {
  const value = readBrandEnv(suffix)?.trim() ?? "";
  return value.length >= 16 ? value : "";
}

export function generateSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
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

