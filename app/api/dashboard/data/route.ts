import { NextResponse } from "next/server";
import { getRetrySession } from "@/lib/auth/retry-session";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getRetrySession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const interactions = await prisma.interactionLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        interactionId: true,
        guildId: true,
        channelId: true,
        userId: true,
        username: true,
        commandName: true,
        status: true,
        createdAt: true,
        processedAt: true,
        actions: {
          select: {
            id: true,
            type: true,
            status: true,
            attempts: true,
            lastError: true,
            createdAt: true,
            completedAt: true,
            updatedAt: true,
          },
        },
      },
    });

    return NextResponse.json({ interactions }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}
