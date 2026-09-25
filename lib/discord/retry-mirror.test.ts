import test from "node:test";
import assert from "node:assert";
import { retryMirror } from "./retry-mirror";
import { DeliveryResult } from "./deliver-interaction-response";

test("retryMirror service tests", async (t) => {
  await t.test("1. Immediate success -> attempts = 1, 0 sleeps", async () => {
    const sleepCalls: number[] = [];
    const deliverer = async (): Promise<DeliveryResult> => ({ success: true });
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    const result = await retryMirror(
      { webhookUrl: "https://example/webhook", message: "hi" },
      { deliverer, sleep }
    );

    assert.deepStrictEqual(result, { success: true, attempts: 1 });
    assert.deepStrictEqual(sleepCalls, []);
  });

  await t.test("2. Transient failure then success -> attempts = 2, sleeps [1000]", async () => {
    const sleepCalls: number[] = [];
    let attempts = 0;
    const deliverer = async (): Promise<DeliveryResult> => {
      attempts++;
      if (attempts < 2) {
        return {
          success: false,
          category: "transient",
          status: 500,
          error: "Discord API transient error: 500",
        };
      }
      return { success: true };
    };
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    const result = await retryMirror(
      { webhookUrl: "https://example/webhook", message: "hi" },
      { deliverer, sleep }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 2);
    assert.deepStrictEqual(sleepCalls, [1000]);
  });

  await t.test("3. Timeout is retried (not stopped) -> succeeds after a timeout", async () => {
    const sleepCalls: number[] = [];
    let attempts = 0;
    const deliverer = async (): Promise<DeliveryResult> => {
      attempts++;
      if (attempts < 2) {
        return { success: false, category: "timeout", error: "Request timed out" };
      }
      return { success: true };
    };
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    const result = await retryMirror(
      { webhookUrl: "https://example/webhook", message: "hi" },
      { deliverer, sleep }
    );

    if (!result.success) {
      assert.fail("expected success");
    }
    assert.strictEqual(result.attempts, 2);
    assert.deepStrictEqual(sleepCalls, [1000]);
  });

  await t.test("4. Permanent failure stops immediately -> attempts = 1, 0 sleeps", async () => {
    const sleepCalls: number[] = [];
    const deliverer = async (): Promise<DeliveryResult> => ({
      success: false,
      category: "permanent",
      status: 400,
      error: "Discord API permanent error: 400",
    });
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    const result = await retryMirror(
      { webhookUrl: "https://example/webhook", message: "hi" },
      { deliverer, sleep }
    );

    if (result.success) {
      assert.fail("expected failure");
    }
    assert.strictEqual((result as any).category, "permanent");
    assert.strictEqual(result.attempts, 1);
    assert.deepStrictEqual(sleepCalls, []);
  });

  await t.test("5. All 3 attempts exhausted -> attempts = 3, sleeps [1000, 3000]", async () => {
    const sleepCalls: number[] = [];
    const deliverer = async (): Promise<DeliveryResult> => ({
      success: false,
      category: "network",
      error: "Network error during mirror delivery",
    });
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    const result = await retryMirror(
      { webhookUrl: "https://example/webhook", message: "hi" },
      { deliverer, sleep }
    );

    if (result.success) {
      assert.fail("expected failure");
    }
    assert.strictEqual((result as any).category, "network");
    assert.strictEqual(result.attempts, 3);
    assert.deepStrictEqual(sleepCalls, [1000, 3000]);
  });
});
