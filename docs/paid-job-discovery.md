# Private paid job discovery: TheirStack connectivity gate

**Status: TheirStack live connectivity verified; JSearch deferred by user request.** The [PJobB feature](private-job-board.md) now implements a separate private board, service-managed paid entitlements, private tables/RLS, and on-request per-user daily discovery on the feature branch. It is not deployed; an unattended scanner is not implemented. The active connectivity gate checks **TheirStack only**; JSearch is not a prerequisite and receives no requests or credentials.

This is an isolated, manual-only probe. It does not change the public scraper, its workflows, tables, email pipeline, or frontend. No Supabase credentials are needed.

## Verified evidence and scope change

[PR #41](https://github.com/trippinganymess/Xphire/pull/41) was merged with user authorization. The authorized [live run on 2026-10-28](https://github.com/trippinganymess/Xphire/actions/runs/40676405432) produced:

| Provider | HTTP status | Jobs returned / normalized | Result |
| --- | --- | --- | --- |
| TheirStack | 200 | 9 / 9 | Valid JSON and parseable job data; provider connectivity passed |
| JSearch (previous direct-service request) | 404 | Not available | Failed; subsequently deferred |

The historical workflow failed overall because its old policy required both providers. **The user subsequently selected TheirStack alone**, superseding that two-provider prerequisite. TheirStack's successful live result remains valid evidence; the revised single-provider probe has been tested offline, not rerun live. Do not describe the historical workflow as successful or diagnose the JSearch secret from an unauthenticated local request.

All nine TheirStack jobs had a usable apply URL through the existing `url` fallback; none supplied `final_url`. Posting dates were date-only, so **zero reliable UTC posting instants** were established. Those limitations must be addressed before claiming rolling-24-hour production eligibility. Connectivity is not paid entitlement, fresher validation, or an end-to-end private-user scan.

## Credentials

| Provider | Canonical Actions secret | Existing repository alias |
| --- | --- | --- |
| TheirStack | `THEIRSTACK_API_KEY` | `THEIR_STACK_API_KEY` |

The canonical name takes precedence when nonempty. No secret needs renaming. `JSEARCH_API_KEY`, `X_API_KEY`, and `X_RAPIDAPI_KEY` are not read by the probe or injected by its workflow; JSearch is deferred, not silently used as a fallback.

Keys belong in **Settings → Secrets and variables → Actions**, never frontend variables. To replace a key, use GitHub's UI or the CLI's hidden prompt; do not place a key in a shell command, logs, or chat:

```bash
gh secret set THEIR_STACK_API_KEY --repo trippinganymess/Xphire
```

GitHub cannot return stored secret values. The script does not read `.env` or retrieve GitHub secrets. A missing, blank, or invalid header token fails preflight with **zero requests**. Invalid canonical tokens do not fall back to an alias.

## Review and execute the gate

The workflow remains [Xphire Paid Job API Connectivity](../.github/workflows/paid_api_connectivity.yml), preserving its filename for existing links and dispatch commands. It has only `workflow_dispatch`, read-only repository permissions, and no Supabase access. Offline tests run before secrets are introduced, followed by **one request to TheirStack**, without retries or extra pages.

Keep gate changes separate from OAuth or other local work. Merging, dispatching, and live requests require user authorization. No new live request is necessary merely to remove JSearch; the successful TheirStack evidence above is retained.

For a separately authorized live rerun after the revised workflow is reviewed and merged into `main`, use Actions → **Xphire Paid Job API Connectivity** → **Run workflow**, or:

```bash
gh workflow run paid_api_connectivity.yml --repo trippinganymess/Xphire --ref main
gh run view RUN_ID --repo trippinganymess/Xphire
gh run download RUN_ID --repo trippinganymess/Xphire \
  --name paid-api-connectivity-report --dir /tmp/xphire-paid-api-evidence
```

The nonzero probe exit status fails the workflow if TheirStack fails. The artifact step uses `if: always()` to retain a generated failure report; it does not mask that failure. Sanitized JSON is printed, included in the Actions summary, and retained for seven days. Never upload raw API payloads.

For separately authorized local testing only, with the TheirStack key securely supplied to the process environment:

```bash
python3.11 scripts/test_paid_job_apis.py --report /tmp/xphire-paid-api-report.json
```

## Exact TheirStack request and diagnostics

`POST https://api.theirstack.com/v1/jobs/search`, with bearer authentication and `Content-Type: application/json`:

```json
{
  "job_title_or": ["frontend developer", "python developer"],
  "job_country_code_or": ["IN"],
  "posted_at_max_age_days": 1,
  "job_seniority_or": ["junior"],
  "employment_statuses_or": ["full_time", "internship"],
  "workplace_types_or": ["remote", "hybrid", "on_site"],
  "limit": 10,
  "page": 0
}
```

The report retains `sources.theirstack` and records HTTP status, jobs returned/normalized, usable apply-link count, and reliable UTC timestamp count. Per-job fields are limited to `id`, `job_title`, `company`, `country_code`, `date_posted`, `seniority`, `final_url_exists`, and `company_object_employee_count_exists`. `metadata.total_results` is reported if supplied.

Only `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` are logged. The combined `RateLimit` header is deliberately omitted because it can contain an account partition identity.

Under the selected billing rule, **one successful request uses one estimated API credit**, whether it returns zero, one, or ten jobs. HTTP 200 records one estimated credit even if JSON parsing later fails; this is request-based accounting, not independent billing-statement verification. The probe does not request `include_total_results: true`, follow another page, or retry HTTP 429. Rate-aware retries belong to the later production scanner.

## Passing criteria and safety

The revised process passes only when **TheirStack** returns HTTP 200, valid JSON, a nonempty `data` array, and job objects that normalize into the complete proposed internal shape with nonempty titles. Empty or partially malformed arrays fail. Missing optional fields produce warnings, not fabricated values.

The tentative normalizer retains descriptions and `raw_payload` **in memory only**, never in the report. It cleans tracking parameters, hashes normalized title/company/apply URL, and sets `validation.passed: false` with a connectivity-only reason. It is not a production adapter or validator. Date-only and naive timestamps do not become invented midnight posting instants.

No keys, full descriptions, raw response bodies, exception details, or non-allowlisted headers are logged. A diagnostic string containing any configured TheirStack key is replaced in full with `[REDACTED]`; other allowlisted strings are whitespace-normalized, length-limited, and made UTF-8 serializable. Summary text cannot escape its fenced JSON block. Reads are bounded, malformed/deep/truncated responses fail safely, and redirects cannot forward credentials to another host.

## Offline regression tests

These use only synthetic in-memory HTTP responses and require no credentials. An unexpected attempt to construct a live HTTP opener fails the standalone tests:

```bash
python3.11 -m unittest discover -s tests -p test_paid_api_connectivity.py -v
python3.11 scripts/check_docs.py
```

Coverage includes TheirStack-only selection even when JSearch variables exist, canonical/legacy precedence, missing/invalid-token preflight, exact request shape, URL/hash behavior, uncertain/overflowing timestamps, optional/malformed fields, request-based credit accounting, malformed/deep/oversized/truncated responses, no retries, secret/header redaction, safe CLI reports, workflow failure propagation, and redirect rejection.

## Private-board continuation

The **PJobB** link is implemented beside **Latest Opportunities**, navigating to `#/private-jobs` with cyan cards. Paid entitlement comes from an administrator-managed table, not an editable profile or email subscription. The [private-board deployment notes](private-job-board.md) describe RLS, on-request discovery, quota rules, and the separate deployment steps; implementation in a PR is not live deployment verification.

The public pipeline's `SUPABASE_SERVICE_KEY` remains unchanged. Richer preferences, verified fresher/precise freshness matching, uncertain-job review, and an unattended daily scanner remain future work. No production private-user scan or scheduled paid scan has run.
