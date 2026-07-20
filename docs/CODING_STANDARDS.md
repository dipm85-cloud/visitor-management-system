# VMS Coding Standards

Baseline: `VMS_035A.1`  
Milestone: `NextGen-002`

These standards apply to future work on the Visitor Management Solution. During Phase 1, preservation of current behaviour and backend contracts takes precedence over stylistic cleanup.

## JavaScript

- Use modern, browser-supported JavaScript and strict, consistent formatting.
- Prefer `const`; use `let` only when reassignment is required. Do not introduce `var`.
- Keep functions focused on one responsibility and make dependencies explicit.
- Prefer `async`/`await` for asynchronous flows and handle every expected failure.
- Separate backend access, state changes, validation, and DOM rendering.
- Avoid new global variables and implicit shared state.
- Use strict equality (`===` and `!==`).
- Validate and normalise data at system boundaries.
- Escape untrusted values before inserting HTML. Prefer safe DOM APIs for user-controlled content.
- Do not expose secrets in client code. A public Supabase anon key is not a substitute for RLS.
- Keep table, column, RPC, and parameter names centralised when module extraction permits it.
- Preserve access control in Supabase/RPC policy; UI visibility is not security enforcement.

## HTML

- Use semantic elements and a logical heading hierarchy.
- Give form controls explicit labels and appropriate input types.
- Use buttons for actions and links for navigation.
- Preserve stable element IDs that JavaScript depends on until a planned migration is approved.
- Include accessible names, modal semantics, focus behaviour, and meaningful alternative text.
- Avoid inline styles and inline event handlers in new markup.
- Keep source order usable for keyboard and assistive-technology users.
- Use `data-*` attributes for declarative UI metadata rather than encoding behaviour in class names.

## CSS

- Reuse design tokens through CSS custom properties.
- Use classes for styling; do not style against IDs except for documented compatibility needs.
- Keep selectors shallow and avoid `!important` unless a documented exception is required.
- Organise styles by foundation, layout, components, features, utilities, and responsive rules.
- Use mobile-first responsive rules and support kiosk touch targets.
- Provide visible focus states and respect reduced-motion preferences.
- Do not rely on colour alone to convey status.
- Remove a rule only after confirming it is unused across all screens and generated content.

## Naming

- Use `camelCase` for variables and functions.
- Use `PascalCase` for classes or constructor-like types if introduced.
- Use `UPPER_SNAKE_CASE` for true constants.
- Use kebab-case for filenames, CSS classes, and custom events.
- Use descriptive names based on business purpose; avoid unexplained abbreviations.
- Prefix boolean values and functions with words such as `is`, `has`, `can`, or `should`.
- Name event handlers for the event or intent, and service functions for the operation they perform.
- Preserve existing backend and DOM names during behaviour-preserving refactors.

## Comments

- Explain intent, constraints, non-obvious business rules, and compatibility decisions.
- Do not narrate code that is already self-explanatory.
- Document why a workaround exists and what would allow its removal.
- Keep comments current in the same change as the code.
- Use `TODO` only with a concrete follow-up description and, where available, an issue reference.
- Document public module responsibilities and important input/output contracts.

## File Structure

- Keep application code under `assets/js` and `assets/css` until a different build structure is approved.
- Keep the application entry point thin; it should compose modules and control startup.
- Group JavaScript into `config`, `core`, `services`, `features`, and `shared` responsibilities as described in `ARCHITECTURE.md`.
- Keep feature-specific rendering and interaction together; keep reusable utilities free of feature state.
- Store architecture and engineering governance in `docs`.
- Store one-off development helpers in `tools`, not in runtime paths.
- Do not create generic dumping grounds such as `misc.js` or an unbounded `utils.js`.
- Avoid cyclic module dependencies.

## Error Handling

- Catch errors at the layer that can add context or recover; do not silently swallow them.
- Distinguish validation, authentication, permission, network, backend, and unexpected failures.
- Show users an actionable, non-technical message and log sufficient diagnostic context for developers.
- Do not expose tokens, credentials, personal data, signatures, or raw sensitive backend errors.
- Restore disabled controls and busy states in `finally` blocks where appropriate.
- Treat best-effort secondary actions explicitly so they do not hide failure of the primary action.
- Use a top-level startup error boundary, but handle expected errors closer to their source.
- Audit security-, privacy-, retention-, and administration-sensitive actions where supported.

## Toast Messages

- Use toasts for brief staff feedback that does not require a decision.
- Use the centred kiosk confirmation flow for visitor completion messages.
- Use inline validation next to the affected workflow for errors the user must correct.
- Use a confirmation modal for destructive or high-impact actions.
- Keep messages concise and specific: state what succeeded, failed, or must happen next.
- Use consistent types: `success`, `info`, `warning`, and `error`.
- Do not show raw exception text, database details, or sensitive data in a toast.
- Do not stack duplicate messages. Important errors must remain visible long enough to read.
- Toast creation and timing should be centralised in a shared module when refactoring permits.

## Versioning

- The application version uses the established form `VMS_035A.1`.
- The version displayed in the UI, the JavaScript application constant, deployment settings, and release documentation must agree.
- Change a version only as part of an intentional release decision, not incidental refactoring.
- Record user-visible changes and operational migration notes for each release.
- Tag production releases in source control using the exact approved application version.
- `main` represents production; `nextgen-ui` is the future-development branch.
- Use small, focused commits with messages that describe intent.
- Breaking backend or integration changes require explicit versioning, migration, rollback, and compatibility plans.

## Review Standard

Every change should be reviewable for behaviour, security, privacy, accessibility, maintainability, and operational impact. During Phase 1, reviewers must be able to verify that changes are structural only and that no database or visible behaviour change has been introduced.
