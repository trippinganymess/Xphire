# Private paid job discovery: connectivity gate

**Status: waiting for gate-only PR review and live verification.** The API secret names are now present in repository Actions secrets. No live request has been made as part of this continuation, and mocked tests are not live-connectivity evidence. The Private Job Board (PJB), database integration, and paid daily scanner remain gated.

This change adds an isolated, manual-only probe. It does not change the public scraper, its workflows, tables, email pipeline, or frontend. No Supabase credentials are needed.

## Credentials

The workflow accepts canonical secret names and the aliases already configured in `trippinganymess/Xphire`:

| Provider | Canonical Actions secret | Existing repository alias |
| --- | --- | --- |
| OpenWeb Ninja JSearch | `JSEARCH_API_KEY` | `X_API_KEY` |
| TheirStack | `THEIRSTACK_API_KEY` | `THEIR_STACK_API_KEY` |

Canonical names take precedence when supplied. There is no need to rename existing secrets. On 2026-10-28, secret-name inspection confirmed both aliases in repository Actions secrets; it did not retrieve or verify their values. Neither canonical name appeared, and the `copilot` environment had no secret names.

Keys belong in **Settings → Secrets and variables → Actions**, never frontend variables. If replacing a key, use GitHub's UI or the CLI's hidden prompt; never put a key directly in a shell command or paste it into logs/chat:

```bash
gh secret set X_API_KEY --repo trippinganymess/Xphire
gh secret set THEIR_STACK_API_KEY --repo trippinganymess/Xphire
```

GitHub cannot return stored secret values. The script does not read `.env` or retrieve GitHub secrets. Both providers' keys must be configured before **any** live request is made; missing or invalid header tokens fail preflight with zero requests. Missing-secret diagnostics use the canonical names above.

## Review and execute the live gate

The isolated workflow is [Xphire Paid Job API Connectivity](../.github/workflows/paid_api_connectivity.yml). It has only `workflow_dispatch`, read-only repository permissions, and no Supabase access. It runs offline probe tests before introducing API secrets, then sends exactly one request per provider, without retries or extra pages.

**The user selected a gate-only PR. Do not merge it or execute live requests without subsequent confirmation.** Only the probe workflow, script, tests, and documentation belong in that PR, not unrelated OAuth or other local work.

GitHub requires a `workflow_dispatch` workflow to exist on the default branch before it can be dispatched. After the gate-only PR is reviewed, merged into `main`, and live execution is authorized, use Actions → **Xphire Paid Job API Connectivity** → **Run workflow**, or:

```bash
gh workflow run paid_api_connectivity.yml --repo trippinganymess/Xphire --ref main
gh run list --repo trippinganymess/Xphire --workflow paid_api_connectivity.yml --limit 1
# Inspect the chosen run's summary/log and download its sanitized report if needed.
gh run view RUN_ID --repo trippinganymess/Xphire --log
gh run download RUN_ID --repo trippinganymess/Xphire \
  --name paid-api-connectivity-report --dir /tmp/xphire-paid-api-evidence
```

The script's nonzero exit status fails the workflow when either provider fails the gate. The artifact step uses `if: always()` so it still retains a generated failure report; it does **not** mask the probe failure. The report is printed as sanitized JSON, included in the Actions step summary, and retained for seven days. Do not upload raw API payloads.

For separately authorized local testing only, with both keys already securely supplied to the process environment:

```bash
python3.11 scripts/test_paid_job_apis.py --report /tmp/xphire-paid-api-report.json
```

## Exact requests and diagnostics

These are the selected request forms to verify, not evidence that either provider has passed the gate.

### JSearch (OpenWeb Ninja)

`POST https://api.openwebninja.com/jsearch/search-v2`, with `x-api-key` and `Content-Type: application/json`:

```json
{
  "query": "frontend developer jobs in India",
  "country": "in",
  "date_posted": "today",
  "num_pages": 1
}
```

The probe reports HTTP status, jobs returned/normalized, field presence and populated counts, usable apply-link count, and reliable UTC timestamp count. Inspected fields include `job_id`, `job_apply_is_direct`, `apply_options`, `job_posted_at_datetime_utc`, `job_location`, `job_description`, `job_title`, employer fields, and city/state/country fields. Missing `job_location` may be filled from city/state/country in the tentative in-memory format.

Estimated usage: one search request. Exact vendor credit debit is not established by this probe. `num_pages: 1` is retained to match the requested test body; its effective behavior on `search-v2` remains unverified. Diagnostics report only top-level pagination-field presence (`cursor`, `next_cursor`, `next_page`), never cursor values. No cursor is followed and no default page or effective pagination behavior is claimed.

`date_posted: "today"` alone is not proof of rolling-24-hour eligibility. Production validation must check reliable timestamps independently.

### TheirStack

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

The probe reports HTTP status, jobs in `data`, and for each job only `id`, `job_title`, `company`, `country_code`, `date_posted`, `seniority`, `final_url_exists`, and `company_object_employee_count_exists`. It also reports `metadata.total_results` when supplied and the allowlisted `RateLimit`, `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers when present.

Under the requested billing rule, **one successful request uses one API credit**, whether it returns zero, one, or ten jobs. Each additional successful request/page costs another credit. HTTP 200 records one estimated credit even if JSON parsing subsequently fails. This is request-based accounting, not independent billing-statement verification. The probe does not request `include_total_results: true` and does not retry HTTP 429. Bounded, rate-aware retries belong to the later production scanner.

Date-only or timezone-free `date_posted` values are reported as unreliable UTC timestamps, not invented midnight posting instants.

## Passing criteria and safety

The process exits successfully only when **both** responses have HTTP 200, valid JSON, a nonempty `data` array, and job objects that normalize into the complete proposed internal shape with a nonempty title. An empty array is schema-parseable but cannot prove job normalization, so the gate remains closed. Missing optional fields are reported rather than fabricated.

The tentative normalizer keeps `raw_payload` and descriptions **in memory only**, never in the report. It removes tracking parameters, hashes normalized title/company/cleaned apply URL, and sets `validation.passed: false` with a connectivity-only reason. It is not the production validator or source adapter; skills/company size/experience/salary/location mappings still require refinement against real responses. API filtering is not proof of fresher compatibility.

No API keys, full descriptions, raw response bodies, exception details, or non-allowlisted headers are logged. Allowlisted upstream strings are redacted against all configured secret aliases, whitespace-normalized, length-limited, and made UTF-8 serializable. Summary text cannot escape its fenced JSON block. Response reads are bounded; malformed/deep JSON, truncated HTTP responses, and UTC-conversion overflow fail safely. Redirects cannot forward API credentials to another host. If one request fails, the other is still attempted, and the overall gate fails.

## Offline regression tests

These use only the Python standard library and synthetic in-memory HTTP responses. They make no live requests and need no credentials:

```bash
python3.11 -m unittest discover -s tests -p test_paid_api_connectivity.py -v
python3.11 scripts/check_docs.py
```

Coverage includes exact requests, canonical/legacy secret precedence, missing/invalid-secret preflight, normalized shape, cleaned-URL/hash behavior, timestamp uncertainty and overflow, optional/malformed fields, per-request credit accounting, empty/non-JSON/deep/oversized/truncated responses, independent API failures, secret redaction, safe CLI reports/summaries, workflow failure propagation, and redirect rejection.

## Private-board entry point and continuation

The user confirmed **PJB**, beside **Latest Opportunities** at the upper right of the public board, as the entry point to the **Private Job Board**. After the live gate passes, add separate authenticated navigation to the user's private matches. It must not filter or reuse the shared catalog as if it were private, or trigger the public scraper. Paid eligibility and authenticated own-user access must be enforced server-side; button visibility alone is not authorization. The button is not implemented ahead of the gate.

Before full implementation, clarify authoritative paid entitlement, handling of `needs_review` jobs without polluting the valid-only board, and daily coverage when due users exceed batch/provider budgets.

The later scanner will require `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and both API keys as Actions secrets. The public pipeline currently uses `SUPABASE_SERVICE_KEY`; preserve it rather than renaming it. The **Xphire Paid Daily Job Scan** workflow, schema/RLS, production adapters/validator/repository, and private frontend have not been implemented or verified. No end-to-end private-user scan or scheduled paid scan has run.
