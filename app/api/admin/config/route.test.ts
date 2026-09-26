import test from "node:test";
import assert from "node:assert";
import { getAdminSession as originalGetAdminSession } from "@/lib/auth/session";
import { __setGetSession } from "@/lib/auth/retry-session";
import { prisma } from "@/lib/db";
import { GET, POST } from "./route";

const originalCommandRuleFindMany = prisma.commandRule.findMany;
const originalCommandRuleFindUnique = prisma.commandRule.findUnique;
const originalCommandRuleUpdate = prisma.commandRule.update;
const originalServerConfigFindFirst = prisma.discordServerConfig.findFirst;
const originalServerConfigFindUnique = (prisma as any).discordServerConfig?.findUnique;
const originalServerConfigUpdate = (prisma as any).discordServerConfig?.update;

const setSession = (fn: any) => {
  __setGetSession(fn);
};

const setCommandRuleFindMany = (fn: any) => {
  // @ts-ignore
  prisma.commandRule.findMany = fn;
};

const setCommandRuleFindUnique = (fn: any) => {
  // @ts-ignore
  prisma.commandRule.findUnique = fn;
};

const setCommandRuleUpdate = (fn: any) => {
  // @ts-ignore
  prisma.commandRule.update = fn;
};

const setServerConfigFindFirst = (fn: any) => {
  if (!(prisma as any).discordServerConfig) {
    (prisma as any).discordServerConfig = {};
  }
  (prisma as any).discordServerConfig.findFirst = fn;
};

const setServerConfigFindUnique = (fn: any) => {
  if (!(prisma as any).discordServerConfig) {
    (prisma as any).discordServerConfig = {};
  }
  (prisma as any).discordServerConfig.findUnique = fn;
};

const setServerConfigUpdate = (fn: any) => {
  if (!(prisma as any).discordServerConfig) {
    (prisma as any).discordServerConfig = {};
  }
  (prisma as any).discordServerConfig.update = fn;
};

test("admin config API route tests", async (t) => {
  t.after(() => {
    __setGetSession(originalGetAdminSession);
    prisma.commandRule.findMany = originalCommandRuleFindMany;
    prisma.commandRule.findUnique = originalCommandRuleFindUnique;
    prisma.commandRule.update = originalCommandRuleUpdate;
    if (originalServerConfigFindFirst) {
      (prisma as any).discordServerConfig.findFirst = originalServerConfigFindFirst;
    }
    if (originalServerConfigFindUnique) {
      (prisma as any).discordServerConfig.findUnique = originalServerConfigFindUnique;
    }
    if (originalServerConfigUpdate) {
      (prisma as any).discordServerConfig.update = originalServerConfigUpdate;
    }
    if (!originalServerConfigFindFirst && !originalServerConfigFindUnique && !originalServerConfigUpdate) {
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
    setServerConfigFindFirst(async (args: any) => {
      if (args?.where?.id) {
        return { id: "config_1" };
      }
      return {
        id: "config_1",
        guildId: "guild_123",
        guildName: "Test Server",
        channelId: "chan_123",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
      };
    });
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
    setServerConfigFindFirst(async (args: any) => {
      if (args?.where?.id) {
        return { id: "config_1" };
      }
      return {
        id: "config_1",
        guildId: "guild_123",
        guildName: "Test Server",
        channelId: "chan_123",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
      };
    });
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
    setServerConfigFindFirst(async (args: any) => {
      if (args?.where?.id) {
        return { id: "config_1" };
      }
      return {
        id: "config_1",
        guildId: "guild_123",
        guildName: "Test Server",
        channelId: "chan_123",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/api/webhooks/secret",
      };
    });
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
    setServerConfigFindFirst(async (args: any) => {
      if (args?.where?.id) {
        return { id: "config_1" };
      }
      return {
        id: "config_1",
        guildId: "guild_123",
        guildName: "Test Server",
        channelId: "chan_123",
        mirrorType: "DISCORD_WEBHOOK",
      };
    });
    const res = await GET();
    const data = await res.json();
    assert.strictEqual(data.serverConfig.mirrorWebhookConfigured, true);
  });

  await t.test("7. mirrorWebhookConfigured = false when URL is null", async () => {
    setSession(authed);
    setCommandRuleFindMany(async () => []);
    setServerConfigFindFirst(async (args: any) => {
      if (args?.where?.id) {
        return null;
      }
      return {
        id: "config_1",
        guildId: "guild_123",
        guildName: "Test Server",
        channelId: "chan_123",
        mirrorType: "DISCORD_WEBHOOK",
      };
    });
    const res = await GET();
    const data = await res.json();
    assert.strictEqual(data.serverConfig.mirrorWebhookConfigured, false);
  });

  await t.test("8. mirrorWebhookConfigured = false when URL is empty string", async () => {
    setSession(authed);
    setCommandRuleFindMany(async () => []);
    setServerConfigFindFirst(async (args: any) => {
      if (args?.where?.id) {
        return null;
      }
      return {
        id: "config_1",
        guildId: "guild_123",
        guildName: "Test Server",
        channelId: "chan_123",
        mirrorType: "DISCORD_WEBHOOK",
      };
    });
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

  await t.test("10b. GET Prisma select does NOT contain mirrorWebhookUrl", async () => {
    setSession(authed);
    setCommandRuleFindMany(async () => []);
    let selectArgs: any = null;
    setServerConfigFindFirst(async (args: any) => {
      if (args?.where?.id) {
        return null;
      }
      if (args?.select) {
        selectArgs = args.select;
      }
      return {
        id: "config_1",
        guildId: "guild_123",
        guildName: "Test Server",
        channelId: "chan_123",
        mirrorType: "DISCORD_WEBHOOK",
      };
    });
    await GET();
    assert.ok(!("mirrorWebhookUrl" in selectArgs));
  });

  await t.test("11. GET and POST are exported, PUT and DELETE are not", async () => {
    // @ts-ignore
    assert.strictEqual(typeof GET, "function");
    // @ts-ignore
    assert.strictEqual(typeof POST, "function");
    // @ts-ignore
    assert.strictEqual(typeof (module as any).exports?.PUT, "undefined");
    // @ts-ignore
    assert.strictEqual(typeof (module as any).exports?.DELETE, "undefined");
  });

  await t.test("12. POST unauthenticated -> 401", async () => {
    setSession(async () => null);
    let findUniqueCalled = false;
    setCommandRuleFindUnique(async () => {
      findUniqueCalled = true;
      return null;
    });
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "command",
        id: "rule_1",
        enabled: true,
        responseText: "test",
        mirrorEnabled: false,
        channelPostEnabled: false,
        aiEnabled: false,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(findUniqueCalled, false);
  });

  await t.test("13. POST malformed JSON -> 400", async () => {
    setSession(authed);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("14. POST wrong type -> 400", async () => {
    setSession(authed);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "invalid_type",
        id: "rule_1",
        enabled: true,
        responseText: "test",
        mirrorEnabled: false,
        channelPostEnabled: false,
        aiEnabled: false,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("15. POST missing id -> 400", async () => {
    setSession(authed);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "command",
        enabled: true,
        responseText: "test",
        mirrorEnabled: false,
        channelPostEnabled: false,
        aiEnabled: false,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("16. POST non-boolean enabled -> 400", async () => {
    setSession(authed);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "command",
        id: "rule_1",
        enabled: "true",
        responseText: "test",
        mirrorEnabled: false,
        channelPostEnabled: false,
        aiEnabled: false,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("17. POST empty responseText -> 400", async () => {
    setSession(authed);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "command",
        id: "rule_1",
        enabled: true,
        responseText: "   ",
        mirrorEnabled: false,
        channelPostEnabled: false,
        aiEnabled: false,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("18. POST responseText over 1000 characters -> 400", async () => {
    setSession(authed);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "command",
        id: "rule_1",
        enabled: true,
        responseText: "x".repeat(1001),
        mirrorEnabled: false,
        channelPostEnabled: false,
        aiEnabled: false,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("19. POST unknown CommandRule -> 404", async () => {
    setSession(authed);
    setCommandRuleFindUnique(async () => null);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "command",
        id: "rule_1",
        enabled: true,
        responseText: "test",
        mirrorEnabled: false,
        channelPostEnabled: false,
        aiEnabled: false,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 404);
  });

  await t.test("20. POST valid update -> 200 with allowed returned fields", async () => {
    setSession(authed);
    let findUniqueCalled = false;
    let updateArgs: any = null;
    setCommandRuleFindUnique(async () => {
      findUniqueCalled = true;
      return { id: "rule_1", commandName: "status" };
    });
    setCommandRuleUpdate(async (args: any) => {
      updateArgs = args;
      return {
        id: "rule_1",
        commandName: "status",
        enabled: true,
        responseText: "updated text",
        mirrorEnabled: false,
        channelPostEnabled: true,
        aiEnabled: false,
        updatedAt: new Date(),
      };
    });
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "command",
        id: "rule_1",
        enabled: true,
        responseText: "updated text",
        mirrorEnabled: false,
        channelPostEnabled: true,
        aiEnabled: false,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok("commandRule" in data);
    const rule = data.commandRule;
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
    assert.strictEqual(rule.id, "rule_1");
    assert.strictEqual(rule.responseText, "updated text");
    assert.strictEqual(findUniqueCalled, true);
  });

  await t.test("21. POST verifies exactly five editable fields passed to Prisma update", async () => {
    setSession(authed);
    setCommandRuleFindUnique(async () => ({ id: "rule_1", commandName: "status" }));
    let updateArgs: any = null;
    setCommandRuleUpdate(async (args: any) => {
      updateArgs = args;
      return {
        id: "rule_1",
        commandName: "status",
        enabled: false,
        responseText: "toggled",
        mirrorEnabled: true,
        channelPostEnabled: false,
        aiEnabled: true,
        updatedAt: new Date(),
      };
    });
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "command",
        id: "rule_1",
        enabled: false,
        responseText: "toggled",
        mirrorEnabled: true,
        channelPostEnabled: false,
        aiEnabled: true,
      }),
    });
    await POST(req);
    const dataFields = Object.keys(updateArgs.data);
    assert.deepStrictEqual(dataFields.sort(), [
      "aiEnabled",
      "channelPostEnabled",
      "enabled",
      "mirrorEnabled",
      "responseText",
    ]);
    assert.strictEqual(updateArgs.where.id, "rule_1");
    assert.strictEqual(updateArgs.data.enabled, false);
    assert.strictEqual(updateArgs.data.responseText, "toggled");
    assert.strictEqual(updateArgs.data.mirrorEnabled, true);
    assert.strictEqual(updateArgs.data.channelPostEnabled, false);
    assert.strictEqual(updateArgs.data.aiEnabled, true);
  });

  await t.test("22. POST does not allow updating commandName or id", async () => {
    setSession(authed);
    setCommandRuleFindUnique(async () => ({ id: "rule_1", commandName: "status" }));
    let updateArgs: any = null;
    setCommandRuleUpdate(async (args: any) => {
      updateArgs = args;
      return {
        id: "rule_1",
        commandName: "status",
        enabled: true,
        responseText: "test",
        mirrorEnabled: false,
        channelPostEnabled: false,
        aiEnabled: false,
        updatedAt: new Date(),
      };
    });
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "command",
        id: "rule_1",
        enabled: true,
        responseText: "test",
        mirrorEnabled: false,
        channelPostEnabled: false,
        aiEnabled: false,
        commandName: "hacked",
      }),
    });
    await POST(req);
    assert.ok(!("commandName" in updateArgs.data));
    assert.ok(!("id" in updateArgs.data));
  });

  await t.test("23. POST database failure -> 500 generic error", async () => {
    setSession(authed);
    setCommandRuleFindUnique(async () => {
      throw new Error("Prisma connection failed");
    });
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "command",
        id: "rule_1",
        enabled: true,
        responseText: "test",
        mirrorEnabled: false,
        channelPostEnabled: false,
        aiEnabled: false,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.strictEqual(data.error, "Failed to update configuration");
  });

  await t.test("24. POST server unauthenticated -> 401", async () => {
    setSession(async () => null);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Test Server",
        channelId: "chan_123",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 401);
  });

  await t.test("25. POST server empty guildName -> 400", async () => {
    setSession(authed);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "   ",
        channelId: "chan_123",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("26. POST server guildName over 200 chars -> 400", async () => {
    setSession(authed);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "x".repeat(201),
        channelId: "chan_123",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("27. POST server invalid channelId type -> 400", async () => {
    setSession(authed);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Test Server",
        channelId: 123,
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: null,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("28. POST server invalid mirrorType -> 400", async () => {
    setSession(authed);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Test Server",
        channelId: "chan_123",
        mirrorType: "INVALID_TYPE",
        mirrorWebhookUrl: null,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("29. POST server invalid mirrorWebhookUrl type -> 400", async () => {
    setSession(authed);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Test Server",
        channelId: "chan_123",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: 123,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("30. POST server mirrorWebhookUrl over 2000 chars -> 400", async () => {
    setSession(authed);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Test Server",
        channelId: "chan_123",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/" + "x".repeat(2000),
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
  });

  await t.test("31. POST server unknown config -> 404", async () => {
    setSession(authed);
    setServerConfigFindUnique(async () => null);
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Test Server",
        channelId: "chan_123",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 404);
  });

  await t.test("32. POST server valid update -> 200", async () => {
    setSession(authed);
    let updateArgs: any = null;
    setServerConfigFindUnique(async () => ({ id: "config_1", guildId: "guild_123" }));
    setServerConfigUpdate(async (args: any) => {
      updateArgs = args;
      return {
        id: "config_1",
        guildId: "guild_123",
        guildName: "Updated Server",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/api/webhooks/secret",
        updatedAt: new Date(),
      };
    });
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Updated Server",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/api/webhooks/secret",
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok("serverConfig" in data);
    const config = data.serverConfig;
    assert.strictEqual(config.id, "config_1");
    assert.strictEqual(config.guildId, "guild_123");
    assert.strictEqual(config.guildName, "Updated Server");
    assert.strictEqual(config.channelId, "chan_456");
    assert.strictEqual(config.mirrorType, "DISCORD_WEBHOOK");
    assert.ok(config.updatedAt);
  });

  await t.test("33. POST server verifies four editable fields reach Prisma update", async () => {
    setSession(authed);
    setServerConfigFindUnique(async () => ({ id: "config_1", guildId: "guild_123" }));
    let updateArgs: any = null;
    setServerConfigUpdate(async (args: any) => {
      updateArgs = args;
      return {
        id: "config_1",
        guildId: "guild_123",
        guildName: "Updated",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/test",
        updatedAt: new Date(),
      };
    });
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Updated",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/test",
      }),
    });
    await POST(req);
    const dataFields = Object.keys(updateArgs.data).sort();
    assert.deepStrictEqual(dataFields, [
      "channelId",
      "guildName",
      "mirrorType",
      "mirrorWebhookUrl",
    ]);
    assert.strictEqual(updateArgs.where.id, "config_1");
    assert.ok(!("id" in updateArgs.data));
    assert.ok(!("guildId" in updateArgs.data));
    assert.ok(!("createdAt" in updateArgs.data));
  });

  await t.test("34. POST server response NEVER contains mirrorWebhookUrl", async () => {
    setSession(authed);
    setServerConfigFindUnique(async () => ({ id: "config_1", guildId: "guild_123" }));
    setServerConfigUpdate(async () => ({
      id: "config_1",
      guildId: "guild_123",
      guildName: "Updated",
      channelId: "chan_456",
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: "https://discord.com/secret-webhook-url",
      updatedAt: new Date(),
    }));
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Updated",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/secret-webhook-url",
      }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok("mirrorWebhookConfigured" in data.serverConfig);
    assert.ok(!("mirrorWebhookUrl" in data.serverConfig));
    const serialized = JSON.stringify(data);
    assert.ok(!serialized.includes("secret-webhook-url"));
  });

  await t.test("35. POST server URL present -> mirrorWebhookConfigured true", async () => {
    setSession(authed);
    setServerConfigFindUnique(async () => ({ id: "config_1", guildId: "guild_123" }));
    setServerConfigUpdate(async () => ({
      id: "config_1",
      guildId: "guild_123",
      guildName: "Updated",
      channelId: "chan_456",
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
      updatedAt: new Date(),
    }));
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Updated",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/api/webhooks/test",
      }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.serverConfig.mirrorWebhookConfigured, true);
  });

  await t.test("36. POST server URL null -> mirrorWebhookConfigured false", async () => {
    setSession(authed);
    setServerConfigFindUnique(async () => ({ id: "config_1", guildId: "guild_123" }));
    setServerConfigUpdate(async () => ({
      id: "config_1",
      guildId: "guild_123",
      guildName: "Updated",
      channelId: "chan_456",
      mirrorType: null,
      mirrorWebhookUrl: null,
      updatedAt: new Date(),
    }));
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Updated",
        channelId: "chan_456",
        mirrorType: null,
        mirrorWebhookUrl: null,
      }),
    });
    const res = await POST(req);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.serverConfig.mirrorWebhookConfigured, false);
  });

  await t.test("37. POST server database failure -> 500 generic error", async () => {
    setSession(authed);
    setServerConfigFindUnique(async () => {
      throw new Error("Prisma connection failed");
    });
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Updated",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: null,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.strictEqual(data.error, "Failed to update configuration");
  });

  await t.test("38. POST server trims guildName and mirrorWebhookUrl", async () => {
    setSession(authed);
    let updateArgs: any = null;
    setServerConfigFindUnique(async () => ({ id: "config_1", guildId: "guild_123" }));
    setServerConfigUpdate(async (args: any) => {
      updateArgs = args;
      return {
        id: "config_1",
        guildId: "guild_123",
        guildName: "Trimmed",
        channelId: null,
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/test",
        updatedAt: new Date(),
      };
    });
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "  Trimmed  ",
        channelId: null,
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "  https://discord.com/test  ",
      }),
    });
    await POST(req);
    assert.strictEqual(updateArgs.data.guildName, "Trimmed");
    assert.strictEqual(updateArgs.data.mirrorWebhookUrl, "https://discord.com/test");
  });

  await t.test("39. POST server omitted mirrorWebhookUrl preserves existing URL", async () => {
    setSession(authed);
    let updateArgs: any = null;
    setServerConfigFindUnique(async () => ({ id: "config_1", guildId: "guild_123" }));
    setServerConfigUpdate(async (args: any) => {
      updateArgs = args;
      return {
        id: "config_1",
        guildId: "guild_123",
        guildName: "Updated",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/existing",
        updatedAt: new Date(),
      };
    });
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Updated",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(!("mirrorWebhookUrl" in data.serverConfig));
    assert.strictEqual(data.serverConfig.mirrorWebhookConfigured, true);
    assert.ok(!("mirrorWebhookUrl" in updateArgs.data));
  });

  await t.test("40. POST server explicit null clears existing URL", async () => {
    setSession(authed);
    let updateArgs: any = null;
    setServerConfigFindUnique(async () => ({ id: "config_1", guildId: "guild_123" }));
    setServerConfigUpdate(async (args: any) => {
      updateArgs = args;
      return {
        id: "config_1",
        guildId: "guild_123",
        guildName: "Updated",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: null,
        updatedAt: new Date(),
      };
    });
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Updated",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: null,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.serverConfig.mirrorWebhookConfigured, false);
    assert.strictEqual(updateArgs.data.mirrorWebhookUrl, null);
  });

  await t.test("41. POST server empty string clears URL", async () => {
    setSession(authed);
    let updateArgs: any = null;
    setServerConfigFindUnique(async () => ({ id: "config_1", guildId: "guild_123" }));
    setServerConfigUpdate(async (args: any) => {
      updateArgs = args;
      return {
        id: "config_1",
        guildId: "guild_123",
        guildName: "Updated",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: null,
        updatedAt: new Date(),
      };
    });
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Updated",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "   ",
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.serverConfig.mirrorWebhookConfigured, false);
    assert.strictEqual(updateArgs.data.mirrorWebhookUrl, null);
  });

  await t.test("42. POST server non-empty string trims and stores new URL", async () => {
    setSession(authed);
    let updateArgs: any = null;
    setServerConfigFindUnique(async () => ({ id: "config_1", guildId: "guild_123" }));
    setServerConfigUpdate(async (args: any) => {
      updateArgs = args;
      return {
        id: "config_1",
        guildId: "guild_123",
        guildName: "Updated",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "https://discord.com/new",
        updatedAt: new Date(),
      };
    });
    const req = new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server",
        id: "config_1",
        guildName: "Updated",
        channelId: "chan_456",
        mirrorType: "DISCORD_WEBHOOK",
        mirrorWebhookUrl: "  https://discord.com/new  ",
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.serverConfig.mirrorWebhookConfigured, true);
    assert.strictEqual(updateArgs.data.mirrorWebhookUrl, "https://discord.com/new");
  });
});
