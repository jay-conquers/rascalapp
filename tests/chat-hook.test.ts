import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BotView } from "../src/renderer/components/BotView";
import { callChatHook, signHookBody } from "../packages/bot/src/chat-hook-send";
import {
  buildHookPayload,
  checkHookUrl,
  decideChatHook,
  normalizeHook,
  parseHookReply,
  redactHookUrl,
  type ChatHook,
} from "../packages/bot/src/chat-hook";
import { emptyMemory, type ChatLine } from "../packages/bot/src/model";
import { BotService } from "../packages/bot/src/service";
import { BotStore } from "../packages/bot/src/store";

const gate = {
  platform: "twitch",
  channel: "mychannel",
  botUserId: "bot-id",
  botLogin: "rascalbot",
  channelLogin: "mychannel",
  broadcasterId: "42",
  publishedAt: 1_000,
  duplicate: false,
};

function hook(patch: Partial<ChatHook> = {}): ChatHook {
  const base = normalizeHook({
    name: "reader",
    trigger: "!ask",
    url: "https://hooks.example/in",
    secret: "topsecret",
    enabled: true,
    cooldownSec: 10,
    userCooldownSec: 0,
    level: "everyone",
    reply: "chat",
  });
  if (!base) throw new Error("hook fixture failed");
  return { ...base, ...patch };
}

function line(text: string, roles: ChatLine["roles"] = ["everyone"], login = "viewer"): ChatLine {
  return { messageId: "m1", userId: login, login, displayName: login, text, roles };
}

describe("chat hook matching", () => {
  it("matches a command and a keyword, then enforces cooldown and role", () => {
    const memory = emptyMemory();
    const data = hook();
    const first = decideChatHook([data], line("!ask hello there"), 5_000, memory, gate);
    expect(first).toMatchObject({ action: "fire", text: "hello there" });
    expect(decideChatHook([data], line("!ask again"), 6_000, memory, gate)).toEqual({ action: "skip", reason: "cooldown" });
    const keyword = hook({ id: "phrase", trigger: "unused", keywords: ["on accident"], cooldownSec: 0 });
    expect(decideChatHook([keyword], line("on accident today"), 5_000, emptyMemory(), gate)).toMatchObject({
      action: "fire",
      text: "today",
    });
    const mods = hook({ level: "mod", cooldownSec: 0 });
    expect(decideChatHook([mods], line("!ask secret"), 5_000, emptyMemory(), gate)).toEqual({ action: "skip", reason: "role" });
    expect(decideChatHook([mods], line("!ask secret", ["everyone", "mod"]), 5_000, emptyMemory(), gate).action).toBe("fire");
  });

  it("skips the streamer, the bot, history, and a duplicate", () => {
    const data = [hook({ cooldownSec: 0 })];
    const memory = emptyMemory();
    expect(decideChatHook(data, line("!ask hi", ["everyone", "broadcaster"], "mychannel"), 5_000, memory, gate).action).toBe("skip");
    expect(decideChatHook(data, line("!ask hi", ["everyone"], "rascalbot"), 5_000, memory, { ...gate, botLogin: "rascalbot" })).toMatchObject({
      reason: "bot",
    });
    expect(decideChatHook(data, line("!ask hi"), 30_000, memory, { ...gate, publishedAt: 1_000 })).toMatchObject({ reason: "backfill" });
    expect(decideChatHook(data, line("!ask hi"), 5_000, memory, { ...gate, duplicate: true })).toMatchObject({ reason: "duplicate" });
  });
});

describe("chat hook delivery", () => {
  it("signs the raw body and parses a json or plain reply", async () => {
    const data = hook({ timeoutMs: 1000 });
    const payload = buildHookPayload(data, line("!ask hello"), "hello", gate, 5_000);
    const body = JSON.stringify(payload);
    expect(signHookBody("topsecret", body)).toBe(`sha256=${createHmac("sha256", "topsecret").update(body).digest("hex")}`);
    let seen = "";
    const fetchImpl: typeof fetch = async (_url, init) => {
      seen = String(new Headers(init?.headers).get("x-rascal-signature"));
      expect(init?.redirect).toBe("manual");
      return new Response(JSON.stringify({ reply: "heard hello" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await callChatHook(data, payload, fetchImpl);
    expect(seen).toBe(signHookBody("topsecret", body));
    expect(result.reply).toBe("heard hello");
    expect(parseHookReply("plain answer", "text/plain")).toBe("plain answer");
    expect(parseHookReply('{"ok":true}', "application/json")).toBe("");
  });

  it("times out, refuses a redirect, and rejects a remote http address", async () => {
    const data = hook({ timeoutMs: 20, secret: "" });
    const payload = buildHookPayload(data, line("!ask hello"), "hello", gate, 5_000);
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    await expect(callChatHook(data, payload, hanging)).rejects.toThrow(/timed out/);
    const redirect: typeof fetch = async () => new Response(null, { status: 302, headers: { location: "https://other.example/steal" } });
    await expect(callChatHook(data, payload, redirect)).rejects.toThrow(/redirect/);
    expect(checkHookUrl("http://example.com/hook")).toBe("");
    expect(checkHookUrl("http://127.0.0.1:8787/hook")).toContain("127.0.0.1:8787");
    expect(checkHookUrl("https://user:pass@hooks.example/in")).toBe("");
    expect(redactHookUrl("https://hooks.example/in?token=secret")).toBe("https://hooks.example/in");
  });

  it("keeps the secret in bot.json and out of the settings snapshot", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-hook-"));
    const logs: string[] = [];
    const service = new BotService(new BotStore(dir), {
      clientId: () => "client",
      log: (_level, message, extra) => logs.push(`${message} ${JSON.stringify(extra ?? {})}`),
    });
    service.saveHook({ name: "reader", trigger: "ask", url: "https://hooks.example/in?token=hide-me", secret: "topsecret", enabled: false });
    const saved = new BotStore(dir).loadConfig().hooks[0];
    expect(saved?.secret).toBe("topsecret");
    expect(service.snapshot(0).hooks[0]).toMatchObject({ secret: "", secretSet: true });
    service.saveHook({ id: saved?.id, name: "reader", trigger: "ask", url: "https://hooks.example/in?token=hide-me", secret: "" });
    expect(new BotStore(dir).loadConfig().hooks[0]?.secret).toBe("topsecret");
    expect(logs.join(" ")).not.toContain("topsecret");
    expect(logs.join(" ")).not.toContain("hide-me");
    expect(JSON.stringify(service.snapshot(0))).not.toContain("topsecret");
  });
});

describe("chat hook settings", () => {
  it("shows the hook form", () => {
    const html = renderToStaticMarkup(createElement(BotView));
    expect(html).toContain("Chat hooks");
    expect(html).toContain('type="password"');
    expect(html).toContain("Save hook");
    expect(html).toContain("press Test");
  });
});
