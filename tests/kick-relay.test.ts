import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { startRelay } from "../packages/relay/src/server";
import { mapKickChatEvent } from "../src/shared/kick/events";
import { openRelaySocket } from "../src/shared/kick/relay-client";
import type { RelayEvent } from "../src/shared/kick/protocol";

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
});
