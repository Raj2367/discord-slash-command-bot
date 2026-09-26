# AI Notes

## 1. AI Tools / Models Used
This project was implemented using **Kilo Code** (an AI coding assistant) as an implementation assistant. The AI was instructed to follow the constraints defined in `AGENTS.md` and to work on small, discrete tasks. The AI was used for code generation, refactoring, and test-writing within the boundaries set by the human developer. It was **not** an autonomous architecture owner — all architectural decisions remained constrained by `AGENTS.md` and the assessment specification.

## 2. How Work Was Divided
Implementation was broken into small, reviewable tasks following the `AGENTS.md` guidance. Each task was completed, reviewed, tested (`npm test`), and verified with a production build (`npm run build`) before moving to the next. Changes were committed incrementally. Architectural decisions were never allowed to override the source-of-truth hierarchy: assessment spec → HLD → `AGENTS.md` → code.

## 3. Key Engineering Decisions

### Decision 1: Persisted Outbound Snapshots for Retries
Every `ActionRecord` stores the exact outbound message snapshot in `result.message` **before** the first delivery attempt. Retries (both automatic and manual) resend this stored snapshot rather than rebuilding from the current command rule. This prevents an external call from becoming an untracked side effect and ensures retries are deterministic even if the admin changes the command text mid-flight.

### Decision 2: `after()` for All Post-ACK Processing
The Discord interaction route returns a deferred `{ type: 5 }` ACK within the pre-response path (signature verification + database persistence only). All slow work — Discord response update, channel post, mirror notification — runs in `after()`. This keeps the critical pre-ACK path under Discord's ~3-second response window while guaranteeing post-response work runs even after the response is sent.

### Decision 3: Conditional `ActionRecord` Claim for Manual Retry
Manual retry uses a conditional `updateMany` with a `WHERE` clause that checks both the current status (`FAILED`) and staleness (`PENDING` with `updatedAt < now - 2min`). This prevents duplicate clicks from starting duplicate deliveries — the atomic database update claims the row in a single operation.

## 4. Hardest Bug: `__setGetSession` Export in Next.js Route Handler

### Problem
The manual retry route (`app/api/admin/actions/retry/route.ts`) needed a test seam for `getAdminSession`. Placing a named export `__setGetSession` directly in the route handler file caused `npm run build` to fail with:

```
Route export error: __setGetSession is not a Route handler
```

Next.js treats any exported function from a route file as a potential HTTP handler. A non-handler export like `__setGetSession` is not callable and breaks the build.

### Discovery
The error surfaced immediately when running `npm run build` after adding the test seam to the retry route. The build output was clear: Next.js Route Handlers only allow specific export signatures (`GET`, `POST`, `PUT`, `DELETE`, etc.).

### Fix
Introduced a wrapper module (`lib/auth/retry-session.ts`) that re-exports `getAdminSession` through an indirection layer. The route handler imports `getRetrySession` from the wrapper, and tests call `__setGetSession` on the wrapper module. The route file then exports only `POST` — the build passed.

```typescript
// lib/auth/retry-session.ts
let currentGetAdminSession: GetAdminSessionFn = getAdminSession;
export async function getRetrySession() { return currentGetAdminSession(); }
export function __setGetSession(fn: GetAdminSessionFn): void { currentGetAdminSession = fn; }
```

```typescript
// app/api/admin/actions/retry/route.ts
import { getRetrySession } from "@/lib/auth/retry-session";  // only POST is exported
```

## 5. What Was Improved After Review

### MIRROR Snapshot Consistency for `/report`
Ensured that the `MIRROR` action for `/report` persists the **exact** outbound message snapshot (including AI-summarized content if present) before the first delivery attempt. This means manual retry of a `/report` mirror always resends the same message that was originally intended.

### Terminal FAILED Handling for CHANNEL_POST/MIRROR
The `after()` processing block includes a `catch` that marks affected `ActionRecord`s as `FAILED` with their `lastError`. This prevents any action from being left silently `PENDING` due to an escaped exception in post-response processing.

### Safe Webhook-Secret Handling
The GET config endpoint (`app/api/admin/config/route.ts`) was updated to never select `mirrorWebhookUrl` in the initial Prisma query. Instead, it derives `mirrorWebhookConfigured` via a secondary existence-only query (`findFirst` with `select: { id: true }`), ensuring the webhook URL is never fetched into application memory for read operations.

### Deployment/Readiness Documentation
Created `README.md` with complete local setup, environment variable documentation, Discord setup instructions, deployment workflow, and assessment test flow. Also completed `.env.example` with all required and optional variables.

## 6. What Would Be Improved With More Time

- **Comprehensive live integration testing**: The unit tests cover signature verification, persistence, retry logic, and config validation, but a live end-to-end test against a real Discord test server would validate the full interaction lifecycle including Discord API rate limits and response editing.
- **Cleaner test seams**: The current test mocking uses mutable Prisma object replacement (`prisma.discordServerConfig.findFirst = mockFn`). A dedicated test fixture or Prisma mock client (e.g., `--data-proxy` mock or `prismock`) would provide more robust, isolated testing.
- **Dashboard UX improvements**: Add explicit error notifications when actions fail, and a retry button with confirmation to prevent accidental double-retries.
- **Additional observability**: Structured logging is server-side JSON. Adding request IDs for tracing through the `after()` processing pipeline would aid debugging in production.

## 7. Hardest Production Bug: `/status` "Application Did Not Respond" Then 404

**Initial symptom**: `/status` showed "The application did not respond" — the ACK was delayed past Discord's 3-second window.

**AI's initial suspect**: The `after()` wrapper in `lib/discord/after.ts` was falling back to `Promise.resolve().then(task)`, running `processInteraction` synchronously and delaying the HTTP response.

**Evidence disproving it**: Temporary timing instrumentation showed the three sequential database queries alone accounted for the entire delay:
- Total pre-ACK: 4361ms
  - `discordServerConfig.findUnique`: 2459ms
  - `commandRule.findUnique`: 237ms
  - `persistInteraction`: 1664ms

Vercel Function was in `iad1` while the Neon database was in `ap-southeast-1`. Cross-region latency accumulated across all three sequential queries. `after()` was correctly non-awaited — it was not the bottleneck.

**Fix for the delay**: Moved Vercel Functions to `sin1` (Singapore). Pre-ACK dropped to 1050ms; the ACK then succeeded.

**New problem: HTTP 404 on DISCORD_RESPONSE**: After the region fix, the initial ACK succeeded but the post-ACK PATCH returned 404. Production evidence traced step by step:
- Stored `ActionRecord.result.message` = `"Bot is operational and online."` (correct)
- Discord endpoint shape (`/webhooks/{app_id}/{token}/messages/@original`) was correct
- The `application_id` in the Discord interaction payload was `1552661543412568164`
- The production `DISCORD_APPLICATION_ID` env var did not match — it was incorrect

**Root cause**: Wrong `DISCORD_APPLICATION_ID` in Vercel production. Correct value: `1552661543412568164`.

**Final fix**: Updated `DISCORD_APPLICATION_ID` env var in Vercel and redeployed.

**Final live verification** — all passed: `/status`, `/report`, channel post, webhook mirror, retry-on-failure, manual mirror retry, invalid-signature 401, stale-timestamp 401, admin dashboard/login.

**Attribution**: Logs, timing measurements, database inspection of action records, and live Discord/Vercel testing were used to verify each hypothesis in sequence. The AI did not autonomously diagnose the final root cause — each conclusion was guided by observed production evidence.
