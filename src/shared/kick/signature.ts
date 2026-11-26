import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";

/** Kick signs `messageId.timestamp.rawBody` with RSA-SHA256 (PKCS#1 v1.5). */
export const KICK_SIGNATURE_TOLERANCE_MS = 5 * 60_000;

export function secretsMatch(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

/** The public-key endpoint returns JSON. A raw PEM body is accepted too. */
export function pemFromPublicKeyBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed) as { data?: { public_key?: unknown }; public_key?: unknown };
      const value = json.data?.public_key ?? json.public_key;
      if (typeof value !== "string") return "";
      return unescapePem(value.trim());
    } catch {
      return "";
    }
  }
  if (trimmed.includes("BEGIN PUBLIC KEY")) return unescapePem(trimmed);
  return "";
}

function unescapePem(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

export function verifyKickSignature(input: {
  publicKeyPem: string;
  messageId: string;
  timestamp: string;
  rawBody: string;
  signature: string;
  now?: number;
  toleranceMs?: number;
}): boolean {
  if (!safeMessageId(input.messageId) || !safeTimestamp(input.timestamp)) return false;
  const sent = Date.parse(input.timestamp);
  if (!Number.isFinite(sent)) return false;
  const now = input.now ?? Date.now();
  const tolerance = input.toleranceMs ?? KICK_SIGNATURE_TOLERANCE_MS;
  if (Math.abs(now - sent) > tolerance) return false;
  try {
    const key = createPublicKey(input.publicKeyPem);
    const signed = Buffer.from(`${input.messageId}.${input.timestamp}.${input.rawBody}`);
    const signature = Buffer.from(input.signature, "base64");
    if (signature.length < 32) return false;
    return verify("sha256", signed, key, signature);
  } catch {
    return false;
  }
}

/** A dot inside the id would let a forged header slide bytes into the body. ULIDs have none. */
function safeMessageId(value: string): boolean {
  return value.length > 0 && value.length <= 80 && !/[^A-Za-z0-9_-]/.test(value);
}

function safeTimestamp(value: string): boolean {
  return value.length > 0 && value.length <= 40 && !/[\r\n]/.test(value);
}
