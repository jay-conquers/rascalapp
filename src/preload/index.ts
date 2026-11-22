import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { brand } from "../shared/brand";
import type { RascalApi } from "../shared/api";
import type { AppEvent } from "../shared/types";

const api: RascalApi = {
  getSnapshot: () => ipcRenderer.invoke("app:snapshot"),
  onEvent: (listener) => {
    const wrapped = (_event: IpcRendererEvent, payload: AppEvent) => listener(payload);
    ipcRenderer.on("app:event", wrapped);
    return () => ipcRenderer.removeListener("app:event", wrapped);
  },
  sendChat: (text) => ipcRenderer.invoke("app:send-chat", text),
  searchCategories: (query) => ipcRenderer.invoke("app:search-categories", query),
  updateStream: (update) => ipcRenderer.invoke("app:update-stream", update),
  updateSettings: (patch) => ipcRenderer.invoke("app:update-settings", patch),
  startLogin: () => ipcRenderer.invoke("app:login"),
  cancelLogin: () => ipcRenderer.invoke("app:cancel-login"),
  logout: () => ipcRenderer.invoke("app:logout"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  setAlwaysOnTop: (value) => ipcRenderer.invoke("app:always-on-top", value),
  refreshRedeems: () => ipcRenderer.invoke("app:redeems-refresh"),
  saveRedeem: (mapping) => ipcRenderer.invoke("app:redeems-save", mapping),
  createReward: (title, cost) => ipcRenderer.invoke("app:redeems-create", title, cost),
  updateReward: (rewardId, patch) => ipcRenderer.invoke("app:redeems-update", rewardId, patch),
  importFirebot: () => ipcRenderer.invoke("app:redeems-import"),
  testRedeem: (rewardId, mapping) => ipcRenderer.invoke("app:redeems-test", rewardId, mapping),
  skipAlert: () => ipcRenderer.invoke("app:redeems-skip"),
  clearAlerts: () => ipcRenderer.invoke("app:redeems-clear"),
  pickMediaFile: (kind) => ipcRenderer.invoke("app:pick-media", kind),
  saveChatPreset: (preset) => ipcRenderer.invoke("app:chat-overlay-save", preset),
  createChatPreset: (name, basedOnId) => ipcRenderer.invoke("app:chat-overlay-create", name, basedOnId),
  deleteChatPreset: (id) => ipcRenderer.invoke("app:chat-overlay-delete", id),
  ttsState: () => ipcRenderer.invoke("app:tts-state"),
  ttsCommand: (command, id) => ipcRenderer.invoke("app:tts-command", command, id),
  ttsInject: (payload) => ipcRenderer.invoke("app:tts-inject", payload),
  saveTtsSettings: (patch) => ipcRenderer.invoke("app:tts-settings", patch),
  botState: () => ipcRenderer.invoke("app:bot-state"),
  botLogin: () => ipcRenderer.invoke("app:bot-login"),
  botLogout: () => ipcRenderer.invoke("app:bot-logout"),
  botSaveCommand: (command) => ipcRenderer.invoke("app:bot-command", command),
  botDeleteCommand: (id) => ipcRenderer.invoke("app:bot-command-delete", id),
  botSaveTimer: (timer) => ipcRenderer.invoke("app:bot-timer", timer),
  botDeleteTimer: (id) => ipcRenderer.invoke("app:bot-timer-delete", id),
  botSaveFilters: (filters) => ipcRenderer.invoke("app:bot-filters", filters),
  botImportSe: (jwt) => ipcRenderer.invoke("app:bot-import-se", jwt),
  botImportJson: (payload) => ipcRenderer.invoke("app:bot-import-json", payload),
  botLink: () => ipcRenderer.invoke("app:bot-link"),
  saveBotLink: (patch) => ipcRenderer.invoke("app:bot-link-save", patch),
  botExport: () => ipcRenderer.invoke("app:bot-export"),
};

contextBridge.exposeInMainWorld(brand.slug, api);
