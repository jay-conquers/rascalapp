import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { startRelay } from "../packages/relay/src/server";
import { readFrames } from "../packages/relay/src/ws";
import { mapKickChatEvent } from "../src/shared/kick/events";
import { openRelaySocket } from "../src/shared/kick/relay-client";
import type { RelayEvent } from "../src/shared/kick/protocol";
import { verifyKickSignature } from "../src/shared/kick/signature";

const SECRET = "relay-secret-for-tests";

function sign(privateKey: KeyObject, messageId: string, timestamp: string, raw: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(`${messageId}.${timestamp}.${raw}`);
  signer.end();
  return signer.sign(privateKey).toString("base64");
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 3000) throw new Error(label);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

describe("Kick relay", () => {
  it("verifies the signature, forwards the event, and drops a bad one", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const relay = await startRelay({ secret: SECRET, publicKeyPem: pem });
    const events: RelayEvent[] = [];
    let ready = false;
    const client = openRelaySocket({
      url: `ws://127.0.0.1:${relay.port}/v1/events`,
      secret: SECRET,
      onReady: () => {
        ready = true;
      },
      onEvent: (event) => events.push(event),
    });
    try {
      await waitFor(() => ready, "relay client did not authenticate");
      const body = {
        message_id: "msg123",
        broadcaster: { user_id: 5, username: "host", channel_slug: "host" },
        sender: { user_id: 9, username: "viewer", identity: { username_color: "#112233", badges: [] } },
        content: "hello from kick",
        created_at: "2025-01-14T16:08:06Z",
      };
      const raw = JSON.stringify(body);
      const timestamp = new Date().toISOString();
      const headers = {
        "Kick-Event-Message-Id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "Kick-Event-Message-Timestamp": timestamp,
        "Kick-Event-Type": "chat.message.sent",
        "Kick-Event-Version": "1",
      };
      const ok = await fetch(`http://127.0.0.1:${relay.port}/webhooks/kick`, {
        method: "POST",
        headers: { ...headers, "Kick-Event-Signature": sign(privateKey, headers["Kick-Event-Message-Id"], timestamp, raw) },
        body: raw,
      });
      expect(ok.status).toBe(204);
      await waitFor(() => events.length === 1, "signed event was not forwarded");
      expect(events[0]).toMatchObject({
        type: "event",
        source: "kick",
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        eventType: "chat.message.sent",
      });
      expect(mapKickChatEvent(events[0]?.body)?.text).toBe("hello from kick");

      const again = await fetch(`http://127.0.0.1:${relay.port}/webhooks/kick`, {
        method: "POST",
        headers: { ...headers, "Kick-Event-Signature": sign(privateKey, headers["Kick-Event-Message-Id"], timestamp, raw) },
        body: raw,
      });
      expect(again.status).toBe(204);
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(events).toHaveLength(1);

      const tampered = await fetch(`http://127.0.0.1:${relay.port}/webhooks/kick`, {
        method: "POST",
        headers: {
          ...headers,
          "Kick-Event-Message-Id": "01ARZ3NDEKTSV4RRFFQ69G5FAW",
          "Kick-Event-Signature": sign(privateKey, "01ARZ3NDEKTSV4RRFFQ69G5FAW", timestamp, raw),
        },
        body: `${raw} `,
      });
      expect(tampered.status).toBe(401);
      const stale = new Date(Date.now() - 10 * 60_000).toISOString();
      const staleId = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
      const old = await fetch(`http://127.0.0.1:${relay.port}/webhooks/kick`, {
        method: "POST",
        headers: {
          ...headers,
          "Kick-Event-Message-Id": staleId,
          "Kick-Event-Message-Timestamp": stale,
          "Kick-Event-Signature": sign(privateKey, staleId, stale, raw),
        },
        body: raw,
      });
      expect(old.status).toBe(401);
      const missing = await fetch(`http://127.0.0.1:${relay.port}/webhooks/kick`, { method: "POST", body: raw });
      expect(missing.status).toBe(400);
      expect(events).toHaveLength(1);

      const health = await fetch(`http://127.0.0.1:${relay.port}/healthz`);
      expect(await health.json()).toEqual({ ok: true, service: "relay" });
    } finally {
      client.close();
      await relay.close();
    }
  });

  it("refuses a socket that does not know the secret", async () => {
    const relay = await startRelay({ secret: SECRET, publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----\n" });
    let closed = false;
    const client = openRelaySocket({
      url: `ws://127.0.0.1:${relay.port}/v1/events`,
      secret: "wrong-secret-value",
      onEvent: () => undefined,
      onClose: () => {
        closed = true;
      },
    });
    try {
      await waitFor(() => closed, "bad secret was accepted");
    } finally {
      client.close();
      await relay.close();
    }
  });

  it("closes an unmasked client frame", async () => {
    expect(() => readFrames(Buffer.from([0x81, 0x02, 0x68, 0x69]))).toThrow(/not masked/);
    expect(() => readFrames(Buffer.from([0xf1, 0x80, 0, 0, 0, 0]))).toThrow(/reserved bits/);
    const maskedPing = Buffer.from([0x89, 0x80 | 126, 0x00, 0x7e, 1, 2, 3, 4]);
    expect(() => readFrames(maskedPing)).toThrow(/control frame/);
    const relay = await startRelay({
      secret: SECRET,
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----\n",
    });
    try {
      const raw = await openRawSocket(relay.port);
      raw.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
      expect(await onceClose(raw)).toBe(true);
    } finally {
      await relay.close();
    }
  });

  it("keeps an authenticated socket open past the HTTP request timeout", async () => {
    const relay = await startRelay({
      secret: SECRET,
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----\n",
      requestTimeoutMs: 50,
    });
    let ready = false;
    let closed = false;
    const client = openRelaySocket({
      url: `ws://127.0.0.1:${relay.port}/v1/events`,
      secret: SECRET,
      onReady: () => {
        ready = true;
      },
      onEvent: () => undefined,
      onClose: () => {
        closed = true;
      },
    });
    try {
      await waitFor(() => ready, "short-timeout relay did not authenticate");
      await new Promise((resolve) => setTimeout(resolve, 180));
      expect(closed).toBe(false);
    } finally {
      client.close();
      await relay.close();
    }
  });

  it("stops accepting sockets once the cap is reached", async () => {
    const relay = await startRelay({
      secret: SECRET,
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----\n",
      maxClients: 1,
    });
    let ready = false;
    const first = openRelaySocket({
      url: `ws://127.0.0.1:${relay.port}/v1/events`,
      secret: SECRET,
      onReady: () => {
        ready = true;
      },
      onEvent: () => undefined,
    });
    try {
      await waitFor(() => ready, "capped relay did not authenticate the first client");
      let rejected = false;
      const second = openRelaySocket({
        url: `ws://127.0.0.1:${relay.port}/v1/events`,
        secret: SECRET,
        onEvent: () => undefined,
        onClose: () => {
          rejected = true;
        },
      });
      try {
        await waitFor(() => rejected, "a socket past the cap was accepted");
      } finally {
        second.close();
      }
    } finally {
      first.close();
      await relay.close();
    }
  });

  it("does not fetch a new public key for every bad signature", async () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    let fetches = 0;
    let clock = Date.parse("2026-11-26T12:00:00.000Z");
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return new Response(JSON.stringify({ data: { public_key: pem.replace(/\n/g, "\\n") } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const relay = await startRelay({ secret: SECRET, fetchImpl, now: () => clock });
    const post = () =>
      fetch(`http://127.0.0.1:${relay.port}/webhooks/kick`, {
        method: "POST",
        headers: {
          "Kick-Event-Message-Id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          "Kick-Event-Message-Timestamp": new Date(clock).toISOString(),
          "Kick-Event-Signature": Buffer.alloc(64, 3).toString("base64"),
        },
        body: "{}",
      });
    try {
      expect((await post()).status).toBe(401);
      expect((await post()).status).toBe(401);
      expect(fetches).toBe(1);
      clock += 60_000;
      expect((await post()).status).toBe(401);
      expect(fetches).toBe(2);
      const missing = await fetch(`http://127.0.0.1:${relay.port}/webhooks/kick`, { method: "POST", body: "{}" });
      expect(missing.status).toBe(400);
      const huge = await fetch(`http://127.0.0.1:${relay.port}/webhooks/kick`, {
        method: "POST",
        headers: {
          "Kick-Event-Message-Id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          "Kick-Event-Message-Timestamp": new Date(clock).toISOString(),
          "Kick-Event-Signature": Buffer.alloc(64, 3).toString("base64"),
        },
        body: "x".repeat(1_000_001),
      });
      expect(huge.status).toBe(413);
    } finally {
      await relay.close();
    }
  });

  it("rejects a signature key that is not RSA", () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(
      verifyKickSignature({
        publicKeyPem: pem,
        messageId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        timestamp: new Date().toISOString(),
        rawBody: "{}",
        signature: Buffer.alloc(64, 1).toString("base64"),
      }),
    ).toBe(false);
  });
});

function openRawSocket(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      const key = Buffer.from("1234567890123456").toString("base64");
      socket.write(
        `GET /v1/events HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    socket.once("error", reject);
    socket.once("data", () => resolve(socket));
  });
}

function onceClose(socket: net.Socket): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 1000);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
