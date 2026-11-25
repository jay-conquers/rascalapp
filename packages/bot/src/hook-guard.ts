import dns from "node:dns";
import net from "node:net";

/**
 * Where a hook is allowed to connect.
 * Link-local and cloud-metadata addresses are never allowed.
 * Loopback is http only, and only for localhost or a loopback literal.
 * RFC1918 and IPv6 unique-local addresses are http only, and only when
 * RASCAL_HOOK_PRIVATE_HTTP is on. https must resolve to public addresses.
 */
export type IpClass = "public" | "loopback" | "private" | "link-local" | "metadata" | "blocked";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

const BLOCKED_NAMES = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.google.com",
  "metadata.internal",
  "instance-data",
]);

export function normalizeHost(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  while (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

export function isBlockedHookName(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host || host.includes("%")) return true;
  if (BLOCKED_NAMES.has(host)) return true;
  return host.endsWith(".metadata.google.internal");
}

/** Decimal, octal, hex, and short IPv4 forms. The URL parser usually canonicalizes these first. */
export function isAmbiguousIp(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host || net.isIP(host) !== 0) return false;
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true;
  if (!host.includes(".")) return false;
  const parts = host.split(".");
  const numeric = parts.every((part) => /^[0-9]+$/.test(part) || /^0x[0-9a-f]+$/i.test(part));
  if (!numeric) return false;
  return true;
}

export function isSingleLabel(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!/^[a-z0-9-]{1,63}$/i.test(host)) return false;
  if (host.startsWith("-") || host.endsWith("-")) return false;
  if (/^\d+$/.test(host)) return false;
  return true;
}

export function classifyIp(address: string): IpClass {
  const host = normalizeHost(address);
  if (net.isIP(host) === 4) return classifyV4(host) ?? "blocked";
  if (net.isIP(host) === 6) return classifyV6(host);
  return "blocked";
}

/** Null when the hostname is a name, not an address. */
export function classifyLiteral(hostname: string): IpClass | null {
  const host = normalizeHost(hostname);
  if (net.isIP(host) === 0) return null;
  return classifyIp(host);
}

export function literalAllowed(kind: IpClass, protocol: string, allowPrivateHttp: boolean): boolean {
  if (kind === "loopback") return protocol === "http:";
  if (kind === "private") return protocol === "http:" && allowPrivateHttp;
  if (kind === "public") return protocol === "https:";
  return false;
}

/**
 * Pick one address to connect to. Every answer must be allowed.
 * A mixed public and private answer is rejected so a rebinding reply cannot sneak through.
 */
export function chooseHookAddress(
  hostname: string,
  protocol: string,
  records: readonly ResolvedAddress[],
  allowPrivateHttp: boolean,
): ResolvedAddress | null {
  if (records.length === 0) return null;
  const host = normalizeHost(hostname);
  if (!host || isBlockedHookName(host) || isAmbiguousIp(host)) return null;
  const classes = records.map((record) => classifyIp(record.address));
  if (classes.some((kind) => kind === "metadata" || kind === "link-local" || kind === "blocked")) return null;
  if (protocol === "https:") return classes.every((kind) => kind === "public") ? records[0] : null;
  if (protocol !== "http:") return null;
  const literal = classifyLiteral(host);
  if (host === "localhost" || literal === "loopback") {
    return classes.every((kind) => kind === "loopback") ? records[0] : null;
  }
  if (allowPrivateHttp && (isSingleLabel(host) || literal === "private")) {
    return classes.every((kind) => kind === "private" || kind === "loopback") ? records[0] : null;
  }
  return null;
}

export async function resolveHookHost(
  hostname: string,
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>,
): Promise<ResolvedAddress[]> {
  const host = normalizeHost(hostname);
  if (!host || isBlockedHookName(host) || isAmbiguousIp(host)) return [];
  const version = net.isIP(host);
  if (version === 4 || version === 6) return [{ address: host, family: version }];
  return (lookup ?? defaultLookup)(host);
}

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  const rows = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => ({ address: row.address, family: row.family === 6 ? 6 : 4 }));
}

function classifyV4(address: string): IpClass | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  if (parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part))) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => part > 255)) return null;
  const [a, b, c] = numbers;
  const value = (((numbers[0] << 24) | (numbers[1] << 16) | (numbers[2] << 8) | numbers[3]) >>> 0);
  if (value === 0xa9fea9fe) return "metadata";
  if (a === 0) return "blocked";
  if (a === 10) return "private";
  if (a === 127) return "loopback";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "link-local";
  if (a === 100 && b >= 64 && b <= 127) return "blocked";
  if (a === 192 && b === 0 && c === 0) return "blocked";
  if (a === 192 && b === 0 && c === 2) return "blocked";
  if (a === 198 && (b === 18 || b === 19)) return "blocked";
  if (a === 198 && b === 51 && c === 100) return "blocked";
  if (a === 203 && b === 0 && c === 113) return "blocked";
  if (a >= 224) return "blocked";
  return "public";
}

function classifyV6(address: string): IpClass {
  const groups = expandV6(address);
  if (!groups) return "blocked";
  if (groups.every((group) => group === 0)) return "blocked";
  if (groups[7] === 1 && groups.slice(0, 7).every((group) => group === 0)) return "loopback";
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return classifyV4(v4FromGroups(groups[6], groups[7])) ?? "blocked";
  }
  if (groups.slice(0, 6).every((group) => group === 0)) {
    return classifyV4(v4FromGroups(groups[6], groups[7])) ?? "blocked";
  }
  if (groups[0] === 0x2002) return classifyV4(v4FromGroups(groups[1], groups[2])) ?? "blocked";
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) return classifyV4(v4FromGroups(groups[6], groups[7])) ?? "blocked";
  if (groups[0] === 0x2001 && groups[1] === 0) return "blocked";
  if ((groups[0] & 0xfe00) === 0xfc00) return "private";
  if ((groups[0] & 0xffc0) === 0xfe80 || (groups[0] & 0xffc0) === 0xfec0) return "link-local";
  if ((groups[0] & 0xff00) === 0xff00) return "blocked";
  if (groups[0] === 0x2001 && (groups[1] === 0x0db8 || groups[1] === 0x0002)) return "blocked";
  if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return "blocked";
  return "public";
}

function v4FromGroups(high: number, low: number): string {
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

function expandV6(address: string): number[] | null {
  let text = normalizeHost(address);
  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const v4 = classifyV4(dotted[2] ?? "");
    if (!v4) return null;
    const parts = (dotted[2] ?? "").split(".").map((part) => Number(part));
    const high = ((parts[0] << 8) | parts[1]).toString(16);
    const low = ((parts[2] << 8) | parts[3]).toString(16);
    text = `${dotted[1]}${high}:${low}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (piece: string): number[] | null => {
    if (!piece) return [];
    const groups = piece.split(":");
    const numbers: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      numbers.push(Number.parseInt(group, 16));
    }
    return numbers;
  };
  const left = parse(halves[0] ?? "");
  const right = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (!left || !right) return null;
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}
