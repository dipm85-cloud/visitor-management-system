# Legacy VMS Settings Dependency Review

Milestone: OHP-017H

## Removal Status

Legacy VMS settings removal status: Not safe to remove yet.

Safe to hide UI but keep storage: selected duplicate branding and visitor-message controls look safe to hide after manual smoke testing, because Application Settings now owns those values and bridges to legacy-shaped runtime keys. This milestone does not hide or remove them.

Safe to remove storage later: unknown. Several unique legacy-only controls still feed active workflows, scheduled/operational defaults, deployment checks, privacy notice behaviour, email processing, document agreement settings, and kiosk/device behaviour.

If anything still depends on legacy VMS settings: yes. Runtime still loads `public.system_settings` in `assets/js/settings.js`, overlays Application Settings values onto that object, and many modules still read `settingValue()` for legacy-only settings.

No SQL was added for this milestone.

## Dependency Pattern

Legacy settings are stored primarily in `public.system_settings` through `superuser_save_setting`, with grouped save/reset logic in `assets/js/app.js` and generic load/bridge logic in `assets/js/settings.js`. Application Settings values are now overlaid on top of legacy values for migrated keys, so the app can keep using existing `settingValue()` and `appSettings` consumers during migration.

## Legacy Settings Matrix

| Legacy setting/control | Legacy storage/key | Matching new Application Setting | Still used by app? | Migrated? | Safe to remove UI now? | Safe to remove storage later? | Notes / risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Legacy VMS workspace nav/banner | Static HTML/navigation | `settings.show_legacy_vms_settings_link` marker only | Yes | Partial | No | No | Unique workflows remain in Legacy VMS. Banner now says Application Settings is primary. |
| Kiosk idle timeout seconds | `kiosk_idle_timeout_seconds` | No direct new setting; related to Shared Terminal idle reset | Yes | No | No | Unknown | Staff/public kiosk timeout still uses legacy key. |
| Confirmation auto-close seconds | `confirmation_auto_close_seconds` | `visitors.confirmation_auto_close_seconds` | Yes | Yes / bridge | Eventually | Unknown | App setting overlays legacy key. |
| Allow walk-ins | `allow_walk_ins` | None | Yes | No | No | Unknown | `visitorFlow.js` and `visitorKiosk.js` still read it. |
| Require kiosk device token | `kiosk_device_required` | None | Yes | No | No | Unknown | Public kiosk token enforcement setting remains legacy. |
| Planned sign-in message | `sign_in_confirmation_message` | `visitors.sign_in_confirmation_message` | Yes | Yes / bridge | Eventually | Unknown | App setting overlays legacy key. |
| Walk-in sign-in message | `walk_in_confirmation_message` | `visitors.sign_in_confirmation_message` currently bridges both planned/walk-in | Yes | Partial | No | Unknown | New registry has one sign-in message, not separate walk-in wording. |
| Sign-out message | `sign_out_confirmation_message` | `visitors.sign_out_confirmation_message` | Yes | Yes / bridge | Eventually | Unknown | App setting overlays legacy key. |
| Company/site display name | `company_name` | `application.product_name` | Yes | Yes / bridge | Eventually | Unknown | New product name bridges legacy company display. |
| Primary colour | `primary_colour` | `branding.primary_color` | Yes | Yes / bridge | Eventually | Unknown | App setting overlays legacy key. |
| Accent colour | `accent_colour` | `branding.accent_color` | Yes | Yes / bridge | Eventually | Unknown | App setting overlays legacy key. |
| Page background colour | `page_background_colour` | `branding.background_color` | Yes | Yes / bridge | Eventually | Unknown | App setting overlays legacy key. |
| Logo transparent background | `logo_transparent_background` | `branding.logo_transparent_background` | Yes | Yes / bridge | Eventually | Unknown | App setting overlays legacy key. |
| Logo URL | `logo_url` | `branding.logo_url` | Yes | Yes / bridge | Eventually | Unknown | App setting overlays legacy key. |
| Background URL | `background_url` | `branding.background_image_url` | Yes | Yes / bridge | Eventually | Unknown | App setting overlays legacy key. |
| Background opacity | `background_opacity` | `branding.background_opacity` | Yes | Yes / bridge | Eventually | Unknown | App setting overlays legacy key. |
| Legacy planned field rules | `planned_*_visible`, `planned_*_required` | Form Configuration `planned_visits` | Some legacy paths | Partial | No | Unknown | New Form Configuration is active, but legacy field-rule controls still exist. |
| Legacy walk-in field rules | `walkin_*_visible`, `walkin_*_required` | Form Configuration `visitor_walk_ins` | Some legacy paths | Partial | No | Unknown | New Form Configuration is active; keep old storage until all legacy forms are retired. |
| Retention settings | `retention_planned_days`, `retention_visit_log_days`, `retention_audit_days`, `retention_mode` | None | Yes | No | No | Unknown | Retention preview/cleanup reads these legacy keys. |
| Planned lifecycle settings | `planned_completed_cleanup_mode`, `planned_no_show_retention_days`, `daily_maintenance_enabled`, `daily_maintenance_roles` | None, except related visitor auto sign-out registry | Yes | No | No | Unknown | Housekeeping/maintenance workflows still depend on them. |
| Privacy notice settings | `privacy_notice_enabled`, `privacy_acknowledgement_required`, `privacy_notice_version`, `privacy_notice_text`, `privacy_display_mode` | None | Yes | No | No | Unknown | Visitor privacy notice still reads legacy keys. |
| Email processor settings | `email_processor_mode`, `email_processor_batch_size`, `email_processor_schedule` | None | Yes | No | No | Unknown | Email queue tooling still uses legacy settings. |
| Notification trigger settings | `notify_host_on_visitor_arrival`, `notify_gdpr_due_soon`, `gdpr_due_soon_days`, `notify_kiosk_offline`, `kiosk_offline_minutes` | New notification defaults do not replace trigger settings | Yes | No | No | Unknown | New settings cover system-message defaults only. |
| Email delivery settings | `email_delivery_enabled`, `email_edge_function_url`, `email_sender_name`, `email_sender_address` | None | Yes | No | No | Unknown | Backend/email delivery flow still legacy-configured. |
| Agreement/sign-off settings | `visitor_agreements_enabled`, `agreement_validity_mode`, `agreement_validity_days`, `signature_required`, `inductor_signoff_enabled`, `inductor_signoff_mode`, `agreement_acceptance_text`, `agreement_print_header`, `agreement_print_company_name`, `agreement_print_show_logo`, `show_compliance_warnings`, `highlight_overdue_agreements`, `block_sign_out_if_required_agreements_missing` | Partial: `document_signoff.*` covers compliance, evidence detail, print-logo use, scroll guardrail | Yes | Partial | No | Unknown | Agreement type/setup and sign-off policy remain partly legacy. |
| Document compliance identity links | `document_signoff.use_confirmed_identity_links_for_compliance` | Same key in Application Settings | Yes | Legacy bridge | No | Unknown | Application Settings syncs this key back to legacy storage. |
| Deployment expected version | `current_app_version`, `outdated_device_warning_enabled` | No direct new setting | Yes | No | No | Unknown | Kiosk/deployment checks still read legacy keys. |
| Operational visitor rules | `auto_end_of_day_sign_out_enabled`, `auto_end_of_day_sign_out_time`, `max_login_attempts`, `require_security_pass`, `require_vehicle_plate`, `require_onsite_contact` | Partial: `visitors.auto_end_of_day_*` | Yes | Partial | No | Unknown | New auto sign-out enabled flag gates RPC; time is not directly consumed in frontend. |
| Local kiosk token | `localStorage` key `vms_kiosk_token` | None | Yes | No | No | No | Per-device token storage is still required. |
| Shared terminal token/session | terminal registration/session state | Shared Terminal settings cover display/reset only | Yes | Partial | No | No | Device/token administration remains specialist workspace. |
| Section collapse/debug preferences | `localStorage` keys under section navigation/debug | None | Yes | No | No | Unknown | UI preference/debug state, not Application Settings. |
| Render diagnostics state | `sessionStorage` keys in `renderDiagnostics.js` | None | Yes | No | No | Unknown | OHP-017F.1 diagnostics remain disabled by default and session/query-param enabled. |
| Capability Inspector session state | Session-only state in `capabilityInspector.js` | `access_diagnostics.capability_inspector_*` locked markers | Yes | Partial | No | No | Inspector must remain session-only and intercept actions when enabled. |

## Duplicate Controls

Duplicate controls exist for branding, visitor confirmation messages, field rules, and parts of visitor operational behaviour. They are not removed in OHP-017H. The safer next step is to hide or deep-link duplicate legacy branding/message controls only after manual smoke testing confirms Application Settings covers the active workflow for each control.

## Decision

Do not remove legacy VMS settings yet. Application Settings is the primary home for migrated settings, but legacy storage remains a compatibility bridge and still owns several unique settings families.
