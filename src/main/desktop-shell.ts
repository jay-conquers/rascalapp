import { brand } from "../shared/brand";

/** Windows taskbar id. The same value is `appId` in electron-builder.yml. */
export function windowsAppUserModelId(platform: string): string | null {
  return platform === "win32" ? brand.appId : null;
}

export type AppMenuRole =
  | "about"
  | "services"
  | "hide"
  | "hideOthers"
  | "unhide"
  | "quit"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "selectAll"
  | "minimize"
  | "zoom"
  | "front"
  | "close";

export interface AppMenuEntry {
  label?: string;
  role?: AppMenuRole;
  type?: "separator";
  accelerator?: string;
  submenu?: AppMenuEntry[];
}

/**
 * Minimal macOS application menu.
 * `unhide` is Show All. The quit item is Command+Q.
 * Other platforms return null so the menu bar stays empty.
 */
export function applicationMenu(platform: string, appName: string): AppMenuEntry[] | null {
  if (platform !== "darwin") return null;
  return [
    {
      label: appName,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit", accelerator: "Command+Q" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
        { role: "close" },
      ],
    },
  ];
}

export interface DesktopShellHooks {
  setAppUserModelId: (id: string) => void;
  setApplicationMenu: (template: AppMenuEntry[] | null) => void;
}

/** Windows sets the taskbar id. macOS installs the menu. Every other platform clears the menu. */
export function applyDesktopShell(platform: string, appName: string, hooks: DesktopShellHooks): void {
  const modelId = windowsAppUserModelId(platform);
  if (modelId) hooks.setAppUserModelId(modelId);
  hooks.setApplicationMenu(applicationMenu(platform, appName));
}
