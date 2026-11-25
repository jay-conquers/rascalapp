/** "2 years and 3 months", "4 days and 2 hours", "just now". */
export function friendlyDuration(fromIso: string, now = Date.now()): string {
  const then = Date.parse(fromIso);
  if (!Number.isFinite(then)) return "unknown";
  const minutes = Math.max(0, Math.floor((now - then) / 60000));
  if (minutes < 1) return "just now";
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const years = Math.floor(days / 365);
  if (years >= 1) {
    const months = Math.floor((days - years * 365) / 30);
    return joinUnits(years, "year", months, "month");
  }
  const months = Math.floor(days / 30);
  if (months >= 1) {
    const remDays = days - months * 30;
    return joinUnits(months, "month", remDays, "day");
  }
  if (days >= 1) return joinUnits(days, "day", hours - days * 24, "hour");
  if (hours >= 1) return joinUnits(hours, "hour", minutes - hours * 60, "minute");
  return unit(minutes, "minute");
}

export function followageLine(name: string, followedAt: string, now = Date.now()): string {
  if (!followedAt) return `${name} is not following.`;
  return `${name} has been following for ${friendlyDuration(followedAt, now)}.`;
}

export function accountAgeLine(name: string, createdAt: string, now = Date.now()): string {
  if (!createdAt) return `I couldn't find when ${name} joined.`;
  return `${name}'s account is ${friendlyDuration(createdAt, now)} old.`;
}

function joinUnits(major: number, majorName: string, minor: number, minorName: string): string {
  if (minor < 1) return unit(major, majorName);
  return `${unit(major, majorName)} and ${unit(minor, minorName)}`;
}

function unit(count: number, name: string): string {
  return `${count} ${name}${count === 1 ? "" : "s"}`;
}
