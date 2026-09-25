import { DeliveryResult } from "./deliver-interaction-response";

export interface DeliverChannelPostInput {
  channelId: string;
  botToken: string;
  message: string;
}

export async function deliverChannelPost(
  input: DeliverChannelPostInput
): Promise<DeliveryResult> {
  const { channelId, botToken, message } = input;

  if (!channelId || !botToken) {
    return {
      success: false,
      category: "permanent",
      status: 400,
      error: "Missing channelId or botToken",
    };
  }

  const url = `https://discord.com/api/v10/channels/${channelId}/messages`;

  const payload = {
    content: message,
    allowed_mentions: {
      parse: [],
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });

    if (response.ok) {
      return { success: true };
    }

    const status = response.status;

    if (status === 429 || status >= 500) {
      return {
        success: false,
        category: "transient",
        status,
        error: `Discord API transient error: ${status}`,
      };
    }

    if (status >= 400 && status < 500) {
      return {
        success: false,
        category: "permanent",
        status,
        error: `Discord API permanent error: ${status}`,
      };
    }

    return {
      success: false,
      category: "transient",
      status,
      error: `Discord API unexpected status: ${status}`,
    };
  } catch (err: any) {
    if (
      err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      err.code === "ABORT_ERR"
    ) {
      return {
        success: false,
        category: "timeout",
        error: "Request timed out",
      };
    }

    return {
      success: false,
      category: "network",
      error: "Network error during channel-post delivery",
    };
  }
}
