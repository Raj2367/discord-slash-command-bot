import test from "node:test";
import assert from "node:assert";
import {
  normalizeReportText,
  formatDiscordReportPayload,
  escapeSlackMrkdwn,
  formatSlackReportPayload,
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

    const slackPayload = formatSlackReportPayload(normalized.text);
    assert.strictEqual(slackPayload.text, "*Report:* Database latency spike in us-west-2");
    assert.strictEqual(slackPayload.mrkdwn, true);
  });

  await t.test("2. Slack escaping handles &, <, > on normalized text", () => {
    const input = "A & B < C > D";
    const normalized = normalizeReportText(input);
    const escaped = escapeSlackMrkdwn(normalized.text);
    assert.strictEqual(escaped, "A &amp; B &lt; C &gt; D");

    const payload = formatSlackReportPayload(normalized.text);
    assert.strictEqual(payload.text, "*Report:* A &amp; B &lt; C &gt; D");
  });

  await t.test("3. Discord receives normalized text and allowed_mentions: { parse: [] }", () => {
    const input = "Alert @everyone / @here check";
    const normalized = normalizeReportText(input);
    const payload = formatDiscordReportPayload(normalized.text);
    assert.strictEqual(payload.content, "Alert @everyone / @here check");
    assert.deepStrictEqual(payload.allowed_mentions, { parse: [] });
  });

  await t.test("4. Text at allowed length boundary (1500 chars)", () => {
    const input = "x".repeat(MAX_REPORT_LENGTH);
    const normalized = normalizeReportText(input);
    assert.strictEqual(normalized.text.length, MAX_REPORT_LENGTH);
    assert.strictEqual(normalized.truncated, false);
  });

  await t.test("5. Text exceeding 1500 chars is bounded before payload creation", () => {
    const input = "y".repeat(MAX_REPORT_LENGTH + 100);
    const normalized = normalizeReportText(input);
    assert.strictEqual(normalized.text.length, MAX_REPORT_LENGTH);
    assert.strictEqual(normalized.truncated, true);

    const discordPayload = formatDiscordReportPayload(normalized.text);
    assert.strictEqual(discordPayload.content.length, MAX_REPORT_LENGTH);
  });
});
