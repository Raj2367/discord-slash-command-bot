import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/mydb";
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "changeme123";
  const guildId = process.env.DISCORD_GUILD_ID || "123456789012345678";

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  // 1. Upsert throwaway admin
  await prisma.admin.upsert({
    where: { email: adminEmail },
    update: { passwordHash },
    create: {
      email: adminEmail,
      passwordHash,
    },
  });

  // 2. Upsert default /status command rule
  await prisma.commandRule.upsert({
    where: { commandName: "status" },
    update: {},
    create: {
      commandName: "status",
      enabled: true,
      responseText: "Bot is operational and online.",
      mirrorEnabled: false,
      channelPostEnabled: false,
      aiEnabled: false,
    },
  });

  // 3. Upsert default /report command rule
  await prisma.commandRule.upsert({
    where: { commandName: "report" },
    update: {},
    create: {
      commandName: "report",
      enabled: true,
      responseText: "Report received and logged successfully.",
      mirrorEnabled: true,
      channelPostEnabled: true,
      aiEnabled: true,
    },
  });

  // 4. Upsert initial single-server configuration
  await prisma.discordServerConfig.upsert({
    where: { guildId },
    update: {},
    create: {
      guildId,
      guildName: "Test Discord Server",
      channelId: null,
      mirrorType: "DISCORD_WEBHOOK",
      mirrorWebhookUrl: null,
    },
  });

  console.log("Database seeding completed successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
