import test from "node:test";
import assert from "node:assert";
import { getAdminSession as originalGetAdminSession } from "@/lib/auth/session";
import { __setGetSession } from "@/lib/auth/retry-session";
import { prisma } from "@/lib/db";
import { GET } from "./route";

const originalFindMany = prisma.interactionLog.findMany;

const setSession = (fn: any) => {
  __setGetSession(fn);
};

const setFindMany = (fn: any) => {
  // @ts-ignore
  prisma.interactionLog.findMany = fn;
};

const makeInteraction = (overrides: any = {}) => ({
  id: "log_1",
  interactionId: "discord_interaction_1",
  guildId: "guild_123",
  channelId: "chan_123",
  userId: "user_123",
  username: "testuser",
  commandName: "status",
  status: "COMPLETED",
  createdAt: new Date("2025-01-01T00:00:00Z"),
  processedAt: new Date("2025-01-01T00:00:01Z"),
  actions: [
    {
      id: "act_1",
      type: "DISCORD_RESPONSE",
      status: "SUCCESS",
      attempts: 1,
      lastError: null,
      createdAt: new Date("2025-01-01T00:00:00Z"),
      completedAt: new Date("2025-01-01T00:00:01Z"),
      updatedAt: new Date("2025-01-01T00:00:01Z"),
    },
  ],
  ...overrides,
});

test("dashboard data API route tests", async (t) => {
  t.after(() => {
    __setGetSession(originalGetAdminSession);
    prisma.interactionLog.findMany = originalFindMany;
  });

  const authed = async () => ({ adminId: "admin_1" });

  await t.test("1. unauthenticated -> 401 and findMany not called", async () => {
    setSession(async () => null);
    let queryCalled = false;
    setFindMany(async () => {
      queryCalled = true;
      return [];
    });
    const res = await GET();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(queryCalled, false);
  });

  await t.test("2. authenticated -> 200 with correct response shape", async () => {
    setSession(authed);
    setFindMany(async () => [
      makeInteraction(),
      makeInteraction({ id: "log_2", interactionId: "discord_interaction_2" }),
    ]);
    const res = await GET();
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok("interactions" in data);
    assert.strictEqual(Array.isArray(data.interactions), true);
    assert.strictEqual(data.interactions.length, 2);
    const first = data.interactions[0];
    assert.strictEqual(first.id, "log_1");
    assert.strictEqual(first.interactionId, "discord_interaction_1");
    assert.strictEqual(first.guildId, "guild_123");
    assert.strictEqual(first.channelId, "chan_123");
    assert.strictEqual(first.userId, "user_123");
    assert.strictEqual(first.username, "testuser");
    assert.strictEqual(first.commandName, "status");
    assert.strictEqual(first.status, "COMPLETED");
    assert.ok(first.createdAt);
    assert.ok(first.processedAt);
    assert.ok(Array.isArray(first.actions));
    assert.strictEqual(first.actions.length, 1);
    const action = first.actions[0];
    assert.strictEqual(action.id, "act_1");
    assert.strictEqual(action.type, "DISCORD_RESPONSE");
    assert.strictEqual(action.status, "SUCCESS");
    assert.strictEqual(action.attempts, 1);
    assert.strictEqual(action.lastError, null);
    assert.ok(action.createdAt);
    assert.ok(action.completedAt);
    assert.ok(action.updatedAt);
  });

  await t.test("3. results limited to 50 and ordered by createdAt descending", async () => {
    setSession(authed);
    let capturedArgs: any = null;
    setFindMany(async (args: any) => {
      capturedArgs = args;
      const interactions = [];
      for (let i = 0; i < 50; i++) {
        interactions.push(
          makeInteraction({
            id: `log_${i}`,
            createdAt: new Date(2025, 0, i + 1),
          })
        );
      }
      return interactions;
    });
    const res = await GET();
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.interactions.length, 50);
    assert.strictEqual(capturedArgs.take, 50);
    assert.deepStrictEqual(capturedArgs.orderBy, { createdAt: "desc" });
  });

  await t.test("4. returned action fields contain only the allowed safe fields", async () => {
    setSession(authed);
    let capturedArgs: any = null;
    setFindMany(async (args: any) => {
      capturedArgs = args;
      return [
        makeInteraction({
          actions: [
            {
              id: "act_1",
              type: "CHANNEL_POST",
              status: "SUCCESS",
              attempts: 2,
              lastError: null,
              createdAt: new Date(),
              completedAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        }),
      ];
    });
    await GET();
    const actionSelect = capturedArgs.select.actions.select;
    const actionKeys = Object.keys(actionSelect).sort();
    assert.deepStrictEqual(actionKeys, [
      "attempts",
      "completedAt",
      "createdAt",
      "id",
      "lastError",
      "status",
      "type",
      "updatedAt",
    ]);
  });

  await t.test("5. `result` is not selected on ActionRecord", async () => {
    setSession(authed);
    let capturedArgs: any = null;
    setFindMany(async (args: any) => {
      capturedArgs = args;
      return [];
    });
    await GET();
    const actionSelect = capturedArgs.select.actions.select;
    assert.ok(!("result" in actionSelect));
  });

  await t.test("6. `commandOptions` is not selected on InteractionLog", async () => {
    setSession(authed);
    let capturedArgs: any = null;
    setFindMany(async (args: any) => {
      capturedArgs = args;
      return [];
    });
    await GET();
    assert.ok(!("commandOptions" in capturedArgs.select));
  });

  await t.test("7. database failure -> 500 with generic error", async () => {
    setSession(authed);
    setFindMany(async () => {
      throw new Error("Prisma connection failed");
    });
    const res = await GET();
    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.strictEqual(data.error, "Failed to fetch dashboard data");
  });

  await t.test("8. no secrets/config values are selected", async () => {
    setSession(authed);
    let capturedArgs: any = null;
    setFindMany(async (args: any) => {
      capturedArgs = args;
      return [];
    });
    await GET();
    const interactionSelect = capturedArgs.select;
    assert.ok(!("commandOptions" in interactionSelect));
    const actionSelect = interactionSelect.actions?.select;
    assert.ok(actionSelect !== undefined);
    assert.ok(!("result" in actionSelect));
    const allKeys = JSON.stringify(capturedArgs).toLowerCase();
    assert.ok(!allKeys.includes("token"));
    assert.ok(!allKeys.includes("webhookurl"));
    assert.ok(!allKeys.includes("passwordhash"));
  });
});
