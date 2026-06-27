# VMS NextGen Roadmap

Version: `VMS_035A.1`  
Development branch: `nextgen-ui`

## Roadmap Principles

- `main` remains the production baseline.
- NextGen work is developed and verified on `nextgen-ui`.
- Each phase has an explicit scope and exit criteria.
- Architecture and behaviour are documented before substantial implementation.
- A later phase must not be pulled into an earlier phase without a recorded decision.

## Phase 1 — Refactor

Goal: create a maintainable foundation without changing application behaviour or backend contracts.

Scope:

- Document the current architecture, workflows, dependencies, and contracts.
- Establish smoke tests for home, kiosk, authentication, every role area, and critical exports.
- Decompose the monolithic JavaScript into explicit modules in small, reviewable steps.
- Separate startup orchestration, state, services, features, and shared utilities.
- Reduce duplicated rendering, validation, modal, toast, export, and error-handling logic.
- Improve accessibility and testability only where this can be proven behaviour-preserving.
- Add static analysis, formatting, and automated tests appropriate to the no-build application or an approved future toolchain.

Constraints:

- No redesign.
- No new user-facing features.
- No database, RLS, RPC, or backend behaviour changes.
- Preserve DOM IDs, visible behaviour, roles, permissions, data formats, and exports.

Exit criteria:

- Major responsibilities have clear module ownership.
- Startup order and backend access are explicit.
- Critical workflows pass the agreed regression checklist.
- No known behavioural regression has been introduced.
- Documentation reflects the resulting module structure.

## Phase 2 — UI Modernisation

Goal: modernise the interface on top of the stable Phase 1 architecture.

Scope:

- Define a reusable design system for colour, type, spacing, components, and responsive behaviour.
- Improve navigation and information hierarchy for kiosk, Security, and Super User workflows.
- Standardise forms, tables, filters, dashboards, empty states, dialogs, and feedback.
- Improve keyboard support, focus management, contrast, touch targets, and screen-reader semantics.
- Optimise kiosk presentation and staff workflows for their target devices.
- Run usability and accessibility testing with representative users.

Exit criteria:

- Approved visual system and interaction patterns are implemented consistently.
- Core workflows remain functionally equivalent unless a change is separately approved.
- Responsive and accessibility acceptance criteria are met.
- Regression and usability testing is complete.

## Phase 3 — New Features

Goal: add prioritised operational capabilities after the architecture and interface are stable.

Candidate scope, subject to discovery and architectural approval:

- Enhanced pre-registration and host workflows.
- Improved search, saved filters, reporting, and dashboard configuration.
- Richer arrival notifications and workflow automation.
- Additional visitor categories, approval flows, and visit templates.
- Operational integrations where there is a validated business case.
- Offline-tolerant or resilience features for kiosk operation.

Exit criteria:

- Each feature has an approved problem statement, design, security review, and data impact assessment.
- Database or API changes are versioned and migration-ready.
- Permissions, auditability, privacy, accessibility, and support documentation are complete.
- Feature-level and end-to-end acceptance tests pass.

## Phase 4 — Enterprise Features

Goal: prepare the solution for controlled use across larger and more complex organisations.

Candidate scope, subject to enterprise requirements:

- Multi-site and organisational tenancy.
- Enterprise identity integration and single sign-on.
- Granular role-based access control and delegated administration.
- Central policy, branding, retention, and agreement management.
- Integration APIs, webhooks, and managed connectors.
- Advanced audit, compliance, monitoring, backup, and disaster recovery.
- Deployment environments, release promotion, observability, and service-level objectives.
- Scalability, performance, data residency, and enterprise support controls.

Exit criteria:

- Target operating model and tenancy model are approved.
- Security threat modelling and privacy impact assessment are complete.
- Reliability, recovery, performance, observability, and support targets are demonstrated.
- Enterprise deployment and migration plans are documented and tested.

## Phase Governance

Before a phase begins, agree its detailed backlog, acceptance criteria, risks, and test strategy. At phase close, update `ARCHITECTURE.md`, record material decisions in `DECISIONS.md`, and obtain approval before expanding scope.

