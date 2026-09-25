import test from "node:test";
import assert from "node:assert";
import { deliverMirror } from "./deliver-mirror";

const originalFetch = (globalThis as any).fetch;

function setFetch(fn: (...args: any[]) => any) {
  (globalThis as any).fetch = fn;
}

function restoreFetch() {
  (globalThis as any).fetch = originalFetch;
}

test("deliverMirror service tests", async (t) => {
  await t.test("1. Successful webhook delivery returns { success: true } and uses the webhook URL", async () => {
    let calledUrl: any = null;
    let calledInit: any = null;
    setFetch(async (input: any, init: any) => {
      calledUrl = input;
      calledInit = init;
      return { ok: true, status: 204 };
    });

    try {
      const result = await deliverMirror({
        webhookUrl: "https://discord.com/api/webhooks/123/token",
        message: "hello world",
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(calledUrl, "https://discord.com/api/webhooks/123/token");
      assert.strictEqual(calledInit.method, "POST");
    } finally {
      restoreFetch();
    }
  });

  await t.test("2. 400 response is a permanent failure and does not leak the webhook URL", async () => {
    setFetch(async () => ({ ok: false, status: 400 }));

    try {
      const result: any = await deliverMirror({
        webhookUrl: "https://discord.com/api/webhooks/123/token",
        message: "hi",
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.category, "permanent");
      assert.strictEqual(result.status, 400);
      assert.ok(
        !String(result.error).includes("123") &&
          !String(result.error).includes("token"),
        "webhook URL must not appear in error"
      );
    } finally {
      restoreFetch();
    }
  });

  await t.test("3. 429 and 5xx responses are transient", async () => {
    for (const status of [429, 500, 503]) {
      setFetch(async () => ({ ok: false, status }));

      try {
        const result: any = await deliverMirror({
          webhookUrl: "https://discord.com/api/webhooks/123/token",
          message: "hi",
        });

        assert.strictEqual(result.success, false, `status ${status}`);
        assert.strictEqual(result.category, "transient", `status ${status}`);
        assert.strictEqual(result.status, status, `status ${status}`);
      } finally {
        restoreFetch();
      }
    }
  });

  await t.test("4. Timeout is classified as timeout; network failure as network", async () => {
    setFetch(async () => {
      const err: any = new Error("timeout");
      err.name = "AbortError";
      err.code = "ABORT_ERR";
      throw err;
    });

    try {
      const result: any = await deliverMirror({
        webhookUrl: "https://discord.com/api/webhooks/123/token",
        message: "hi",
      });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.category, "timeout");
    } finally {
      restoreFetch();
    }

    setFetch(async () => {
      throw new Error("boom");
    });

    try {
      const result: any = await deliverMirror({
        webhookUrl: "https://discord.com/api/webhooks/123/token",
        message: "hi",
      });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.category, "network");
    } finally {
      restoreFetch();
    }
  });

  await t.test("5. Request body contains content and allowed_mentions: { parse: [] }", async () => {
    let capturedBody: any = null;
    setFetch(async (_input: any, init: any) => {
      capturedBody = init.body;
      return { ok: true, status: 204 };
    });

    try {
      await deliverMirror({
        webhookUrl: "https://discord.com/api/webhooks/123/token",
        message: "hello world",
      });

      const parsed = JSON.parse(capturedBody);
      assert.strictEqual(parsed.content, "hello world");
      assert.deepStrictEqual(parsed.allowed_mentions, { parse: [] });
    } finally {
      restoreFetch();
    }
  });

  await t.test("6. Fetch is invoked exactly once with the supplied webhook URL", async () => {
    let callCount = 0;
    let calledUrl: any = null;
    setFetch(async (input: any) => {
      callCount++;
      calledUrl = input;
      return { ok: true, status: 204 };
    });

    try {
      await deliverMirror({
        webhookUrl: "https://discord.com/api/webhooks/abc/def",
        message: "hi",
      });

      assert.strictEqual(callCount, 1);
      assert.strictEqual(calledUrl, "https://discord.com/api/webhooks/abc/def");
    } finally {
      restoreFetch();
    }
  });
});
