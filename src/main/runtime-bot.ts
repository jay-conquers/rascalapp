import path from "node:path";
import { sendTargetsForSelection } from "../shared/platform/selection";
import { redactError } from "../shared/redact";
import type { SettingsPatch } from "../shared/api";
import type { AuthState, Settings } from "../shared/types";
import { getRedeemEngine } from "./stages/redemptions";
import type { BotSnapshot } from "../../packages/bot/src/index.ts";
import { botLinkView, loadBotLink, saveBotLink, type BotLinkView } from "./bot-link";
import { RemoteBot } from "./bot-remote";
import { getBot, stopEmbeddedBot, useEmbeddedBot } from "./stages/bot";
import type { YoutubeDeskState } from "./youtube/desk";
import { RuntimeChat } from "./runtime-chat";

export class RuntimeBot extends RuntimeChat {
  async updateSettings(patch: SettingsPatch): Promise<Settings> {
    const prev = this.settings.load();
    const next = this.settings.update(patch);
    if (next.twitchClientId !== prev.twitchClientId) {
      this.auth.logout();
      this.forgetStream();
    }
    if (next.twitchChannel !== prev.twitchChannel) {
      this.session.clear("twitch");
      this.listedTwitch = [];
      this.broadcasterCache = null;
      this.applyTwitchChannel();
      if (this.chatterTimer) void this.refreshChatters();
      if (loadBotLink(path.dirname(this.settings.file)).mode === "embedded") {
        const login = this.auth.state().loggedIn ? this.auth.state().login ?? "" : "";
        getBot()?.service.setIdentity({ channelLogin: next.twitchChannel || login });
      }
    }
    if (next.youtubeChannelId !== prev.youtubeChannelId) {
      this.session.clear("youtube");
      this.youtube.setChannel(next.youtubeChannelId);
      if (loadBotLink(path.dirname(this.settings.file)).mode === "embedded") {
        getBot()?.service.setIdentity({ youtubeChannelId: next.youtubeChannelId });
      }
    }
    if (next.overlayPort !== prev.overlayPort) {
      const port = await this.server.start(next.overlayPort);
      this.status = { ...this.status, overlay: { listening: true, host: this.server.host, port } };
      this.emit({ type: "status", status: this.status });
      const redeems = getRedeemEngine()?.snapshot();
      if (redeems) this.emit({ type: "redeems", redeems });
    }
    if (next.alwaysOnTop !== prev.alwaysOnTop) this.hooks.alwaysOnTop?.(next.alwaysOnTop);
    this.emotes.setFlags(next.feed.emotes);
    if (!next.feed.modLog && prev.feed.modLog) {
      this.modLog.splice(0, this.modLog.length);
      this.emit({ type: "mod-log-clear" });
    }
    if (next.twitchChannel !== prev.twitchChannel && this.twitchOn()) this.notices.retarget();
    const platformsChanged =
      prev.platforms.confirmed !== next.platforms.confirmed ||
      prev.platforms.enabled.length !== next.platforms.enabled.length ||
      prev.platforms.enabled.some((id, index) => id !== next.platforms.enabled[index]);
    if (platformsChanged) {
      const sendTargets = sendTargetsForSelection(next.platforms, next.sendTargets);
      if (sendTargets.twitch !== next.sendTargets.twitch || sendTargets.youtube !== next.sendTargets.youtube) {
        this.settings.update({ sendTargets });
      }
      this.syncEnabledPlatforms(prev.platforms);
      await this.syncBotPlatforms();
    }
    this.emit({ type: "auth", auth: this.auth.state() });
    return this.settings.load();
  }


  async startLogin(): Promise<AuthState> {
    await this.auth.login();
    try {
      await this.refreshStream(true);
    } catch (err) {
      this.log.error("stream info after login failed", { message: redactError(err) });
    }
    this.armStreamPoll();
    return this.auth.state();
  }


  cancelLogin(): void {
    this.auth.cancel();
  }

  /** Saved channel wins. Otherwise follow the signed-in login, or nobody. */

  protected applyTwitchChannel(): void {
    const configured = this.settings.load().twitchChannel;
    const login = this.auth.state().loggedIn ? this.auth.state().login ?? "" : "";
    const channel = configured || login;
    if (!this.twitchOn()) {
      this.irc.setChannel(channel, { connect: false });
      this.irc.stop();
      this.notices.stop();
      return;
    }
    this.irc.setChannel(channel);
    this.notices.retarget();
    void this.refreshViewers();
  }


  logout(): AuthState {
    this.auth.logout();
    this.forgetStream();
    return this.auth.state();
  }


  setAlwaysOnTop(value: boolean): void {
    this.settings.update({ alwaysOnTop: value });
    this.hooks.alwaysOnTop?.(value);
  }


  botLink(): BotLinkView {
    return botLinkView(loadBotLink(path.dirname(this.settings.file)));
  }


  async saveBotLink(patch: unknown): Promise<BotLinkView> {
    const row = patch && typeof patch === "object" ? (patch as { mode?: unknown; serverUrl?: unknown; adminToken?: unknown }) : {};
    const mode = row.mode === "server" ? "server" : "embedded";
    const saved = saveBotLink(path.dirname(this.settings.file), {
      mode,
      serverUrl: typeof row.serverUrl === "string" ? row.serverUrl : "",
      adminToken: typeof row.adminToken === "string" ? row.adminToken : undefined,
    });
    if (saved.mode === "server") await stopEmbeddedBot();
    else await useEmbeddedBot();
    await this.syncBotPlatforms();
    return botLinkView(saved);
  }


  youtubeDeskState(): YoutubeDeskState {
    return this.youtubeSend.state();
  }


  async youtubeConnect(): Promise<YoutubeDeskState> {
    await this.youtubeSend.connectDesk();
    this.publishYoutubeSend();
    return this.youtubeSend.state();
  }


  youtubeCancel(): YoutubeDeskState {
    this.youtubeSend.cancel();
    this.publishYoutubeSend();
    return this.youtubeSend.state();
  }


  youtubeLogout(): YoutubeDeskState {
    this.youtubeSend.logout();
    this.publishYoutubeSend();
    return this.youtubeSend.state();
  }


  botState(): Promise<BotSnapshot> {
    return this.botOps().state();
  }


  botLogin(): Promise<BotSnapshot> {
    return this.botOps().login();
  }


  botLogout(): Promise<BotSnapshot> {
    return this.botOps().logout();
  }


  botSaveCommand(input: unknown): Promise<BotSnapshot> {
    return this.botOps().saveCommand(input);
  }


  botDeleteCommand(id: string): Promise<BotSnapshot> {
    return this.botOps().deleteCommand(id);
  }


  botSaveTimer(input: unknown): Promise<BotSnapshot> {
    return this.botOps().saveTimer(input);
  }


  botDeleteTimer(id: string): Promise<BotSnapshot> {
    return this.botOps().deleteTimer(id);
  }


  botSaveFilters(input: unknown): Promise<BotSnapshot> {
    return this.botOps().saveFilters(input);
  }


  botSaveExtras(input: unknown): Promise<BotSnapshot> {
    return this.botOps().saveExtras(input);
  }


  botSaveHook(input: unknown): Promise<BotSnapshot> {
    return this.botOps().saveHook(input);
  }


  botDeleteHook(id: string): Promise<BotSnapshot> {
    return this.botOps().deleteHook(id);
  }


  botTestHook(id: string): Promise<{ ok: boolean; status: number; ms: number; detail: string }> {
    return this.botOps().testHook(id);
  }


  botImportSe(jwt = ""): Promise<BotSnapshot> {
    return this.botOps().importSe(jwt);
  }


  botImportJson(payload: unknown): Promise<BotSnapshot> {
    return this.botOps().importJson(payload);
  }


  botExport(): Promise<unknown> {
    return this.botOps().exportConfig();
  }


  botYoutubeLogin(): Promise<BotSnapshot> {
    return this.botOps().youtubeLogin();
  }


  botYoutubeLogout(): Promise<BotSnapshot> {
    return this.botOps().youtubeLogout();
  }


  botYoutubeCancel(): Promise<BotSnapshot> {
    return this.botOps().youtubeCancel();
  }


  botSaveAccounts(patch: unknown): Promise<BotSnapshot> {
    return this.botOps().saveAccounts(patch);
  }


  botSaveGoogleClient(patch: unknown): Promise<BotSnapshot> {
    return this.botOps().saveGoogleClient(patch);
  }


  protected botOps() {
    const link = loadBotLink(path.dirname(this.settings.file));
    if (link.mode === "server") {
      const remote = new RemoteBot(link.serverUrl, link.adminToken);
      return {
        state: () => remote.state(),
        login: () => remote.login(),
        logout: () => remote.logout(),
        saveCommand: (input: unknown) => remote.saveCommand(input),
        deleteCommand: (id: string) => remote.deleteCommand(id),
        saveTimer: (input: unknown) => remote.saveTimer(input),
        deleteTimer: (id: string) => remote.deleteTimer(id),
        saveFilters: (input: unknown) => remote.saveFilters(input),
        saveExtras: (input: unknown) => remote.saveExtras(input),
        saveHook: (input: unknown) => remote.saveHook(input),
        deleteHook: (id: string) => remote.deleteHook(id),
        testHook: (id: string) => remote.testHook(id),
        importSe: (jwt: string) => remote.importSe(jwt),
        importJson: (payload: unknown) => remote.importJson(payload),
        exportConfig: () => remote.exportConfig(),
        youtubeLogin: () => this.youtubeSend.loginForBot().then((tokens) => remote.importYoutubeTokens(tokens)),
        youtubeLogout: () => remote.youtubeLogout(),
        youtubeCancel: () => remote.youtubeCancel(),
        saveAccounts: (patch: unknown) => remote.saveAccounts(patch),
        saveGoogleClient: (patch: unknown) => remote.saveGoogleClient(patch),
      };
    }
    const bot = getBot();
    if (!bot) throw new Error("The local bot is not running. Switch back to embedded mode.");
    const snap = () => bot.snapshot();
    return {
      state: async () => snap(),
      login: async () => {
        await bot.service.startLogin();
        return snap();
      },
      logout: async () => {
        bot.service.logout();
        return snap();
      },
      saveCommand: async (input: unknown) => {
        bot.service.saveCommand(input);
        return snap();
      },
      deleteCommand: async (id: string) => {
        bot.service.deleteCommand(id);
        return snap();
      },
      saveTimer: async (input: unknown) => {
        bot.service.saveTimer(input);
        return snap();
      },
      deleteTimer: async (id: string) => {
        bot.service.deleteTimer(id);
        return snap();
      },
      saveFilters: async (input: unknown) => {
        bot.service.saveFilters(input);
        return snap();
      },
      saveExtras: async (input: unknown) => {
        bot.service.saveExtras(input);
        return snap();
      },
      saveHook: async (input: unknown) => {
        bot.service.saveHook(input);
        return snap();
      },
      deleteHook: async (id: string) => {
        bot.service.deleteHook(id);
        return snap();
      },
      testHook: async (id: string) => bot.service.testHook(id),
      importSe: async (jwt: string) => {
        await bot.service.importSe(jwt);
        return snap();
      },
      importJson: async (payload: unknown) => {
        bot.service.importJson(payload);
        return snap();
      },
      exportConfig: async () => bot.service.exportConfig(),
      youtubeLogin: async () => {
        await bot.service.startYoutubeLogin();
        return snap();
      },
      youtubeLogout: async () => {
        bot.service.logoutYoutube();
        return snap();
      },
      youtubeCancel: async () => {
        bot.service.cancelYoutubeLogin();
        return snap();
      },
      saveAccounts: async (patch: unknown) => {
        const row = patch && typeof patch === "object" ? (patch as { twitch?: unknown; youtube?: unknown }) : {};
        bot.service.setAccounts(row);
        return snap();
      },
      saveGoogleClient: async (patch: unknown) => {
        bot.service.saveGoogleClient(patch);
        return snap();
      },
    };
  }


  protected publishYoutubeSend(): void {
    const desk = this.youtubeSend.state();
    const ready = this.youtubeSend.sendReadiness();
    const off = !this.youtubeOn();
    this.status = {
      ...this.status,
      youtube: {
        ...this.status.youtube,
        ...(off ? { state: "idle" as const, detail: "YouTube is off.", viewers: null } : {}),
        canSend: ready.canSend,
        sendAccount: desk.account,
        sendHint: ready.hint,
        accountChannelId: desk.channelId,
      },
    };
    this.emit({ type: "status", status: this.status });
  }

  /** Tell the embedded bot, or the server the desk is linked to, which platforms may connect. */
  protected async syncBotPlatforms(): Promise<void> {
    const enabled = this.settings.load().platforms.enabled;
    const link = loadBotLink(path.dirname(this.settings.file));
    if (link.mode === "server") {
      if (!link.serverUrl || link.adminToken.length < 16) return;
      try {
        await new RemoteBot(link.serverUrl, link.adminToken).setEnabledPlatforms(enabled);
      } catch (err) {
        this.log.error("could not update server bot platforms", { message: redactError(err) });
      }
      return;
    }
    const bot = getBot();
    if (!bot) return;
    await bot.service.setEnabledPlatforms(enabled);
  }

}
