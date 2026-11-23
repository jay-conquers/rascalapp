import { brand, readBrandEnv } from "../../../src/shared/brand.ts";
import { configDir } from "../../../src/shared/paths.ts";
import { startBot } from "./index.ts";

async function main(): Promise<void> {
  const dir = readBrandEnv("BOT_DIR") || configDir();
  const host = readBrandEnv("BOT_BIND") === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  const port = Number(readBrandEnv("BOT_PORT") || brand.portalPort);
  const bot = await startBot({
    dir,
    host,
    port,
    clientId: () => readBrandEnv("BOT_CLIENT_ID") || process.env.TWITCH_CLIENT_ID || "",
    log: (level, message) => {
      console.log(`${new Date().toISOString()} ${level} ${message}`);
    },
  });
  bot.service.setIdentity({
    channelLogin: readBrandEnv("BOT_CHANNEL") || undefined,
    broadcasterId: readBrandEnv("BOT_BROADCASTER_ID") || undefined,
    publicUrl: readBrandEnv("BOT_PUBLIC_URL") || undefined,
  });
  console.log(`${brand.slug} bot portal ${bot.snapshot().portalUrl}`);
}

void main();
