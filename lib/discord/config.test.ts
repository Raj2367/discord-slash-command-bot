import test from "node:test";
import assert from "node:assert";
import { getDiscordConfig } from "./config";

test("Discord environment config helper tests", async (t) => {
  const originalEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  await t.test("1. valid configuration", () => {
    process.env.DISCORD_APPLICATION_ID = "app_123";
    process.env.DISCORD_PUBLIC_KEY = "key_123";
    process.env.DISCORD_BOT_TOKEN = "token_123";
    process.env.DISCORD_GUILD_ID = "guild_123";
    process.env.SIGNATURE_MAX_AGE_SECONDS = "120";

    const config = getDiscordConfig();
    assert.strictEqual(config.applicationId, "app_123");
    assert.strictEqual(config.publicKey, "key_123");
    assert.strictEqual(config.botToken, "token_123");
    assert.strictEqual(config.guildId, "guild_123");
    assert.strictEqual(config.signatureMaxAgeSeconds, 120);
  });

  await t.test("2. missing required configuration throws error", () => {
    delete process.env.DISCORD_APPLICATION_ID;
    process.env.DISCORD_PUBLIC_KEY = "key_123";
    process.env.DISCORD_BOT_TOKEN = "token_123";
    process.env.DISCORD_GUILD_ID = "guild_123";

    assert.throws(() => {
      getDiscordConfig();
    }, /Missing required Discord environment variables/);
  });

  await t.test("3. invalid SIGNATURE_MAX_AGE_SECONDS throws error", () => {
    process.env.DISCORD_APPLICATION_ID = "app_123";
    process.env.DISCORD_PUBLIC_KEY = "key_123";
    process.env.DISCORD_BOT_TOKEN = "token_123";
    process.env.DISCORD_GUILD_ID = "guild_123";
    process.env.SIGNATURE_MAX_AGE_SECONDS = "invalid_number";

    assert.throws(() => {
      getDiscordConfig();
    }, /SIGNATURE_MAX_AGE_SECONDS must be a positive integer/);

    process.env.SIGNATURE_MAX_AGE_SECONDS = "-10";
    assert.throws(() => {
      getDiscordConfig();
    }, /SIGNATURE_MAX_AGE_SECONDS must be a positive integer/);
  });

  await t.test("4. default freshness value of 300 seconds when appropriate", () => {
    process.env.DISCORD_APPLICATION_ID = "app_123";
    process.env.DISCORD_PUBLIC_KEY = "key_123";
    process.env.DISCORD_BOT_TOKEN = "token_123";
    process.env.DISCORD_GUILD_ID = "guild_123";
    delete process.env.SIGNATURE_MAX_AGE_SECONDS;

    const config = getDiscordConfig();
    assert.strictEqual(config.signatureMaxAgeSeconds, 300);
  });
});
