export interface DeliverChannelPostInput {
  botToken: string;
  channelId: string;
  payload: {
    content?: string;
    allowed_mentions?: {
      parse: string[];
      [key: string]: any;
    };
    [key: string]: any;
  };
}

export type ChannelPostDeliveryResult =
  | { success: true }
  | { success: false; category: "transient"; status?: number; error?: string }
  | { success: false; category: "permanent"; status: number; error?: string }
  | { success: false; category: "timeout"; error?: string }
  | { success: false; category: "network"; error?: string };

export async function deliverChannelPost(
  input: DeliverChannelPostInput
): Promise<ChannelPostDeliveryResult> {
  const { botToken, channelId, payload } = input;

  if (!botToken || !channelId) {
    return {
      success: false,
      category: "permanent",
      status: 400,
      error: "Missing botToken or channelId",
    };
  }

  const url = `https://discord.com/api/v10/channels/${channelId}/messages`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
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
        error: `Discord channel post transient error: ${status}`,
      };
    }

    if (status >= 400 && status < 500) {
      return {
        success: false,
        category: "permanent",
        status,
        error: `Discord channel post permanent error: ${status}`,
      };
    }

    return {
      success: false,
      category: "transient",
      status,
      error: `Discord channel post unexpected status: ${status}`,
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
      error: "Network error during channel post delivery",
    };
  }
}
