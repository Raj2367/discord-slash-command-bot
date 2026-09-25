import test from "node:test";
import assert from "node:assert";
import { getAdminSession as originalGetAdminSession } from "@/lib/auth/session";
import { __setGetSession } from "@/lib/auth/retry-session";
import { prisma } from "@/lib/db";
import { POST } from "./route";

const originalFindUnique = prisma.actionRecord.findUnique;
const originalUpdateMany = prisma.actionRecord.updateMany;

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

// Helper: configure updateMany to return count=1 and capture args
const setupClaimSuccess = (capture?: (args: any) => void) => {
  setUpdateMany(async (args: any) => {
    capture?.(args);
    return { count: 1 };
  });
};

test("admin actions retry API route tests", async (t) => {
  t.after(() => {
    __setGetSession(originalGetAdminSession);
    prisma.actionRecord.findUnique = originalFindUnique;
    prisma.actionRecord.updateMany = originalUpdateMany;
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

  await t.test("6. FAILED CHANNEL_POST -> claimed, PENDING, attempts 0, completedAt null, lastError null", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({ type: "CHANNEL_POST", status: "FAILED" })
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
    const data = await res.json();
    assert.deepStrictEqual(data, {
      eligible: true,
      claimed: true,
      actionId: "act_1",
      type: "CHANNEL_POST",
    });
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
  });

  await t.test("7. FAILED MIRROR -> successfully claimed", async () => {
    setSession(authed);
    setFindUnique(async () => makeAction({ type: "MIRROR", status: "FAILED" }));
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
    const data = await res.json();
    assert.deepStrictEqual(data, {
      eligible: true,
      claimed: true,
      actionId: "act_1",
      type: "MIRROR",
    });
    assert.strictEqual(updateArgs.data.status, "PENDING");
    assert.strictEqual(updateArgs.data.attempts, 0);
    assert.strictEqual(updateArgs.data.completedAt, null);
    assert.strictEqual(updateArgs.data.lastError, null);
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
    const data = await res.json();
    assert.deepStrictEqual(data, {
      eligible: true,
      claimed: true,
      actionId: "act_1",
      type: "CHANNEL_POST",
    });
    assert.strictEqual(updateArgs.data.status, "PENDING");
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
});
