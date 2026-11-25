import { createHmac } from "node:crypto";
import http from "node:http";
import https from "node:https";
import {
  HOOK_BODY_LIMIT,
  HOOK_SIGNATURE_HEADER,
  checkHookUrl,
  parseHookReply,
  type ChatHook,
  type HookPayload,
} from "./chat-hook.ts";
import { chooseHookAddress, normalizeHost, resolveHookHost, type ResolvedAddress } from "./hook-guard.ts";

export interface HookCallResult {
  status: number;
  ms: number;
  reply: string;
}

export function signHookBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export interface HookCallOptions {
  /** Test seam. Production resolves through DNS and connects to that address. */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
}

export async function callChatHook(
  hook: ChatHook,
  payload: HookPayload,
  fetchImpl: typeof fetch = fetch,
  options?: HookCallOptions,
): Promise<HookCallResult> {
  const url = checkHookUrl(hook.url);
  if (!url) throw new Error("That address is not allowed.");
  const target = new URL(url);
  const allowPrivateHttp = process.env.RASCAL_HOOK_PRIVATE_HTTP === "1";
  let records: ResolvedAddress[];
  try {
    records = await resolveHookHost(target.hostname, options?.resolve);
  } catch {
    throw new Error("The hook address could not be resolved.");
  }
  const pin = chooseHookAddress(target.hostname, target.protocol, records, allowPrivateHttp);
  if (!pin) throw new Error("That address is not allowed.");
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/plain" };
  if (hook.secret) headers[HOOK_SIGNATURE_HEADER] = signHookBody(hook.secret, body);
  const started = Date.now();
  const signal = AbortSignal.timeout(hook.timeoutMs);
  let response: Response;
  try {
    // A fake fetch is the test seam. The real client connects to the address we already approved.
    response =
      fetchImpl === fetch
        ? await pinnedHookRequest(target, pin, { headers, body, signal, timeoutMs: hook.timeoutMs })
        : await fetchImpl(url, { method: "POST", headers, body, redirect: "manual", signal });
  } catch (err) {
    if (signal.aborted || (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))) {
      throw new Error("The hook timed out.");
    }
    throw new Error("The hook did not answer.");
  }
  if (response.status >= 300 && response.status < 400) throw new Error("The hook refused a redirect.");
  const text = await readLimited(response, HOOK_BODY_LIMIT);
  const ms = Date.now() - started;
  if (!response.ok) throw new Error(`The hook returned HTTP ${response.status}.`);
  const reply = hook.reply === "chat" ? parseHookReply(text, response.headers.get("content-type") ?? "") : "";
  return { status: response.status, ms, reply };
}

async function pinnedHookRequest(
  target: URL,
  pin: ResolvedAddress,
  init: { headers: Record<string, string>; body: string; signal: AbortSignal; timeoutMs: number },
): Promise<Response> {
  const lib = target.protocol === "https:" ? https : http;
  const headers = { ...init.headers, Host: target.host, "Content-Length": Buffer.byteLength(init.body) };
  const request = lib.request({
    host: pin.address,
    port: target.port || undefined,
    path: `${target.pathname}${target.search}`,
    method: "POST",
    headers,
    servername: normalizeHost(target.hostname),
    lookup: (_hostname, options, callback) => {
      const done = typeof options === "function" ? options : callback;
      done(null, pin.address, pin.family);
    },
  });
  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const fail = (err: Error) => reject(err);
    if (init.signal.aborted) {
      fail(abortError());
      return;
    }
    init.signal.addEventListener("abort", () => request.destroy(abortError()), { once: true });
    request.setTimeout(init.timeoutMs, () => {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      request.destroy(error);
    });
    request.once("error", fail);
    request.once("response", (message) => {
      request.off("error", fail);
      resolve(message);
    });
    request.end(init.body);
  });
  const payload = await readIncoming(response, HOOK_BODY_LIMIT);
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(response.headers)) {
    if (typeof value === "string") responseHeaders.set(key, value);
    else if (Array.isArray(value)) for (const item of value) responseHeaders.append(key, item);
  }
  return new Response(new Uint8Array(payload), { status: response.statusCode ?? 502, headers: responseHeaders });
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function readIncoming(response: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        response.destroy();
        reject(new Error("The hook response was too large."));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => resolve(Buffer.concat(chunks)));
    response.on("error", reject);
  });
}

async function readLimited(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (text.length > limit) throw new Error("The hook response was too large.");
    return text;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    size += step.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("The hook response was too large.");
    }
    chunks.push(step.value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(out);
}
