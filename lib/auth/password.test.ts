import test from "node:test";
import assert from "node:assert";
import { hashPassword, verifyPassword } from "./password";

test("password hashing and verification", async (t) => {
  const plaintext = "mySecurePassword123";

  const hash = await hashPassword(plaintext);

  await t.test("1. A password can be hashed", () => {
    assert.strictEqual(typeof hash, "string");
    assert.ok(hash.length > 0);
  });

  await t.test("2. The resulting hash is not equal to the plaintext password", () => {
    assert.notStrictEqual(hash, plaintext);
  });

  await t.test("3. The correct plaintext password matches the hash", async () => {
    const isMatch = await verifyPassword(plaintext, hash);
    assert.strictEqual(isMatch, true);
  });

  await t.test("4. An incorrect password does not match", async () => {
    const isMatch = await verifyPassword("wrongPassword", hash);
    assert.strictEqual(isMatch, false);
  });
});
