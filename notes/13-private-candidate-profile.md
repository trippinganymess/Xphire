---
id: "13"
title: "Private evidence-backed candidate profile and preferences"
blocked_by: ["05", "06"]
status: blocked
branch: "V2/13-private-candidate-profile"
priority: P1
created: 2026-10-22
tags: [v2, implementation-ticket, learning-ticket, concept]
---

# 13: Private evidence-backed candidate profile and preferences

[Roadmap](README.md) · [Design contract](../design.md)

**Branch:** `V2/13-private-candidate-profile` — create when this ticket starts, from updated `main` after blockers merge. Only ticket 00 has a branch at plan publication.
**Delivers:** An editable private candidate profile with structured evidence, explicit uncertainty, and tested access isolation.
**Status:** blocked. A note is a plan, not completed implementation; ready means dependencies permit starting, not that tests already pass.

## 1. Core Motivation & Problem

**Why are we doing this?** Current identity/run settings cannot establish whether a specific fresher meets graduation, skill, location, availability, or experience restrictions.

## 2. Blocked By

- [ ] [05: Accessible account, search, and settings forms](05-account-and-search-forms.md)
- [ ] [06: Migrated, normalized job catalog and provenance](06-normalized-job-catalog.md)

**Directly unblocks:** [14](14-explainable-matching.md), [16](16-personal-shortlist.md)

## 3. Derivation & Concept Notes

**Foundational fact:** A JD describes employer requirements, not candidate achievements; candidate claims must originate from candidate-provided facts.

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

- Add private profile/evidence/preferences tables and own-user RLS; audit existing users table/RLS before relying on it.
- Capture student/graduate status, graduation year, degree/branch, evidenced skills/projects, professional versus internship experience, availability, role/location/relocation preferences.
- Add configurable employer preferences and internship/full-time choices; ask for CGPA or sensitive/restriction-specific fields only when relevant.
- Track provenance/confirmation/profile version and unknown values; provide edit/delete paths and avoid placing private facts in public jobs.

### Starting points

These are inspection targets, not a promise to edit every file; names can evolve after earlier tickets merge.

- `supabase private profile/evidence/preferences migrations`
- `frontend profile editor and userService replacement/adapter`
- `authenticated catalog/profile interfaces`
- `RLS/privacy tests`

### Design impact

M3 labeled fields and evidence editor, clear required/optional fields, no deceptive progress or invented skill claims.

Follow [design.md](../design.md). Keep current-state documentation distinct from implemented V2 changes and update approved decisions when necessary.

## 7. Acceptance Criteria

- [ ] A user can save/edit/delete their own profile and evidence; another user/anon cannot read or modify it.
- [ ] Professional and internship durations remain distinct; uncertain skills/facts are not auto-confirmed.
- [ ] Degree/batch/availability/role/location preferences are explicit and optional where appropriate; employer exclusions are user-specific.
- [ ] Profile version and provenance support later matching; browser keys cannot bypass private access.

## 8. Verification Plan

- Local two-user/anon/service-role RLS and account-deletion tests.
- Profile validation/round-trip/versioning and evidence-source tests.
- Responsive keyboard/editor/browser tests with mock private data.

Run applicable build/type/lint/tests without live side effects. UI tests use mocked auth/catalog/workflow data. Record exact commands, outputs, screenshots where useful, and known limitations here when implemented.

## 9. Out of Scope

Resume parsing/generation, OAuth tokens, inferring skills from a job description, or collecting unnecessary personal data.

## 10. Execution Log

- 2026-10-22: Ticket scope and dependencies approved; implementation not started except the documentation work in ticket 00.
- PR: not opened yet.
- Verification: pending for this ticket.
