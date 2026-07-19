-- ============================================================
-- Operations Hub - OHP-017C
-- General, Branding, Visitor, and Shared Terminal Settings Migration
--
-- Purpose:
-- - Move the first real settings groups into Application Settings.
-- - Seed controlled registry keys for:
--   - General
--   - Branding
--   - Visitors
--   - Shared Terminal
-- - Add reset-to-default helper for controlled settings.
--
-- Safety:
-- - Admins still cannot create arbitrary settings.
-- - Existing legacy settings are not deleted.
-- - Existing behaviour should be preserved by frontend fallback until
--   the new Application Settings values are actively used.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Ensure Application Settings categories exist
-- ------------------------------------------------------------

insert into public.application_setting_categories (
  category_code,
  category_name,
  description,
  display_order,
  active
)
values
  ('general', 'General', 'General application identity and product settings.', 10, true),
  ('branding', 'Branding', 'Logo, colours, background, and appearance settings.', 20, true),
  ('modules', 'Modules', 'Module-level configuration and module availability.', 30, true),
  ('visitors', 'Visitors', 'Visitor Management settings, confirmation messages, and visit behaviour.', 40, true),
  ('shared_terminal', 'Shared Terminal', 'Shared Terminal / kiosk display and reset behaviour.', 45, true),
  ('documents', 'Documents / Sign-off', 'Document sign-off, agreements, and compliance settings.', 50, true),
  ('people_assignments', 'People & Assignments', 'People profile and workforce assignment configuration.', 60, true),
  ('working_time', 'Working Time', 'Break rules, work time profiles, rota, and unsociable time rules.', 70, true),
  ('session_security', 'Session Security', 'Staff inactivity, forced actions, and session security settings.', 80, true),
  ('notifications', 'Notifications', 'System messages, alerts, and notification rules.', 90, true),
  ('advanced', 'Advanced / Technical', 'Advanced technical configuration and diagnostics.', 100, true)
on conflict (category_code) do update
set
  category_name = excluded.category_name,
  description = excluded.description,
  display_order = excluded.display_order,
  active = excluded.active;

-- ------------------------------------------------------------
-- 2. General settings
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
    'application.product_name',
    'general',
    'Product name',
    'Display name for the application.',
    'text',
    to_jsonb('Operations Hub'::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    10,
    'text',
    'Used in application headers and future generated documents where supported.'
  ),
  (
    'application.product_subtitle',
    'general',
    'Product subtitle',
    'Optional subtitle shown in selected headers or landing areas.',
    'text',
    to_jsonb('Operations and compliance platform'::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    20,
    'text',
    'Keep this short. Leave blank if no subtitle is required.'
  ),
  (
    'application.environment_label',
    'general',
    'Environment label',
    'Optional environment label such as Test, Demo, Training, or Production.',
    'text',
    to_jsonb(''::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    30,
    'text',
    'Useful for test/demo environments. Leave blank for normal production use.'
  ),
  (
    'application.show_environment_label',
    'general',
    'Show environment label',
    'Controls whether the environment label is displayed.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    40,
    'toggle',
    'Useful in training, demo, or test environments.'
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
-- 3. Branding settings
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
    'branding.logo_url',
    'branding',
    'Logo URL',
    'Logo image URL used by the application where supported.',
    'text',
    to_jsonb(''::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    10,
    'url',
    'Use a hosted image URL. Leave blank to use the default application mark.'
  ),
  (
    'branding.logo_transparent_background',
    'branding',
    'Logo has transparent background',
    'Controls whether the logo is treated as transparent in display areas.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    20,
    'toggle',
    'Enable for transparent PNG/SVG logos.'
  ),
  (
    'branding.theme_mode',
    'branding',
    'Theme mode',
    'Preferred application appearance mode.',
    'select',
    to_jsonb('system'::text),
    jsonb_build_array('system', 'light', 'dark'),
    '{}'::jsonb,
    false,
    false,
    true,
    30,
    'select',
    'System follows the browser/device preference.'
  ),
  (
    'branding.primary_color',
    'branding',
    'Primary colour',
    'Primary brand colour used for key UI accents where supported.',
    'text',
    to_jsonb('#2563eb'::text),
    null,
    jsonb_build_object('format', 'hex_colour'),
    false,
    false,
    true,
    40,
    'colour',
    'Use a hex colour value, for example #2563eb.'
  ),
  (
    'branding.accent_color',
    'branding',
    'Accent colour',
    'Secondary accent colour used for highlights where supported.',
    'text',
    to_jsonb('#0f766e'::text),
    null,
    jsonb_build_object('format', 'hex_colour'),
    false,
    false,
    true,
    50,
    'colour',
    'Use a hex colour value, for example #0f766e.'
  ),
  (
    'branding.background_mode',
    'branding',
    'Background mode',
    'Controls the application background style where supported.',
    'select',
    to_jsonb('default'::text),
    jsonb_build_array('default', 'solid_colour', 'image'),
    '{}'::jsonb,
    false,
    false,
    true,
    60,
    'select',
    'Image mode uses the configured background image URL.'
  ),
  (
    'branding.background_color',
    'branding',
    'Background colour',
    'Solid background colour used when background mode is solid colour.',
    'text',
    to_jsonb('#f8fafc'::text),
    null,
    jsonb_build_object('format', 'hex_colour'),
    false,
    false,
    true,
    70,
    'colour',
    'Use a hex colour value.'
  ),
  (
    'branding.background_image_url',
    'branding',
    'Background image URL',
    'Background image URL used when background mode is image.',
    'text',
    to_jsonb(''::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    80,
    'url',
    'Use a hosted image URL.'
  ),
  (
    'branding.background_opacity',
    'branding',
    'Background opacity',
    'Opacity for background image overlays where supported.',
    'numeric',
    to_jsonb(0.2::numeric),
    null,
    jsonb_build_object('min', 0, 'max', 1, 'step', 0.05),
    false,
    false,
    true,
    90,
    'number',
    'Value between 0 and 1.'
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
-- 4. Visitor settings
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
    'visitors.sign_in_confirmation_message',
    'visitors',
    'Sign-in confirmation message',
    'Message shown after a visitor signs in.',
    'text',
    to_jsonb('You have been signed in successfully.'::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    10,
    'textarea',
    'Shown after successful visitor sign-in.'
  ),
  (
    'visitors.sign_out_confirmation_message',
    'visitors',
    'Sign-out confirmation message',
    'Message shown after a visitor signs out.',
    'text',
    to_jsonb('You have been signed out successfully.'::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    20,
    'textarea',
    'Shown after successful visitor sign-out.'
  ),
  (
    'visitors.confirmation_auto_close_seconds',
    'visitors',
    'Confirmation auto-close seconds',
    'How long visitor confirmation messages remain visible.',
    'integer',
    to_jsonb(5),
    null,
    jsonb_build_object('min', 1, 'max', 60),
    false,
    false,
    true,
    30,
    'number',
    'Default is 5 seconds.'
  ),
  (
    'visitors.require_confirmation_close_button',
    'visitors',
    'Show confirmation close button',
    'Shows a close button on visitor confirmation messages.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    40,
    'toggle',
    'Recommended ON for accessibility and control.'
  ),
  (
    'visitors.prevent_duplicate_planned_visits',
    'visitors',
    'Prevent duplicate planned visits',
    'Prevents creating likely duplicate planned visits where supported.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    50,
    'toggle',
    'Keeps planned visit lists cleaner.'
  ),
  (
    'visitors.prevent_walk_in_when_matching_planned_visit_exists',
    'visitors',
    'Prevent walk-in when matching planned visit exists',
    'Prevents creating a walk-in where the visitor appears to have a matching planned visit.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    60,
    'toggle',
    'Helps staff use the planned visit record rather than creating a duplicate walk-in.'
  ),
  (
    'visitors.auto_end_of_day_sign_out_enabled',
    'visitors',
    'Auto end-of-day visitor sign-out enabled',
    'Enables automatic/opportunistic sign-out for visitors still signed in after end of day where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    70,
    'toggle',
    'Operational safeguard. Existing visitor housekeeping behaviour should remain compatible.'
  ),
  (
    'visitors.auto_end_of_day_sign_out_time',
    'visitors',
    'Auto end-of-day sign-out time',
    'Time used for automatic/opportunistic visitor sign-out.',
    'text',
    to_jsonb('23:59'::text),
    null,
    jsonb_build_object('format', 'time'),
    false,
    false,
    true,
    80,
    'time',
    'Use local site time where applicable.'
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
-- 5. Shared Terminal settings
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
    'shared_terminal.home_title',
    'shared_terminal',
    'Shared Terminal home title',
    'Title shown on the Shared Terminal home screen where supported.',
    'text',
    to_jsonb('Welcome'::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    10,
    'text',
    'Keep short and visitor-friendly.'
  ),
  (
    'shared_terminal.home_subtitle',
    'shared_terminal',
    'Shared Terminal home subtitle',
    'Subtitle shown on the Shared Terminal home screen where supported.',
    'text',
    to_jsonb('Please choose an option to continue.'::text),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    20,
    'text',
    'Optional supporting text.'
  ),
  (
    'shared_terminal.show_staff_login_button',
    'shared_terminal',
    'Show staff login button',
    'Controls whether the staff login button appears on Shared Terminal screens.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    30,
    'toggle',
    'Staff login should remain accessible unless a specific terminal design requires otherwise.'
  ),
  (
    'shared_terminal.return_home_after_action_seconds',
    'shared_terminal',
    'Return home after action seconds',
    'How long after a completed terminal action before returning to the terminal home screen.',
    'integer',
    to_jsonb(5),
    null,
    jsonb_build_object('min', 1, 'max', 120),
    false,
    false,
    true,
    40,
    'number',
    'Separate from staff inactivity timeout.'
  ),
  (
    'shared_terminal.idle_reset_enabled',
    'shared_terminal',
    'Shared Terminal idle reset enabled',
    'Resets the Shared Terminal workflow after inactivity without signing out the terminal.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    50,
    'toggle',
    'Shared Terminal is intended to stay available. This resets the workflow, not the login/session.'
  ),
  (
    'shared_terminal.idle_reset_seconds',
    'shared_terminal',
    'Shared Terminal idle reset seconds',
    'Seconds of terminal inactivity before returning home and clearing partial form data.',
    'integer',
    to_jsonb(120),
    null,
    jsonb_build_object('min', 30, 'max', 3600),
    false,
    false,
    true,
    60,
    'number',
    'Used only when terminal idle reset is enabled.'
  ),
  (
    'shared_terminal.clear_partial_form_data_on_reset',
    'shared_terminal',
    'Clear partial form data on reset',
    'Clears partially entered terminal form data when the terminal idle reset runs.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    70,
    'toggle',
    'Recommended ON to protect visitor privacy.'
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
-- 6. Ensure values exist for seeded definitions
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
  'application.product_name',
  'application.product_subtitle',
  'application.environment_label',
  'application.show_environment_label',

  'branding.logo_url',
  'branding.logo_transparent_background',
  'branding.theme_mode',
  'branding.primary_color',
  'branding.accent_color',
  'branding.background_mode',
  'branding.background_color',
  'branding.background_image_url',
  'branding.background_opacity',

  'visitors.sign_in_confirmation_message',
  'visitors.sign_out_confirmation_message',
  'visitors.confirmation_auto_close_seconds',
  'visitors.require_confirmation_close_button',
  'visitors.prevent_duplicate_planned_visits',
  'visitors.prevent_walk_in_when_matching_planned_visit_exists',
  'visitors.auto_end_of_day_sign_out_enabled',
  'visitors.auto_end_of_day_sign_out_time',

  'shared_terminal.home_title',
  'shared_terminal.home_subtitle',
  'shared_terminal.show_staff_login_button',
  'shared_terminal.return_home_after_action_seconds',
  'shared_terminal.idle_reset_enabled',
  'shared_terminal.idle_reset_seconds',
  'shared_terminal.clear_partial_form_data_on_reset'
)
on conflict (setting_key) do nothing;

-- ------------------------------------------------------------
-- 7. Reset helpers
-- ------------------------------------------------------------

create or replace function public.reset_application_setting_to_default(
  p_setting_key text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_definition record;
begin
  if not public.can_manage_application_settings() then
    raise exception 'You do not have permission to manage application settings';
  end if;

  select *
  into v_definition
  from public.application_setting_definitions d
  where d.setting_key = p_setting_key
    and d.active is true;

  if not found then
    raise exception 'Application setting was not found';
  end if;

  if v_definition.locked_by_system is true then
    raise exception 'This setting is locked by the system';
  end if;

  insert into public.application_setting_values (
    setting_key,
    setting_value,
    updated_by,
    updated_at
  )
  values (
    p_setting_key,
    v_definition.default_value,
    auth.uid(),
    now()
  )
  on conflict (setting_key) do update
  set
    setting_value = excluded.setting_value,
    updated_by = excluded.updated_by,
    updated_at = now();

  begin
    perform public.write_audit_event(
      'application_setting.reset_to_default',
      'application_setting_values',
      p_setting_key,
      jsonb_build_object(
        'summary', 'Application setting reset to default.',
        'setting_key', p_setting_key
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during application setting reset: %', sqlerrm;
  end;

  return p_setting_key;
end;
$$;

grant execute on function public.reset_application_setting_to_default(text) to authenticated;

create or replace function public.reset_application_settings_category_to_defaults(
  p_category_code text
)
returns table (
  setting_key text,
  reset boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_setting record;
begin
  if not public.can_manage_application_settings() then
    raise exception 'You do not have permission to manage application settings';
  end if;

  if nullif(trim(coalesce(p_category_code, '')), '') is null then
    raise exception 'Category is required';
  end if;

  for v_setting in
    select *
    from public.application_setting_definitions d
    where d.category_code = p_category_code
      and d.active is true
      and d.locked_by_system is false
    order by d.display_order asc nulls last, d.setting_key asc
  loop
    insert into public.application_setting_values (
      setting_key,
      setting_value,
      updated_by,
      updated_at
    )
    values (
      v_setting.setting_key,
      v_setting.default_value,
      auth.uid(),
      now()
    )
    on conflict (setting_key) do update
    set
      setting_value = excluded.setting_value,
      updated_by = excluded.updated_by,
      updated_at = now();

    setting_key := v_setting.setting_key;
    reset := true;
    return next;
  end loop;

  begin
    perform public.write_audit_event(
      'application_settings.category_reset_to_defaults',
      'application_setting_values',
      p_category_code,
      jsonb_build_object(
        'summary', 'Application settings category reset to defaults.',
        'category_code', p_category_code
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during application settings category reset: %', sqlerrm;
  end;
end;
$$;

grant execute on function public.reset_application_settings_category_to_defaults(text) to authenticated;

-- ------------------------------------------------------------
-- 8. Verification
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

select
  'OHP-017C general branding visitor shared terminal settings installed' as result,
  (select count(*) from public.application_setting_definitions where category_code = 'general') as general_settings,
  (select count(*) from public.application_setting_definitions where category_code = 'branding') as branding_settings,
  (select count(*) from public.application_setting_definitions where category_code = 'visitors') as visitor_settings,
  (select count(*) from public.application_setting_definitions where category_code = 'shared_terminal') as shared_terminal_settings;