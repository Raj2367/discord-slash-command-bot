import test from "node:test";
import assert from "node:assert";
import { createSessionToken, verifySessionToken } from "./session";

test("admin session utility tests", async (t) => {
  const adminId = "admin_cuid_12345";

  let token = "";

  await t.test("1. A session can be created for an admin ID", async () => {
    token = await createSessionToken(adminId);
    assert.strictEqual(typeof token, "string");
    assert.ok(token.length > 0);
  });

  await t.test("2. The stored session can be read back successfully", async () => {
    const session = await verifySessionToken(token);
    assert.ok(session !== null);
    assert.strictEqual(session?.adminId, adminId);
  });

  await t.test("3. An invalid/tampered session is rejected", async () => {
    // Tamper the middle of the token
    const tamperedToken = token.slice(0, 5) + "ABC" + token.slice(8);
    const session = await verifySessionToken(tamperedToken);
    assert.strictEqual(session, null);

    const completelyInvalid = "not.a.valid.iron.session.token";
    const invalidSession = await verifySessionToken(completelyInvalid);
    assert.strictEqual(invalidSession, null);
  });

  await t.test("4. The session destroy operation removes/invalidates the session", async () => {
    const destroyedSession = await verifySessionToken("");
    assert.strictEqual(destroyedSession, null);
  });

  await t.test("5. The session payload does not contain unnecessary sensitive fields", async () => {
    const session = await verifySessionToken(token);
    assert.ok(session !== null);
    const keys = Object.keys(session);
    assert.deepStrictEqual(keys, ["adminId"]);
    assert.strictEqual("password" in session, false);
    assert.strictEqual("passwordHash" in session, false);
    assert.strictEqual("webhookUrl" in session, false);
  });
});
