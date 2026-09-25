import { NextResponse } from "next/server";
import { getRetrySession } from "@/lib/auth/retry-session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const STALE_PENDING_MS = 2 * 60 * 1000;

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

  if (claimResult.count === 1) {
    return NextResponse.json(
      { eligible: true, claimed: true, actionId, type: action.type },
      { status: 200 }
    );
  }

  return NextResponse.json(
    { eligible: false, actionId, type: action.type },
    { status: 409 }
  );
}
