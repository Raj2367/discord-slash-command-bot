import test from "node:test";
import assert from "node:assert";
import { parseInteraction } from "./parse-interaction";

test("Discord interaction parser tests", async (t) => {
  await t.test("1. valid PING", () => {
    const payload = JSON.stringify({
      id: "123456789",
      application_id: "987654321",
      type: 1,
    });
    const parsed = parseInteraction(payload);
    assert.strictEqual(parsed.type, "PING");
  });

  await t.test("2. valid /status command", () => {
    const payload = {
      id: "123456789",
      application_id: "987654321",
      type: 2,
      token: "secret_token_123",
      guild_id: "guild_111",
      channel_id: "chan_222",
      data: {
        id: "cmd_status",
        name: "status",
        type: 1,
      },
    };
    const parsed = parseInteraction(payload);
    assert.strictEqual(parsed.type, "APPLICATION_COMMAND");
    if (parsed.type === "APPLICATION_COMMAND") {
      assert.strictEqual(parsed.commandName, "status");
      assert.strictEqual(parsed.id, "123456789");
      assert.strictEqual(parsed.applicationId, "987654321");
      assert.strictEqual(parsed.token, "secret_token_123");
    }
  });

  await t.test("3. valid /report command with text", () => {
    const payload = {
      id: "123456789",
      application_id: "987654321",
      type: 2,
      data: {
        id: "cmd_report",
        name: "report",
        type: 1,
        options: [
          {
            name: "text",
            type: 3,
            value: "System error encountered in payment gateway",
          },
        ],
      },
    };
    const parsed = parseInteraction(payload);
    assert.strictEqual(parsed.type, "APPLICATION_COMMAND");
    if (parsed.type === "APPLICATION_COMMAND") {
      assert.strictEqual(parsed.commandName, "report");
      assert.strictEqual(parsed.options["text"], "System error encountered in payment gateway");
    }
  });

  await t.test("4. /report command without text", () => {
    const payload = {
      id: "123456789",
      application_id: "987654321",
      type: 2,
      data: {
        id: "cmd_report",
        name: "report",
        type: 1,
      },
    };
    const parsed = parseInteraction(payload);
    assert.strictEqual(parsed.type, "APPLICATION_COMMAND");
    if (parsed.type === "APPLICATION_COMMAND") {
      assert.strictEqual(parsed.commandName, "report");
      assert.strictEqual(parsed.options["text"], undefined);
    }
  });

  await t.test("5. unsupported interaction type is rejected", () => {
    const payload = {
      id: "123456789",
      application_id: "987654321",
      type: 3, // MESSAGE_COMPONENT
    };
    assert.throws(() => {
      parseInteraction(payload);
    }, /Unsupported interaction type/);
  });

  await t.test("6. malformed/missing required fields are rejected", () => {
    assert.throws(() => {
      parseInteraction("invalid json string");
    }, /Invalid JSON/);

    assert.throws(() => {
      parseInteraction({ type: 1 }); // missing id and application_id
    }, /Missing required fields/);
  });

  await t.test("7. unknown command is rejected", () => {
    const payload = {
      id: "123456789",
      application_id: "987654321",
      type: 2,
      data: {
        id: "cmd_unknown",
        name: "unknowncommand",
        type: 1,
      },
    };
    assert.throws(() => {
      parseInteraction(payload);
    }, /Unknown command/);
  });

  await t.test("8. malformed command data is rejected", () => {
    const payload = {
      id: "123456789",
      application_id: "987654321",
      type: 2,
      // missing data object
    };
    assert.throws(() => {
      parseInteraction(payload);
    }, /Missing required fields for APPLICATION_COMMAND/);
  });
});
