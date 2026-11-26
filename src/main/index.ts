import { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain, net, protocol, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { brand, readBrandEnv } from "../shared/brand";
import { configDir, currentPathHost, fileUrl, usePathHost, type PathHost } from "../shared/paths";
import { assertAllowedExternal } from "./browser";
import { Runtime } from "./runtime";
import { setChatShortcutHooks } from "./stages/chat";
import { redactError } from "../shared/redact";
import { readChatSoundFile } from "./chat-sound-file";
import { asDestinations, asSettingsPatch } from "./ipc-args";
import { normalizePlacement, type RedeemMapping } from "../shared/redeems";
import type { PlatformStreamDraft, StreamEditRequest } from "../shared/stream-edit";
import type { StreamUpdate } from "../shared/types";
import { asRecord } from "../shared/record";

const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: http://127.0.0.1:* http://localhost:* https://static-cdn.jtvnw.net https://cdn.betterttv.net https://cdn.frankerfacez.com https://cdn.7tv.app https://yt3.ggpht.com https://yt3.googleusercontent.com https://i.ytimg.com https://lh3.googleusercontent.com https://files.kick.com https://kick.com",
  "connect-src 'self'",
  "font-src 'self'",
].join("; ");

protocol.registerSchemesAsPrivileged([
  {
    scheme: brand.protocol,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

// Wayland hints are Linux-only. Other platforms ignore ozone, but they should not inherit them.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations");
  app.setDesktopName(brand.desktopFile);
}
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.setName(brand.displayName);

let win: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void boot();
}

async function boot(): Promise<void> {
  Menu.setApplicationMenu(null);
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  registerAppProtocol();
  if (!readBrandEnv("RENDERER_URL")) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [PAGE_CSP],
        },
      });
    });
  }
  const host = electronPathHost();
  usePathHost(host);
  const runtime = new Runtime({
    dir: configDir(host),
    version: readVersion(),
    openExternal: async (url) => {
      await shell.openExternal(assertAllowedExternal(url));
    },
  });
  runtime.attachSender((event) => {
    if (win && !win.isDestroyed()) win.webContents.send("app:event", event);
  });
  runtime.setHooks({
    alwaysOnTop: (value) => {
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(value, "floating");
    },
  });
  try {
    await runtime.start();
  } catch (err) {
    runtime.log.error("startup failed", { message: redactError(err) });
  }
  createWindow(runtime);
  registerIpc(runtime);
  wireChatShortcuts();
  app.on("before-quit", () => {
    void runtime.stop();
  });
  app.on("window-all-closed", () => app.quit());
}

function createWindow(runtime: Runtime): void {
  const settings = runtime.settings.load();
  const bounds = settings.windowBounds;
  win = new BrowserWindow({
    x: bounds?.x,
    y: bounds?.y,
    width: bounds?.width ?? 1180,
    height: bounds?.height ?? 780,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: "#121110",
    title: brand.displayName,
    autoHideMenuBar: true,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(settings.alwaysOnTop, "floating");
  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const blockNavigation = (event: { preventDefault: () => void }, url: string) => {
    const devUrl = readBrandEnv("RENDERER_URL");
    if (url.startsWith(`${brand.protocol}://app/`)) return;
    if (devUrl && url.startsWith(devUrl)) return;
    event.preventDefault();
  };
  win.webContents.on("will-navigate", blockNavigation);
  win.webContents.on("will-redirect", blockNavigation);
  win.webContents.on("render-process-gone", () => {
    if (win && !win.isDestroyed()) void win.loadURL(`${brand.protocol}://app/index.html`);
  });
  win.webContents.on("console-message", (event) => {
    const level = "level" in event ? String(event.level) : "";
    const message = "message" in event ? String(event.message) : "";
    if (level === "warning" || level === "error") runtime.log.error("renderer", { level, message });
  });
  const devUrl = readBrandEnv("RENDERER_URL");
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadURL(`${brand.protocol}://app/index.html`);

  let timer: NodeJS.Timeout | undefined;
  const remember = () => {
    if (!win || win.isDestroyed()) return;
    runtime.settings.update({ windowBounds: win.getBounds() });
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(remember, 400);
  };
  win.on("resize", schedule);
  win.on("move", schedule);
}

function registerAppProtocol(): void {
  protocol.handle(brand.protocol, (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/" || pathname === "") pathname = "/index.html";
    const root = path.normalize(path.join(__dirname, "../renderer"));
    const filePath = path.normalize(path.join(root, pathname));
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(fileUrl(filePath));
  });
}

function registerIpc(runtime: Runtime): void {
  const on = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (_event, ...args) => guard(() => fn(...args)));
  };
  ipcMain.handle("app:snapshot", () => runtime.snapshot());
  ipcMain.handle("app:send-chat", (_event, text: unknown, destinations: unknown) =>
    guard(() => {
      if (typeof text !== "string") throw new Error("Message must be text.");
      return runtime.sendChat(text, asDestinations(destinations));
    }),
  );
  on("app:moderate", (command) => runtime.moderate(command));
  ipcMain.handle("app:mentions", (_event, query: unknown) => guard(() => runtime.mentions(typeof query === "string" ? query : "")));
  ipcMain.handle("app:search-categories", (_event, query: unknown, platform: unknown) =>
    guard(() => {
      if (typeof query !== "string") return [];
      return runtime.searchCategories(query, platform === "kick" ? "kick" : "twitch");
    }),
  );
  ipcMain.handle("app:update-stream", (_event, update: unknown) =>
    guard(() => runtime.updateStream(asStreamUpdate(update))),
  );
  ipcMain.handle("app:update-streams", (_event, request: unknown) =>
    guard(() => runtime.updateStreams(asStreamEditRequest(request))),
  );
  on("app:kick-stream", () => runtime.kickStream());
  ipcMain.handle("app:update-settings", (_event, patch: unknown) =>
    guard(() => runtime.updateSettings(asSettingsPatch(patch))),
  );
  on("app:login", () => runtime.startLogin());
  on("app:cancel-login", () => runtime.cancelLogin());
  on("app:logout", () => runtime.logout());
  ipcMain.handle("app:open-external", (_event, url: unknown) =>
    guard(async () => {
      if (typeof url !== "string") throw new Error("That link cannot be opened.");
      await shell.openExternal(assertAllowedExternal(url));
    }),
  );
  ipcMain.handle("app:always-on-top", (_event, value: unknown) =>
    guard(async () => runtime.setAlwaysOnTop(Boolean(value))),
  );
  on("app:redeems-refresh", () => runtime.refreshRedeems());
  ipcMain.handle("app:redeems-save", (_event, mapping: unknown) =>
    guard(() => runtime.saveRedeem(asMapping(mapping))),
  );
  ipcMain.handle("app:redeems-create", (_event, title: unknown, cost: unknown) =>
    guard(() => {
      if (typeof title !== "string" || typeof cost !== "number") throw new Error("Reward name and cost are required.");
      return runtime.createReward(title, cost);
    }),
  );
  ipcMain.handle("app:redeems-update", (_event, rewardId: unknown, patch: unknown) =>
    guard(() => {
      if (typeof rewardId !== "string") throw new Error("Missing reward.");
      const row = asRecord(patch) ?? {};
      return runtime.updateReward(rewardId, {
        title: typeof row.title === "string" ? row.title : undefined,
        cost: typeof row.cost === "number" ? row.cost : undefined,
        enabled: typeof row.enabled === "boolean" ? row.enabled : undefined,
      });
    }),
  );
  on("app:redeems-import", () => runtime.importFirebot());
  ipcMain.handle("app:redeems-test", (_event, rewardId: unknown, mapping: unknown) =>
    guard(() => {
      if (typeof rewardId !== "string") throw new Error("Missing reward.");
      return runtime.testRedeem(rewardId, mapping ? asMapping(mapping) : undefined);
    }),
  );
  on("app:redeems-skip", () => runtime.skipAlert());
  on("app:redeems-clear", () => runtime.clearAlerts());
  on("app:chat-overlay-save", (preset) => runtime.saveChatPreset(preset));
  ipcMain.handle("app:chat-overlay-create", (_event, name: unknown, basedOnId: unknown) =>
    guard(() => {
      if (typeof name !== "string" || typeof basedOnId !== "string") throw new Error("Name the new preset first.");
      return runtime.createChatPreset(name, basedOnId);
    }),
  );
  ipcMain.handle("app:chat-overlay-delete", (_event, id: unknown) =>
    guard(() => {
      if (typeof id !== "string") throw new Error("Missing preset.");
      return runtime.deleteChatPreset(id);
    }),
  );
  on("app:tts-state", () => runtime.ttsPanel());
  ipcMain.handle("app:tts-command", (_event, command: unknown, id: unknown) =>
    guard(() => {
      if (typeof command !== "string") throw new Error("Missing TTS control.");
      return runtime.ttsCommand(command, typeof id === "string" ? id : undefined);
    }),
  );
  on("app:tts-inject", (payload) => runtime.ttsInject(payload));
  on("app:tts-settings", (patch) => runtime.saveTtsSettings(patch));
  on("app:bot-state", () => runtime.botState());
  on("app:bot-login", () => runtime.botLogin());
  on("app:bot-logout", () => runtime.botLogout());
  on("app:bot-command", (command) => runtime.botSaveCommand(command));
  ipcMain.handle("app:bot-command-delete", (_event, id: unknown) =>
    guard(() => {
      if (typeof id !== "string") throw new Error("Missing command.");
      return runtime.botDeleteCommand(id);
    }),
  );
  on("app:bot-timer", (timer) => runtime.botSaveTimer(timer));
  ipcMain.handle("app:bot-timer-delete", (_event, id: unknown) =>
    guard(() => {
      if (typeof id !== "string") throw new Error("Missing timer.");
      return runtime.botDeleteTimer(id);
    }),
  );
  on("app:bot-filters", (filters) => runtime.botSaveFilters(filters));
  on("app:bot-extras", (patch) => runtime.botSaveExtras(patch));
  on("app:bot-hook", (hook) => runtime.botSaveHook(hook));
  ipcMain.handle("app:bot-hook-delete", (_event, id: unknown) =>
    guard(() => {
      if (typeof id !== "string") throw new Error("Missing hook.");
      return runtime.botDeleteHook(id);
    }),
  );
  ipcMain.handle("app:bot-hook-test", (_event, id: unknown) =>
    guard(() => {
      if (typeof id !== "string") throw new Error("Missing hook.");
      return runtime.botTestHook(id);
    }),
  );
  ipcMain.handle("app:bot-import-se", (_event, jwt: unknown) =>
    guard(() => {
      if (jwt !== undefined && jwt !== null && typeof jwt !== "string") throw new Error("Paste the StreamElements JWT.");
      return runtime.botImportSe(typeof jwt === "string" ? jwt : "");
    }),
  );
  on("app:bot-import-json", (payload) => runtime.botImportJson(payload));
  on("app:bot-link", () => runtime.botLink());
  on("app:bot-link-save", (patch) => runtime.saveBotLink(patch));
  on("app:bot-export", () => runtime.botExport());
  on("app:bot-youtube-login", () => runtime.botYoutubeLogin());
  on("app:bot-youtube-logout", () => runtime.botYoutubeLogout());
  on("app:bot-youtube-cancel", () => runtime.botYoutubeCancel());
  on("app:bot-accounts", (patch) => runtime.botSaveAccounts(patch));
  on("app:bot-google-client", (patch) => runtime.botSaveGoogleClient(patch));
  on("app:youtube-desk", () => runtime.youtubeDeskState());
  on("app:youtube-connect", () => runtime.youtubeConnect());
  on("app:youtube-cancel", () => runtime.youtubeCancel());
  on("app:youtube-logout", () => runtime.youtubeLogout());
  on("app:kick-desk", () => runtime.kickDeskState());
  on("app:kick-connect", () => runtime.kickConnect());
  on("app:kick-cancel", () => runtime.kickCancel());
  on("app:kick-logout", () => runtime.kickLogout());
  on("app:kick-client", (patch) => runtime.kickSaveClient(patch));
  on("app:kick-relay", (patch) => runtime.kickSaveRelay(patch));
  ipcMain.handle("app:chat-sound-pick", () =>
    guard(async () => {
      const result = await dialog.showOpenDialog({
        title: "Choose a chat alert sound",
        properties: ["openFile"],
        filters: [{ name: "Audio", extensions: ["wav", "mp3", "ogg", "flac", "m4a", "aac"] }],
      });
      if (result.canceled) return null;
      const file = result.filePaths[0];
      if (!file) return null;
      readChatSoundFile(file);
      return file;
    }),
  );
  ipcMain.handle("app:chat-sound-read", (_event, filePath: unknown) =>
    guard(() => {
      if (typeof filePath !== "string") throw new Error("Choose a local audio file.");
      return readChatSoundFile(filePath).bytes;
    }),
  );
  ipcMain.handle("app:pick-media", (_event, kind: unknown) =>
    guard(async () => {
      const video = kind !== "sound";
      const result = await dialog.showOpenDialog({
        title: video ? "Choose a video" : "Choose a sound",
        properties: ["openFile"],
        filters: video
          ? [
              { name: "Video", extensions: ["mp4", "webm", "mov", "mkv", "m4v", "gif"] },
              { name: "All files", extensions: ["*"] },
            ]
          : [
              { name: "Audio", extensions: ["mp3", "wav", "ogg", "flac", "m4a"] },
              { name: "All files", extensions: ["*"] },
            ],
      });
      if (result.canceled) return null;
      return result.filePaths[0] ?? null;
    }),
  );
}

async function guard<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new Error(redactError(err));
  }
}

function asStreamEditRequest(value: unknown): StreamEditRequest {
  const row = asRecord(value);
  if (!row || typeof row.applyAll !== "boolean" || typeof row.title !== "string" || !Array.isArray(row.edits)) {
    throw new Error("Stream info was incomplete.");
  }
  const edits = row.edits.map((item): PlatformStreamDraft => {
    const edit = asRecord(item);
    const platform = edit?.platform;
    if (platform !== "twitch" && platform !== "youtube" && platform !== "kick") throw new Error("Stream info was incomplete.");
    if (!edit || typeof edit.title !== "string") throw new Error("Stream info was incomplete.");
    const tags = edit.tags;
    if (tags !== undefined && (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string"))) {
      throw new Error("Tags must be text.");
    }
    return {
      platform,
      title: edit.title,
      gameId: typeof edit.gameId === "string" ? edit.gameId : undefined,
      tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : undefined,
    };
  });
  return { applyAll: row.applyAll, title: row.title, edits };
}

function asStreamUpdate(value: unknown): StreamUpdate {
  const row = asRecord(value);
  if (!row || typeof row.title !== "string" || typeof row.gameId !== "string" || !Array.isArray(row.tags)) {
    throw new Error("Stream info was incomplete.");
  }
  if (!row.tags.every((tag) => typeof tag === "string")) throw new Error("Tags must be text.");
  return { title: row.title, gameId: row.gameId, tags: row.tags };
}

function asMapping(value: unknown): RedeemMapping {
  const row = asRecord(value);
  if (!row || typeof row.title !== "string") throw new Error("That mapping is incomplete.");
  const action = row.action === "video" || row.action === "sound" || row.action === "none" ? row.action : "none";
  return {
    rewardId: typeof row.rewardId === "string" ? row.rewardId : "",
    title: row.title,
    action,
    filePath: typeof row.filePath === "string" ? row.filePath : "",
    volume: typeof row.volume === "number" ? row.volume : 100,
    maxDurationMs: typeof row.maxDurationMs === "number" ? row.maxDurationMs : null,
    enabled: row.enabled !== false,
    placement: normalizePlacement(row.placement),
  };
}

function readVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf8");
    const version = JSON.parse(raw).version;
    return typeof version === "string" ? version : "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function wireChatShortcuts(): void {
  const wayland = process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || Boolean(process.env.WAYLAND_DISPLAY));
  const skipAccel = "CommandOrControl+Alt+S";
  const pauseAccel = "CommandOrControl+Alt+P";
  setChatShortcutHooks({
    status() {
      if (wayland) {
        return {
          supported: false,
          detail: "Wayland does not deliver Electron global shortcuts, so this stays off on Hyprland. Bind a Hyprland key to the tts-queue skip and pause URLs. The same shortcuts work on X11, Windows, and macOS.",
        };
      }
      return {
        supported: true,
        detail: "Ctrl+Alt+S skips the current line. Ctrl+Alt+P pauses or resumes. On macOS that is Command+Option.",
      };
    },
    apply(actions) {
      globalShortcut.unregister(skipAccel);
      globalShortcut.unregister(pauseAccel);
      const skipOk = globalShortcut.register(skipAccel, () => actions.skip());
      const pauseOk = globalShortcut.register(pauseAccel, () => actions.togglePause());
      if (!skipOk || !pauseOk) {
        globalShortcut.unregister(skipAccel);
        globalShortcut.unregister(pauseAccel);
        return { enabled: false, detail: "The system refused Ctrl+Alt+S or Ctrl+Alt+P. Another app may already own them." };
      }
      return { enabled: true, detail: "Ctrl+Alt+S skips. Ctrl+Alt+P pauses or resumes." };
    },
    clear() {
      globalShortcut.unregister(skipAccel);
      globalShortcut.unregister(pauseAccel);
    },
  });
}

function electronPathHost(): PathHost {
  const base = currentPathHost();
  const read = (name: "home" | "appData" | "documents" | "music"): string | undefined => {
    try {
      return app.getPath(name);
    } catch {
      return undefined;
    }
  };
  // Linux config and the Streaming asset default stay on os.homedir() and XDG_CONFIG_HOME.
  // Electron's appData is recorded for callers, and is not substituted into those paths.
  if (process.platform === "linux") {
    return {
      ...base,
      appData: read("appData"),
      documents: read("documents"),
      music: read("music"),
    };
  }
  return {
    ...base,
    homedir: read("home") || base.homedir,
    appData: read("appData"),
    documents: read("documents"),
    music: read("music"),
  };
}

function iconPath(): string {
  const candidates = [
    path.join(app.getAppPath(), "build/icons/256x256.png"),
    path.join(process.cwd(), "build/icons/256x256.png"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0] ?? "";
}
