import tls from "node:tls";
import { describe, expect, it } from "vitest";
import { IrcFramer, parseIrcLine } from "../src/shared/parsers/twitch-irc";
import { detectLive } from "../src/main/youtube/live";

import { readBrandEnv } from "../src/shared/brand";

const enabled = readBrandEnv("LIVE") === "1";
const liveChannel = readBrandEnv("LIVE_CHANNEL") || "";
const liveYoutube = readBrandEnv("LIVE_YOUTUBE") || "";

describe.skipIf(!enabled)("live services", () => {
  it.skipIf(!liveChannel)("joins Twitch IRC anonymously and reads a server line", async () => {
    const lines = await readIrc(liveChannel);
    expect(lines.some((line) => line.type === "welcome" || line.type === "roomstate" || line.type === "privmsg")).toBe(
      true,
    );
  }, 25_000);

  it.skipIf(!liveYoutube)("loads the YouTube live page without throwing", async () => {
    const live = await detectLive(liveYoutube, fetch);
    expect(live === null || typeof live.videoId === "string").toBe(true);
    console.log(JSON.stringify({ youtube: live }));
  }, 25_000);
});

function readIrc(channel: string): Promise<{ type: string }[]> {
  return new Promise((resolve, reject) => {
    const events: { type: string }[] = [];
    const framer = new IrcFramer();
    const socket = tls.connect({ host: "irc.chat.twitch.tv", port: 6697, servername: "irc.chat.twitch.tv" });
    const timer = setTimeout(() => finish(new Error("timed out waiting for Twitch IRC")), 20_000);
    const finish = (err?: Error) => {
      clearTimeout(timer);
      socket.destroy();
      if (err && events.length === 0) reject(err);
      else resolve(events);
    };
    socket.once("secureConnect", () => {
      socket.write("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n");
      socket.write("PASS SCHMOOPIIE\r\n");
      socket.write(`NICK justinfan${Math.floor(10_000 + Math.random() * 89_999)}\r\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      for (const line of framer.push(chunk.toString("utf8"))) {
        const event = parseIrcLine(line);
        events.push({ type: event.type });
        if (event.type === "welcome") socket.write(`JOIN #${channel}\r\n`);
        if (event.type === "roomstate" || event.type === "privmsg") finish();
      }
    });
    socket.once("error", (err) => finish(err));
  });
}
