export interface DiscordConfig {
  applicationId: string;
  publicKey: string;
  botToken: string;
  guildId: string;
  signatureMaxAgeSeconds: number;
}

export function getDiscordConfig(): DiscordConfig {
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  const rawMaxAge = process.env.SIGNATURE_MAX_AGE_SECONDS;

  if (!applicationId || !publicKey || !botToken || !guildId) {
    throw new Error(
      "Missing required Discord environment variables (DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID)."
    );
  }

  let signatureMaxAgeSeconds = 300;
  if (rawMaxAge !== undefined && rawMaxAge !== "") {
    const parsed = Number(rawMaxAge);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("SIGNATURE_MAX_AGE_SECONDS must be a positive integer.");
    }
    signatureMaxAgeSeconds = parsed;
  }

  return {
    applicationId,
    publicKey,
    botToken,
    guildId,
    signatureMaxAgeSeconds,
  };
}
