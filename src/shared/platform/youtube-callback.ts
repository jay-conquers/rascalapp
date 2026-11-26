import { waitForLoopbackCode, type LoopbackCode } from "../loopback-login.ts";
import { YOUTUBE_OAUTH_PATH, YOUTUBE_OAUTH_PORT } from "./youtube-oauth.ts";

export type YoutubeCallback = LoopbackCode;

/** One loopback login at a time. Google redirects the browser to 127.0.0.1. */
export function waitForYoutubeCallback(options: {
  port?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  expectedState: string;
  onListening?: () => void;
}): Promise<YoutubeCallback> {
  return waitForLoopbackCode({
    port: options.port ?? YOUTUBE_OAUTH_PORT,
    path: YOUTUBE_OAUTH_PATH,
    expectedState: options.expectedState,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    onListening: options.onListening,
    title: "YouTube",
    granted: "YouTube is connected. You can close this window.",
    denied: "Google did not grant access. You can close this window.",
    cancelled: "The YouTube login was cancelled.",
    timedOut: "The YouTube login timed out. Start it again.",
    busy: "YouTube login is already waiting. Finish that one or cancel it.",
  });
}
