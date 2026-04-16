import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync } from "node:fs";
import { once } from "node:events";
import { NodeWatcher } from "../../src/watcher.js";
import { RingState } from "../../src/state.js";

// ---------------------------------------------------------------------------
// Helper: mock PMD socket server returning configurable node lists
// ---------------------------------------------------------------------------

function createMockPmd(
  socketPath: string,
  getNodes: () => unknown
): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((conn) => {
      let buf = "";
      conn.on("data", (chunk) => {
        buf += chunk.toString();
        const nl = buf.indexOf("\n");
        if (nl !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          const request = JSON.parse(line);
          if (request === "Nodes") {
            conn.write(JSON.stringify({ Nodes: getNodes() }) + "\n");
          } else {
            conn.write(JSON.stringify({ Unknown: null }) + "\n");
          }
        }
      });
    });
    server.listen(socketPath, () => resolve(server));
  });
}

function closeMockPmd(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      try {
        unlinkSync(socketPath);
      } catch {}
      resolve();
    });
  });
}

function makeNode(id: string, addr: string, isLocal = false) {
  return {
    node_id: id,
    addr,
    joined_at: 1718000000,
    metadata: {},
    services: [],
    phi: isLocal ? null : 0.01,
    last_seen_at: isLocal ? null : 1718000010,
    is_local: isLocal,
  };
}

describe("NodeWatcher", () => {
  const socketPath = join(tmpdir(), `pmd-watcher-test-${process.pid}.sock`);
  let mockPmd: Server;
  let nodeList: unknown;
  let state: RingState;

  beforeEach(async () => {
    state = new RingState("test-replica");
    nodeList = {
      nodes: [makeNode("node-a", "10.0.1.4:4369", true)],
    };
    mockPmd = await createMockPmd(socketPath, () => nodeList);
  });

  afterEach(async () => {
    await closeMockPmd(mockPmd, socketPath);
  });

  it("detects initial nodes on first poll", async () => {
    const watcher = new NodeWatcher({
      pmd: { socketPath },
      state,
      intervalMs: 60000,
    });

    const joinPromise = once(watcher, "join");
    watcher.start();
    const [node] = await joinPromise;
    watcher.stop();

    assert.equal(node.node_id, "node-a");
    assert.ok(state.getNode("node-a"));
    assert.equal(state.getNode("node-a")!.status, "active");
  });

  it("detects new node joining", async () => {
    const watcher = new NodeWatcher({
      pmd: { socketPath },
      state,
      intervalMs: 100,
    });

    const join1 = once(watcher, "join");
    watcher.start();
    await join1; // node-a

    // Add node-b to the mock
    nodeList = {
      nodes: [
        makeNode("node-a", "10.0.1.4:4369", true),
        makeNode("node-b", "10.0.1.5:4369"),
      ],
    };

    const [node] = await once(watcher, "join");
    watcher.stop();

    assert.equal(node.node_id, "node-b");
    assert.ok(state.getNode("node-b"));
    assert.deepEqual(state.activeNodeIds(), ["node-a", "node-b"]);
  });

  it("detects node leaving", async () => {
    nodeList = {
      nodes: [
        makeNode("node-a", "10.0.1.4:4369", true),
        makeNode("node-b", "10.0.1.5:4369"),
      ],
    };

    const watcher = new NodeWatcher({
      pmd: { socketPath },
      state,
      intervalMs: 100,
    });

    // Collect joins
    const joins: unknown[] = [];
    watcher.on("join", (n) => joins.push(n));
    watcher.start();

    // Wait until both joins are detected
    while (joins.length < 2) {
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.deepEqual(state.activeNodeIds(), ["node-a", "node-b"]);

    // Remove node-b
    nodeList = {
      nodes: [makeNode("node-a", "10.0.1.4:4369", true)],
    };

    const [left] = await once(watcher, "leave");
    watcher.stop();

    assert.equal(left.node_id, "node-b");
    assert.equal(state.getNode("node-b")!.status, "leaving");
  });

  it("emits error on socket failure", async () => {
    const watcher = new NodeWatcher({
      pmd: { socketPath: "/nonexistent/socket" },
      state,
      intervalMs: 60000,
    });

    const errorPromise = once(watcher, "error");
    watcher.start();
    const [err] = await errorPromise;
    watcher.stop();

    assert.ok(err instanceof Error);
  });

  it("currentPeers returns non-local nodes", async () => {
    nodeList = {
      nodes: [
        makeNode("node-a", "10.0.1.4:4369", true),
        makeNode("node-b", "10.0.1.5:4369"),
      ],
    };

    const watcher = new NodeWatcher({
      pmd: { socketPath },
      state,
      intervalMs: 60000,
    });

    const joins: unknown[] = [];
    watcher.on("join", (n) => joins.push(n));
    watcher.start();

    // Wait for both joins from the single poll
    while (joins.length < 2) {
      await new Promise((r) => setTimeout(r, 20));
    }
    watcher.stop();

    const peers = watcher.currentPeers();
    assert.equal(peers.length, 1);
    assert.equal(peers[0].node_id, "node-b");
  });

  it("does not re-emit join for already known nodes", async () => {
    const watcher = new NodeWatcher({
      pmd: { socketPath },
      state,
      intervalMs: 100,
    });

    let joinCount = 0;
    watcher.on("join", () => joinCount++);
    watcher.start();

    // Wait for initial + at least one more poll
    await once(watcher, "join");
    await new Promise((r) => setTimeout(r, 150));
    watcher.stop();

    assert.equal(joinCount, 1);
  });
});
