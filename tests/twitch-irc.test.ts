import { describe, expect, it } from "vitest";
import { ircWireLine } from "../src/main/twitch/irc";
import { IrcFramer, parseIrcLine, unescapeTag } from "../src/shared/parsers/twitch-irc";

const PRIVMSG =
  "@badge-info=subscriber/12;badges=moderator/1,subscriber/12,premium/1;color=#1E90FF;display-name=Cool\\sMod;emotes=25:0-4;id=msg-1;mod=1;room-id=4242;subscriber=1;tmi-sent-ts=1700000000000;turbo=0;user-id=99;user-type=mod :coolmod!coolmod@coolmod.tmi.twitch.tv PRIVMSG #examplechannel :Kappa hello";

describe("twitch irc tags", () => {
  it("unescapes tag values", () => {
    expect(unescapeTag("Cool\\sMod")).toBe("Cool Mod");
    expect(unescapeTag("a\\:b\\\\c\\/d")).toBe("a;b\\c/d");
    expect(unescapeTag("line\\nbreak")).toBe("line\nbreak");
  });

  it("parses a tagged privmsg with badges, colour, and emote ranges", () => {
    const event = parseIrcLine(PRIVMSG);
    expect(event.type).toBe("privmsg");
    expect(event.channel).toBe("examplechannel");
    const message = event.message;
    expect(message).toBeTruthy();
    expect(message?.id).toBe("msg-1");
    expect(message?.displayName).toBe("Cool Mod");
    expect(message?.username).toBe("coolmod");
    expect(message?.authorId).toBe("99");
    expect(message?.color).toBe("#1E90FF");
    expect(message?.timestamp).toBe(1700000000000);
    expect(message?.badges.map((badge) => badge.kind)).toEqual(["mod", "sub", "prime"]);
    expect(message?.badges.find((badge) => badge.kind === "sub")?.detail).toBe("12");
    expect(message?.plainText).toBe("Kappa hello");
    expect(message?.segments).toEqual([
      {
        type: "emote",
        text: "Kappa",
        url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0",
        source: "twitch",
      },
      { type: "text", text: " hello" },
    ]);
  });

  it("parses an action, a vip with a generated colour, and a broadcaster badge", () => {
    const line =
      "@badge-info=;badges=vip/1,broadcaster/1;color=;display-name=Ace;emotes=;id=msg-2;mod=0;subscriber=0;tmi-sent-ts=1700000001000;user-id=7 :ace!ace@ace.tmi.twitch.tv PRIVMSG #examplechannel :\u0001ACTION waves\u0001";
    const message = parseIrcLine(line).message;
    expect(message?.kind).toBe("action");
    expect(message?.plainText).toBe("waves");
    expect(message?.color.startsWith("hsl(")).toBe(true);
    expect(message?.badges.map((badge) => badge.label)).toEqual(["VIP", "HOST"]);
  });

  it("adds a mod badge from the mod flag when the badges tag is empty", () => {
    const line =
      "@badges=;color=#FFFFFF;display-name=Mod;emotes=;id=msg-3;mod=1;tmi-sent-ts=1700000002000 :mod!mod@mod.tmi.twitch.tv PRIVMSG #examplechannel :hey";
    expect(parseIrcLine(line).message?.badges).toEqual([{ kind: "mod", label: "MOD", set: "moderator", version: "1" }]);
  });

  it("parses ping, roomstate, clear, and usernotice lines", () => {
    expect(parseIrcLine("PING :tmi.twitch.tv")).toMatchObject({ type: "ping", pingPayload: "tmi.twitch.tv" });
    expect(parseIrcLine("@room-id=4242 :tmi.twitch.tv ROOMSTATE #examplechannel").roomId).toBe("4242");
    expect(parseIrcLine("@target-msg-id=msg-2 :tmi.twitch.tv CLEARMSG #examplechannel :waves")).toMatchObject({
      type: "clearmsg",
      targetMsgId: "msg-2",
    });
    expect(parseIrcLine(":tmi.twitch.tv CLEARCHAT #examplechannel")).toMatchObject({ type: "clearchat", clearAll: true });
    expect(parseIrcLine(":tmi.twitch.tv CLEARCHAT #examplechannel :sometroll")).toMatchObject({
      type: "clearchat",
      targetUser: "sometroll",
      clearAll: false,
    });
    const notice = parseIrcLine(
      "@badge-info=subscriber/3;badges=subscriber/3;display-name=Sub;emotes=;id=sub-1;system-msg=Sub\\ssubscribed;tmi-sent-ts=1700000003000 :tmi.twitch.tv USERNOTICE #examplechannel :lets go",
    );
    expect(notice.type).toBe("usernotice");
    expect(notice.message?.notice).toBe("Sub subscribed");
    expect(notice.message?.plainText).toBe("Sub subscribed — lets go");
    expect(notice.message?.segments).toEqual([{ type: "text", text: "lets go" }]);
    expect(parseIrcLine(":tmi.twitch.tv RECONNECT").type).toBe("reconnect");
    expect(parseIrcLine(":tmi.twitch.tv 001 justinfan1 :Welcome, GLHF!").type).toBe("welcome");
  });

  it("reassembles lines split across chunks", () => {
    const framer = new IrcFramer();
    expect(framer.push("PING :tmi")).toEqual([]);
    expect(framer.push(".twitch.tv\r\n:tmi.twitch.tv PONG\n")).toEqual(["PING :tmi.twitch.tv", ":tmi.twitch.tv PONG"]);
  });

  it("ignores overlapping or non-numeric emote indexes", () => {
    const line =
      "@badges=;color=#FFFFFF;display-name=Ace;emotes=25:0-4/nope:6-8/12:2-3;id=msg-4;tmi-sent-ts=1 :ace!ace@ace.tmi.twitch.tv PRIVMSG #examplechannel :Kappa hi";
    const segments = parseIrcLine(line).message?.segments ?? [];
    expect(segments.filter((segment) => segment.type === "emote")).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: "emote", text: "Kappa" });
  });

  it("refuses to write an IRC line that contains another command", () => {
    expect(ircWireLine("PONG :tmi.twitch.tv")).toBe("PONG :tmi.twitch.tv\r\n");
    expect(ircWireLine("PONG :tmi.twitch.tv\r\nPRIVMSG #examplechannel :owned")).toBeNull();
    expect(ircWireLine("JOIN #example\nPART #example")).toBeNull();
  });
});
