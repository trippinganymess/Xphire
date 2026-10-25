---
id: "24"
title: "PR #38 failed-refresh feedback"
blocked_by: ["23"]
status: in_review
branch: "V2/24-pr38-failed-refresh-feedback"
priority: P0
created: 2026-10-25
tags: [v2, pr38-remediation, implementation-ticket, learning-ticket, concept]
---

# 24: PR #38 failed-refresh feedback

[PR #38 remediation index](README.md#pr-38-remediation-slice) · [23: Board render recovery](23-pr38-board-rendering.md)

**Branch:** `V2/24-pr38-failed-refresh-feedback` is the dedicated-ticket naming convention. This approved remediation is integrated on `fix/pr38-review`, the existing PR #38 performance branch; do not create a separate branch for this exception.
**Delivers:** Clear, recoverable feedback when an initial public-board load fails instead of silently showing an empty-looking page.
**Status:** in progress. This note scopes the fix; it does not claim the fix or verification is complete.

## 1. Core Motivation & Problem

**Why are we doing this?** The initial board request can fail without presenting an error. A user cannot distinguish a network/service failure from a genuine empty result and has no clear recovery action.

## 2. Blocked By

- [ ] [23: PR #38 board render recovery](23-pr38-board-rendering.md) — restore a renderable board before changing its load-state presentation.

## 3. Derivation & Concept Notes

**Foundational fact:** “No results” is a domain result; “could not load” is an operational failure. Conflating them makes the interface state false and removes the user's path to recovery.

**Derivation:** Model request state explicitly: initial loading, successful empty, successful populated, and failed initial load are distinct. Render a concise failure state and a retry action; retry should re-run the current query and transition back through loading rather than inventing an empty success.

**Structural verification:** Force the initial request to reject in an offline browser fixture and verify an announced, visible error plus a retry path. Separately verify a successful empty response remains a truthful empty state.

<!-- Optional teaching: discuss sum/state modeling, why failure is not an empty collection, and derive UI states from the request lifecycle. No teaching session or quiz has been claimed. -->

## 4. Visual Model (If Needed)

<!-- A request-state diagram may be added if it helps distinguish initial failure from empty success. -->

## 5. Active Recall Checkpoint

- [ ] Explain why a failed query must not be presented as an empty result.
- [ ] Concept verified via quiz when this ticket is studied.
- [ ] Verify both failure/retry and successful-empty paths.

Learning checkpoints are separate from implementation acceptance; no quiz or completed fix is claimed.

## 6. Implementation Scope

- Surface an explicit initial-load error when the board request fails.
- Provide a retry control that repeats the active query and returns to an appropriate loading state.
- Preserve the separate successful-empty and populated states; retain useful stale content if the existing refresh model provides it.

### Starting points

- PR #38 board component and its initial query/load-state handling.
- Existing mocked-browser catalog request boundary and route tests.

### Design impact

Use the existing UI tokens and accessible status/error patterns. Do not redesign the board or change query semantics.

## 7. Acceptance Criteria

- [ ] An initial request failure is visibly and accessibly distinguishable from an empty result.
- [ ] Retry reissues the current query and successful retry renders the response.
- [ ] A genuine empty response remains presented as empty, not as failure.
- [ ] Tests simulate failures offline and issue no live network/auth requests.

## 8. Verification Plan

- Add/run mocked browser coverage for initial rejection, retry success, and successful empty results.
- Run frontend typecheck, lint, build, and browser tests after blocker 23 is resolved.
- Record exact commands and outputs after verification; no live API request is required.

## 9. Out of Scope

Changing catalog filters, adding new telemetry infrastructure, or claiming backend health from a client-side retry.

## 10. Execution Log

- 2026-10-25: Remediation note created; fix and verification not yet recorded here.
- 2026-10-25 (fix/pr38-review): `useJobRefresh` now surfaces a failed run on mount/remount and keeps failure as an alert on later polls while retaining run-correlation safeguards.
- Mocked browser regressions cover initial failure, route return, and persisted failure alerts.
- Fix implemented and verified; PR review pending.
- Integration target exception: `fix/pr38-review` (existing PR #38 performance branch).
- Verification: recorded in the log above; review/merge pending on PR #38.
