import test from "node:test";
import assert from "node:assert";
import crypto from "crypto";
import { POST, maxDuration, runtime } from "./route";
import { prisma } from "@/lib/db";

test("Discord interactions API route integration tests", async (t) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubKeyExport = publicKey.export({ format: "der", type: "spki" });
  const rawPubKeyBuffer = pubKeyExport.subarray(pubKeyExport.length - 32);
  const publicKeyHex = rawPubKeyBuffer.toString("hex");

  const originalEnv = { ...process.env };
  const originalServerConfigFindUnique = prisma.discordServerConfig.findUnique;
  const originalCommandRuleFindUnique = prisma.commandRule.findUnique;
  const originalInteractionLogCreate = prisma.interactionLog.create;
  const originalInteractionLogFindUnique = prisma.interactionLog.findUnique;
  const originalTransaction = prisma.$transaction;

  t.beforeEach(() => {
    process.env.DISCORD_APPLICATION_ID = "app_123";
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex;
    process.env.DISCORD_BOT_TOKEN = "bot_token_123";
    process.env.DISCORD_GUILD_ID = "guild_123";
    process.env.SIGNATURE_MAX_AGE_SECONDS = "300";
  });

  t.after(() => {
    process.env = originalEnv;
    prisma.discordServerConfig.findUnique = originalServerConfigFindUnique;
    prisma.commandRule.findUnique = originalCommandRuleFindUnique;
    prisma.interactionLog.create = originalInteractionLogCreate;
    prisma.interactionLog.findUnique = originalInteractionLogFindUnique;
    prisma.$transaction = originalTransaction;
  });

  const signPayload = (body: string, timestamp: string) => {
    const message = Buffer.from(timestamp + body, "utf8");
    return crypto.sign(null, message, privateKey).toString("hex");
  };

  const nowTimestamp = String(Math.floor(Date.now() / 1000));

  await t.test("1. Route has maxDuration = 60 and nodejs runtime", () => {
    assert.strictEqual(maxDuration, 60);
    assert.strictEqual(runtime, "nodejs");
  });

  await t.test("2. PING works without DB access", async () => {
    // Mock prisma to throw if called
    // @ts-ignore
    prisma.discordServerConfig.findUnique = async () => {
      throw new Error("DB should not be touched for PING");
    };

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

  await t.test("3. Wrong guild or missing guild returns ephemeral response and creates no InteractionLog", async () => {
    let logCreated = false;
    // @ts-ignore
    prisma.interactionLog.create = async () => {
      logCreated = true;
      return {} as any;
    };

    const body = JSON.stringify({
      id: "222",
      application_id: "app_123",
      type: 2,
      guild_id: "wrong_guild",
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
    assert.strictEqual(data.data.flags, 64); // ephemeral
    assert.strictEqual(logCreated, false);
  });

  await t.test("4. Disabled command or missing command rule returns ephemeral response and persists COMPLETED InteractionLog with no actions", async () => {
    // @ts-ignore
    prisma.discordServerConfig.findUnique = async () => ({ guildId: "guild_123" });
    // @ts-ignore
    prisma.commandRule.findUnique = async () => null; // missing rule

    let savedLog: any = null;
    // @ts-ignore
    prisma.interactionLog.create = async (args: any) => {
      savedLog = args.data;
      return { id: "log_disabled", ...args.data };
    };

    const body = JSON.stringify({
      id: "333",
      application_id: "app_123",
      type: 2,
      guild_id: "guild_123",
      data: {
        id: "cmd_2",
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
    assert.strictEqual(data.data.flags, 64);
    assert.strictEqual(savedLog.status, "COMPLETED");
  });

  await t.test("5. Enabled /status and /report create persistence and return { type: 5 }", async () => {
    // @ts-ignore
    prisma.discordServerConfig.findUnique = async () => ({ guildId: "guild_123" });
    // @ts-ignore
    prisma.commandRule.findUnique = async (args: any) => ({
      commandName: args.where.commandName,
      enabled: true,
      responseText: `Response for ${args.where.commandName}`,
      mirrorEnabled: false,
      channelPostEnabled: false,
    });

    let transactionCalled = false;
    // @ts-ignore
    prisma.$transaction = async (fn: any) => {
      transactionCalled = true;
      const mockTx = {
        interactionLog: {
          findUnique: async () => null,
          create: async (args: any) => ({
            id: "log_new",
            ...args.data,
            actions: [],
          }),
        },
      };
      return fn(mockTx);
    };

    for (const cmdName of ["status", "report"]) {
      transactionCalled = false;
      const body = JSON.stringify({
        id: `int_${cmdName}`,
        application_id: "app_123",
        type: 2,
        guild_id: "guild_123",
        data: {
          id: `cmd_${cmdName}`,
          name: cmdName,
          type: 1,
          options: cmdName === "report" ? [{ name: "text", type: 3, value: "test report" }] : [],
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
      assert.deepStrictEqual(data, { type: 5 });
      assert.strictEqual(transactionCalled, true);
    }
  });

  await t.test("6. Duplicate interaction returns { type: 5 } without creating another log/actions", async () => {
    // @ts-ignore
    prisma.discordServerConfig.findUnique = async () => ({ guildId: "guild_123" });
    // @ts-ignore
    prisma.commandRule.findUnique = async () => ({
      commandName: "status",
      enabled: true,
      responseText: "OK",
      mirrorEnabled: false,
      channelPostEnabled: false,
    });

    const existingLog = {
      id: "log_existing",
      interactionId: "int_dup_route",
      status: "RECEIVED",
      actions: [],
    };

    // @ts-ignore
    prisma.$transaction = async (fn: any) => {
      const mockTx = {
        interactionLog: {
          findUnique: async () => existingLog,
          create: async () => {
            throw new Error("Should not be called on duplicate");
          },
        },
      };
      return fn(mockTx);
    };

    const body = JSON.stringify({
      id: "int_dup_route",
      application_id: "app_123",
      type: 2,
      guild_id: "guild_123",
      data: {
        id: "cmd_status",
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
    assert.deepStrictEqual(data, { type: 5 });
  });

  await t.test("7. Signature/timestamp verification occurs before DB access", async () => {
    let dbAccessed = false;
    // @ts-ignore
    prisma.discordServerConfig.findUnique = async () => {
      dbAccessed = true;
      return null;
    };

    const body = JSON.stringify({
      id: "111",
      application_id: "app_123",
      type: 1,
    });

    // Request with invalid signature
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
    assert.strictEqual(dbAccessed, false);
  });
});
