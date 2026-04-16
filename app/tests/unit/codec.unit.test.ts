import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FrameType,
  FrameDecoder,
  encodeFrame,
  encodeVvDelta,
  decodeVvDelta,
  FRAME_HEADER_SIZE,
} from "../../src/codec.js";

describe("encodeFrame / FrameDecoder", () => {
  it("encodes and decodes a simple frame", () => {
    const payload = Buffer.from("hello");
    const encoded = encodeFrame(FrameType.PING, payload);

    assert.equal(encoded.length, FRAME_HEADER_SIZE + payload.length);
    assert.equal(encoded[0], FrameType.PING);
    assert.equal(encoded.readUInt32BE(1), payload.length);

    const decoder = new FrameDecoder();
    const frames = decoder.feed(encoded);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].type, FrameType.PING);
    assert.deepEqual(frames[0].payload, payload);
  });

  it("encodes frame with empty payload", () => {
    const encoded = encodeFrame(FrameType.PONG);
    assert.equal(encoded.length, FRAME_HEADER_SIZE);

    const decoder = new FrameDecoder();
    const frames = decoder.feed(encoded);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].type, FrameType.PONG);
    assert.equal(frames[0].payload.length, 0);
  });

  it("decodes multiple frames from a single chunk", () => {
    const f1 = encodeFrame(FrameType.PING);
    const f2 = encodeFrame(FrameType.PONG);
    const combined = Buffer.concat([f1, f2]);

    const decoder = new FrameDecoder();
    const frames = decoder.feed(combined);
    assert.equal(frames.length, 2);
    assert.equal(frames[0].type, FrameType.PING);
    assert.equal(frames[1].type, FrameType.PONG);
  });

  it("handles partial frames across multiple chunks", () => {
    const payload = Buffer.from("some data here");
    const encoded = encodeFrame(FrameType.PUSH, payload);

    const decoder = new FrameDecoder();

    // Feed first 3 bytes (partial header)
    let frames = decoder.feed(encoded.subarray(0, 3));
    assert.equal(frames.length, 0);

    // Feed the rest
    frames = decoder.feed(encoded.subarray(3));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].type, FrameType.PUSH);
    assert.deepEqual(frames[0].payload, payload);
  });

  it("handles frame split at header/payload boundary", () => {
    const payload = Buffer.from("test payload");
    const encoded = encodeFrame(FrameType.AUTH, payload);

    const decoder = new FrameDecoder();

    // Feed exactly the header
    let frames = decoder.feed(encoded.subarray(0, FRAME_HEADER_SIZE));
    assert.equal(frames.length, 0);

    // Feed the payload
    frames = decoder.feed(encoded.subarray(FRAME_HEADER_SIZE));
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0].payload, payload);
  });

  it("rejects oversized payload", () => {
    // Craft a frame with length > MAX_PAYLOAD_SIZE
    const header = Buffer.alloc(FRAME_HEADER_SIZE);
    header.writeUInt8(FrameType.PUSH, 0);
    header.writeUInt32BE(17 * 1024 * 1024, 1); // 17MB > 16MB

    const decoder = new FrameDecoder();
    assert.throws(() => decoder.feed(header), /too large/);
  });

  it("reset clears internal buffer", () => {
    const decoder = new FrameDecoder();
    decoder.feed(Buffer.from([0x30, 0x00])); // partial
    decoder.reset();

    const encoded = encodeFrame(FrameType.PONG);
    const frames = decoder.feed(encoded);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].type, FrameType.PONG);
  });

  it("encodes all frame types", () => {
    const types = [
      FrameType.AUTH, FrameType.AUTH_OK, FrameType.AUTH_FAIL,
      FrameType.PUSH, FrameType.PUSH_ACK,
      FrameType.PULL, FrameType.PULL_RESP,
      FrameType.PING, FrameType.PONG,
    ];

    const decoder = new FrameDecoder();
    for (const t of types) {
      const encoded = encodeFrame(t, Buffer.from([t]));
      const frames = decoder.feed(encoded);
      assert.equal(frames.length, 1);
      assert.equal(frames[0].type, t);
    }
  });
});

describe("encodeVvDelta / decodeVvDelta", () => {
  it("round-trips VV and delta", () => {
    const vv = Buffer.from('{"r1":5,"r2":3}');
    const delta = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
    const encoded = encodeVvDelta(vv, delta);

    const decoded = decodeVvDelta(encoded);
    assert.deepEqual(decoded.vv, vv);
    assert.deepEqual(decoded.delta, delta);
  });

  it("handles empty delta", () => {
    const vv = Buffer.from('{"r1":1}');
    const encoded = encodeVvDelta(vv, new Uint8Array(0));

    const decoded = decodeVvDelta(encoded);
    assert.deepEqual(decoded.vv, vv);
    assert.equal(decoded.delta.length, 0);
  });

  it("handles payload without null byte (VV only)", () => {
    const payload = Buffer.from("just-vv-no-null");
    const decoded = decodeVvDelta(payload);
    assert.deepEqual(decoded.vv, payload);
    assert.equal(decoded.delta.length, 0);
  });

  it("handles delta containing null bytes", () => {
    const vv = Buffer.from("vv");
    const delta = Buffer.from([0x00, 0x01, 0x00, 0x02]); // delta with embedded nulls
    const encoded = encodeVvDelta(vv, delta);

    const decoded = decodeVvDelta(encoded);
    assert.deepEqual(decoded.vv, vv);
    assert.deepEqual(decoded.delta, delta);
  });
});
