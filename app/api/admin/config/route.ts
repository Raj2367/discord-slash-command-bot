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
        },
      }),
    ]);

    let hasWebhook = false;
    if (serverConfig) {
      const webhookCheck = await prisma.discordServerConfig.findFirst({
        where: {
          id: serverConfig.id,
          mirrorWebhookUrl: { not: null },
        },
        select: { id: true },
      });
      hasWebhook = !!webhookCheck;
    }

    const safeServerConfig = serverConfig
      ? {
          id: serverConfig.id,
          guildId: serverConfig.guildId,
          guildName: serverConfig.guildName,
          channelId: serverConfig.channelId,
          mirrorType: serverConfig.mirrorType,
          mirrorWebhookConfigured: hasWebhook,
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

  if (body?.type === "command") {
    return updateCommandRule(body);
  }

  if (body?.type === "server") {
    return updateServerConfig(body);
  }

  return NextResponse.json(
    { error: "Invalid request: type must be 'command' or 'server'" },
    { status: 400 }
  );
}

async function updateCommandRule(body: any) {
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

async function updateServerConfig(body: any) {
  const id = body?.id;
  if (typeof id !== "string" || !id) {
    return NextResponse.json(
      { error: "id is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  const guildName = body?.guildName;
  if (typeof guildName !== "string") {
    return NextResponse.json(
      { error: "guildName must be a string" },
      { status: 400 }
    );
  }

  if (guildName.trim().length === 0) {
    return NextResponse.json(
      { error: "guildName must not be empty" },
      { status: 400 }
    );
  }

  if (guildName.length > 200) {
    return NextResponse.json(
      { error: "guildName exceeds maximum length of 200 characters" },
      { status: 400 }
    );
  }

  const channelId = body?.channelId;
  if (channelId !== null && typeof channelId !== "string") {
    return NextResponse.json(
      { error: "channelId must be null or a string" },
      { status: 400 }
    );
  }

  if (channelId === "") {
    return NextResponse.json(
      { error: "channelId must not be an empty string" },
      { status: 400 }
    );
  }

  const mirrorType = body?.mirrorType;
  if (
    mirrorType !== null &&
    mirrorType !== "DISCORD_WEBHOOK" &&
    mirrorType !== "SLACK_WEBHOOK"
  ) {
    return NextResponse.json(
      { error: "mirrorType must be null, 'DISCORD_WEBHOOK', or 'SLACK_WEBHOOK'" },
      { status: 400 }
    );
  }

  const mirrorWebhookUrl = body?.mirrorWebhookUrl;
  if (
    mirrorWebhookUrl !== undefined &&
    mirrorWebhookUrl !== null &&
    typeof mirrorWebhookUrl !== "string"
  ) {
    return NextResponse.json(
      { error: "mirrorWebhookUrl must be null, a string, or omitted" },
      { status: 400 }
    );
  }

  let webhookUrlUpdate: string | null | undefined;
  if (mirrorWebhookUrl === undefined) {
    webhookUrlUpdate = undefined;
  } else if (typeof mirrorWebhookUrl === "string") {
    if (mirrorWebhookUrl.length > 2000) {
      return NextResponse.json(
        { error: "mirrorWebhookUrl exceeds maximum length of 2000 characters" },
        { status: 400 }
      );
    }
    webhookUrlUpdate =
      mirrorWebhookUrl.trim().length > 0 ? mirrorWebhookUrl.trim() : null;
  } else {
    webhookUrlUpdate = null;
  }

  const updateData: {
    guildName: string;
    channelId: string | null;
    mirrorType: string | null;
    mirrorWebhookUrl?: string | null;
  } = {
    guildName: guildName.trim(),
    channelId: channelId,
    mirrorType,
  };

  if (webhookUrlUpdate !== undefined) {
    updateData.mirrorWebhookUrl = webhookUrlUpdate;
  }

  try {
    const existing = await prisma.discordServerConfig.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "DiscordServerConfig not found" },
        { status: 404 }
      );
    }

    const updated = await prisma.discordServerConfig.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        guildId: true,
        guildName: true,
        channelId: true,
        mirrorType: true,
        mirrorWebhookUrl: true,
        updatedAt: true,
      },
    });

    const safeConfig = {
      id: updated.id,
      guildId: updated.guildId,
      guildName: updated.guildName,
      channelId: updated.channelId,
      mirrorType: updated.mirrorType,
      mirrorWebhookConfigured:
        !!updated.mirrorWebhookUrl && updated.mirrorWebhookUrl.length > 0,
      updatedAt: updated.updatedAt,
    };

    return NextResponse.json(
      { serverConfig: safeConfig },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to update configuration" },
      { status: 500 }
    );
  }
}
