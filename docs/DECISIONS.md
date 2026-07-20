# VMS Architectural Decisions

Baseline: `VMS_035A.1`  
Milestone: `NextGen-002`

This file is the architectural decision log for the Visitor Management Solution. New material decisions should be appended with status, context, decision, and consequences. A superseded decision remains in the log and links to its replacement.

## ADR-001 — `main` Is Production

Status: Accepted

Decision: The `main` branch is the production baseline. Production fixes and releases must be controlled and must not receive incomplete NextGen work.

Consequences:

- Treat `main` as stable and deployable.
- Promote work to `main` only after the appropriate review and verification.
- Base regression comparisons on production behaviour from `main`.

## ADR-002 — `nextgen-ui` Is Development

Status: Accepted

Decision: The `nextgen-ui` branch is the future-development branch for NextGen architecture, UI, and feature work.

Consequences:

- Perform NextGen work on `nextgen-ui`.
- Do not use `main` as a general development branch.
- Keep changes reviewable so they can be promoted deliberately.

## ADR-003 — `VMS_035A.1` Is the NextGen Baseline

Status: Accepted

Decision: Version `VMS_035A.1` is the behavioural and architectural baseline for NextGen development.

Consequences:

- Compare foundation-refactor behaviour with `VMS_035A.1`.
- Do not treat unapproved differences from the baseline as refactor improvements.
- Record intentional post-baseline behaviour changes in a later milestone and release decision.

## ADR-004 — Refactor Before Redesign

Status: Accepted

Decision: Complete the foundation refactor before beginning UI modernisation.

Context: The current UI and behaviour are coupled to a large HTML document and a monolithic JavaScript closure. Redesigning while separating responsibilities would make regressions difficult to isolate.

Consequences:

- Phase 1 changes structure, not appearance.
- UI modernisation begins in Phase 2 after module boundaries and regression checks are established.
- Visual changes discovered during refactor are documented for later rather than bundled into structural work.

## ADR-005 — Preserve Behaviour During Refactor

Status: Accepted

Decision: Phase 1 refactoring must preserve current user-visible behaviour, permissions, data handling, backend contracts, generated outputs, and startup sequence.

Consequences:

- Move code in small increments and verify critical workflows after each change.
- Preserve DOM IDs, Supabase names and parameters, role values, messages, exports, and date/time semantics unless a separate decision approves a change.
- Treat an unapproved behaviour change as a regression even if it appears beneficial.

## ADR-006 — No Database Changes During Foundation Refactor

Status: Accepted

Decision: Phase 1 will not change database schema, data, row-level security, RPC functions, Edge Function behaviour, or other backend contracts.

Consequences:

- Front-end modules must adapt around the existing backend.
- Any required backend change is deferred to a later phase and requires its own design, migration, security review, and rollback plan.
- Refactor testing must confirm existing backend calls and permissions remain intact.

## ADR-007 — Architecture Discussion Before Implementation

Status: Accepted

Decision: Material changes to module boundaries, data flow, dependencies, security, database contracts, deployment, or major user workflows require architecture discussion before implementation.

Consequences:

- Record the agreed direction in this log when the decision is architecturally significant.
- Identify alternatives, risks, compatibility impact, and migration strategy before coding.
- Small implementation details within an accepted design do not require a separate ADR.

## NG-001 — Native JavaScript ES Modules

Status: Accepted

Decision: NextGen will use native JavaScript ES modules for all new modules.

Native ES modules are agreed as the target architecture, but activation is deferred until the app is served over HTTP instead of opened directly as a local file.

## Decision Process

Proposed decisions should include:

1. The problem and relevant constraints.
2. Viable alternatives and trade-offs.
3. The selected approach.
4. Security, privacy, data, accessibility, deployment, and rollback impact where relevant.
5. A status of Proposed, Accepted, Superseded, or Rejected.
