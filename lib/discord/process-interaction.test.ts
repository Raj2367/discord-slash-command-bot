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

    const result = await processInteraction(baseInput, { deliverer, sleep });

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

    const result = await processInteraction(baseInput, { deliverer, sleep });

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

    const result = await processInteraction(baseInput, { deliverer, sleep });

    assert.strictEqual(result.deliveryResult.success, true);
    assert.strictEqual(result.attempts, 2);
  });

  await t.test("4. Final transient failure exposes correct attempts = 3", async () => {
    const deliverer = async (): Promise<DeliveryResult> => {
      return { success: false, category: "network" };
    };

    const sleep = async () => {};

    const result = await processInteraction(baseInput, { deliverer, sleep });

    assert.strictEqual(result.deliveryResult.success, false);
    if (!result.deliveryResult.success) {
      assert.strictEqual(result.deliveryResult.category, "network");
    }
    assert.strictEqual(result.attempts, 3);
  });

  await t.test("5. reportText input is normalized at boundary and used in payload with allowed_mentions", async () => {
    let capturedInput: any = null;
    const deliverer = async (input: any): Promise<DeliveryResult> => {
      capturedInput = input;
      return { success: true };
    };
    const sleep = async () => {};

    const reportInput = {
      ...baseInput,
      commandName: "report",
      reportText: "   Server issue report   ",
      responseSnapshot: { message: "Report logged" },
    };

    const result = await processInteraction(reportInput, { deliverer, sleep });
    assert.strictEqual(result.deliveryResult.success, true);
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(result.normalizedReportText, "Server issue report");
    assert.deepStrictEqual(capturedInput.payload, {
      content: "Report logged: Server issue report",
      allowed_mentions: { parse: [] },
    });

    const longInput = {
      ...baseInput,
      commandName: "report",
      reportText: "x".repeat(1600),
    };
    const longResult = await processInteraction(longInput, { deliverer, sleep });
    assert.strictEqual(longResult.normalizedReportText?.length, 1500);
  });
});
