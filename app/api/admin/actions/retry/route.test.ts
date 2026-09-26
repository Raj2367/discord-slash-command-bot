import test from "node:test";
import assert from "node:assert";
import { getAdminSession as originalGetAdminSession } from "@/lib/auth/session";
import { __setGetSession } from "@/lib/auth/retry-session";
import { prisma } from "@/lib/db";
import { POST } from "./route";

const originalFindUnique = prisma.actionRecord.findUnique;
const originalUpdateMany = prisma.actionRecord.updateMany;
const originalDiscordServerConfigFindUnique = (prisma as any).discordServerConfig?.findUnique;

const setDiscordServerConfigFindUnique = (fn: any) => {
  if (!(prisma as any).discordServerConfig) {
    (prisma as any).discordServerConfig = {};
  }
  (prisma as any).discordServerConfig.findUnique = fn;
};

const makeAction = (overrides: any = {}) => ({
  id: "act_1",
  interactionLogId: "log_123",
  type: "CHANNEL_POST",
  status: "FAILED",
  attempts: 1,
  lastError: null,
  result: { message: "x" },
  createdAt: new Date(),
  completedAt: null,
  updatedAt: new Date(),
  interactionLog: {
    id: "log_123",
    guildId: "guild_123",
    commandName: "status",
  },
  ...overrides,
});

const setSession = (fn: any) => {
  __setGetSession(fn);
};

const setFindUnique = (fn: any) => {
  // @ts-ignore
  prisma.actionRecord.findUnique = fn;
};

const setUpdateMany = (fn: any) => {
  // @ts-ignore
  prisma.actionRecord.updateMany = fn;
};

const setRetryChannelPost = (fn: any) => {
  (prisma as any).__setRetryChannelPost(fn);
};

const setRetryMirror = (fn: any) => {
  (prisma as any).__setRetryMirror(fn);
};

// Helper: configure updateMany to return count=1 and capture args
const setupClaimSuccess = (capture?: (args: any) => void) => {
  setUpdateMany(async (args: any) => {
    capture?.(args);
    return { count: 1 };
  });
};

// Helper: track updateMany calls for CHANNEL_POST delivery tests
const trackUpdateMany = (capture?: (args: any) => void) => {
  const calls: any[] = [];
  setUpdateMany(async (args: any) => {
    calls.push(args);
    capture?.(args);
    return { count: 1 };
  });
  return calls;
};

test("admin actions retry API route tests", async (t) => {
  t.after(() => {
    __setGetSession(originalGetAdminSession);
    prisma.actionRecord.findUnique = originalFindUnique;
    prisma.actionRecord.updateMany = originalUpdateMany;
    if (originalDiscordServerConfigFindUnique) {
      (prisma as any).discordServerConfig.findUnique = originalDiscordServerConfigFindUnique;
    } else {
      delete (prisma as any).discordServerConfig;
    }
  });

  const authed = async () => ({ adminId: "admin_1" });

  await t.test("1. unauthenticated -> 401", async () => {
    setSession(async () => null);
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 401);
  });

  await t.test("2. missing actionId -> 400", async () => {
    setSession(authed);
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("3. non-string actionId -> 400", async () => {
    setSession(authed);
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: 123 }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("4. unknown action -> 404", async () => {
    setSession(authed);
    setFindUnique(async () => null);
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 404);
  });

  await t.test("5. DISCORD_RESPONSE -> 400 and never reaches updateMany", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({ type: "DISCORD_RESPONSE", status: "FAILED" })
    );
    setUpdateMany(async () => {
      throw new Error("updateMany should not be called for DISCORD_RESPONSE");
    });
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("6. FAILED CHANNEL_POST -> claimed PENDING then delivery executed", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({ type: "CHANNEL_POST", status: "FAILED" })
    );
    process.env.DISCORD_BOT_TOKEN = "fake_bot_token";
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: "chan_123",
      mirrorType: null,
      mirrorWebhookUrl: null,
    }));
    setRetryChannelPost(async () => {
      return { success: true, attempts: 1 };
    });
    let updateArgs: any = null;
    const calls: any[] = [];
    setUpdateMany(async (args: any) => {
      calls.push(args);
      if (args.data.status === "PENDING") {
        updateArgs = args;
      }
      return { count: 1 };
    });
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(updateArgs.where.id, "act_1");
    assert.ok(Array.isArray(updateArgs.where.OR));
    assert.strictEqual(updateArgs.where.OR.length, 2);
    assert.deepStrictEqual(updateArgs.where.OR[0], { status: "FAILED" });
    assert.strictEqual(updateArgs.where.OR[1].status, "PENDING");
    assert.ok(updateArgs.where.OR[1].updatedAt.lt instanceof Date);
    assert.strictEqual(updateArgs.data.status, "PENDING");
    assert.strictEqual(updateArgs.data.attempts, 0);
    assert.strictEqual(updateArgs.data.completedAt, null);
    assert.strictEqual(updateArgs.data.lastError, null);
    assert.ok(!("result" in updateArgs.data));
    process.env.DISCORD_BOT_TOKEN = "fake_bot_token";
  });

  await t.test("7. FAILED MIRROR -> successfully claimed", async () => {
    setSession(authed);
    setFindUnique(async () => makeAction({ type: "MIRROR", status: "FAILED" }));
    setDiscordServerConfigFindUnique(async () => null);
    let retryCalled = false;
    setRetryMirror(async () => {
      retryCalled = true;
      return { success: true, attempts: 1 };
    });
    let updateArgs: any = null;
    const calls: any[] = [];
    setUpdateMany(async (args: any) => {
      calls.push(args);
      if (args.data.status === "PENDING") {
        updateArgs = args;
      }
      return { count: 1 };
    });
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.deepStrictEqual(data, {
      eligible: true,
      claimed: true,
      actionId: "act_1",
      type: "MIRROR",
      status: "FAILED",
    });
    assert.strictEqual(updateArgs.data.status, "PENDING");
    assert.strictEqual(updateArgs.data.attempts, 0);
    assert.strictEqual(updateArgs.data.completedAt, null);
    assert.strictEqual(updateArgs.data.lastError, null);
    assert.strictEqual(retryCalled, false);
    const failCall = calls[calls.length - 1];
    assert.strictEqual(failCall.data.status, "FAILED");
    assert.strictEqual(failCall.data.lastError, "Discord mirror is not configured");
  });

  await t.test("8. stale PENDING -> successfully claimed", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({
        type: "CHANNEL_POST",
        status: "PENDING",
        updatedAt: new Date(Date.now() - 5 * 60 * 1000),
      })
    );
    process.env.DISCORD_BOT_TOKEN = "fake_bot_token";
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: "chan_123",
      mirrorType: null,
      mirrorWebhookUrl: null,
    }));
    setRetryChannelPost(async () => {
      return { success: true, attempts: 1 };
    });
    let updateArgs: any = null;
    const calls: any[] = [];
    setUpdateMany(async (args: any) => {
      calls.push(args);
      if (args.data.status === "PENDING") {
        updateArgs = args;
      }
      return { count: 1 };
    });
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(updateArgs.data.status, "PENDING");
    process.env.DISCORD_BOT_TOKEN = "fake_bot_token";
  });

  await t.test("9. fresh PENDING -> 409 and updateMany not called", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({ type: "MIRROR", status: "PENDING", updatedAt: new Date() })
    );
    setUpdateMany(async () => {
      throw new Error("updateMany should not be called for fresh PENDING");
    });
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 409);
  });

  await t.test("10. SUCCESS -> 409 and updateMany not called", async () => {
    setSession(authed);
    setFindUnique(async () => makeAction({ type: "MIRROR", status: "SUCCESS" }));
    setUpdateMany(async () => {
      throw new Error("updateMany should not be called for SUCCESS");
    });
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 409);
  });

  await t.test("11. already-claimed action (count 0) -> 409", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({ type: "CHANNEL_POST", status: "FAILED" })
    );
    setUpdateMany(async () => ({ count: 0 }));
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.deepStrictEqual(data, {
      eligible: false,
      actionId: "act_1",
      type: "CHANNEL_POST",
    });
  });

  await t.test("12. claim does not modify result", async () => {
    setSession(authed);
    const savedResult = { message: "persisted snapshot", ai: "summary" };
    setFindUnique(async () =>
      makeAction({ type: "MIRROR", status: "FAILED", result: savedResult })
    );
    let updateArgs: any = null;
    setupClaimSuccess((args) => {
      updateArgs = args;
    });
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    assert.ok(!("result" in updateArgs.data));
  });

  await t.test("13. CHANNEL_POST missing config -> FAILED with config error", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({
        type: "CHANNEL_POST",
        status: "FAILED",
        result: { message: "test channel message" },
      })
    );
    setDiscordServerConfigFindUnique(async () => null);
    const calls = trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.actionId, "act_1");
    assert.strictEqual(data.type, "CHANNEL_POST");
    assert.strictEqual(data.status, "FAILED");
    assert.strictEqual(data.eligible, true);
    assert.strictEqual(data.claimed, true);
    assert.ok(calls.length >= 2);
    const claimCall = calls[0];
    assert.strictEqual(claimCall.data.status, "PENDING");
    const failCall = calls[calls.length - 1];
    assert.strictEqual(failCall.data.status, "FAILED");
    assert.strictEqual(failCall.data.lastError, "Discord channel post is not configured");
    assert.ok(failCall.data.completedAt instanceof Date);
  });

  await t.test("14. CHANNEL_POST missing channelId in config -> FAILED with config error", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({
        type: "CHANNEL_POST",
        status: "FAILED",
        result: { message: "test channel message" },
      })
    );
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: null,
      mirrorType: null,
      mirrorWebhookUrl: null,
    }));
    const calls = trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, "FAILED");
    const failCall = calls[calls.length - 1];
    assert.strictEqual(failCall.data.lastError, "Discord channel post is not configured");
  });

  await t.test("15. CHANNEL_POST missing botToken -> FAILED with config error", async () => {
    setSession(authed);
    process.env.DISCORD_BOT_TOKEN = "";
    setFindUnique(async () =>
      makeAction({
        type: "CHANNEL_POST",
        status: "FAILED",
        result: { message: "test channel message" },
      })
    );
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: "chan_123",
      mirrorType: null,
      mirrorWebhookUrl: null,
    }));
    const calls = trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, "FAILED");
    const failCall = calls[calls.length - 1];
    assert.strictEqual(failCall.data.lastError, "Discord channel post is not configured");
    process.env.DISCORD_BOT_TOKEN = "fake_bot_token";
  });

  await t.test("16. CHANNEL_POST invalid result.message -> FAILED with snapshot error", async () => {
    setSession(authed);
    process.env.DISCORD_BOT_TOKEN = "fake_bot_token";
    setFindUnique(async () =>
      makeAction({
        type: "CHANNEL_POST",
        status: "FAILED",
        result: { something: "else" },
      })
    );
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: "chan_123",
      mirrorType: null,
      mirrorWebhookUrl: null,
    }));
    const calls = trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, "FAILED");
    const failCall = calls[calls.length - 1];
    assert.strictEqual(failCall.data.lastError, "Stored channel post snapshot is invalid");
  });

  await t.test("17. CHANNEL_POST retryChannelPost success -> SUCCESS", async () => {
    setSession(authed);
    process.env.DISCORD_BOT_TOKEN = "fake_bot_token";
    setFindUnique(async () =>
      makeAction({
        type: "CHANNEL_POST",
        status: "FAILED",
        result: { message: "test channel message" },
      })
    );
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: "chan_123",
      mirrorType: null,
      mirrorWebhookUrl: null,
    }));
    let retryInput: any = null;
    setRetryChannelPost(async (input: any) => {
      retryInput = input;
      return { success: true, attempts: 1 };
    });
    const calls = trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, "SUCCESS");
    assert.strictEqual(retryInput.channelId, "chan_123");
    assert.strictEqual(retryInput.botToken, "fake_bot_token");
    assert.strictEqual(retryInput.message, "test channel message");
    const successCall = calls[calls.length - 1];
    assert.strictEqual(successCall.data.status, "SUCCESS");
    assert.strictEqual(successCall.data.attempts, 1);
    assert.strictEqual(successCall.data.lastError, null);
  });

  await t.test("18. CHANNEL_POST retryChannelPost failure -> FAILED with error", async () => {
    setSession(authed);
    process.env.DISCORD_BOT_TOKEN = "fake_bot_token";
    setFindUnique(async () =>
      makeAction({
        type: "CHANNEL_POST",
        status: "FAILED",
        result: { message: "test channel message" },
      })
    );
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: "chan_123",
      mirrorType: null,
      mirrorWebhookUrl: null,
    }));
    setRetryChannelPost(async () => {
      return {
        success: false,
        category: "transient",
        status: 500,
        error: "Discord API server error",
        attempts: 3,
      };
    });
    const calls = trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, "FAILED");
    const failCall = calls[calls.length - 1];
    assert.strictEqual(failCall.data.status, "FAILED");
    assert.strictEqual(failCall.data.attempts, 3);
    assert.strictEqual(failCall.data.lastError, "Discord API server error");
  });

  await t.test("19. CHANNEL_POST retryChannelPost throws -> FAILED with thrown error", async () => {
    setSession(authed);
    process.env.DISCORD_BOT_TOKEN = "fake_bot_token";
    setFindUnique(async () =>
      makeAction({
        type: "CHANNEL_POST",
        status: "FAILED",
        result: { message: "test channel message" },
      })
    );
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: "chan_123",
      mirrorType: null,
      mirrorWebhookUrl: null,
    }));
    setRetryChannelPost(async () => {
      throw new Error("Unexpected retry error");
    });
    const calls = trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, "FAILED");
    const failCall = calls[calls.length - 1];
    assert.strictEqual(failCall.data.status, "FAILED");
    assert.strictEqual(failCall.data.lastError, "Unexpected retry error");
  });

  await t.test("20. valid claimed MIRROR + stored message -> retryMirror success -> MIRROR SUCCESS", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({
        type: "MIRROR",
        status: "FAILED",
        result: { message: "mirror test message" },
      })
    );
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: null,
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
    }));
    let retryInput: any = null;
    setRetryMirror(async (input: any) => {
      retryInput = input;
      return { success: true, attempts: 1 };
    });
    const calls = trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, "SUCCESS");
    assert.strictEqual(data.actionId, "act_1");
    assert.strictEqual(data.type, "MIRROR");
    assert.strictEqual(retryInput.webhookUrl, "https://discord.com/api/webhooks/test");
    assert.strictEqual(retryInput.message, "mirror test message");
    const successCall = calls[calls.length - 1];
    assert.strictEqual(successCall.data.status, "SUCCESS");
    assert.strictEqual(successCall.data.attempts, 1);
    assert.strictEqual(successCall.data.lastError, null);
  });

  await t.test("21. retryMirror final failure -> MIRROR FAILED with returned attempts/error", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({
        type: "MIRROR",
        status: "FAILED",
        result: { message: "mirror test message" },
      })
    );
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: null,
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
    }));
    setRetryMirror(async () => {
      return {
        success: false,
        category: "transient",
        status: 500,
        error: "Mirror API server error",
        attempts: 3,
      };
    });
    const calls = trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, "FAILED");
    const failCall = calls[calls.length - 1];
    assert.strictEqual(failCall.data.status, "FAILED");
    assert.strictEqual(failCall.data.attempts, 3);
    assert.strictEqual(failCall.data.lastError, "Mirror API server error");
  });

  await t.test("22. missing DiscordServerConfig -> FAILED without retryMirror", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({
        type: "MIRROR",
        status: "FAILED",
        result: { message: "mirror test message" },
      })
    );
    setDiscordServerConfigFindUnique(async () => null);
    let retryCalled = false;
    setRetryMirror(async () => {
      retryCalled = true;
      return { success: true, attempts: 1 };
    });
    const calls = trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, "FAILED");
    assert.strictEqual(retryCalled, false);
    const failCall = calls[calls.length - 1];
    assert.strictEqual(failCall.data.status, "FAILED");
    assert.strictEqual(failCall.data.lastError, "Discord mirror is not configured");
  });

  await t.test("23. mirrorType missing/unsupported -> FAILED without retryMirror", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({
        type: "MIRROR",
        status: "FAILED",
        result: { message: "mirror test message" },
      })
    );
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: null,
      mirrorType: "SLACK_WEBHOOK",
      mirrorWebhookUrl: "https://hooks.slack.com/test",
    }));
    let retryCalled = false;
    setRetryMirror(async () => {
      retryCalled = true;
      return { success: true, attempts: 1 };
    });
    const calls = trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, "FAILED");
    assert.strictEqual(retryCalled, false);
    const failCall = calls[calls.length - 1];
    assert.strictEqual(failCall.data.lastError, "Discord mirror is not configured");
  });

  await t.test("24. missing webhook URL -> FAILED without retryMirror", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({
        type: "MIRROR",
        status: "FAILED",
        result: { message: "mirror test message" },
      })
    );
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: null,
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: null,
    }));
    let retryCalled = false;
    setRetryMirror(async () => {
      retryCalled = true;
      return { success: true, attempts: 1 };
    });
    const calls = trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, "FAILED");
    assert.strictEqual(retryCalled, false);
    const failCall = calls[calls.length - 1];
    assert.strictEqual(failCall.data.lastError, "Discord mirror is not configured");
  });

  await t.test("25. invalid/missing stored message -> FAILED without retryMirror", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({
        type: "MIRROR",
        status: "FAILED",
        result: { something: "else" },
      })
    );
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: null,
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
    }));
    let retryCalled = false;
    setRetryMirror(async () => {
      retryCalled = true;
      return { success: true, attempts: 1 };
    });
    const calls = trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, "FAILED");
    assert.strictEqual(retryCalled, false);
    const failCall = calls[calls.length - 1];
    assert.strictEqual(failCall.data.lastError, "Stored mirror snapshot is invalid");
  });

  await t.test("26. unexpected retryMirror throw -> FAILED with attempts 0", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({
        type: "MIRROR",
        status: "FAILED",
        result: { message: "mirror test message" },
      })
    );
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: null,
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
    }));
    setRetryMirror(async () => {
      throw new Error("Unexpected mirror retry error");
    });
    const calls = trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, "FAILED");
    const failCall = calls[calls.length - 1];
    assert.strictEqual(failCall.data.status, "FAILED");
    assert.strictEqual(failCall.data.attempts, 0);
    assert.strictEqual(failCall.data.lastError, "Unexpected mirror retry error");
  });

  await t.test("27. exact stored result.message passed to retryMirror()", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({
        type: "MIRROR",
        status: "FAILED",
        result: { message: "<<exact stored message>>" },
      })
    );
    setDiscordServerConfigFindUnique(async () => ({
      guildId: "guild_123",
      guildName: "Test",
      channelId: null,
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
    }));
    let retryInput: any = null;
    setRetryMirror(async (input: any) => {
      retryInput = input;
      return { success: true, attempts: 1 };
    });
    trackUpdateMany();
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    await POST(req);
    assert.strictEqual(retryInput.message, "<<exact stored message>>");
  });
});
