# Discord Slash-Command Bot

## Project Overview
A single Next.js application that provides an authenticated admin dashboard and a Discord slash-command integration.

**Supported commands:**
- `/status` — bot responds with its configured status message
- `/report <text>` — submits a user report; the bot defers, persists the interaction, and processes it post-response

## Architecture
- **One Next.js application**, Node.js runtime
- **PostgreSQL** for durable persistence via **Prisma** (Prisma 7 + `@prisma/adapter-pg`)
- **Vercel** deployment target
- Post-response work (Discord response, channel post, mirror) runs via Next.js `after()`
- **Bounded inline retries** (3 total attempts, ~1s/~3s delays, 4s per-fetch timeout, 60s route `maxDuration`)
- No background workers, queues, cron, Kafka, Redis, or WebSockets

## Prerequisites
- Node.js 18+ (tested with Node 22)
- PostgreSQL database (Neon or self-hosted)
- Discord application with a bot
- Vercel account for deployment (or run locally with `npm run dev`)

## Local Setup
```sh
git clone <repo-url>
cd discord-slash-command-bot
npm install
cp .env.example .env
```
Fill all required variables in `.env` (see [Environment Variables](#environment-variables)).

```sh
npm run build        # generates Prisma client
npx prisma generate  # ensure client is generated
npx prisma migrate dev --name init   # create migration and apply
npm run seed         # creates admin, command rules, and server config
npm run register:commands   # registers /status and /report (guild-scoped)
npm run dev          # http://localhost:3000
```

## Environment Variables
| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Pooled runtime PostgreSQL connection (Neon) |
| `DIRECT_URL` | Yes | Direct PostgreSQL connection for Prisma migrations |
| `DISCORD_APPLICATION_ID` | Yes | Discord application (bot) client ID |
| `DISCORD_PUBLIC_KEY` | Yes | Discord application public key (signature verification) |
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `DISCORD_GUILD_ID` | Yes | Guild ID where slash commands are registered |
| `SESSION_SECRET` | Yes | Strong random string for signed session cookies |
| `SEED_ADMIN_EMAIL` | Yes | Initial admin email for seeding |
| `SEED_ADMIN_PASSWORD` | Yes | Initial admin password for seeding |
| `SIGNATURE_MAX_AGE_SECONDS` | No (default 300) | Discord signature timestamp freshness window |
| `GEMINI_API_KEY` | No | Google Gemini API key for optional AI summarization |

See `.env.example` for exact variable names.

## Database Setup
```sh
npx prisma migrate dev --name init   # creates and applies a migration
npm run seed                         # seeds the database
```
`npm run seed` creates:
1. A throwaway admin account (email from `SEED_ADMIN_EMAIL`)
2. Default command rules for `/status` and `/report`
3. Initial `DiscordServerConfig` row for `DISCORD_GUILD_ID`

## Discord Setup
1. Create a Discord **Application** at [discord.com/developers](https://discord.com/developers)
2. Create a **Bot** user and copy its token (`DISCORD_BOT_TOKEN`)
3. Copy the **Public Key** (`DISCORD_PUBLIC_KEY`) and **Application ID** (`DISCORD_APPLICATION_ID`)
4. Create/obtain your test **Guild ID** (`DISCORD_GUILD_ID`) and add the bot to that server with appropriate permissions
5. In the Discord Developer Portal, set the **Interaction Endpoint URL** to `https://<your-domain>/api/discord/interactions` (use `http://localhost:3000/api/discord/interactions` when testing locally)
6. Register commands (guild-scoped for immediate effect):
   ```sh
   npm run register:commands
   ```

## Admin Usage
- **Login**: `http://localhost:3000/login`
- **Dashboard**: `http://localhost:3000/dashboard` (requires auth)

**Dashboard capabilities:**
- View live interaction history (5-second polling)
- Edit command rules (enabled, response text, mirror/channel-post/AI toggles)
- Configure server: channel ID for `CHANNEL_POST`, mirror type + webhook URL for `MIRROR`
- Manually retry failed or stale `CHANNEL_POST`/`MIRROR` actions

## Throwaway Admin Credentials
These are the **default/fallback** values from `prisma/seed.ts` when `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are unset:
- **Email**: `admin@example.com`
- **Password**: `changeme123`

> **Change these credentials before any non-test deployment.**

## Deployment (Vercel)
1. Push to GitHub
2. Import the project on Vercel
3. Set all required environment variables (see [Environment Variables](#environment-variables))
4. Build command: `npm run build`
5. After deployment, run database migration:
   ```sh
   npx prisma migrate deploy
   ```
6. Set the Discord **Interaction Endpoint URL** to `https://<your-deployment>.vercel.app/api/discord/interactions`
7. Run `npm run register:commands` locally or once after provisioning (guild-scoped, idempotent)

## Assessment Test Flow
1. **Admin login** via `/login` with seeded credentials
2. **Configure**: set a channel ID and/or mirror webhook URL in the dashboard
3. **Discord `/status`**: run the command in Discord → bot responds with status
4. **Discord `/report <text>`**: run the command → bot defers, then responds
5. **Dashboard history**: verify the interaction appears with action states
6. **Channel post**: verify the bot posts to the configured Discord channel
7. **Webhook mirror**: verify the mirror notification is sent to the configured webhook
8. **Failed delivery**: simulate failure (e.g., remove webhook) → action marked `FAILED`
9. **Manual retry**: click retry on the failed action in the dashboard → status updates

## Security Notes
- Discord interactions are verified with Ed25519 signature against the raw request body; signature timestamp freshness is enforced
- Interactions are deduplicated at the database level (unique `interactionId` constraint; duplicate returns the same `{ type: 5 }` ACK without re-executing)
- **All secrets remain server-side**: `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `mirrorWebhookUrl`, and `SESSION_SECRET` are never returned to the browser
- `mirrorWebhookUrl` is never sent to any client
- Interaction tokens are never persisted
- User-generated `/report` text is bounded in length and normalized; Discord messages use `allowed_mentions: { parse: [] }` to prevent unwanted mentions
- POST routes are authenticated and state-changing; session cookies are HTTP-only, Secure in production, SameSite=Lax

## Deliberate Scope Decisions
- Single-server support (guild-scoped commands for one `DISCORD_GUILD_ID`)
- One Next.js application — no microservices
- PostgreSQL-backed persistence — no queue
- `after()` for post-response work — no background worker
- Bounded inline retries — no cron-based retry sweeping
- Manual retry for failed delivery actions
- AI feature is optional and non-blocking (falls back silently)
- Short-interval polling for dashboard — no WebSockets
- Cookie-based sessions — no JWT token infrastructure

## Known Limitations
- **PostgreSQL is required** on the pre-ACK path for durable deduplication and action persistence; if the database is unavailable, the application returns a 500 and cannot guarantee lossless ingestion
- Delivery is **at-least-once**; duplicates are possible if a provider accepts a request before the response is received
- No automatic retry of failed deliveries — manual retry is required from the dashboard
- No automatic Discord command re-registration — run `npm run register:commands` whenever command definitions change
