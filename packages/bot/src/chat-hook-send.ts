import { createHmac } from "node:crypto";
import {
  HOOK_BODY_LIMIT,
  HOOK_SIGNATURE_HEADER,
  checkHookUrl,
  parseHookReply,
  type ChatHook,
  type HookPayload,
} from "./chat-hook.ts";

export interface HookCallResult {
  status: number;
  ms: number;
  reply: string;
}

export function signHookBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function callChatHook(hook: ChatHook, payload: HookPayload, fetchImpl: typeof fetch): Promise<HookCallResult> {
  const url = checkHookUrl(hook.url);
  if (!url) throw new Error("That address is not allowed.");
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/plain" };
  if (hook.secret) headers[HOOK_SIGNATURE_HEADER] = signHookBody(hook.secret, body);
  const started = Date.now();
  const signal = AbortSignal.timeout(hook.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "POST", headers, body, redirect: "manual", signal });
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
