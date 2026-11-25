import path from "node:path";
import {
  DEFAULT_OVERLAY_PORT,
  DEFAULT_TWITCH_CHANNEL,
  DEFAULT_YOUTUBE_CHANNEL_ID,
} from "../shared/defaults";
import { defaultFeed, mergeFeed } from "../shared/feed-toggles";
import { defaultSendTargets, mergeSendTargets } from "../shared/send-targets";
import { defaultChatAlert, mergeChatAlert } from "../shared/chat-alert";
import type { Settings } from "../shared/types";
import { readJson, tightenFile, writePrivateJson } from "./private-file";

export const DEFAULT_SETTINGS: Settings = {
  twitchClientId: "",
  twitchChannel: DEFAULT_TWITCH_CHANNEL,
  youtubeChannelId: DEFAULT_YOUTUBE_CHANNEL_ID,
  overlayPort: DEFAULT_OVERLAY_PORT,
  alwaysOnTop: false,
  autoImportFirebot: true,
  feed: defaultFeed(),
  sendTargets: defaultSendTargets(),
  chatAlert: defaultChatAlert(),
};

export class SettingsStore {
  readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, "settings.json");
    tightenFile(this.file);
  }

  load(): Settings {
    const raw = readJson(this.file);
    if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
    try {
      return mergeSettings(DEFAULT_SETTINGS, raw as Partial<Settings>);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  update(patch: Partial<Settings>): Settings {
    const next = mergeSettings(this.load(), patch);
    writePrivateJson(this.file, next);
    return next;
  }
}

export function mergeSettings(current: Settings, patch: Partial<Settings>): Settings {
  const next: Settings = {
    twitchClientId: patch.twitchClientId !== undefined ? patch.twitchClientId.trim() : current.twitchClientId,
    twitchChannel:
      patch.twitchChannel !== undefined
        ? patch.twitchChannel.trim().replace(/^#/, "").toLowerCase()
        : current.twitchChannel,
    youtubeChannelId: patch.youtubeChannelId !== undefined ? patch.youtubeChannelId.trim() : current.youtubeChannelId,
    overlayPort: patch.overlayPort !== undefined ? Number(patch.overlayPort) : current.overlayPort,
    alwaysOnTop: patch.alwaysOnTop !== undefined ? Boolean(patch.alwaysOnTop) : current.alwaysOnTop,
    autoImportFirebot:
      patch.autoImportFirebot !== undefined ? Boolean(patch.autoImportFirebot) : current.autoImportFirebot,
    feed: mergeFeed(current.feed ?? defaultFeed(), patch.feed),
    sendTargets: mergeSendTargets(current.sendTargets, patch.sendTargets),
    chatAlert: mergeChatAlert(current.chatAlert, patch.chatAlert),
    windowBounds: patch.windowBounds !== undefined ? patch.windowBounds : current.windowBounds,
  };
  if (next.twitchClientId && !/^[a-zA-Z0-9]{10,80}$/.test(next.twitchClientId)) {
    throw new Error("That client ID does not look like a Twitch client ID.");
  }
  if (next.twitchChannel && !/^[a-z0-9_]{3,25}$/.test(next.twitchChannel)) {
    throw new Error("Twitch channel should be the login name, like examplechannel.");
  }
  if (next.youtubeChannelId && !/^UC[\w-]{22}$/.test(next.youtubeChannelId)) {
    throw new Error("YouTube channel ID should look like UCxxxxxxxxxxxxxxxxxxxxxx.");
  }
  if (!Number.isInteger(next.overlayPort) || next.overlayPort < 1024 || next.overlayPort > 65535) {
    throw new Error("Overlay port must be between 1024 and 65535.");
  }
  if (next.windowBounds && !saneBounds(next.windowBounds)) next.windowBounds = current.windowBounds;
  return next;
}

function saneBounds(bounds: { x: number; y: number; width: number; height: number }): boolean {
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return false;
  return width >= 720 && height >= 520 && width <= 8000 && height <= 8000;
}
