import { brand } from "../shared/brand";
import { redactError } from "../shared/redact";
import type { RedeemMapping, RedeemSnapshot } from "../shared/redeems";
import type { ChatOverlayFile } from "../shared/chat-overlay";
import type { TtsPanel } from "../shared/tts";
import { getChatOverlay } from "./stages/chat";
import { getRedeemEngine } from "./stages/redemptions";
import { startStages, stopStages } from "./stages";
import { RuntimeBot } from "./runtime-bot";

export class Runtime extends RuntimeBot {
  async start(): Promise<void> {
    const settings = this.settings.load();
    const port = await this.server.start(settings.overlayPort);
    this.status = {
      ...this.status,
      overlay: { listening: true, host: this.server.host, port },
    };
    await startStages(this.stageContext());
    this.registerEmoteRoute();
    void this.emotes.loadGlobals();
    void this.badges.loadGlobal();
    for (const platform of this.platforms.list()) platform.start();
    this.armViewerPoll();
    void this.refreshViewers();
    this.publishYoutubeSend();
    await this.auth.restore();
    if (this.auth.state().loggedIn) {
      try {
        await this.refreshStream(true);
      } catch (err) {
        this.log.error("initial stream info failed", { message: redactError(err) });
      }
      this.armStreamPoll();
    }
    this.log.info(`${brand.slug} started`, {
      version: this.version,
      overlayPort: port,
      clientIdSet: settings.twitchClientId.length > 0,
    });
  }


  async stop(): Promise<void> {
    this.disarmStreamPoll();
    this.disarmViewerPoll();
    this.disarmChatterPoll();
    for (const platform of this.platforms.list()) platform.stop();
    this.emotes.stop();
    this.badges.stop();
    await stopStages(this.stageContext());
    await this.server.stop();
  }


  refreshRedeems(): Promise<RedeemSnapshot> {
    return this.engine().refresh();
  }


  saveRedeem(mapping: RedeemMapping): Promise<RedeemSnapshot> {
    return this.engine().saveMapping(mapping);
  }


  createReward(title: string, cost: number): Promise<RedeemSnapshot> {
    return this.engine().createReward(title, cost);
  }


  updateReward(rewardId: string, patch: { title?: string; cost?: number; enabled?: boolean }): Promise<RedeemSnapshot> {
    return this.engine().updateTwitchReward(rewardId, patch);
  }


  importFirebot(): Promise<RedeemSnapshot> {
    return this.engine().importFirebot();
  }


  testRedeem(rewardId: string, draft?: RedeemMapping): Promise<void> {
    return this.engine().test(rewardId, draft);
  }


  skipAlert(): RedeemSnapshot {
    return this.engine().skip();
  }


  clearAlerts(): RedeemSnapshot {
    return this.engine().clearQueue();
  }


  saveChatPreset(preset: unknown): ChatOverlayFile {
    return this.chat().savePreset(preset);
  }


  createChatPreset(name: string, basedOnId: string): ChatOverlayFile {
    return this.chat().createPreset(name, basedOnId);
  }


  deleteChatPreset(id: string): ChatOverlayFile {
    return this.chat().deletePreset(id);
  }


  ttsPanel(): Promise<TtsPanel> {
    return this.chat().panel();
  }


  ttsCommand(command: string, id?: string): Promise<TtsPanel> {
    return this.chat().command(command, id);
  }


  ttsInject(payload: unknown): Promise<TtsPanel> {
    return this.chat().inject(payload);
  }


  saveTtsSettings(patch: unknown): Promise<TtsPanel> {
    const row = patch && typeof patch === "object" ? (patch as { baseUrl?: unknown; shortcuts?: unknown }) : {};
    this.chat().saveTts({
      baseUrl: typeof row.baseUrl === "string" ? row.baseUrl : undefined,
      shortcuts: typeof row.shortcuts === "boolean" ? row.shortcuts : undefined,
    });
    return this.chat().panel();
  }


  protected engine() {
    const engine = getRedeemEngine();
    if (!engine) throw new Error("Channel points are still starting.");
    return engine;
  }


  protected chat() {
    const engine = getChatOverlay();
    if (!engine) throw new Error("Chat overlay is still starting.");
    return engine;
  }

}
