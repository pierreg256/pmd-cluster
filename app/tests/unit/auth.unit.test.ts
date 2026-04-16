import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signAuth, verifyAuth } from "../../src/auth.js";

const COOKIE = "test-secret-cookie-32-bytes-long!";

describe("signAuth", () => {
  it("produces a hex string", () => {
    const hmac = signAuth(COOKIE, "node-a", 1718000000);
    assert.match(hmac, /^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    const h1 = signAuth(COOKIE, "node-a", 1718000000);
    const h2 = signAuth(COOKIE, "node-a", 1718000000);
    assert.equal(h1, h2);
  });

  it("differs for different node IDs", () => {
    const h1 = signAuth(COOKIE, "node-a", 1718000000);
    const h2 = signAuth(COOKIE, "node-b", 1718000000);
    assert.notEqual(h1, h2);
  });

  it("differs for different timestamps", () => {
    const h1 = signAuth(COOKIE, "node-a", 1718000000);
    const h2 = signAuth(COOKIE, "node-a", 1718000001);
    assert.notEqual(h1, h2);
  });

  it("differs for different cookies", () => {
    const h1 = signAuth(COOKIE, "node-a", 1718000000);
    const h2 = signAuth("other-cookie", "node-a", 1718000000);
    assert.notEqual(h1, h2);
  });
});

describe("verifyAuth", () => {
  it("accepts valid HMAC with current timestamp", () => {
    const ts = Math.floor(Date.now() / 1000);
    const hmac = signAuth(COOKIE, "node-a", ts);
    const result = verifyAuth(COOKIE, "node-a", ts, hmac);
    assert.equal(result.valid, true);
  });

  it("accepts timestamp within clock skew window", () => {
    const ts = Math.floor(Date.now() / 1000) - 15; // 15s ago
    const hmac = signAuth(COOKIE, "node-a", ts);
    const result = verifyAuth(COOKIE, "node-a", ts, hmac);
    assert.equal(result.valid, true);
  });

  it("rejects expired timestamp (> 30s old)", () => {
    const ts = Math.floor(Date.now() / 1000) - 60; // 60s ago
    const hmac = signAuth(COOKIE, "node-a", ts);
    const result = verifyAuth(COOKIE, "node-a", ts, hmac);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "timestamp_expired");
  });

  it("rejects future timestamp (> 30s ahead)", () => {
    const ts = Math.floor(Date.now() / 1000) + 60; // 60s ahead
    const hmac = signAuth(COOKIE, "node-a", ts);
    const result = verifyAuth(COOKIE, "node-a", ts, hmac);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "timestamp_expired");
  });

  it("rejects wrong HMAC", () => {
    const ts = Math.floor(Date.now() / 1000);
    const result = verifyAuth(COOKIE, "node-a", ts, "0".repeat(64));
    assert.equal(result.valid, false);
    assert.equal(result.reason, "invalid_hmac");
  });

  it("rejects HMAC of wrong length", () => {
    const ts = Math.floor(Date.now() / 1000);
    const result = verifyAuth(COOKIE, "node-a", ts, "deadbeef");
    assert.equal(result.valid, false);
    assert.equal(result.reason, "invalid_hmac");
  });

  it("rejects wrong cookie", () => {
    const ts = Math.floor(Date.now() / 1000);
    const hmac = signAuth(COOKIE, "node-a", ts);
    const result = verifyAuth("wrong-cookie", "node-a", ts, hmac);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "invalid_hmac");
  });

  it("rejects wrong node_id", () => {
    const ts = Math.floor(Date.now() / 1000);
    const hmac = signAuth(COOKIE, "node-a", ts);
    const result = verifyAuth(COOKIE, "node-b", ts, hmac);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "invalid_hmac");
  });
});
