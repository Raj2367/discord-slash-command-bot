import { NextResponse } from "next/server";
import { getRetrySession } from "@/lib/auth/retry-session";
import { prisma } from "@/lib/db";
import { retryChannelPost } from "@/lib/discord/retry-channel-post";
import { retryMirror } from "@/lib/discord/retry-mirror";

export const runtime = "nodejs";
export const maxDuration = 60;

const STALE_PENDING_MS = 2 * 60 * 1000;

let _retryChannelPost = retryChannelPost;
let _retryMirror = retryMirror;

// @ts-ignore — test seam on the mutable prisma object
(prisma as any).__setRetryChannelPost = (fn: typeof retryChannelPost) => {
  _retryChannelPost = fn;
};

// @ts-ignore — test seam on the mutable prisma object
(prisma as any).__setRetryMirror = (fn: typeof retryMirror) => {
  _retryMirror = fn;
};

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

  const actionId = body?.actionId;
  if (typeof actionId !== "string" || !actionId) {
    return NextResponse.json({ error: "actionId is required" }, { status: 400 });
  }

  const action = await prisma.actionRecord.findUnique({
    where: { id: actionId },
    include: { interactionLog: true },
  });

  if (!action) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }

  if (action.type === "DISCORD_RESPONSE") {
    return NextResponse.json(
      { error: "DISCORD_RESPONSE is not eligible for manual retry" },
      { status: 400 }
    );
  }

  let eligible = false;
  if (action.status === "FAILED") {
    eligible = true;
  } else if (action.status === "PENDING") {
    const updatedAt = new Date(action.updatedAt);
    eligible = Date.now() - updatedAt.getTime() > STALE_PENDING_MS;
  }

  if (!eligible) {
    return NextResponse.json(
      { eligible: false, actionId, type: action.type },
      { status: 409 }
    );
  }

  const staleCutoff = new Date(Date.now() - STALE_PENDING_MS);
  const claimResult = await prisma.actionRecord.updateMany({
    where: {
      id: actionId,
      OR: [
        { status: "FAILED" },
        { status: "PENDING", updatedAt: { lt: staleCutoff } },
      ],
    },
    data: {
      status: "PENDING",
      attempts: 0,
      completedAt: null,
      lastError: null,
    },
  });

  if (claimResult.count !== 1) {
    return NextResponse.json(
      { eligible: false, actionId, type: action.type },
      { status: 409 }
    );
  }

  // Claimed successfully — execute delivery for CHANNEL_POST only
  if (action.type === "CHANNEL_POST") {
    const serverConfig = await prisma.discordServerConfig.findUnique({
      where: { guildId: action.interactionLog.guildId },
    });

    const channelId = serverConfig?.channelId;
    const botToken = process.env.DISCORD_BOT_TOKEN;

    if (!channelId || !botToken) {
      await prisma.actionRecord.updateMany({
        where: {
          interactionLogId: action.interactionLogId,
          type: "CHANNEL_POST",
        },
        data: {
          status: "FAILED",
          attempts: 0,
          completedAt: new Date(),
          lastError: "Discord channel post is not configured",
        },
      });
      return NextResponse.json(
        {
          eligible: true,
          claimed: true,
          actionId,
          type: "CHANNEL_POST",
          status: "FAILED",
        },
        { status: 200 }
      );
    }

    const rawResult = action.result;
    const message =
      rawResult &&
      typeof rawResult === "object" &&
      rawResult !== null &&
      !Array.isArray(rawResult) &&
      typeof (rawResult as Record<string, unknown>).message === "string"
        ? (rawResult as { message: string }).message
        : null;

    if (!message) {
      await prisma.actionRecord.updateMany({
        where: {
          interactionLogId: action.interactionLogId,
          type: "CHANNEL_POST",
        },
        data: {
          status: "FAILED",
          attempts: 0,
          completedAt: new Date(),
          lastError: "Stored channel post snapshot is invalid",
        },
      });
      return NextResponse.json(
        {
          eligible: true,
          claimed: true,
          actionId,
          type: "CHANNEL_POST",
          status: "FAILED",
        },
        { status: 200 }
      );
    }

    let cpResult;
    try {
      cpResult = await _retryChannelPost({
        channelId,
        botToken,
        message,
      });
    } catch (err) {
      await prisma.actionRecord.updateMany({
        where: {
          interactionLogId: action.interactionLogId,
          type: "CHANNEL_POST",
        },
        data: {
          status: "FAILED",
          attempts: 0,
          completedAt: new Date(),
          lastError:
            err instanceof Error
              ? err.message
              : "Channel post retry failed",
        },
      });
      return NextResponse.json(
        {
          eligible: true,
          claimed: true,
          actionId,
          type: "CHANNEL_POST",
          status: "FAILED",
        },
        { status: 200 }
      );
    }

    if (cpResult.success) {
      await prisma.actionRecord.updateMany({
        where: {
          interactionLogId: action.interactionLogId,
          type: "CHANNEL_POST",
        },
        data: {
          status: "SUCCESS",
          attempts: cpResult.attempts,
          completedAt: new Date(),
          lastError: null,
        },
      });
      return NextResponse.json(
        {
          eligible: true,
          claimed: true,
          actionId,
          type: "CHANNEL_POST",
          status: "SUCCESS",
        },
        { status: 200 }
      );
    }

    await prisma.actionRecord.updateMany({
      where: {
        interactionLogId: action.interactionLogId,
        type: "CHANNEL_POST",
      },
      data: {
        status: "FAILED",
        attempts: cpResult.attempts,
        completedAt: new Date(),
        lastError: cpResult.error || "Discord channel post delivery failed",
      },
    });
    return NextResponse.json(
      {
        eligible: true,
        claimed: true,
        actionId,
        type: "CHANNEL_POST",
        status: "FAILED",
      },
      { status: 200 }
    );
  }

  // Claimed successfully — execute delivery for MIRROR
  if (action.type === "MIRROR") {
    const serverConfig = await prisma.discordServerConfig.findUnique({
      where: { guildId: action.interactionLog.guildId },
    });

    const mirrorType = serverConfig?.mirrorType;
    const mirrorWebhookUrl = serverConfig?.mirrorWebhookUrl;

    if (mirrorType !== "DISCORD_WEBHOOK" || !mirrorWebhookUrl) {
      await prisma.actionRecord.updateMany({
        where: {
          interactionLogId: action.interactionLogId,
          type: "MIRROR",
        },
        data: {
          status: "FAILED",
          attempts: 0,
          completedAt: new Date(),
          lastError: "Discord mirror is not configured",
        },
      });
      return NextResponse.json(
        {
          eligible: true,
          claimed: true,
          actionId,
          type: "MIRROR",
          status: "FAILED",
        },
        { status: 200 }
      );
    }

    const rawResult = action.result;
    const message =
      rawResult &&
      typeof rawResult === "object" &&
      rawResult !== null &&
      !Array.isArray(rawResult) &&
      typeof (rawResult as Record<string, unknown>).message === "string"
        ? (rawResult as { message: string }).message
        : null;

    if (!message) {
      await prisma.actionRecord.updateMany({
        where: {
          interactionLogId: action.interactionLogId,
          type: "MIRROR",
        },
        data: {
          status: "FAILED",
          attempts: 0,
          completedAt: new Date(),
          lastError: "Stored mirror snapshot is invalid",
        },
      });
      return NextResponse.json(
        {
          eligible: true,
          claimed: true,
          actionId,
          type: "MIRROR",
          status: "FAILED",
        },
        { status: 200 }
      );
    }

    let mirrorResult;
    try {
      mirrorResult = await _retryMirror({
        webhookUrl: mirrorWebhookUrl,
        message,
      });
    } catch (err) {
      await prisma.actionRecord.updateMany({
        where: {
          interactionLogId: action.interactionLogId,
          type: "MIRROR",
        },
        data: {
          status: "FAILED",
          attempts: 0,
          completedAt: new Date(),
          lastError:
            err instanceof Error
              ? err.message
              : "Mirror retry failed",
        },
      });
      return NextResponse.json(
        {
          eligible: true,
          claimed: true,
          actionId,
          type: "MIRROR",
          status: "FAILED",
        },
        { status: 200 }
      );
    }

    if (mirrorResult.success) {
      await prisma.actionRecord.updateMany({
        where: {
          interactionLogId: action.interactionLogId,
          type: "MIRROR",
        },
        data: {
          status: "SUCCESS",
          attempts: mirrorResult.attempts,
          completedAt: new Date(),
          lastError: null,
        },
      });
      return NextResponse.json(
        {
          eligible: true,
          claimed: true,
          actionId,
          type: "MIRROR",
          status: "SUCCESS",
        },
        { status: 200 }
      );
    }

    await prisma.actionRecord.updateMany({
      where: {
        interactionLogId: action.interactionLogId,
        type: "MIRROR",
      },
      data: {
        status: "FAILED",
        attempts: mirrorResult.attempts,
        completedAt: new Date(),
        lastError: mirrorResult.error || "Discord mirror delivery failed",
      },
    });
    return NextResponse.json(
      {
        eligible: true,
        claimed: true,
        actionId,
        type: "MIRROR",
        status: "FAILED",
      },
      { status: 200 }
    );
  }
}
