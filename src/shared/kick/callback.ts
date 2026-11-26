import http from "node:http";
import { KICK_OAUTH_PATH, KICK_OAUTH_PORT } from "./oauth.ts";

export interface KickCallback {
  code: string;
  state: string;
}

/** One loopback login at a time. The browser is sent to localhost, which reaches this listener. */
export function waitForKickCallback(options: { port?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<KickCallback> {
  const port = options.port ?? KICK_OAUTH_PORT;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== KICK_OAUTH_PATH) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const error = url.searchParams.get("error") ?? "";
      const page = error ? "Kick did not grant access. You can close this window." : "Kick is connected. You can close this window.";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(`<!doctype html><title>Kick</title><p>${page}</p>`);
      finish(error ? new Error("The Kick login was cancelled.") : null, { code, state });
    });
    const timer = setTimeout(() => finish(new Error("The Kick login timed out. Start it again."), null), timeoutMs);
    const onAbort = () => finish(new Error("The Kick login was cancelled."), null);
    options.signal?.addEventListener("abort", onAbort);
    function finish(err: Error | null, value: KickCallback | null): void {
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
      finish(code === "EADDRINUSE" ? new Error("Kick login is already waiting. Finish that one or cancel it.") : err, null);
    });
    server.listen(port, "127.0.0.1");
  });
}
