import fs from "node:fs";
import path from "node:path";
import { configDir } from "../../src/shared/paths.ts";
import { TOKEN_UPLOAD_WARNING, assertRemoteOrigin, tokenModeWarning } from "./token-upload.ts";

const args = process.argv.slice(2);
const dirFlag = args.indexOf("--dir");
const urlFlag = args.indexOf("--url");
const withTokens = args.includes("--with-tokens");
const withSe = args.includes("--with-se");
const dir = dirFlag >= 0 ? args[dirFlag + 1] : configDir();
const rawOrigin = urlFlag >= 0 ? args[urlFlag + 1] : "";
const token = process.env.RASCAL_BOT_API_KEY || process.env.EMBER_BOT_API_KEY || "";
if (!process.env.RASCAL_BOT_API_KEY && process.env.EMBER_BOT_API_KEY) {
  console.warn("EMBER_BOT_API_KEY is deprecated; set RASCAL_BOT_API_KEY instead.");
}

if (!rawOrigin || !token) {
  console.error("Usage: RASCAL_BOT_API_KEY=... node deploy/fly/push-config.mjs --url https://rascal.fly.dev [--dir <config dir>] [--with-tokens] [--with-se]");
  process.exit(1);
}

let origin;
try {
  origin = assertRemoteOrigin(rawOrigin);
} catch (err) {
  console.error(err instanceof Error ? err.message : "The upload URL is not valid.");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(path.join(dir, "bot.json"), "utf8"));
await post("/api/import/config", {
  channelLogin: config.channelLogin,
  broadcasterId: config.broadcasterId,
  commands: config.commands,
  timers: config.timers,
  filters: config.filters,
});
console.log("uploaded commands, timers, and filters");

if (withSe) {
  const secrets = JSON.parse(fs.readFileSync(path.join(dir, "bot-secrets.json"), "utf8"));
  if (typeof secrets.seJwt !== "string" || !secrets.seJwt) throw new Error("No StreamElements JWT in bot-secrets.json");
  await post("/api/import/streamelements", { jwt: secrets.seJwt });
  console.log("uploaded the StreamElements JWT");
}

if (withTokens) {
  console.warn(TOKEN_UPLOAD_WARNING);
  const tokenPath = path.join(dir, "bot-tokens.json");
  let mode = null;
  try {
    mode = fs.statSync(tokenPath).mode & 0o777;
  } catch {
    mode = null;
  }
  const modeWarning = tokenModeWarning(mode);
  if (modeWarning) console.warn(modeWarning);
  const tokens = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  await post("/api/import/tokens", tokens);
  console.log("uploaded the bot Twitch session");
}

async function post(pathname, body) {
  const response = await fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error(`${pathname} returned HTTP ${response.status}`);
    process.exit(1);
  }
}
