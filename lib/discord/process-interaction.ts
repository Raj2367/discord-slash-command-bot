import {
  retryDiscordDelivery,
  RetriedDeliveryResult,
  RetryDeliveryOptions,
} from "./retry-discord-delivery";

export interface ProcessInteractionInput {
  interactionLogId: string;
  applicationId: string;
  interactionToken: string;
  commandName: string;
  responseSnapshot: {
    message: string;
    [key: string]: any;
  };
}

export interface ProcessInteractionResult {
  deliveryResult: RetriedDeliveryResult;
  attempts: number;
}

export async function processInteraction(
  input: ProcessInteractionInput,
  options: RetryDeliveryOptions = {}
): Promise<ProcessInteractionResult> {
  const { applicationId, interactionToken, responseSnapshot } = input;

  const payload = {
    content: responseSnapshot.message,
  };

  const deliveryResult = await retryDiscordDelivery(
    {
      applicationId,
      interactionToken,
      payload,
    },
    options
  );

  return {
    deliveryResult,
    attempts: deliveryResult.attempts,
  };
}
