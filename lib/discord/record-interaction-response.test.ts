import test from "node:test";
import assert from "node:assert";
import { recordInteractionResponse } from "./record-interaction-response";

test("recordInteractionResponse database service tests", async (t) => {
  await t.test("1. Successful response updates DISCORD_RESPONSE to SUCCESS and InteractionLog to COMPLETED", async () => {
    let actionUpdateArgs: any = null;
    let logUpdateArgs: any = null;

    const mockLog = {
      id: "log_123",
      status: "RECEIVED",
      actions: [
        {
          id: "act_discord",
          type: "DISCORD_RESPONSE",
          status: "PENDING",
          attempts: 0,
          result: { message: "OK" },
        },
        {
          id: "act_channel",
          type: "CHANNEL_POST",
          status: "PENDING",
          attempts: 0,
          result: { message: "OK" },
        },
      ],
    };

    const mockTx = {
      interactionLog: {
        findUnique: async () => mockLog,
        update: async (args: any) => {
          logUpdateArgs = args;
          return { ...mockLog, ...args.data };
        },
      },
      actionRecord: {
        update: async (args: any) => {
          actionUpdateArgs = args;
          return { ...mockLog.actions[0], ...args.data };
        },
      },
    };

    const mockClient = {
      $transaction: async (fn: any) => fn(mockTx),
    };

    const result = await recordInteractionResponse(
      {
        interactionLogId: "log_123",
        attempts: 2,
        deliveryResult: { success: true },
      },
      mockClient
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.updated, true);

    assert.strictEqual(actionUpdateArgs.where.id, "act_discord");
    assert.strictEqual(actionUpdateArgs.data.status, "SUCCESS");
    assert.strictEqual(actionUpdateArgs.data.attempts, 2);
    assert.strictEqual(actionUpdateArgs.data.lastError, null);
    assert.ok(actionUpdateArgs.data.completedAt instanceof Date);

    assert.strictEqual(logUpdateArgs.where.id, "log_123");
    assert.strictEqual(logUpdateArgs.data.status, "COMPLETED");
  });

  await t.test("2. Failed response updates DISCORD_RESPONSE to FAILED and InteractionLog to FAILED", async () => {
    let actionUpdateArgs: any = null;
    let logUpdateArgs: any = null;

    const mockLog = {
      id: "log_456",
      status: "RECEIVED",
      actions: [
        {
          id: "act_discord",
          type: "DISCORD_RESPONSE",
          status: "PENDING",
          attempts: 0,
          result: { message: "OK" },
        },
      ],
    };

    const mockTx = {
      interactionLog: {
        findUnique: async () => mockLog,
        update: async (args: any) => {
          logUpdateArgs = args;
          return { ...mockLog, ...args.data };
        },
      },
      actionRecord: {
        update: async (args: any) => {
          actionUpdateArgs = args;
          return { ...mockLog.actions[0], ...args.data };
        },
      },
    };

    const mockClient = {
      $transaction: async (fn: any) => fn(mockTx),
    };

    const result = await recordInteractionResponse(
      {
        interactionLogId: "log_456",
        attempts: 3,
        deliveryResult: { success: false, category: "network", error: "Connection lost" },
      },
      mockClient
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.updated, true);

    assert.strictEqual(actionUpdateArgs.data.status, "FAILED");
    assert.strictEqual(actionUpdateArgs.data.attempts, 3);
    assert.strictEqual(actionUpdateArgs.data.lastError, "Connection lost");

    assert.strictEqual(logUpdateArgs.data.status, "FAILED");
  });

  await t.test("3. Missing DISCORD_RESPONSE action is handled safely", async () => {
    const mockLog = {
      id: "log_789",
      status: "RECEIVED",
      actions: [], // no discord response action
    };

    const mockTx = {
      interactionLog: {
        findUnique: async () => mockLog,
      },
    };

    const mockClient = {
      $transaction: async (fn: any) => fn(mockTx),
    };

    const result = await recordInteractionResponse(
      {
        interactionLogId: "log_789",
        attempts: 1,
        deliveryResult: { success: true },
      },
      mockClient
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.updated, false);
    assert.ok(result.error?.includes("DISCORD_RESPONSE action record not found"));
  });

  await t.test("4. Repeated finalization on SUCCESS action cannot regress back to FAILED", async () => {
    let updateCalled = false;
    const mockLog = {
      id: "log_repeat",
      status: "COMPLETED",
      actions: [
        {
          id: "act_discord",
          type: "DISCORD_RESPONSE",
          status: "SUCCESS", // already success
          attempts: 1,
          result: { message: "OK" },
        },
      ],
    };

    const mockTx = {
      interactionLog: {
        findUnique: async () => mockLog,
        update: async () => {
          updateCalled = true;
          return mockLog;
        },
      },
      actionRecord: {
        update: async () => {
          updateCalled = true;
          return mockLog.actions[0];
        },
      },
    };

    const mockClient = {
      $transaction: async (fn: any) => fn(mockTx),
    };

    const result = await recordInteractionResponse(
      {
        interactionLogId: "log_repeat",
        attempts: 1,
        deliveryResult: { success: false, category: "network", error: "failed later" },
      },
      mockClient
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.updated, false);
    assert.strictEqual(updateCalled, false);
  });
});
