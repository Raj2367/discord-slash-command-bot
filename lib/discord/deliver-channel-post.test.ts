import test from "node:test";
import assert from "node:assert";
import { deliverChannelPost } from "./deliver-channel-post";

test("deliverChannelPost helper tests", async (t) => {
  const originalFetch = global.fetch;

  t.after(() => {
    global.fetch = originalFetch;
  });

  await t.test("1. Successful channel post returns success: true", async () => {
    let requestedUrl = "";
    let requestOptions: any = null;

    global.fetch = async (url: any, options: any) => {
      requestedUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({ id: "msg_chan_1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await deliverChannelPost({
      botToken: "secret_bot_token_123",
      channelId: "chan_999",
      payload: { content: "Channel announcement" },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(
      requestedUrl,
      "https://discord.com/api/v10/channels/chan_999/messages"
    );
    assert.strictEqual(requestOptions.method, "POST");
    assert.ok(requestOptions.signal instanceof AbortSignal);
    assert.strictEqual(
      requestOptions.headers["Authorization"],
      "Bot secret_bot_token_123"
    );
    assert.strictEqual(
      requestOptions.body,
      JSON.stringify({ content: "Channel announcement" })
    );
  });

  await t.test("2. HTTP 429 is classified as transient", async () => {
    global.fetch = async () => new Response("Rate limited", { status: 429 });

    const result = await deliverChannelPost({
      botToken: "token",
      channelId: "chan",
      payload: { content: "test" },
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.category, "transient");
      assert.strictEqual(result.status, 429);
    }
  });

  await t.test("3. HTTP 5xx is classified as transient", async () => {
    global.fetch = async () => new Response("Server error", { status: 503 });

    const result = await deliverChannelPost({
      botToken: "token",
      channelId: "chan",
      payload: { content: "test" },
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.category, "transient");
      assert.strictEqual(result.status, 503);
    }
  });

  await t.test("4. Other 4xx is classified as permanent", async () => {
    global.fetch = async () => new Response("Forbidden", { status: 403 });

    const result = await deliverChannelPost({
      botToken: "token",
      channelId: "chan",
      payload: { content: "test" },
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.category, "permanent");
      assert.strictEqual(result.status, 403);
    }
  });

  await t.test("5. Timeout is classified as timeout", async () => {
    global.fetch = async () => {
      const err: any = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    };

    const result = await deliverChannelPost({
      botToken: "token",
      channelId: "chan",
      payload: { content: "test" },
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.category, "timeout");
    }
  });

  await t.test("6. Network failure is classified as network", async () => {
    global.fetch = async () => {
      throw new Error("Network error");
    };

    const result = await deliverChannelPost({
      botToken: "token",
      channelId: "chan",
      payload: { content: "test" },
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.category, "network");
    }
  });
});
