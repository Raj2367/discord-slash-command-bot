import test from "node:test";
import assert from "node:assert";
import crypto from "crypto";
import { verifyDiscordSignature } from "./verify-signature";

test("Discord Ed25519 signature verification tests", async (t) => {
  // Generate deterministic test keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  
  const pubKeyExport = publicKey.export({ format: "der", type: "spki" });
  // Extract 32-byte raw public key from SPKI DER (last 32 bytes)
  const rawPubKeyBuffer = pubKeyExport.subarray(pubKeyExport.length - 32);
  const publicKeyHex = rawPubKeyBuffer.toString("hex");

  const timestamp = "1700000000";
  const rawBody = '{"type":1,"id":"123456"}';
  const message = Buffer.from(timestamp + rawBody, "utf8");

  const signatureBuffer = crypto.sign(null, message, privateKey);
  const signatureHex = signatureBuffer.toString("hex");

  await t.test("1. A known valid Ed25519 signature verifies successfully", () => {
    const isValid = verifyDiscordSignature(rawBody, signatureHex, timestamp, publicKeyHex);
    assert.strictEqual(isValid, true);
  });

  await t.test("2. Modifying the raw body causes verification to fail", () => {
    const tamperedBody = '{"type":1,"id":"999999"}';
    const isValid = verifyDiscordSignature(tamperedBody, signatureHex, timestamp, publicKeyHex);
    assert.strictEqual(isValid, false);
  });

  await t.test("3. Modifying the timestamp causes verification to fail", () => {
    const tamperedTimestamp = "1700000001";
    const isValid = verifyDiscordSignature(rawBody, signatureHex, tamperedTimestamp, publicKeyHex);
    assert.strictEqual(isValid, false);
  });

  await t.test("4. Modifying the signature causes verification to fail", () => {
    const tamperedSig = signatureHex.slice(0, 10) + "000000" + signatureHex.slice(16);
    const isValid = verifyDiscordSignature(rawBody, tamperedSig, timestamp, publicKeyHex);
    assert.strictEqual(isValid, false);
  });

  await t.test("5. Missing/malformed signature input fails safely", () => {
    assert.strictEqual(verifyDiscordSignature("", signatureHex, timestamp, publicKeyHex), false);
    assert.strictEqual(verifyDiscordSignature(rawBody, "", timestamp, publicKeyHex), false);
    assert.strictEqual(verifyDiscordSignature(rawBody, signatureHex, "", publicKeyHex), false);
    assert.strictEqual(verifyDiscordSignature(rawBody, signatureHex, timestamp, ""), false);
    assert.strictEqual(verifyDiscordSignature(rawBody, "invalidhex", timestamp, publicKeyHex), false);
  });

  await t.test("6. Utility works with raw non-JSON text without parsing or reconstructing body", () => {
    const rawText = "PING_OR_ARBITRARY_RAW_TEXT";
    const textMessage = Buffer.from(timestamp + rawText, "utf8");
    const textSig = crypto.sign(null, textMessage, privateKey).toString("hex");

    const isValid = verifyDiscordSignature(rawText, textSig, timestamp, publicKeyHex);
    assert.strictEqual(isValid, true);
  });
});
