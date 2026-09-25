import { prisma } from "@/lib/db";
import { ParsedInteraction } from "@/lib/discord/types";
import { normalizeReportText } from "./normalize-report";

export interface PersistInteractionInput {
  parsed: Extract<ParsedInteraction, { type: "APPLICATION_COMMAND" }>;
  raw?: {
    guild_id?: string;
    channel_id?: string;
    member?: {
      user?: {
        id?: string;
        username?: string;
      };
    };
    user?: {
      id?: string;
      username?: string;
    };
    [key: string]: any;
  };
  commandRule: {
    responseText: string;
    mirrorEnabled: boolean;
    channelPostEnabled: boolean;
  };
}

export interface PersistInteractionResult {
  success: boolean;
  duplicate: boolean;
  interactionLog?: any;
}

export async function persistInteraction(
  input: PersistInteractionInput,
  client: any = prisma
): Promise<PersistInteractionResult> {
  const { parsed, raw, commandRule } = input;

  const interactionId = parsed.id;
  const guildId = parsed.guildId || raw?.guild_id || "unknown_guild";
  const channelId = parsed.channelId || raw?.channel_id || "unknown_channel";
  const userId =
    raw?.member?.user?.id ||
    raw?.user?.id ||
    (parsed as any).userId ||
    "unknown_user";
  const username =
    raw?.member?.user?.username ||
    raw?.user?.username ||
    (parsed as any).username ||
    "unknown_user";
  const commandName = parsed.commandName;
  const commandOptions = parsed.options || {};

  const outboundSnapshot = {
    message: commandRule.responseText,
  };

  let discordResponseSnapshot = outboundSnapshot;
  if (commandName === "report") {
    const reportText = parsed.options?.["text"];
    if (reportText !== undefined) {
      const normalized = normalizeReportText(reportText);
      if (normalized.text) {
        discordResponseSnapshot = {
          message: `${commandRule.responseText}: ${normalized.text}`,
        };
      }
    }
  }

  try {
    const result = await client.$transaction(async (tx: any) => {
      const existing = await tx.interactionLog.findUnique({
        where: { interactionId },
        include: { actions: true },
      });

      if (existing) {
        return { existing, duplicate: true };
      }

      const actionsToCreate: any[] = [
        {
          type: "DISCORD_RESPONSE",
          status: "PENDING",
          attempts: 0,
          result: discordResponseSnapshot,
        },
      ];

      if (commandRule.channelPostEnabled) {
        actionsToCreate.push({
          type: "CHANNEL_POST",
          status: "PENDING",
          attempts: 0,
          result: discordResponseSnapshot,
        });
      }

      if (commandRule.mirrorEnabled) {
        actionsToCreate.push({
          type: "MIRROR",
          status: "PENDING",
          attempts: 0,
          result: outboundSnapshot,
        });
      }

      const log = await tx.interactionLog.create({
        data: {
          interactionId,
          guildId,
          channelId,
          userId,
          username,
          commandName,
          commandOptions,
          status: "RECEIVED",
          actions: {
            create: actionsToCreate,
          },
        },
        include: { actions: true },
      });

      return { existing: log, duplicate: false };
    });

    return {
      success: true,
      duplicate: result.duplicate,
      interactionLog: result.existing,
    };
  } catch (error: any) {
    if (error && error.code === "P2002") {
      const existing = await client.interactionLog.findUnique({
        where: { interactionId },
        include: { actions: true },
      });
      return {
        success: true,
        duplicate: true,
        interactionLog: existing,
      };
    }
    throw error;
  }
}
