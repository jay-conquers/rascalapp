import { describe, expect, it } from "vitest";
import {
  decideChat,
  defaultBotFile,
  emptyMemory,
  expandTemplate,
  portalBase,
  validateBotServerUrl,
  type BotFile,
  type ChatLine,
} from "../packages/bot/src/model";
import { channelIdFromJwt, importStreamElements } from "../packages/bot/src/se";
import { chatSubscription, parseChatFrame } from "../packages/bot/src/twitch";

const facts = { title: "Ranked", game: "Valorant", uptime: "2h", followage: "400d" };

function line(text: string, roles: ChatLine["roles"] = ["everyone"]): ChatLine {
  return { messageId: "m1", userId: "7", login: "ace", displayName: "Ace", text, roles };
}

function file(patch: Partial<BotFile> = {}): BotFile {
  return { ...defaultBotFile(), channelLogin: "examplechannel", broadcasterId: "42", ...patch };
}

describe("bot commands, filters, and variables", () => {
  it("answers a command with variables and blocks the cooldown", () => {
    const data = file({
      commands: [
        {
          id: "so",
          name: "so",
          response: "Go see {touser}. {user} used this {count} times. {game} / {random:a|b}",
          enabled: true,
          cooldownSec: 30,
          userCooldownSec: 0,
          level: "everyone",
          aliases: [],
          count: 3,
          platforms: "twitch",
        },
      ],
    });
    const memory = emptyMemory();
    const first = decideChat(data, memory, line("!so coolmod"), 1_000, facts, "bot");
    expect(first.say[0]).toContain("Go see coolmod");
    expect(first.say[0]).toContain("Ace used this 4 times");
    expect(first.say[0]).toContain("Valorant");
    expect(first.countCommandId).toBe("so");
    const second = decideChat(data, memory, line("!so coolmod"), 2_000, facts, "bot");
    expect(second.say).toEqual([]);
  });

  it("enforces user level, links, blacklist, and permit", () => {
    const data = file({
      filters: {
        ...defaultBotFile().filters,
        links: { enabled: true, action: "timeout", timeoutSec: 15 },
        blacklist: [{ word: "slur", action: "ban", timeoutSec: 60 }],
      },
      commands: [
        {
          id: "modonly",
          name: "modonly",
          response: "secret",
          enabled: true,
          cooldownSec: 0,
          userCooldownSec: 0,
          level: "mod",
          aliases: [],
          count: 0,
          platforms: "twitch",
        },
      ],
    });
    const memory = emptyMemory();
    expect(decideChat(data, memory, line("!modonly"), 1_000, facts, "bot").say).toEqual([]);
    expect(decideChat(data, memory, line("!modonly", ["everyone", "mod"]), 1_000, facts, "bot").say).toEqual(["secret"]);
    const link = decideChat(data, memory, line("look https://evil.example"), 1_000, facts, "bot");
    expect(link.deleteMessage).toBe(true);
    expect(link.timeoutSec).toBe(15);
    const banned = decideChat(data, memory, line("a slur here"), 1_000, facts, "bot");
    expect(banned.ban).toBe(true);
    const permit = decideChat(data, memory, line("!permit ace 30", ["everyone", "mod"]), 1_000, facts, "bot");
    expect(permit.permitLogin).toBe("ace");
    const allowed = decideChat(data, memory, line("now https://example.com is fine"), 2_000, facts, "bot");
    expect(allowed.deleteMessage).toBe(false);
  });

  it("expands followage and uptime without printing secrets", () => {
    expect(expandTemplate("live {uptime} {followage}", { user: "Ace", touser: "", count: "1", randomPool: "", facts })).toBe("live 2h 400d");
  });
});

describe("portal address", () => {
  it("uses localhost for Twitch and keeps a public override", () => {
    expect(portalBase("", 4788)).toBe("http://localhost:4788");
    expect(portalBase("https://bot.example.com/", 4788)).toBe("https://bot.example.com");
    expect(validateBotServerUrl("https://rascal.fly.dev/portal")).toBe("https://rascal.fly.dev");
    expect(() => validateBotServerUrl("http://example.com")).toThrow(/https/);
  });
});

describe("streamelements import", () => {
  it("maps commands and timers and reads the channel id from a JWT payload", () => {
    const imported = importStreamElements(
      [{ command: "!hello", response: "Hi ${user}", cooldown: { global: 8, user: 20 }, accessLevel: 250, aliases: ["hi"], count: 4, enabled: true, _id: "abc" }],
      [{ name: "plug", messages: ["Watch {title}"], onlineInterval: 900, chatLines: 3, enabled: true }],
    );
    expect(imported.commands[0]).toMatchObject({ name: "hello", cooldownSec: 8, userCooldownSec: 20, level: "sub", count: 4 });
    expect(imported.timers[0]).toMatchObject({ name: "plug", intervalSec: 900, minChatLines: 3, message: "Watch {title}" });
    const payload = Buffer.from(JSON.stringify({ channel: "a".repeat(24) })).toString("base64url");
    expect(channelIdFromJwt(`header.${payload}.sig`)).toBe("a".repeat(24));
    expect(channelIdFromJwt("not a jwt")).toBe("");
  });
});

describe("twitch chat subscription", () => {
  it("parses an EventSub chat message and builds the subscription body", () => {
    const raw = JSON.stringify({
      metadata: { message_type: "notification", subscription_type: "channel.chat.message" },
      payload: {
        event: {
          broadcaster_user_id: "42",
          chatter_user_id: "7",
          chatter_user_login: "ace",
          chatter_user_name: "Ace",
          message_id: "m1",
          message: { text: "hello" },
          badges: [{ set_id: "moderator" }],
        },
      },
    });
    const frame = parseChatFrame(raw);
    expect(frame.kind).toBe("chat");
    if (frame.kind === "chat") {
      expect(frame.line.roles).toContain("mod");
      expect(frame.broadcasterId).toBe("42");
    }
    expect(chatSubscription("session", "42", "99")).toMatchObject({
      type: "channel.chat.message",
      condition: { broadcaster_user_id: "42", user_id: "99" },
    });
  });
});
