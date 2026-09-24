# AGENTS.md — Discord Slash-Command Bot

## 1. Primary Engineering Rule

**Keep the application as simple as possible.**

Build the smallest system that satisfies the assessment's functional, security, reliability,
and submission requirements.

Do not introduce infrastructure, abstractions, or technologies merely because they are
popular, familiar, or impressive. Every additional component must solve a demonstrated
requirement that cannot be handled simply within the existing architecture.

### Architecture constraints

- One Next.js application.
- One PostgreSQL database (Neon).
- Deploy the application on Vercel.
- Use Prisma for database access.
- No background worker.
- No queue.
- No cron/scheduler.
- No Kafka.
- No Redis.
- No microservices.
- No separate backend service.
- No unnecessary state-management or infrastructure libraries.
- Prefer small, explicit modules and straightforward route handlers.

The architecture is intentionally a single application with logical modules inside it.
Logical modules are not separate services.

---

## 2. Source-of-Truth Hierarchy

Use these sources in this order:

1. **Abstrabit assessment PDF** — defines what must be delivered and what is evaluated.
2. **Approved HLD** — defines how this implementation satisfies those requirements.
3. **This AGENTS.md** — defines implementation constraints and non-negotiable rules.
4. **The code** — the final implementation must remain consistent with the above.

Do not redesign the architecture without explicit approval.
If implementation reveals a genuine contradiction, stop and report the contradiction before
introducing a new architectural component.

---

## 3. Core Product Scope

The application is a small full-stack web app plus a Discord slash-command integration.

### Required commands

At least these two guild-scoped slash commands must exist:

- `/status`
- `/report <text>`

Register them with a setup script using Discord's application-command API.
Prefer guild-scoped commands for the assessment test server so registration is immediate.

Do not add additional commands unless they serve a demonstrated requirement.

### Core user flow

```text
Admin logs in
  -> configures the test Discord server/channel/command behavior

Discord user
  -> runs /status or /report
  -> Discord sends a signed HTTP interaction
  -> endpoint verifies and validates it
  -> interaction is atomically deduplicated and persisted
  -> PENDING action records are created
  -> deferred ACK is returned within ~3 seconds
  -> post-response work runs via Next.js after()
  -> command is processed
  -> Discord response is updated
  -> optional configured-channel post is sent
  -> mirror notification is sent
  -> transient failures are retried
  -> action records become SUCCESS or FAILED
  -> dashboard displays the interaction/action state
```

---

## 4. Discord Interaction Endpoint

The interactions route must use the Node.js runtime:

```ts
export const runtime = "nodejs";
```

### Raw request body

Always read the raw request body before JSON parsing:

```ts
const rawBody = await request.text();
```

Verify the Ed25519 signature against the raw body and the timestamp before parsing JSON.
Do not reconstruct the raw body with `JSON.stringify()`.

### Verification order

Use this order:

1. Read raw body.
2. Read `X-Signature-Ed25519`.
3. Read `X-Signature-Timestamp`.
4. Enforce timestamp freshness.
5. Verify Ed25519 signature.
6. Reject invalid signatures with HTTP `401`.
7. Parse JSON only after verification succeeds.

No database write or external side effect may occur before signature verification.

### Timestamp freshness

Reject requests whose signature timestamp is outside the configured freshness window.
The freshness window is an application security policy; keep it explicit and configurable.

### PING

For Discord interaction type `1` (PING), return the required PONG response.
Do not persist PINGs as normal business interactions.

### Application commands

Handle Discord application-command interactions for `/status` and `/report`.
Unknown or unsupported interaction types should be rejected safely without invoking business
logic.

### Guild validation

This version is intentionally single-server.

For an application command:

- Require `guild_id`.
- Require it to match the configured guild.
- For a DM or an unconfigured guild, return a valid Discord response explaining that the bot
  is not configured there.
- Do not write an InteractionLog entry for a rejected/unconfigured guild interaction.

Do not implement multi-server support in the initial version.

---

## 5. Atomic Interaction Deduplication

`interactionId` must be database-unique.

Use Prisma's unique constraint and handle the unique violation (`P2002`) rather than implementing
an unsafe `SELECT`-then-`INSERT` check.

Correct behavior:

```text
new interaction
  -> insert succeeds
  -> continue processing

duplicate interaction
  -> unique constraint fails with P2002
  -> do not execute command again
  -> return the same Discord deferred ACK: `{ type: 5 }`
```

Deduplication must be atomic at the database level because multiple serverless invocations may
process the same interaction concurrently.

---

## 6. Pre-ACK Path Must Stay Short

The critical path before the Discord ACK must contain only work that is required for correctness:

- raw-body verification
- timestamp validation
- interaction-type validation
- guild/config lookup
- one database transaction for interaction/action persistence

Use the nearest practical Vercel function region to the Neon database region.

Do not call Gemini, Slack, Discord webhooks, or other slow downstream services before the initial
ACK/defer.

Configure the Discord interactions route with an explicit:

```ts
export const maxDuration = 60;
```

This is an application-level execution bound. Do not rely on the platform's larger default.

---

## 7. Persistence Before Side Effects

Persist the interaction and its required action records **before** attempting external delivery.

The initial transaction should create:

- `InteractionLog`
- `DISCORD_RESPONSE` ActionRecord
- `CHANNEL_POST` ActionRecord when configured for the command
- `MIRROR` ActionRecord when mirroring is enabled

Initial action state:

```text
PENDING
```

Never attempt a delivery first and record it afterward.

Before the first delivery attempt for an action, persist the exact outbound snapshot in `ActionRecord.result`,
for example `{ message, ai?, providerStatus? }`. Retries and manual retries must resend this stored snapshot
rather than rebuilding from a potentially changed command rule.

This prevents an external call from becoming an untracked side effect.

---

## 8. Action Record Types

The action model has exactly three core side-effect types:

```text
DISCORD_RESPONSE
CHANNEL_POST
MIRROR
```

Each action has:

- `id`
- `interactionLogId` (foreign key)
- `type`
- `status`
- `attempts`
- `lastError`
- `result`
- `createdAt`
- `completedAt`
- `updatedAt` (`@updatedAt`)

Enforce one action of each type per interaction with a database constraint equivalent to:

```text
UNIQUE(interactionLogId, type)
```

Allowed lifecycle:

```text
PENDING -> SUCCESS
PENDING -> FAILED
```

Do not introduce QUEUED, RETRYING, DEAD_LETTER, SCHEDULED, or other job-system states.
This is intentionally not a queue architecture.

## 9. Deferred Processing with `after()`

Slow work must not happen before the Discord response.

Use Next.js `after()` to schedule post-response work inside the same application.

Correct conceptual pattern:

```ts
after(async () => {
  try {
    // process command
    // update Discord response
    // optional channel post
    // mirror with bounded retries
    // persist final action states
  } catch (error) {
    // mark affected action(s) FAILED
    // attempt a safe Discord error update if possible
  }
});

return deferResponse();
```

Do **not** write code that assumes arbitrary work after `return deferResponse()` will continue.

The initial response must be returned within Discord's ~3-second response window.

After the defer:

1. Process the command.
2. Update the original Discord response using the interaction token.
3. Perform the optional configured-channel post.
4. Perform the mirror notification.
5. Persist action results.

The mirror and channel-post side effects must not delay the primary Discord response.

---

## 10. Discord Response Handling

Prefer updating the original deferred interaction response rather than creating unnecessary
additional messages.

The interaction token is used for interaction-response operations.

The bot token is used when posting as the bot to the configured Discord channel.
These are distinct credential paths.

Never persist the interaction token in the database.

Never store the raw Discord interaction payload.

Persist only the fields required for the audit/history view, such as:

- interaction ID
- guild ID
- channel ID
- user ID
- username
- command name
- command options
- status
- timestamps

---

## 11. Command Rules

Command behavior must be configurable from the admin UI.

A `CommandRule` should stay small and contain only what the application needs, for example:

- command name
- enabled/disabled
- response text/template
- mirror enabled/disabled
- channel-post enabled/disabled
- optional AI enabled/disabled

Do not store `mirrorType` on `CommandRule`.

The mirror provider belongs to `DiscordServerConfig`, because the configured webhook URL determines
the configured mirror destination.

---

## 12. Discord Server Configuration

`DiscordServerConfig` is single-server configuration for the initial version.

It may contain:

- guild ID
- guild name
- configured channel ID
- mirror type
- mirror webhook URL

The mirror provider is configured once per server:

```text
SLACK_WEBHOOK
DISCORD_WEBHOOK
```

Never return the full webhook URL to the browser.
Show only masked/configured state when needed.

Webhook URLs are server-side credentials/configuration:

- never expose to client-side code
- never place in `NEXT_PUBLIC_*`
- never log them
- never commit them to Git

---

## 13. Notification and Retry Policy

Retries apply only to transient failures.

### Retry

- network errors
- connection timeouts
- HTTP 429
- HTTP 5xx

### Do not retry

- HTTP 400
- HTTP 401
- HTTP 403
- HTTP 404
- other non-transient 4xx errors

Use **3 total attempts**:

```text
Attempt 1
   -> wait ~1s
Attempt 2
   -> wait ~3s
Attempt 3
```

Do not implement a generic retry framework.
Keep the retry helper small and explicit.

Every outbound fetch must use a bounded timeout, for example:

```ts
AbortSignal.timeout(4000);
```

After the primary Discord response has been attempted, `CHANNEL_POST` and `MIRROR` may run in
parallel with `Promise.allSettled` because they are independent side effects. Do not let either
side effect delay the primary Discord response.

Respect a downstream `Retry-After` value where practical, but stop retrying once the route has less
than about 5 seconds of execution budget remaining. The route's explicit `maxDuration` is 60 seconds.

The delivery model is **at-least-once**. Do not claim exactly-once delivery.
A provider may accept a request even if the client's response is lost, so a retry can theoretically
duplicate an external message.

---

## 14. Manual Retry

The admin dashboard may manually retry failed delivery actions.

Manual retry must:

- require an authenticated admin session
- allow retry of `CHANNEL_POST` and `MIRROR` actions
- not attempt to resurrect an expired `DISCORD_RESPONSE` action
- allow a `PENDING` delivery to be manually recovered only when `updatedAt` is older than 2 minutes
- use a conditional state transition that checks the current status/staleness in the database so duplicate
  clicks cannot start duplicate deliveries

For retry, resend the exact persisted outbound snapshot from `ActionRecord.result.message`; do not rebuild
from the current admin rule. Reuse any stored AI result; never invoke AI again during manual retry.

A retry should move the eligible action to `PENDING` with `updatedAt` refreshed, then execute through the same
post-response processing path with bounded retries.

Do not introduce a worker or cron just for manual retry.

## 15. User-Generated `/report` Content

`/report` text is untrusted user input.

Before sending it anywhere:

### Discord

Use:

```ts
allowed_mentions: {
  parse: [];
}
```

This prevents user text from generating unwanted mentions such as `@everyone`.

Enforce a practical application-level length limit below Discord's message limit. The chosen limit
should leave room for formatting around the report text.

### Slack

Escape user-controlled `&`, `<`, and `>` before sending text in Slack `mrkdwn` content.

### All mirrors

Validate and normalize the text once before producing provider-specific payloads.
Do not trust raw user text to become arbitrary structured markup.

---

## 16. Authentication and Authorization

Use a simple secure session-cookie model.

Do not introduce JWT access/refresh token infrastructure unless a concrete requirement appears.

The session cookie must be:

- HTTP-only
- Secure in production
- SameSite=Lax

Use a reputable signed/encrypted stateless session-cookie library rather than hand-rolling cryptography.
Hash passwords with a pure-JS password-hashing library such as `bcryptjs`.
State-changing routes must use POST/PUT/DELETE; do not make mutations through GET routes.

Every protected route handler/API operation must independently verify the authenticated session.
Do not rely on middleware/proxy checks as the only authorization boundary.

Protected operations include at least:

- dashboard data
- command configuration
- server configuration
- manual retry

Do not expose admin-only APIs to unauthenticated clients.

---

## 17. Security and Secrets

Never expose secrets or credentials:

- in Git
- in client-side code
- in logs
- in API responses
- in `NEXT_PUBLIC_*` variables

Relevant environment variables may include:

```text
DATABASE_URL
DIRECT_URL
DISCORD_APPLICATION_ID
DISCORD_PUBLIC_KEY
DISCORD_BOT_TOKEN
DISCORD_GUILD_ID
SIGNATURE_MAX_AGE_SECONDS=300
SEED_ADMIN_EMAIL
SEED_ADMIN_PASSWORD
SESSION_SECRET
GEMINI_API_KEY               # optional AI feature
```

Use a server-side environment variable mechanism for credentials.

The Discord application public key is used by the signature verifier and must not be treated as a
client-exposed configuration value in this project.

---

## 18. AI Feature

AI is optional and must never be on the critical path of the core command workflow.

If implemented, AI may summarize, tag, or triage `/report` text.

Use a dedicated AI timeout of about 8 seconds rather than the generic 4-second outbound timeout.
AI failure or timeout must fall back cleanly and never fail the core command.

Required behavior:

```text
AI succeeds
  -> include AI result where configured

AI fails
  -> /report still works
  -> command/response/mirror do not fail solely because AI failed
```

Store optional AI output inside an existing `result` JSON field where practical.
Do not add another database service or collection solely for AI.

Use only the free/no-card provider specified by the assessment when implementing the stretch goal.

---

## 19. Dashboard

The dashboard is admin-only.

It must show:

- live interaction history
- command/action status
- failure/error state
- command configuration
- manual retry for eligible failed delivery actions

"Live" is implemented with simple short-interval polling.
Do not add WebSockets or a real-time messaging infrastructure layer.

The dashboard must never expose:

- bot token
- webhook URL
- interaction token
- session secret
- Gemini API key
- raw sensitive Discord payloads

---

## 20. Observability

Use structured server-side JSON logs for diagnostics.

Example:

```json
{
  "event": "discord_interaction_received",
  "interactionId": "...",
  "command": "report",
  "guildId": "...",
  "requestId": "..."
}
```

Never include credentials or sensitive tokens in logs.

PostgreSQL is the durable history for interactions and action states.
Runtime logs are diagnostic only and may have short retention on free hosting plans.

Do not introduce a third-party observability platform for this assessment.

---

## 21. Error Handling

Every failure must be handled explicitly.

### Bad signature

```text
HTTP 401
No database write
No side effect
```

### Invalid/unconfigured guild or DM

```text
Valid Discord response
No database write
No mirror
```

### Duplicate interaction

```text
No second command execution
No duplicate side effects
Return successfully
```

### Database failure before ACK

Return a safe error response and emit a structured diagnostic log.
Do not invent a secondary queue/datastore to guarantee lossless ingestion.
Document this limitation honestly in the README.

### Command processing failure

Mark relevant action records FAILED and attempt a safe Discord error update.

### Mirror failure

Retry transient failures within the bounded retry policy, then persist FAILED.
Do not allow mirror failure to suppress the primary Discord response.

### AI failure

Do not fail the core command.

Never leave an action silently PENDING because an exception escaped from `after()`.
Wrap post-response processing with a catch-all that records failure state.

---

## 22. Database Model Rules

Keep the schema small.

### Admin

- id
- email
- passwordHash
- createdAt

### DiscordServerConfig

- id
- guildId
- guildName
- channelId
- mirrorType
- mirrorWebhookUrl (server-side only)
- createdAt
- updatedAt

### CommandRule

- id
- commandName
- enabled
- responseText
- mirrorEnabled
- channelPostEnabled
- aiEnabled (optional)
- createdAt
- updatedAt

### InteractionLog

- id
- interactionId (unique)
- guildId
- channelId
- userId
- username
- commandName
- commandOptions
- status (`RECEIVED` | `COMPLETED` | `FAILED`)
- createdAt
- processedAt

Add an index on `createdAt` for dashboard history queries.

### ActionRecord

- id
- interactionLogId (foreign key)
- type (`DISCORD_RESPONSE` | `CHANNEL_POST` | `MIRROR`)
- status (`PENDING` | `SUCCESS` | `FAILED`)
- attempts
- lastError
- result
- createdAt
- completedAt
- updatedAt (`@updatedAt`)

Enforce `UNIQUE(interactionLogId, type)`.

Do not store the raw Discord interaction payload or interaction token.

---

## 23. Out of Scope for Initial Version

Do not implement these unless the core application is already complete and there is explicit time:

- background workers
- queues
- Kafka
- Redis
- cron/scheduled jobs
- microservices
- multi-server support
- buttons/message components
- modals
- advanced rate-limit infrastructure
- third-party observability platforms
- complex agentic AI systems
- RAG

The optional AI feature is allowed only as a small non-blocking summarization/tagging/triage step.

---

## 24. Database Setup and Prisma

Use Neon pooled connectivity for runtime queries and a direct connection for Prisma CLI migrations
when required by the current Prisma/Neon setup. Follow the current Prisma and Neon documentation for
Prisma 7 configuration rather than copying older `directUrl` examples.

Recommended environment variables:

```text
DATABASE_URL  # pooled/runtime connection
DIRECT_URL    # direct connection for migrations/CLI
```

Keep `prisma/seed.ts` responsible for creating the throwaway admin, default `/status` and `/report`
command rules, and the initial single-server configuration row. Do not seed real webhook URLs or other
secrets.

Do not create a second database or datastore to solve cold starts or retrying.

## 25. Command Registration Script

Keep registration as a one-off setup script, not a runtime service.

Example project structure:

```text
scripts/
└── register-commands.ts
```

The script should register the required guild commands:

```text
/status
/report <text>
```

It may use the Discord application-command API with the bot/application credentials.

Keep the registration script idempotent where practical.

Do not register commands automatically on every application startup.

---

## 26. Testing Priorities

Before adding optional features, prove the following cases locally and on the deployed app:

1. Valid `/status` works end-to-end.
2. Valid `/report` works end-to-end.
3. Discord PING returns PONG.
4. Invalid signature returns 401.
5. Stale timestamp is rejected.
6. Duplicate interaction does not run twice.
7. Wrong guild/DM is handled without a database write.
8. Discord response is returned within the required window.
9. Mirror succeeds.
10. Mirror 5xx/network failure triggers bounded retries.
11. Mirror 4xx failure is not retried unnecessarily.
12. Failed delivery appears in the dashboard.
13. Admin manual retry works and is authenticated.
14. Secrets never appear in client responses or logs.
15. Long/malicious `/report` text is sanitized and bounded.
16. Dashboard polling reflects new interaction/action states.
17. Disabled command returns a valid ephemeral response and creates no delivery actions.
18. Enabled mirror with no webhook configured creates a FAILED mirror action instead of silently skipping.
19. Hung webhook is aborted by its timeout and does not start another retry once the execution budget is too low.
20. A stale PENDING action (`updatedAt` older than 2 minutes) can be recovered through authenticated manual retry.

Test the deployed Discord interaction endpoint early; do not wait until the final hour to discover
a deployment-specific issue.

---

## 27. Development Workflow with AI

Use the AI coding tool as an implementation assistant, not as the architecture owner.

For each feature:

1. Read `AGENTS.md` and the relevant architecture/requirements.
2. Ask the AI to modify only the requested scope.
3. Review the proposed changes.
4. Run the relevant tests/type checks/lint.
5. Manually inspect security-sensitive changes.
6. Commit one coherent change.

Prefer small tasks such as:

- database schema
- session authentication
- Discord signature verification
- PING handling
- command registration
- atomic interaction persistence
- `/status`
- `/report`
- `after()` processing
- Discord response handling
- channel post
- mirror notification + retry
- dashboard polling

Do not ask the AI to "build the whole application" in one step.

Do not allow the AI to introduce architecture outside this document without explicit approval.

---

## 28. Required Submission Artifacts

The final repository must include what the assessment asks for, including:

- complete GitHub repository
- clear commit history
- deployed public URL
- README.md
- `.env.example` with no real secrets
- local setup instructions
- deployment instructions
- Discord test-server/add-bot instructions
- throwaway admin credentials for evaluation
- AI context/instruction files used during development
- `AGENTS.md`
- `AI_NOTES.md`

README must clearly document known limitations and deliberate scope decisions.

---

## 29. Deliberate Scope Decisions to Document

The following are intentional decisions and must not be accidentally "fixed" during implementation:

- Single-server initial version instead of multi-server support.
- Guild-scoped slash commands for immediate assessment testing.
- One Next.js deployment instead of microservices.
- PostgreSQL-backed persistence instead of a queue.
- `after()` instead of a background worker.
- Bounded inline retries instead of cron-based retry sweeping.
- Manual retry for failed delivery actions.
- AI as optional and non-blocking.
- Simple polling instead of WebSockets.
- Cookie-based sessions instead of JWT access/refresh infrastructure.

These are engineering trade-offs, not unfinished architecture.

## 30. Implementation Clarifications

### Time budget

- Every outbound fetch uses `AbortSignal.timeout(4000)`.
- After the primary Discord response has been attempted, run `CHANNEL_POST` and `MIRROR` in parallel
  with `Promise.allSettled` when both are enabled.
- `export const maxDuration = 60;` on the Discord interactions route.
- Stop starting another retry when less than about 5 seconds of execution budget remains.
- Keep all retry delays bounded so the complete `after()` workflow fits comfortably within the route
  duration.

### Interaction endpoint

- `export const runtime = "nodejs";`.
- Stale timestamp or bad signature -> HTTP 401.
- Duplicate interaction (`P2002`) -> do not execute the command or create side effects again; return the
  same Discord deferred ACK response: `{ type: 5 }`.
- Disabled or missing `CommandRule` -> return a valid ephemeral Discord response such as `command disabled`;
  persist the interaction as `COMPLETED` with no delivery actions.
- `CHANNEL_POST`/`MIRROR` enabled but not configured -> create the corresponding action and mark it `FAILED`
  with a safe configuration error; never skip silently.
- Valid but wrong-guild/DM application commands -> return a valid ephemeral Discord response explaining that
  the bot is not configured for that server/context, and do not create an `InteractionLog` row.

### Data model additions

- `InteractionLog.status`: `RECEIVED | COMPLETED | FAILED`.
- `InteractionLog.status` is `COMPLETED` only when command processing completed and `DISCORD_RESPONSE`
  succeeded; it is `FAILED` when command processing or `DISCORD_RESPONSE` fails. `CHANNEL_POST` and `MIRROR`
  failures are represented on their own ActionRecord rows.
- Add an index on `InteractionLog.createdAt`.
- `ActionRecord.interactionLogId` -> `InteractionLog.id` foreign key.
- `ActionRecord.updatedAt` is managed with Prisma `@updatedAt`.
- Enforce `@@unique([interactionLogId, type])`.
- The mirror URL lives only in `DiscordServerConfig.mirrorWebhookUrl`; do not define a separate
  `DISCORD_MIRROR_WEBHOOK_URL` environment variable.

### Manual retry

- Eligible: `CHANNEL_POST`/`MIRROR` actions that are `FAILED`, or `PENDING` where `updatedAt < now - 2 minutes`.
- Require an authenticated admin session.
- Use a conditional state transition including the current status/staleness check so duplicate clicks cannot
  start duplicate deliveries.
- Before the first delivery attempt, persist the exact outbound snapshot to `ActionRecord.result`, including
  at least `{ message, ai?, providerStatus? }`.
- Manual retry resends `result.message` and the persisted provider snapshot; do not rebuild from the current rule.
- Reuse stored AI output when present; never invoke AI again during manual retry.

### Authentication

- Use a stateless signed/encrypted session cookie with `SESSION_SECRET`; no session table.
- Cookie: HTTP-only, Secure in production, `SameSite=Lax`.
- State-changing routes are POST/PUT/DELETE only.
- Every protected route handler verifies the session independently.
- Hash passwords with a reputable pure-JS library such as `bcryptjs`; do not hand-roll password hashing.

### Database

- `DATABASE_URL` is the pooled/runtime Neon connection string.
- `DIRECT_URL` is the unpooled/direct connection used by Prisma CLI migrations when required by the current
  Prisma 7 + Neon setup.
- Keep Prisma configuration aligned with the current Prisma/Neon documentation; do not copy deprecated
  Prisma 6 `directUrl` schema examples.
- `prisma/seed.ts` creates the throwaway admin, default `/status` and `/report` rules, and the initial single-server
  configuration row. Never seed real secrets.

### Input safety

- `/report` input is untrusted. Enforce a practical maximum length before building outgoing messages.
- Discord messages use `allowed_mentions: { parse: [] }`.
- Slack `mrkdwn` payloads escape `&`, `<`, and `>` in user-controlled text.
- Provider-specific formatting is generated by pure helper functions; raw user text is never treated as trusted
  markup.

### Clarifications (round 2)

- `ActionRecord.updatedAt` is required for stale-PENDING detection. Use Prisma `@updatedAt`; manual retry
  updates the timestamp so the same action cannot immediately be treated as stale again.
- Persist the exact outbound action snapshot in `ActionRecord.result` before the first delivery attempt, for
  example `{ message, ai?, providerStatus? }`. Retries resend this stored snapshot.
- Duplicate interaction (`P2002`) returns the same `{ type: 5 }` deferred ACK and performs no business work.
- Required environment variables include `DISCORD_GUILD_ID`, `SIGNATURE_MAX_AGE_SECONDS` (default `300`),
  `SEED_ADMIN_EMAIL`, and `SEED_ADMIN_PASSWORD`.
- AI calls use their own roughly 8-second timeout and fall back without failing the core command.
- `InteractionLog.status` is `COMPLETED` when command processing and `DISCORD_RESPONSE` both succeed; it is
  `FAILED` when command processing or `DISCORD_RESPONSE` fails. `CHANNEL_POST` and `MIRROR` delivery failures
  remain on their own ActionRecord rows.

### Operational limitations

- PostgreSQL is required on the pre-ACK path for durable deduplication and action persistence. If the database is
  unavailable, the application cannot guarantee lossless ingestion without adding another durable queue, which is
  intentionally out of scope.
- PostgreSQL is the durable interaction/action history. Platform runtime logs are diagnostic only and have short
  retention on free hosting plans.
- Prefer colocating the Vercel Function region with the chosen Neon region to minimize pre-ACK latency.
