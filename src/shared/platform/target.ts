/** Where a command, timer, or filter runs. Missing values stay on Twitch. */
export type PlatformTarget = "twitch" | "youtube" | "kick" | "all" | "twitch+youtube" | "twitch+kick" | "youtube+kick";

const KNOWN = new Set<PlatformTarget>(["twitch", "youtube", "kick", "all", "twitch+youtube", "twitch+kick", "youtube+kick"]);

export function normalizePlatformTarget(value: unknown): PlatformTarget {
  if (typeof value === "string" && KNOWN.has(value as PlatformTarget)) return value as PlatformTarget;
  return "twitch";
}

export function targetsPlatform(target: PlatformTarget | undefined, platformId: string): boolean {
  const checks = checksFromTarget(target);
  if (platformId === "twitch") return checks.twitch;
  if (platformId === "youtube") return checks.youtube;
  if (platformId === "kick") return checks.kick;
  return false;
}

/** Checked sites become one stored target. An empty selection stays on Twitch. */
export function targetFromChecks(twitch: boolean, youtube: boolean, kick = false): PlatformTarget {
  const ids = [twitch ? "twitch" : "", youtube ? "youtube" : "", kick ? "kick" : ""].filter(Boolean);
  if (ids.length === 3) return "all";
  if (ids.length === 2) return `${ids[0]}+${ids[1]}` as PlatformTarget;
  if (ids[0] === "twitch" || ids[0] === "youtube" || ids[0] === "kick") return ids[0];
  return "twitch";
}

export function checksFromTarget(target: PlatformTarget | undefined): { twitch: boolean; youtube: boolean; kick: boolean } {
  const value = normalizePlatformTarget(target);
  if (value === "all") return { twitch: true, youtube: true, kick: true };
  return {
    twitch: value === "twitch" || value === "twitch+youtube" || value === "twitch+kick",
    youtube: value === "youtube" || value === "twitch+youtube" || value === "youtube+kick",
    kick: value === "kick" || value === "twitch+kick" || value === "youtube+kick",
  };
}
