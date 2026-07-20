# Application Settings Linkage Audit

Milestone: OHP-017I

## Summary

Application Settings is now the normal runtime source of truth for General, Branding, Visitors, Shared Terminal, Documents / Sign-off, Notifications, Privacy, Access / Diagnostics, Retention / Housekeeping, Email, Deployment / Devices, and Form Configuration areas. The audit keeps bridge, locked/future, partial, and stored-only labels visible so editable settings do not silently appear fully active.

SQL for this milestone is `database/OHP-017I_remove_legacy_vms_runtime_dependency.sql`. It seeds the remaining runtime settings, adds Application Settings categories, and exposes compatibility RPCs for legacy-shaped keys.

## Status Meanings

- Active / applied: the app reads the value and applies it to visible behaviour.
- Partially applied: the app reads part of the value, or applies it only to supported outputs.
- Future / locked: the value is locked by system or reserved for a future controlled workflow.
- Stored only: the value can be saved but no runtime consumer currently reads it.
- Legacy bridge: Application Settings is the primary owner, but legacy UI remains a compatibility/historical bridge.
- Unused / needs action: no acceptable label or runtime linkage exists.

## Runtime Pattern

Normal runtime loads call `get_runtime_application_settings()` first and `get_runtime_legacy_compat_settings()` second through `assets/js/applicationSettingsService.js`. `assets/js/settings.js` builds `appSettings` and legacy-shaped compatibility values from those results, so existing `settingValue("legacy_key")` consumers keep working without reading `public.system_settings`.

`public.system_settings` is now fallback only. If the runtime RPCs fail, `loadSystemSettings()` logs a console warning, loads legacy rows, and overlays Application Settings categories where available.

Saves dispatch `oh:application-settings-values-changed`; `assets/js/app.js` reloads settings, reapplies form requirement indicators, and refreshes kiosk/terminal access wiring.

## Registry Inventory

| Setting key | Category | User-facing name | Status | Used in code | Fallback behaviour | Immediate after save | Follow-up | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `application.product_name` | General | Product name | Active / applied | `settings.js`, `brandingThemeService.js`, branding preview | Defaults to `Operations Hub` / legacy company name | Yes after settings reload/theme apply | No | Also bridges `company_name` for legacy display. |
| `application.product_subtitle` | General | Product subtitle | Active / applied | `settings.js`, `brandingThemeService.js`, branding preview | Defaults to `Operational workspace` | Yes after settings reload/theme apply | No | Header subtitle. |
| `application.environment_label` | General | Environment label | Active / applied | `settings.js`, `brandingThemeService.js` | Blank hides chip unless enabled | Yes after settings reload/theme apply | No | Works with show flag. |
| `application.show_environment_label` | General | Show environment label | Active / applied | `settings.js`, `brandingThemeService.js` | False | Yes after settings reload/theme apply | No | Controls environment chip visibility. |
| `application.settings_workspace_enabled` | General | Application Settings workspace enabled | Stored only | Seeded in `OHP-017_application_settings_foundation.sql`; no runtime read found | Navigation/capabilities decide visibility | Save only | Yes | UI now labels this stored-only foundation marker. |
| `settings.show_legacy_vms_settings_link` | Advanced / Technical | Show legacy VMS settings link | Legacy bridge | Seeded in foundation SQL; legacy workspace remains statically reachable by navigation/capabilities | Legacy VMS remains visible where permitted | Save only | Yes | Bridge marker; the banner now says Application Settings is primary. |
| `assignments.field_requirements_enabled` | People & Assignments | Assignment field requirements enabled | Stored only | Foundation seed only; superseded by Form Configuration RPCs | Field requirement tables/RPCs are active regardless | Save only | Yes | Keep until foundation keys are retired or locked. |
| `assignments.enforce_requirements_on_save` | People & Assignments | Enforce assignment requirements on save | Stored only | Foundation seed only; superseded by `validate_*_requirements_payload` RPCs | Form-specific validation RPCs enforce requirements | Save only | Yes | Keep labelled as stored-only. |
| `branding.logo_url` | Branding | Logo URL | Active / applied | `settings.js`, `brandingThemeService.js`, branding preview | Default mark | Yes after settings reload/theme apply | No | Header, legacy header, public screens, print fallback. |
| `branding.logo_transparent_background` | Branding | Logo has transparent background | Active / applied | `settings.js`, `brandingThemeService.js`, branding preview | False/default mark container | Yes after settings reload/theme apply | No | Controls logo container styling. |
| `branding.theme_mode` | Branding | Theme mode | Active / applied | `brandingThemeService.js` | `system` | Yes after settings reload/theme apply | No | Applies light/dark/system tokens. |
| `branding.primary_color` | Branding | Primary colour | Active / applied | `brandingThemeService.js`, branding preview | `#475569` | Preview updates while editing; app after save reload | No | Buttons, active nav, focus states. |
| `branding.accent_color` | Branding | Accent colour | Active / applied | `brandingThemeService.js`, branding preview | `#18a999` / SQL default | Preview updates while editing; app after save reload | No | Secondary highlights/toast accent tokens. |
| `branding.brand_contrast_mode` | Branding | Branded text contrast mode | Active / applied | `brandingThemeService.js`, branding preview | `auto` | Preview updates while editing; app after save reload | No | Controls branded text contrast. |
| `branding.background_mode` | Branding | Background mode | Active / applied | `brandingThemeService.js`, branding preview | `default` | Preview updates while editing; app after save reload | No | Supports default, solid, gradient, image. |
| `branding.background_color` | Branding | Background colour | Active / applied | `brandingThemeService.js`, branding preview | `#eef3f8` / SQL default | Preview updates while editing; app after save reload | No | Used for solid app background. |
| `branding.background_gradient_start_color` | Branding | Background gradient start colour | Active / applied | `brandingThemeService.js`, branding preview | `#f8fafc` | Preview updates while editing; app after save reload | No | App gradient mode. |
| `branding.background_gradient_end_color` | Branding | Background gradient end colour | Active / applied | `brandingThemeService.js`, branding preview | `#e2e8f0` | Preview updates while editing; app after save reload | No | App gradient mode. |
| `branding.background_gradient_direction` | Branding | Background gradient direction | Active / applied | `brandingThemeService.js`, branding preview | `135deg` | Preview updates while editing; app after save reload | No | App gradient direction. |
| `branding.background_gradient_strength` | Branding | Background gradient strength | Active / applied | `brandingThemeService.js`, branding preview | `subtle` | Preview updates while editing; app after save reload | No | App gradient overlay strength. |
| `branding.background_image_url` | Branding | Background image URL | Active / applied | `brandingThemeService.js`, branding preview | None | Preview updates while editing; app after save reload | No | Used when image mode is selected. |
| `branding.background_opacity` | Branding | Background opacity | Active / applied | `brandingThemeService.js` | `0.18` | After save reload | No | Image overlay opacity. |
| `branding.header_logo_display_mode` | Branding | Header logo display mode | Active / applied | `brandingThemeService.js`, branding preview | `logo_and_name` | Preview updates while editing; app after save reload | No | Controls logo/name visibility. |
| `branding.header_logo_size` | Branding | Header logo size | Active / applied | `brandingThemeService.js` | `medium` | After save reload | No | Header logo dimensions. |
| `branding.favicon_url` | Branding | Favicon URL | Active / applied | `brandingThemeService.js` | Existing/default favicon | After save reload | No | Updates favicon link. |
| `branding.print_logo_url` | Branding | Print logo URL | Partially applied | `brandingThemeService.js`, `privacyGdprAdmin.js`, `app.js` print output | Falls back to main logo/default mark | Supported print outputs after reload | No | Only supported print/SAR/evidence outputs use it. |
| `branding.public_screen_background_mode` | Branding | Public screen background mode | Active / applied | `brandingThemeService.js`, terminal/public CSS tokens | Inherit app | After save reload | No | Shared Terminal and visitor kiosk backgrounds. |
| `branding.public_screen_background_color` | Branding | Public screen background colour | Active / applied | `brandingThemeService.js` | `#f8fafc` | After save reload | No | Public solid mode. |
| `branding.public_screen_gradient_start_color` | Branding | Public screen gradient start colour | Active / applied | `brandingThemeService.js`, branding preview | `#f8fafc` | Preview updates while editing; app after save reload | No | Public gradient mode. |
| `branding.public_screen_gradient_end_color` | Branding | Public screen gradient end colour | Active / applied | `brandingThemeService.js`, branding preview | `#e2e8f0` | Preview updates while editing; app after save reload | No | Public gradient mode. |
| `branding.public_screen_gradient_direction` | Branding | Public screen gradient direction | Active / applied | `brandingThemeService.js`, branding preview | `135deg` | Preview updates while editing; app after save reload | No | Public gradient direction. |
| `branding.public_screen_gradient_strength` | Branding | Public screen gradient strength | Active / applied | `brandingThemeService.js`, branding preview | `subtle` | Preview updates while editing; app after save reload | No | Public gradient overlay strength. |
| `branding.public_screen_background_image_url` | Branding | Public screen background image URL | Active / applied | `brandingThemeService.js` | None | After save reload | No | Public image mode. |
| `branding.public_screen_background_opacity` | Branding | Public screen background opacity | Active / applied | `brandingThemeService.js` | `0.25` | After save reload | No | Public image overlay opacity. |
| `branding.corner_style` | Branding | Corner style | Active / applied | `brandingThemeService.js` | `standard` | After save reload | No | Shared radius tokens. |
| `visitors.sign_in_confirmation_message` | Visitors | Sign-in confirmation message | Active / applied | `settings.js`, `visitorFlow.js`, `messages.js` | Default app messages | After settings reload; next confirmation | No | Also bridges walk-in sign-in message during migration. |
| `visitors.sign_out_confirmation_message` | Visitors | Sign-out confirmation message | Active / applied | `settings.js`, `visitorFlow.js`, `messages.js` | Default app message | After settings reload; next confirmation | No | Visitor sign-out confirmation. |
| `visitors.confirmation_auto_close_seconds` | Visitors | Confirmation auto-close seconds | Active / applied | `settings.js`, `messages.js` | 5 seconds | After settings reload; next confirmation | No | Controls kiosk/visitor confirmation timers. |
| `visitors.require_confirmation_close_button` | Visitors | Show confirmation close button | Active / applied | `settings.js`, `messages.js` | True | After settings reload; next confirmation | No | Accessibility/control setting. |
| `visitors.prevent_duplicate_planned_visits` | Visitors | Prevent duplicate planned visits | Stored only | `settings.js` bridge only; no runtime consumer found | Existing unique constraints/save handling still reject duplicates | Save only | Yes | UI now labels stored-only; do not wire large business changes in this milestone. |
| `visitors.prevent_walk_in_when_matching_planned_visit_exists` | Visitors | Prevent walk-in when matching planned visit exists | Active / applied | `settings.js`, `visitorFlow.js` | True | After settings reload; next walk-in | No | Blocks matching walk-in and prompts planned workflow. |
| `visitors.auto_end_of_day_sign_out_enabled` | Visitors | Auto end-of-day visitor sign-out enabled | Partially applied | `settings.js`, `app.js` opportunistic auto sign-out | Legacy/default true in some legacy controls; app setting default false | After settings reload; next opportunistic/manual run | Yes | Frontend gates RPC call; backend owns exact cut-off logic. |
| `visitors.auto_end_of_day_sign_out_time` | Visitors | Auto end-of-day sign-out time | Stored only | `settings.js` bridge only; no direct consumer found | Backend RPC timing/defaults | Save only | Yes | Keep labelled until RPC accepts configured time. |
| `shared_terminal.home_title` | Shared Terminal | Shared Terminal home title | Active / applied | `settings.js`, `brandingThemeService.js` | `How can we help?` | After settings reload/theme apply | No | Public terminal home title. |
| `shared_terminal.home_subtitle` | Shared Terminal | Shared Terminal home subtitle | Active / applied | `settings.js`, `brandingThemeService.js` | `Select an available workflow below.` | After settings reload/theme apply | No | Public terminal home subtitle. |
| `shared_terminal.show_staff_login_button` | Shared Terminal | Show staff login button | Active / applied | `settings.js`, `brandingThemeService.js` | True | After settings reload/theme apply | No | Hides/shows staff login button. |
| `shared_terminal.return_home_after_action_seconds` | Shared Terminal | Return home after action seconds | Active / applied | `settings.js`, `visitorFlow.js` | 5 seconds | After settings reload; next action | No | Public visitor action return timer. |
| `shared_terminal.idle_reset_enabled` | Shared Terminal | Shared Terminal idle reset enabled | Active / applied | `settings.js`, `kiosk.js` | False | After settings reload/rebind | No | Registered terminal idle reset. |
| `shared_terminal.idle_reset_seconds` | Shared Terminal | Shared Terminal idle reset seconds | Active / applied | `settings.js`, `kiosk.js` | 120 seconds | After settings reload/rebind | No | Registered terminal idle reset timer. |
| `shared_terminal.clear_partial_form_data_on_reset` | Shared Terminal | Clear partial form data on reset | Partially applied | `settings.js` bridge; terminal reset returns home via `kiosk.js` | Reset navigation clears many visible flows naturally, but no explicit independent clear gate | Save only / indirect after reset | Yes | UI now labels partial. |
| `document_signoff.use_confirmed_identity_links_for_compliance` | Documents / Sign-off | Use confirmed identity links for compliance | Legacy bridge | `applicationSettings.js` syncs legacy setting; `documentSignoffs.js` reads it | False | After save and settings reload | No | Bridge remains because legacy and native compliance share the setting. |
| `document_signoff.show_canonical_identity_context` | Documents / Sign-off | Show canonical identity context | Active / applied | `settings.js`, `documentSignoffs.js`, `app.js` print output | True | After settings reload; next evidence render | No | Controls linked/canonical identity context display. |
| `document_signoff.print_use_branding_logo` | Documents / Sign-off | Use branding logo on document printouts | Partially applied | `settings.js`, `app.js`; supported print output uses `getPrintLogoUrl()` | True with print/main logo fallback | Supported print outputs after reload | No | Supported output only, correctly labelled partial. |
| `document_signoff.default_evidence_detail_level` | Documents / Sign-off | Default evidence detail level | Active / applied | `settings.js`, `documentSignoffs.js` | `standard` | After settings reload; next evidence render | No | Compact/standard/detailed. |
| `document_signoff.require_scroll_to_end_before_signing` | Documents / Sign-off | Require scroll to end before signing | Future / locked | `documentSignoffs.js` reads it; definition locked false | False | Locked | No | Reserved until controlled document viewer support is reliable. |
| `notifications.default_message_type` | Notifications | Default system message type | Active / applied | `settings.js`, `adminPresence.js` | `info` | After settings reload; next send form open/reset | No | Sender may still choose another type. |
| `notifications.default_message_expiry_minutes` | Notifications | Default message expiry minutes | Active / applied | `settings.js`, `adminPresence.js` | 60 | After settings reload; next send form open/reset | No | Clamped 5-1440. |
| `notifications.default_required_action_grace_seconds` | Notifications | Default required-action grace seconds | Active / applied | `settings.js`, `adminPresence.js` | 300 | After settings reload; next send form open/reset | No | Clamped 30-86400. |
| `notifications.default_force_after_grace` | Notifications | Default force after grace period | Active / applied | `settings.js`, `adminPresence.js` | False | After settings reload; next send form open/reset | No | Only applies where sender has force capability. |
| `notifications.online_users_default_window_seconds` | Notifications | Online users default window seconds | Active / applied | `settings.js`, `adminPresence.js` | 120 | After settings reload; next online users refresh | No | Probably-online window. |
| `notifications.message_history_default_rows` | Notifications | Message history default rows | Active / applied | `settings.js`, `adminPresence.js` | 100 | After settings reload; next history refresh/reset | No | Clamped 25-500. |
| `privacy.case_reference_prefix` | Privacy / Data Governance | Privacy case reference prefix | Active / applied | `settings.js`, `privacyGdprAdmin.js` | `PRIV` | After settings reload; next case form placeholder/default | No | Prefix/default guidance. |
| `privacy.sar_pack_include_timeline_by_default` | Privacy / Data Governance | SAR pack includes timeline by default | Active / applied | `settings.js`, `privacyGdprAdmin.js` | True | After settings reload; next evidence pack | No | Evidence pack metadata/default. |
| `privacy.sar_pack_include_source_references_by_default` | Privacy / Data Governance | SAR pack includes source references by default | Active / applied | `settings.js`, `privacyGdprAdmin.js` | True | After settings reload; next evidence pack | No | Evidence pack metadata/default. |
| `privacy.anonymisation_requires_preview` | Privacy / Data Governance | Anonymisation requires preview | Future / locked | Locked setting; guardrail is hardcoded in `privacyGdprAdmin.js` preview flow | True | Locked | No | Native anonymisation remains preview/review only. |
| `privacy.anonymisation_requires_confirmation_phrase` | Privacy / Data Governance | Anonymisation requires confirmation phrase | Future / locked | Locked setting; confirmation phrase is hardcoded in `privacyGdprAdmin.js` review flow | True | Locked | No | Guardrail remains mandatory. |
| `privacy.show_technical_references_by_default` | Privacy / Data Governance | Show technical references by default | Active / applied | `settings.js`, `privacyGdprAdmin.js` | False | After settings reload; next detail render | No | Controls advanced technical details expansion. |
| `access_diagnostics.capability_inspector_available` | Access Control / Diagnostics | Capability Inspector available | Future / locked | Locked marker; actual availability remains capability/session controlled | True | Locked | No | Status marker only; no action executes while Inspector intercepts. |
| `access_diagnostics.capability_inspector_session_only` | Access Control / Diagnostics | Capability Inspector is session-only | Future / locked | Locked marker; session behaviour remains in `capabilityInspector.js` | True | Locked | No | Status marker only. |
| `access_diagnostics.show_effective_capability_source` | Access Control / Diagnostics | Show effective capability source | Active / applied | `settings.js`, `accessControl.js` | True | After settings reload; next Access Control render/export | No | Hides/shows role/direct source. |
| `access_diagnostics.default_user_assignment_include_inactive` | Access Control / Diagnostics | Include inactive users by default | Active / applied | `settings.js`, `accessControl.js` | True | After settings reload; next assignment filter reset/open | No | Default filter state only. |

## OHP-017I Runtime Additions

| Setting key | Category | Status | Legacy compatibility key(s) | Runtime notes |
| --- | --- | --- | --- | --- |
| `visitors.allow_walk_ins` | Visitors | Active / applied | `allow_walk_ins` | Controls whether walk-in flows remain available. |
| `visitors.walk_in_confirmation_message` | Visitors | Active / applied | `walk_in_confirmation_message` | Separate walk-in confirmation wording; fallback still accepts the older sign-in bridge. |
| `visitors.require_security_pass` | Visitors | Inactive / compatibility only | `require_security_pass` | Not shown as an editable Visitor setting. `security_pass_id` requirements are owned by Form Configuration. |
| `visitors.require_vehicle_plate` | Visitors | Inactive / compatibility only | `require_vehicle_plate` | Not shown as an editable Visitor setting. `vehicle_registration` requirements are owned by Form Configuration. |
| `visitors.require_onsite_contact` | Visitors | Inactive / compatibility only | `require_onsite_contact` | Not shown as an editable Visitor setting. `on_site_contact` requirements are owned by Form Configuration. |
| `visitors.max_login_attempts` | Visitors | Active / applied | `max_login_attempts` | Used by existing security/login compatibility paths. |
| `shared_terminal.kiosk_device_required` | Shared Terminal | Active / applied | `kiosk_device_required` | Keeps device-token enforcement driven by Application Settings. |
| `shared_terminal.kiosk_idle_timeout_seconds` | Shared Terminal | Active / applied | `kiosk_idle_timeout_seconds` | Maintains legacy kiosk timeout compatibility while Shared Terminal idle reset remains native. |
| `retention.*` | Retention / Housekeeping | Active / applied | `retention_*`, `planned_*`, `daily_maintenance_*` | Retention preview, cleanup, no-show retention and daily maintenance read generated compatibility values. |
| `privacy.notice_*`, `privacy.display_mode` | Privacy / Data Governance | Active / applied | `privacy_notice_*`, `privacy_*` | Visitor privacy notice behaviour is now represented in Application Settings. |
| `email.*` | Email | Active / applied | `email_*` | Processor and delivery settings come from Application Settings; delivery defaults disabled. |
| `notifications.notify_*`, `notifications.*_minutes`, `notifications.*_days` | Notifications | Active / applied | notification trigger legacy keys | Notification trigger settings are now in Application Settings alongside message defaults. |
| `agreements.*` | Documents / Sign-off | Active / applied | agreement/sign-off legacy keys | Agreement enablement, validity, signatures, print wording and compliance guards are runtime compatibility values. |
| `deployment.*` | Deployment / Devices | Active / applied | `current_app_version`, `outdated_device_warning_enabled` | Expected app version and outdated-device warning settings are owned by Application Settings. |

## Form Configuration Inventory

Form Configuration is stored in `field_requirement_areas`, `field_requirement_definitions`, and `field_requirement_values`, not in editable Visitor Application Settings. `security_pass_id`, `vehicle_registration`, and `on_site_contact` requirements must be changed here for Visitor Walk-ins and Planned Visits.

| Area | Status | Fields | Used in code | Fallback behaviour | Immediate after save | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| `work_assignments` | Active / applied | `person`, `start_date`, `contract`, `department`, `site`, `employer`, `job_role`, `shift_pattern`, `work_time_profile`, `notes` | `applicationSettings.js`, `formRequirements.js`, `assignments.js` | System-required fields remain required; configurable fields default not required | Settings UI updates immediately; assignment forms apply on load/reopen and validation RPC enforces on save | No |
| `visitor_walk_ins` | Active / applied | `visitor_name`, `company`, `host`, `reason`, `vehicle_registration`, `on_site_contact`, `security_pass_id` | `applicationSettings.js`, `formRequirements.js`, `visitorFlow.js`, `visitors.js` | Visitor name remains system-required; configurable fields default not required | Settings UI updates immediately; visitor forms apply on load/reopen and validation RPC enforces on save | No |
| `planned_visits` | Active / applied | `visitor_name`, `visit_date`, `company`, `host`, `expected_time`, `reason`, `vehicle_registration`, `on_site_contact`, `security_pass_id`, `notes` | `applicationSettings.js`, `formRequirements.js`, `plannedVisits.js`, `visitors.js` | Visitor name/date remain system-required; configurable fields default not required | Settings UI updates immediately; planned visit forms apply on load/reopen and validation RPC enforces on save | No |

## Findings

- Acceptable: most Application Settings are active or safely bridged.
- Acceptable: OHP-017I removes normal runtime dependency on `public.system_settings`; it is retained only as a fallback/historical bridge.
- Acceptable: duplicate global Visitor required-field toggles are inactive compatibility markers only; Form Configuration is the only editable owner for security pass, vehicle registration and on-site contact requirements.
- Acceptable with clear label: `document_signoff.print_use_branding_logo`, `visitors.auto_end_of_day_sign_out_enabled`, and `shared_terminal.clear_partial_form_data_on_reset` are partial.
- Acceptable with clear label: locked/future guardrails remain locked and labelled.
- Needs later cleanup: foundation keys and `visitors.prevent_duplicate_planned_visits` / `visitors.auto_end_of_day_sign_out_time` should either be wired, locked, or retired in a later migration after manual testing.
