import { describe, expect, it } from "vitest";
import { TwitchChatPlatform } from "../packages/bot/src/platform/twitch-adapter";
import { YoutubeChatPlatform } from "../packages/bot/src/platform/youtube-adapter";
import type { BotTokens } from "../packages/bot/src/store";

const tokens: BotTokens = {
  clientId: "client",
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: Date.now() + 3_600_000,
  scopes: [],
  userId: "7",
  login: "rascalbot",
};

describe("chat platform adapters", () => {
  it("lets Twitch timers run only when a posting account exists", () => {
    let session: BotTokens | null = null;
    const platform = new TwitchChatPlatform({
      helix: {} as never,
      clientId: () => "",
      accessToken: async () => "",
      broadcasterId: () => "42",
      botUserId: () => session?.userId ?? "",
      botLogin: () => session?.login ?? "",
      fetchImpl: fetch,
      log: () => undefined,
      onBroadcasterId: () => undefined,
      session: () => session,
      channelLogin: () => "examplechannel",
      accountMode: () => "bot",
    });
    expect(platform.acceptsTimers()).toBe(false);
    expect(platform.postingIdentity()).toBeNull();
    session = tokens;
    expect(platform.acceptsTimers()).toBe(true);
    expect(platform.hookSubject()).toMatchObject({ channel: "examplechannel", botLogin: "rascalbot", broadcasterId: "42" });
    expect(platform.echoIds().botUserId).toBe("7");
  });

  it("lets YouTube timers run only while the broadcast is live", async () => {
    const platform = new YoutubeChatPlatform({
      ownReader: false,
      hasToken: () => false,
      optIn: () => false,
      accessToken: async () => "token",
      channelId: () => "UCexamplechannel00000001",
      fetchImpl: async () => new Response("{}", { status: 500 }),
      discoverVideo: async () => null,
      log: () => undefined,
      session: () => null,
    });
    expect(platform.acceptsTimers()).toBe(false);
    expect(await platform.builtinLookup("shoutout", "ace", "Mod")).toBe("");
    platform.setLive({ live: true, title: "Ranked" });
    expect(platform.acceptsTimers()).toBe(true);
    expect(platform.currentFacts()).toMatchObject({ title: "Ranked", uptime: "live", game: "" });
    expect(platform.hookSubject().channel).toBe("UCexamplechannel00000001");
    expect(platform.echoIds().channel).toBe("");
  });
});
