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

export async function POST(request: Request) {
  const session = await getRetrySession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body?.type !== "command") {
    return NextResponse.json(
      { error: "Invalid request: type must be 'command'" },
      { status: 400 }
    );
  }

  const id = body?.id;
  if (typeof id !== "string" || !id) {
    return NextResponse.json(
      { error: "id is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json(
      { error: "enabled must be a boolean" },
      { status: 400 }
    );
  }

  if (typeof body?.mirrorEnabled !== "boolean") {
    return NextResponse.json(
      { error: "mirrorEnabled must be a boolean" },
      { status: 400 }
    );
  }

  if (typeof body?.channelPostEnabled !== "boolean") {
    return NextResponse.json(
      { error: "channelPostEnabled must be a boolean" },
      { status: 400 }
    );
  }

  if (typeof body?.aiEnabled !== "boolean") {
    return NextResponse.json(
      { error: "aiEnabled must be a boolean" },
      { status: 400 }
    );
  }

  const responseText = body?.responseText;
  if (typeof responseText !== "string") {
    return NextResponse.json(
      { error: "responseText must be a string" },
      { status: 400 }
    );
  }

  if (responseText.trim().length === 0) {
    return NextResponse.json(
      { error: "responseText must not be empty" },
      { status: 400 }
    );
  }

  if (responseText.length > 1000) {
    return NextResponse.json(
      { error: "responseText exceeds maximum length of 1000 characters" },
      { status: 400 }
    );
  }

  try {
    const existing = await prisma.commandRule.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "CommandRule not found" },
        { status: 404 }
      );
    }

    const updated = await prisma.commandRule.update({
      where: { id },
      data: {
        enabled: body.enabled,
        responseText: responseText,
        mirrorEnabled: body.mirrorEnabled,
        channelPostEnabled: body.channelPostEnabled,
        aiEnabled: body.aiEnabled,
      },
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
    });

    return NextResponse.json(
      { commandRule: updated },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to update configuration" },
      { status: 500 }
    );
  }
}
