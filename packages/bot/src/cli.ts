import { brand, readBrandEnv } from "../../../src/shared/brand.ts";
import { configDir } from "../../../src/shared/paths.ts";
import { startBot } from "./index.ts";
import { parsePublicBaseUrl, readConfiguredPublicBase } from "./public-url.ts";

async function main(): Promise<void> {
  const dir = readBrandEnv("BOT_DIR") || configDir();
  const host = readBrandEnv("BOT_BIND") === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  const explicitPort = readBrandEnv("BOT_PORT");
  const rawPublic = process.env.PUBLIC_BASE_URL || readBrandEnv("PUBLIC_BASE_URL") || readBrandEnv("BOT_PUBLIC_URL") || "";
  const publicUrl = readConfiguredPublicBase();
  if (rawPublic.trim() && !parsePublicBaseUrl(rawPublic)) {
    console.log("The public URL was ignored. Use https://bot.example.com or http://localhost.");
  }
  const port = Number(explicitPort || brand.portalPort);
  const bot = await startBot({
    dir,
    host,
    port,
    strictPort: Boolean(explicitPort || publicUrl),
    clientId: () => readBrandEnv("BOT_CLIENT_ID") || process.env.TWITCH_CLIENT_ID || "",
    log: (level, message) => {
      console.log(`${new Date().toISOString()} ${level} ${message}`);
    },
  });
  bot.service.setIdentity({
    channelLogin: readBrandEnv("BOT_CHANNEL") || undefined,
    broadcasterId: readBrandEnv("BOT_BROADCASTER_ID") || undefined,
    youtubeChannelId: readBrandEnv("BOT_YOUTUBE_CHANNEL") || undefined,
    publicUrl: publicUrl || undefined,
  });
  const snap = bot.snapshot();
  console.log(`${brand.slug} bot portal ${snap.portalUrl}`);
  console.log(`Twitch redirect ${snap.redirectUri}`);
  console.log(`YouTube redirect ${snap.youtubeRedirectUri}`);
}

void main();
