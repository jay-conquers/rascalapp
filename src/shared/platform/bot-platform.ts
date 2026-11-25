import type { ChatPlatform, NormalizedChatMessage, PlatformLiveStatus } from "./types.ts";
import type { QuotaSnapshot } from "./youtube-quota.ts";

export interface PlatformAccountCard {
  connected: boolean;
  status: string;
  account: string | null;
  accountMode: "bot" | "channel";
  separateAccount: string | null;
  quota: QuotaSnapshot | null;
}

export interface PlatformFacts {
  title: string;
  game: string;
  uptime: string;
  followage: string;
}

/** Who a chat hook and an echo check should treat as this platform's account. */
export interface HookSubject {
  channel: string;
  botUserId: string;
  botLogin: string;
  channelLogin: string;
  broadcasterId: string;
}

export interface LoginPromptView {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}

/**
 * What the bot asks every chat site to do.
 * A new site implements this and registers it. Commands, timers, and the snapshot
 * walk the registry instead of naming Twitch or YouTube.
 */
export interface BotPlatform extends ChatPlatform {
  accountCard(): PlatformAccountCard;
  /** Twitch needs a posting token. YouTube needs a live broadcast. */
  acceptsTimers(): boolean;
  postingIdentity(): { userId: string; login: string } | null;
  factsFor(userId: string): Promise<PlatformFacts>;
  /** Last facts, without another network call. Thank-you lines use the Twitch copy. */
  currentFacts(): PlatformFacts;
  builtinLookup(kind: "followage" | "accountage" | "shoutout", login: string, speakerName: string): Promise<string>;
  hookSubject(): HookSubject;
  echoIds(): HookSubject;
  open(): Promise<void>;
  reconnect(): Promise<void>;
  loginPrompt(): LoginPromptView | null;
  startAccountLogin(): Promise<void>;
  cancelAccountLogin(): void;
  logoutAccount(): void;
  acceptLoginCallback?(input: { code: string; state: string; error: string }): boolean;
  ingest?(message: NormalizedChatMessage): void;
  noteReader?(ok: boolean): void;
  setLive?(input: { live: boolean; known?: boolean; title?: string; videoId?: string }): void;
  setOptIn?(enabled: boolean): void;
}

export const EMPTY_FACTS: PlatformFacts = { title: "", game: "", uptime: "offline", followage: "" };

export function liveFlag(status: PlatformLiveStatus): boolean | null {
  if (status.liveKnown === false) return null;
  return status.live;
}
