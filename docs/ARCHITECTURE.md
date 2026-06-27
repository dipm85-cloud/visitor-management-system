# Visitor Management Solution Architecture

This document maps the current `nextgen-ui` application before further refactoring. It is descriptive only: no application code, DOM IDs, Supabase names, UI behaviour, or visible design should be changed as part of this documentation step.

## 1. Current File Structure

```text
.
+-- index.html
+-- NEXTGEN_REFACTOR_NOTES.md
+-- assets/
|   +-- css/
|   |   +-- main.css
|   |   +-- README.md
|   +-- js/
|       +-- app.js
|       +-- README.md
+-- docs/
|   +-- ARCHITECTURE.md
+-- tools/
    +-- split-index.js
```

Key files:

- `index.html` is the single page application shell. It contains all current DOM structure, screen containers, forms, modals, buttons, and third-party script includes for Supabase and XLSX.
- `assets/css/main.css` contains the extracted application styles from the earlier mechanical split.
- `assets/js/app.js` contains the extracted application behaviour from the earlier mechanical split. It is still a single monolithic browser script.
- `tools/split-index.js` is the helper used for the initial mechanical extraction.
- `NEXTGEN_REFACTOR_NOTES.md` records the branch rules and refactor guardrails.

## 2. Main Runtime Flow

The application runs as a browser-only single page app.

1. `index.html` loads Supabase JS, XLSX, `assets/css/main.css`, and finally `assets/js/app.js`.
2. `assets/js/app.js` waits for `window.load` before running any app logic.
3. Inside the load handler, the script creates a Supabase client with the configured URL and anon key.
4. Shared state and caches are initialised in local variables inside the load handler.
5. System settings are loaded from `system_settings`, merged with hard-coded defaults, and applied to branding, colours, messages, kiosk timing, and settings forms.
6. Event listeners are attached to the existing DOM IDs from `index.html`.
7. Date fields are initialised to today's date where applicable.
8. Supabase auth state changes call `getCurrentSessionAndProfile()`.
9. Initial startup calls check the current session/profile, update kiosk token warnings, set debug text, and load core visitor data.
10. User interactions then drive screen switching, kiosk sign-in/sign-out, staff login, role panels, planned visits, history, analytics, settings, kiosk devices, audit events, printing, and exports.

The most important implementation detail is that nearly all functions close over shared variables from the single load-handler scope. This makes the current file easy to run as one bundle, but it means module extraction must preserve shared state and call order carefully.

## 3. Main `app.js` Sections

`assets/js/app.js` already contains a high-level section map at the top. The current runtime code broadly follows these responsibilities:

- Configuration and Supabase client: Supabase URL/key constants and `window.supabase.createClient(...)`.
- Application state and caches: planned visits, visit logs, role-specific result caches, audit event cache, current profile, kiosk idle state, and opportunistic auto sign-out flag.
- System settings and branding: default settings, loading/saving settings, applying CSS variables/assets, settings form population, and reset behaviour.
- User/profile management: Super User profile CRUD-style actions through RPCs, failed-attempt reset, activation/deactivation, and profile list rendering.
- Kiosk device management: local kiosk token storage, token prompts, kiosk token warnings, device listing, creation, token regeneration, status changes, and token masking/copying.
- Audit events: writing audit events, loading audit logs, rendering results, and normalising audit rows for export.
- Messages and kiosk confirmation UI: main message banner, toast messages, kiosk confirmation modal, auto-close timer, and modal close helpers.
- Utility helpers: DOM lookup, date formatting, escaping, CSV escaping/export, result summary rendering, name/plate normalisation, and Excel export helpers.
- Staff authentication: login/logout, session/profile loading, topbar status, failed/successful login tracking, password changes, and staff area entry.
- Screen navigation and role panels: home/sign-in/sign-out/staff screen switching, role tab selection, panel loading, and permission-based role availability.
- Visitor sign-in/sign-out: planned visitor list loading/rendering, planned kiosk sign-in, walk-in sign-in, active visit loading, and kiosk sign-out.
- Planned visit management: planned visit creation, planned visit search, status mapping, rendering, editing, and deletion.
- History search and editing: visit log searching/filtering, rendering, editing, and deletion.
- Analytics and dashboards: visitor analytics RPC, metric rendering, security dashboard, super dashboard, overdue visitor alerts, and auto sign-out workflows.
- Printing and exports: compact planned list print HTML, print window handling, CSV downloads, and XLSX exports.
- Event binding and startup: all DOM event listener registration, default date setup, settings load, auth subscription, profile/session check, kiosk warnings, debug status, and initial core data refresh.

Current Supabase surfaces referenced by `app.js` include:

- Tables: `system_settings`, `profiles`, `planned_visits`, `visit_log`.
- RPCs: `superuser_save_setting`, `superuser_upsert_profile`, `superuser_list_profiles`, `superuser_reset_failed_login_attempts`, `superuser_set_profile_active`, `superuser_list_kiosk_devices`, `superuser_create_kiosk_device`, `superuser_regenerate_kiosk_token`, `superuser_set_kiosk_status`, `write_audit_event`, `superuser_list_audit_events`, `superuser_reset_default_settings`, `record_failed_login_attempt`, `record_successful_login`, `kiosk_sign_in_planned`, `kiosk_sign_in_walk_in`, `kiosk_sign_out`, `update_planned_security_pass`, `update_visit_log_security_pass`, `get_visitor_analytics`, `run_end_of_day_auto_sign_out`.

Do not rename or reinterpret any of these during refactor work.

## 4. Proposed Future JS Modules

These are proposed extraction boundaries only. They should be introduced gradually, with behaviour checks after each small move.

```text
assets/js/
+-- app.js                  # Thin startup/orchestration entrypoint
+-- config.js               # Supabase URL/key and stable constants
+-- state.js                # Shared caches/current profile/kiosk timer state
+-- dom.js                  # DOM lookup helpers and DOM ID constants if introduced safely
+-- settings.js             # System settings, branding, settings forms
+-- auth.js                 # Staff auth, session/profile loading, password changes
+-- navigation.js           # Screen switching and role panels
+-- kiosk.js                # Kiosk token storage, warnings, idle timer, confirmation modal
+-- visitors.js             # Public planned/walk-in sign-in and sign-out flows
+-- planned-visits.js       # Staff planned visit creation/search/render/edit/delete
+-- history.js              # Visit history search/render/edit/delete
+-- analytics.js            # Analytics RPC and dashboard rendering
+-- audit.js                # Audit writes, audit search, audit export normalisation
+-- kiosk-devices.js        # Super User kiosk device management
+-- profiles.js             # Super User profile management
+-- exports.js              # CSV, XLSX, print helpers
+-- utils.js                # Escaping, dates, formatting, result summaries
```

Safer first extractions:

- Pure helpers such as escaping, dates, CSV formatting, and result summary helpers.
- Export and print helpers, once their dependencies on `appSettings` and `currentProfile` are made explicit.
- Settings defaults and constants, while keeping actual load/save behaviour in place until dependencies are clear.

Higher-risk extractions:

- Auth/profile loading because many screens depend on `currentProfile`.
- Navigation and role panel loading because screen changes trigger data refreshes.
- Visitor sign-in/sign-out because kiosk token checks, Supabase RPCs, caches, messages, confirmation modals, and refreshes are intertwined.

## 5. Refactor Risks

- DOM ID coupling: almost every behaviour depends on exact IDs in `index.html`. Renaming IDs or changing when elements exist will break event binding.
- Startup ordering: settings, event binding, auth subscription, current profile loading, kiosk warning updates, and core data refresh currently happen in one sequence.
- Shared closure state: caches and `currentProfile` are local variables used across many functions. Module extraction must pass state explicitly or centralise it without changing timing.
- Supabase contract risk: table names, column names, RPC names, and RPC parameter names are part of the live backend contract and RLS assumptions.
- Role/permission behaviour: General User, Security, and Super User paths share render/search helpers with flags such as `allowEdit`, `allowDelete`, and `securityOnly`.
- Kiosk behaviour: local storage token handling, prompts, idle timeout, public sign-in/out gating, and confirmation auto-close must remain identical.
- Rendering side effects: many render functions create buttons and attach listeners inline. Moving these can accidentally change event timing or captured values.
- Date handling: several flows compare dates using `YYYY-MM-DD` strings and `toLocaleString()` output. Refactors should not silently change timezone or formatting semantics.
- Print/export behaviour: print windows, generated HTML, CSV headers, XLSX sheet names, and file names are user-visible outputs.
- Existing encoding artifacts: some visible icon characters in HTML appear mojibake-like. Do not "fix" these during a refactor-only pass unless explicitly requested, because it would alter visible UI.

## 6. Safe Next Steps

1. Keep this document as the reference map for the next refactor pass.
2. Before code movement, capture a lightweight smoke checklist for kiosk sign-in, kiosk sign-out, staff login, each role panel, settings load/save, history search, exports, and print.
3. Add no-build browser checks if practical: load `index.html`, confirm `debugInfo` reaches the loaded state, and verify key buttons still bind.
4. Start with pure helper extraction only, keeping function names and call sites stable where possible.
5. After each extraction, check `index.html`, `assets/css/main.css`, and `assets/js/app.js` still work together.
6. Avoid changing UI text, CSS selectors, DOM IDs, Supabase table/RPC names, RPC parameter names, or business logic while splitting files.
7. Commit each small, verified module extraction separately so regressions can be isolated quickly.
