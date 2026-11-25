import { describe, expect, it } from "vitest";
import { ChatBus } from "../src/main/chat-bus";
import { placeNotice } from "../src/shared/feed-toggles";
import { chatFromNotification } from "../src/shared/parsers/eventsub-events";
import { parseIrcLine } from "../src/shared/parsers/twitch-irc";
import { indexChannelEmotes } from "../src/shared/twitch-emotes";
import { applyWordEmotes } from "../src/shared/word-emotes";
import { defaultChatOverlayFile, projectChatOverlay } from "../src/shared/chat-overlay";
import type { ChatMessage } from "../src/shared/types";

const EMOTE = "jaycon2Eggjay";
const EMOTE_ID = "emotesv2_abc123";
const EMOTE_URL = `https://static-cdn.jtvnw.net/emoticons/v2/${EMOTE_ID}/default/dark/2.0`;

const RESUB = `@badge-info=subscriber/6;badges=subscriber/6;color=#FF0000;display-name=threetimestold;emotes=${EMOTE_ID}:0-12,14-26;id=resub-1;login=threetimestold;msg-id=resub;system-msg=threetimestold\\ssubscribed\\sat\\sTier\\s1;tmi-sent-ts=1700000000000;user-id=42 :tmi.twitch.tv USERNOTICE #jayconquers :${EMOTE} ${EMOTE}`;

describe("channel emotes on a resub", () => {
  it("renders emotesv2 ids from the USERNOTICE emotes tag", () => {
    const message = parseIrcLine(RESUB).message;
    expect(message?.noticeKind).toBe("resub");
    expect(message?.username).toBe("threetimestold");
    expect(message?.segments.filter((segment) => segment.type === "emote")).toEqual([
      { type: "emote", text: EMOTE, url: EMOTE_URL, source: "twitch" },
      { type: "emote", text: EMOTE, url: EMOTE_URL, source: "twitch" },
    ]);
    const priv = parseIrcLine(
      `@emotes=${EMOTE_ID}:0-12;id=msg-9;display-name=threetimestold;login=threetimestold :threetimestold!threetimestold@threetimestold.tmi.twitch.tv PRIVMSG #jayconquers :${EMOTE}`,
    );
    expect(priv.message?.segments[0]).toMatchObject({ type: "emote", text: EMOTE, url: EMOTE_URL });
  });

  it("renders the same word from the Helix channel set when the emotes tag is missing", () => {
    const bare = RESUB.replace(`emotes=${EMOTE_ID}:0-12,14-26;`, "emotes=;");
    const message = parseIrcLine(bare).message;
    expect(message?.segments.every((segment) => segment.type === "text")).toBe(true);
    const catalog = indexChannelEmotes({
      data: [
        {
          id: EMOTE_ID,
          name: EMOTE,
          emote_type: "subscriptions",
          images: { url_1x: `https://static-cdn.jtvnw.net/emoticons/v2/${EMOTE_ID}/static/light/1.0` },
        },
        { id: "../nope", name: "<img>", images: { url_1x: "https://evil.example/x.png" } },
      ],
    });
    const segments = applyWordEmotes(message?.segments ?? [], catalog);
    expect(segments.filter((segment) => segment.type === "emote")).toEqual([
      {
        type: "emote",
        text: EMOTE,
        url: `https://static-cdn.jtvnw.net/emoticons/v2/${EMOTE_ID}/static/light/1.0`,
        source: "twitch",
      },
      {
        type: "emote",
        text: EMOTE,
        url: `https://static-cdn.jtvnw.net/emoticons/v2/${EMOTE_ID}/static/light/1.0`,
        source: "twitch",
      },
    ]);
    expect(catalog.has("<img>")).toBe(false);
  });

  it("renders an EventSub resub fragment and keeps that copy over a plain IRC duplicate", () => {
    const plain = parseIrcLine(RESUB.replace(`emotes=${EMOTE_ID}:0-12,14-26;`, "emotes=;")).message;
    expect(plain).toBeTruthy();
    const rich = chatFromNotification(
      {
        metadata: { message_id: "other-id" },
        payload: {
          event: {
            notice_type: "resub",
            message_id: "other-id",
            chatter_user_id: "42",
            chatter_user_login: "threetimestold",
            chatter_user_name: "threetimestold",
            system_message: "threetimestold subscribed at Tier 1",
            message: {
              text: `${EMOTE} ${EMOTE}`,
              fragments: [
                { type: "emote", text: EMOTE, emote: { id: EMOTE_ID } },
                { type: "text", text: " " },
                { type: "emote", text: EMOTE, emote: { id: EMOTE_ID } },
              ],
            },
            resub: { cumulative_months: 6 },
          },
        },
      },
      "jayconquers",
    );
    expect(rich?.segments.filter((segment) => segment.type === "emote")).toHaveLength(2);
    const placed = placeNotice([plain as ChatMessage], rich as ChatMessage);
    expect(placed.action).toBe("replace");
    if (placed.action !== "replace") return;
    expect(placed.message.segments.some((segment) => segment.type === "emote" && segment.text === EMOTE)).toBe(true);
    expect(placeNotice([placed.message], plain as ChatMessage).action).toBe("drop");

    const lines = projectChatOverlay([placed.message], defaultChatOverlayFile().presets[0]!, placed.message.timestamp);
    expect(lines[0]?.parts.filter((part) => part.type === "emote").map((part) => part.url)).toEqual([EMOTE_URL, EMOTE_URL]);
  });

  it("updates the bus in place so the overlay sees the emote copy", () => {
    const plain = parseIrcLine(RESUB.replace(`emotes=${EMOTE_ID}:0-12,14-26;`, "emotes=;")).message as ChatMessage;
    const rich = { ...plain, id: "eventsub-copy", segments: [{ type: "emote" as const, text: EMOTE, url: EMOTE_URL, source: "twitch" as const }] };
    const bus = new ChatBus();
    const replaced: ChatMessage[] = [];
    bus.setHandlers({
      onMessage: () => undefined,
      onDelete: () => undefined,
      onClear: () => undefined,
      onReplace: (message) => replaced.push(message),
    });
    bus.push(plain);
    const placed = placeNotice(bus.messages, rich);
    expect(placed.action).toBe("replace");
    if (placed.action !== "replace") return;
    bus.replace(placed.id, placed.message);
    expect(bus.messages).toHaveLength(1);
    expect(bus.messages[0]?.segments[0]).toMatchObject({ type: "emote", text: EMOTE });
    expect(replaced[0]?.id).toBe(plain.id);
  });
});
