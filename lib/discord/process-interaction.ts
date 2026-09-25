import {
  retryDiscordDelivery,
  RetriedDeliveryResult,
  RetryDeliveryOptions,
} from "./retry-discord-delivery";
import { normalizeReportText } from "./normalize-report";
import { prisma } from "@/lib/db";

export interface ProcessInteractionClient {
  actionRecord: {
    updateMany(args: {
      where: { interactionLogId: string; type: "DISCORD_RESPONSE" };
      data: {
        status: string;
        attempts: number;
        completedAt: Date;
        lastError?: string | null;
      };
    }): Promise<unknown>;
  };
  interactionLog: {
    update(args: {
      where: { id: string };
      data: {
        status: string;
        processedAt: Date;
      };
    }): Promise<unknown>;
  };
}

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
  options: RetryDeliveryOptions & { client?: ProcessInteractionClient } = {}
): Promise<ProcessInteractionResult> {
  const { interactionLogId, applicationId, interactionToken, commandName, reportText, responseSnapshot } = input;

  let normalizedReportText: string | undefined;
  if (commandName === "report" && reportText !== undefined) {
    const normalized = normalizeReportText(reportText);
    normalizedReportText = normalized.text;
  }

  const content =
    commandName === "report" && normalizedReportText
      ? `${responseSnapshot.message}: ${normalizedReportText}`
      : responseSnapshot.message;

  const payload = {
    content,
    allowed_mentions: {
      parse: [],
    },
  };

  const deliveryResult = await retryDiscordDelivery(
    {
      applicationId,
      interactionToken,
      payload,
    },
    options
  );

  if (deliveryResult.success) {
    const dbClient = options.client || prisma;
    await dbClient.actionRecord.updateMany({
      where: {
        interactionLogId,
        type: "DISCORD_RESPONSE",
      },
      data: {
        status: "SUCCESS",
        attempts: deliveryResult.attempts,
        completedAt: new Date(),
      },
    });
    await dbClient.interactionLog.update({
      where: { id: interactionLogId },
      data: {
        status: "COMPLETED",
        processedAt: new Date(),
      },
    });
  } else {
    const dbClient = options.client || prisma;
    await dbClient.actionRecord.updateMany({
      where: {
        interactionLogId,
        type: "DISCORD_RESPONSE",
      },
      data: {
        status: "FAILED",
        attempts: deliveryResult.attempts,
        completedAt: new Date(),
        lastError: deliveryResult.error || "Discord response delivery failed",
      },
    });
    await dbClient.interactionLog.update({
      where: { id: interactionLogId },
      data: {
        status: "FAILED",
        processedAt: new Date(),
      },
    });
  }

  return {
    deliveryResult,
    attempts: deliveryResult.attempts,
    normalizedReportText,
  };
}
