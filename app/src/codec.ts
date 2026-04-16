/**
 * Frame codec for the internal gossip TCP protocol.
 *
 * Frame layout: [Type: 1B] [Length: 4B BE] [Payload: 0..16MB]
 */

export const enum FrameType {
  AUTH = 0x01,
  AUTH_OK = 0x02,
  AUTH_FAIL = 0x03,
  PUSH = 0x10,
  PUSH_ACK = 0x11,
  PULL = 0x20,
  PULL_RESP = 0x21,
  PING = 0x30,
  PONG = 0x31,
}

export const FRAME_HEADER_SIZE = 5; // 1 byte type + 4 bytes length
export const MAX_PAYLOAD_SIZE = 16 * 1024 * 1024; // 16 MB

export interface Frame {
  type: FrameType;
  payload: Buffer;
}

/**
 * Encode a frame into a Buffer: [type(1B)][length(4B BE)][payload].
 */
export function encodeFrame(type: FrameType, payload: Buffer = Buffer.alloc(0)): Buffer {
  if (payload.length > MAX_PAYLOAD_SIZE) {
    throw new Error(`Payload too large: ${payload.length} > ${MAX_PAYLOAD_SIZE}`);
  }
  const header = Buffer.alloc(FRAME_HEADER_SIZE);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

/**
 * Streaming frame decoder. Feed it chunks, it emits complete frames.
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  /**
   * Feed data and return any complete frames decoded so far.
   */
  feed(chunk: Buffer): Frame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Frame[] = [];

    while (this.buffer.length >= FRAME_HEADER_SIZE) {
      const type = this.buffer.readUInt8(0) as FrameType;
      const length = this.buffer.readUInt32BE(1);

      if (length > MAX_PAYLOAD_SIZE) {
        throw new Error(`Frame payload too large: ${length}`);
      }

      const totalSize = FRAME_HEADER_SIZE + length;
      if (this.buffer.length < totalSize) {
        break; // Wait for more data
      }

      const payload = this.buffer.subarray(FRAME_HEADER_SIZE, totalSize);
      frames.push({ type, payload: Buffer.from(payload) });
      this.buffer = this.buffer.subarray(totalSize);
    }

    return frames;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

/**
 * Encode a PUSH/PULL payload: VV JSON (null-terminated) + delta bytes.
 */
export function encodeVvDelta(vvBytes: Uint8Array, delta: Uint8Array): Buffer {
  const nullByte = Buffer.from([0]);
  return Buffer.concat([Buffer.from(vvBytes), nullByte, Buffer.from(delta)]);
}

/**
 * Decode a PUSH/PULL payload into VV bytes and delta bytes.
 */
export function decodeVvDelta(payload: Buffer): { vv: Buffer; delta: Buffer } {
  const nullIdx = payload.indexOf(0);
  if (nullIdx === -1) {
    return { vv: payload, delta: Buffer.alloc(0) };
  }
  return {
    vv: payload.subarray(0, nullIdx),
    delta: payload.subarray(nullIdx + 1),
  };
}
