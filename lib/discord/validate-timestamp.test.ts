import test from "node:test";
import assert from "node:assert";
import { validateTimestamp } from "./validate-timestamp";

test("Discord timestamp freshness validation tests", async (t) => {
  const nowMs = 1700000000000; // fixed reference time in ms (1700000000 seconds)
  const maxAge = 300;

  await t.test("1. Fresh timestamp is accepted", () => {
    const freshTimestamp = String(1700000000 - 60); // 60 seconds ago
    const isValid = validateTimestamp(freshTimestamp, maxAge, nowMs);
    assert.strictEqual(isValid, true);
  });

  await t.test("2. Timestamp exactly at the allowed boundary behaves consistently", () => {
    const boundaryTimestamp = String(1700000000 - 300); // exactly 300 seconds ago
    const isValid = validateTimestamp(boundaryTimestamp, maxAge, nowMs);
    assert.strictEqual(isValid, true);
  });

  await t.test("3. Stale timestamp is rejected", () => {
    const staleTimestamp = String(1700000000 - 301); // 301 seconds ago
    const isValid = validateTimestamp(staleTimestamp, maxAge, nowMs);
    assert.strictEqual(isValid, false);
  });

  await t.test("4. Future timestamp is rejected", () => {
    const futureTimestamp = String(1700000000 + 60); // 60 seconds in the future
    const isValid = validateTimestamp(futureTimestamp, maxAge, nowMs);
    assert.strictEqual(isValid, false);
  });

  await t.test("5. Malformed timestamp is rejected", () => {
    assert.strictEqual(validateTimestamp("not-a-number", maxAge, nowMs), false);
    assert.strictEqual(validateTimestamp("1700000000.5", maxAge, nowMs), false);
    assert.strictEqual(validateTimestamp("-1700000000", maxAge, nowMs), false);
  });

  await t.test("6. Empty/missing timestamp is rejected", () => {
    assert.strictEqual(validateTimestamp("", maxAge, nowMs), false);
    assert.strictEqual(validateTimestamp(null, maxAge, nowMs), false);
    assert.strictEqual(validateTimestamp(undefined, maxAge, nowMs), false);
  });

  await t.test("7. Different configured freshness windows work correctly", () => {
    const timestamp = String(1700000000 - 120); // 120 seconds ago

    // Window of 60 seconds -> should be rejected (stale)
    assert.strictEqual(validateTimestamp(timestamp, 60, nowMs), false);

    // Window of 180 seconds -> should be accepted (fresh)
    assert.strictEqual(validateTimestamp(timestamp, 180, nowMs), true);
  });
});
