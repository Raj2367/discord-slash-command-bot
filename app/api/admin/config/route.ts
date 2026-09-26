import { NextResponse } from "next/server";
import { getRetrySession } from "@/lib/auth/retry-session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const session = await getRetrySession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [commandRules, serverConfig] = await Promise.all([
      prisma.commandRule.findMany({
        select: {
          id: true,
          commandName: true,
          enabled: true,
          responseText: true,
          mirrorEnabled: true,
          channelPostEnabled: true,
          aiEnabled: true,
          updatedAt: true,
        },
      }),
      prisma.discordServerConfig.findFirst({
        select: {
          id: true,
          guildId: true,
          guildName: true,
          channelId: true,
          mirrorType: true,
          mirrorWebhookUrl: true,
        },
      }),
    ]);

    const safeServerConfig = serverConfig
      ? {
          id: serverConfig.id,
          guildId: serverConfig.guildId,
          guildName: serverConfig.guildName,
          channelId: serverConfig.channelId,
          mirrorType: serverConfig.mirrorType,
          mirrorWebhookConfigured:
            !!serverConfig.mirrorWebhookUrl &&
            serverConfig.mirrorWebhookUrl.length > 0,
        }
      : null;

    return NextResponse.json(
      { commandRules, serverConfig: safeServerConfig },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch configuration" },
      { status: 500 }
    );
  }
}
