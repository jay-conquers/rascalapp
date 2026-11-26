import fs from "node:fs";
import path from "node:path";
import { readBrandEnv } from "../../shared/brand";
import { parseKickClient, parseKickRelay, parseKickTokens, type KickClientFile, type KickRelayFile, type KickTokens } from "../../shared/kick/account";
import { readJson, writePrivateJson } from "../private-file";

function files(dir: string): { client: string; tokens: string; relay: string } {
  return {
    client: path.join(dir, "kick-client.json"),
    tokens: path.join(dir, "kick-tokens.json"),
    relay: path.join(dir, "kick-relay.json"),
  };
}

export function loadKickClient(dir: string): KickClientFile {
  const fromFile = parseKickClient(readJson(files(dir).client));
  return {
    clientId: readBrandEnv("KICK_CLIENT_ID")?.trim() || fromFile.clientId,
    clientSecret: readBrandEnv("KICK_CLIENT_SECRET") ?? fromFile.clientSecret,
  };
}

export function saveKickClient(dir: string, client: KickClientFile): void {
  const previous = loadKickClient(dir);
  const clientId = client.clientId.trim();
  if (clientId && !/^[A-Za-z0-9_-]{8,80}$/.test(clientId)) throw new Error("That client ID does not look like a Kick client ID.");
  writePrivateJson(files(dir).client, {
    clientId: clientId || previous.clientId,
    clientSecret: client.clientSecret || previous.clientSecret,
  });
}

export function loadKickTokens(dir: string): KickTokens | null {
  return parseKickTokens(readJson(files(dir).tokens));
}

export function saveKickTokens(dir: string, tokens: KickTokens): void {
  writePrivateJson(files(dir).tokens, tokens);
}

export function clearKickTokens(dir: string): void {
  try {
    fs.rmSync(files(dir).tokens);
  } catch {
    // Already gone.
  }
}

export function loadKickRelay(dir: string): KickRelayFile {
  const fromFile = parseKickRelay(readJson(files(dir).relay));
  return { secret: readBrandEnv("KICK_RELAY_SECRET") ?? fromFile.secret };
}

export function saveKickRelay(dir: string, secret: string): void {
  const previous = loadKickRelay(dir);
  const next = secret.trim();
  if (next && next.length < 16) throw new Error("The relay secret should be at least 16 characters.");
  writePrivateJson(files(dir).relay, { secret: next || previous.secret });
}
