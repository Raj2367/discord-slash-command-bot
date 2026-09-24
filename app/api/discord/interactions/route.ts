import { NextResponse } from "next/server";
import { getDiscordConfig } from "@/lib/discord/config";
import { verifyDiscordSignature } from "@/lib/discord/verify-signature";
import { validateTimestamp } from "@/lib/discord/validate-timestamp";
import { parseInteraction } from "@/lib/discord/parse-interaction";

export const runtime = "nodejs";

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
    let parsed;
    try {
      parsed = parseInteraction(rawBody);
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
      return NextResponse.json(
        {
          type: 4,
          data: {
            content: `Command received: ${parsed.commandName}`,
          },
        },
        { status: 200 }
      );
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
