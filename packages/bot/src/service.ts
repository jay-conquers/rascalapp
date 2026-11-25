import { readBrandEnv } from "../../../src/shared/brand.ts";
import { EMPTY_FACTS, liveFlag, type BotPlatform } from "../../../src/shared/platform/bot-platform.ts";
import { targetsPlatform } from "../../../src/shared/platform/target.ts";
import type { NormalizedChatMessage } from "../../../src/shared/platform/types.ts";
import type { QuotaSnapshot } from "../../../src/shared/platform/youtube-quota.ts";
import type { PlatformCapabilities } from "../../../src/shared/platform/types.ts";
import {
  activePhase,
  advanceTimer,
  expandTemplate,
  portalBase,
  timerIsDue,
  timerMessage,
  type BotAccountMode,
  type BotCommand,
  type BotFile,
  type BotFilters,
  type BotTimer,
  type ModLogEntry,
  type TimerPhase,
} from "./model.ts";
import { safeError } from "./errors.ts";
import type { BotTokens, YoutubeBotTokens } from "./store.ts";
import { youtubePublicRedirect } from "./public-url.ts";
import { BotChat } from "./bot-chat.ts";

export interface BotLoginPrompt {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}

export interface PlatformSection {
  id: string;
  label: string;
  connected: boolean;
  status: string;
  account: string | null;
  accountMode: BotAccountMode;
  separateAccount: string | null;
  capabilities: PlatformCapabilities;
  quota: QuotaSnapshot | null;
}

export interface BotSnapshot {
  connected: boolean;
  status: string;
  botLogin: string | null;
  channelLogin: string;
  broadcasterId: string;
  portalUrl: string;
  redirectUri: string;
  login: BotLoginPrompt | null;
  commands: BotCommand[];
  timers: BotTimer[];
  filters: BotFilters;
  quotes: BotFile["quotes"];
  thanks: BotFile["thanks"];
  shoutout: BotFile["shoutout"];
  hooks: BotFile["hooks"];
  log: ModLogEntry[];
  seJwtSet: boolean;
  platforms: PlatformSection[];
  youtubeLogin: BotLoginPrompt | null;
  youtubeRedirectUri: string;
  googleClientId: string;
  googleClientSecretSet: boolean;
  googleClientFromEnv: boolean;
  youtubeApiPoll: boolean;
}

export interface ChannelTokenBridge {
  loadTwitch(): BotTokens | null;
  saveTwitch(tokens: BotTokens): void;
  loadYoutube(): YoutubeBotTokens | null;
  saveYoutube(tokens: YoutubeBotTokens): void;
}

export class BotService extends BotChat {
  snapshot(portalPort: number): BotSnapshot {
    const base = portalBase(this.file.publicUrl, portalPort);
    const client = this.google();
    const twitch = this.registry.get("twitch");
    const youtube = this.registry.get("youtube");
    const active = twitch?.postingIdentity() ?? null;
    const twitchLive = twitch?.liveStatus();
    return {
      connected: Boolean(active && twitchLive?.connected),
      status: this.statusOverride ?? twitchLive?.detail ?? "Bot is idle.",
      botLogin: active?.login ?? null,
      channelLogin: this.file.channelLogin,
      broadcasterId: this.file.broadcasterId,
      portalUrl: `${base}/portal`,
      redirectUri: `${base}/portal/callback`,
      login: twitch?.loginPrompt() ?? null,
      commands: this.file.commands,
      timers: this.file.timers,
      filters: this.file.filters,
      quotes: this.file.quotes,
      thanks: this.file.thanks,
      shoutout: this.file.shoutout,
      hooks: this.file.hooks.map((hook) => ({ ...hook, secret: "", secretSet: hook.secret.length > 0 })),
      log: this.log.slice(-80),
      seJwtSet: this.secrets.seJwt.length > 0,
      platforms: this.platformSections(),
      youtubeLogin: youtube?.loginPrompt() ?? null,
      youtubeRedirectUri: this.youtubeRedirect(),
      googleClientId: client.clientId,
      googleClientSecretSet: client.clientSecret.length > 0,
      googleClientFromEnv: Boolean(readBrandEnv("GOOGLE_CLIENT_ID")),
      youtubeApiPoll: this.file.youtubeApiPoll,
    };
  }

  /** Names and ids Rascal posts as, so a message chime can ignore them. */

  alertPosters(): { selfNames: string[]; selfIds: string[]; botNames: string[]; botIds: string[] } {
    const selfNames: string[] = [];
    const selfIds: string[] = [];
    const botNames: string[] = [];
    const botIds: string[] = [];
    if (this.file.channelLogin) selfNames.push(this.file.channelLogin);
    if (this.file.broadcasterId) selfIds.push(this.file.broadcasterId);
    if (this.file.youtubeChannelId) selfIds.push(this.file.youtubeChannelId);
    const posting = this.activeTwitch();
    if (this.file.accounts.twitch === "bot" && posting) {
      botNames.push(posting.login);
      botIds.push(posting.userId);
    } else if (this.tokens) {
      botNames.push(this.tokens.login);
      botIds.push(this.tokens.userId);
    }
    const youtube = this.file.accounts.youtube === "bot" ? this.youtubeSession() : this.youtubeTokens;
    if (youtube) {
      if (youtube.title) botNames.push(youtube.title);
      botIds.push(youtube.channelId);
    }
    return { selfNames, selfIds, botNames, botIds };
  }


  setIdentity(patch: { channelLogin?: string; broadcasterId?: string; publicUrl?: string; youtubeChannelId?: string }): void {
    const previousChannel = this.file.youtubeChannelId;
    if (typeof patch.channelLogin === "string") this.file.channelLogin = patch.channelLogin.trim().replace(/^#/, "").toLowerCase();
    if (typeof patch.broadcasterId === "string" && /^\d*$/.test(patch.broadcasterId)) this.file.broadcasterId = patch.broadcasterId;
    if (typeof patch.publicUrl === "string") this.file.publicUrl = patch.publicUrl.trim().replace(/\/$/, "").slice(0, 200);
    if (typeof patch.youtubeChannelId === "string") {
      const value = patch.youtubeChannelId.trim();
      this.file.youtubeChannelId = /^UC[\w-]{22}$/.test(value) || value === "" ? value : this.file.youtubeChannelId;
    }
    this.file = this.store.saveConfig(this.file);
    if (this.registry.get("twitch")?.postingIdentity()) void this.connect();
    if (previousChannel !== this.file.youtubeChannelId) void this.registry.get("youtube")?.reconnect();
  }


  setAccounts(patch: { twitch?: unknown; youtube?: unknown; youtubeApiPoll?: unknown }): void {
    const twitch = patch.twitch === "channel" ? "channel" : patch.twitch === "bot" ? "bot" : this.file.accounts.twitch;
    const youtube = patch.youtube === "channel" ? "channel" : patch.youtube === "bot" ? "bot" : this.file.accounts.youtube;
    const youtubeApiPoll = typeof patch.youtubeApiPoll === "boolean" ? patch.youtubeApiPoll : this.file.youtubeApiPoll;
    this.file = this.store.saveConfig({ ...this.file, accounts: { twitch, youtube }, youtubeApiPoll });
    for (const platform of this.registry.list()) platform.setOptIn?.(youtubeApiPoll);
    this.statusOverride = null;
    if (patch.twitch !== undefined) void this.connect();
    if (patch.youtube !== undefined) void this.registry.get("youtube")?.reconnect();
  }


  ingestYoutube(message: NormalizedChatMessage): void {
    this.registry.get("youtube")?.ingest?.(message);
  }


  noteYoutubeReader(ok: boolean): void {
    this.registry.get("youtube")?.noteReader?.(ok);
  }


  setYoutubeLive(input: { live: boolean; known?: boolean; title?: string; videoId?: string }): void {
    this.registry.get("youtube")?.setLive?.(input);
  }


  async startLogin(): Promise<void> {
    await this.registry.get("twitch")?.startAccountLogin();
  }


  cancelLogin(): void {
    this.registry.get("twitch")?.cancelAccountLogin();
  }


  logout(): void {
    this.registry.get("twitch")?.logoutAccount();
  }


  youtubeRedirect(): string {
    return youtubePublicRedirect(this.file.publicUrl);
  }

  /** The public HTTPS callback lands here. Loopback logins do not. */

  acceptYoutubeCallback(input: { code: string; state: string; error: string }): boolean {
    return this.registry.get("youtube")?.acceptLoginCallback?.(input) ?? false;
  }


  async startYoutubeLogin(): Promise<void> {
    await this.registry.get("youtube")?.startAccountLogin();
  }


  cancelYoutubeLogin(): void {
    this.registry.get("youtube")?.cancelAccountLogin();
  }


  logoutYoutube(): void {
    this.registry.get("youtube")?.logoutAccount();
  }


  async tick(): Promise<void> {
    if (this.stopped) return;
    const now = Date.now();
    const facts = (await this.registry.get("twitch")?.factsFor("")) ?? { ...EMPTY_FACTS };
    let changed = false;
    const timers = [...this.file.timers];
    for (let index = 0; index < timers.length; index += 1) {
      let timer = timers[index];
      if (!timer) continue;
      const buckets = new Map<TimerPhase, BotPlatform[]>();
      for (const platform of this.registry.list()) {
        if (!targetsPlatform(timer.platforms, platform.id)) continue;
        if (!platform.acceptsTimers()) continue;
        const live = liveFlag(platform.liveStatus());
        const phase = activePhase(timer, live);
        if (!phase || !timerIsDue(timer, now, phase)) continue;
        const list = buckets.get(phase) ?? [];
        list.push(platform);
        buckets.set(phase, list);
      }
      for (const phase of ["live", "offline"] as const) {
        const targets = buckets.get(phase);
        if (!targets || targets.length === 0) continue;
        const text = expandTemplate(timerMessage(timer), { user: "chat", touser: "", count: "0", randomPool: "", facts });
        if (!text.trim()) continue;
        for (const platform of targets) {
          try {
            await this.say(platform, text);
          } catch (err) {
            this.pushLog({ t: now, action: "error", user: "", text: safeError(err), by: platform.id });
          }
        }
        timer = advanceTimer(timer, now, phase);
        changed = true;
        this.pushLog({ t: now, action: "timer", user: "", text: `${timer.name} (${phase})`, by: "bot" });
      }
      timers[index] = timer;
    }
    if (!changed) return;
    this.file = this.store.saveConfig({ ...this.file, timers });
  }


  stop(): void {
    this.stopped = true;
    if (this.giftTimer) clearTimeout(this.giftTimer);
    this.giftTimer = null;
    for (const platform of this.registry.list()) {
      platform.cancelAccountLogin();
      void platform.disconnect();
    }
  }

  /** Opens every registered platform. Twitch no-ops until it has a posting account. */

  async openPlatforms(): Promise<void> {
    if (this.stopped) return;
    for (const platform of this.registry.list()) await platform.open();
  }


  async connect(): Promise<void> {
    await this.registry.get("twitch")?.open();
  }


  async connectYoutube(): Promise<void> {
    await this.registry.get("youtube")?.open();
  }



  protected platformSections(): PlatformSection[] {
    return this.registry.list().map((platform) => ({
      id: platform.id,
      label: platform.label,
      ...platform.accountCard(),
      capabilities: platform.capabilities,
    }));
  }

  /**
   * A built-in command copies the sender's id into the decision, then names the real target.
   * When those two people differ, the named login is the one to act on.
   */
}
