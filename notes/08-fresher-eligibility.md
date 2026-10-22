---
id: "08"
title: "Evidence-based fresher eligibility"
blocked_by: ["07"]
status: blocked
branch: "V2/08-fresher-eligibility"
priority: P0
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 08: Evidence-based fresher eligibility

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/08-fresher-eligibility` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** One persisted evidence-based experience/seniority decision with numeric parsing and explicit uncertainty.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** Substring/keyword heuristics accept 10–12 years and mentoring language, disagree across board/email, and reject generic titles before reading the JD.

## 2. Blocked By

- [ ] [07: Full JD ingestion and efficient resilient connectors](07-evidence-ingestion.md)

**Directly unblocks:** [12](12-server-side-discovery.md), [14](14-explainable-matching.md)

## 3. Derivation & Concept Notes

**Foundational fact:** A mandatory requirement overrides a suggestive title; missing evidence is not a confirmed positive match.

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

- Normalize minimum/maximum experience, required versus preferred language, professional versus internship context, seniority, and explicit no-experience statements.
- Produce confirmed/possible/not_eligible/unknown with evidence snippets and versioned reason codes.
- Remove title-only fresher rejection before evidence extraction; handle negation, mentoring references, senior titles, and conflicting facts conservatively.
- Use the same decision in ingestion, cache/digest, and board via a small tested interface; backfill/reclassify existing records with explicit versioning.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `new eligibility module and fixtures`
- `utils/scraping.py, ai_reviewer.py, deduper.py`
- `workers/worker_email.py`
- `frontend/src/components/JobBoard.tsx`
- `catalog eligibility migrations`

### Design impact

Expose truthful status text on available M3 surfaces; full evidence details come in 15. Never use stars as eligibility.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] 10–12/10–20 years never qualify through a 0–1/0–2 substring; numeric ranges and punctuation variants parse correctly.
- [ ] Generic Software Engineer with explicit zero required experience is retained; Associate with mandatory five years is not eligible.
- [ ] “Mentor junior engineers” and “not suitable for a fresher” do not confirm eligibility.
- [ ] Missing/conflicting/insufficient JD produces explicit uncertainty; no source-independent AI guess is marked confirmed.
- [ ] Board and digest give identical outcomes for the same classified record; existing rows have a safe reclassification strategy.

## 8. Verification Plan

- Table-driven positive/negative/unknown/negation/required-preferred/Unicode-range fixtures.
- Integration tests through persisted catalog → board/cache/digest.
- Regression tests for all cases reproduced in the review and reclassification idempotency.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Treating all 0–2 roles as confirmed eligible for a zero-experience candidate, opaque AI labels, or personalized skill matching.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
