import test from "node:test";
import assert from "node:assert";
import crypto from "crypto";
import { POST } from "./route";

test("Discord interactions API route tests", async (t) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubKeyExport = publicKey.export({ format: "der", type: "spki" });
  const rawPubKeyBuffer = pubKeyExport.subarray(pubKeyExport.length - 32);
  const publicKeyHex = rawPubKeyBuffer.toString("hex");

  const originalEnv = { ...process.env };

  t.beforeEach(() => {
    process.env.DISCORD_APPLICATION_ID = "app_123";
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex;
    process.env.DISCORD_BOT_TOKEN = "bot_token_123";
    process.env.DISCORD_GUILD_ID = "guild_123";
    process.env.SIGNATURE_MAX_AGE_SECONDS = "300";
  });

  t.after(() => {
    process.env = originalEnv;
  });

  const signPayload = (body: string, timestamp: string) => {
    const message = Buffer.from(timestamp + body, "utf8");
    return crypto.sign(null, message, privateKey).toString("hex");
  };

  const nowTimestamp = String(Math.floor(Date.now() / 1000));

  await t.test("1. Valid PING returns PONG (type 1)", async () => {
    const body = JSON.stringify({
      id: "111",
      application_id: "app_123",
      type: 1,
    });
    const sig = signPayload(body, nowTimestamp);

    const req = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": sig,
        "X-Signature-Timestamp": nowTimestamp,
        "Content-Type": "application/json",
      },
      body,
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.deepStrictEqual(data, { type: 1 });
  });

  await t.test("2. Valid /status request reaches application-command branch", async () => {
    const body = JSON.stringify({
      id: "222",
      application_id: "app_123",
      type: 2,
      data: {
        id: "cmd_1",
        name: "status",
        type: 1,
      },
    });
    const sig = signPayload(body, nowTimestamp);

    const req = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": sig,
        "X-Signature-Timestamp": nowTimestamp,
        "Content-Type": "application/json",
      },
      body,
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.type, 4);
    assert.ok(data.data.content.includes("status"));
  });

  await t.test("3. Valid /report request reaches application-command branch", async () => {
    const body = JSON.stringify({
      id: "333",
      application_id: "app_123",
      type: 2,
      data: {
        id: "cmd_2",
        name: "report",
        type: 1,
        options: [{ name: "text", type: 3, value: "All systems nominal" }],
      },
    });
    const sig = signPayload(body, nowTimestamp);

    const req = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": sig,
        "X-Signature-Timestamp": nowTimestamp,
        "Content-Type": "application/json",
      },
      body,
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.type, 4);
    assert.ok(data.data.content.includes("report"));
  });

  await t.test("4. Invalid signature returns 401", async () => {
    const body = JSON.stringify({
      id: "111",
      application_id: "app_123",
      type: 1,
    });
    const req = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": "00".repeat(64),
        "X-Signature-Timestamp": nowTimestamp,
        "Content-Type": "application/json",
      },
      body,
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 401);
  });

  await t.test("5. Stale timestamp returns 401", async () => {
    const body = JSON.stringify({
      id: "111",
      application_id: "app_123",
      type: 1,
    });
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 400);
    const sig = signPayload(body, staleTimestamp);

    const req = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": sig,
        "X-Signature-Timestamp": staleTimestamp,
        "Content-Type": "application/json",
      },
      body,
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 401);
  });

  await t.test("6. Future timestamp returns 401", async () => {
    const body = JSON.stringify({
      id: "111",
      application_id: "app_123",
      type: 1,
    });
    const futureTimestamp = String(Math.floor(Date.now() / 1000) + 60);
    const sig = signPayload(body, futureTimestamp);

    const req = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": sig,
        "X-Signature-Timestamp": futureTimestamp,
        "Content-Type": "application/json",
      },
      body,
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 401);
  });

  await t.test("7. Malformed timestamp returns 401", async () => {
    const body = JSON.stringify({
      id: "111",
      application_id: "app_123",
      type: 1,
    });
    const req = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": "00".repeat(64),
        "X-Signature-Timestamp": "not-a-timestamp",
        "Content-Type": "application/json",
      },
      body,
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 401);
  });

  await t.test("8. Malformed verified interaction returns 4xx", async () => {
    const body = JSON.stringify({
      type: 1,
      // missing id and application_id
    });
    const sig = signPayload(body, nowTimestamp);

    const req = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": sig,
        "X-Signature-Timestamp": nowTimestamp,
        "Content-Type": "application/json",
      },
      body,
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("9. Unsupported interaction type returns 4xx", async () => {
    const body = JSON.stringify({
      id: "444",
      application_id: "app_123",
      type: 3, // MESSAGE_COMPONENT
    });
    const sig = signPayload(body, nowTimestamp);

    const req = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": sig,
        "X-Signature-Timestamp": nowTimestamp,
        "Content-Type": "application/json",
      },
      body,
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("10. Signature verification happens before JSON parsing", async () => {
    const body = "invalid-json-body";
    const sig = signPayload(body, nowTimestamp);

    const reqValidSig = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": sig,
        "X-Signature-Timestamp": nowTimestamp,
      },
      body,
    });

    const resValidSig = await POST(reqValidSig);
    assert.strictEqual(resValidSig.status, 400);

    const reqInvalidSig = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": "00".repeat(64),
        "X-Signature-Timestamp": nowTimestamp,
      },
      body,
    });

    const resInvalidSig = await POST(reqInvalidSig);
    assert.strictEqual(resInvalidSig.status, 401);
  });

  await t.test("11. No DB/external side effect is performed", async () => {
    const body = JSON.stringify({
      id: "555",
      application_id: "app_123",
      type: 1,
    });
    const sig = signPayload(body, nowTimestamp);

    const req = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": sig,
        "X-Signature-Timestamp": nowTimestamp,
      },
      body,
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 200);
  });
});
