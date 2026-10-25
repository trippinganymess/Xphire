---
id: "26"
title: "PR #38 lazy terminal routing"
blocked_by: ["23"]
status: in_review
branch: "V2/26-pr38-lazy-terminal-routing"
priority: P1
created: 2026-10-25
tags: [v2, pr38-remediation, implementation-ticket, learning-ticket, concept]
---

# 26: PR #38 lazy terminal routing

[PR #38 remediation index](README.md#pr-38-remediation-slice) · [23: Board render recovery](23-pr38-board-rendering.md) · [Performance discovery slice](performance-discovery.md)

**Branch:** `V2/26-pr38-lazy-terminal-routing` is the dedicated-ticket naming convention. This approved remediation is integrated on `fix/pr38-review`, the existing PR #38 performance branch; do not create a separate branch for this exception.
**Delivers:** A terminal route that remains code-split and loads only when that route is visited.
**Status:** in progress. This note scopes the fix; it does not claim the fix or verification is complete.

## 1. Core Motivation & Problem

**Why are we doing this?** Eagerly importing the terminal from the board/router pulls terminal code into the initial public-board route, defeating lazy terminal routing and increasing code loaded by visitors who never open it.

## 2. Blocked By

- [ ] [23: PR #38 board render recovery](23-pr38-board-rendering.md) — establish a working board route before validating its split point.

## 3. Derivation & Concept Notes

**Foundational facts:** A static import creates a build-time dependency edge. A dynamic import can establish a separate chunk boundary, but only if the module graph has no other eager path to that module or its route-only styles.

**Derivation:** Identify every edge from the initial board entry to the terminal. Keep route selection and fallback in the initial shell, but make the terminal module load on demand. Avoid an unrelated static import (including helper barrels) that reconnects the chunk graph.

**Structural verification:** Inspect the production bundler manifest/chunks to prove the terminal JS and terminal-only CSS are absent from the initial route graph and available as a deferred dependency. Browser-test direct and in-app navigation to the terminal.

<!-- Optional teaching: explain static dependency graphs, dynamic-import split points, and derive why source syntax alone does not prove a production chunk boundary. No teaching session or quiz has been claimed. -->

## 4. Visual Model (If Needed)

<!-- Dependency graph can be added if the import graph becomes unclear. -->

## 5. Active Recall Checkpoint

- [ ] Explain why a dynamic import does not guarantee a split if another eager edge remains.
- [ ] Concept verified via quiz when this ticket is studied.
- [ ] Verify both production chunk structure and functional terminal navigation.

Learning checkpoints are separate from implementation acceptance; no quiz or completed fix is claimed.

## 6. Implementation Scope

- Preserve a dynamic import for the terminal route and remove accidental eager import paths.
- Keep a lightweight accessible route-loading fallback.
- Retain guest navigation and direct/restored-session terminal access.
- Add/retain a manifest-based guard that rejects a static terminal edge from the initial board graph.

### Starting points

- PR #38 router/board imports and terminal entry module.
- Existing production Vite manifest route-chunk check and mocked Chromium route tests.

### Design impact

No terminal redesign or change to authentication behavior. Route loading remains accessible and functional.

## 7. Acceptance Criteria

- [ ] Production manifest/chunks show terminal JS and terminal-only CSS outside the initial board dependency graph.
- [ ] Visiting the terminal loads it successfully through the lazy route; guest and restored-session paths still work.
- [ ] A regression check fails if a static eager terminal edge is reintroduced.
- [ ] Browser tests remain offline/mocked.

## 8. Verification Plan

- Run typecheck, lint, production build, manifest route-chunk guard, and mocked browser tests.
- Inspect built assets/manifest, not only source-level import syntax.
- Record exact results after blocker 23 is resolved; do not claim a real production latency measurement from bundle splitting alone.

## 9. Out of Scope

Changing terminal semantics, reducing unrelated shared dependencies/assets, or claiming completion of original roadmap tickets 04 or 12.

## 10. Execution Log

- 2026-10-25: Remediation note created; fix and verification not yet recorded here.
- 2026-10-25 (fix/pr38-review): Board no longer preloads the terminal module; the manifest-based route-chunk check plus the terminal-loading browser test verify on-demand loading.
- Build and browser tests pass.
- Fix implemented and verified; PR review pending.
- Integration target exception: `fix/pr38-review` (existing PR #38 performance branch).
- Verification: recorded in the log above; review/merge pending on PR #38.
