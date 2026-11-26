import http from "node:http";

export interface LoopbackCode {
  code: string;
  state: string;
}

/**
 * One loopback login at a time.
 * The browser is redirected to 127.0.0.1. The page names the site and says whether it granted access.
 */
export function waitForLoopbackCode(options: {
  port: number;
  path: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  title: string;
  granted: string;
  denied: string;
  cancelled: string;
  timedOut: string;
  busy: string;
}): Promise<LoopbackCode> {
  const port = options.port;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== options.path) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const error = url.searchParams.get("error") ?? "";
      const page = error ? options.denied : options.granted;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(`<!doctype html><title>${options.title}</title><p>${page}</p>`);
      finish(error ? new Error(options.cancelled) : null, { code, state });
    });
    const timer = setTimeout(() => finish(new Error(options.timedOut), null), timeoutMs);
    const onAbort = () => finish(new Error(options.cancelled), null);
    options.signal?.addEventListener("abort", onAbort);
    function finish(err: Error | null, value: LoopbackCode | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      server.close();
      if (err) reject(err);
      else if (value) resolve(value);
    }
    server.once("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      finish(code === "EADDRINUSE" ? new Error(options.busy) : err, null);
    });
    server.listen(port, "127.0.0.1");
  });
}
