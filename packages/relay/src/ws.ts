import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const MAX_FRAME = 1_000_000;

export interface DecodedFrame {
  opcode: number;
  payload: Buffer;
}

export function acceptKey(key: string): string {
  return createHash("sha1").update(key + GUID).digest("base64");
}

/** Server frames are not masked. Clients must mask, and the reader undoes that. */
export function encodeServerFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, payload]);
}

/**
 * Client frames only. An unmasked frame, a reserved bit, a fragmented
 * message, or a control frame over 125 bytes closes the socket.
 */
export function readFrames(buffer: Buffer): { frames: DecodedFrame[]; rest: Buffer } {
  const frames: DecodedFrame[] = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset] ?? 0;
    const second = buffer[offset + 1] ?? 0;
    if ((first & 0x70) !== 0) throw new Error("reserved bits are set");
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    if (!masked) throw new Error("client frame is not masked");
    let length = second & 0x7f;
    let header = 2;
    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      if (length < 126) throw new Error("frame length is not minimal");
      header = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      const big = buffer.readBigUInt64BE(offset + 2);
      if (big > BigInt(MAX_FRAME)) throw new Error("frame too large");
      if (big < BigInt(65536)) throw new Error("frame length is not minimal");
      length = Number(big);
      header = 10;
    }
    if (length > MAX_FRAME) throw new Error("frame too large");
    if ((opcode & 0x8) !== 0 && length > 125) throw new Error("control frame is too large");
    if (!fin || opcode === 0) throw new Error("fragmented frames are not supported");
    if (opcode !== 0x1 && opcode !== 0x2 && opcode !== 0x8 && opcode !== 0x9 && opcode !== 0xa) {
      throw new Error("opcode is not supported");
    }
    const total = header + 4 + length;
    if (offset + total > buffer.length) break;
    const mask = buffer.subarray(offset + header, offset + header + 4);
    const raw = buffer.subarray(offset + header + 4, offset + total);
    const payload = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) payload[index] = (raw[index] ?? 0) ^ (mask[index % 4] ?? 0);
    frames.push({ opcode, payload });
    offset += total;
  }
  return { frames, rest: Buffer.from(buffer.subarray(offset)) };
}
