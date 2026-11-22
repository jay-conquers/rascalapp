import { BotService, type BotSnapshot } from "./service.ts";
import { startHttp } from "./http.ts";
import { BotStore } from "./store.ts";

export type { BotSnapshot, BotLoginPrompt } from "./service.ts";
export type { BotCommand, BotTimer, BotFilters, ModLogEntry } from "./model.ts";
export { decideChat, expandTemplate, levelAllows, dueTimers, portalBase, validateBotServerUrl } from "./model.ts";
export { importStreamElements, channelIdFromJwt } from "./se.ts";
export { parseChatFrame, chatSubscription } from "./twitch.ts";

export interface BotHandle {
  service: BotService;
  port: number;
  snapshot: () => BotSnapshot;
  close: () => Promise<void>;
}

export async function startBot(options: {
  dir: string;
  host?: string;
  port?: number;
  clientId: () => string;
  fetchImpl?: typeof fetch;
  log?: (level: "info" | "error", message: string, extra?: Record<string, string>) => void;
}): Promise<BotHandle> {
  const store = new BotStore(options.dir);
  const file = store.loadConfig();
  const host = options.host || file.bindHost || "127.0.0.1";
  const preferred = options.port || file.portalPort;
  const service = new BotService(store, {
    clientId: options.clientId,
    fetchImpl: options.fetchImpl,
    log: options.log ?? (() => {}),
  });
  let httpServer: Awaited<ReturnType<typeof startHttp>> | null = null;
  let lastError: unknown;
  for (let offset = 0; offset < 10; offset += 1) {
    try {
      httpServer = await startHttp(service, { host, port: preferred + offset, clientId: options.clientId, fetchImpl: options.fetchImpl });
      break;
    } catch (err) {
      lastError = err;
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }
  if (!httpServer) throw lastError instanceof Error ? lastError : new Error("Could not bind the bot portal.");
  if (store.loadTokens()) await service.connect();
  return {
    service,
    port: httpServer.port,
    snapshot: () => service.snapshot(httpServer.port),
    close: () => httpServer.close(),
  };
}
