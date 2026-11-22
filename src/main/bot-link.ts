import path from "node:path";
import { validateBotServerUrl } from "../../packages/bot/src/model.ts";
import { readJson, writePrivateJson } from "./private-file";

export interface BotLink {
  mode: "embedded" | "server";
  serverUrl: string;
  adminToken: string;
}

export interface BotLinkView {
  mode: "embedded" | "server";
  serverUrl: string;
  tokenSet: boolean;
}

export function botLinkFile(dir: string): string {
  return path.join(dir, "bot-link.json");
}

export function loadBotLink(dir: string): BotLink {
  const row = asRecord(readJson(botLinkFile(dir)));
  const mode = row?.mode === "server" ? "server" : "embedded";
  return {
    mode,
    serverUrl: typeof row?.serverUrl === "string" ? row.serverUrl : "",
    adminToken: typeof row?.adminToken === "string" ? row.adminToken : "",
  };
}

export function saveBotLink(dir: string, patch: { mode: "embedded" | "server"; serverUrl: string; adminToken?: string }): BotLink {
  const current = loadBotLink(dir);
  const serverUrl = patch.mode === "server" ? validateBotServerUrl(patch.serverUrl) : patch.serverUrl.trim();
  const adminToken = patch.adminToken && patch.adminToken.trim().length > 0 ? patch.adminToken.trim() : current.adminToken;
  if (patch.mode === "server" && adminToken.length < 16) throw new Error("The admin token needs at least 16 characters.");
  const next: BotLink = { mode: patch.mode, serverUrl, adminToken };
  writePrivateJson(botLinkFile(dir), next);
  return next;
}

export function botLinkView(link: BotLink): BotLinkView {
  return { mode: link.mode, serverUrl: link.serverUrl, tokenSet: link.adminToken.length >= 16 };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
