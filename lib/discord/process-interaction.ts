import {
  retryDiscordDelivery,
  RetriedDeliveryResult,
  RetryDeliveryOptions,
} from "./retry-discord-delivery";
import { normalizeReportText } from "./normalize-report";

export interface ProcessInteractionInput {
  interactionLogId: string;
  applicationId: string;
  interactionToken: string;
  commandName: string;
  reportText?: string;
  responseSnapshot: {
    message: string;
    [key: string]: any;
  };
}

export interface ProcessInteractionResult {
  deliveryResult: RetriedDeliveryResult;
  attempts: number;
  normalizedReportText?: string;
}

export async function processInteraction(
  input: ProcessInteractionInput,
  options: RetryDeliveryOptions = {}
): Promise<ProcessInteractionResult> {
  const { applicationId, interactionToken, commandName, reportText, responseSnapshot } = input;

  let normalizedReportText: string | undefined;
  if (commandName === "report" && reportText !== undefined) {
    const normalized = normalizeReportText(reportText);
    normalizedReportText = normalized.text;
  }

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
    normalizedReportText,
  };
}
