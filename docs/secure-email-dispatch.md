# Secure one-time email workflow dispatch

`POST /functions/v1/dispatch-workflow` now requires a valid Supabase access token for a non-anonymous user whose `email_confirmed_at` is set. The only permitted recipient is that verified account email; a supplied `recipientEmail` must match it (case-insensitively), and the handler uses the email returned by Supabase Auth for the provider request. The existing recurring subscription (`schedule-workflow`) path is separate and unchanged.

## Request contract

- Methods: `POST` and CORS `OPTIONS`; other methods return `405`.
- `POST` JSON body is limited to 4 KiB. `jobTitle` is a trimmed nonempty string of at most 100 characters, `recipientEmail` is a string of at most 255 characters, `freshersOnly` is boolean, and `minStars` is an integer from 1 through 5.
- `Authorization: Bearer <Supabase access token>` is resolved server-side through Supabase Auth. Anonymous, unconfirmed, invalid, or expired accounts are rejected before provider dispatch.
- `Idempotency-Key` is mandatory and must be a UUID. It is scoped to the authenticated user. Reusing it with the same normalized payload cannot dispatch again; changing the payload returns `409`.
- The handler shares a 12-second abort deadline across auth, database reservation, provider dispatch, and completion persistence. Errors are deliberately generic; provider/database details and secrets are not returned.

## Durable limits and replay behavior

Migration `005_email_dispatch_guard.sql` creates private reservation and per-attempt records plus a singleton admission lock. Limits are one provider attempt per user per rolling minute, three per rolling hour, ten per rolling day, and 500 attempts site-wide per rolling day. These conservative first-release values bound individual and distributed abuse. The singleton row serializes reservation checks, intentionally favoring simple correctness over high dispatch throughput. A separate durable attempt record charges quota before every actual provider call, including one made after a definite rejection. Retrying that rejected key is safe after the applicable cooldown and other rolling limits allow another attempt; it reuses the original idempotency reservation rather than creating a new one.

A timed-out request or provider 5xx is ambiguous: the reservation remains `reserved`, and retries with that key return `202 pending` rather than risking duplicate dispatch. There is intentionally no automatic release/expiry for ambiguous reservations. A definite provider 4xx is recorded as `rejected`; a retry with the same key and payload can safely attempt again once quota permits. If rejection persistence itself fails, the reservation remains reserved (fail closed). A new key is a new quota-consuming request.

The Edge Function calls the two SECURITY DEFINER RPCs only with the service role. Their `search_path` is empty and table/RPC access is revoked from `PUBLIC`, `anon`, and `authenticated`. Per-user identity and idempotency uniqueness are enforced in the database, not in process memory.

## Response contract

- `202 {"status":"accepted", ...}` means GitHub accepted the workflow-dispatch API request. It does **not** mean the workflow started, completed, or delivered email.
- `202 {"status":"pending", ...}` means a matching request already has an ambiguous/in-flight reservation; retry only with the same key.
- `400` malformed/missing request data or key; `401` invalid/missing authentication; `403` unverified/anonymous account or recipient mismatch; `409` key reused with different data; `413` request body over 4 KiB; `429` quota exceeded; `502` definite provider rejection; `503` dependency failure or unknown outcome; `405` unsupported method.

The terminal creates a UUID when confirming a new run, sends it in `Idempotency-Key`, and retains the same key/payload in session storage after errors so a retry is deduplicated or safely retried after a definite rejection (once quota permits). A `202 pending` keeps the key and is not presented as accepted. After a `202 accepted`, it clears that key for the next confirmed run. Error bodies remain parsed through the existing Supabase Functions error path.

## Verification

The offline Node HTTP-boundary suite is `node --test tests/workflow-dispatch.test.mjs`. The SQL contract suite is `tests/email-dispatch-guard.sql`; run it only against a disposable Supabase-compatible PostgreSQL database after applying migrations. The SQL acquisition uses a global row lock plus a `(user_id, idempotency_key)` primary key so concurrent calls serialize atomically. No live GitHub workflow or email is invoked by these tests.
