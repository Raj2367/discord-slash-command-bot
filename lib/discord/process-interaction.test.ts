import test from "node:test";
import assert from "node:assert";
import { processInteraction } from "./process-interaction";
import { DeliveryResult } from "./deliver-interaction-response";

test("processInteraction service tests", async (t) => {
  const baseInput = {
    interactionLogId: "log_123",
    applicationId: "app_123",
    interactionToken: "secret_token_xyz",
    commandName: "status",
    responseSnapshot: { message: "System is healthy" },
  };

  await t.test("1. Successful processing invokes retry delivery and returns result", async () => {
    let capturedInput: any = null;

    const deliverer = async (input: any): Promise<DeliveryResult> => {
      capturedInput = input;
      return { success: true };
    };

    const sleep = async () => {};

    const result = await processInteraction(baseInput, {
      deliverer,
      sleep,
      client: {
        actionRecord: { updateMany: async () => ({ count: 1 }) },
        interactionLog: { update: async () => ({}) },
      },
    });

    assert.strictEqual(result.deliveryResult.success, true);
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(capturedInput.applicationId, "app_123");
    assert.strictEqual(capturedInput.interactionToken, "secret_token_xyz");
    assert.deepStrictEqual(capturedInput.payload, {
      content: "System is healthy",
      allowed_mentions: { parse: [] },
    });
  });

  await t.test("2. Permanent failure is returned unchanged with correct attempts", async () => {
    const deliverer = async (): Promise<DeliveryResult> => {
      return { success: false, category: "permanent", status: 400 };
    };

    const sleep = async () => {};

    const result = await processInteraction(baseInput, {
      deliverer,
      sleep,
      client: {
        actionRecord: { updateMany: async () => ({ count: 1 }) },
        interactionLog: { update: async () => ({}) },
      },
    });

    assert.strictEqual(result.deliveryResult.success, false);
    if (!result.deliveryResult.success) {
      assert.strictEqual(result.deliveryResult.category, "permanent");
      assert.strictEqual(result.deliveryResult.status, 400);
    }
    assert.strictEqual(result.attempts, 1);
  });

  await t.test("3. Transient failure eventually succeeds and exposes correct attempts", async () => {
    let attempts = 0;
    const deliverer = async (): Promise<DeliveryResult> => {
      attempts++;
      if (attempts < 2) {
        return { success: false, category: "transient", status: 500 };
      }
      return { success: true };
    };

    const sleep = async () => {};

    const result = await processInteraction(baseInput, {
      deliverer,
      sleep,
      client: {
        actionRecord: { updateMany: async () => ({ count: 1 }) },
        interactionLog: { update: async () => ({}) },
      },
    });

    assert.strictEqual(result.deliveryResult.success, true);
    assert.strictEqual(result.attempts, 2);
  });

  await t.test("4. Final transient failure exposes correct attempts = 3", async () => {
    const deliverer = async (): Promise<DeliveryResult> => {
      return { success: false, category: "network" };
    };

    const sleep = async () => {};

    const result = await processInteraction(baseInput, {
      deliverer,
      sleep,
      client: {
        actionRecord: { updateMany: async () => ({ count: 1 }) },
        interactionLog: { update: async () => ({}) },
      },
    });

    assert.strictEqual(result.deliveryResult.success, false);
    if (!result.deliveryResult.success) {
      assert.strictEqual(result.deliveryResult.category, "network");
    }
    assert.strictEqual(result.attempts, 3);
  });

  await t.test("5. /report sends responseSnapshot.message as payload content", async () => {
    let capturedInput: any = null;
    const deliverer = async (input: any): Promise<DeliveryResult> => {
      capturedInput = input;
      return { success: true };
    };
    const sleep = async () => {};

    const reportInput = {
      ...baseInput,
      commandName: "report",
      responseSnapshot: { message: "Report logged" },
    };

    const result = await processInteraction(reportInput, {
      deliverer,
      sleep,
      client: {
        actionRecord: { updateMany: async () => ({ count: 1 }) },
        interactionLog: { update: async () => ({}) },
      },
    });
    assert.strictEqual(result.deliveryResult.success, true);
    assert.strictEqual(result.attempts, 1);
    assert.deepStrictEqual(capturedInput.payload, {
      content: "Report logged",
      allowed_mentions: { parse: [] },
    });
  });

  await t.test("6. Successful delivery updates DISCORD_RESPONSE action to SUCCESS with attempts and InteractionLog to COMPLETED", async () => {
    let updatedArgs: any = null;
    let logUpdatedArgs: any = null;
    const mockClient = {
      actionRecord: {
        updateMany: async (args: any) => {
          updatedArgs = args;
          return { count: 1 };
        },
      },
      interactionLog: {
        update: async (args: any) => {
          logUpdatedArgs = args;
          return { id: "log_123" };
        },
      },
    };

    let attempts = 0;
    const deliverer = async (): Promise<DeliveryResult> => {
      attempts++;
      if (attempts < 2) {
        return { success: false, category: "transient", status: 500 };
      }
      return { success: true };
    };

    const sleep = async () => {};

    const result = await processInteraction(baseInput, { deliverer, sleep, client: mockClient });

    assert.strictEqual(result.deliveryResult.success, true);
    assert.strictEqual(result.attempts, 2);
    assert.notStrictEqual(updatedArgs, null);
    assert.deepStrictEqual(updatedArgs.where, {
      interactionLogId: "log_123",
      type: "DISCORD_RESPONSE",
    });
    assert.strictEqual(updatedArgs.data.status, "SUCCESS");
    assert.strictEqual(updatedArgs.data.attempts, 2);
    assert.ok(updatedArgs.data.completedAt instanceof Date);
    assert.notStrictEqual(logUpdatedArgs, null);
    assert.deepStrictEqual(logUpdatedArgs.where, { id: "log_123" });
    assert.strictEqual(logUpdatedArgs.data.status, "COMPLETED");
    assert.ok(logUpdatedArgs.data.processedAt instanceof Date);
  });

  await t.test("7. Failed delivery updates DISCORD_RESPONSE action to FAILED with attempts, lastError, and InteractionLog to FAILED", async () => {
    let updatedArgs: any = null;
    let logUpdatedArgs: any = null;
    const mockClient = {
      actionRecord: {
        updateMany: async (args: any) => {
          updatedArgs = args;
          return { count: 1 };
        },
      },
      interactionLog: {
        update: async (args: any) => {
          logUpdatedArgs = args;
          return { id: "log_123" };
        },
      },
    };

    const deliverer = async (): Promise<DeliveryResult> => {
      return { success: false, category: "permanent", status: 400, error: "Discord API permanent error: 400" };
    };

    const sleep = async () => {};

    const result = await processInteraction(baseInput, { deliverer, sleep, client: mockClient });

    assert.strictEqual(result.deliveryResult.success, false);
    assert.strictEqual(result.attempts, 1);
    assert.notStrictEqual(updatedArgs, null);
    assert.deepStrictEqual(updatedArgs.where, {
      interactionLogId: "log_123",
      type: "DISCORD_RESPONSE",
    });
    assert.strictEqual(updatedArgs.data.status, "FAILED");
    assert.strictEqual(updatedArgs.data.attempts, 1);
    assert.strictEqual(updatedArgs.data.lastError, "Discord API permanent error: 400");
    assert.ok(updatedArgs.data.completedAt instanceof Date);
    assert.notStrictEqual(logUpdatedArgs, null);
    assert.deepStrictEqual(logUpdatedArgs.where, { id: "log_123" });
    assert.strictEqual(logUpdatedArgs.data.status, "FAILED");
    assert.ok(logUpdatedArgs.data.processedAt instanceof Date);
  });

  await t.test("8. Unexpected throw from retry delivery marks DISCORD_RESPONSE FAILED and InteractionLog FAILED, then re-throws", async () => {
    let updatedArgs: any = null;
    let logUpdatedArgs: any = null;
    const mockClient = {
      actionRecord: {
        updateMany: async (args: any) => {
          updatedArgs = args;
          return { count: 1 };
        },
      },
      interactionLog: {
        update: async (args: any) => {
          logUpdatedArgs = args;
          return { id: "log_123" };
        },
      },
    };

    const thrown = new Error("inject: network blew up");
    const deliverer = async (): Promise<DeliveryResult> => {
      throw thrown;
    };

    const sleep = async () => {};

    await assert.rejects(
      processInteraction(baseInput, { deliverer, sleep, client: mockClient }),
      (err) => err === thrown
    );

    assert.notStrictEqual(updatedArgs, null);
    assert.deepStrictEqual(updatedArgs.where, {
      interactionLogId: "log_123",
      type: "DISCORD_RESPONSE",
    });
    assert.strictEqual(updatedArgs.data.status, "FAILED");
    assert.strictEqual(updatedArgs.data.attempts, 0);
    assert.strictEqual(updatedArgs.data.lastError, "Discord response processing failed");
    assert.ok(updatedArgs.data.completedAt instanceof Date);
    assert.notStrictEqual(logUpdatedArgs, null);
    assert.deepStrictEqual(logUpdatedArgs.where, { id: "log_123" });
    assert.strictEqual(logUpdatedArgs.data.status, "FAILED");
    assert.ok(logUpdatedArgs.data.processedAt instanceof Date);
  });

  await t.test("9. Successful primary Discord response + channel post enabled invokes retryChannelPost", async () => {
    let cpCalled = false;
    let cpInput: any = null;
    const cpDeliverer = async (input: any): Promise<DeliveryResult> => {
      cpCalled = true;
      cpInput = input;
      return { success: true };
    };

    const input = {
      ...baseInput,
      channelPostEnabled: true,
      channelId: "chan_123",
      botToken: "bot_token_secret",
    };

    const result = await processInteraction(input, {
      deliverer: async (input: any): Promise<DeliveryResult> => {
        return { success: true };
      },
      sleep: async () => {},
      client: {
        actionRecord: { updateMany: async () => ({ count: 1 }) },
        interactionLog: { update: async () => ({}) },
      },
      channelPost: {
        deliverer: cpDeliverer,
        sleep: async () => {},
      },
    });

    assert.strictEqual(result.deliveryResult.success, true);
    assert.strictEqual(cpCalled, true);
    assert.deepStrictEqual(cpInput, {
      channelId: "chan_123",
      botToken: "bot_token_secret",
      message: "System is healthy",
    });
  });

  await t.test("10. Disabled channel post does not invoke retryChannelPost", async () => {
    let cpCalled = false;
    const cpDeliverer = async (_input: any): Promise<DeliveryResult> => {
      cpCalled = true;
      return { success: true };
    };

    const input = {
      ...baseInput,
      channelPostEnabled: false,
      channelId: "chan_123",
      botToken: "bot_token_secret",
    };

    await processInteraction(input, {
      deliverer: async (input: any): Promise<DeliveryResult> => {
        return { success: true };
      },
      sleep: async () => {},
      client: {
        actionRecord: { updateMany: async () => ({ count: 1 }) },
        interactionLog: { update: async () => ({}) },
      },
      channelPost: {
        deliverer: cpDeliverer,
        sleep: async () => {},
      },
    });

    assert.strictEqual(cpCalled, false);
  });

  await t.test("11. Successful channel-post delivery updates CHANNEL_POST action to SUCCESS with attempts", async () => {
    let updatedArgs: any = null;
    const mockClient = {
      actionRecord: {
        updateMany: async (args: any) => {
          updatedArgs = args;
          return { count: 1 };
        },
      },
      interactionLog: {
        update: async () => ({}),
      },
    };

    const cpDeliverer = async (_input: any): Promise<DeliveryResult> => {
      return { success: true };
    };

    const input = {
      ...baseInput,
      channelPostEnabled: true,
      channelId: "chan_123",
      botToken: "bot_token_secret",
    };

    await processInteraction(input, {
      deliverer: async (): Promise<DeliveryResult> => ({ success: true }),
      sleep: async () => {},
      client: mockClient,
      channelPost: {
        deliverer: cpDeliverer,
        sleep: async () => {},
      },
    });

    assert.notStrictEqual(updatedArgs, null);
    assert.deepStrictEqual(updatedArgs.where, {
      interactionLogId: "log_123",
      type: "CHANNEL_POST",
    });
    assert.strictEqual(updatedArgs.data.status, "SUCCESS");
    assert.strictEqual(updatedArgs.data.attempts, 1);
    assert.ok(updatedArgs.data.completedAt instanceof Date);
  });

  await t.test("12. Failed channel-post delivery persists CHANNEL_POST action as FAILED with attempts and lastError", async () => {
    let updatedArgs: any = null;
    const mockClient = {
      actionRecord: {
        updateMany: async (args: any) => {
          updatedArgs = args;
          return { count: 1 };
        },
      },
      interactionLog: {
        update: async () => ({}),
      },
    };

    const cpDeliverer = async (_input: any): Promise<DeliveryResult> => {
      return {
        success: false,
        category: "transient",
        error: "Discord API channel post error: 500",
      };
    };

    const input = {
      ...baseInput,
      channelPostEnabled: true,
      channelId: "chan_123",
      botToken: "bot_token_secret",
    };

    await processInteraction(input, {
      deliverer: async (): Promise<DeliveryResult> => ({ success: true }),
      sleep: async () => {},
      client: mockClient,
      channelPost: {
        deliverer: cpDeliverer,
        sleep: async () => {},
      },
    });

    assert.notStrictEqual(updatedArgs, null);
    assert.deepStrictEqual(updatedArgs.where, {
      interactionLogId: "log_123",
      type: "CHANNEL_POST",
    });
    assert.strictEqual(updatedArgs.data.status, "FAILED");
    assert.strictEqual(updatedArgs.data.attempts, 3);
    assert.ok(updatedArgs.data.completedAt instanceof Date);
    assert.strictEqual(
      updatedArgs.data.lastError,
      "Discord API channel post error: 500"
    );
  });
});
