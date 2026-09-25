import test from "node:test";
import assert from "node:assert";
import {
  normalizeReportText,
  formatDiscordReportPayload,
  MAX_REPORT_LENGTH,
} from "./normalize-report";

test("normalizeReportText and provider payload formatting tests", async (t) => {
  await t.test("1. Normal text normalization happens before formatting", () => {
    const input = "  Database latency spike in us-west-2  ";
    const normalized = normalizeReportText(input);
    assert.strictEqual(normalized.text, "Database latency spike in us-west-2");
    assert.strictEqual(normalized.truncated, false);

    const discordPayload = formatDiscordReportPayload(normalized.text);
    assert.strictEqual(discordPayload.content, "Database latency spike in us-west-2");
    assert.deepStrictEqual(discordPayload.allowed_mentions, { parse: [] });
  });

  await t.test("2. Discord receives normalized text and allowed_mentions: { parse: [] }", () => {
    const text = "Alert @everyone / @here check";
    const payload = formatDiscordReportPayload(text);
    assert.strictEqual(payload.content, "Alert @everyone / @here check");
    assert.deepStrictEqual(payload.allowed_mentions, { parse: [] });
  });

  await t.test("3. Text at allowed length boundary (1500 chars)", () => {
    const input = "x".repeat(MAX_REPORT_LENGTH);
    const normalized = normalizeReportText(input);
    assert.strictEqual(normalized.text.length, MAX_REPORT_LENGTH);
    assert.strictEqual(normalized.truncated, false);
  });

  await t.test("4. Text exceeding 1500 chars is bounded before payload creation", () => {
    const input = "y".repeat(MAX_REPORT_LENGTH + 100);
    const normalized = normalizeReportText(input);
    assert.strictEqual(normalized.text.length, MAX_REPORT_LENGTH);
    assert.strictEqual(normalized.truncated, true);

    const discordPayload = formatDiscordReportPayload(normalized.text);
    assert.strictEqual(discordPayload.content.length, MAX_REPORT_LENGTH);
  });
});
