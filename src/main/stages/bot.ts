import path from "node:path";
import { brand } from "../../shared/brand";
import { startBot, type BotHandle } from "../../../packages/bot/src/index.ts";
import { loadBotLink } from "../bot-link";
import { youtubeDesk } from "../youtube/desk";
import type { AppContext, StageModule } from "./types";

let handle: BotHandle | null = null;
let ctxRef: AppContext | null = null;

export function getBot(): BotHandle | null {
  return handle;
}

export async function startEmbeddedBot(ctx: AppContext): Promise<void> {
  if (handle) return;
  const settings = ctx.settings.load();
  const dir = path.dirname(ctx.settings.file);
  const desk = youtubeDesk(dir);
  handle = await startBot({
    dir,
    clientId: () => ctx.settings.load().twitchClientId,
    bridge: {
      loadTwitch: () => {
        const tokens = ctx.tokens.current;
        return tokens ? { ...tokens } : null;
      },
      saveTwitch: (tokens) => ctx.tokens.save(tokens),
      loadYoutube: () => desk.current(),
      saveYoutube: (tokens) => desk.replace(tokens),
    },
    log: (level, message, extra) => {
      if (level === "error") ctx.log.error(message, extra);
      else ctx.log.info(message, extra);
    },
    onAccountsChanged: () => ctx.youtubeAuthChanged?.(),
    youtubeReader: "external",
  });
  handle.service.setIdentity({
    channelLogin: settings.twitchChannel,
    broadcasterId: ctx.auth.state().userId ?? "",
    youtubeChannelId: settings.youtubeChannelId,
  });
}

export async function stopEmbeddedBot(): Promise<void> {
  await handle?.close();
  handle = null;
}

export const botStage: StageModule = {
  id: "bot",
  async start(ctx: AppContext) {
    ctxRef = ctx;
    const link = loadBotLink(path.dirname(ctx.settings.file));
    ctx.auth.addListener(() => {
      if (!handle) return;
      const state = ctx.auth.state();
      const userId = state.userId ?? "";
      const configured = ctx.settings.load().twitchChannel;
      const channelLogin = configured || (state.loggedIn ? state.login ?? "" : "");
      const snap = handle.snapshot();
      const patch: { broadcasterId?: string; channelLogin?: string } = {};
      if (userId && userId !== snap.broadcasterId) patch.broadcasterId = userId;
      if (!configured && channelLogin && channelLogin !== snap.channelLogin) patch.channelLogin = channelLogin;
      if (patch.broadcasterId || patch.channelLogin) handle.service.setIdentity(patch);
    });
    if (link.mode === "server") {
      ctx.log.info("bot is server-connected", { url: link.serverUrl });
      return;
    }
    await startEmbeddedBot(ctx);
  },
  async stop() {
    await stopEmbeddedBot();
    ctxRef = null;
  },
};

export async function useEmbeddedBot(): Promise<void> {
  if (!ctxRef) throw new Error(`${brand.displayName} is still starting.`);
  await startEmbeddedBot(ctxRef);
}
