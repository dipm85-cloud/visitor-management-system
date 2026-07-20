# Legacy VMS Settings Dependency Review

Milestone: OHP-017J.1

## Removal Status

Legacy VMS settings removal status: normal runtime is not dependent on `public.system_settings`, duplicate Legacy VMS settings UI is retired, and the Legacy VMS workspace is no longer visible in normal navigation.

Safe to hide UI but keep storage: yes for duplicate settings controls and the normal Legacy VMS workspace nav item. OHP-017J.1 keeps the legacy workspace code and support/internal routes available, but removes Legacy VMS as a normal module/workspace destination. The remaining directly reachable legacy settings section is support/fallback labelled and includes an `Open Application Settings` handoff.

Safe to remove storage later: not yet. `public.system_settings` remains the fallback when Application Settings runtime RPCs fail, and it still receives legacy saves from existing grouped controls.

If anything still depends on legacy VMS settings: normal runtime does not. `assets/js/settings.js` loads `get_runtime_application_settings()` and `get_runtime_legacy_compat_settings()`, derives legacy-shaped values from Application Settings, and only reads `public.system_settings` after an RPC failure with a console warning.

No SQL is expected for OHP-017J.1.

## Dependency Pattern

Application Settings is the runtime source of truth. Existing modules may continue to call `settingValue("legacy_key")`, but those values are generated from Application Settings and the compatibility RPC during normal loads. The old global required-field keys are the exception: `require_security_pass`, `require_vehicle_plate`, and `require_onsite_contact` return conservative compatibility fallbacks only, because editable ownership is Form Configuration per form area.

Legacy VMS settings remain a fallback/historical bridge. `superuser_save_setting` and hidden legacy controls are retained for compatibility/support, but they are not the source used by normal startup when the OHP-017I RPCs are available and are not presented as normal editable settings.

Local per-device/session state is unchanged. Kiosk tokens, terminal session state, render diagnostics session flags, and Capability Inspector session state stay in `localStorage` or `sessionStorage` as before.

`window.ohSettingsRuntimeDiagnostics` is available for manual verification. It exposes source summaries, fallback events, and redacted compatibility-key resolution checks without network writes or sensitive value dumps.

## Legacy Settings Matrix

| Legacy setting/control | Legacy storage/key | Application Settings source | Normal runtime source | Safe to remove UI now? | Safe to remove storage later? | Notes / risk |
| --- | --- | --- | --- | --- | --- | --- |
| Legacy VMS workspace nav/banner | Static HTML/navigation | `settings.show_legacy_vms_settings_link` marker | Hidden/support-only route | Workspace nav demoted | No | Legacy VMS is no longer a normal navigation item. The workspace remains available for support/internal handoffs, with the banner stating Application Settings is runtime source of truth and the legacy area is temporary/internal. |
| Kiosk idle timeout seconds | `kiosk_idle_timeout_seconds` | `shared_terminal.kiosk_idle_timeout_seconds` | Compatibility RPC / derived alias | Retired from legacy settings UI | Unknown | Registered terminal idle reset settings remain separate native Shared Terminal controls. |
| Require kiosk device token | `kiosk_device_required` | `shared_terminal.kiosk_device_required` | Compatibility RPC / derived alias | Retired from legacy settings UI | Unknown | Device/token state itself remains specialist/local state. |
| Confirmation auto-close seconds | `confirmation_auto_close_seconds` | `visitors.confirmation_auto_close_seconds` | Compatibility RPC / derived alias | Later | Unknown | Existing consumers can keep `settingValue()`. |
| Visitor confirmation messages | `sign_in_confirmation_message`, `walk_in_confirmation_message`, `sign_out_confirmation_message` | `visitors.sign_in_confirmation_message`, `visitors.walk_in_confirmation_message`, `visitors.sign_out_confirmation_message` | Compatibility RPC / derived alias | Retired from legacy settings UI | Unknown | Walk-in wording is now separate in Application Settings. |
| Walk-in availability and matching rules | `allow_walk_ins`, `prevent_walk_in_when_matching_planned_visit_exists` | `visitors.allow_walk_ins`, `visitors.prevent_walk_in_when_matching_planned_visit_exists` | Compatibility RPC / derived alias | Later | Unknown | Walk-in controls are represented in Application Settings. |
| Operational visitor rules | `auto_end_of_day_sign_out_enabled`, `auto_end_of_day_sign_out_time`, `max_login_attempts` | `visitors.*` | Compatibility RPC / derived alias | Retired from legacy settings UI | Unknown | Behaviour defaults remain Application Settings values. |
| Visitor required-field legacy keys | `require_security_pass`, `require_vehicle_plate`, `require_onsite_contact` | Form Configuration: `security_pass_id`, `vehicle_registration`, `on_site_contact` for `visitor_walk_ins` and `planned_visits` | Conservative derived fallback only | Retired from legacy settings UI | Unknown | These are compatibility only and must not be editable global Visitor settings or use `public.system_settings` as source of truth. |
| Branding and product identity | `company_name`, colour/logo/background keys | `application.*`, `branding.*` | Compatibility RPC / derived alias | Retired from legacy settings UI | Unknown | Legacy branding controls are historical fallbacks. |
| Legacy planned/walk-in field rules | `planned_*`, `walkin_*` visibility/required keys | Form Configuration areas | Legacy fallback / form requirement RPCs | Retired from legacy settings UI | Unknown | Form Configuration is the only editable owner for current required-field rules. |
| Retention settings | `retention_planned_days`, `retention_visit_log_days`, `retention_audit_days`, `retention_mode` | `retention.*` | Compatibility RPC / derived alias | Retired from legacy settings UI | Unknown | Retention preview/cleanup are now covered by Application Settings values. |
| Planned lifecycle / housekeeping | `planned_completed_cleanup_mode`, `planned_no_show_retention_days`, `daily_maintenance_enabled`, `daily_maintenance_roles` | `retention.*` | Compatibility RPC / derived alias | Retired from legacy settings UI | Unknown | Daily maintenance roles remain a compatibility setting. |
| Privacy notice settings | `privacy_notice_enabled`, `privacy_acknowledgement_required`, `privacy_notice_version`, `privacy_notice_text`, `privacy_display_mode` | `privacy.notice_*`, `privacy.display_mode` | Compatibility RPC / derived alias | Retired from legacy settings UI | Unknown | Privacy case/SAR workspaces remain specialist operational surfaces. |
| Email processor settings | `email_processor_mode`, `email_processor_batch_size`, `email_processor_schedule` | `email.*` | Compatibility RPC / derived alias | Later | Unknown | Delivery remains disabled unless explicitly enabled. |
| Email delivery settings | `email_delivery_enabled`, `email_edge_function_url`, `email_sender_name`, `email_sender_address` | `email.*` | Compatibility RPC / derived alias | Later | Unknown | API secrets stay in Supabase, not browser settings. |
| Notification trigger settings | `notify_host_on_visitor_arrival`, `notify_gdpr_due_soon`, `gdpr_due_soon_days`, `notify_kiosk_offline`, `kiosk_offline_minutes` | `notifications.*` | Compatibility RPC / derived alias | Later | Unknown | Message send/history workspaces remain operational. |
| Agreement/sign-off settings | agreement/sign-off legacy keys | `agreements.*`, `document_signoff.*` | Compatibility RPC / derived alias | Later | Unknown | Agreement types remain future Reference / Configuration Data where applicable. |
| Deployment expected version | `current_app_version`, `outdated_device_warning_enabled` | `deployment.*` | Compatibility RPC / derived alias | Retired from legacy settings UI | Unknown | Device runtime checks can keep legacy key reads. |
| Local kiosk token | `localStorage` key `vms_kiosk_token` | None | Local device state | No | No | Per-device token storage is intentionally unchanged. |
| Shared terminal token/session | terminal registration/session state | None | Local/device state and specialist workspace | No | No | Application Settings owns display/reset behaviour only. |
| Section collapse/debug preferences | `localStorage` UI keys | None | Local UI preference state | No | Unknown | Not Application Settings. |
| Render diagnostics state | `sessionStorage` keys | None | Session state | No | Unknown | Diagnostics remain session/query-param enabled. |
| Capability Inspector session state | Session-only state | `access_diagnostics.*` locked markers | Session state plus Application Settings markers | No | No | Inspector remains session-only and intercepts actions when enabled. |

## Remaining Exceptions

| File/module | Setting key or API | Reason | Risk | Recommended next action |
| --- | --- | --- | --- | --- |
| `assets/js/settings.js` | `public.system_settings` read | Explicit fallback only after Application Settings runtime RPC failure. | Low; warning diagnostics now record fallback use. | Keep until a later storage retirement plan defines rollback support. |
| `assets/js/settings.js`, `assets/js/app.js`, `assets/js/documentSignoffAdmin.js` via shared save helper | `superuser_save_setting` | Legacy support/fallback code and bridge sync still save historical settings. | Low while duplicate controls stay hidden from normal navigation. | Keep storage for support/rollback until a later storage retirement milestone. |
| `assets/js/settings.js` | `require_security_pass`, `require_vehicle_plate`, `require_onsite_contact` | Old compatibility keys return conservative false fallbacks because Form Configuration owns per-form requirements. | Low; avoids second source of truth. | Keep documented as compatibility-only until old callers are removed. |

## OHP-017J.1 Status

Legacy VMS is no longer visible in normal navigation. Direct/support access can still open the legacy workspace where existing migrated-adjacent workflows need it, and the old settings section still shows a support/legacy notice plus an `Open Application Settings` button. Application Settings remains the only normal settings/configuration destination.

Not safe to delete `public.system_settings` yet. It remains fallback/support storage and is still used by legacy save/reset paths.

## Decision

Do not delete Legacy VMS UI or `public.system_settings` yet. The correct OHP-017J.1 state is: Application Settings is the normal runtime source of truth, legacy-shaped values are generated for compatibility, visitor required-field ownership stays in Form Configuration, duplicate legacy settings controls are hidden from normal UI, Legacy VMS is hidden/support-only, and `public.system_settings` remains fallback/historical storage only.
