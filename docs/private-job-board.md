# PJobB: Private Job Board

## Implementation and deployment status

The **PJobB** link beside **Latest Opportunities** shares the **REFRESH** button's colors, border, typography, spacing, shadow, and interaction styles. It opens `#/private-jobs` with cyan job cards. Public and private boards share card, filter, and pagination presentation.

**Not deployed:** the migration and Edge Function must be reviewed and applied before the feature works on a live Supabase project. Tests use fake credentials, synthetic users, mocked provider traffic, and disposable PostgreSQL; no new live API calls or production database changes were made.

TheirStack is the only active paid provider. JSearch remains deferred. Its successful historical connectivity evidence is recorded in [paid discovery notes](paid-job-discovery.md).

## User behaviour

- Guests are directed to Terminal Access to sign in. Signed-in users need active, unexpired, administrator-granted paid access. Guests and users awaiting access can open the [request access page](private-job-access-requests.md); submitting requires a verified account email.
- Paid users read only their own `private_jobs`. Saved-job keyword searches wait 400ms after typing stops; controls remain mounted, retain focus, and do not recheck entitlement per keystroke. Filters apply before 51-row pagination and sort by discovery time and ID. Provider junior/internship labels remain explicitly unverified; no fabricated company-star rating is shown.
- **FIND MY JOBS** accepts a server-enforced discovery preset. Choices include Frontend + Python (default), Frontend, Python, Backend, Full stack, Software engineer, React, Java, QA/testing, and Data analyst. Each maps to bounded job-title alternatives in **one** TheirStack request, not multiple fallback requests. The default reuses the titles from the prior successful connectivity test; **no preset guarantees live vacancies**.
- This slice is **on-request daily discovery**, not an unattended cron scanner. Entering the route or reloading saved jobs does not consume provider credits. A failed attempt after the durable claim also consumes the daily allowance to prevent ambiguous timeouts from producing duplicate paid requests.
- Source date-only postings are shown as calendar dates with unknown time. “Found” is Xphire discovery time. Neither junior labels nor one-day provider filters prove fresher/rolling-24-hour eligibility.
- Account changes, sign-out, revoked access, and failed access checks discard private rows. After access recovers, old rows remain absent until a fresh authorized jobs query completes. There is no shared or persisted private-job cache. A mounted page rechecks access every 30 seconds when visible, plus on focus/reload; every new read is protected by RLS.
- Jobs are retained across successful daily queries, upserted per owner/provider ID. Revocation hides retained jobs; reactivation restores reads. Account deletion cascades private records.

The header account menu no longer clips Sign Out; its action revokes the SDK session as well as clearing the header label. This existing bug is fixed because private-board privacy must not depend on a cosmetic logout. New account-menu interaction supports keyboard activation and visible focus through existing button rules.

## Server-controlled access

Migration [004_private_job_board.sql](../supabase/migrations/004_private_job_board.sql) introduces only isolated private tables:

| Table | Responsibility | Client permissions |
| --- | --- | --- |
| `private_job_entitlements` | Active flag and mandatory finite expiry | Read own entitlement; no writes |
| `private_jobs` | Per-user card fields | Read own rows only while currently paid; no writes |
| `private_job_scan_state` | Durable daily allowance and claim state | Read own non-token columns while paid; no writes |

`private_job_board_access()` has no user-ID argument and derives identity from `auth.uid()`. Anonymous identities and unentitled users are denied. Claim/finish/fail RPCs are service-only; their default PUBLIC execution grants are explicitly revoked. Entitlement rows and scan state are locked in a consistent order, and finish rechecks active paid access plus the matching unexpired token before saving the entire batch atomically.

The Edge Function verifies the supplied bearer token with Supabase Auth. It never accepts `user_id` or provider options from the browser, never trusts user-editable payment flags, and never writes `Seen_job`. Provider responses, errors, descriptions, credentials, and headers are not logged or returned. Bounded request/response reads and a total deadline fail safely; redirects cannot forward credentials.

## Deployment checklist — requires separate authorization

1. Review/apply migration 004 in your intended Supabase project. It references `auth.users`, not the undocumented public `users` table. Do **not** apply `tests/private-job-board-bootstrap.sql` to a Supabase project: it is disposable-test scaffolding only.
2. Set the TheirStack key as an **Edge Function secret**. Existing GitHub Actions secrets do not automatically become Supabase secrets. Supported names: canonical `THEIRSTACK_API_KEY`, fallback `THEIR_STACK_API_KEY`. Use a secure dashboard/prompt/file, never literal credentials in chat or logged commands.
3. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function. No service/API keys belong in `VITE_*` variables. Preserve the existing public Actions secret `SUPABASE_SERVICE_KEY`.
4. Deploy the function using [supabase/config.toml](../supabase/config.toml):

   ```bash
   supabase functions deploy private-job-board
   ```

   Gateway JWT verification is disabled only because the handler validates every POST with Supabase Auth; it has no public job/status GET endpoint.
5. Grant access for a verified user using the administrator SQL editor/service role. Use the actual auth user UUID and desired UTC expiry:

   ```sql
   insert into public.private_job_entitlements (user_id, active, expires_at)
   values ('<AUTH_USER_UUID>'::uuid, true, '<UTC_EXPIRY>'::timestamptz)
   on conflict (user_id) do update
   set active = excluded.active, expires_at = excluded.expires_at;
   ```

   Revoke with `update public.private_job_entitlements set active = false where user_id = '<AUTH_USER_UUID>'::uuid;`. Clients cannot grant themselves paid access. This is manual entitlement provisioning, not billing checkout.
6. Deploy the frontend through the existing reviewed deployment process. Verify with two separately authorized paid test users, an unpaid user, expiry, and revocation before claiming live privacy/discovery success. A live discovery consumes one provider request.

The historical live report's nine jobs demonstrate connectivity, not a deployed private board. An unattended scanner, richer saved preferences, validated fresher matching, billing integration, and account/admin UI are outside this slice.

## Verification results (2026-10-28)

- Node 24.22.1: frontend type/lint/build and strict Edge handler type checks passed.
- 17 mocked private-board browser tests passed, covering guests/unpaid/paid users, owner selection, shared filtering/pagination, discovery/quota/reload, revocation, sign-out/late results, account switching, 320–1440px layouts, 200% zoom, and reduced motion.
- 116 Node handler tests passed (96 private-discovery tests plus 20 existing refresh tests).
- Disposable PostgreSQL 17 migration/RLS/privilege/claim tests and overlapping transaction claims passed; no production DB was accessed.
- Python: 64 passed / 10 tracked expected failures; 28 standalone connectivity tests. Ruff, documentation checks, and diff whitespace checks passed.
- The first parallel browser run exposed a transient-loading test race and slow lazy OAuth load. The loading assertion now uses an explicit mock gate instead of a 300ms sleep, and browser assertions allow 10 seconds without automatic retries. The following full parallel run passed; final run evidence is recorded in the PR.
- Independent subagent review was unavailable: prior provider sessions failed, and the requested NVIDIA Nemotron Ultra review returned 404. These failures produced no review findings; direct checks and tests were used instead.

## Discovery troubleshooting

Database reads returning 200 (`private_jobs`, `private_job_board_access`) do **not** establish that the `private-job-board` Edge Function is deployed or configured. Saved-job filtering only searches existing private rows; it never calls TheirStack or fills an undiscovered board.

The reported typing issue was reproduced with real sequential keystrokes: attempting “Acme” retained only “A” because a filter change cleared access state and unmounted the input. Access polling and job queries are now independent, keyword updates are debounced, and unchanged Supabase sign-in events do not invalidate queries. Account/token changes and failed access checks still fail closed.

For failed discovery, inspect DevTools → Network → `/functions/v1/private-job-board`, not only REST reads. Share HTTP status plus response/code or the network/CORS error; never share authorization headers/cookies/keys.

- **404:** deploy the function in the same Supabase project the frontend uses.
- **Network/CORS/timeout:** confirm deployment and inspect the browser error/function invocation logs. This is not proof the allowance was or was not consumed.
- **503 `service_not_configured`:** securely configure the TheirStack secret in Supabase **Edge Functions**, not just Actions.
- **503 `scan_claim_unavailable` / `private_save_unavailable`:** check migration 004 and service-only RPCs; reload before retrying.
- **502 `provider_unavailable` / `provider_response_invalid`:** inspect the provider subscription/key/rate limits or function diagnostics without logging raw payloads or secrets.
- **401/403:** authenticate or check the server-managed entitlement.
- **409/429:** already running or daily allowance used; do not reset quota merely to hide an error.
- An invalid HTTP-success body produces a deployed-version mismatch message, not a false success.

The live discovery failure reported by the user has **not** been verified: the supplied network evidence contains successful database reads and canceled access checks, not the function request. These changes make failures distinguishable; a preset cannot repair missing deployment/secrets.

**Rollout:** redeploy `private-job-board` and rebuild/deploy the frontend together so both use `shared/privateDiscoveryPresets.ts`. There is no new database migration in this follow-up. Existing saved jobs/quota are preserved. Deploying the function alone rejects unsupported old free-text queries safely before a paid request; deploy UI promptly to expose the supported choices.

## Follow-up verification (2026-10-28)

- Reproduced the typing bug before the fix: the browser typed `Acme` but the input retained `A`; missing preset and truthful-empty-state tests also failed. All now pass.
- 76 full mocked browser tests passed (including 4 existing declared expected failures); 26 cover the private board. Focus retention, 400ms debouncing, unsupported queries, missing deployment, invalid success bodies, network failures, zero results, unchanged auth events, and safe setup errors are covered.
- 127 combined Node handler tests passed; every supported preset was exercised with synthetic job data and exactly one fixed provider request. This is not evidence that every preset has live jobs.
- Frontend typecheck/lint/build, strict handler/shared-module types, Python 64 passed / 10 known expected failures, Ruff, documentation checker, and diff checks passed. No new paid calls, credentials, production DB access, migration, or function deployment was performed.

## Offline verification

Use Node 24 and Python 3.11 as described in [quality docs](quality.md):

```bash
npm run typecheck && npm run lint && npm run build
(cd frontend && npx playwright test --workers=1)
node --test tests/job-refresh.test.mjs tests/private-job-board.test.mjs
(cd frontend && npx tsc --ignoreConfig --noEmit --allowImportingTsExtensions --strict --target ES2022 \
  --module nodenext --skipLibCheck ../supabase/functions/private-job-board/handler.ts)
python -m pytest -q
python -m ruff check .
python scripts/check_docs.py
```

The CI private-board database job creates disposable PostgreSQL 17 with synthetic auth functions/users, applies migration 004, and runs [RLS/privilege/claim tests](../tests/private-job-board.sql) plus [overlapping transaction claims](../tests/private-job-board-concurrency.sh). These do not access a Supabase project or paid API. Run the same commands only against a disposable **loopback** test database:

```bash
psql -v ON_ERROR_STOP=1 -f tests/private-job-board-bootstrap.sql \
  -f supabase/migrations/004_private_job_board.sql -f tests/private-job-board.sql
bash tests/private-job-board-concurrency.sh
```

Provide `PGHOST=127.0.0.1` and disposable `PG*` settings. Browser tests intercept all remote traffic and fail on unmocked endpoints. Mocked screenshots are development evidence, not production data.
