import http from "node:http";
import { YOUTUBE_OAUTH_PATH, YOUTUBE_OAUTH_PORT } from "../../../src/shared/platform/youtube-oauth.ts";

export interface YoutubeCallback {
  code: string;
  state: string;
}

/** One loopback login at a time. Google redirects the browser to 127.0.0.1. */
export function waitForYoutubeCallback(options: {
  port?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<YoutubeCallback> {
  const port = options.port ?? YOUTUBE_OAUTH_PORT;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== YOUTUBE_OAUTH_PATH) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const error = url.searchParams.get("error") ?? "";
      const page = error
        ? "Google did not grant access. You can close this window."
        : "YouTube is connected. You can close this window.";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(`<!doctype html><title>YouTube</title><p>${page}</p>`);
      finish(error ? new Error("The YouTube login was cancelled.") : null, { code, state });
    });
    const timer = setTimeout(() => finish(new Error("The YouTube login timed out. Start it again."), null), timeoutMs);
    const onAbort = () => finish(new Error("The YouTube login was cancelled."), null);
    options.signal?.addEventListener("abort", onAbort);
    function finish(err: Error | null, value: YoutubeCallback | null): void {
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
      finish(code === "EADDRINUSE" ? new Error("YouTube login is already waiting. Finish that one or cancel it.") : err, null);
    });
    server.listen(port, "127.0.0.1");
  });
}
