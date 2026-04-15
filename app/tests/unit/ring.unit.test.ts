import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeRingPositions,
  getSuccessor,
  getPredecessor,
} from "../../src/ring.js";

describe("computeRingPositions", () => {
  it("returns empty map for empty list", () => {
    const positions = computeRingPositions([]);
    assert.equal(positions.size, 0);
  });

  it("single node is its own successor and predecessor", () => {
    const positions = computeRingPositions(["node-a"]);
    const pos = positions.get("node-a")!;
    assert.equal(pos.successor, "node-a");
    assert.equal(pos.predecessor, "node-a");
  });

  it("two nodes point to each other", () => {
    const positions = computeRingPositions(["node-b", "node-a"]);
    const a = positions.get("node-a")!;
    const b = positions.get("node-b")!;
    assert.equal(a.successor, "node-b");
    assert.equal(a.predecessor, "node-b");
    assert.equal(b.successor, "node-a");
    assert.equal(b.predecessor, "node-a");
  });

  it("three nodes form a sorted ring", () => {
    const positions = computeRingPositions(["c", "a", "b"]);
    // sorted: a, b, c
    assert.deepEqual(positions.get("a"), {
      successor: "b",
      predecessor: "c",
    });
    assert.deepEqual(positions.get("b"), {
      successor: "c",
      predecessor: "a",
    });
    assert.deepEqual(positions.get("c"), {
      successor: "a",
      predecessor: "b",
    });
  });

  it("is deterministic regardless of input order", () => {
    const p1 = computeRingPositions(["z", "a", "m"]);
    const p2 = computeRingPositions(["m", "z", "a"]);
    assert.deepEqual(p1.get("a"), p2.get("a"));
    assert.deepEqual(p1.get("m"), p2.get("m"));
    assert.deepEqual(p1.get("z"), p2.get("z"));
  });
});

describe("getSuccessor", () => {
  it("returns successor in sorted ring", () => {
    assert.equal(getSuccessor("a", ["c", "a", "b"]), "b");
    assert.equal(getSuccessor("c", ["c", "a", "b"]), "a"); // wraps
  });

  it("returns self for unknown node", () => {
    assert.equal(getSuccessor("x", ["a", "b"]), "x");
  });
});

describe("getPredecessor", () => {
  it("returns predecessor in sorted ring", () => {
    assert.equal(getPredecessor("b", ["c", "a", "b"]), "a");
    assert.equal(getPredecessor("a", ["c", "a", "b"]), "c"); // wraps
  });

  it("returns self for unknown node", () => {
    assert.equal(getPredecessor("x", ["a", "b"]), "x");
  });
});
