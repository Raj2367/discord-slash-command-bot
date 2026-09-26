import test from "node:test";
import assert from "node:assert";
import { getAdminSession as originalGetAdminSession } from "@/lib/auth/session";
import { __setGetSession } from "@/lib/auth/retry-session";
import { prisma } from "@/lib/db";
import { GET } from "./route";

const originalCommandRuleFindMany = prisma.commandRule.findMany;
const originalServerConfigFindFirst = prisma.discordServerConfig.findFirst;

const setSession = (fn: any) => {
  __setGetSession(fn);
};

const setCommandRuleFindMany = (fn: any) => {
  // @ts-ignore
  prisma.commandRule.findMany = fn;
};

const setServerConfigFindFirst = (fn: any) => {
  if (!(prisma as any).discordServerConfig) {
    (prisma as any).discordServerConfig = {};
  }
  (prisma as any).discordServerConfig.findFirst = fn;
};

test("admin config API route tests", async (t) => {
  t.after(() => {
    __setGetSession(originalGetAdminSession);
    prisma.commandRule.findMany = originalCommandRuleFindMany;
    if (originalServerConfigFindFirst) {
      (prisma as any).discordServerConfig.findFirst = originalServerConfigFindFirst;
    } else {
      delete (prisma as any).discordServerConfig;
    }
  });

  const authed = async () => ({ adminId: "admin_1" });

  await t.test("1. unauthenticated -> 401 and no DB calls", async () => {
    setSession(async () => null);
    let commandRuleCalled = false;
    let serverConfigCalled = false;
    setCommandRuleFindMany(async () => {
      commandRuleCalled = true;
      return [];
    });
    setServerConfigFindFirst(async () => {
      serverConfigCalled = true;
      return null;
    });
    const res = await GET();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(commandRuleCalled, false);
    assert.strictEqual(serverConfigCalled, false);
  });

  await t.test("2. authenticated -> 200 with correct response shape", async () => {
    setSession(authed);
    setCommandRuleFindMany(async () => [
      {
        id: "rule_1",
        commandName: "status",
        enabled: true,
        responseText: "Bot is operational.",
        mirrorEnabled: false,
        channelPostEnabled: false,
        aiEnabled: false,
        updatedAt: new Date(),
      },
      {
        id: "rule_2",
        commandName: "report",
        enabled: true,
        responseText: "Report received.",
        mirrorEnabled: true,
        channelPostEnabled: true,
        aiEnabled: true,
        updatedAt: new Date(),
      },
    ]);
    setServerConfigFindFirst(async () => ({
      id: "config_1",
      guildId: "guild_123",
      guildName: "Test Server",
      channelId: "chan_123",
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
    }));
    const res = await GET();
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok("commandRules" in data);
    assert.ok("serverConfig" in data);
    assert.strictEqual(Array.isArray(data.commandRules), true);
    assert.strictEqual(data.commandRules.length, 2);
  });

  await t.test("3. exact safe CommandRule fields returned", async () => {
    setSession(authed);
    setCommandRuleFindMany(async () => [
      {
        id: "rule_1",
        commandName: "status",
        enabled: true,
        responseText: "Bot is operational.",
        mirrorEnabled: false,
        channelPostEnabled: false,
        aiEnabled: false,
        updatedAt: new Date(),
      },
    ]);
    setServerConfigFindFirst(async () => null);
    const res = await GET();
    const data = await res.json();
    const rule = data.commandRules[0];
    const keys = Object.keys(rule).sort();
    assert.deepStrictEqual(keys, [
      "aiEnabled",
      "channelPostEnabled",
      "commandName",
      "enabled",
      "id",
      "mirrorEnabled",
      "responseText",
      "updatedAt",
    ]);
  });

  await t.test("4. exact safe server config fields returned", async () => {
    setSession(authed);
    setCommandRuleFindMany(async () => []);
    setServerConfigFindFirst(async () => ({
      id: "config_1",
      guildId: "guild_123",
      guildName: "Test Server",
      channelId: "chan_123",
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
    }));
    const res = await GET();
    const data = await res.json();
    const config = data.serverConfig;
    const keys = Object.keys(config).sort();
    assert.deepStrictEqual(keys, [
      "channelId",
      "guildId",
      "guildName",
      "id",
      "mirrorType",
      "mirrorWebhookConfigured",
    ]);
  });

  await t.test("5. mirrorWebhookUrl is never returned", async () => {
    setSession(authed);
    setCommandRuleFindMany(async () => []);
    setServerConfigFindFirst(async () => ({
      id: "config_1",
      guildId: "guild_123",
      guildName: "Test Server",
      channelId: "chan_123",
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: "https://discord.com/api/webhooks/secret",
    }));
    const res = await GET();
    const data = await res.json();
    const serialized = JSON.stringify(data);
    assert.ok(!serialized.includes("webhook"));
    assert.ok(!serialized.includes("secret"));
    const config = data.serverConfig;
    assert.ok(!("mirrorWebhookUrl" in config));
    assert.ok("mirrorWebhookConfigured" in config);
  });

  await t.test("6. mirrorWebhookConfigured = true when URL exists", async () => {
    setSession(authed);
    setCommandRuleFindMany(async () => []);
    setServerConfigFindFirst(async () => ({
      id: "config_1",
      guildId: "guild_123",
      guildName: "Test Server",
      channelId: "chan_123",
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
    }));
    const res = await GET();
    const data = await res.json();
    assert.strictEqual(data.serverConfig.mirrorWebhookConfigured, true);
  });

  await t.test("7. mirrorWebhookConfigured = false when URL is null", async () => {
    setSession(authed);
    setCommandRuleFindMany(async () => []);
    setServerConfigFindFirst(async () => ({
      id: "config_1",
      guildId: "guild_123",
      guildName: "Test Server",
      channelId: "chan_123",
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: null,
    }));
    const res = await GET();
    const data = await res.json();
    assert.strictEqual(data.serverConfig.mirrorWebhookConfigured, false);
  });

  await t.test("8. mirrorWebhookConfigured = false when URL is empty string", async () => {
    setSession(authed);
    setCommandRuleFindMany(async () => []);
    setServerConfigFindFirst(async () => ({
      id: "config_1",
      guildId: "guild_123",
      guildName: "Test Server",
      channelId: "chan_123",
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: "",
    }));
    const res = await GET();
    const data = await res.json();
    assert.strictEqual(data.serverConfig.mirrorWebhookConfigured, false);
  });

  await t.test("9. database failure -> 500 generic error", async () => {
    setSession(authed);
    setCommandRuleFindMany(async () => {
      throw new Error("Prisma connection failed");
    });
    const res = await GET();
    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.strictEqual(data.error, "Failed to fetch configuration");
  });

  await t.test("10. serverConfig null when no config row exists", async () => {
    setSession(authed);
    setCommandRuleFindMany(async () => []);
    setServerConfigFindFirst(async () => null);
    const res = await GET();
    const data = await res.json();
    assert.strictEqual(data.serverConfig, null);
  });

  await t.test("11. only GET is exported", async () => {
    // @ts-ignore
    assert.strictEqual(typeof GET, "function");
    // @ts-ignore
    assert.strictEqual(typeof (module as any).exports?.POST, "undefined");
    // @ts-ignore
    assert.strictEqual(typeof (module as any).exports?.PUT, "undefined");
    // @ts-ignore
    assert.strictEqual(typeof (module as any).exports?.DELETE, "undefined");
  });
});
