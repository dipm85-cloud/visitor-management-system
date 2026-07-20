-- ============================================================
-- Operations Hub - OHP-017I
-- Remove Runtime Dependency on Legacy VMS Settings
--
-- Purpose:
-- - Add remaining active legacy setting families to Application Settings.
-- - Add runtime settings RPCs so the app can load Application Settings
--   as the source of truth.
-- - Add optional legacy compatibility map so older code paths can still
--   receive legacy-shaped keys without reading public.system_settings.
--
-- Safety:
-- - Does NOT delete public.system_settings.
-- - Does NOT delete legacy VMS settings UI.
-- - Does NOT remove local device/session state such as kiosk tokens.
-- - Application Settings becomes runtime source of truth.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Ensure categories exist
-- ------------------------------------------------------------

insert into public.application_setting_categories (
  category_code,
  category_name,
  description,
  display_order,
  active
)
values
  ('visitors', 'Visitors', 'Visitor Management settings, confirmation messages, and visit behaviour.', 40, true),
  ('shared_terminal', 'Shared Terminal', 'Shared Terminal / kiosk display, token requirements, and reset behaviour.', 45, true),
  ('retention_housekeeping', 'Retention / Housekeeping', 'Retention, cleanup, and daily maintenance settings.', 47, true),
  ('privacy_data_governance', 'Privacy / Data Governance', 'Privacy notice, SAR support, anonymisation, and data-governance settings.', 95, true),
  ('notifications', 'Notifications', 'Notification triggers, system messages, and alert defaults.', 90, true),
  ('email', 'Email', 'Email processor and delivery settings.', 92, true),
  ('documents', 'Documents / Sign-off', 'Document sign-off, agreements, evidence, and compliance settings.', 50, true),
  ('deployment', 'Deployment / Devices', 'Deployment checks, app version expectations, and device warning settings.', 96, true),
  ('advanced', 'Advanced / Technical', 'Advanced technical configuration and diagnostics.', 100, true)
on conflict (category_code) do update
set
  category_name = excluded.category_name,
  description = excluded.description,
  display_order = excluded.display_order,
  active = excluded.active;

-- ------------------------------------------------------------
-- 2. Remaining Visitor / Kiosk / Shared Terminal runtime settings
-- ------------------------------------------------------------

insert into public.application_setting_definitions (
  setting_key,
  category_code,
  setting_name,
  description,
  value_type,
  default_value,
  allowed_values,
  validation_json,
  locked_by_system,
  sensitive,
  active,
  display_order,
  ui_component,
  help_text
)
values
  (
    'visitors.allow_walk_ins',
    'visitors',
    'Allow walk-ins',
    'Controls whether walk-in visitor creation/sign-in is available where supported.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    90,
    'toggle',
    'When disabled, users should use planned visits only.'
  ),
  (
    'visitors.walk_in_confirmation_message',
    'visitors',
    'Walk-in sign-in confirmation message',
    'Message shown after a walk-in visitor signs in.',
    'text',
    to_jsonb('You have been signed in successfully.'::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    92,
    'textarea',
    'Allows walk-in sign-in wording to differ from planned sign-in wording.'
  ),
  (
    'visitors.require_security_pass',
    'visitors',
    'Require security pass ID',
    'Controls whether Security Pass ID is required where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    94,
    'toggle',
    'Form Configuration can also require this field for specific forms.'
  ),
  (
    'visitors.require_vehicle_plate',
    'visitors',
    'Require vehicle registration',
    'Controls whether vehicle registration is required where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    96,
    'toggle',
    'Form Configuration can also require this field for specific forms.'
  ),
  (
    'visitors.require_onsite_contact',
    'visitors',
    'Require on-site contact',
    'Controls whether on-site contact is required where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    98,
    'toggle',
    'Form Configuration can also require this field for specific forms.'
  ),
  (
    'visitors.max_login_attempts',
    'visitors',
    'Maximum staff login attempts',
    'Maximum failed login attempts before showing additional warning/lockout handling where supported.',
    'integer',
    to_jsonb(5),
    null,
    jsonb_build_object('min', 1, 'max', 20),
    false,
    false,
    true,
    100,
    'number',
    'Used by staff login/security messaging where supported.'
  ),
  (
    'shared_terminal.kiosk_device_required',
    'shared_terminal',
    'Require registered terminal device',
    'Controls whether Shared Terminal / kiosk workflows require a registered device token where supported.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    80,
    'toggle',
    'Recommended ON for production terminals.'
  ),
  (
    'shared_terminal.kiosk_idle_timeout_seconds',
    'shared_terminal',
    'Legacy kiosk idle timeout seconds',
    'Compatibility setting for older kiosk idle-timeout behaviour.',
    'integer',
    to_jsonb(120),
    null,
    jsonb_build_object('min', 30, 'max', 3600),
    false,
    false,
    true,
    82,
    'number',
    'Use Shared Terminal idle reset settings for the new flow. This keeps legacy runtime paths independent from VMS settings.'
  )
on conflict (setting_key) do update
set
  category_code = excluded.category_code,
  setting_name = excluded.setting_name,
  description = excluded.description,
  value_type = excluded.value_type,
  default_value = excluded.default_value,
  allowed_values = excluded.allowed_values,
  validation_json = excluded.validation_json,
  locked_by_system = excluded.locked_by_system,
  sensitive = excluded.sensitive,
  active = excluded.active,
  display_order = excluded.display_order,
  ui_component = excluded.ui_component,
  help_text = excluded.help_text;

-- ------------------------------------------------------------
-- 3. Retention / Housekeeping settings
-- ------------------------------------------------------------

insert into public.application_setting_definitions (
  setting_key,
  category_code,
  setting_name,
  description,
  value_type,
  default_value,
  allowed_values,
  validation_json,
  locked_by_system,
  sensitive,
  active,
  display_order,
  ui_component,
  help_text
)
values
  (
    'retention.planned_days',
    'retention_housekeeping',
    'Planned visit retention days',
    'Retention period for planned visit records where cleanup is supported.',
    'integer',
    to_jsonb(365),
    null,
    jsonb_build_object('min', 1, 'max', 3650),
    false,
    false,
    true,
    10,
    'number',
    'Used by retention preview/cleanup workflows where supported.'
  ),
  (
    'retention.visit_log_days',
    'retention_housekeeping',
    'Visit log retention days',
    'Retention period for visit log records where cleanup is supported.',
    'integer',
    to_jsonb(365),
    null,
    jsonb_build_object('min', 1, 'max', 3650),
    false,
    false,
    true,
    20,
    'number',
    'Used by retention preview/cleanup workflows where supported.'
  ),
  (
    'retention.audit_days',
    'retention_housekeeping',
    'Audit retention days',
    'Retention period for audit records where cleanup is supported.',
    'integer',
    to_jsonb(730),
    null,
    jsonb_build_object('min', 30, 'max', 3650),
    false,
    false,
    true,
    30,
    'number',
    'Audit retention should normally be longer than operational record retention.'
  ),
  (
    'retention.mode',
    'retention_housekeeping',
    'Retention mode',
    'Controls how retention cleanup is applied where supported.',
    'select',
    to_jsonb('preview_only'::text),
    jsonb_build_array('disabled', 'preview_only', 'manual', 'automatic'),
    '{}'::jsonb,
    false,
    false,
    true,
    40,
    'select',
    'Preview/manual is recommended until data retention rules are fully agreed.'
  ),
  (
    'retention.planned_completed_cleanup_mode',
    'retention_housekeeping',
    'Completed planned visit cleanup mode',
    'Controls cleanup handling for completed planned visits where supported.',
    'select',
    to_jsonb('manual'::text),
    jsonb_build_array('disabled', 'manual', 'automatic'),
    '{}'::jsonb,
    false,
    false,
    true,
    50,
    'select',
    'Keeps completed planned visit lists tidy where supported.'
  ),
  (
    'retention.planned_no_show_retention_days',
    'retention_housekeeping',
    'Planned no-show retention days',
    'Retention period for planned no-show records where supported.',
    'integer',
    to_jsonb(30),
    null,
    jsonb_build_object('min', 1, 'max', 3650),
    false,
    false,
    true,
    60,
    'number',
    'Used by planned visit housekeeping where supported.'
  ),
  (
    'retention.daily_maintenance_enabled',
    'retention_housekeeping',
    'Daily maintenance enabled',
    'Controls whether daily maintenance / housekeeping workflows are enabled where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    70,
    'toggle',
    'Manual maintenance can still be available where supported.'
  ),
  (
    'retention.daily_maintenance_roles',
    'retention_housekeeping',
    'Daily maintenance roles',
    'Comma-separated roles or identifiers used by legacy daily maintenance compatibility where supported.',
    'text',
    to_jsonb('super_user'::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    80,
    'text',
    'Compatibility value while maintenance moves fully to capability-based checks.'
  )
on conflict (setting_key) do update
set
  category_code = excluded.category_code,
  setting_name = excluded.setting_name,
  description = excluded.description,
  value_type = excluded.value_type,
  default_value = excluded.default_value,
  allowed_values = excluded.allowed_values,
  validation_json = excluded.validation_json,
  locked_by_system = excluded.locked_by_system,
  sensitive = excluded.sensitive,
  active = excluded.active,
  display_order = excluded.display_order,
  ui_component = excluded.ui_component,
  help_text = excluded.help_text;

-- ------------------------------------------------------------
-- 4. Privacy notice settings
-- ------------------------------------------------------------

insert into public.application_setting_definitions (
  setting_key,
  category_code,
  setting_name,
  description,
  value_type,
  default_value,
  allowed_values,
  validation_json,
  locked_by_system,
  sensitive,
  active,
  display_order,
  ui_component,
  help_text
)
values
  (
    'privacy.notice_enabled',
    'privacy_data_governance',
    'Privacy notice enabled',
    'Controls whether visitor privacy notice is shown where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    70,
    'toggle',
    'Applies to visitor/privacy notice flows where supported.'
  ),
  (
    'privacy.acknowledgement_required',
    'privacy_data_governance',
    'Privacy acknowledgement required',
    'Controls whether users/visitors must acknowledge the privacy notice where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    80,
    'toggle',
    'Use where site policy requires explicit acknowledgement.'
  ),
  (
    'privacy.notice_version',
    'privacy_data_governance',
    'Privacy notice version',
    'Version label for the privacy notice.',
    'text',
    to_jsonb('1.0'::text),
    null,
    jsonb_build_object('maxLength', 30),
    false,
    false,
    true,
    90,
    'text',
    'Changing the version may be useful when notice wording changes.'
  ),
  (
    'privacy.notice_text',
    'privacy_data_governance',
    'Privacy notice text',
    'Text shown in privacy notice flows where supported.',
    'text',
    to_jsonb(''::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    100,
    'textarea',
    'Render as text. Do not paste unsafe HTML.'
  ),
  (
    'privacy.display_mode',
    'privacy_data_governance',
    'Privacy notice display mode',
    'Controls how privacy notice is displayed where supported.',
    'select',
    to_jsonb('modal'::text),
    jsonb_build_array('modal', 'embedded_walkin'),
    '{}'::jsonb,
    false,
    false,
    true,
    110,
    'select',
    'Modal is recommended when acknowledgement is required.'
  )
on conflict (setting_key) do update
set
  category_code = excluded.category_code,
  setting_name = excluded.setting_name,
  description = excluded.description,
  value_type = excluded.value_type,
  default_value = excluded.default_value,
  allowed_values = excluded.allowed_values,
  validation_json = excluded.validation_json,
  locked_by_system = excluded.locked_by_system,
  sensitive = excluded.sensitive,
  active = excluded.active,
  display_order = excluded.display_order,
  ui_component = excluded.ui_component,
  help_text = excluded.help_text;

-- ------------------------------------------------------------
-- 5. Email processor / delivery and notification trigger settings
-- ------------------------------------------------------------

insert into public.application_setting_definitions (
  setting_key,
  category_code,
  setting_name,
  description,
  value_type,
  default_value,
  allowed_values,
  validation_json,
  locked_by_system,
  sensitive,
  active,
  display_order,
  ui_component,
  help_text
)
values
  (
    'email.processor_mode',
    'email',
    'Email processor mode',
    'Controls how email queue processing is handled where supported.',
    'select',
    to_jsonb('disabled'::text),
    jsonb_build_array('disabled', 'manual', 'scheduled'),
    '{}'::jsonb,
    false,
    false,
    true,
    10,
    'select',
    'Disabled/manual is safest until email delivery is fully configured.'
  ),
  (
    'email.processor_batch_size',
    'email',
    'Email processor batch size',
    'Maximum batch size for email processing where supported.',
    'integer',
    to_jsonb(25),
    null,
    jsonb_build_object('min', 1, 'max', 500),
    false,
    false,
    true,
    20,
    'number',
    'Controls email processor batch size where supported.'
  ),
  (
    'email.processor_schedule',
    'email',
    'Email processor schedule',
    'Schedule label/expression for email processing where supported.',
    'text',
    to_jsonb('manual'::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    30,
    'text',
    'Compatibility value for existing email processor schedule settings.'
  ),
  (
    'email.delivery_enabled',
    'email',
    'Email delivery enabled',
    'Controls whether outbound email delivery is enabled where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    40,
    'toggle',
    'Keep disabled unless email delivery is configured and tested.'
  ),
  (
    'email.edge_function_url',
    'email',
    'Email edge function URL',
    'Edge function URL used for email delivery where supported.',
    'text',
    to_jsonb(''::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    50,
    'url',
    'Treat as configuration, not a secret. Do not include service-role keys.'
  ),
  (
    'email.sender_name',
    'email',
    'Email sender name',
    'Display name used for outbound emails where supported.',
    'text',
    to_jsonb('Operations Hub'::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    60,
    'text',
    'Shown to recipients where email delivery supports it.'
  ),
  (
    'email.sender_address',
    'email',
    'Email sender address',
    'Sender email address used for outbound emails where supported.',
    'text',
    to_jsonb(''::text),
    null,
    jsonb_build_object('format', 'email'),
    false,
    false,
    true,
    70,
    'text',
    'Use a verified sender where your email provider requires it.'
  ),
  (
    'notifications.notify_host_on_visitor_arrival',
    'notifications',
    'Notify host on visitor arrival',
    'Controls whether host arrival notifications are sent where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    100,
    'toggle',
    'Requires email/notification delivery to be configured.'
  ),
  (
    'notifications.notify_gdpr_due_soon',
    'notifications',
    'Notify when GDPR/privacy items are due soon',
    'Controls whether GDPR/privacy due-soon notifications are generated where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    110,
    'toggle',
    'Requires notification workflows to be configured.'
  ),
  (
    'notifications.gdpr_due_soon_days',
    'notifications',
    'GDPR/privacy due-soon days',
    'Number of days ahead for GDPR/privacy due-soon notifications.',
    'integer',
    to_jsonb(30),
    null,
    jsonb_build_object('min', 1, 'max', 365),
    false,
    false,
    true,
    120,
    'number',
    'Used only when due-soon notification is enabled.'
  ),
  (
    'notifications.notify_kiosk_offline',
    'notifications',
    'Notify when kiosk is offline',
    'Controls whether kiosk/offline notifications are generated where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    130,
    'toggle',
    'Requires terminal presence/offline checks to be configured.'
  ),
  (
    'notifications.kiosk_offline_minutes',
    'notifications',
    'Kiosk offline minutes',
    'Minutes without terminal activity before kiosk is considered offline where supported.',
    'integer',
    to_jsonb(10),
    null,
    jsonb_build_object('min', 1, 'max', 1440),
    false,
    false,
    true,
    140,
    'number',
    'Used only when kiosk offline notification is enabled.'
  )
on conflict (setting_key) do update
set
  category_code = excluded.category_code,
  setting_name = excluded.setting_name,
  description = excluded.description,
  value_type = excluded.value_type,
  default_value = excluded.default_value,
  allowed_values = excluded.allowed_values,
  validation_json = excluded.validation_json,
  locked_by_system = excluded.locked_by_system,
  sensitive = excluded.sensitive,
  active = excluded.active,
  display_order = excluded.display_order,
  ui_component = excluded.ui_component,
  help_text = excluded.help_text;

-- ------------------------------------------------------------
-- 6. Agreement / Sign-off policy settings
-- ------------------------------------------------------------

insert into public.application_setting_definitions (
  setting_key,
  category_code,
  setting_name,
  description,
  value_type,
  default_value,
  allowed_values,
  validation_json,
  locked_by_system,
  sensitive,
  active,
  display_order,
  ui_component,
  help_text
)
values
  (
    'agreements.visitor_agreements_enabled',
    'documents',
    'Visitor agreements enabled',
    'Controls whether visitor agreement/sign-off workflows are enabled where supported.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    100,
    'toggle',
    'Keeps visitor agreement behaviour under Application Settings.'
  ),
  (
    'agreements.validity_mode',
    'documents',
    'Agreement validity mode',
    'Controls how agreement validity is evaluated where supported.',
    'select',
    to_jsonb('by_version_change'::text),
    jsonb_build_array('none', 'by_version_change', 'by_days', 'both'),
    '{}'::jsonb,
    false,
    false,
    true,
    110,
    'select',
    'Version-change validity is the safest default.'
  ),
  (
    'agreements.validity_days',
    'documents',
    'Agreement validity days',
    'Number of days an agreement remains valid when day-based validity is enabled.',
    'integer',
    to_jsonb(365),
    null,
    jsonb_build_object('min', 1, 'max', 3650),
    false,
    false,
    true,
    120,
    'number',
    'Used only when validity mode includes days.'
  ),
  (
    'agreements.signature_required',
    'documents',
    'Visitor signature required',
    'Controls whether visitor signature is required where supported.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    130,
    'toggle',
    'Recommended ON for evidence quality.'
  ),
  (
    'agreements.inductor_signoff_enabled',
    'documents',
    'Inductor sign-off enabled',
    'Controls whether inductor sign-off is available/required where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    140,
    'toggle',
    'Used by agreement/sign-off workflows where supported.'
  ),
  (
    'agreements.inductor_signoff_mode',
    'documents',
    'Inductor sign-off mode',
    'Controls inductor sign-off mode where supported.',
    'select',
    to_jsonb('typed_name'::text),
    jsonb_build_array('typed_name', 'manual_signature'),
    '{}'::jsonb,
    false,
    false,
    true,
    150,
    'select',
    'Typed mode is simplest for operational use.'
  ),
  (
    'agreements.acceptance_text',
    'documents',
    'Agreement acceptance text',
    'Text shown during agreement/sign-off acceptance where supported.',
    'text',
    to_jsonb('I confirm that I have read and understood the agreement.'::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    160,
    'textarea',
    'Render safely as text, not HTML.'
  ),
  (
    'agreements.print_header',
    'documents',
    'Agreement print header',
    'Header text used on agreement/sign-off printouts where supported.',
    'text',
    to_jsonb('Visitor Agreement'::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    170,
    'text',
    'Print logo settings can also apply to supported outputs.'
  ),
  (
    'agreements.print_company_name',
    'documents',
    'Agreement print company name',
    'Company/name text used on agreement printouts where supported.',
    'text',
    to_jsonb('Operations Hub'::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    180,
    'text',
    'If blank, product/branding name may be used.'
  ),
  (
    'agreements.print_show_logo',
    'documents',
    'Show logo on agreement printouts',
    'Controls whether logo is shown on agreement printouts where supported.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    190,
    'toggle',
    'Uses print logo, main logo, then default app mark.'
  ),
  (
    'agreements.show_compliance_warnings',
    'documents',
    'Show agreement compliance warnings',
    'Controls whether agreement compliance warnings are shown where supported.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    200,
    'toggle',
    'Recommended ON.'
  ),
  (
    'agreements.highlight_overdue_agreements',
    'documents',
    'Highlight overdue agreements',
    'Controls whether overdue/outdated agreements are highlighted where supported.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    210,
    'toggle',
    'Recommended ON.'
  ),
  (
    'agreements.block_sign_out_if_required_missing',
    'documents',
    'Block sign-out if required agreements are missing',
    'Controls whether visitor sign-out is blocked when required agreements are missing where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    220,
    'toggle',
    'Default OFF to avoid operational disruption unless a site explicitly requires it.'
  )
on conflict (setting_key) do update
set
  category_code = excluded.category_code,
  setting_name = excluded.setting_name,
  description = excluded.description,
  value_type = excluded.value_type,
  default_value = excluded.default_value,
  allowed_values = excluded.allowed_values,
  validation_json = excluded.validation_json,
  locked_by_system = excluded.locked_by_system,
  sensitive = excluded.sensitive,
  active = excluded.active,
  display_order = excluded.display_order,
  ui_component = excluded.ui_component,
  help_text = excluded.help_text;

-- ------------------------------------------------------------
-- 7. Deployment / device settings
-- ------------------------------------------------------------

insert into public.application_setting_definitions (
  setting_key,
  category_code,
  setting_name,
  description,
  value_type,
  default_value,
  allowed_values,
  validation_json,
  locked_by_system,
  sensitive,
  active,
  display_order,
  ui_component,
  help_text
)
values
  (
    'deployment.current_app_version',
    'deployment',
    'Expected app version',
    'Expected deployed app version used by deployment/device checks where supported.',
    'text',
    to_jsonb(''::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    10,
    'text',
    'Leave blank to disable strict version warnings where supported.'
  ),
  (
    'deployment.outdated_device_warning_enabled',
    'deployment',
    'Outdated device warning enabled',
    'Controls whether users/devices are warned when running an outdated app version where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    20,
    'toggle',
    'Useful for kiosk/shared terminal deployments.'
  )
on conflict (setting_key) do update
set
  category_code = excluded.category_code,
  setting_name = excluded.setting_name,
  description = excluded.description,
  value_type = excluded.value_type,
  default_value = excluded.default_value,
  allowed_values = excluded.allowed_values,
  validation_json = excluded.validation_json,
  locked_by_system = excluded.locked_by_system,
  sensitive = excluded.sensitive,
  active = excluded.active,
  display_order = excluded.display_order,
  ui_component = excluded.ui_component,
  help_text = excluded.help_text;

-- ------------------------------------------------------------
-- 8. Ensure values exist for all definitions added here
-- ------------------------------------------------------------

insert into public.application_setting_values (
  setting_key,
  setting_value,
  updated_by
)
select
  d.setting_key,
  d.default_value,
  auth.uid()
from public.application_setting_definitions d
where d.setting_key in (
  'visitors.allow_walk_ins',
  'visitors.walk_in_confirmation_message',
  'visitors.require_security_pass',
  'visitors.require_vehicle_plate',
  'visitors.require_onsite_contact',
  'visitors.max_login_attempts',
  'shared_terminal.kiosk_device_required',
  'shared_terminal.kiosk_idle_timeout_seconds',
  'retention.planned_days',
  'retention.visit_log_days',
  'retention.audit_days',
  'retention.mode',
  'retention.planned_completed_cleanup_mode',
  'retention.planned_no_show_retention_days',
  'retention.daily_maintenance_enabled',
  'retention.daily_maintenance_roles',
  'privacy.notice_enabled',
  'privacy.acknowledgement_required',
  'privacy.notice_version',
  'privacy.notice_text',
  'privacy.display_mode',
  'email.processor_mode',
  'email.processor_batch_size',
  'email.processor_schedule',
  'email.delivery_enabled',
  'email.edge_function_url',
  'email.sender_name',
  'email.sender_address',
  'notifications.notify_host_on_visitor_arrival',
  'notifications.notify_gdpr_due_soon',
  'notifications.gdpr_due_soon_days',
  'notifications.notify_kiosk_offline',
  'notifications.kiosk_offline_minutes',
  'agreements.visitor_agreements_enabled',
  'agreements.validity_mode',
  'agreements.validity_days',
  'agreements.signature_required',
  'agreements.inductor_signoff_enabled',
  'agreements.inductor_signoff_mode',
  'agreements.acceptance_text',
  'agreements.print_header',
  'agreements.print_company_name',
  'agreements.print_show_logo',
  'agreements.show_compliance_warnings',
  'agreements.highlight_overdue_agreements',
  'agreements.block_sign_out_if_required_missing',
  'deployment.current_app_version',
  'deployment.outdated_device_warning_enabled'
)
on conflict (setting_key) do nothing;

-- ------------------------------------------------------------
-- 9. Legacy compatibility map
-- ------------------------------------------------------------

create table if not exists public.application_setting_legacy_key_map (
  legacy_key text primary key,
  setting_key text not null references public.application_setting_definitions(setting_key) on delete cascade,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint application_setting_legacy_key_map_legacy_key_not_blank
    check (length(trim(legacy_key)) > 0)
);

create index if not exists idx_application_setting_legacy_key_map_setting_key
on public.application_setting_legacy_key_map(setting_key);

create or replace function public.oh_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_application_setting_legacy_key_map_updated_at
on public.application_setting_legacy_key_map;

create trigger trg_application_setting_legacy_key_map_updated_at
before update on public.application_setting_legacy_key_map
for each row
execute function public.oh_set_updated_at();

alter table public.application_setting_legacy_key_map enable row level security;

drop policy if exists "admins can view application setting legacy key map" on public.application_setting_legacy_key_map;

create policy "admins can view application setting legacy key map"
on public.application_setting_legacy_key_map
for select
to authenticated
using (public.can_view_application_settings());

grant select on public.application_setting_legacy_key_map to authenticated;

insert into public.application_setting_legacy_key_map (
  legacy_key,
  setting_key,
  active,
  notes
)
values
  ('company_name', 'application.product_name', true, 'Compatibility for old company/app display name.'),
  ('primary_colour', 'branding.primary_color', true, 'Compatibility for old branding colour.'),
  ('accent_colour', 'branding.accent_color', true, 'Compatibility for old accent colour.'),
  ('page_background_colour', 'branding.background_color', true, 'Compatibility for old page background colour.'),
  ('logo_transparent_background', 'branding.logo_transparent_background', true, 'Compatibility for old logo background flag.'),
  ('logo_url', 'branding.logo_url', true, 'Compatibility for old logo URL.'),
  ('background_url', 'branding.background_image_url', true, 'Compatibility for old background image URL.'),
  ('background_opacity', 'branding.background_opacity', true, 'Compatibility for old background opacity.'),

  ('confirmation_auto_close_seconds', 'visitors.confirmation_auto_close_seconds', true, 'Visitor confirmation timeout compatibility.'),
  ('sign_in_confirmation_message', 'visitors.sign_in_confirmation_message', true, 'Planned/sign-in message compatibility.'),
  ('walk_in_confirmation_message', 'visitors.walk_in_confirmation_message', true, 'Walk-in message compatibility.'),
  ('sign_out_confirmation_message', 'visitors.sign_out_confirmation_message', true, 'Sign-out message compatibility.'),
  ('allow_walk_ins', 'visitors.allow_walk_ins', true, 'Walk-in availability compatibility.'),
  ('auto_end_of_day_sign_out_enabled', 'visitors.auto_end_of_day_sign_out_enabled', true, 'Visitor auto sign-out compatibility.'),
  ('auto_end_of_day_sign_out_time', 'visitors.auto_end_of_day_sign_out_time', true, 'Visitor auto sign-out time compatibility.'),
  ('require_security_pass', 'visitors.require_security_pass', true, 'Legacy visitor required field compatibility.'),
  ('require_vehicle_plate', 'visitors.require_vehicle_plate', true, 'Legacy visitor required field compatibility.'),
  ('require_onsite_contact', 'visitors.require_onsite_contact', true, 'Legacy visitor required field compatibility.'),
  ('max_login_attempts', 'visitors.max_login_attempts', true, 'Legacy login warning compatibility.'),

  ('kiosk_device_required', 'shared_terminal.kiosk_device_required', true, 'Terminal device-token requirement compatibility.'),
  ('kiosk_idle_timeout_seconds', 'shared_terminal.kiosk_idle_timeout_seconds', true, 'Legacy kiosk timeout compatibility.'),

  ('retention_planned_days', 'retention.planned_days', true, 'Retention compatibility.'),
  ('retention_visit_log_days', 'retention.visit_log_days', true, 'Retention compatibility.'),
  ('retention_audit_days', 'retention.audit_days', true, 'Retention compatibility.'),
  ('retention_mode', 'retention.mode', true, 'Retention mode compatibility.'),
  ('planned_completed_cleanup_mode', 'retention.planned_completed_cleanup_mode', true, 'Planned lifecycle compatibility.'),
  ('planned_no_show_retention_days', 'retention.planned_no_show_retention_days', true, 'Planned no-show compatibility.'),
  ('daily_maintenance_enabled', 'retention.daily_maintenance_enabled', true, 'Daily maintenance compatibility.'),
  ('daily_maintenance_roles', 'retention.daily_maintenance_roles', true, 'Daily maintenance roles compatibility.'),

  ('privacy_notice_enabled', 'privacy.notice_enabled', true, 'Privacy notice compatibility.'),
  ('privacy_acknowledgement_required', 'privacy.acknowledgement_required', true, 'Privacy notice compatibility.'),
  ('privacy_notice_version', 'privacy.notice_version', true, 'Privacy notice compatibility.'),
  ('privacy_notice_text', 'privacy.notice_text', true, 'Privacy notice compatibility.'),
  ('privacy_display_mode', 'privacy.display_mode', true, 'Privacy notice compatibility.'),

  ('email_processor_mode', 'email.processor_mode', true, 'Email processor compatibility.'),
  ('email_processor_batch_size', 'email.processor_batch_size', true, 'Email processor compatibility.'),
  ('email_processor_schedule', 'email.processor_schedule', true, 'Email processor compatibility.'),
  ('email_delivery_enabled', 'email.delivery_enabled', true, 'Email delivery compatibility.'),
  ('email_edge_function_url', 'email.edge_function_url', true, 'Email delivery compatibility.'),
  ('email_sender_name', 'email.sender_name', true, 'Email delivery compatibility.'),
  ('email_sender_address', 'email.sender_address', true, 'Email delivery compatibility.'),

  ('notify_host_on_visitor_arrival', 'notifications.notify_host_on_visitor_arrival', true, 'Notification trigger compatibility.'),
  ('notify_gdpr_due_soon', 'notifications.notify_gdpr_due_soon', true, 'Notification trigger compatibility.'),
  ('gdpr_due_soon_days', 'notifications.gdpr_due_soon_days', true, 'Notification trigger compatibility.'),
  ('notify_kiosk_offline', 'notifications.notify_kiosk_offline', true, 'Notification trigger compatibility.'),
  ('kiosk_offline_minutes', 'notifications.kiosk_offline_minutes', true, 'Notification trigger compatibility.'),

  ('visitor_agreements_enabled', 'agreements.visitor_agreements_enabled', true, 'Agreement policy compatibility.'),
  ('agreement_validity_mode', 'agreements.validity_mode', true, 'Agreement policy compatibility.'),
  ('agreement_validity_days', 'agreements.validity_days', true, 'Agreement policy compatibility.'),
  ('signature_required', 'agreements.signature_required', true, 'Agreement policy compatibility.'),
  ('inductor_signoff_enabled', 'agreements.inductor_signoff_enabled', true, 'Agreement policy compatibility.'),
  ('inductor_signoff_mode', 'agreements.inductor_signoff_mode', true, 'Agreement policy compatibility.'),
  ('agreement_acceptance_text', 'agreements.acceptance_text', true, 'Agreement policy compatibility.'),
  ('agreement_print_header', 'agreements.print_header', true, 'Agreement print compatibility.'),
  ('agreement_print_company_name', 'agreements.print_company_name', true, 'Agreement print compatibility.'),
  ('agreement_print_show_logo', 'agreements.print_show_logo', true, 'Agreement print compatibility.'),
  ('show_compliance_warnings', 'agreements.show_compliance_warnings', true, 'Agreement compliance compatibility.'),
  ('highlight_overdue_agreements', 'agreements.highlight_overdue_agreements', true, 'Agreement compliance compatibility.'),
  ('block_sign_out_if_required_agreements_missing', 'agreements.block_sign_out_if_required_missing', true, 'Agreement sign-out guard compatibility.'),

  ('current_app_version', 'deployment.current_app_version', true, 'Deployment/version compatibility.'),
  ('outdated_device_warning_enabled', 'deployment.outdated_device_warning_enabled', true, 'Deployment/version compatibility.')
on conflict (legacy_key) do update
set
  setting_key = excluded.setting_key,
  active = excluded.active,
  notes = excluded.notes,
  updated_at = now();

-- ------------------------------------------------------------
-- 10. Runtime settings RPCs
-- ------------------------------------------------------------

create or replace function public.get_runtime_application_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
begin
  select coalesce(
    jsonb_object_agg(d.setting_key, coalesce(v.setting_value, d.default_value)),
    '{}'::jsonb
  )
  into v_settings
  from public.application_setting_definitions d
  left join public.application_setting_values v
    on v.setting_key = d.setting_key
  where d.active is true
    and coalesce(d.sensitive, false) is false;

  return v_settings;
end;
$$;

grant execute on function public.get_runtime_application_settings() to anon;
grant execute on function public.get_runtime_application_settings() to authenticated;

create or replace function public.get_runtime_legacy_compat_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
begin
  select coalesce(
    jsonb_object_agg(m.legacy_key, coalesce(v.setting_value, d.default_value)),
    '{}'::jsonb
  )
  into v_settings
  from public.application_setting_legacy_key_map m
  join public.application_setting_definitions d
    on d.setting_key = m.setting_key
  left join public.application_setting_values v
    on v.setting_key = d.setting_key
  where m.active is true
    and d.active is true
    and coalesce(d.sensitive, false) is false;

  return v_settings;
end;
$$;

grant execute on function public.get_runtime_legacy_compat_settings() to anon;
grant execute on function public.get_runtime_legacy_compat_settings() to authenticated;

-- ------------------------------------------------------------
-- 11. Verification
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

select
  'OHP-017I remaining legacy runtime settings migrated to Application Settings' as result,
  (select count(*) from public.application_setting_definitions where category_code in (
    'visitors',
    'shared_terminal',
    'retention_housekeeping',
    'privacy_data_governance',
    'notifications',
    'email',
    'documents',
    'deployment'
  )) as relevant_setting_definitions,
  (select count(*) from public.application_setting_legacy_key_map where active is true) as active_legacy_compat_keys,
  public.get_runtime_application_settings() ? 'visitors.allow_walk_ins' as runtime_has_allow_walk_ins,
  public.get_runtime_legacy_compat_settings() ? 'allow_walk_ins' as compat_has_allow_walk_ins;
