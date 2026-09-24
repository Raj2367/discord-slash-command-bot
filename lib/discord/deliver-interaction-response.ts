export interface DeliverInteractionResponseInput {
  applicationId: string;
  interactionToken: string;
  payload: {
    content?: string;
    [key: string]: any;
  };
}

export type DeliveryResult =
  | { success: true }
  | { success: false; category: "transient"; status?: number; error?: string }
  | { success: false; category: "permanent"; status: number; error?: string }
  | { success: false; category: "timeout"; error?: string }
  | { success: false; category: "network"; error?: string };

export async function deliverInteractionResponse(
  input: DeliverInteractionResponseInput
): Promise<DeliveryResult> {
  const { applicationId, interactionToken, payload } = input;

  if (!applicationId || !interactionToken) {
    return {
      success: false,
      category: "permanent",
      status: 400,
      error: "Missing applicationId or interactionToken",
    };
  }

  const url = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;

  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
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
      error: "Network error during delivery",
    };
  }
}
