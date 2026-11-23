/**
 * Stream Info is one section per platform. Twitch is implemented.
 * Add a platform here, then render its section from this id in StreamInfoView.
 */
export interface StreamPlatformSection {
  id: string;
  title: string;
}

export const streamInfoPlatforms: readonly StreamPlatformSection[] = [
  { id: "twitch", title: "Twitch" },
];
