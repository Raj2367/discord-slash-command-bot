import { NextResponse } from "next/server";
import { after } from "@/lib/discord/after";
import { getDiscordConfig } from "@/lib/discord/config";
import { verifyDiscordSignature } from "@/lib/discord/verify-signature";
import { validateTimestamp } from "@/lib/discord/validate-timestamp";
import { parseInteraction } from "@/lib/discord/parse-interaction";
import { persistInteraction } from "@/lib/discord/persist-interaction";
import { processInteraction } from "@/lib/discord/process-interaction";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const signature = request.headers.get("X-Signature-Ed25519");
    const timestamp = request.headers.get("X-Signature-Timestamp");

    if (!signature || !timestamp) {
      return NextResponse.json(
        { error: "Missing signature or timestamp headers" },
        { status: 401 }
      );
    }

    let config;
    try {
      config = getDiscordConfig();
    } catch (err: any) {
      return NextResponse.json(
        { error: err?.message || "Discord configuration error" },
        { status: 500 }
      );
    }

    // Read raw request body before JSON parsing
    const rawBody = await request.text();

    // Validate timestamp
    if (!validateTimestamp(timestamp, config.signatureMaxAgeSeconds)) {
      return NextResponse.json(
        { error: "Invalid or stale timestamp" },
        { status: 401 }
      );
    }

    // Verify Ed25519 signature against exact raw body
    const isValidSig = verifyDiscordSignature(
      rawBody,
      signature,
      timestamp,
      config.publicKey
    );

    if (!isValidSig) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // Parse interaction after successful verification
    let rawJson: any;
    try {
      rawJson = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON interaction payload." },
        { status: 400 }
      );
    }

    let parsed;
    try {
      parsed = parseInteraction(rawJson);
    } catch (err: any) {
      return NextResponse.json(
        { error: err?.message || "Invalid interaction payload" },
        { status: 400 }
      );
    }

    if (parsed.type === "PING") {
      return NextResponse.json({ type: 1 }, { status: 200 });
    }

    if (parsed.type === "APPLICATION_COMMAND") {
      const guildId = parsed.guildId || rawJson?.guild_id;

      // Require guild_id and match configured guild
      if (!guildId || guildId !== config.guildId) {
        return NextResponse.json(
          {
            type: 4,
            data: {
              content: "Bot is not configured for this server or context.",
              flags: 64, // Ephemeral
            },
          },
          { status: 200 }
        );
      }

      // Check DiscordServerConfig in DB if present, or match guildId
      let serverConfig = null;
      try {
        serverConfig = await prisma.discordServerConfig.findUnique({
          where: { guildId },
        });
      } catch {
        // If DB fails or unseeded, fallback to config.guildId match
      }

      if (serverConfig && serverConfig.guildId !== guildId) {
        return NextResponse.json(
          {
            type: 4,
            data: {
              content: "Bot is not configured for this server.",
              flags: 64,
            },
          },
          { status: 200 }
        );
      }

      const commandName = parsed.commandName;

      // Load CommandRule
      let commandRule = null;
      try {
        commandRule = await prisma.commandRule.findUnique({
          where: { commandName },
        });
      } catch (err) {
        console.error("Error loading command rule:", err);
      }

      if (!commandRule || !commandRule.enabled) {
        // Persist interaction as COMPLETED with no delivery actions
        const interactionId = parsed.id;
        const channelId = parsed.channelId || rawJson?.channel_id || "unknown_channel";
        const userId =
          rawJson?.member?.user?.id ||
          rawJson?.user?.id ||
          "unknown_user";
        const username =
          rawJson?.member?.user?.username ||
          rawJson?.user?.username ||
          "unknown_user";
        const commandOptions = parsed.options || {};

        try {
          await prisma.interactionLog.create({
            data: {
              interactionId,
              guildId,
              channelId,
              userId,
              username,
              commandName,
              commandOptions,
              status: "COMPLETED",
            },
          });
        } catch (err: any) {
          // If duplicate P2002, ignore or handle
        }

        return NextResponse.json(
          {
            type: 4,
            data: {
              content: "Command disabled",
              flags: 64,
            },
          },
          { status: 200 }
        );
      }

      // Enabled and configured command: persist via persistInteraction
      try {
        const persistResult = await persistInteraction({
          parsed,
          raw: rawJson,
          commandRule: {
            responseText: commandRule.responseText,
            mirrorEnabled: commandRule.mirrorEnabled,
            channelPostEnabled: commandRule.channelPostEnabled,
          },
        });

        const interactionLog = persistResult.interactionLog;

        if (!persistResult.duplicate && interactionLog?.id) {
          const discordResponseAction = interactionLog.actions?.find(
            (a: any) => a.type === "DISCORD_RESPONSE"
          );
          const persistedMessage =
            discordResponseAction?.result?.message ?? commandRule.responseText;

          const runPostResponse = async () => {
            try {
              await processInteraction({
                interactionLogId: interactionLog.id,
                applicationId: config.applicationId,
                interactionToken: parsed.token!,
                commandName,
                responseSnapshot: {
                  message: persistedMessage,
                },
                channelPostEnabled: commandRule.channelPostEnabled,
                channelId: serverConfig?.channelId,
                botToken: process.env.DISCORD_BOT_TOKEN,
              });
            } catch (err) {
              console.error("Error in post-response processInteraction:", err);
            }
          };

          after(runPostResponse);
        }

        // Return deferred response { type: 5 } for both new and duplicate interactions
        return NextResponse.json({ type: 5 }, { status: 200 });
      } catch (err: any) {
        console.error("Error persisting interaction:", err);
        return NextResponse.json(
          { error: "Internal server error during persistence" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { error: "Unsupported interaction type" },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("Discord interaction error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
