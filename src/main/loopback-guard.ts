/** Host and Origin checks for the loopback overlay server. */

export function isLoopbackHost(value: string | undefined): boolean {
  const host = hostnameOf(value);
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * A browser always sends Origin. Non-browser clients on this machine do not.
 * Only the overlay's own loopback origin may read or change overlay state.
 */
export function isAllowedOverlayOrigin(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  if (!origin || origin === "null") return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" || url.username || url.password) return false;
  if (!isLoopbackHost(url.hostname)) return false;
  const originPort = url.port ? Number(url.port) : 80;
  return originPort === port;
}

function hostnameOf(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    let host = url.hostname.toLowerCase();
    if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
    while (host.endsWith(".")) host = host.slice(0, -1);
    return host;
  } catch {
    return "";
  }
}
