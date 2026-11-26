import type { Platform } from "./types";

/**
 * Stream info is one section per platform. A section is shown only when that
 * platform is enabled in the picker.
 */
export interface StreamPlatformSection {
  id: Platform;
  title: string;
  /** YouTube's live API has no game field. The game title is set in Studio. */
  game: boolean;
}

export const streamInfoPlatforms: readonly StreamPlatformSection[] = [
  { id: "twitch", title: "Twitch", game: true },
  { id: "youtube", title: "YouTube", game: false },
  { id: "kick", title: "Kick", game: true },
];
