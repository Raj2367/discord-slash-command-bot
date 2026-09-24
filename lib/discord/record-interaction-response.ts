import { prisma } from "@/lib/db";
import { DeliveryResult } from "./deliver-interaction-response";

export interface RecordInteractionResponseInput {
  interactionLogId: string;
  attempts: number;
  deliveryResult: DeliveryResult;
}

export interface RecordInteractionResponseResult {
  success: boolean;
  updated: boolean;
  error?: string;
}

export async function recordInteractionResponse(
  input: RecordInteractionResponseInput,
  client: any = prisma
): Promise<RecordInteractionResponseResult> {
  const { interactionLogId, attempts, deliveryResult } = input;

  if (!interactionLogId) {
    return { success: false, updated: false, error: "Missing interactionLogId" };
  }

  try {
    return await client.$transaction(async (tx: any) => {
      const log = await tx.interactionLog.findUnique({
        where: { id: interactionLogId },
        include: { actions: true },
      });

      if (!log) {
        return { success: false, updated: false, error: "InteractionLog not found" };
      }

      const discordAction = log.actions?.find(
        (a: any) => a.type === "DISCORD_RESPONSE"
      );

      if (!discordAction) {
        return {
          success: false,
          updated: false,
          error: "DISCORD_RESPONSE action record not found",
        };
      }

      // Handle repeated finalization attempts (do not regress SUCCESS)
      if (discordAction.status === "SUCCESS") {
        return { success: true, updated: false };
      }

      const isSuccess = deliveryResult.success;
      const actionStatus = isSuccess ? "SUCCESS" : "FAILED";
      const logStatus = isSuccess ? "COMPLETED" : "FAILED";
      const lastError = isSuccess
        ? null
        : deliveryResult.error || "Discord response delivery failed";

      const now = new Date();

      await tx.actionRecord.update({
        where: { id: discordAction.id },
        data: {
          status: actionStatus,
          attempts,
          completedAt: now,
          lastError,
        },
      });

      await tx.interactionLog.update({
        where: { id: interactionLogId },
        data: {
          status: logStatus,
          processedAt: now,
        },
      });

      return { success: true, updated: true };
    });
  } catch (error: any) {
    return {
      success: false,
      updated: false,
      error: error?.message || "Database error recording interaction response",
    };
  }
}
