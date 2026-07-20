# Remaining `app.js` Responsibility Map

Milestone: `NextGen-026`  
Reviewed: `assets/js/app.js` and the current native ES module graph

## Current Position

`assets/js/app.js` currently contains approximately:

- 4,733 lines.
- 219 named function declarations, including nested helpers.
- 56 direct Supabase RPC calls.
- 2 direct Supabase table-query entry points.
- 256 `addEventListener` registrations.

These figures are source-text counts intended to show scale, not formal complexity metrics. The file is now the composition root for the extracted modules, but it still owns several large feature implementations.

## Responsibilities That Should Remain in `app.js`

| Responsibility | Examples | Why it remains |
|---|---|---|
| Module composition | `configureKiosk`, `configureSettings`, `configureAudit`, `configureMessages`, `configurePrinting`, `configureNavigation`, `configureVisitorFlow`, `configureHistory`, `configurePlannedVisits`, `configureAuth` | The entry point should assemble modules and provide the few callbacks that genuinely cross feature boundaries. |
| Startup sequence | Default settings creation, initial settings load, authentication listener registration, profile resolution, kiosk warning update and initial core-data refresh | Startup order is a compatibility constraint documented in `ARCHITECTURE.md`. |
| Event binding | Button, input, modal, keyboard, signature-canvas and navigation listeners | Central event binding keeps HTML free of inline handlers and makes the application wiring visible in one place. It may later be grouped into small binding functions without moving feature behavior back into the entry point. |
| Top-level error boundary | The `window.load` `try/catch`, page error message and debug output | This is the final application-level failure boundary. |
| Small cross-feature orchestration | Calls that deliberately coordinate two or more feature modules | These should remain small and contain no query, rendering or business-rule implementation. |

## Remaining Feature Groups

| Group | Representative functions/state | Why it remains in `app.js` | Proposed owner |
|---|---|---|---|
| Settings-group orchestration | `settingGroups`, `saveSettingsGroup`, `resetSettingsGroup`, kiosk/field-rule save wrappers | The registry currently spans branding, kiosk, agreements, retention, privacy, deployment, email and notifications. Moving it before those feature APIs are stable would preserve a large cross-feature service-locator object inside `settings.js`. | Extend `settings.js` after each feature exposes explicit setting descriptors or save hooks. |
| Kiosk session and protected logout | `kioskScreenInfo`, `sendKioskHeartbeat`, `startKioskHeartbeat`, `stopKioskHeartbeat`, `verifyKioskTokenOrLogout`, kiosk logout modal promise and `requestProtectedLogout`; heartbeat timestamps/timer | This code crosses kiosk token state, Supabase Auth, top-bar state, navigation, audit and health reporting. A direct `kiosk.js`/`auth.js` import in both directions would risk a cycle. | New `kioskSession.js`, or a carefully bounded extension of `kiosk.js` with injected auth/navigation callbacks. |
| Staff/SuperUser navigation and layout orchestration | `ensureSuperReportingCards`, `simplifyPlannedQueueFilters`, `moveGdprWorkspaceParts`, `showGdprStep`, `showSuperSection`, kiosk-test open/exit functions and `setRole` | Role changes trigger dashboard, history, planned-visit, agreement, notification and settings loads. Moving these functions now would make `navigation.js` import most feature modules and could recreate the `auth`/`navigation` cycle identified in `DEPENDENCY_MAP.md`. | Extend `navigation.js` only after remaining features have small, acyclic public load APIs. |
| Agreement administration | Agreement setting synchronization; type/version load, render, edit, save, activation and deletion | No agreement module exists yet. The functions share agreement caches and backend contracts and are too cohesive to scatter across generic modules. | New `agreementAdmin.js`. |
| Agreement visitor workflow | Requirement/status lookup, pending lists, selection queue, sign modal, signature canvases, inductor sign-off and agreement saving | This flow is coupled to visitor arrival, privacy acceptance, kiosk confirmation and post-sign-in orchestration. Moving isolated functions would replace closure coupling with callback coupling. | New `agreementFlow.js`. |
| Agreement compliance, search and evidence | Agreement searches, identity linking/consolidation, compliance summary/matrix, missing agreements, outstanding inductions, evidence audit, evidence printing and export-row builders | These functions share agreement caches, identity state, modal state and exports. They should be extracted after agreement administration and signing establish stable APIs. | New `agreementCompliance.js`, with shared agreement queries optionally placed in `agreementApi.js`. |
| Walk-in modal and privacy orchestration | `openWalkInModal`, `clearWalkInForm`, `closeWalkInModal`, privacy configuration/display/validation and acknowledgement modal functions | The public visitor module owns sign-in execution, but these functions still coordinate settings, DOM state and agreement workflow continuation. Moving them before agreement extraction risks a `visitorFlow.js`/agreement-module cycle. | Extend `visitorFlow.js` after `agreementFlow.js` exposes callback-safe entry points. |
| Daily maintenance and planned lifecycle | Role eligibility, maintenance status, setting persistence, due-check, manual run, lifecycle preview/run/render | This combines settings, audit, current role, planned-visit cleanup and startup/login opportunistic execution. It is governance behavior rather than generic settings behavior. | New `governance.js` or `maintenance.js`. |
| GDPR cases, SAR, evidence and anonymisation | GDPR workspace navigation, case CRUD/list/timeline, search/filtering, SAR HTML/JSON/print, evidence packs, anonymisation preview/confirmation and related modal state | This is a large feature with shared case/search caches and sensitive payload/confirmation behavior. A partial move would be harder to validate than bounded sub-extractions. | Start with `gdprCases.js`, followed by `gdprExports.js` and `gdprAnonymisation.js`; use `gdpr.js` only as a thin facade if needed. |
| Retention and privacy administration | Recommended defaults, privacy-setting wrappers, retention confirmation, save/reset, preview and run | These functions use the cross-feature setting registry and GDPR governance controls. They should move with maintenance/GDPR boundaries rather than enlarge generic `settings.js`. | `governance.js` or a focused `retention.js`; privacy display behavior remains with `visitorFlow.js`. |
| Notifications and email delivery | Processor settings/run, trigger settings/run, Edge Function call, test/pending email, arrival notification, dashboard/templates/placeholders, queue actions, in-app notifications and refresh orchestration | The arrival path is called from `visitorFlow.js`, while notification refresh and templates are SuperUser UI concerns. Direct mutual imports would create a visitor/notification cycle. | New `notifications.js`; optionally separate low-level delivery into `emailDelivery.js`. |
| Deployment and system health | Version setting helpers, device-version rendering, health collection, diagnostics export and cached health timestamps | Health reads settings, auth, kiosk, devices, caches and browser audit context. It should consume narrow read-only getters rather than importing every feature. | New `systemHealth.js`; deployment settings may remain in `settings.js` or use `deployment.js`. |
| End-of-day operations | Opportunistic and manual auto-sign-out functions | These functions coordinate settings, audit, visitor refresh and staff-panel reloads. They do not belong solely to history or analytics. | New `operations.js`, or `governance.js` if maintenance operations are kept together. |

## Recommended Extraction Order

1. **Settings-group boundary cleanup**
   - Move only the generic group save/reset engine into `settings.js`.
   - Supply feature-owned descriptors explicitly.
   - Remove duplicated kiosk/field-rule wrapper functions from `app.js`.

2. **Kiosk session lifecycle**
   - Extract heartbeat state, token verification and protected logout.
   - Expose read-only heartbeat status for system health.
   - Keep `auth.js` unaware of kiosk implementation details by injecting narrow callbacks from `app.js`.

3. **Agreement administration**
   - Extract types, versions and agreement-specific settings first.
   - Keep visitor signing, compliance and identity correction out of this first step.

4. **Agreement visitor workflow**
   - Extract requirement lookup, pending queues, signature handling and agreement saving.
   - Define an explicit completion callback used by visitor sign-in rather than importing `visitorFlow.js`.

5. **Agreement compliance and evidence**
   - Extract search, matrices, identity correction, inductions, evidence rendering/printing and agreement export-row builders.

6. **Complete public visitor/privacy extraction**
   - Move walk-in modal and privacy acknowledgement orchestration into `visitorFlow.js`.
   - Consume the agreement workflow through a configured callback or an application event.

7. **Governance and operational maintenance**
   - Extract daily maintenance, planned lifecycle cleanup, retention and end-of-day auto-sign-out in bounded stages.

8. **GDPR feature**
   - Extract case management first, generated SAR/evidence outputs second and anonymisation last.
   - Keep destructive confirmation and audit behavior unchanged.

9. **Notifications and email**
   - Extract delivery helper and queue/template UI.
   - Provide visitor-arrival notification as an injected service callback to avoid a cycle.

10. **System health and deployment**
    - Extract health collection only after kiosk, governance and notification modules expose read-only status APIs.

11. **Complete navigation extraction**
    - Move `setRole`, `showSuperSection` and kiosk-test navigation after every target section has an acyclic public load function.

12. **Final composition cleanup**
    - Leave imports, configuration, event binding, startup, initial data loading and the top-level error boundary in `app.js`.
    - Group event binding by feature only if this remains behavior-neutral.

## Dependency and Circular-Import Risks

1. **Authentication and navigation**
   - `auth.js` already imports `navigation.js`.
   - `navigation.js` must not import `auth.js`; role/profile checks should remain injected or use `AppState` where appropriate.

2. **Visitor and agreement workflows**
   - Visitor sign-in can launch agreement signing, and agreement completion can resume visitor processing.
   - Neither module should statically import the other. Use a completion callback, event, or a neutral orchestration interface configured by `app.js`.

3. **Visitor and notifications**
   - Visitor arrival queues notifications, but notification UI may refresh visitor-related information.
   - Pass an arrival-notification service into `visitorFlow.js`; do not import `visitorFlow.js` from notifications.

4. **Kiosk, authentication and navigation**
   - Kiosk verification affects the authenticated profile and screen state.
   - Keep Auth session mutation in `auth.js` or inject narrowly named auth operations into kiosk session code.

5. **Settings and feature modules**
   - A single settings registry currently knows about every feature.
   - Prefer feature-owned setting descriptors consumed by `settings.js`; do not make `settings.js` import agreements, GDPR and notifications.

6. **System health dependency fan-out**
   - Health reporting reads many feature states.
   - Use read-only status functions or plain snapshots. `systemHealth.js` must not become a reverse dependency imported by feature modules.

7. **Shared mutable state**
   - Moving closure caches wholesale into `AppState` would avoid import cycles but create hidden coupling.
   - Prefer private module state and narrow getters; use `AppState` only for genuinely shared runtime state.

8. **Configuration-before-use**
   - Several modules depend on `configure...` calls.
   - Each extraction must document required configuration and keep it before event binding, authentication resolution and initial data loads.

9. **Shared modules must remain downstream-only**
   - Feature modules may import `api.js`, `state.js`, `dom.js`, `messages.js`, `utils.js`, `audit.js`, `exports.js` and `printing.js`.
   - Shared/foundation modules must not import feature modules.

## Suggested Test Checklists

### Settings-group extraction

- Save and reset every group: kiosk behavior, messages, branding, field rules and operational rules.
- Verify exact setting keys, values, descriptions and audit event names.
- Confirm branding, placeholders, required fields and kiosk timeout update immediately as before.
- Exercise agreement, retention, privacy, deployment, email and notification setting wrappers after their descriptors move.

### Kiosk session extraction

- Kiosk login with valid, missing, invalid and disabled tokens.
- Heartbeat on login and timer, preserving every RPC payload field.
- Remote force logout clears the local token, session/profile and returns home.
- Protected logout succeeds with the correct password and rejects incorrect/blank passwords.
- Heartbeat timer starts once, stops on logout and exposes unchanged health timestamps.

### Agreement administration extraction

- Load, create, edit, activate and delete agreement types and versions.
- Verify all version/type selectors refresh identically.
- Save and reset agreement settings.
- Confirm exact RPC names, payloads, messages, role restrictions and audit events.

### Agreement visitor workflow extraction

- Planned and walk-in visitors with no agreements, one agreement and multiple agreements.
- Required versus optional selection and additional-agreement signing.
- Mouse and touch signatures, clearing canvases and resize behavior.
- Typed-name/signature inductor modes and required validation.
- Successful save, RPC error and queue continuation without duplicate sign-in.

### Agreement compliance/evidence extraction

- Security and SuperUser searches with every filter.
- Compliance summary, missing list, matrix, current-only filter and text filter.
- Identity detail tabs, correction, linking and consolidation confirmations.
- Outstanding inductions and evidence audit.
- CSV/Excel columns, filenames and evidence print text/layout.

### Visitor/privacy completion

- Planned and walk-in flows with privacy disabled, optional and required.
- Modal and embedded privacy display modes.
- Privacy version and acceptance timestamp persistence.
- Walk-in validation, duplicate active visitor detection and planned-visitor collision handling.
- Agreement-required flows resume exactly once after acknowledgement/signing.

### Governance, maintenance and retention

- Role-based opportunistic maintenance for Security and SuperUser.
- Once-per-session and once-per-local-date behavior.
- Manual maintenance and planned-lifecycle preview/run.
- Retention recommended defaults, save/reset, preview and typed confirmation.
- Exact RPC payloads, record counts, audit names and post-run refreshes.

### GDPR extraction

- Create/edit/filter cases and load timelines.
- Data-subject search with each criterion and empty-criteria validation.
- SAR HTML, JSON and print contents/filenames.
- Evidence generation, download and print.
- Anonymisation preview, typed confirmation, success/error paths and audit details.
- Verify no sensitive records are rendered or exported differently.

### Notifications and email extraction

- Save processor, trigger and delivery settings.
- Run trigger check and processor manually.
- Send test and pending emails through the unchanged Edge Function payload.
- Template create/edit, placeholder insertion and focus behavior.
- Queue load/retry/cancel actions and button reset behavior.
- In-app notification load and acknowledge-all.
- Visitor arrival notification queues and immediate-send mode.

### System health, deployment and operations

- Current/expected version save and device-version warnings.
- Database, Auth, kiosk-token and browser-context health states.
- Latest saved kiosk heartbeat/device values.
- Diagnostics JSON filename and content.
- Opportunistic and manual auto-sign-out, including zero and multiple updated records.
- Exact audit events and core/staff-panel refresh behavior.

### Navigation and final composition

- General, Security, SuperUser and kiosk profiles open only permitted panels.
- Every SuperUser section loads its expected data once.
- Kiosk test entry/exit preserves role and home access behavior.
- Logout, password change, modal keyboard handling and back-home controls.
- Startup order: settings, event binding, auth listener/profile, kiosk warning and core refresh.
- Full syntax/module-graph check and local HTTP smoke test with no circular imports.
