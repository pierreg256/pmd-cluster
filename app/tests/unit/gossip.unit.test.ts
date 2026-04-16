import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createConnection } from "node:net";
import { once } from "node:events";
import { InternalServer } from "../../src/internal-server.js";
import { GossipManager } from "../../src/gossip.js";
import { RingState } from "../../src/state.js";
import { signAuth } from "../../src/auth.js";
import {
  FrameType,
  FrameDecoder,
  encodeFrame,
  encodeVvDelta,
  decodeVvDelta,
} from "../../src/codec.js";

const COOKIE = "test-cookie-for-gossip-integration!";
const PORT_BASE = 19443;
let portCounter = 0;

function nextPort(): number {
  return PORT_BASE + portCounter++;
}

// Helper: connect a raw TCP client, authenticate, and return socket + decoder
async function connectAndAuth(
  port: number,
  nodeId: string
): Promise<{ socket: ReturnType<typeof createConnection>; decoder: FrameDecoder }> {
  const socket = createConnection({ host: "127.0.0.1", port });
  const decoder = new FrameDecoder();
  await once(socket, "connect");

  const ts = Math.floor(Date.now() / 1000);
  const hmac = signAuth(COOKIE, nodeId, ts);
  socket.write(
    encodeFrame(
      FrameType.AUTH,
      Buffer.from(JSON.stringify({ node_id: nodeId, timestamp: ts, hmac }))
    )
  );

  // Wait for AUTH_OK
  const [chunk] = await once(socket, "data");
  const frames = decoder.feed(chunk);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, FrameType.AUTH_OK);

  return { socket, decoder };
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const fn of cleanups) await fn();
  cleanups.length = 0;
});

describe("InternalServer", () => {
  it("accepts valid AUTH and responds AUTH_OK", async () => {
    const port = nextPort();
    const state = new RingState("server-1");
    const server = new InternalServer(port, "127.0.0.1", COOKIE, state);
    await server.start();
    cleanups.push(() => server.stop());

    const { socket } = await connectAndAuth(port, "client-1");
    socket.destroy();
  });

  it("rejects invalid HMAC with AUTH_FAIL", async () => {
    const port = nextPort();
    const state = new RingState("server-1");
    const server = new InternalServer(port, "127.0.0.1", COOKIE, state);
    await server.start();
    cleanups.push(() => server.stop());

    const socket = createConnection({ host: "127.0.0.1", port });
    await once(socket, "connect");

    const ts = Math.floor(Date.now() / 1000);
    socket.write(
      encodeFrame(
        FrameType.AUTH,
        Buffer.from(
          JSON.stringify({ node_id: "bad", timestamp: ts, hmac: "0".repeat(64) })
        )
      )
    );

    const [chunk] = await once(socket, "data");
    const decoder = new FrameDecoder();
    const frames = decoder.feed(chunk);
    assert.equal(frames[0].type, FrameType.AUTH_FAIL);
    socket.destroy();
  });

  it("rejects non-AUTH first frame", async () => {
    const port = nextPort();
    const state = new RingState("server-1");
    const server = new InternalServer(port, "127.0.0.1", COOKIE, state);
    await server.start();
    cleanups.push(() => server.stop());

    const socket = createConnection({ host: "127.0.0.1", port });
    await once(socket, "connect");

    socket.write(encodeFrame(FrameType.PING));

    const [chunk] = await once(socket, "data");
    const decoder = new FrameDecoder();
    const frames = decoder.feed(chunk);
    assert.equal(frames[0].type, FrameType.AUTH_FAIL);
    socket.destroy();
  });

  it("responds to PING with PONG after auth", async () => {
    const port = nextPort();
    const state = new RingState("server-1");
    const server = new InternalServer(port, "127.0.0.1", COOKIE, state);
    await server.start();
    cleanups.push(() => server.stop());

    const { socket, decoder } = await connectAndAuth(port, "client-1");

    socket.write(encodeFrame(FrameType.PING));
    const [chunk] = await once(socket, "data");
    const frames = decoder.feed(chunk);
    assert.equal(frames[0].type, FrameType.PONG);
    socket.destroy();
  });

  it("handles PUSH: merges delta and returns PUSH_ACK", async () => {
    const port = nextPort();
    const serverState = new RingState("server-1");
    const server = new InternalServer(port, "127.0.0.1", COOKIE, serverState);
    await server.start();
    cleanups.push(() => server.stop());

    // Create a client state with some data
    const clientState = new RingState("client-1");
    clientState.kvSet("key", "value");
    const delta = clientState.deltaSince();

    const { socket, decoder } = await connectAndAuth(port, "client-1");

    const payload = encodeVvDelta(clientState.versionVector(), delta);
    socket.write(encodeFrame(FrameType.PUSH, payload));

    const [chunk] = await once(socket, "data");
    const frames = decoder.feed(chunk);
    assert.equal(frames[0].type, FrameType.PUSH_ACK);

    // Server should now have the data
    assert.equal(serverState.kvGet("key"), "value");
    socket.destroy();
  });

  it("handles PULL: returns PULL_RESP with delta", async () => {
    const port = nextPort();
    const serverState = new RingState("server-1");
    serverState.kvSet("server-key", "server-value");
    const server = new InternalServer(port, "127.0.0.1", COOKIE, serverState);
    await server.start();
    cleanups.push(() => server.stop());

    const { socket, decoder } = await connectAndAuth(port, "client-1");

    const clientState = new RingState("client-1");
    const pullPayload = encodeVvDelta(
      clientState.versionVector(),
      new Uint8Array(0)
    );
    socket.write(encodeFrame(FrameType.PULL, pullPayload));

    const [chunk] = await once(socket, "data");
    const frames = decoder.feed(chunk);
    assert.equal(frames[0].type, FrameType.PULL_RESP);

    const { delta } = decodeVvDelta(frames[0].payload);
    assert.ok(delta.length > 0);

    // Merge into client and check convergence
    clientState.mergeDelta(new Uint8Array(delta));
    assert.equal(clientState.kvGet("server-key"), "server-value");
    socket.destroy();
  });
});

describe("GossipManager + InternalServer integration", () => {
  it("two nodes converge via push", async () => {
    const port = nextPort();
    const stateA = new RingState("node-a");
    const stateB = new RingState("node-b");

    // Node B runs the server
    const server = new InternalServer(port, "127.0.0.1", COOKIE, stateB);
    await server.start();
    cleanups.push(() => server.stop());

    // Node A connects via GossipManager
    const gossip = new GossipManager(stateA, "node-a", COOKIE, {
      pullIntervalMs: 60000,
    });
    gossip.connectToPeer("127.0.0.1", port, "node-b");

    // Wait for auth to complete
    await new Promise((r) => setTimeout(r, 200));

    // Write data on node A and push
    stateA.kvSet("from-a", "hello");
    gossip.onLocalMutation();

    // Wait for delta to arrive
    await new Promise((r) => setTimeout(r, 200));

    assert.equal(stateB.kvGet("from-a"), "hello");
    gossip.stop();
  });

  it("two nodes converge via pull", async () => {
    const port = nextPort();
    const stateA = new RingState("node-a");
    const stateB = new RingState("node-b");

    // Node B has data
    stateB.kvSet("from-b", "world");

    const server = new InternalServer(port, "127.0.0.1", COOKIE, stateB);
    await server.start();
    cleanups.push(() => server.stop());

    // Node A connects and runs pull every 100ms
    const gossip = new GossipManager(stateA, "node-a", COOKIE, {
      pullIntervalMs: 100,
    });
    gossip.connectToPeer("127.0.0.1", port, "node-b");
    gossip.start(() => [{ nodeId: "node-b", addr: "127.0.0.1", port }]);

    // Wait for pull round to complete
    await new Promise((r) => setTimeout(r, 500));

    assert.equal(stateA.kvGet("from-b"), "world");
    gossip.stop();
  });

  it("bidirectional convergence between two nodes", async () => {
    const portA = nextPort();
    const portB = nextPort();
    const stateA = new RingState("node-a");
    const stateB = new RingState("node-b");

    // Both run internal servers
    const serverA = new InternalServer(portA, "127.0.0.1", COOKIE, stateA);
    const serverB = new InternalServer(portB, "127.0.0.1", COOKIE, stateB);
    await serverA.start();
    await serverB.start();
    cleanups.push(() => serverA.stop());
    cleanups.push(() => serverB.stop());

    // Both connect to each other via gossip
    const gossipA = new GossipManager(stateA, "node-a", COOKIE, {
      pullIntervalMs: 100,
    });
    const gossipB = new GossipManager(stateB, "node-b", COOKIE, {
      pullIntervalMs: 100,
    });

    gossipA.connectToPeer("127.0.0.1", portB, "node-b");
    gossipB.connectToPeer("127.0.0.1", portA, "node-a");

    gossipA.start(() => [{ nodeId: "node-b", addr: "127.0.0.1", port: portB }]);
    gossipB.start(() => [{ nodeId: "node-a", addr: "127.0.0.1", port: portA }]);

    // Wait for auth
    await new Promise((r) => setTimeout(r, 300));

    // Each writes data
    stateA.kvSet("from-a", "alice");
    stateB.kvSet("from-b", "bob");
    gossipA.onLocalMutation();
    gossipB.onLocalMutation();

    // Wait for convergence
    await new Promise((r) => setTimeout(r, 500));

    assert.equal(stateA.kvGet("from-b"), "bob");
    assert.equal(stateB.kvGet("from-a"), "alice");

    gossipA.stop();
    gossipB.stop();
  });

  it("disconnectPeer removes connection", async () => {
    const port = nextPort();
    const stateA = new RingState("node-a");
    const stateB = new RingState("node-b");

    const server = new InternalServer(port, "127.0.0.1", COOKIE, stateB);
    await server.start();
    cleanups.push(() => server.stop());

    const gossip = new GossipManager(stateA, "node-a", COOKIE);
    gossip.connectToPeer("127.0.0.1", port, "node-b");
    await new Promise((r) => setTimeout(r, 200));

    gossip.disconnectPeer("node-b");
    // No crash, clean disconnect
    gossip.stop();
  });
});
