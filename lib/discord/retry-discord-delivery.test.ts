import test from "node:test";
import assert from "node:assert";
import { retryDiscordDelivery } from "./retry-discord-delivery";
import { DeliveryResult } from "./deliver-interaction-response";

test("retryDiscordDelivery wrapper tests with attempts count", async (t) => {
  const input = {
    applicationId: "app_123",
    interactionToken: "token_abc",
    payload: { content: "test" },
  };

  await t.test("1. First attempt succeeds -> attempts = 1, 0 sleeps", async () => {
    let callCount = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<DeliveryResult> => {
      callCount++;
      return { success: true };
    };

    const sleep = async (ms: number) => {
      slept.push(ms);
    };

    const result = await retryDiscordDelivery(input, { deliverer, sleep });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(slept.length, 0);
  });

  await t.test("2. Transient failure then success -> attempts = 2, 1 sleep (1000ms)", async () => {
    let callCount = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<DeliveryResult> => {
      callCount++;
      if (callCount === 1) {
        return { success: false, category: "transient", status: 500 };
      }
      return { success: true };
    };

    const sleep = async (ms: number) => {
      slept.push(ms);
    };

    const result = await retryDiscordDelivery(input, { deliverer, sleep });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 2);
    assert.strictEqual(callCount, 2);
    assert.deepStrictEqual(slept, [1000]);
  });

  await t.test("3. Two transient failures then success -> attempts = 3, sleeps [1000, 3000]", async () => {
    let callCount = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<DeliveryResult> => {
      callCount++;
      if (callCount < 3) {
        return { success: false, category: "timeout" };
      }
      return { success: true };
    };

    const sleep = async (ms: number) => {
      slept.push(ms);
    };

    const result = await retryDiscordDelivery(input, { deliverer, sleep });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 3);
    assert.strictEqual(callCount, 3);
    assert.deepStrictEqual(slept, [1000, 3000]);
  });

  await t.test("4. Three transient failures -> attempts = 3, returns final failure, sleeps [1000, 3000]", async () => {
    let callCount = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<DeliveryResult> => {
      callCount++;
      return { success: false, category: "network" };
    };

    const sleep = async (ms: number) => {
      slept.push(ms);
    };

    const result = await retryDiscordDelivery(input, { deliverer, sleep });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.category, "network");
    }
    assert.strictEqual(result.attempts, 3);
    assert.strictEqual(callCount, 3);
    assert.deepStrictEqual(slept, [1000, 3000]);
  });

  await t.test("5. Permanent 4xx -> attempts = 1, no retry, no sleep", async () => {
    let callCount = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<DeliveryResult> => {
      callCount++;
      return { success: false, category: "permanent", status: 400 };
    };

    const sleep = async (ms: number) => {
      slept.push(ms);
    };

    const result = await retryDiscordDelivery(input, { deliverer, sleep });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.category, "permanent");
      assert.strictEqual(result.status, 400);
    }
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(slept.length, 0);
  });
});
