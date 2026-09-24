import test from "node:test";
import assert from "node:assert";
import { retryChannelPost } from "./retry-channel-post";
import { ChannelPostDeliveryResult } from "./deliver-channel-post";

test("retryChannelPost wrapper tests", async (t) => {
  const input = {
    botToken: "bot_123",
    channelId: "chan_456",
    payload: { content: "test announcement" },
  };

  await t.test("1. Immediate success -> attempts = 1, 0 sleeps", async () => {
    let callCount = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<ChannelPostDeliveryResult> => {
      callCount++;
      return { success: true };
    };

    const sleep = async (ms: number) => {
      slept.push(ms);
    };

    const result = await retryChannelPost(input, { deliverer, sleep });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(slept.length, 0);
  });

  await t.test("2. Transient failure (429/5xx/timeout) then success -> attempts = 2, sleeps [1000]", async () => {
    let callCount = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<ChannelPostDeliveryResult> => {
      callCount++;
      if (callCount === 1) {
        return { success: false, category: "transient", status: 429 };
      }
      return { success: true };
    };

    const sleep = async (ms: number) => {
      slept.push(ms);
    };

    const result = await retryChannelPost(input, { deliverer, sleep });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 2);
    assert.deepStrictEqual(slept, [1000]);
  });

  await t.test("3. Two transient failures (network/timeout) then success -> attempts = 3, sleeps [1000, 3000]", async () => {
    let callCount = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<ChannelPostDeliveryResult> => {
      callCount++;
      if (callCount < 3) {
        return { success: false, category: "timeout" };
      }
      return { success: true };
    };

    const sleep = async (ms: number) => {
      slept.push(ms);
    };

    const result = await retryChannelPost(input, { deliverer, sleep });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 3);
    assert.deepStrictEqual(slept, [1000, 3000]);
  });

  await t.test("4. Three transient failures -> attempts = 3, returns final failure, sleeps [1000, 3000]", async () => {
    let callCount = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<ChannelPostDeliveryResult> => {
      callCount++;
      return { success: false, category: "network" };
    };

    const sleep = async (ms: number) => {
      slept.push(ms);
    };

    const result = await retryChannelPost(input, { deliverer, sleep });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.category, "network");
    }
    assert.strictEqual(result.attempts, 3);
    assert.deepStrictEqual(slept, [1000, 3000]);
  });

  await t.test("5. Permanent 4xx -> attempts = 1, no retry, no sleep", async () => {
    let callCount = 0;
    const slept: number[] = [];

    const deliverer = async (): Promise<ChannelPostDeliveryResult> => {
      callCount++;
      return { success: false, category: "permanent", status: 403 };
    };

    const sleep = async (ms: number) => {
      slept.push(ms);
    };

    const result = await retryChannelPost(input, { deliverer, sleep });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.category, "permanent");
      assert.strictEqual(result.status, 403);
    }
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(slept.length, 0);
  });
});
