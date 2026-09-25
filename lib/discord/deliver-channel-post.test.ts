import test from "node:test";
import assert from "node:assert";
import { deliverChannelPost, DeliverChannelPostInput } from "./deliver-channel-post";

const BASE_INPUT: DeliverChannelPostInput = {
  channelId: "123456789",
  botToken: "test_bot_token_xyz",
  message: "System status: all systems nominal",
};

function fakeFetch(): {
  calls: any[];
  setHandler: (fn: (input: any) => Promise<any>) => void;
} {
  const calls: any[] = [];
  let handler: ((input: any) => Promise<any>) | null = null;

  const fn = async (input: any) => {
    calls.push(input);
    if (!handler) {
      throw new Error("no handler set");
    }
    return handler(input);
  };

  (fn as any).calls = calls;
  (fn as any).setHandler = (h: (input: any) => Promise<any>) => {
    handler = h;
  };

  return {
    calls,
    setHandler: (handler) => {
      (fn as any).currentHandler = handler;
    },
  };
}

test("deliverChannelPost service tests", async (t) => {
  await t.test("1. Successful delivery returns { success: true }", async () => {
    const calls: any[] = [];

    const deliverer = async (input: RequestInfo | URL) => {
      calls.push(input);
      return {
        ok: true,
        status: 200,
      };
    };

    const origFetch = global.fetch;
    (global as any).fetch = deliverer;

    try {
      const result = await deliverChannelPost(BASE_INPUT);
      assert.strictEqual(result.success, true);
    } finally {
      (global as any).fetch = origFetch;
    }
  });

  await t.test("2. Permanent HTTP failure returns category permanent with status", async () => {
    const deliverer = async () => {
      return {
        ok: false,
        status: 400,
      };
    };

    const origFetch = global.fetch;
    (global as any).fetch = deliverer;

    try {
      const result = await deliverChannelPost(BASE_INPUT);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.category, "permanent");
        assert.strictEqual(result.status, 400);
      }
    } finally {
      (global as any).fetch = origFetch;
    }
  });

  await t.test("3. Timeout/network failure returns category timeout or network", async () => {
    const deliverer = async () => {
      const err: any = new Error("aborted");
      err.name = "AbortError";
      throw err;
    };

    const origFetch = global.fetch;
    (global as any).fetch = deliverer;

    try {
      const result = await deliverChannelPost(BASE_INPUT);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.category, "timeout");
      }
    } finally {
      (global as any).fetch = origFetch;
    }
  });

  await t.test("4. allowed_mentions is present in the request body", async () => {
    let capturedBody: any = null;

    const deliverer = async (url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return { ok: true, status: 200 };
    };

    const origFetch = global.fetch;
    (global as any).fetch = deliverer;

    try {
      await deliverChannelPost(BASE_INPUT);
      assert.notStrictEqual(capturedBody, null);
      assert.deepStrictEqual(capturedBody.allowed_mentions, { parse: [] });
      assert.strictEqual(capturedBody.content, BASE_INPUT.message);
    } finally {
      (global as any).fetch = origFetch;
    }
  });

  await t.test("5. Bot token is supplied through the Authorization header", async () => {
    let capturedAuth: string | null = null;

    const deliverer = async (url: any, init: any) => {
      capturedAuth = init.headers.Authorization;
      return { ok: true, status: 200 };
    };

    const origFetch = global.fetch;
    (global as any).fetch = deliverer;

    try {
      await deliverChannelPost(BASE_INPUT);
      assert.strictEqual(capturedAuth, `Bot ${BASE_INPUT.botToken}`);
    } finally {
      (global as any).fetch = origFetch;
    }
  });

  await t.test("6. Missing channelId or botToken returns permanent failure", async () => {
    const origFetch = global.fetch;
    (global as any).fetch = async () => {
      throw new Error("fetch should not be called");
    };

    try {
      const result = await deliverChannelPost({
        channelId: "",
        botToken: BASE_INPUT.botToken,
        message: BASE_INPUT.message,
      });
      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.category, "permanent");
        assert.strictEqual(result.status, 400);
      }
    } finally {
      (global as any).fetch = origFetch;
    }
  });

  await t.test("7. Transient HTTP failure (5xx) returns category transient", async () => {
    const deliverer = async () => {
      return {
        ok: false,
        status: 503,
      };
    };

    const origFetch = global.fetch;
    (global as any).fetch = deliverer;

    try {
      const result = await deliverChannelPost(BASE_INPUT);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.category, "transient");
        assert.strictEqual(result.status, 503);
      }
    } finally {
      (global as any).fetch = origFetch;
    }
  });
});
