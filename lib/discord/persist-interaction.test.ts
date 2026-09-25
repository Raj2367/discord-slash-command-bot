import test from "node:test";
import assert from "node:assert";
import { persistInteraction } from "./persist-interaction";

test("persistInteraction service tests", async (t) => {
  await t.test("1. New interaction creates InteractionLog and DISCORD_RESPONSE action", async () => {
    let createdData: any = null;
    const mockTx = {
      interactionLog: {
        findUnique: async () => null,
        create: async (args: any) => {
          createdData = args.data;
          return {
            id: "log_1",
            ...args.data,
            actions: args.data.actions.create.map((a: any, i: number) => ({
              id: `act_${i}`,
              ...a,
            })),
          };
        },
      },
    };

    const mockClient = {
      $transaction: async (fn: any) => fn(mockTx),
    };

    const parsed: any = {
      type: "APPLICATION_COMMAND",
      id: "int_123",
      applicationId: "app_123",
      commandName: "status",
      options: {},
    };

    const commandRule = {
      responseText: "Status is OK",
      mirrorEnabled: false,
      channelPostEnabled: false,
    };

    const result = await persistInteraction({ parsed, commandRule }, mockClient);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.duplicate, false);
    assert.strictEqual(result.interactionLog.interactionId, "int_123");
    assert.strictEqual(result.interactionLog.status, "RECEIVED");
    assert.strictEqual(result.interactionLog.actions.length, 1);
    assert.strictEqual(result.interactionLog.actions[0].type, "DISCORD_RESPONSE");
    assert.strictEqual(result.interactionLog.actions[0].status, "PENDING");
    assert.strictEqual(result.interactionLog.actions[0].attempts, 0);
    assert.deepStrictEqual(result.interactionLog.actions[0].result, { message: "Status is OK" });
  });

  await t.test("2. CHANNEL_POST and MIRROR are created when enabled", async () => {
    let createdActions: any = null;
    const mockTx = {
      interactionLog: {
        findUnique: async () => null,
        create: async (args: any) => {
          createdActions = args.data.actions.create;
          return {
            id: "log_2",
            ...args.data,
            actions: createdActions.map((a: any, i: number) => ({ id: `act_${i}`, ...a })),
          };
        },
      },
    };

    const mockClient = {
      $transaction: async (fn: any) => fn(mockTx),
    };

    const parsed: any = {
      type: "APPLICATION_COMMAND",
      id: "int_456",
      applicationId: "app_123",
      commandName: "report",
      options: { text: "issue" },
    };

    const commandRule = {
      responseText: "Report received",
      mirrorEnabled: true,
      channelPostEnabled: true,
    };

    const result = await persistInteraction({ parsed, commandRule }, mockClient);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.duplicate, false);
    assert.strictEqual(result.interactionLog.actions.length, 3);
    const types = result.interactionLog.actions.map((a: any) => a.type);
    assert.ok(types.includes("DISCORD_RESPONSE"));
    assert.ok(types.includes("CHANNEL_POST"));
    assert.ok(types.includes("MIRROR"));
    for (const act of result.interactionLog.actions) {
      assert.strictEqual(act.status, "PENDING");
      assert.strictEqual(act.attempts, 0);
    }
    const discordAction = result.interactionLog.actions.find((a: any) => a.type === "DISCORD_RESPONSE");
    assert.deepStrictEqual(discordAction.result, { message: "Report received: issue" });
    const channelPost = result.interactionLog.actions.find((a: any) => a.type === "CHANNEL_POST");
    assert.deepStrictEqual(channelPost.result, {
      message: "Report received: issue",
    });
    assert.deepStrictEqual(channelPost.result, discordAction.result);
    const mirror = result.interactionLog.actions.find((a: any) => a.type === "MIRROR");
    assert.deepStrictEqual(mirror.result, { message: "Report received" });
  });

  await t.test("3. Duplicate interactionId returns duplicate result without creating new logs", async () => {
    const existingLog = {
      id: "log_existing",
      interactionId: "int_dup",
      status: "RECEIVED",
      actions: [],
    };

    const mockTx = {
      interactionLog: {
        findUnique: async () => existingLog,
        create: async () => {
          throw new Error("Should not be called");
        },
      },
    };

    const mockClient = {
      $transaction: async (fn: any) => fn(mockTx),
    };

    const parsed: any = {
      type: "APPLICATION_COMMAND",
      id: "int_dup",
      applicationId: "app_123",
      commandName: "status",
      options: {},
    };

    const commandRule = {
      responseText: "OK",
      mirrorEnabled: false,
      channelPostEnabled: false,
    };

    const result = await persistInteraction({ parsed, commandRule }, mockClient);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.duplicate, true);
    assert.strictEqual(result.interactionLog.id, "log_existing");
  });

  await t.test("4. Prisma P2002 race-condition error is caught and handled as duplicate", async () => {
    const existingLog = {
      id: "log_p2002",
      interactionId: "int_race",
      status: "RECEIVED",
      actions: [],
    };

    const mockTx = {
      interactionLog: {
        findUnique: async () => null,
        create: async () => {
          const err: any = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        },
      },
    };

    const mockClient = {
      $transaction: async (fn: any) => fn(mockTx),
      interactionLog: {
        findUnique: async () => existingLog,
      },
    };

    const parsed: any = {
      type: "APPLICATION_COMMAND",
      id: "int_race",
      applicationId: "app_123",
      commandName: "status",
      options: {},
    };

    const commandRule = {
      responseText: "OK",
      mirrorEnabled: false,
      channelPostEnabled: false,
    };

    const result = await persistInteraction({ parsed, commandRule }, mockClient);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.duplicate, true);
    assert.strictEqual(result.interactionLog.id, "log_p2002");
  });

  await t.test("5. /status persists the configured response message unchanged in DISCORD_RESPONSE", async () => {
    let createdData: any = null;
    const mockTx = {
      interactionLog: {
        findUnique: async () => null,
        create: async (args: any) => {
          createdData = args.data;
          return {
            id: "log_5",
            ...args.data,
            actions: args.data.actions.create.map((a: any, i: number) => ({
              id: `act_${i}`,
              ...a,
            })),
          };
        },
      },
    };

    const mockClient = {
      $transaction: async (fn: any) => fn(mockTx),
    };

    const parsed: any = {
      type: "APPLICATION_COMMAND",
      id: "int_5",
      applicationId: "app_123",
      commandName: "status",
      options: {},
    };

    const commandRule = {
      responseText: "All systems nominal",
      mirrorEnabled: false,
      channelPostEnabled: false,
    };

    const result = await persistInteraction({ parsed, commandRule }, mockClient);

    assert.strictEqual(result.interactionLog.actions.length, 1);
    assert.strictEqual(result.interactionLog.actions[0].type, "DISCORD_RESPONSE");
    assert.deepStrictEqual(result.interactionLog.actions[0].result, {
      message: "All systems nominal",
    });
  });

  await t.test("6. /report persists the normalized final message in DISCORD_RESPONSE", async () => {
    let createdData: any = null;
    const mockTx = {
      interactionLog: {
        findUnique: async () => null,
        create: async (args: any) => {
          createdData = args.data;
          return {
            id: "log_6",
            ...args.data,
            actions: args.data.actions.create.map((a: any, i: number) => ({
              id: `act_${i}`,
              ...a,
            })),
          };
        },
      },
    };

    const mockClient = {
      $transaction: async (fn: any) => fn(mockTx),
    };

    const parsed: any = {
      type: "APPLICATION_COMMAND",
      id: "int_6",
      applicationId: "app_123",
      commandName: "report",
      options: { text: "   server is on fire   " },
    };

    const commandRule = {
      responseText: "Report logged",
      mirrorEnabled: false,
      channelPostEnabled: false,
    };

    const result = await persistInteraction({ parsed, commandRule }, mockClient);

    assert.strictEqual(result.interactionLog.actions[0].type, "DISCORD_RESPONSE");
    assert.deepStrictEqual(result.interactionLog.actions[0].result, {
      message: "Report logged: server is on fire",
    });
  });

  await t.test("7. /report with long text is bounded by the 1500-character limit", async () => {
    let createdData: any = null;
    const mockTx = {
      interactionLog: {
        findUnique: async () => null,
        create: async (args: any) => {
          createdData = args.data;
          return {
            id: "log_7",
            ...args.data,
            actions: args.data.actions.create.map((a: any, i: number) => ({
              id: `act_${i}`,
              ...a,
            })),
          };
        },
      },
    };

    const mockClient = {
      $transaction: async (fn: any) => fn(mockTx),
    };

    const parsed: any = {
      type: "APPLICATION_COMMAND",
      id: "int_7",
      applicationId: "app_123",
      commandName: "report",
      options: { text: "x".repeat(1600) },
    };

    const commandRule = {
      responseText: "Report logged",
      mirrorEnabled: false,
      channelPostEnabled: false,
    };

    const result = await persistInteraction({ parsed, commandRule }, mockClient);

    assert.strictEqual(result.interactionLog.actions[0].type, "DISCORD_RESPONSE");
    const expectedMessage = `Report logged: ${"x".repeat(1500)}`;
    assert.strictEqual(result.interactionLog.actions[0].result.message.length, expectedMessage.length);
    assert.strictEqual(result.interactionLog.actions[0].result.message, expectedMessage);
  });

  await t.test("8. /status CHANNEL_POST message is the configured response text (no report text)", async () => {
    let createdData: any = null;
    const mockTx = {
      interactionLog: {
        findUnique: async () => null,
        create: async (args: any) => {
          createdData = args.data;
          return {
            id: "log_8",
            ...args.data,
            actions: args.data.actions.create.map((a: any, i: number) => ({
              id: `act_${i}`,
              ...a,
            })),
          };
        },
      },
    };

    const mockClient = {
      $transaction: async (fn: any) => fn(mockTx),
    };

    const parsed: any = {
      type: "APPLICATION_COMMAND",
      id: "int_8",
      applicationId: "app_123",
      commandName: "status",
      options: {},
    };

    const commandRule = {
      responseText: "Status is OK",
      mirrorEnabled: false,
      channelPostEnabled: true,
    };

    const result = await persistInteraction({ parsed, commandRule }, mockClient);

    const discordAction = result.interactionLog.actions.find(
      (a: any) => a.type === "DISCORD_RESPONSE"
    );
    const channelPost = result.interactionLog.actions.find(
      (a: any) => a.type === "CHANNEL_POST"
    );
    assert.deepStrictEqual(discordAction.result, { message: "Status is OK" });
    assert.deepStrictEqual(channelPost.result, { message: "Status is OK" });
    assert.deepStrictEqual(channelPost.result, discordAction.result);
  });
});
