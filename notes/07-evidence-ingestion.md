---
id: "07"
title: "Full JD ingestion and efficient resilient connectors"
blocked_by: ["06"]
status: blocked
branch: "V2/07-evidence-ingestion"
priority: P1
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 07: Full JD ingestion and efficient resilient connectors

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/07-evidence-ingestion` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** Permitted ATS ingestion with complete evidence/provenance, source-authoritative values, one sweep per cycle, and isolated failure reporting.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** ATS records omit descriptions and the default keywords repeatedly fetch each board; one malformed connector result can disrupt a whole sweep.

## 2. Blocked By

- [ ] [06: Migrated, normalized job catalog and provenance](06-normalized-job-catalog.md)

**Directly unblocks:** [08](08-fresher-eligibility.md), [09](09-role-and-location-eligibility.md), [10](10-open-job-lifecycle.md)

## 3. Derivation & Concept Notes

**Foundational fact:** Classification cannot verify a requirement it never receives; observing one source failure does not invalidate successful observations from others.

**Discovery path:** Reproduce the stated problem, identify which facts the current interface lacks, implement the smallest complete behavior that exposes those facts safely, and verify it through the same interface that callers use.

<!-- When a learning session is requested, the user may enable /md-log for this note. No mirroring or quiz is claimed to have run. -->

## 4. Visual Model (If Needed)

<!-- Add a verified diagram only if it clarifies this ticket. No decorative/placeholder image is required. -->

## 5. Active Recall Checkpoint

- [ ] Explain the foundational fact using one concrete failure case.
- [ ] Concept verified via quiz when this ticket is studied.
- [ ] Connect the outcome to downstream tickets.

Learning checkpoints are separate from implementation acceptance; publishing or merging this note does not mark them verified.

## 6. Implementation Scope

- Fetch full JD content using supported source APIs/detail endpoints; persist raw/normalized evidence, posting/deadline data when actually supplied, and fetch metadata.
- Fetch each board once per cycle and classify local results across requested roles; deduplicate before expensive optional enrichment.
- Keep source location/salary/employment facts authoritative; evidence-linked model suggestions cannot silently overwrite them, and model failure leaves unknowns.
- Isolate malformed JSON/timeouts/429/source failures, add bounded retries/per-host pacing and health/yield records; verify connector mappings and permitted access.
- Correct inaccurate source-count/Google Jobs marketing/comments and render endpoint counts from configuration/health rather than declaring all connected.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `utils/scraping.py, ai_reviewer.py, deduper.py`
- `workers/worker_scrape.py, worker_email.py`
- `.github/workflows/scrape_jobs.yml`
- `catalog/connector-health migrations and source registry`
- `README.md and terminal/email source copy`

### Design impact

No eligibility or fit badges yet. Source evidence and timestamps must remain available for later details.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] All supported connectors return/store JD evidence where available; unavailable JD remains explicit unknown rather than invented content.
- [ ] Six role queries share one board fetch per cycle, with required detail requests accounted for separately.
- [ ] Source location/salary survive model failure or conflicting output; optional extraction records provenance.
- [ ] One bad connector cannot discard successful jobs; rate limits and temporary failures have bounded documented handling.
- [ ] Source health distinguishes configured, reachable, successful, and useful endpoints; connectors comply with permitted access.

## 8. Verification Plan

- Recorded/mocked payloads for all four ATS types and JobSpy normalization.
- Call-count tests for single sweep, detail fetching, in-batch dedup, retry limits, malformed response isolation, and no-model operation.
- Failure/backfill fixtures and source-value preservation tests; no live scraping in CI.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

CAPTCHA/access-control bypass, adding paid sources, broad speculative source expansion, or making AI eligibility decisions.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
