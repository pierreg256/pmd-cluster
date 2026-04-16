import { createHmac, timingSafeEqual } from "node:crypto";

const ALGORITHM = "sha256";
const MAX_CLOCK_SKEW_SEC = 30;

/**
 * Sign an auth payload: HMAC-SHA256(cookie, nodeId + ":" + timestamp).
 */
export function signAuth(cookie: string, nodeId: string, ts: number): string {
  const message = nodeId + ":" + ts;
  return createHmac(ALGORITHM, cookie).update(message).digest("hex");
}

/**
 * Verify an auth payload with timing-safe comparison.
 * Rejects if |timestamp - now| > MAX_CLOCK_SKEW_SEC.
 */
export function verifyAuth(
  cookie: string,
  nodeId: string,
  ts: number,
  hmac: string
): { valid: boolean; reason?: string } {
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(ts - nowSec) > MAX_CLOCK_SKEW_SEC) {
    return { valid: false, reason: "timestamp_expired" };
  }

  const expected = signAuth(cookie, nodeId, ts);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hmac, "hex");

  if (a.length !== b.length) {
    return { valid: false, reason: "invalid_hmac" };
  }

  if (!timingSafeEqual(a, b)) {
    return { valid: false, reason: "invalid_hmac" };
  }

  return { valid: true };
}
