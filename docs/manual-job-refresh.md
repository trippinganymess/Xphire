# Manual job-board refresh

The **REFRESH** button beside pagination starts `.github/workflows/scrape_jobs.yml`, not the email workflow. Starting a run requires a verified, non-anonymous Supabase user. Visitors can read status without signing in.

- Existing queued/running/waiting scraper runs produce “The page is already refreshing…about 15 minutes.”
- The button is disabled while dispatching or refreshing. Jobs, filters and pagination remain usable.
- Status is checked on mount, every 30 seconds while visible, and on focus/visibility return. Completion revalidates the current catalog page. Fifteen minutes is an estimate, never a simulated completion timer.
- Failed runs, expired sessions and service errors produce recoverable messages, including on mount/remount. An old completed run cannot be mistaken for a just-requested run.
- A service-role-only PostgreSQL lease prevents concurrent clicks and covers 90 seconds of GitHub dispatch visibility delay. A second status check occurs after acquiring the lease. Ambiguous network failures retain the lease because GitHub may have accepted the request.
- Public status work is bounded: [004_job_refresh_status_guard.sql](../supabase/migrations/004_job_refresh_status_guard.sql) shares a short-lived run snapshot across concurrent requests and applies a global request/GitHub-read budget. Over-budget requests receive `429 {error: "Too many refresh requests…"}` with `Retry-After: 60` and no upstream calls. This bounds abuse; it is not a substitute for Supabase's own edge-level protection.
- Workflow-level `scrape-jobs` concurrency also covers scheduled runs, with `cancel-in-progress: false` and a 45-minute execution timeout. A schedule racing the final dispatch may still queue a subsequent run, but cannot execute alongside it. The lease is not permanent exactly-once delivery; GitHub visibility delayed beyond its expiry can permit another request.

## Deployment

Deploy the database/function before the frontend. These steps affect your linked project; verify the target project before running them.

1. Apply [003_job_refresh_lease.sql](../supabase/migrations/003_job_refresh_lease.sql) and [004_job_refresh_status_guard.sql](../supabase/migrations/004_job_refresh_status_guard.sql) using your migration process (`supabase db push` for a correctly linked project; review any other pending migrations first).
2. Configure the Edge Function's server-side secrets:
   - `GITHUB_PAT`: fine-grained GitHub token with **Actions: read and write** for this repository.
   - `GITHUB_OWNER` / `GITHUB_REPO`: optional; default to `trippinganymess` / `Xphire`.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: provided by Supabase Edge Functions.
3. Deploy with `supabase functions deploy refresh-jobs`. [config.toml](../supabase/config.toml) intentionally disables gateway JWT verification for public GET; POST verifies the bearer token with Supabase Auth before reading/dispatching workflow state.
4. Merge the workflow/frontend changes and deploy the frontend normally. Dispatch always targets `main`; the concurrency safeguard must be present on that branch.

Never put GitHub or service-role tokens in `VITE_*` variables. No frontend environment variables beyond the existing Supabase URL/public key are required. The handler accepts no repository, ref, workflow or email parameters from the browser. Errors do not expose upstream payloads or credentials.

## Endpoint

`/functions/v1/refresh-jobs`:

- `GET`: public status: `idle`, `running`, `completed`, or `failed`.
- `POST`: verified user only; `202 {status: "started"}` or `200 {status: "running"}`.
- Status responses include `estimatedMinutes: 15`, plus `runId` when known or `previousRunId` while waiting for a new dispatch to appear.
- Invalid sessions return 401; unavailable auth/GitHub/lease infrastructure returns 503; unsupported methods return 405. All responses have CORS and `Cache-Control: no-store` headers.
- Upstream work has a shared 12-second deadline. GitHub's latest 100 scraper runs are checked across events and branches, including scheduled runs. GitHub reads are budgeted globally; rate-limit failures fail closed rather than dispatching blindly.
- `POST` never enters the status cache; it always reads fresh run state before dispatching, so a dispatch never waits on or relies on a cached snapshot.
- One-time email dispatches use the separate [secure dispatch contract](secure-email-dispatch.md) (migration [005_email_dispatch_guard.sql](../supabase/migrations/005_email_dispatch_guard.sql)).

## Verification

```bash
npm run test:refresh
npm run test:dispatch
npm --prefix frontend test -- tests/job-refresh.spec.ts
npm run typecheck
npm run lint
npm run build
npm test
```

The handler tests use Node 24's built-in TypeScript stripping and a strict fake HTTP boundary; they never call Supabase, GitHub, models or email services. PR CI runs these tests and separately type-checks the handler. Node may emit a harmless module-type auto-detection warning for `handler.ts` under the existing CommonJS root package.

The SQL regressions in [tests/job-refresh-lease.sql](../tests/job-refresh-lease.sql), [tests/job-refresh-status-guard.sql](../tests/job-refresh-status-guard.sql) and [tests/email-dispatch-guard.sql](../tests/email-dispatch-guard.sql) run on a **disposable PostgreSQL database** after creating the `anon`, `authenticated` and `service_role` roles (see [tests/supabase-test-roles.sql](../tests/supabase-test-roles.sql)) and applying migrations 003–005. They check lease acquisition, budget/bounded snapshot behavior, dispatch permissions and role separation; [tests/dispatch-concurrency.test.mjs](../tests/dispatch-concurrency.test.mjs) additionally exercises concurrent real PostgreSQL acquisitions and confirms exactly one winner. This is not a production migration/deployment test.

Browser coverage includes anonymous/signed-in access, duplicate-click suppression, already-active runs, completion, failure/retry, expired sessions, delayed GitHub visibility, continued browsing and mobile layout. Existing unrelated expected-failure eligibility/lifecycle tests remain unchanged. No live workflow was dispatched during verification.
