import type { ChatOverlayFile, ChatOverlayStyle } from "./chat-overlay";
import type { RedeemMapping, RedeemSnapshot } from "./redeems";
export type { BotSnapshot } from "../../packages/bot/src/index";
import type { BotSnapshot } from "../../packages/bot/src/index";
import type { YoutubeDeskState } from "./youtube/desk-state";
import type { TtsPanel } from "./tts";
import type { FeedToggles } from "./feed-toggles";
import type { SendTargets } from "./send-targets";
import type { ChatAlertSettings } from "./chat-alert";
import type { PlatformSelection } from "./platform/selection";
import type { MentionRoster } from "./mentions";
import type { ModerationCommand } from "./moderation";
import type {
  AppEvent,
  AppSnapshot,
  AuthState,
  CategoryHit,
  Settings,
  StreamInfo,
  StreamUpdate,
} from "./types";

export interface SettingsPatch {
  twitchClientId?: string;
  twitchChannel?: string;
  youtubeChannelId?: string;
  overlayPort?: number;
  alwaysOnTop?: boolean;
  autoImportFirebot?: boolean;
  feed?: FeedToggles;
  sendTargets?: SendTargets;
  chatAlert?: ChatAlertSettings;
  platforms?: PlatformSelection;
}

export interface RascalApi {
  getSnapshot(): Promise<AppSnapshot>;
  onEvent(listener: (event: AppEvent) => void): () => void;
  sendChat(text: string, destinations?: { twitch?: boolean; youtube?: boolean }): Promise<void>;
  moderate(command: ModerationCommand): Promise<void>;
  mentions(query: string): Promise<MentionRoster>;
  searchCategories(query: string): Promise<CategoryHit[]>;
  updateStream(update: StreamUpdate): Promise<StreamInfo>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  startLogin(): Promise<AuthState>;
  cancelLogin(): Promise<void>;
  logout(): Promise<AuthState>;
  openExternal(url: string): Promise<void>;
  setAlwaysOnTop(value: boolean): Promise<void>;
  refreshRedeems(): Promise<RedeemSnapshot>;
  saveRedeem(mapping: RedeemMapping): Promise<RedeemSnapshot>;
  createReward(title: string, cost: number): Promise<RedeemSnapshot>;
  updateReward(rewardId: string, patch: { title?: string; cost?: number; enabled?: boolean }): Promise<RedeemSnapshot>;
  importFirebot(): Promise<RedeemSnapshot>;
  testRedeem(rewardId: string, mapping?: RedeemMapping): Promise<void>;
  skipAlert(): Promise<RedeemSnapshot>;
  clearAlerts(): Promise<RedeemSnapshot>;
  pickMediaFile(kind: "video" | "sound"): Promise<string | null>;
  pickChatSound(): Promise<string | null>;
  readChatSound(filePath: string): Promise<Uint8Array>;
  saveChatPreset(preset: ChatOverlayStyle): Promise<ChatOverlayFile>;
  createChatPreset(name: string, basedOnId: string): Promise<ChatOverlayFile>;
  deleteChatPreset(id: string): Promise<ChatOverlayFile>;
  ttsState(): Promise<TtsPanel>;
  ttsCommand(command: string, id?: string): Promise<TtsPanel>;
  ttsInject(payload: { platform?: string; user?: string; text?: string }): Promise<TtsPanel>;
  saveTtsSettings(patch: { baseUrl?: string; shortcuts?: boolean }): Promise<TtsPanel>;
  botState(): Promise<BotSnapshot>;
  botLogin(): Promise<BotSnapshot>;
  botLogout(): Promise<BotSnapshot>;
  botSaveCommand(command: unknown): Promise<BotSnapshot>;
  botDeleteCommand(id: string): Promise<BotSnapshot>;
  botSaveTimer(timer: unknown): Promise<BotSnapshot>;
  botDeleteTimer(id: string): Promise<BotSnapshot>;
  botSaveFilters(filters: unknown): Promise<BotSnapshot>;
  botSaveExtras(patch: unknown): Promise<BotSnapshot>;
  botSaveHook(hook: unknown): Promise<BotSnapshot>;
  botDeleteHook(id: string): Promise<BotSnapshot>;
  botTestHook(id: string): Promise<{ ok: boolean; status: number; ms: number; detail: string }>;
  botImportSe(jwt?: string): Promise<BotSnapshot>;
  botImportJson(payload: unknown): Promise<BotSnapshot>;
  botLink(): Promise<{ mode: "embedded" | "server"; serverUrl: string; tokenSet: boolean }>;
  saveBotLink(patch: { mode: "embedded" | "server"; serverUrl: string; adminToken?: string }): Promise<{ mode: "embedded" | "server"; serverUrl: string; tokenSet: boolean }>;
  botExport(): Promise<unknown>;
  botYoutubeLogin(): Promise<BotSnapshot>;
  botYoutubeLogout(): Promise<BotSnapshot>;
  botYoutubeCancel(): Promise<BotSnapshot>;
  botSaveAccounts(patch: { twitch?: "channel" | "bot"; youtube?: "channel" | "bot"; youtubeApiPoll?: boolean }): Promise<BotSnapshot>;
  botSaveGoogleClient(patch: { clientId?: string; clientSecret?: string }): Promise<BotSnapshot>;
  youtubeDeskState(): Promise<YoutubeDeskState>;
  youtubeConnect(): Promise<YoutubeDeskState>;
  youtubeCancel(): Promise<YoutubeDeskState>;
  youtubeLogout(): Promise<YoutubeDeskState>;
}
