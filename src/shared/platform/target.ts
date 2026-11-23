/** Where a command, timer, or filter runs. Missing values stay on Twitch. */
export type PlatformTarget = "twitch" | "youtube" | "all";

export function normalizePlatformTarget(value: unknown): PlatformTarget {
  if (value === "youtube" || value === "all" || value === "twitch") return value;
  return "twitch";
}

export function targetsPlatform(target: PlatformTarget | undefined, platformId: string): boolean {
  const value = target ?? "twitch";
  return value === "all" || value === platformId;
}

/** Two checkboxes become one stored target. An empty selection stays on Twitch. */
export function targetFromChecks(twitch: boolean, youtube: boolean): PlatformTarget {
  if (twitch && youtube) return "all";
  if (youtube) return "youtube";
  return "twitch";
}

export function checksFromTarget(target: PlatformTarget | undefined): { twitch: boolean; youtube: boolean } {
  const value = target ?? "twitch";
  return {
    twitch: value === "twitch" || value === "all",
    youtube: value === "youtube" || value === "all",
  };
}
