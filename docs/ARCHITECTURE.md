# Visitor Management Solution Architecture

Version: `VMS_035A.1`  
Development branch: `nextgen-ui`  
Production branch: `main`

## Purpose and Scope

The Visitor Management Solution is a browser-based single-page application for managing planned and walk-in visitors, kiosk sign-in and sign-out, staff administration, security operations, compliance evidence, and system governance.

The current application has no build step or front-end framework. `index.html` defines the complete user interface, `assets/css/main.css` provides all styling, and `assets/js/app.js` provides all client-side behaviour. Supabase supplies authentication, persisted data, row-level security, and server-side RPC operations. The application also uses SheetJS in the browser for Excel exports.

The current architecture is intentionally retained during Phase 1. Refactoring must preserve visible behaviour, backend contracts, access controls, and startup order.

## Current File Structure

```text
.
|-- index.html
|-- NEXTGEN_REFACTOR_NOTES.md
|-- assets/
|   |-- css/
|   |   |-- main.css
|   |   `-- README.md
|   `-- js/
|       |-- app.js
|       `-- README.md
|-- docs/
|   |-- ARCHITECTURE.md
|   |-- ROADMAP.md
|   |-- CODING_STANDARDS.md
|   `-- DECISIONS.md
`-- tools/
    `-- split-index.js
```

## Major Screens

### Home

The home screen is the application entry point. It shows branding, application version, session state, and the actions appropriate to the current mode:

- Logged-out users can open staff login or refresh.
- Configured kiosk devices can open visitor sign-in and sign-out.
- Authenticated staff can enter the staff area or log out.

The shared top bar exposes staff status, change-password, staff-area, and logout actions when applicable.

### Visitor Sign-In

The public kiosk sign-in screen lets a visitor search the current planned-visit list and start the planned sign-in workflow. It also provides the walk-in path. Sign-in is protected by kiosk-device configuration, application field rules, privacy-notice requirements, and any active agreement or induction requirements.

Supporting modals collect walk-in details, privacy acknowledgement, agreement selection, visitor signature, optional inductor sign-off, and success confirmation.

### Visitor Sign-Out

The public kiosk sign-out screen searches active visits and completes sign-out through the backend. It uses the same kiosk-token controls, busy-state protection, confirmation messaging, and idle-return behaviour as sign-in.

### Staff Area

The staff screen is the authenticated application workspace. The profile role determines which panels and actions are available. Normal users are routed directly to their permitted area; Super Users can use role views for administration and testing.

#### General User Panel

The General User panel provides:

- Planned-visit creation.
- A date-based view of the user's planned visits.
- Editing or deletion of the user's eligible visits before sign-in.

#### Security Panel

The Security panel provides operational control of the visitor estate:

- Live security dashboard and status counts.
- Pending visitor agreements and agreement evidence search.
- Visitor analytics, top companies, and peak arrival hours.
- End-of-day and overdue-visitor sign-out controls.
- Planned-visit day view with print, CSV, and Excel output.
- Advanced visit-history search and security-permitted edits.

#### Super User Workspace

The Super User workspace is divided into major navigation sections.

**Dashboard**

- System alerts and production-hardening status.
- Daily maintenance and end-of-day operations.
- System health and exportable health information.
- Planned-visit queue and advanced visit history.
- Kiosk test view.

**Reporting**

- Visitor analytics and operational reporting.
- Agreements and inductions administration.
- Agreement compliance, missing-evidence, matrix, outstanding-induction, and evidence-audit views.
- Agreement types, versions, validity settings, signatures, and evidence printing.
- Audit-event search, detail inspection, CSV export, and Excel export.

**GDPR**

- GDPR case register, filters, timeline, and case editing.
- Data-subject search across visit and planned-visit records.
- Subject Access Request package generation and export.
- Erasure/anonymisation preview and controlled execution.
- Evidence-pack generation, download, and print.

**Notifications**

- Email-recipient resolution and notification trigger settings.
- Automatic email processor controls.
- Email-delivery configuration and test sending.
- Notification centre, templates, in-app notifications, and delivery queue.

**Settings**

- Data-retention and planned-visit lifecycle governance.
- Visitor privacy-notice configuration.
- Kiosk-device registration, local token management, heartbeat/version status, and behaviour.
- Deployment and expected-version management.
- Branding, confirmation messages, form field rules, and operational rules.
- User-profile and access management.

### Cross-Cutting Modals

Modal workflows are overlays rather than independent routes, but they are major interaction surfaces. They include staff login, password change, visit editing, kiosk logout, audit details, notification-template editing, GDPR cases and anonymisation confirmation, retention confirmation, privacy notice, walk-in entry, agreement selection/signing/linking/evidence, and generic confirmation messages.

## Application Startup Flow

1. The browser parses `index.html`.
2. The Supabase JavaScript v2 and SheetJS scripts load from jsDelivr.
3. `assets/css/main.css` loads the current visual design.
4. The DOM is created, including all screens, panels, and modals.
5. `assets/js/app.js` loads and registers a `window.load` callback.
6. On window load, the callback establishes constants, in-memory caches, operational flags, and the Supabase client.
7. Default application settings are created. The script then registers DOM event listeners and sets default date inputs.
8. Settings are read from `system_settings`, merged over defaults, and applied to branding, messages, field rules, kiosk behaviour, governance, and administration controls.
9. Collapsible settings groups are initialised.
10. A Supabase authentication-state listener is registered.
11. The current session and profile are requested to determine role and home-screen access.
12. Kiosk token/version warnings and debug state are updated.
13. Core visitor data is refreshed.
14. Subsequent interaction is event-driven. UI handlers call Supabase table queries or RPCs, update local caches, render results, and display visitor confirmations, staff toasts, or local status messages.
15. Any uncaught startup error is shown in the page message and debug area and is also written to the browser console.

Startup order is a compatibility constraint. Settings, event binding, authentication, role resolution, kiosk state, and initial data loading must not be reordered without explicit design and regression testing.

## Current Dependencies

### Runtime Libraries

- `@supabase/supabase-js@2`, loaded from jsDelivr: authentication, database access, and RPC invocation.
- `xlsx@0.18.5`, loaded from jsDelivr: Excel workbook generation and download.

### Platform Dependencies

- Modern browser DOM and event APIs.
- Browser storage for the local kiosk token.
- Canvas APIs for visitor and inductor signatures.
- `fetch`, `Blob`, object URLs, popup/print windows, timers, and file downloads.
- Supabase Auth, PostgreSQL tables/views, row-level security, RPC functions, and supporting Edge Functions.

There is currently no package manifest, bundler, transpiler, component framework, client-side router, or automated front-end test runner.

### Backend Contract

Table/view names, column names, RPC names and parameters, role values, authentication behaviour, row-level security, kiosk tokens, and Edge Function contracts are external interfaces. Phase 1 must not change them.

## Current JavaScript Structure

`assets/js/app.js` is one large browser script enclosed by a `window.load` handler and a top-level `try/catch`. Most functions share closure-scoped state. The main responsibility groups are:

- Configuration, version, Supabase client creation, and runtime health timestamps.
- Shared caches, current profile, kiosk state, modal state, and workflow queues.
- System settings, branding, field rules, privacy, retention, and deployment settings.
- Utility functions for DOM access, escaping, dates, formatting, CSV/XLSX export, and printing.
- Authentication, profile loading, login-attempt handling, password changes, and logout protection.
- Screen, role-panel, and Super User section navigation.
- Planned and walk-in visitor sign-in, active-visit sign-out, kiosk idle handling, and confirmations.
- Planned-visit creation, search, editing, deletion, and day views.
- Visit-history search, permission-aware editing, and deletion.
- Security and Super User dashboards, analytics, maintenance, and health monitoring.
- Agreement/induction configuration, selection, signatures, compliance, linking, evidence, and audit.
- GDPR cases, searches, SAR packages, evidence packs, and anonymisation.
- Notifications, templates, email queue processing, and in-app alerts.
- Kiosk-device, user-profile, audit-event, and deployment administration.
- DOM event registration and startup orchestration at the end of the file.

This layout is functional but highly coupled. Shared closure variables, direct DOM lookups, inline rendering, and calls between responsibility groups make large extractions risky.

## Proposed Future Module Boundaries

The following boundaries describe the intended destination, not an instruction to perform a single large rewrite:

```text
assets/js/
|-- app.js                       # Thin composition and startup entry point
|-- config/
|   |-- constants.js
|   `-- defaults.js
|-- core/
|   |-- state.js
|   |-- dom.js
|   |-- errors.js
|   |-- events.js
|   `-- permissions.js
|-- services/
|   |-- supabase-client.js
|   |-- auth-service.js
|   |-- settings-service.js
|   |-- visitor-service.js
|   |-- agreement-service.js
|   |-- gdpr-service.js
|   |-- notification-service.js
|   `-- audit-service.js
|-- features/
|   |-- navigation/
|   |-- kiosk/
|   |-- planned-visits/
|   |-- visit-history/
|   |-- security/
|   |-- agreements/
|   |-- gdpr/
|   |-- notifications/
|   |-- governance/
|   |-- device-management/
|   `-- user-management/
`-- shared/
    |-- formatting.js
    |-- validation.js
    |-- exports.js
    |-- printing.js
    |-- toast.js
    `-- modal.js
```

Module design principles:

- Keep backend access in services and UI rendering in feature modules.
- Make shared state and dependencies explicit rather than relying on a global closure.
- Preserve existing DOM IDs and backend contracts during Phase 1.
- Extract pure utilities first, then low-coupling services, then feature workflows.
- Keep `app.js` responsible for composition and startup sequence only.
- Introduce automated checks around a behaviour before moving high-risk code.

## Architectural Risks and Constraints

- DOM IDs are an active API between HTML and JavaScript.
- Shared state and startup timing can produce subtle regressions.
- Role permissions must be enforced by the backend as well as hidden in the UI.
- Kiosk flows depend on local token state, privacy rules, agreements, timers, and modal sequencing.
- Generated CSV, Excel, print, SAR, and evidence outputs are user-facing contracts.
- Date/time comparison and formatting must retain their current timezone semantics.
- Phase 1 permits structural improvement only; visual redesign, feature work, and database change belong to later approved phases.

