import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { startHttp } from "../../packages/bot/src/http";
import { BotService } from "../../packages/bot/src/service";
import { BotStore } from "../../packages/bot/src/store";
import { normalizeYoutubeReaderMessage } from "../../src/shared/platform/normalize";
import type { NormalizedChatMessage } from "../../src/shared/platform/types";
import { FakeSocket, notificationFrame, welcomeFrame } from "./fake-socket";
import { fetchRouter, json, noContent, type FetchHandler, type RecordedRequest } from "./fetch-router";

/**
 * Black-box harness for the bot service. Everything goes through the service's public
 * methods, a fake WebSocket for Twitch EventSub chat, and a recording fetch.
 * This is the only test file that knows where the bot's modules live.
 */
export { BotService, BotStore, startHttp };

export const CLIENT_ID = "client1234567890";
export const CHANNEL = "examplechannel";
export const BROADCASTER_ID = "42";
export const BOT_LOGIN = "rascalbot";
export const BOT_USER_ID = "900";
export const YT_CHANNEL = "UCexamplechannel00000001";
export const YT_BOT_CHANNEL = "UCrascalbotchannel000001";
export const YT_VIDEO = "liveVideo01";
export const YT_CHAT = "live-chat-1";

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  created_at: string;
}

export interface FakeApis {
  live: boolean;
  title: string;
  game: string;
  users: Record<string, TwitchUser>;
  follows: Record<string, string>;
  hookReply: string;
}

export function tempDir(prefix = "rascal-char-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeJson(dir: string, name: string, value: unknown): void {
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson(dir: string, name: string): any {
  return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
}

export function twitchBotTokens(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: CLIENT_ID,
    accessToken: "bot-access-TESTTOKEN",
    refreshToken: "bot-refresh-TESTTOKEN",
    expiresAt: Date.now() + 24 * 3600_000,
    scopes: ["user:read:chat", "user:write:chat", "user:bot", "moderator:manage:chat_messages", "moderator:manage:banned_users", "moderator:read:followers", "moderator:manage:shoutouts"],
    userId: BOT_USER_ID,
    login: BOT_LOGIN,
    ...patch,
  };
}

export function youtubeBotTokens(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: "google-client.apps.googleusercontent.com",
    accessToken: "ya29.YTBOTTOKEN",
    refreshToken: "yt-refresh-TESTTOKEN",
    expiresAt: Date.now() + 24 * 3600_000,
    scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"],
    channelId: YT_BOT_CHANNEL,
    title: "Rascal Bot",
    ...patch,
  };
}

export function defaultApis(patch: Partial<FakeApis> = {}): FakeApis {
  return {
    live: true,
    title: "Ranked grind",
    game: "Valorant",
    users: {
      ace: { id: "7", login: "ace", display_name: "Ace", created_at: "2020-01-01T00:00:00Z" },
      coolmod: { id: "8", login: "coolmod", display_name: "CoolMod", created_at: "2019-05-01T00:00:00Z" },
      troll: { id: "666", login: "troll", display_name: "Troll", created_at: "2026-11-01T00:00:00Z" },
      friend: { id: "55", login: "friend", display_name: "Friend", created_at: "2018-02-03T00:00:00Z" },
    },
    follows: { "7": "2024-01-01T00:00:00Z" },
    hookReply: "it is noon",
    ...patch,
  };
}

/** Helix, the YouTube Data API, Google OAuth, StreamElements, and a hook endpoint. */
export function fakeApiHandler(state: FakeApis, extra?: FetchHandler): FetchHandler {
  return async (request) => {
    const fromExtra = extra ? await extra(request) : undefined;
    if (fromExtra) return fromExtra;
    const { method, where, query } = request;
    if (where === "api.twitch.tv/helix/eventsub/subscriptions" && method === "POST") return json({ data: [{ status: "enabled" }] }, 202);
    if (where === "api.twitch.tv/helix/channels" && method === "GET") {
      return json({ data: [{ broadcaster_id: query.get("broadcaster_id"), title: state.title, game_name: state.game }] });
    }
    if (where === "api.twitch.tv/helix/streams" && method === "GET") {
      return json({ data: state.live ? [{ started_at: new Date(Date.now() - 2 * 3600_000).toISOString(), viewer_count: 12 }] : [] });
    }
    if (where === "api.twitch.tv/helix/channels/followers") {
      const at = state.follows[query.get("user_id") ?? ""];
      return json({ data: at ? [{ followed_at: at }] : [] });
    }
    if (where === "api.twitch.tv/helix/users") {
      const user = state.users[(query.get("login") ?? "").toLowerCase()];
      return json({ data: user ? [user] : [] });
    }
    if (where === "api.twitch.tv/helix/chat/messages" && method === "POST") return json({ data: [{ message_id: "sent", is_sent: true }] });
    if (where === "api.twitch.tv/helix/moderation/chat" && method === "DELETE") return noContent();
    if (where === "api.twitch.tv/helix/moderation/bans" && method === "POST") return json({ data: [{}] });
    if (where === "api.twitch.tv/helix/moderation/bans" && method === "DELETE") return noContent();
    if (where === "api.twitch.tv/helix/chat/shoutouts" && method === "POST") return noContent();
    if (where === "www.googleapis.com/youtube/v3/liveBroadcasts") {
      return json({ items: [{ id: YT_VIDEO, snippet: { title: "YouTube live", liveChatId: YT_CHAT }, status: { lifeCycleStatus: "live" } }] });
    }
    if (where === "www.googleapis.com/youtube/v3/videos") {
      return json({ items: [{ id: query.get("id"), snippet: { title: "YouTube live" }, liveStreamingDetails: { activeLiveChatId: YT_CHAT } }] });
    }
    if (where === "www.googleapis.com/youtube/v3/liveChat/messages" && method === "POST") return json({ id: "yt-sent" });
    if (where === "www.googleapis.com/youtube/v3/liveChat/messages" && method === "DELETE") return noContent();
    if (where === "www.googleapis.com/youtube/v3/liveChat/bans" && method === "POST") return json({ id: "yt-ban-1" });
    if (where === "www.googleapis.com/youtube/v3/liveChat/bans" && method === "DELETE") return noContent();
    if (where === "www.googleapis.com/youtube/v3/channels") return json({ items: [{ id: YT_BOT_CHANNEL, snippet: { title: "Rascal Bot" } }] });
    if (where === "oauth2.googleapis.com/token") {
      return json({ access_token: "ya29.NEWTOKEN", refresh_token: "yt-refresh-NEW", expires_in: 3600, scope: "https://www.googleapis.com/auth/youtube.force-ssl" });
    }
    if (where === "hooks.example/in" && method === "POST") return json({ reply: state.hookReply });
    return undefined;
  };
}

export interface BotFixture {
  dir: string;
  service: BotService;
  fetchImpl: typeof fetch;
  calls: RecordedRequest[];
  logs: string[];
  apis: FakeApis;
  /** Requests whose host and path match, in order. */
  sent(where: string, method?: string): RecordedRequest[];
  twitchSays(): string[];
  youtubeSays(): string[];
  stop(): void;
}

export function createBot(options: {
  config?: Record<string, unknown>;
  twitch?: boolean;
  youtube?: boolean;
  apis?: Partial<FakeApis>;
  extra?: FetchHandler;
  files?: Record<string, unknown>;
  youtubeReader?: "external" | "own";
} = {}): BotFixture {
  const dir = tempDir();
  writeJson(dir, "bot.json", {
    channelLogin: CHANNEL,
    broadcasterId: BROADCASTER_ID,
    youtubeChannelId: YT_CHANNEL,
    ...(options.config ?? {}),
  });
  if (options.twitch !== false) writeJson(dir, "bot-tokens.json", twitchBotTokens());
  if (options.youtube) {
    writeJson(dir, "bot-youtube-tokens.json", youtubeBotTokens());
    writeJson(dir, "google-client.json", { clientId: "google-client.apps.googleusercontent.com", clientSecret: "google-secret-TEST" });
  }
  for (const [name, value] of Object.entries(options.files ?? {})) writeJson(dir, name, value);
  const apis = defaultApis(options.apis);
  const { fetchImpl, calls } = fetchRouter(fakeApiHandler(apis, options.extra));
  const logs: string[] = [];
  const service = new BotService(new BotStore(dir), {
    clientId: () => CLIENT_ID,
    fetchImpl,
    log: (level, message, extra) => logs.push(`${level} ${message} ${JSON.stringify(extra ?? {})}`),
    youtubeReader: options.youtubeReader ?? "external",
  });
  const sent = (where: string, method?: string) => calls.filter((call) => call.where === where && (!method || call.method === method));
  return {
    dir,
    service,
    fetchImpl,
    calls,
    logs,
    apis,
    sent,
    twitchSays: () => sent("api.twitch.tv/helix/chat/messages", "POST").map((call) => (JSON.parse(call.body) as { message: string }).message),
    youtubeSays: () =>
      sent("www.googleapis.com/youtube/v3/liveChat/messages", "POST").map(
        (call) => (JSON.parse(call.body) as { snippet: { textMessageDetails: { messageText: string } } }).snippet.textMessageDetails.messageText,
      ),
    stop: () => service.stop(),
  };
}

/** Swap in the fake socket and open the bot's Twitch EventSub chat session. */
export async function connectTwitch(bot: BotFixture): Promise<FakeSocket> {
  vi.stubGlobal("WebSocket", FakeSocket);
  await bot.service.connect();
  const socket = FakeSocket.latest();
  socket.receive(welcomeFrame("session-1"));
  return socket;
}

let messageSeq = 0;

export function twitchChat(input: { login: string; userId: string; text: string; name?: string; badges?: string[]; messageId?: string }): unknown {
  messageSeq += 1;
  return notificationFrame("channel.chat.message", {
    broadcaster_user_id: BROADCASTER_ID,
    broadcaster_user_login: CHANNEL,
    chatter_user_id: input.userId,
    chatter_user_login: input.login,
    chatter_user_name: input.name ?? input.login,
    message_id: input.messageId ?? `tw-${messageSeq}`,
    message: { text: input.text, fragments: [{ type: "text", text: input.text }] },
    badges: (input.badges ?? []).map((set_id) => ({ set_id, id: "1", info: "" })),
  });
}

/** A YouTube page-reader line, normalized the way the desk hands it to the embedded bot. */
export function youtubeMessage(input: { authorId: string; name: string; text: string; badges?: string[]; id?: string; timestamp?: number }): NormalizedChatMessage {
  messageSeq += 1;
  const message = normalizeYoutubeReaderMessage({
    id: input.id ?? `yt-${messageSeq}`,
    authorId: input.authorId,
    username: input.name,
    displayName: input.name,
    plainText: input.text,
    timestamp: input.timestamp ?? Date.now(),
    badges: (input.badges ?? []).map((kind) => ({ kind })),
    channel: YT_CHANNEL,
  });
  if (!message) throw new Error("That YouTube line did not normalize.");
  return message;
}
