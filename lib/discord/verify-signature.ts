import crypto from "crypto";

export function verifyDiscordSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  publicKeyHex: string
): boolean {
  try {
    if (!rawBody || !signature || !timestamp || !publicKeyHex) {
      return false;
    }

    const sigBuffer = Buffer.from(signature, "hex");
    const pubKeyBuffer = Buffer.from(publicKeyHex, "hex");

    if (sigBuffer.length !== 64 || pubKeyBuffer.length !== 32) {
      return false;
    }

    // SPKI DER header for Ed25519 public key
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const pubKey = crypto.createPublicKey({
      key: Buffer.concat([spkiPrefix, pubKeyBuffer]),
      format: "der",
      type: "spki",
    });

    const message = Buffer.from(timestamp + rawBody, "utf8");

    return crypto.verify(null, message, pubKey, sigBuffer);
  } catch {
    return false;
  }
}
