import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RingState } from "../../src/state.js";

describe("RingState", () => {
  it("initializes with meta and empty ring", () => {
    const state = new RingState("replica-1", "test-cluster");
    const snap = state.materialize();

    assert.equal(snap.meta.cluster_name, "test-cluster");
    assert.equal(snap.meta.ring_version, 0);
    assert.deepEqual(snap.ring, {});
    assert.deepEqual(snap.kv, {});
  });

  it("addNode registers a node with topology", () => {
    const state = new RingState("replica-1");
    state.addNode("node-a", "10.0.1.4", 8080, "0.3.0");

    const node = state.getNode("node-a");
    assert.ok(node);
    assert.equal(node.addr, "10.0.1.4");
    assert.equal(node.port, 8080);
    assert.equal(node.status, "active");
    assert.equal(node.version, "0.3.0");
    // Single node: successor and predecessor are itself
    assert.equal(node.successor, "node-a");
    assert.equal(node.predecessor, "node-a");
  });

  it("adds multiple nodes and computes ring topology", () => {
    const state = new RingState("replica-1");
    state.addNode("node-c", "10.0.1.10", 8080, "0.3.0");
    state.addNode("node-a", "10.0.1.4", 8080, "0.3.0");
    state.addNode("node-b", "10.0.1.5", 8080, "0.3.0");

    // Sorted: node-a, node-b, node-c
    const a = state.getNode("node-a")!;
    assert.equal(a.successor, "node-b");
    assert.equal(a.predecessor, "node-c");

    const b = state.getNode("node-b")!;
    assert.equal(b.successor, "node-c");
    assert.equal(b.predecessor, "node-a");

    const c = state.getNode("node-c")!;
    assert.equal(c.successor, "node-a");
    assert.equal(c.predecessor, "node-b");
  });

  it("markLeaving sets status and recomputes topology", () => {
    const state = new RingState("replica-1");
    state.addNode("node-a", "10.0.1.4", 8080, "0.3.0");
    state.addNode("node-b", "10.0.1.5", 8080, "0.3.0");

    state.markLeaving("node-b");

    const b = state.getNode("node-b")!;
    assert.equal(b.status, "leaving");

    // Only node-a is active, so it points to itself
    const a = state.getNode("node-a")!;
    assert.equal(a.successor, "node-a");
    assert.equal(a.predecessor, "node-a");
  });

  it("removeNode removes entirely and recomputes", () => {
    const state = new RingState("replica-1");
    state.addNode("node-a", "10.0.1.4", 8080, "0.3.0");
    state.addNode("node-b", "10.0.1.5", 8080, "0.3.0");

    state.removeNode("node-b");

    assert.equal(state.getNode("node-b"), undefined);
    assert.deepEqual(state.activeNodeIds(), ["node-a"]);
  });

  it("activeNodeIds returns sorted active node IDs", () => {
    const state = new RingState("replica-1");
    state.addNode("node-c", "10.0.1.10", 8080, "0.3.0");
    state.addNode("node-a", "10.0.1.4", 8080, "0.3.0");
    state.addNode("node-b", "10.0.1.5", 8080, "0.3.0");

    assert.deepEqual(state.activeNodeIds(), ["node-a", "node-b", "node-c"]);

    state.markLeaving("node-b");
    assert.deepEqual(state.activeNodeIds(), ["node-a", "node-c"]);
  });

  it("ring_version increments on topology changes", () => {
    const state = new RingState("replica-1");
    assert.equal(state.materialize().meta.ring_version, 0);

    state.addNode("node-a", "10.0.1.4", 8080, "0.3.0");
    assert.equal(state.materialize().meta.ring_version, 1);

    state.addNode("node-b", "10.0.1.5", 8080, "0.3.0");
    assert.equal(state.materialize().meta.ring_version, 2);

    state.markLeaving("node-b");
    assert.equal(state.materialize().meta.ring_version, 3);
  });
});

describe("RingState kv store", () => {
  it("set and get a key", () => {
    const state = new RingState("replica-1");
    state.kvSet("leader", "node-a");

    assert.equal(state.kvGet("leader"), "node-a");
  });

  it("set complex value", () => {
    const state = new RingState("replica-1");
    state.kvSet("config", { retries: 3, timeout: 5000 });

    const val = state.kvGet("config") as Record<string, unknown>;
    assert.equal(val.retries, 3);
    assert.equal(val.timeout, 5000);
  });

  it("remove a key", () => {
    const state = new RingState("replica-1");
    state.kvSet("key1", "value1");
    state.kvRemove("key1");

    assert.equal(state.kvGet("key1"), undefined);
  });

  it("getKv returns all entries", () => {
    const state = new RingState("replica-1");
    state.kvSet("a", 1);
    state.kvSet("b", 2);

    const kv = state.getKv();
    assert.equal(kv.a, 1);
    assert.equal(kv.b, 2);
  });
});

describe("RingState delta sync", () => {
  it("produces and merges deltas between replicas", () => {
    const state1 = new RingState("replica-1");
    const state2 = new RingState("replica-2");

    // Replica 1 adds a node
    state1.addNode("node-a", "10.0.1.4", 8080, "0.3.0");
    state1.kvSet("leader", "node-a");

    // Produce delta and merge into replica 2
    const delta = state1.deltaSince();
    state2.mergeDelta(delta);

    // Replica 2 should now see node-a and the kv entry
    const snap2 = state2.materialize();
    assert.ok(snap2.ring["node-a"]);
    assert.equal(snap2.ring["node-a"].addr, "10.0.1.4");
    assert.equal(snap2.kv.leader, "node-a");
  });

  it("bidirectional sync converges", () => {
    const state1 = new RingState("replica-1");
    const state2 = new RingState("replica-2");

    // Each replica writes its own node
    state1.addNode("node-a", "10.0.1.4", 8080, "0.3.0");
    state2.addNode("node-b", "10.0.1.5", 8080, "0.3.0");

    // Exchange deltas
    const delta1 = state1.deltaSince();
    const delta2 = state2.deltaSince();
    state1.mergeDelta(delta2);
    state2.mergeDelta(delta1);

    // Both should see both nodes
    const snap1 = state1.materialize();
    const snap2 = state2.materialize();
    assert.ok(snap1.ring["node-a"]);
    assert.ok(snap1.ring["node-b"]);
    assert.ok(snap2.ring["node-a"]);
    assert.ok(snap2.ring["node-b"]);
  });

  it("versionVector returns bytes", () => {
    const state = new RingState("replica-1");
    const vv = state.versionVector();
    assert.ok(vv instanceof Uint8Array);
  });
});
