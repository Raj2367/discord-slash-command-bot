import { config } from "dotenv";
config();
import { exit } from "process";

const applicationId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;

const missing: string[] = [];
if (!applicationId) missing.push("DISCORD_APPLICATION_ID");
if (!guildId) missing.push("DISCORD_GUILD_ID");
if (!botToken) missing.push("DISCORD_BOT_TOKEN");

if (missing.length > 0) {
  throw new Error(
    `Missing required environment variable(s): ${missing.join(", ")}`,
  );
}

const commands = [
  {
    name: "status",
    type: 1,
    description: "Check bot status",
  },
  {
    name: "report",
    type: 1,
    description: "Submit a report",
    options: [
      {
        type: 3,
        name: "text",
        description: "Report text",
        required: true,
      },
    ],
  },
];

async function main() {
  const url = `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    throw new Error(`Discord API error: ${res.status} ${res.statusText}`);
  }

  const registered = await res.json();
  const names = Array.isArray(registered)
    ? registered.map((c: any) => c.name).join(", ")
    : "unknown";

  console.log(`Registered commands for guild ${guildId}: ${names}`);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
