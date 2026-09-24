import test from "node:test";
import assert from "node:assert";
import { deliverInteractionResponse } from "./deliver-interaction-response";

test("deliverInteractionResponse helper tests", async (t) => {
  const originalFetch = global.fetch;

  t.after(() => {
    global.fetch = originalFetch;
  });

  await t.test("1. Successful response update returns success: true", async () => {
    let requestedUrl = "";
    let requestOptions: any = null;

    global.fetch = async (url: any, options: any) => {
      requestedUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({ id: "msg_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await deliverInteractionResponse({
      applicationId: "app_123",
      interactionToken: "token_abc",
      payload: { content: "Updated response text" },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(
      requestedUrl,
      "https://discord.com/api/v10/webhooks/app_123/token_abc/messages/@original"
    );
    assert.strictEqual(requestOptions.method, "PATCH");
    assert.ok(requestOptions.signal instanceof AbortSignal);
    assert.strictEqual(
      requestOptions.body,
      JSON.stringify({ content: "Updated response text" })
    );
    // Verify no bot token or secrets are used in headers
    assert.strictEqual(requestOptions.headers["Authorization"], undefined);
  });

  await t.test("2. HTTP 429 is classified as transient", async () => {
    global.fetch = async () =>
      new Response("Rate limited", { status: 429 });

    const result = await deliverInteractionResponse({
      applicationId: "app_123",
      interactionToken: "token_abc",
      payload: { content: "test" },
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.category, "transient");
      assert.strictEqual(result.status, 429);
    }
  });

  await t.test("3. HTTP 5xx is classified as transient", async () => {
    global.fetch = async () =>
      new Response("Internal Server Error", { status: 500 });

    const result = await deliverInteractionResponse({
      applicationId: "app_123",
      interactionToken: "token_abc",
      payload: { content: "test" },
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.category, "transient");
      assert.strictEqual(result.status, 500);
    }
  });

  await t.test("4. Other 4xx (e.g. 400, 404) is classified as permanent", async () => {
    global.fetch = async () =>
      new Response("Bad Request", { status: 400 });

    const result = await deliverInteractionResponse({
      applicationId: "app_123",
      interactionToken: "token_abc",
      payload: { content: "test" },
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.category, "permanent");
      assert.strictEqual(result.status, 400);
    }
  });

  await t.test("5. Timeout error is classified as timeout", async () => {
    global.fetch = async () => {
      const err: any = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    };

    const result = await deliverInteractionResponse({
      applicationId: "app_123",
      interactionToken: "token_abc",
      payload: { content: "test" },
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.category, "timeout");
    }
  });

  await t.test("6. Network failure is classified as network", async () => {
    global.fetch = async () => {
      throw new Error("Network offline");
    };

    const result = await deliverInteractionResponse({
      applicationId: "app_123",
      interactionToken: "token_abc",
      payload: { content: "test" },
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.category, "network");
    }
  });
});
