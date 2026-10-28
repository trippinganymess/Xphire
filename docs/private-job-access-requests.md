# PJobB access requests

The PJobB access gate links to `#/private-jobs/request-access`. A signed-in user enters a name and optional message; their account email is displayed read-only. The server resolves and verifies the account and confirmed email with Supabase Auth, then saves the request and queues a notification to **recblackoff@gmail.com**. The applicant's verified email is the message's Reply-To address.

The page distinguishes a queued request, existing active access, the 24-hour request limit, unconfirmed email, and a failed or unconfirmed submission. It never describes queue acceptance as confirmed inbox delivery. Approval and entitlement provisioning remain manual.

## Delivery and isolation

Migration [005_private_job_access_requests.sql](../supabase/migrations/005_private_job_access_requests.sql) adds one current request per account and service-only request/notification claims. Requesters can read only their own record and cannot write records or grant access. It follows migration 004 and uses the existing administrator-managed entitlement table.

The [request-private-access function](../supabase/functions/request-private-access/handler.ts) rejects anonymous users, unconfirmed emails, unexpected fields, and oversized bodies. It accepts only a name and message. Account identity, email, recipient, workflow and branch are server-controlled. There is no provider query or discovery allowance change.

A durable claim limits requests to once per rolling 24 hours, including ambiguous dispatch failures. The function invokes [request_private_access.yml](../.github/workflows/request_private_access.yml) on main with only the saved request UUID. The workflow uses the existing SMTP and Supabase Actions secrets and runs [worker_access_request.py](../workers/worker_access_request.py); it does not install or execute the scraper.

Notification states are pending, queued, sending, sent and failed. The worker claims sending before SMTP, so overlapping workers, reruns and uncertain acknowledgements cannot automatically resend the same request. A late queue acknowledgement cannot overwrite sending/sent. SMTP requires certificate-verified TLS on port 465 or STARTTLS on port 587, has timeouts, and does not retry an uncertain delivery. Logs contain only fixed status text.

Requests with a failed/uncertain delivery remain saved for administrator inspection; the next request is permitted after 24 hours. A new request UUID prevents an old worker from changing a newer request. Account deletion cascades request data.

## Deployment

Implementation and offline checks do not deploy this feature. Live rollout requires the existing deployment authorization and process:

1. Review and apply migration 005 after migration 004 in the intended Supabase project.
2. Configure the function's **GITHUB_PAT** with Actions write permission for this repository. Existing dispatch-workflow configuration uses the same secret name. **GITHUB_OWNER** and **GITHUB_REPO** are optional; defaults are trippinganymess/Xphire. Supabase supplies **SUPABASE_URL** and **SUPABASE_SERVICE_ROLE_KEY** automatically.
3. Ensure Actions has **SUPABASE_URL**, **SUPABASE_SERVICE_KEY**, **SMTP_USER** and **SMTP_PASSWORD**. Optional **SMTP_HOST**/**SMTP_PORT** default to smtp.gmail.com/465. Credentials stay in server/Actions secrets.
4. Make the notification workflow available on main before accepting requests. Deploy the function with `supabase functions deploy request-private-access`; [config.toml](../supabase/config.toml) disables gateway verification because the handler verifies every POST itself.
5. Build/deploy the frontend. The PR's discovery preset changes also require redeploying private-job-board. Verify the request page and one separately authorized notification before claiming live delivery.

For delivery troubleshooting, inspect the request's notification_status and the dedicated Actions run. Do not reset a sending claim and rerun merely because the final acknowledgement is missing; SMTP may already have accepted the email.

## Offline verification

Browser tests cover sign-in gates, fixed account email, submissions, duplicate clicks, errors, late responses after sign-out, and mobile/keyboard layouts. Node tests cover verified identity/email, spoofed fields, limits, cooldown, malformed storage, dispatch failures, redaction and bounded requests. Python tests inspect synthetic SMTP messages and TLS, failures, reruns and safe logs. Disposable PostgreSQL tests cover RLS, privileges, claim states, cooldown, account deletion and overlapping request/notification transactions.

```bash
node --test tests/private-access-request.test.mjs
npm --prefix frontend test -- tests/private-access-request.spec.ts
python -m pytest -q tests/test_private_access_email.py
```

SQL scripts [private-access-request.sql](../tests/private-access-request.sql) and [private-access-request-concurrency.sh](../tests/private-access-request-concurrency.sh) require a disposable loopback database after bootstrap and migrations 004/005. They are not production migration scripts. All automated checks use synthetic users and mail; no live notification is sent.
