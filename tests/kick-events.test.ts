import { describe, expect, it } from "vitest";
import { kickTimeoutMinutes, mapKickChatEvent, mapKickLiveEvent, mapKickModerationEvent, kickLineToNormalized } from "../src/shared/kick/events";
import { kickRelayStatus, normalizeRelayUrl } from "../src/shared/kick/protocol";
import { pemFromPublicKeyBody } from "../src/shared/kick/signature";

const chat = {
  message_id: "unique_message_id_123",
  broadcaster: {
    user_id: 123456789,
    username: "broadcaster_name",
    channel_slug: "broadcaster_channel",
  },
  sender: {
    user_id: 987654321,
    username: "sender_name",
    channel_slug: "sender_channel",
    identity: {
      username_color: "#FF5733",
      badges: [
        { text: "Moderator", type: "moderator" },
        { text: "Subscriber", type: "subscriber", count: 3 },
      ],
    },
  },
  content: "Hello [emote:4148074:HYPERCLAP] [emote:37226:KEKW]",
  created_at: "2025-01-14T16:08:06Z",
};

describe("Kick chat events", () => {
  it("maps a chat webhook into the shared chat line", () => {
    const line = mapKickChatEvent(chat);
    expect(line).toMatchObject({
      messageId: "unique_message_id_123",
      channelId: "123456789",
      channelSlug: "broadcaster_channel",
      text: "Hello HYPERCLAP KEKW",
      color: "#FF5733",
      user: {
        id: "987654321",
        login: "sender_name",
        displayName: "sender_name",
        roles: ["everyone", "mod", "sub"],
      },
    });
    expect(line?.emotes.map((emote) => emote.url)).toEqual([
      "https://files.kick.com/emotes/4148074/fullsize",
      "https://files.kick.com/emotes/37226/fullsize",
    ]);
    expect(kickLineToNormalized(line!).platform).toBe("kick");
    expect(kickLineToNormalized(line!).text).toBe("Hello HYPERCLAP KEKW");
  });

  it("marks the broadcaster and ignores an empty message", () => {
    const line = mapKickChatEvent({
      ...chat,
      sender: { user_id: 123456789, username: "broadcaster_name", identity: null },
      content: "going live",
    });
    expect(line?.user.roles).toContain("broadcaster");
    expect(mapKickChatEvent({ ...chat, content: "   " })).toBeNull();
    expect(mapKickChatEvent(null)).toBeNull();
  });

  it("maps a ban, a timeout, and a live update", () => {
    expect(
      mapKickModerationEvent({
        broadcaster: { user_id: 5, username: "host", channel_slug: "host" },
        moderator: { username: "mod" },
        banned_user: { user_id: 9, username: "viewer" },
        metadata: { reason: "spam", created_at: "2025-01-14T16:08:05Z", expires_at: null },
      }),
    ).toMatchObject({ action: "ban", actor: "mod", target: "viewer", targetId: "9", durationSeconds: null, reason: "spam" });
    const timeout = mapKickModerationEvent({
      broadcaster: { user_id: 5, channel_slug: "host" },
      moderator: { username: "mod" },
      banned_user: { user_id: 9, username: "viewer" },
      metadata: { reason: "", created_at: "2025-01-14T16:08:05Z", expires_at: "2025-01-14T16:10:05Z" },
    });
    expect(timeout).toMatchObject({ action: "timeout", durationSeconds: 120 });
    expect(mapKickLiveEvent({ is_live: true, title: "Ranked", broadcaster: { user_id: 5, channel_slug: "host" } })).toEqual({
      live: true,
      title: "Ranked",
      broadcasterId: "5",
      channelSlug: "host",
    });
    expect(mapKickLiveEvent({})).toBeNull();
  });

  it("rounds Kick timeouts up to a minute and stops at 7 days", () => {
    expect(kickTimeoutMinutes(1)).toBe(1);
    expect(kickTimeoutMinutes(60)).toBe(1);
    expect(kickTimeoutMinutes(61)).toBe(2);
    expect(kickTimeoutMinutes(10_080 * 60)).toBe(10_080);
    expect(() => kickTimeoutMinutes(10_080 * 60 + 1)).toThrow(/7 days/);
    expect(() => kickTimeoutMinutes(0)).toThrow(/1 second/);
  });
});

describe("relay address", () => {
  it("keeps a local ws address and rejects a secret in the URL", () => {
    expect(normalizeRelayUrl("ws://127.0.0.1:8790")).toBe("ws://127.0.0.1:8790/v1/events");
    expect(normalizeRelayUrl("wss://relay.example.com/v1/events")).toBe("wss://relay.example.com/v1/events");
    expect(() => normalizeRelayUrl("ws://relay.example.com/v1/events")).toThrow(/wss/);
    expect(() => normalizeRelayUrl("wss://relay.example.com/v1/events?token=secret")).toThrow(/query string/);
    expect(kickRelayStatus({ relayUrl: "", secretSet: false, detail: "" })).toBe("No relay configured");
    expect(kickRelayStatus({ relayUrl: "wss://relay.example.com/v1/events", secretSet: false, detail: "connected" })).toBe(
      "No relay configured",
    );
    expect(kickRelayStatus({ relayUrl: "wss://relay.example.com/v1/events", secretSet: true, detail: "Relay connected" })).toBe(
      "Relay connected",
    );
  });

  it("reads the public key from JSON or a PEM body", () => {
    expect(pemFromPublicKeyBody('{"data":{"public_key":"-----BEGIN PUBLIC KEY-----\\nABC\\n-----END PUBLIC KEY-----"}}')).toBe(
      "-----BEGIN PUBLIC KEY-----\nABC\n-----END PUBLIC KEY-----",
    );
    expect(pemFromPublicKeyBody("-----BEGIN PUBLIC KEY-----\nABC\n-----END PUBLIC KEY-----")).toContain("BEGIN PUBLIC KEY");
    expect(pemFromPublicKeyBody("nope")).toBe("");
  });
});
