import fs from "node:fs";
import path from "node:path";
import { readJson, tightenFile, writePrivateJson } from "./private-file";

export interface StoredTokens {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  userId: string;
  login: string;
}

export class TokenStore {
  readonly file: string;
  current: StoredTokens | null = null;

  constructor(dir: string) {
    this.file = path.join(dir, "tokens.json");
    tightenFile(this.file);
    this.current = this.read();
  }

  save(tokens: StoredTokens): void {
    this.current = tokens;
    writePrivateJson(this.file, tokens);
  }

  clear(): void {
    this.current = null;
    try {
      fs.unlinkSync(this.file);
    } catch {
      // Already gone.
    }
  }

  private read(): StoredTokens | null {
    const raw = readJson(this.file);
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Partial<StoredTokens>;
    if (
      typeof row.accessToken !== "string" ||
      typeof row.refreshToken !== "string" ||
      typeof row.clientId !== "string" ||
      typeof row.userId !== "string" ||
      typeof row.login !== "string" ||
      !Array.isArray(row.scopes)
    ) {
      return null;
    }
    return {
      clientId: row.clientId,
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      expiresAt: typeof row.expiresAt === "number" ? row.expiresAt : 0,
      scopes: row.scopes.filter((scope): scope is string => typeof scope === "string"),
      userId: row.userId,
      login: row.login,
    };
  }
}
