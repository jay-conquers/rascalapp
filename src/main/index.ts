import { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain, net, protocol, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { brand, readBrandEnv } from "../shared/brand";
import { configDir, configHome, currentPathHost, fileUrl, usePathHost, type PathHost } from "../shared/paths";
import { assertAllowedExternal } from "./browser";
import { migrateLegacyConfig } from "./migrate-config";
import { Runtime } from "./runtime";
import { setChatShortcutHooks } from "./stages/chat";
import { redactError } from "../shared/redact";
import { readChatSoundFile } from "./chat-sound-file";
import type { SettingsPatch } from "../shared/api";
import { normalizePlacement, type RedeemMapping } from "../shared/redeems";
import type { StreamUpdate } from "../shared/types";
import { asRecord } from "../shared/record";

const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: http://127.0.0.1:* http://localhost:* https://static-cdn.jtvnw.net https://cdn.betterttv.net https://cdn.frankerfacez.com https://cdn.7tv.app https://yt3.ggpht.com https://yt3.googleusercontent.com https://i.ytimg.com https://lh3.googleusercontent.com",
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
  const migrations = migrateLegacyConfig(configHome(host));
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
  for (const item of migrations) {
    runtime.log.info(`copied ${item.files} files from the ${path.basename(item.from)} config directory into ${path.basename(item.to)}`);
  }
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
    backgroundColor: "#0b0c10",
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
  ipcMain.handle("app:snapshot", () => runtime.snapshot());
  ipcMain.handle("app:send-chat", (_event, text: unknown, destinations: unknown) =>
    guard(() => {
      if (typeof text !== "string") throw new Error("Message must be text.");
      return runtime.sendChat(text, asDestinations(destinations));
    }),
  );
  ipcMain.handle("app:moderate", (_event, command: unknown) => guard(() => runtime.moderate(command)));
  ipcMain.handle("app:mentions", (_event, query: unknown) => guard(() => runtime.mentions(typeof query === "string" ? query : "")));
  ipcMain.handle("app:search-categories", (_event, query: unknown) =>
    guard(() => {
      if (typeof query !== "string") return [];
      return runtime.searchCategories(query);
    }),
  );
  ipcMain.handle("app:update-stream", (_event, update: unknown) =>
    guard(() => runtime.updateStream(asStreamUpdate(update))),
  );
  ipcMain.handle("app:update-settings", (_event, patch: unknown) =>
    guard(() => runtime.updateSettings(asSettingsPatch(patch))),
  );
  ipcMain.handle("app:login", () => guard(() => runtime.startLogin()));
  ipcMain.handle("app:cancel-login", () => guard(async () => runtime.cancelLogin()));
  ipcMain.handle("app:logout", () => guard(async () => runtime.logout()));
  ipcMain.handle("app:open-external", (_event, url: unknown) =>
    guard(async () => {
      if (typeof url !== "string") throw new Error("That link cannot be opened.");
      await shell.openExternal(assertAllowedExternal(url));
    }),
  );
  ipcMain.handle("app:always-on-top", (_event, value: unknown) =>
    guard(async () => runtime.setAlwaysOnTop(Boolean(value))),
  );
  ipcMain.handle("app:redeems-refresh", () => guard(() => runtime.refreshRedeems()));
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
  ipcMain.handle("app:redeems-import", () => guard(() => runtime.importFirebot()));
  ipcMain.handle("app:redeems-test", (_event, rewardId: unknown, mapping: unknown) =>
    guard(() => {
      if (typeof rewardId !== "string") throw new Error("Missing reward.");
      return runtime.testRedeem(rewardId, mapping ? asMapping(mapping) : undefined);
    }),
  );
  ipcMain.handle("app:redeems-skip", () => guard(() => runtime.skipAlert()));
  ipcMain.handle("app:redeems-clear", () => guard(() => runtime.clearAlerts()));
  ipcMain.handle("app:chat-overlay-save", (_event, preset: unknown) => guard(() => runtime.saveChatPreset(preset)));
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
  ipcMain.handle("app:tts-state", () => guard(() => runtime.ttsPanel()));
  ipcMain.handle("app:tts-command", (_event, command: unknown, id: unknown) =>
    guard(() => {
      if (typeof command !== "string") throw new Error("Missing TTS control.");
      return runtime.ttsCommand(command, typeof id === "string" ? id : undefined);
    }),
  );
  ipcMain.handle("app:tts-inject", (_event, payload: unknown) => guard(() => runtime.ttsInject(payload)));
  ipcMain.handle("app:tts-settings", (_event, patch: unknown) => guard(() => runtime.saveTtsSettings(patch)));
  ipcMain.handle("app:bot-state", () => guard(() => runtime.botState()));
  ipcMain.handle("app:bot-login", () => guard(() => runtime.botLogin()));
  ipcMain.handle("app:bot-logout", () => guard(() => runtime.botLogout()));
  ipcMain.handle("app:bot-command", (_event, command: unknown) => guard(() => runtime.botSaveCommand(command)));
  ipcMain.handle("app:bot-command-delete", (_event, id: unknown) =>
    guard(() => {
      if (typeof id !== "string") throw new Error("Missing command.");
      return runtime.botDeleteCommand(id);
    }),
  );
  ipcMain.handle("app:bot-timer", (_event, timer: unknown) => guard(() => runtime.botSaveTimer(timer)));
  ipcMain.handle("app:bot-timer-delete", (_event, id: unknown) =>
    guard(() => {
      if (typeof id !== "string") throw new Error("Missing timer.");
      return runtime.botDeleteTimer(id);
    }),
  );
  ipcMain.handle("app:bot-filters", (_event, filters: unknown) => guard(() => runtime.botSaveFilters(filters)));
  ipcMain.handle("app:bot-extras", (_event, patch: unknown) => guard(() => runtime.botSaveExtras(patch)));
  ipcMain.handle("app:bot-hook", (_event, hook: unknown) => guard(() => runtime.botSaveHook(hook)));
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
  ipcMain.handle("app:bot-import-json", (_event, payload: unknown) => guard(() => runtime.botImportJson(payload)));
  ipcMain.handle("app:bot-link", () => guard(() => runtime.botLink()));
  ipcMain.handle("app:bot-link-save", (_event, patch: unknown) => guard(() => runtime.saveBotLink(patch)));
  ipcMain.handle("app:bot-export", () => guard(() => runtime.botExport()));
  ipcMain.handle("app:bot-youtube-login", () => guard(() => runtime.botYoutubeLogin()));
  ipcMain.handle("app:bot-youtube-logout", () => guard(() => runtime.botYoutubeLogout()));
  ipcMain.handle("app:bot-youtube-cancel", () => guard(() => runtime.botYoutubeCancel()));
  ipcMain.handle("app:bot-accounts", (_event, patch: unknown) => guard(() => runtime.botSaveAccounts(patch)));
  ipcMain.handle("app:bot-google-client", (_event, patch: unknown) => guard(() => runtime.botSaveGoogleClient(patch)));
  ipcMain.handle("app:youtube-desk", () => guard(() => runtime.youtubeDeskState()));
  ipcMain.handle("app:youtube-connect", () => guard(() => runtime.youtubeConnect()));
  ipcMain.handle("app:youtube-cancel", () => guard(() => runtime.youtubeCancel()));
  ipcMain.handle("app:youtube-logout", () => guard(() => runtime.youtubeLogout()));
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

function asStreamUpdate(value: unknown): StreamUpdate {
  const row = asRecord(value);
  if (!row || typeof row.title !== "string" || typeof row.gameId !== "string" || !Array.isArray(row.tags)) {
    throw new Error("Stream info was incomplete.");
  }
  if (!row.tags.every((tag) => typeof tag === "string")) throw new Error("Tags must be text.");
  return { title: row.title, gameId: row.gameId, tags: row.tags };
}

function asSettingsPatch(value: unknown): SettingsPatch {
  const row = asRecord(value);
  if (!row) throw new Error("Settings were incomplete.");
  const patch: SettingsPatch = {};
  if (typeof row.twitchClientId === "string") patch.twitchClientId = row.twitchClientId;
  if (typeof row.twitchChannel === "string") patch.twitchChannel = row.twitchChannel;
  if (typeof row.youtubeChannelId === "string") patch.youtubeChannelId = row.youtubeChannelId;
  if (typeof row.overlayPort === "number") patch.overlayPort = row.overlayPort;
  if (typeof row.alwaysOnTop === "boolean") patch.alwaysOnTop = row.alwaysOnTop;
  if (typeof row.autoImportFirebot === "boolean") patch.autoImportFirebot = row.autoImportFirebot;
  if (row.feed && typeof row.feed === "object") patch.feed = row.feed as SettingsPatch["feed"];
  if (row.sendTargets && typeof row.sendTargets === "object") patch.sendTargets = row.sendTargets as SettingsPatch["sendTargets"];
  if (row.chatAlert && typeof row.chatAlert === "object") patch.chatAlert = row.chatAlert as SettingsPatch["chatAlert"];
  if (row.platforms && typeof row.platforms === "object") patch.platforms = row.platforms as SettingsPatch["platforms"];
  return patch;
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

function asDestinations(value: unknown): { twitch?: boolean; youtube?: boolean } | undefined {
  const row = asRecord(value);
  if (!row) return undefined;
  const destinations: { twitch?: boolean; youtube?: boolean } = {};
  if (typeof row.twitch === "boolean") destinations.twitch = row.twitch;
  if (typeof row.youtube === "boolean") destinations.youtube = row.youtube;
  return destinations;
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
  const read = (name: "home" | "appData" | "documents" | "music" | "temp"): string | undefined => {
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
      temp: read("temp"),
    };
  }
  return {
    ...base,
    homedir: read("home") || base.homedir,
    appData: read("appData"),
    documents: read("documents"),
    music: read("music"),
    temp: read("temp"),
  };
}

function iconPath(): string {
  const candidates = [
    path.join(app.getAppPath(), "build/icons/256x256.png"),
    path.join(process.cwd(), "build/icons/256x256.png"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0] ?? "";
}
