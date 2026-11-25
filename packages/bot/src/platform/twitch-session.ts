import { EMPTY_FACTS, type HookSubject, type LoginPromptView, type PlatformAccountCard, type PlatformFacts } from "../../../../src/shared/platform/bot-platform.ts";
import type { PlatformLiveStatus } from "../../../../src/shared/platform/types.ts";
import { sleep } from "../../../../src/shared/sleep.ts";
import { accountAgeLine, followageLine } from "../duration.ts";
import { safeError } from "../errors.ts";
import { expandTemplate, type ShoutoutSettings } from "../model.ts";
import type { BotTokens } from "../store.ts";
import { age, HelixBot, pollDevice, startDevice, type DevicePrompt } from "../twitch.ts";

export interface TwitchSessionDeps {
  helix: HelixBot;
  clientId: () => string;
  fetchImpl: () => typeof fetch;
  session: () => BotTokens | null;
  botAccount: () => BotTokens | null;
  accountMode: () => "bot" | "channel";
  broadcasterId: () => string;
  channelLogin: () => string;
  statusOverride: () => string | null;
  setStatus: (status: string | null) => void;
  saveBotTokens: (tokens: BotTokens) => void;
  clearBotTokens: () => void;
  validate: (accessToken: string) => Promise<{ login: string; userId: string; scopes: string[] }>;
  shoutout: () => ShoutoutSettings;
  log: (level: "info" | "error", message: string, extra?: Record<string, string>) => void;
  pushLog: (entry: { t: number; action: string; user: string; text: string; by: string }) => void;
  productName: () => string;
  stopped: () => boolean;
  open: () => Promise<void>;
  disconnect: () => Promise<void>;
  setStreamLive: (live: boolean) => void;
  liveKnown: () => boolean;
}

/** Twitch login, stream facts, and the built-in lookups. The socket stays on the adapter. */
export class TwitchSession {
  private facts: PlatformFacts = { ...EMPTY_FACTS };
  private streamLiveAt = 0;
  private followCache = new Map<string, { at: number; text: string }>();
  private prompt: DevicePrompt | null = null;
  private loginAbort: AbortController | null = null;

  constructor(private readonly deps: TwitchSessionDeps) {}

  accountCard(live: PlatformLiveStatus): PlatformAccountCard {
    const tokens = this.deps.session();
    const separate = this.deps.botAccount();
    return {
      connected: Boolean(tokens && live.connected),
      status: this.deps.statusOverride() ?? live.detail,
      account: tokens?.login ?? null,
      accountMode: this.deps.accountMode(),
      separateAccount: separate?.login ?? null,
      quota: null,
    };
  }

  acceptsTimers(): boolean {
    return this.deps.session() !== null;
  }

  postingIdentity(): { userId: string; login: string } | null {
    const tokens = this.deps.session();
    return tokens ? { userId: tokens.userId, login: tokens.login } : null;
  }

  hookSubject(): HookSubject {
    const tokens = this.deps.session();
    return {
      channel: this.deps.channelLogin(),
      botUserId: tokens?.userId ?? "",
      botLogin: tokens?.login ?? "",
      channelLogin: this.deps.channelLogin(),
      broadcasterId: this.deps.broadcasterId(),
    };
  }

  currentFacts(): PlatformFacts {
    return this.facts;
  }

  loginPrompt(): LoginPromptView | null {
    const prompt = this.prompt;
    return prompt ? { userCode: prompt.userCode, verificationUri: prompt.verificationUri, expiresAt: prompt.expiresAt } : null;
  }

  async factsFor(userId: string): Promise<PlatformFacts> {
    await this.refreshStreamLive();
    if (!this.deps.session() || !this.deps.broadcasterId()) return { ...EMPTY_FACTS, followage: "" };
    let followage = "";
    if (userId) {
      const cached = this.followCache.get(userId);
      if (cached && Date.now() - cached.at < 10 * 60_000) followage = cached.text;
      else {
        try {
          followage = await this.deps.helix.followage(this.deps.broadcasterId(), userId);
          this.followCache.set(userId, { at: Date.now(), text: followage });
        } catch {
          followage = "unknown";
        }
      }
    }
    return { ...this.facts, followage };
  }

  async builtinLookup(kind: "followage" | "accountage" | "shoutout", login: string, speakerName: string): Promise<string> {
    try {
      const profile = await this.deps.helix.userByLogin(login);
      if (!profile) return `I couldn't find ${login}.`;
      const name = profile.name || profile.login;
      if (kind === "accountage") return accountAgeLine(name, profile.createdAt, Date.now());
      if (kind === "followage") {
        if (!this.deps.broadcasterId()) return "The channel id is not set.";
        const followed = await this.deps.helix.followedAt(this.deps.broadcasterId(), profile.id);
        return followageLine(name, followed, Date.now());
      }
      const channel = await this.deps.helix.channel(profile.id);
      const text = expandTemplate(this.deps.shoutout().template, {
        user: speakerName,
        touser: profile.login,
        count: "0",
        randomPool: "",
        facts: { ...this.facts, game: channel.game },
      });
      const scopes = this.deps.session()?.scopes ?? [];
      const moderatorId = this.deps.session()?.userId ?? "";
      if (this.deps.shoutout().helix && scopes.includes("moderator:manage:shoutouts") && this.deps.broadcasterId() && moderatorId) {
        try {
          await this.deps.helix.shoutout(this.deps.broadcasterId(), profile.id, moderatorId);
        } catch (err) {
          this.deps.pushLog({ t: Date.now(), action: "shoutout", user: profile.login, text: safeError(err), by: "bot" });
        }
      }
      return text;
    } catch (err) {
      this.deps.log("error", "lookup failed", { message: safeError(err) });
      return "I couldn't look that up.";
    }
  }

  async startLogin(): Promise<void> {
    if (this.loginAbort) return;
    const clientId = this.deps.clientId();
    if (!clientId) throw new Error(`Add the Twitch client ID in ${this.deps.productName()} settings first.`);
    this.prompt = await startDevice(clientId, this.deps.fetchImpl());
    this.deps.setStatus("Waiting for the bot account to approve the code.");
    const controller = new AbortController();
    this.loginAbort = controller;
    void this.finishLogin(clientId, controller);
  }

  cancelLogin(): void {
    this.loginAbort?.abort();
    this.loginAbort = null;
    this.prompt = null;
  }

  logout(): void {
    this.cancelLogin();
    this.deps.clearBotTokens();
    this.deps.setStatus("Bot logged out.");
    if (this.deps.accountMode() === "channel" && this.deps.session()) {
      this.deps.setStatus(null);
      if (!this.deps.stopped()) void this.deps.open();
    } else {
      void this.deps.disconnect();
    }
    this.deps.log("info", "bot logged out");
  }

  private async finishLogin(clientId: string, controller: AbortController): Promise<void> {
    const prompt = this.prompt;
    if (!prompt) return;
    try {
      const deadline = prompt.expiresAt;
      while (!controller.signal.aborted && Date.now() < deadline) {
        await sleep(prompt.interval * 1000);
        const result = await pollDevice(clientId, prompt.deviceCode, this.deps.fetchImpl());
        if (result === "pending") continue;
        if (result === "denied") throw new Error("The bot login was denied.");
        const identity = await this.deps.validate(result.accessToken);
        this.deps.saveBotTokens({
          clientId,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: Date.now() + result.expiresIn * 1000,
          scopes: identity.scopes,
          userId: identity.userId,
          login: identity.login,
        });
        this.prompt = null;
        this.deps.setStatus(`Logged in as ${identity.login}. Mod that account in your channel so it can timeout and delete.`);
        this.deps.log("info", "bot login succeeded", { login: identity.login });
        await this.deps.open();
        return;
      }
    } catch (err) {
      this.prompt = null;
      this.deps.setStatus(err instanceof Error ? err.message : "Bot login failed.");
      this.deps.log("error", "bot login failed", { message: safeError(err) });
    } finally {
      this.loginAbort = null;
    }
  }

  private async refreshStreamLive(): Promise<void> {
    if (!this.deps.session() || !this.deps.broadcasterId()) return;
    if (Date.now() - this.streamLiveAt < 30_000 && this.deps.liveKnown()) return;
    try {
      const channel = await this.deps.helix.channel(this.deps.broadcasterId());
      const live = Boolean(channel.startedAt);
      this.deps.setStreamLive(live);
      this.facts = { title: channel.title, game: channel.game, uptime: live ? age(channel.startedAt) : "offline", followage: this.facts.followage };
      this.streamLiveAt = Date.now();
    } catch (err) {
      this.deps.log("error", "stream status failed", { message: safeError(err) });
    }
  }
}
