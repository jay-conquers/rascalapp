import type { ChatBadge, WithoutSeq, AppEvent } from "../../shared/types";
import type { ChatBus } from "../chat-bus";
import type { Logger } from "../logger";
import type { OverlayServer } from "../server";
import type { SettingsStore } from "../settings";
import type { TokenStore } from "../tokens";
import type { TwitchAuth } from "../twitch/oauth";
import type { Helix } from "../twitch/helix";

/**
 * Context handed to later stages. Stage 1 constructs it and then loads
 * whatever modules are listed in stages/index.ts.
 */
export interface AppContext {
  log: Logger;
  settings: SettingsStore;
  tokens: TokenStore;
  chat: ChatBus;
  server: OverlayServer;
  helix: Helix;
  auth: TwitchAuth;
  emit: (event: WithoutSeq<AppEvent>) => void;
  version: string;
  badgeImage: (badge: ChatBadge) => string | null;
  /** Lets the bot tell the desk that a YouTube account changed. */
  youtubeAuthChanged?: () => void;
}

export interface StageModule {
  id: string;
  start(ctx: AppContext): Promise<void> | void;
  stop?(ctx: AppContext): Promise<void> | void;
}
