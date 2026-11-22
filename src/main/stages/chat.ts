import path from "node:path";
import type { ChatOverlayFile } from "../../shared/chat-overlay";
import {
  chatBoxRect,
  normalizeChatOverlayFile,
  normalizePreset,
  parseTtsBaseUrl,
  projectChatOverlay,
  resolvePreset,
  slugPreset,
  uniquePresetId,
} from "../../shared/chat-overlay";
import type { TtsPanel } from "../../shared/tts";
import { readJson, writePrivateJson } from "../private-file";
import { overlayHelloMessage } from "../redeems/overlay-page";
import { buildChatOverlayPage } from "../chat/page";
import type { AppContext, StageModule } from "./types";
import { TtsClient } from "../tts/client";

export interface ShortcutHooks {
  status(): { supported: boolean; detail: string };
  apply(actions: { skip: () => void; togglePause: () => void }): { enabled: boolean; detail: string };
  clear(): void;
}

let hooks: ShortcutHooks | null = null;
let current: ChatOverlayEngine | null = null;

export function setChatShortcutHooks(next: ShortcutHooks | null): void {
  hooks = next;
  current?.applyShortcuts();
}

export function getChatOverlay(): ChatOverlayEngine | null {
  return current;
}

export class ChatOverlayEngine {
  private readonly filePath: string;
  private data: ChatOverlayFile;
  private readonly page: { html: string; hash: string };
  private readonly clients = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private removeOpen: (() => void) | null = null;
  private removeClose: (() => void) | null = null;
  private shortcutNote = "Global shortcuts are off.";
  private shortcutSupported = true;
  private readonly tts: TtsClient;

  constructor(
    private readonly ctx: AppContext,
    fetchImpl?: typeof fetch,
  ) {
    this.filePath = path.join(path.dirname(ctx.settings.file), "chat-overlay.json");
    this.data = this.read();
    this.page = buildChatOverlayPage(ctx.version);
    this.tts = new TtsClient(() => this.data.ttsBaseUrl, fetchImpl);
  }

  get overlayHash(): string {
    return this.page.hash;
  }

  async start(): Promise<void> {
    const server = this.ctx.server;
    server.registerRoute("GET", "/overlay/chat", (_req, res) => {
      const html = this.page.html;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(html),
      });
      res.end(html);
    });
    this.removeOpen = server.onSocketOpen((pathname, info) => {
      if (pathname !== "/ws/overlay-chat") return;
      this.clients.set(info.id, info.preset);
      server.sendTo(info.id, overlayHelloMessage(this.ctx.version, this.page.hash));
      this.pushOne(info.id, info.preset);
      this.ensureTick();
    });
    this.removeClose = server.onSocketClose((pathname, info) => {
      if (pathname !== "/ws/overlay-chat") return;
      this.clients.delete(info.id);
      this.ensureTick();
    });
    this.unsubscribe = this.ctx.chat.subscribe({
      onMessage: () => this.pushAll(),
      onDelete: () => this.pushAll(),
      onClear: () => this.pushAll(),
    });
    this.ctx.log.info("chat overlay ready", { hash: this.page.hash });
    this.applyShortcuts();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.removeOpen?.();
    this.removeClose?.();
    this.removeOpen = null;
    this.removeClose = null;
    this.clients.clear();
    hooks?.clear();
  }

  file(): ChatOverlayFile {
    return structuredClone(this.data);
  }

  refresh(): void {
    this.pushAll();
  }

  savePreset(input: unknown): ChatOverlayFile {
    const existing = this.data.presets.find((preset) => {
      const row = input && typeof input === "object" ? (input as { id?: unknown }).id : undefined;
      return typeof row === "string" && preset.id === row;
    });
    const style = normalizePreset(input, existing);
    if (!style) throw new Error("That chat preset is incomplete.");
    const presets = this.data.presets.some((preset) => preset.id === style.id)
      ? this.data.presets.map((preset) => (preset.id === style.id ? style : preset))
      : [...this.data.presets, style];
    return this.replace({ ...this.data, presets });
  }

  createPreset(name: string, basedOnId: string): ChatOverlayFile {
    if (!name.trim()) throw new Error("Name the new preset first.");
    const base = resolvePreset(this.data, basedOnId);
    const id = uniquePresetId(slugPreset(name), this.data.presets.map((preset) => preset.id));
    const style = normalizePreset({ ...base, id, name: name.trim().slice(0, 40) || id }, base);
    if (!style) throw new Error("Name the new preset first.");
    return this.replace({ ...this.data, presets: [...this.data.presets, style] });
  }

  deletePreset(id: string): ChatOverlayFile {
    if (id === "default") throw new Error("The main preset stays so the overlay URL keeps working.");
    if (!this.data.presets.some((preset) => preset.id === id)) return this.file();
    const presets = this.data.presets.filter((preset) => preset.id !== id);
    if (presets.length === 0) throw new Error("Keep at least one chat preset.");
    return this.replace({ ...this.data, presets });
  }

  saveTts(patch: { baseUrl?: string; shortcuts?: boolean }): ChatOverlayFile {
    const next = { ...this.data };
    if (typeof patch.baseUrl === "string") next.ttsBaseUrl = parseTtsBaseUrl(patch.baseUrl);
    if (typeof patch.shortcuts === "boolean") next.ttsShortcuts = patch.shortcuts;
    const saved = this.replace(next);
    this.applyShortcuts();
    return saved;
  }

  async panel(): Promise<TtsPanel> {
    const result = await this.tts.state();
    return {
      baseUrl: this.data.ttsBaseUrl,
      ok: result.ok,
      error: result.ok ? "" : result.error,
      state: result.ok ? result.state : null,
      shortcuts: this.shortcutStatus(),
    };
  }

  async command(name: string, id?: string): Promise<TtsPanel> {
    const result = await this.dispatch(name, id);
    const panel = await this.panel();
    if (!result.ok) return { ...panel, error: result.error };
    return panel;
  }

  async inject(payload: unknown): Promise<TtsPanel> {
    const row = payload && typeof payload === "object" ? (payload as { platform?: unknown; user?: unknown; text?: unknown }) : {};
    const result = await this.tts.inject({
      platform: typeof row.platform === "string" ? row.platform : "twitch",
      user: typeof row.user === "string" ? row.user : "",
      text: typeof row.text === "string" ? row.text : "",
    });
    const panel = await this.panel();
    if (!result.ok) return { ...panel, error: result.error };
    return panel;
  }

  applyShortcuts(): void {
    const enabled = this.data.ttsShortcuts;
    if (!hooks) {
      this.shortcutSupported = true;
      this.shortcutNote = enabled ? "Shortcuts turn on when the window is ready." : "Global shortcuts are off.";
      return;
    }
    const support = hooks.status();
    this.shortcutSupported = support.supported;
    if (!support.supported) {
      hooks.clear();
      this.shortcutNote = support.detail;
      return;
    }
    if (!enabled) {
      hooks.clear();
      this.shortcutNote = "Global shortcuts are off. Ctrl+Alt+S skips. Ctrl+Alt+P pauses or resumes.";
      return;
    }
    const result = hooks.apply({
      skip: () => {
        void this.tts.skip();
      },
      togglePause: () => {
        void this.tts.togglePause();
      },
    });
    this.shortcutNote = result.detail;
    if (!result.enabled) this.shortcutSupported = false;
  }

  private shortcutStatus(): TtsPanel["shortcuts"] {
    return {
      enabled: this.data.ttsShortcuts,
      supported: this.shortcutSupported,
      detail: this.shortcutNote,
    };
  }

  private async dispatch(name: string, id?: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (name === "skip") return this.tts.skip();
    if (name === "clear") return this.tts.clear();
    if (name === "pause") return this.tts.pause();
    if (name === "resume") return this.tts.resume();
    if (name === "hold-on") return this.tts.hold(true);
    if (name === "hold-off") return this.tts.hold(false);
    if (name === "approve-next") return this.tts.approveNext();
    if (name === "approve") return this.tts.approve(id ?? "");
    if (name === "reject") return this.tts.reject(id ?? "");
    return { ok: false, error: "Unknown TTS control." };
  }

  private read(): ChatOverlayFile {
    const raw = readJson(this.filePath);
    const next = normalizeChatOverlayFile(raw);
    if (!raw) writePrivateJson(this.filePath, next);
    return next;
  }

  private replace(next: ChatOverlayFile): ChatOverlayFile {
    this.data = normalizeChatOverlayFile(next);
    writePrivateJson(this.filePath, this.data);
    this.pushAll();
    return this.file();
  }

  private ensureTick(): void {
    const needsFade = [...this.clients.values()].some((preset) => resolvePreset(this.data, preset).lifetimeSeconds > 0);
    if (this.clients.size === 0 || !needsFade) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (this.timer) return;
    this.timer = setInterval(() => this.pushAll(), 250);
    this.timer.unref?.();
  }

  private pushAll(): void {
    for (const [id, preset] of this.clients) this.pushOne(id, preset);
    this.ensureTick();
  }

  private pushOne(id: string, preset: string): void {
    const style = resolvePreset(this.data, preset);
    this.ctx.server.sendTo(id, {
      type: "chat-frame",
      style,
      box: chatBoxRect(style.box),
      lines: projectChatOverlay(this.ctx.chat.messages, style, Date.now(), this.ctx.badgeImage),
    });
  }
}

export const chatStage: StageModule = {
  id: "chat-overlay",
  async start(ctx: AppContext) {
    current = new ChatOverlayEngine(ctx);
    await current.start();
  },
  async stop() {
    await current?.stop();
    current = null;
  },
};
