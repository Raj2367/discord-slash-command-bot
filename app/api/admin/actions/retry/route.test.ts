import test from "node:test";
import assert from "node:assert";
import { getAdminSession as originalGetAdminSession } from "@/lib/auth/session";
import { __setGetSession } from "@/lib/auth/retry-session";
import { prisma } from "@/lib/db";
import { POST } from "./route";

const originalFindUnique = prisma.actionRecord.findUnique;

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

test("admin actions retry API route tests", async (t) => {
  t.after(() => {
    __setGetSession(originalGetAdminSession);
    prisma.actionRecord.findUnique = originalFindUnique;
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

  await t.test("5. DISCORD_RESPONSE -> 400", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({ type: "DISCORD_RESPONSE", status: "FAILED" })
    );
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("6. FAILED CHANNEL_POST -> 200 eligible", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({ type: "CHANNEL_POST", status: "FAILED" })
    );
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
      actionId: "act_1",
      type: "CHANNEL_POST",
    });
  });

  await t.test("7. FAILED MIRROR -> 200 eligible", async () => {
    setSession(authed);
    setFindUnique(async () => makeAction({ type: "MIRROR", status: "FAILED" }));
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
      actionId: "act_1",
      type: "MIRROR",
    });
  });

  await t.test("8. stale PENDING -> 200 eligible", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({
        type: "CHANNEL_POST",
        status: "PENDING",
        updatedAt: new Date(Date.now() - 5 * 60 * 1000),
      })
    );
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
      actionId: "act_1",
      type: "CHANNEL_POST",
    });
  });

  await t.test("9. fresh PENDING -> 409 not eligible", async () => {
    setSession(authed);
    setFindUnique(async () =>
      makeAction({ type: "MIRROR", status: "PENDING", updatedAt: new Date() })
    );
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 409);
  });

  await t.test("10. SUCCESS -> 409 not eligible", async () => {
    setSession(authed);
    setFindUnique(async () => makeAction({ type: "MIRROR", status: "SUCCESS" }));
    const req = new Request("http://localhost/api/admin/actions/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "act_1" }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 409);
  });
});
