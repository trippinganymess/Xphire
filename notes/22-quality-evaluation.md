---
id: "22"
title: "Measured fresher-discovery and delivery quality"
blocked_by: ["14", "20"]
status: blocked
branch: "V2/22-quality-evaluation"
priority: P2
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 22: Measured fresher-discovery and delivery quality

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/22-quality-evaluation` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** A reproducible labeled benchmark plus privacy-safe discovery/source/run/delivery metrics and release checks.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** Endpoint count and passing two unit tests do not show whether recommendations are eligible, complete, open, or useful to candidates.

## 2. Blocked By

- [ ] [14: Hard-filtered, explainable candidate matching](14-explainable-matching.md)
- [ ] [20: Reliable personal digests, delivery ledger, and reminders](20-reliable-digests-and-reminders.md)

**Directly unblocks:** No direct downstream blockers.

## 3. Derivation & Concept Notes

**Foundational fact:** Precision and missed eligible roles measure different failures; a quality claim needs a defined dataset, denominator, and measured result.

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

- Curate permitted/redacted JD/profile fixtures with human labels for eligibility, role, country/remote, requirements, evidence, and open-status scenarios.
- Report precision/recall or missed-eligible rate, unknown coverage, and breakdowns for internships/graduate/full-time/source/location cases.
- Measure connector success/useful yield, malformed/fallback rate, canonical duplicates, stale/dead links, duplicate digests, and run/delivery failures.
- Set explicit release thresholds after baseline measurement; record false-positive/negative examples and regression fixtures without inventing production results.
- Use shortlist feedback as review input, not automatic truth; keep logs/metrics sanitized and avoid public PII or email content.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `tests/fixtures/ and evaluation runner/report`
- `connector/run/delivery instrumentation`
- `docs or notes quality report`
- `CI benchmark check and design.md verification section`

### Design impact

Quality indicators use honest denominators and source/verification labels; no inflated connected-source count or decorative quality score.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Benchmark labels/provenance/license/privacy assumptions and split/version are recorded; results reproduce offline.
- [ ] False positives/negatives and unknowns are reported separately with useful subgroup breakdowns.
- [ ] Source/delivery metrics distinguish configured/reachable/useful and attempted/sent/failed; sensitive fields are excluded.
- [ ] Release thresholds are explicit and based on measured baseline; a deliberately introduced eligibility regression fails the check.
- [ ] All approved recommendations map to completed/in-review/deferred tickets with remaining risks recorded.

## 8. Verification Plan

- Run evaluator twice with deterministic fixtures; verify expected confusion counts and subgroup metrics.
- Metric sanitization/denominator/failure-status tests.
- CI benchmark regression gate and end-to-end mocked JD → match → digest scenario.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Unverified accuracy claims, scraping copyrighted/private data indiscriminately, or storing candidate/email PII in public metrics.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
