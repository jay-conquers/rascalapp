import http from "node:http";

export interface LoopbackCode {
  code: string;
  state: string;
}

/**
 * One loopback login at a time.
 * The browser is redirected to localhost or 127.0.0.1. Both are accepted.
 * A request whose state does not match is ignored, so another page on this
 * computer cannot finish or cancel the login.
 */
export function waitForLoopbackCode(options: {
  port: number;
  path: string;
  expectedState: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  title: string;
  granted: string;
  denied: string;
  cancelled: string;
  timedOut: string;
  busy: string;
  onListening?: () => void;
}): Promise<LoopbackCode> {
  const port = options.port;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  if (!options.expectedState) return Promise.reject(new Error(options.cancelled));
  return new Promise((resolve, reject) => {
    let settled = false;
    let pending = 0;
    let opened = 0;
    let announced = false;
    const servers: http.Server[] = [];
    const timer = setTimeout(() => finish(new Error(options.timedOut), null), timeoutMs);
    const onAbort = () => finish(new Error(options.cancelled), null);
    options.signal?.addEventListener("abort", onAbort);

    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== options.path) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end("Not found");
        return;
      }
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const error = url.searchParams.get("error") ?? "";
      if (state !== options.expectedState) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end("This login attempt does not match.");
        return;
      }
      const page = error ? options.denied : options.granted;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(`<!doctype html><title>${escapeHtml(options.title)}</title><p>${escapeHtml(page)}</p>`);
      if (error || !code) finish(new Error(options.cancelled), null);
      else finish(null, { code, state });
    };

    function announce(): void {
      if (announced || settled || opened === 0 || pending !== 0) return;
      announced = true;
      try {
        options.onListening?.();
      } catch (err) {
        finish(err instanceof Error ? err : new Error(options.cancelled), null);
      }
    }

    function listen(host: string): void {
      const server = http.createServer(handler);
      servers.push(server);
      pending += 1;
      server.once("error", (err) => {
        pending -= 1;
        const code = (err as NodeJS.ErrnoException).code;
        if (host === "::1" && (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT" || code === "EINVAL")) {
          announce();
          return;
        }
        finish(code === "EADDRINUSE" ? new Error(options.busy) : err, null);
      });
      server.listen(port, host, () => {
        pending -= 1;
        opened += 1;
        announce();
      });
    }

    function finish(err: Error | null, value: LoopbackCode | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      for (const server of servers) server.close();
      if (err) reject(err);
      else if (value) resolve(value);
    }

    if (options.signal?.aborted) {
      finish(new Error(options.cancelled), null);
      return;
    }
    listen("127.0.0.1");
    listen("::1");
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    return "&quot;";
  });
}
