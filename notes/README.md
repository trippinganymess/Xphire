# Xphire V2 ticket roadmap

Approved: 2026-10-22. Goal: a **verified fresher shortlist**, with **Material Design 3** as the approved V2 UI target.

[Design baseline and target contract](../design.md) is the shared reference. Current sketch UI stays unchanged by this planning PR. These are implementation tickets with optional concept/learning sections, not completed features.

## Execution rules

1. Work one ticket at a time; check actual merged dependency outcomes, not just note status.
2. Create `V2/<NN>-<ticket-name>` when starting, from updated `main` after blockers merge. Do not create all future branches from the original snapshot.
3. Only `V2/00-design-baseline` exists at publication. The branch column below records future branch names, **not** created remote branches.
4. Keep each ticket vertically testable: motivation → relevant facts/derivation → smallest complete implementation → acceptance verification.
5. Base tickets have no blockers (`blocked_by: []`); dependent tickets are blocked until every listed dependency is implemented and merged. Numbering is a suggested sequence, not an extra dependency edge.
6. Verify with offline fixtures/mocks; never let test scripts create real accounts, call paid models, scrape live ATS boards, dispatch workflows, or send mail.
7. Update design.md and the active note as decisions ship; mark PR-open work `in_review`, merged verified work `done`, and newly unblocked work `ready`. Learning/quiz checkboxes are independent.
8. Stage only ticket changes. Existing untracked local files (`.codex`, `.pi`, `.wrangler`, `APPLICATION_PIPELINE_PLAN.md`) are not included in the documentation PR.
9. No direct commits/pushes to main; open a PR for each ticket. Do not merge or deploy automatically.

## Ticket index and dependencies

| Ticket | Priority | Blocked by | Initial status | Branch when started |
|---|---|---|---|---|
| [00 — Design baseline and V2 roadmap](00-design-baseline.md) | P0 | None | in review | `V2/00-design-baseline` |
| [01 — Reproducible quality and regression foundation](01-quality-foundation.md) | P0 | None | in review | `V2/01-quality-foundation` |
| [02 — Authenticated, bounded workflow dispatch](02-secure-dispatch.md) | P0 | [01](01-quality-foundation.md) | blocked | `V2/02-secure-dispatch` |
| [03 — Material Design 3 tokens and accessible primitives](03-m3-design-system.md) | P1 | None | ready | `V2/03-m3-design-system` |
| [04 — M3 shared shell and responsive board](04-m3-shell-and-board.md) | P1 | [03](03-m3-design-system.md) | blocked | `V2/04-m3-shell-and-board` |
| [05 — Accessible account, search, and settings forms](05-account-and-search-forms.md) | P1 | [02](02-secure-dispatch.md), [04](04-m3-shell-and-board.md) | blocked | `V2/05-account-and-search-forms` |
| [06 — Migrated, normalized job catalog and provenance](06-normalized-job-catalog.md) | P1 | [01](01-quality-foundation.md) | blocked | `V2/06-normalized-job-catalog` |
| [07 — Full JD ingestion and efficient resilient connectors](07-evidence-ingestion.md) | P1 | [06](06-normalized-job-catalog.md) | blocked | `V2/07-evidence-ingestion` |
| [08 — Evidence-based fresher eligibility](08-fresher-eligibility.md) | P0 | [07](07-evidence-ingestion.md) | blocked | `V2/08-fresher-eligibility` |
| [09 — Role families and country-scoped location eligibility](09-role-and-location-eligibility.md) | P1 | [07](07-evidence-ingestion.md) | blocked | `V2/09-role-and-location-eligibility` |
| [10 — Verified open-job lifecycle and truthful timestamps](10-open-job-lifecycle.md) | P1 | [07](07-evidence-ingestion.md) | blocked | `V2/10-open-job-lifecycle` |
| [11 — Candidate-controlled employer preferences and factual risks](11-employer-policy.md) | P1 | [06](06-normalized-job-catalog.md) | blocked | `V2/11-employer-policy` |
| [12 — Consistent server-filtered and paginated discovery](12-server-side-discovery.md) | P1 | [04](04-m3-shell-and-board.md), [08](08-fresher-eligibility.md), [09](09-role-and-location-eligibility.md), [10](10-open-job-lifecycle.md), [11](11-employer-policy.md) | blocked | `V2/12-server-side-discovery` |
| [13 — Private evidence-backed candidate profile and preferences](13-private-candidate-profile.md) | P1 | [05](05-account-and-search-forms.md), [06](06-normalized-job-catalog.md) | blocked | `V2/13-private-candidate-profile` |
| [14 — Hard-filtered, explainable candidate matching](14-explainable-matching.md) | P1 | [08](08-fresher-eligibility.md), [09](09-role-and-location-eligibility.md), [10](10-open-job-lifecycle.md), [11](11-employer-policy.md), [13](13-private-candidate-profile.md) | blocked | `V2/14-explainable-matching` |
| [15 — Job details with eligibility and fit explanations](15-job-details-and-evidence.md) | P1 | [12](12-server-side-discovery.md), [14](14-explainable-matching.md) | blocked | `V2/15-job-details-and-evidence` |
| [16 — Private saved jobs, dismissals, and relevance feedback](16-personal-shortlist.md) | P2 | [13](13-private-candidate-profile.md), [15](15-job-details-and-evidence.md) | blocked | `V2/16-personal-shortlist` |
| [17 — Manual-confirmation application tracker](17-application-tracker.md) | P2 | [16](16-personal-shortlist.md) | blocked | `V2/17-application-tracker` |
| [18 — Durable request and worker run status](18-real-run-status.md) | P1 | [02](02-secure-dispatch.md), [06](06-normalized-job-catalog.md) | blocked | `V2/18-real-run-status` |
| [19 — Explicit alert cadence, timezone, and due scheduling](19-alert-cadence.md) | P1 | [05](05-account-and-search-forms.md), [18](18-real-run-status.md) | blocked | `V2/19-alert-cadence` |
| [20 — Reliable personal digests, delivery ledger, and reminders](20-reliable-digests-and-reminders.md) | P2 | [10](10-open-job-lifecycle.md), [14](14-explainable-matching.md), [16](16-personal-shortlist.md), [19](19-alert-cadence.md) | blocked | `V2/20-reliable-digests-and-reminders` |
| [21 — M3-aligned safe email digests](21-m3-email-design.md) | P2 | [03](03-m3-design-system.md), [20](20-reliable-digests-and-reminders.md) | blocked | `V2/21-m3-email-design` |
| [22 — Measured fresher-discovery and delivery quality](22-quality-evaluation.md) | P2 | [14](14-explainable-matching.md), [20](20-reliable-digests-and-reminders.md) | blocked | `V2/22-quality-evaluation` |

## Starting frontier

- **00 — Design baseline:** verified documentation; [PR #29](https://github.com/trippinganymess/Xphire/pull/29) open for review, not merged; no runtime changes.
- **01 — Quality foundation:** locally verified; [PR #30](https://github.com/trippinganymess/Xphire/pull/30) open for review on `V2/01-quality-foundation`; [verification and reviewed limitations](01-quality-foundation.md#10-execution-log). Does not unblock downstream tickets until merged.
- **03 — M3 design system:** ready independently; may start after 00 merges when chosen.
- Secure dispatch is the first product/security fix after quality setup. Numbering does not require delaying security for a complete visual migration.

## Release slices

- **Foundation:** 00–07 establish documentation, reproducible checks, secure requests, M3 foundations, normalized catalog, and full evidence.
- **Trustworthy discovery:** 08–12 correct eligibility, role/location, lifecycle, employer policy, and pagination/error behavior.
- **Personal decisions:** 13–17 add private candidate evidence, transparent matches, details, shortlist, and manual application tracking.
- **Reliable feedback/delivery:** 18–21 replace simulated status, define cadence, prevent repeated digests, add factual reminders, and align email with M3.
- **Release evidence:** 22 evaluates accuracy and operational quality. Add regression fixtures during all preceding tickets, not only at the end.

## Review recommendation coverage

| Review recommendation | Ticket(s) |
|---|---|
| Authenticated dispatch, recipient ownership, limits, duplicate requests | 02, 18 |
| Numeric/evidence-based experience parsing; shared board/digest classification | 08 |
| Full JD retention, no title-only gate, source values preserved under AI failure | 06, 07, 08 |
| Role families, country/remote eligibility, unknown handling | 09, 13, 14 |
| Separate posting/discovery/verification dates; refresh and suppress closed/stale jobs | 10, 12, 15 |
| Opt-in employer exclusions; factual risks versus prestige; fit-based ranking | 11, 13, 14 |
| Fresher profile: degree/batch, supported skills, experience, availability/preferences | 13, 14 |
| Evidence-first details, missing versus unknown requirements, safe apply links | 15 |
| Save/dismiss/feedback and application/deadline tracking | 16, 17, 20 |
| Server filters before limit, pagination, source/eligibility controls, honest errors | 12 |
| Real run progress, missing SMTP/failure/no-match behavior, no fake completion | 18, 20 |
| Correct daily versus six-hour cadence, timezone/due scheduling, dedup alerts | 19, 20 |
| One ATS sweep, connector isolation/health, truthful source-count claims | 07, 22 |
| Reproducible test setup, current UI test repair, lint/dependency review and CI | 01, all implementation tickets |
| Manually labeled JDs and metrics for precision/missed roles/dead links/duplicates | 22 |
| Approved M3 redesign and responsive/accessibility/token consistency | 03, 04, 05, 15, 16, 17, 21 |
| Private records, RLS, account deletion, no public candidate/application leaks | 02, 13, 14, 16, 17, 18, 20 |

## Deferred beyond this verified-shortlist release

Resume generation/LaTeX artifacts, automated ATS submission, Gmail/IMAP outcomes, GitHub gap tasks, and a new queue vendor are not approved V2 implementation scope here. The separate application-pipeline proposal can inform a later release after profile evidence, privacy, verified jobs, and manual tracking work. No CAPTCHA bypass or fabricated candidate claims.

## Working notes

To study a ticket, the user may enable live mirroring, for example:

```text
/md-log notes/01-quality-foundation.md
```

Writing that command in a note does not activate a pi extension. No learning session or quizzes have been performed by this planning ticket.
