import { EMPTY_FACTS, liveFlag, type BotPlatform } from "../../../src/shared/platform/bot-platform.ts";
import { targetsPlatform } from "../../../src/shared/platform/target.ts";
import type { ChatPlatform, NormalizedChatMessage } from "../../../src/shared/platform/types.ts";
import { countTimerLine, decideChat, type BotDecision, type BotFile, type ChatLine } from "./model.ts";
import { buildHookPayload, consumeOutgoing, decideChatHook, noteOutgoing, redactHookUrl } from "./chat-hook.ts";
import { callChatHook } from "./chat-hook-send.ts";
import { hookError, safeError } from "./errors.ts";
import { flushGiftHold, planThankYou, thankKind } from "./thanks.ts";
import { BotEditing } from "./bot-editing.ts";

const CHATTER_MS = 10 * 60_000;
const BOT_NAMES = new Set([
  "streamelements",
  "nightbot",
  "fossabot",
  "moobot",
  "streamlabs",
  "soundalerts",
  "wizebot",
  "sery_bot",
  "commanderroot",
  "botisimo",
  "streamholics",
  "kofistreambot",
  "rainmaker",
  "tangia",
  "own3d",
]);

export class BotChat extends BotEditing {
  noteNotice(input: { platform: string; kind?: string; user: string; amount?: string; text?: string }): void {
    const kind = thankKind(input.kind);
    if (!kind || this.stopped) return;
    const planned = planThankYou({
      thanks: this.file.thanks,
      kind,
      user: input.user,
      amount: input.amount ?? "",
      text: input.text ?? "",
      now: Date.now(),
      hold: this.giftHold,
      facts: this.registry.get("twitch")?.currentFacts() ?? { ...EMPTY_FACTS },
    });
    this.giftHold = planned.hold;
    if (planned.waitMs > 0) this.armGift(planned.waitMs);
    if (planned.say) void this.postBot(input.platform === "youtube" ? "youtube" : "twitch", planned.say);
  }


  protected armGift(waitMs: number): void {
    if (this.giftTimer) clearTimeout(this.giftTimer);
    this.giftTimer = setTimeout(() => {
      this.giftTimer = null;
      const flushed = flushGiftHold(this.file.thanks, this.giftHold, Date.now(), this.registry.get("twitch")?.currentFacts() ?? { ...EMPTY_FACTS }, true);
      this.giftHold = flushed.hold;
      if (flushed.say) void this.postBot("twitch", flushed.say);
    }, waitMs);
    this.giftTimer.unref?.();
  }


  protected async onPlatformMessage(message: NormalizedChatMessage): Promise<void> {
    const platform = this.registry.get(message.platform);
    if (!platform) return;
    const line: ChatLine = {
      messageId: message.messageId,
      userId: message.user.id,
      login: message.user.login,
      displayName: message.user.displayName,
      text: message.text,
      roles: message.user.roles,
    };
    const facts = await platform.factsFor(line.userId);
    const botUserId = platform.postingIdentity()?.userId ?? "";
    const now = Date.now();
    const decision = decideChat(this.file, this.memory, line, now, facts, botUserId, message.platform, { chatters: this.rememberChatter(line, now, botUserId) });
    if (decision.quotes) this.file = this.store.saveConfig({ ...this.file, quotes: decision.quotes });
    if (decision.lookup) {
      const looked = await platform.builtinLookup(decision.lookup.kind, decision.lookup.login, line.displayName);
      if (looked) decision.say.push(looked.slice(0, 450));
    }
    if (decision.countCommandId) {
      const command = this.file.commands.find((item) => item.id === decision.countCommandId);
      if (command) command.count += 1;
      this.file = this.store.saveConfig(this.file);
    }
    if (decision.chatLine) {
      const live = liveFlag(platform.liveStatus());
      this.file.timers = this.file.timers.map((timer) => (targetsPlatform(timer.platforms, message.platform) ? countTimerLine(timer, live) : timer));
    }
    if (decision.log) this.pushLog({ t: Date.now(), ...decision.log });
    const subject = platform.hookSubject();
    const gate = {
      platform: message.platform,
      channel: subject.channel,
      botUserId: subject.botUserId,
      botLogin: subject.botLogin,
      channelLogin: subject.channelLogin,
      broadcasterId: subject.broadcasterId,
      publishedAt: message.publishedAt,
      duplicate: this.rememberHookMessage(message.messageId),
      sentByRascal: this.echoOfOurs(platform, line, now),
    };
    const hookDecision = decideChatHook(this.file.hooks, line, now, this.memory, gate);
    if (hookDecision.action === "fire") void this.dispatchHook(platform, hookDecision.hook, line, hookDecision.text, now, gate);
    await this.execute(platform, decision, line);
  }


  protected rememberHookMessage(id: string): boolean {
    const key = id.trim();
    if (!key) return false;
    if (this.seenHookIds.has(key)) return true;
    this.seenHookIds.add(key);
    if (this.seenHookIds.size > 500) {
      const first = this.seenHookIds.values().next().value;
      if (first) this.seenHookIds.delete(first);
    }
    return false;
  }


  protected async dispatchHook(
    platform: ChatPlatform,
    hook: BotFile["hooks"][number],
    line: ChatLine,
    text: string,
    now: number,
    gate: { platform: string; channel: string; botUserId: string; botLogin: string; channelLogin: string; broadcasterId: string; publishedAt: number; duplicate: boolean },
  ): Promise<void> {
    try {
      const result = await callChatHook(hook, buildHookPayload(hook, line, text, gate, now), this.fetchImpl());
      this.pushLog({ t: Date.now(), action: "hook", user: line.login, text: `${hook.name} HTTP ${result.status} ${result.ms}ms`, by: platform.id });
      if (result.reply && !this.stopped && platform.capabilities.send) await this.say(platform, result.reply);
    } catch (err) {
      const detail = hookError(err);
      this.pushLog({ t: Date.now(), action: "hook", user: line.login, text: `${hook.name} failed: ${detail}`, by: platform.id });
      this.deps.log("error", "chat hook failed", { hook: hook.name, url: redactHookUrl(hook.url), message: detail });
    }
  }


  protected async execute(platform: ChatPlatform, decision: BotDecision, line: ChatLine): Promise<void> {
    try {
      if (decision.deleteMessage) {
        if (platform.capabilities.deleteMessage) await platform.deleteMessage(line.messageId);
        else this.pushLog({ t: Date.now(), action: "unsupported", user: line.login, text: "delete", by: platform.id });
      }
      if (decision.timeoutSec !== null) {
        if (!platform.capabilities.timeout) {
          this.pushLog({ t: Date.now(), action: "unsupported", user: decision.targetLogin, text: "timeout", by: platform.id });
        } else {
          const userId = await this.actionUser(platform, decision, line);
          if (userId) await platform.timeoutUser(userId, decision.timeoutSec, decision.log?.text ?? "");
        }
      }
      if (decision.ban) {
        if (!platform.capabilities.ban) {
          this.pushLog({ t: Date.now(), action: "unsupported", user: decision.targetLogin, text: "ban", by: platform.id });
        } else {
          const userId = await this.actionUser(platform, decision, line);
          if (userId) await platform.banUser(userId, decision.log?.text ?? "");
        }
      }
      if (decision.unban) {
        if (!platform.capabilities.unban) {
          this.pushLog({ t: Date.now(), action: "unsupported", user: decision.targetLogin, text: "unban", by: platform.id });
        } else {
          const userId = await this.actionUser(platform, decision, line);
          if (userId) await platform.unbanUser(userId);
        }
      }
      for (const text of decision.say) {
        if (platform.capabilities.send) await this.say(platform, text);
      }
    } catch (err) {
      this.pushLog({ t: Date.now(), action: "error", user: line.login, text: safeError(err), by: "bot" });
      this.deps.log("error", "bot action failed", { message: safeError(err) });
    }
  }


  protected async say(platform: ChatPlatform, text: string): Promise<void> {
    this.outgoing = noteOutgoing(this.outgoing, platform.id, text, Date.now());
    await platform.sendMessage(text);
  }


  protected echoOfOurs(platform: BotPlatform, line: ChatLine, now: number): boolean {
    const ids = platform.echoIds();
    const login = line.login.toLowerCase();
    const fromAccount =
      (ids.botUserId && line.userId === ids.botUserId) ||
      (ids.broadcasterId && line.userId === ids.broadcasterId) ||
      (ids.channelLogin && login === ids.channelLogin.toLowerCase()) ||
      (ids.botLogin && login === ids.botLogin.toLowerCase()) ||
      line.roles.includes("broadcaster");
    if (!fromAccount) return false;
    const taken = consumeOutgoing(this.outgoing, platform.id, line.text, now);
    this.outgoing = taken.sent;
    return taken.matched;
  }


  protected async postBot(platformId: string, text: string): Promise<void> {
    const platform = this.registry.get(platformId);
    const line = text.trim().slice(0, 450);
    if (!platform?.capabilities.send || !line || this.stopped) return;
    try {
      await this.say(platform, line);
    } catch (err) {
      this.pushLog({ t: Date.now(), action: "error", user: "", text: safeError(err), by: platformId });
    }
  }


  protected rememberChatter(line: ChatLine, now: number, botUserId: string): string[] {
    const login = line.login.toLowerCase();
    const botLogin = (this.registry.get("twitch")?.postingIdentity()?.login ?? "").toLowerCase();
    const channel = this.file.channelLogin.toLowerCase();
    const blocked = !login || line.userId === botUserId || login === channel || login === botLogin || BOT_NAMES.has(login);
    if (!blocked) this.recentChatters.set(login, { name: line.displayName || line.login, at: now });
    const names: string[] = [];
    for (const [key, row] of this.recentChatters) {
      if (now - row.at > CHATTER_MS) this.recentChatters.delete(key);
      else names.push(row.name);
    }
    return names;
  }



  protected async actionUser(platform: ChatPlatform, decision: BotDecision, line: ChatLine): Promise<string> {
    const named = decision.targetLogin && decision.targetLogin.toLowerCase() !== line.login.toLowerCase();
    if (named) return (await platform.lookupUser(decision.targetLogin)) || "";
    return decision.targetUserId || (await platform.lookupUser(decision.targetLogin)) || "";
  }

}
