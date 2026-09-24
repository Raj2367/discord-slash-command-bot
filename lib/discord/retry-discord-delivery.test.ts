import test from "node:test";
import assert from "node:assert";
import { retryDiscordDelivery } from "./retry-discord-delivery";
import { DeliveryResult } from "./deliver-interaction-response";

test("retryDiscordDelivery wrapper tests", async (t) => {
  const input = {
    applicationId: "app_123",
    interactionToken: "token_abc",
    payload: { content: "test" },
  };

  await t.test("1. First attempt succeeds -> exactly 1 attempt, 0 sleeps", async () => {
    let attempts = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<DeliveryResult> => {
      attempts++;
      return { success: true };
    };

    const sleep = async (ms: number) => {
      slept.push(ms);
    };

    const result = await retryDiscordDelivery(input, { deliverer, sleep });

    assert.strictEqual(result.success, true);
    assert.strictEqual(attempts, 1);
    assert.strictEqual(slept.length, 0);
  });

  await t.test("2. Transient failure then success -> 2 attempts, 1 sleep (1000ms)", async () => {
    let attempts = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<DeliveryResult> => {
      attempts++;
      if (attempts === 1) {
        return { success: false, category: "transient", status: 500 };
      }
      return { success: true };
    };

    const sleep = async (ms: number) => {
      slept.push(ms);
    };

    const result = await retryDiscordDelivery(input, { deliverer, sleep });

    assert.strictEqual(result.success, true);
    assert.strictEqual(attempts, 2);
    assert.deepStrictEqual(slept, [1000]);
  });

  await t.test("3. Transient failure twice then success -> 3 attempts, sleeps [1000, 3000]", async () => {
    let attempts = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<DeliveryResult> => {
      attempts++;
      if (attempts < 3) {
        return { success: false, category: "timeout" };
      }
      return { success: true };
    };

    const sleep = async (ms: number) => {
      slept.push(ms);
    };

    const result = await retryDiscordDelivery(input, { deliverer, sleep });

    assert.strictEqual(result.success, true);
    assert.strictEqual(attempts, 3);
    assert.deepStrictEqual(slept, [1000, 3000]);
  });

  await t.test("4. Transient failure three times -> exactly 3 attempts, returns final failure, sleeps [1000, 3000]", async () => {
    let attempts = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<DeliveryResult> => {
      attempts++;
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
    assert.strictEqual(attempts, 3);
    assert.deepStrictEqual(slept, [1000, 3000]);
  });

  await t.test("5. Permanent 4xx -> exactly 1 attempt, no retry, no sleep", async () => {
    let attempts = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<DeliveryResult> => {
      attempts++;
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
    assert.strictEqual(attempts, 1);
    assert.strictEqual(slept.length, 0);
  });
});
