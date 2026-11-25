import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NoticeSocket } from "../src/main/twitch/notices";
import { EventSubClient } from "../src/main/redeems/eventsub";
import { defaultFeed } from "../src/shared/feed-toggles";
import { MODERATE_READ_SCOPES } from "../src/shared/scopes";
import type { ChatMessage, ModAction } from "../src/shared/types";
import { FakeSocket, notificationFrame, welcomeFrame } from "./helpers/fake-socket";

const DEFAULT_URL = "wss://eventsub.wss.twitch.tv/ws";

function logSink() {
  const lines: string[] = [];
  return { lines, info: (message: string) => lines.push(`info ${message}`), error: (message: string) => lines.push(`error ${message}`) };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeSocket.reset();
});

type Subscribe = (type: string, version: string, condition: Record<string, string>, sessionId: string) => Promise<void>;

describe("desk notice socket", () => {
  function notices(
    scopes: readonly string[] = [...MODERATE_READ_SCOPES, "user:read:chat", "moderator:read:followers"],
    subscribe: Mock<Subscribe> = vi.fn<Subscribe>(async () => undefined),
  ) {
    const chats: ChatMessage[] = [];
    const actions: ModAction[] = [];
    const problems: string[] = [];
    const log = logSink();
    let channel = "examplechannel";
    const socket = new NoticeSocket({
      auth: () => ({ userId: "42", login: "examplechannel", scopes: [...scopes] }),
      channel: () => channel,
      feed: () => defaultFeed(),
      broadcasterId: async (login) => (login === "otherchannel" ? "77" : "42"),
      subscribe,
      emotes: () => new Map(),
      onChat: (message) => chats.push(message),
      onModAction: (action) => actions.push(action),
      onScopeProblem: (text) => problems.push(text),
      log,
    });
    return { socket, subscribe, chats, actions, problems, log, setChannel: (next: string) => (channel = next) };
  }

  it("subscribes to moderation, notices, and follows for the chat channel after the welcome", async () => {
    const { socket, subscribe } = notices();
    socket.start();
    expect(FakeSocket.latest().url).toBe(DEFAULT_URL);
    FakeSocket.latest().receive(welcomeFrame("sess-1"));
    await flush();
    expect(subscribe.mock.calls).toEqual([
      ["channel.moderate", "2", { broadcaster_user_id: "42", moderator_user_id: "42" }, "sess-1"],
      ["channel.chat.notification", "1", { broadcaster_user_id: "42", user_id: "42" }, "sess-1"],
      ["channel.follow", "2", { broadcaster_user_id: "42", moderator_user_id: "42" }, "sess-1"],
    ]);
    socket.stop();
  });

  it("names missing scopes and skips the subscriptions that need them", async () => {
    const { socket, subscribe, problems } = notices(["user:read:chat"]);
    socket.start();
    FakeSocket.latest().receive(welcomeFrame("sess-1"));
    await flush();
    expect(subscribe.mock.calls.map((callArgs) => callArgs[0])).toEqual(["channel.chat.notification"]);
    expect(problems).toEqual([
      "Log in again to grant the moderator read scopes for the private mod log; moderator:read:followers for new follows. Chat keeps working until you do.",
    ]);
    socket.stop();
  });

  it("turns notifications into chat lines and mod log rows", async () => {
    const { socket, chats, actions, problems } = notices();
    socket.start();
    const live = FakeSocket.latest();
    live.receive(welcomeFrame("sess-1"));
    await flush();
    live.receive(notificationFrame("channel.moderate", { moderator_user_name: "Mod", action: "timeout", timeout: { user_name: "Troll", expires_at: new Date(Date.now() + 600_000).toISOString() } }, { message_id: "m-1" }));
    live.receive(notificationFrame("channel.follow", { user_id: "9", user_login: "ace", user_name: "Ace", followed_at: "2026-11-23T18:00:00Z" }));
    live.receive(notificationFrame("channel.chat.notification", { notice_type: "sub", message_id: "n-1", chatter_user_login: "ace", chatter_user_name: "Ace", system_message: "Ace subscribed", message: { text: "", fragments: [] } }));
    live.receive({ metadata: { message_type: "revocation" } });
    await flush();
    expect(actions.map((action) => action.id)).toEqual(["mod-m-1"]);
    expect(chats.map((message) => message.noticeKind)).toEqual(["follow", "sub"]);
    expect(problems).toEqual(["Twitch revoked a chat or moderation subscription. Log in again to grant it."]);
    socket.stop();
  });

  it("follows a Twitch reconnect url, ignores any other host, and reopens after a missed keepalive", async () => {
    const { socket, log } = notices();
    socket.start();
    FakeSocket.latest().receive(welcomeFrame("sess-1", 10));
    await flush();
    FakeSocket.latest().receive({ metadata: { message_type: "session_reconnect" }, payload: { session: { reconnect_url: "wss://evil.example/ws" } } });
    expect(FakeSocket.instances).toHaveLength(1);
    expect(log.lines).toContain("error ignored eventsub reconnect url");
    FakeSocket.latest().receive({ metadata: { message_type: "session_reconnect" }, payload: { session: { reconnect_url: "wss://eventsub.wss.twitch.tv/ws?id=next" } } });
    expect(FakeSocket.latest().url).toBe("wss://eventsub.wss.twitch.tv/ws?id=next");
    expect(FakeSocket.instances[0]?.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.latest().receive(welcomeFrame("sess-2", 10));
    await flush();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(FakeSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.latest().url).toBe(DEFAULT_URL);
    expect(log.lines).toContain("error notice eventsub keepalive missed");
    socket.stop();
  });

  it("retries a dropped socket with backoff, retargets a new channel, and stays down after stop", async () => {
    const { socket, setChannel } = notices();
    socket.start();
    FakeSocket.latest().drop();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(FakeSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.latest().drop();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(FakeSocket.instances).toHaveLength(3);
    socket.retarget();
    expect(FakeSocket.instances).toHaveLength(3);
    setChannel("otherchannel");
    socket.retarget();
    expect(FakeSocket.instances).toHaveLength(4);
    socket.stop();
    expect(FakeSocket.latest().closed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it("reports a refused subscription and ignores one that already exists", async () => {
    const subscribe = vi.fn<Subscribe>(async (type) => {
      if (type === "channel.moderate") throw new Error("Twitch returned HTTP 409. subscription already exists");
      if (type === "channel.follow") throw new Error("403 Forbidden");
    });
    const { socket, problems } = notices(undefined, subscribe);
    socket.start();
    FakeSocket.latest().receive(welcomeFrame("sess-1"));
    await flush();
    expect(problems).toEqual(["Log in again to grant moderator:read:followers so new follows show in chat."]);
    socket.stop();
  });
});

describe("redemption socket", () => {
  function redemptions(subscribe = vi.fn(async (_sessionId: string) => undefined)) {
    const statuses: string[] = [];
    const redeemed: string[] = [];
    const log = logSink();
    const client = new EventSubClient({
      subscribe,
      onRedemption: (redemption) => redeemed.push(`${redemption.rewardTitle}:${redemption.userName}`),
      onStatus: (detail) => statuses.push(detail),
      log,
    });
    return { client, subscribe, statuses, redeemed, log };
  }

  it("subscribes after the welcome and hands redemptions to the engine", async () => {
    const { client, subscribe, statuses, redeemed, log } = redemptions();
    client.start();
    FakeSocket.latest().receive(welcomeFrame("sess-9"));
    await flush();
    expect(subscribe).toHaveBeenCalledWith("sess-9");
    expect(statuses).toEqual(["Listening for redemptions"]);
    expect(log.lines).toContain("info eventsub redemption subscription ready");
    FakeSocket.latest().receive(
      notificationFrame("channel.channel_points_custom_reward_redemption.add", { id: "r-1", user_name: "Ace", user_input: "", reward: { id: "rw", title: "Hydrate", cost: 50 } }),
    );
    FakeSocket.latest().receive({ metadata: { message_type: "revocation" } });
    expect(redeemed).toEqual(["Hydrate:Ace"]);
    expect(statuses.at(-1)).toBe("Twitch revoked channel point access. Log in again.");
    client.stop();
  });

  it("shows a refused subscription and retries a dropped socket", async () => {
    const { client, statuses, log } = redemptions(vi.fn(async () => {
      throw new Error("Missing scope channel:read:redemptions");
    }));
    client.start();
    FakeSocket.latest().receive(welcomeFrame("sess-9"));
    await flush();
    expect(statuses).toEqual(["Listening for redemptions", "Missing scope channel:read:redemptions"]);
    expect(log.lines).toContain("error eventsub subscribe failed");
    FakeSocket.latest().drop();
    expect(statuses.at(-1)).toBe("Channel points disconnected. Retrying in 2s.");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.latest().receive(welcomeFrame("sess-10", 5));
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances).toHaveLength(3);
    expect(log.lines).toContain("error eventsub keepalive missed");
    client.stop();
  });
});
