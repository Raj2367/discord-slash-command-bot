export interface NormalizedReport {
  text: string;
  truncated: boolean;
  originalLength: number;
}

export const MAX_REPORT_LENGTH = 1500; // practical limit leaving room for formatting

export function normalizeReportText(
  rawInput: unknown,
  maxLength: number = MAX_REPORT_LENGTH
): NormalizedReport {
  if (rawInput === null || rawInput === undefined) {
    return { text: "", truncated: false, originalLength: 0 };
  }

  const str = typeof rawInput === "string" ? rawInput : String(rawInput);
  const originalLength = str.length;
  const trimmed = str.trim();

  let text = trimmed;
  let truncated = false;

  if (text.length > maxLength) {
    text = text.slice(0, maxLength);
    truncated = true;
  }

  return {
    text,
    truncated,
    originalLength,
  };
}

export function formatDiscordReportPayload(normalizedText: string) {
  return {
    content: normalizedText,
    allowed_mentions: {
      parse: [],
    },
  };
}

export function escapeSlackMrkdwn(normalizedText: string): string {
  return (normalizedText || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatSlackReportPayload(normalizedText: string) {
  const escaped = escapeSlackMrkdwn(normalizedText);
  return {
    text: `*Report:* ${escaped}`,
    mrkdwn: true,
  };
}
