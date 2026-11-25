import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { BotView } from "../src/renderer/components/BotView";
import {
  decideChat,
  defaultBotFile,
  defaultShoutout,
  defaultThanks,
  emptyMemory,
  expandTemplate,
  normalizeBotFile,
  type BotCommand,
  type BotFile,
  type ChatLine,
} from "../packages/bot/src/model";
import { friendlyDuration } from "../packages/bot/src/duration";
import { importQuoteList } from "../packages/bot/src/quotes";
import { importStreamElements } from "../packages/bot/src/se";
import { migrateSeTemplate } from "../packages/bot/src/template";
import { flushGiftHold, planThankYou } from "../packages/bot/src/thanks";
import { HelixBot } from "../packages/bot/src/twitch";

const facts = { title: "Ranked", game: "Valorant", uptime: "2h", followage: "400d" };

function line(text: string, roles: ChatLine["roles"] = ["everyone"], login = "ace"): ChatLine {
  return { messageId: "m1", userId: login === "bot" ? "bot" : "7", login, displayName: login === "ace" ? "Ace" : login, text, roles };
}

function command(patch: Partial<BotCommand> & Pick<BotCommand, "name" | "response">): BotCommand {
  return {
    id: patch.name,
    enabled: true,
    cooldownSec: 5,
    userCooldownSec: 0,
    level: "everyone",
    aliases: [],
    keywords: [],
    count: 0,
    platforms: "twitch",
    ...patch,
  };
}

function file(commands: BotCommand[], patch: Partial<BotFile> = {}): BotFile {
  return { ...defaultBotFile(), channelLogin: "jaycon2", broadcasterId: "42", commands, ...patch };
}

describe("keyword triggers", () => {
  const data = file([
    command({ name: "alot", response: "a lot*", keywords: ["alot"], cooldownSec: 10 }),
    command({ name: "jinx", response: "jinx!", keywords: ["jinx", "jynx"], cooldownSec: 10 }),
    command({ name: "accident", response: "on purpose", keywords: ["on accident"], cooldownSec: 0 }),
    command({ name: "deez", response: "got em", keywords: ["deez nutz"], cooldownSec: 0 }),
    command({ name: "modword", response: "secret", keywords: ["secretword"], level: "mod", cooldownSec: 0 }),
  ]);

  it("fires on a word or phrase, ignoring case, and not inside another word", () => {
    const memory = emptyMemory();
    expect(decideChat(data, memory, line("that is ALOT of damage"), 1_000, facts, "bot").say).toEqual(["a lot*"]);
    expect(decideChat(data, memory, line("ballot"), 20_000, facts, "bot").say).toEqual([]);
    expect(decideChat(data, memory, line("I did that On Accident today"), 20_000, facts, "bot").say).toEqual(["on purpose"]);
    expect(decideChat(data, memory, line("deez nutz"), 20_000, facts, "bot").say).toEqual(["got em"]);
    expect(decideChat(data, memory, line("JYNX"), 20_000, facts, "bot").say).toEqual(["jinx!"]);
  });

  it("uses the command cooldown and skips the bot account", () => {
    const memory = emptyMemory();
    expect(decideChat(data, memory, line("jinx"), 1_000, facts, "bot").say).toEqual(["jinx!"]);
    expect(decideChat(data, memory, line("jynx again"), 2_000, facts, "bot").say).toEqual([]);
    expect(decideChat(data, memory, line("jinx", ["everyone"], "bot"), 20_000, facts, "bot").say).toEqual([]);
    expect(decideChat(data, memory, line("secretword"), 20_000, facts, "bot").say).toEqual([]);
    expect(decideChat(data, memory, line("secretword", ["everyone", "mod"]), 20_000, facts, "bot").say).toEqual(["secret"]);
  });
});

describe("template variables and StreamElements syntax", () => {
  const ctx = { user: "Ace", touser: "Bee extra", count: "2", randomPool: "", facts, args: ["Bee", "extra"], chatters: ["Ace", "Bee"] };

  it("picks a choice and then expands the variables inside it", () => {
    const template = "{random:{user} is better|{touser} is better}";
    expect(expandTemplate(template, { ...ctx, rng: () => 0 })).toBe("Ace is better");
    expect(expandTemplate(template, { ...ctx, rng: () => 0.9 })).toBe("Bee extra is better");
  });

  it("picks a recent chatter and falls back when nobody qualifies", () => {
    expect(expandTemplate("{random.chatter}", { ...ctx, rng: () => 0.9 })).toBe("Bee");
    expect(expandTemplate("{random.chatter}", { ...ctx, chatters: [] })).toBe("someone");
  });

  it("translates sender, numbered args, and random.pick", () => {
    expect(migrateSeTemplate("$(sender) ${1} ${random.pick 'a' 'b'}")).toBe("{user} {1} {random:a|b}");
    expect(expandTemplate("hi $(sender), you said ${1}", ctx)).toBe("hi Ace, you said Bee");
    expect(expandTemplate("${random.pick '$(sender) wins' 'nope'}", { ...ctx, rng: () => 0 })).toBe("Ace wins");
    expect(expandTemplate("$(touser) $(count)", ctx)).toBe("Bee extra 2");
  });
});

describe("built-in commands", () => {
  it("!cmds lists the same commands as !commands", () => {
    const data = file([command({ name: "hello", response: "hi", cooldownSec: 0 })]);
    const memory = emptyMemory();
    expect(decideChat(data, memory, line("!cmds"), 1_000, facts, "bot").say).toEqual(["Commands: !hello"]);
    expect(decideChat(data, memory, line("!commands"), 1_000, facts, "bot").say).toEqual(["Commands: !hello"]);
  });

  it("asks Helix for followage and account age, defaulting to the sender", () => {
    const data = file([]);
    const self = decideChat(data, emptyMemory(), line("!followage"), 1_000, facts, "bot");
    expect(self.lookup).toEqual({ kind: "followage", login: "ace" });
    const other = decideChat(data, emptyMemory(), line("!howlong @Bee"), 1_000, facts, "bot");
    expect(other.lookup).toEqual({ kind: "followage", login: "bee" });
    const age = decideChat(data, emptyMemory(), line("!accountage Bee"), 1_000, facts, "bot");
    expect(age.lookup).toEqual({ kind: "accountage", login: "bee" });
  });

  it("lets a mod shout out a channel and leaves a viewer's custom !so alone", () => {
    const data = file([command({ name: "so", response: "custom {touser}", cooldownSec: 0 })]);
    const viewer = decideChat(data, emptyMemory(), line("!so coolmod"), 1_000, facts, "bot");
    expect(viewer.say[0]).toContain("custom coolmod");
    expect(viewer.lookup).toBeNull();
    const mod = decideChat(data, emptyMemory(), line("!so CoolMod", ["everyone", "mod"]), 1_000, facts, "bot");
    expect(mod.lookup).toEqual({ kind: "shoutout", login: "coolmod" });
    expect(mod.say).toEqual([]);
    expect(decideChat(data, emptyMemory(), line("!so", ["everyone", "mod"]), 1_000, facts, "bot").say).toEqual(["Usage: !so username"]);
  });

  it("adds, reads, and removes quotes", () => {
    const data = file([]);
    const denied = decideChat(data, emptyMemory(), line("!quote add hello there"), 1_000, facts, "bot");
    expect(denied.say).toEqual(["Only a mod can change quotes."]);
    expect(denied.quotes).toBeNull();
    const added = decideChat(data, emptyMemory(), line("!quote add hello there", ["everyone", "mod"]), 1_000, facts, "bot");
    expect(added.say).toEqual(["Added quote #1."]);
    const withQuote = file([], { quotes: added.quotes ?? [] });
    expect(decideChat(withQuote, emptyMemory(), line("!quote #1"), 1_000, facts, "bot").say[0]).toContain("hello there");
    const removed = decideChat(withQuote, emptyMemory(), line("!quote remove 1", ["everyone", "mod"]), 1_000, facts, "bot");
    expect(removed.say).toEqual(["Removed quote #1."]);
    expect(removed.quotes).toEqual([]);
    const imported = importQuoteList(["one", { text: "two", addedBy: "ace" }], []);
    expect(imported.map((quote) => quote.text)).toEqual(["one", "two"]);
    expect(decideChat(file([], { quotes: imported }), emptyMemory(), line("!quote"), 1_000, facts, "bot", "twitch", { rng: () => 0.9 }).say[0]).toContain("two");
  });
});

describe("chat thank-yous", () => {
  it("stays quiet until that kind is enabled, then combines a gift bomb", () => {
    const off = planThankYou({ thanks: defaultThanks(), kind: "follow", user: "Ace", amount: "", text: "", now: 1_000, hold: null });
    expect(off.say).toBeNull();
    const thanks = defaultThanks();
    thanks.follow.enabled = true;
    thanks.subgift.enabled = true;
    expect(planThankYou({ thanks, kind: "follow", user: "Ace", amount: "", text: "", now: 1_000, hold: null }).say).toBe("Thanks for the follow, Ace!");
    const first = planThankYou({ thanks, kind: "subgift", user: "Ace", amount: "", text: "", now: 1_000, hold: null });
    expect(first.say).toBeNull();
    const second = planThankYou({ thanks, kind: "subgift", user: "Ace", amount: "", text: "", now: 2_000, hold: first.hold });
    expect(second.hold?.count).toBe(2);
    expect(flushGiftHold(thanks, second.hold, 2_000).say).toBeNull();
    expect(flushGiftHold(thanks, second.hold, 6_000).say).toBe("Thanks Ace for gifting 2 subs!");
    const other = planThankYou({ thanks, kind: "subgift", user: "Bee", amount: "", text: "", now: 3_000, hold: second.hold });
    expect(other.say).toBe("Thanks Ace for gifting 2 subs!");
    expect(other.hold?.user).toBe("Bee");
  });
});

describe("durations and helix lookups", () => {
  it("speaks a friendly duration", () => {
    expect(friendlyDuration("2024-01-01T00:00:00Z", Date.parse("2026-04-01T00:00:00Z"))).toBe("2 years and 3 months");
    expect(friendlyDuration("2026-04-01T00:00:00Z", Date.parse("2026-04-01T00:00:30Z"))).toBe("just now");
  });

  it("reads account age, follow time, and a shoutout without failing on an empty success", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      urls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/users?")) {
        return Response.json({ data: [{ id: "9", login: "ace", display_name: "Ace", created_at: "2020-01-01T00:00:00Z" }] });
      }
      if (url.includes("/channels/followers")) return Response.json({ data: [{ followed_at: "2024-01-01T00:00:00Z" }] });
      if (url.includes("/chat/shoutouts")) return new Response(null, { status: 204 });
      return Response.json({ data: [{ title: "Hi", game_name: "Valorant" }] });
    };
    const helix = new HelixBot(() => "client", async () => "token", fetchImpl);
    const user = await helix.userByLogin("ace");
    expect(user).toMatchObject({ id: "9", createdAt: "2020-01-01T00:00:00Z" });
    expect(await helix.followedAt("42", "9")).toBe("2024-01-01T00:00:00Z");
    await helix.shoutout("42", "9", "7");
    expect(urls.some((url) => url.includes("/chat/shoutouts?") && url.includes("from_broadcaster_id=42") && url.includes("to_broadcaster_id=9") && url.includes("moderator_id=7"))).toBe(true);
    const denied: typeof fetch = async () => new Response("no", { status: 403 });
    await expect(new HelixBot(() => "client", async () => "token", denied).shoutout("42", "9", "7")).rejects.toThrow(/403/);
  });
});

describe("saved bot config", () => {
  it("keeps quotes, thank-you templates, and the shoutout line", () => {
    const thanks = defaultThanks();
    thanks.raid = { enabled: true, template: "Welcome {user}" };
    const loaded = normalizeBotFile({
      quotes: [{ id: 4, text: "nice", by: "ace" }],
      thanks,
      shoutout: { template: "Follow {target}", helix: false },
      commands: [{ name: "alot", response: "a lot*", keywords: ["alot", "https://nope"] }],
    });
    expect(loaded.quotes[0]).toMatchObject({ id: 4, text: "nice" });
    expect(loaded.thanks.raid).toEqual({ enabled: true, template: "Welcome {user}" });
    expect(loaded.thanks.follow.enabled).toBe(false);
    expect(loaded.shoutout).toEqual({ template: "Follow {target}", helix: false });
    expect(loaded.commands[0]?.keywords).toEqual(["alot"]);
    expect(defaultShoutout().template).toContain("twitch.tv/{target}");
  });

  it("stores StreamElements phrases as keywords instead of command names", () => {
    const imported = importStreamElements(
      [{ command: "nuts", response: "got em", keywords: ["deez nutz", "deez"], aliases: ["nuts"] }],
      [],
    );
    expect(imported.commands[0]?.keywords).toEqual(["deez nutz", "deez"]);
    expect(imported.commands[0]?.aliases).toEqual([]);
  });
});

describe("bot settings screen", () => {
  it("shows keyword, quote, shoutout, and thank-you controls", () => {
    const html = renderToStaticMarkup(createElement(BotView));
    expect(html).toContain("Keywords");
    expect(html).toContain("Chat thank-yous");
    expect(html).toContain("Shoutout line");
    expect(html).toContain("Import quotes");
    expect(html).toContain("Also send a Twitch shoutout");
  });
});
