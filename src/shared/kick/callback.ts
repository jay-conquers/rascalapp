import { waitForLoopbackCode, type LoopbackCode } from "../loopback-login.ts";
import { KICK_OAUTH_PATH, KICK_OAUTH_PORT } from "./oauth.ts";

export type KickCallback = LoopbackCode;

/** One loopback login at a time. The browser is sent to localhost, which reaches this listener. */
export function waitForKickCallback(options: { port?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<KickCallback> {
  return waitForLoopbackCode({
    port: options.port ?? KICK_OAUTH_PORT,
    path: KICK_OAUTH_PATH,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    title: "Kick",
    granted: "Kick is connected. You can close this window.",
    denied: "Kick did not grant access. You can close this window.",
    cancelled: "The Kick login was cancelled.",
    timedOut: "The Kick login timed out. Start it again.",
    busy: "Kick login is already waiting. Finish that one or cancel it.",
  });
}
