---
id: "02"
title: "Authenticated, bounded workflow dispatch"
blocked_by: ["01"]
status: blocked
branch: "V2/02-secure-dispatch"
priority: P0
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 02: Authenticated, bounded workflow dispatch

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/02-secure-dispatch` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** An authenticated dispatch interface with recipient authorization, persistent limits, and replay protection.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** dispatch-workflow has JWT verification disabled and no handler-level identity check, allowing arbitrary recipients and unbounded requests under the checked-in configuration.

## 2. Blocked By

- [ ] [01: Reproducible quality and regression foundation](01-quality-foundation.md)

**Directly unblocks:** [05](05-account-and-search-forms.md), [18](18-real-run-status.md)

## 3. Derivation & Concept Notes

**Foundational fact:** Valid input is not authorization; a request must be linked to an authenticated user before privileged work starts.

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

- Resolve/verify the calling user server-side with supported Supabase auth behavior; reject unauthorized requests before GitHub calls.
- Allow the verified account email initially; require explicit verified consent for any alternate recipient flow rather than accepting arbitrary addresses.
- Enforce finite/integer bounded inputs, request size/method constraints, per-user quotas/rate limits, and durable idempotency before external dispatch.
- Limit error exposure, keep GitHub/service secrets server-side, and document the dispatch response contract for later run tracking.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `supabase/functions/dispatch-workflow/index.ts`
- `supabase/config.toml`
- `supabase/functions/dispatch-workflow/.supabaseconfig`
- `supabase/migrations/ (dispatch limits/idempotency)`
- `frontend/src/components/SketchTerminal.tsx`
- `.github/workflows/email_jobs.yml`

### Design impact

Preserve the current UI; expose truthful accepted/rejected feedback. Later M3 forms reuse this interface.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] Missing/invalid/expired JWT, unauthorized recipient, and invalid payloads produce no GitHub request.
- [ ] Valid user plus verified authorized recipient dispatches at most once for a repeated idempotency key.
- [ ] Concurrent retries cannot bypass durable rate/quota enforcement; user identities cannot read/change each other’s records.
- [ ] Errors have appropriate HTTP status and sanitized messages; no service/PAT secret appears in browser output or logs.

## 8. Verification Plan

- Edge-function auth/input/rate-limit/idempotency tests with mocked auth/GitHub responses.
- Local database tests for concurrent requests, quota windows, and cross-user isolation.
- Browser test of rejected/accepted dispatch without actually calling GitHub.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Assuming gateway configuration alone validates identity, enabling arbitrary alternate recipients, or production deployment without validation.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
