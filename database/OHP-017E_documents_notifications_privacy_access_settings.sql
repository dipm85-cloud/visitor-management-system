-- ============================================================
-- Operations Hub - OHP-017E
-- Documents, Notifications, Privacy and Access Settings Consolidation
--
-- Purpose:
-- - Add controlled Application Settings registry keys for:
--   - Documents / Sign-off
--   - Notifications / System Messages
--   - Privacy / Data Governance
--   - Access Control / Diagnostics
-- - Continue settings migration without deleting legacy storage.
--
-- Safety:
-- - Admins cannot create arbitrary settings.
-- - Existing module-specific settings remain available as fallback/bridge.
-- - High-risk security/privacy controls are either locked or conservative.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Ensure setting categories exist
-- ------------------------------------------------------------

insert into public.application_setting_categories (
  category_code,
  category_name,
  description,
  display_order,
  active
)
values
  ('documents', 'Documents / Sign-off', 'Document sign-off, agreements, evidence, and compliance settings.', 50, true),
  ('notifications', 'Notifications', 'System messages, alerts, and notification defaults.', 90, true),
  ('privacy_data_governance', 'Privacy / Data Governance', 'Privacy cases, SAR support, anonymisation, and data-governance settings.', 95, true),
  ('access_diagnostics', 'Access Control / Diagnostics', 'Access control, role assignment, capability diagnostics, and admin diagnostics settings.', 98, true),
  ('advanced', 'Advanced / Technical', 'Advanced technical configuration and diagnostics.', 100, true)
on conflict (category_code) do update
set
  category_name = excluded.category_name,
  description = excluded.description,
  display_order = excluded.display_order,
  active = excluded.active;

-- ------------------------------------------------------------
-- 2. Application Settings permission helpers
-- ------------------------------------------------------------

create or replace function public.can_view_application_settings()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('application_settings.view')
      or public.user_has_capability('application_settings.manage')
      or public.user_has_capability('settings.view')
      or public.user_has_capability('settings.edit')
      or public.user_has_capability('module_configuration.view')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('agreements.view')
      or public.user_has_capability('agreements.manage')
      or public.user_has_capability('document_signoff.manage')
      or public.user_has_capability('privacy.case.view')
      or public.user_has_capability('privacy.case.manage')
      or public.user_has_capability('privacy.view')
      or public.user_has_capability('privacy.manage')
      or public.user_has_capability('gdpr.view')
      or public.user_has_capability('gdpr.manage')
      or public.user_has_capability('audit.view')
      or public.user_has_capability('online_users.view')
      or public.user_has_capability('admin_system_messages.view')
      or public.user_has_capability('admin_system_messages.send')
      or public.user_has_capability('admin_system_messages.force_action')
      or public.user_has_capability('access_control.view')
      or public.user_has_capability('access_control.manage')
      or public.user_has_capability('role_presets.view')
      or public.user_has_capability('role_presets.manage')
      or public.user_has_capability('user_role_assignments.view')
      or public.user_has_capability('user_role_assignments.manage')
      or public.user_has_capability('capabilities.diagnose')
    );
$$;

create or replace function public.can_manage_application_settings()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('application_settings.manage')
      or public.user_has_capability('settings.edit')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('access_control.manage')
    );
$$;

create or replace function public.can_manage_application_settings_category(
  p_category_code text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.can_manage_application_settings()
    or case coalesce(p_category_code, '')
      when 'documents' then
        public.user_has_capability('agreements.manage')
        or public.user_has_capability('document_signoff.manage')
      when 'notifications' then
        public.user_has_capability('admin_system_messages.send')
        or public.user_has_capability('admin_system_messages.force_action')
      when 'privacy_data_governance' then
        public.user_has_capability('privacy.case.manage')
        or public.user_has_capability('privacy.manage')
        or public.user_has_capability('gdpr.manage')
      when 'access_diagnostics' then
        public.user_has_capability('access_control.manage')
        or public.user_has_capability('role_presets.manage')
        or public.user_has_capability('user_role_assignments.manage')
      else
        false
    end;
$$;

create or replace function public.can_manage_application_setting(
  p_setting_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.application_setting_definitions d
    where d.setting_key = p_setting_key
      and d.active is true
      and public.can_manage_application_settings_category(d.category_code)
  );
$$;

grant execute on function public.can_view_application_settings() to authenticated;
grant execute on function public.can_manage_application_settings() to authenticated;
grant execute on function public.can_manage_application_settings_category(text) to authenticated;
grant execute on function public.can_manage_application_setting(text) to authenticated;

-- ------------------------------------------------------------
-- 3. Documents / Sign-off settings
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
    'document_signoff.use_confirmed_identity_links_for_compliance',
    'documents',
    'Use confirmed identity links for compliance',
    'Allows document/sign-off compliance checks to use confirmed identity links where the platform has safely established them.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    10,
    'toggle',
    'When enabled, confirmed identity links can satisfy document/sign-off compliance. Same-name matching alone is never enough.'
  ),
  (
    'document_signoff.show_canonical_identity_context',
    'documents',
    'Show canonical identity context',
    'Shows canonical identity and signed-as/captured identity context in document evidence views where available.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    20,
    'toggle',
    'Recommended ON. Helps explain linked evidence without rewriting source records.'
  ),
  (
    'document_signoff.print_use_branding_logo',
    'documents',
    'Use branding logo on document printouts',
    'Uses the configured branding print logo or main logo on supported document/sign-off printouts.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    30,
    'toggle',
    'Uses print logo first, then main logo, then default app mark.'
  ),
  (
    'document_signoff.default_evidence_detail_level',
    'documents',
    'Default evidence detail level',
    'Controls the default detail level shown for document/sign-off evidence where supported.',
    'select',
    to_jsonb('standard'::text),
    jsonb_build_array('compact', 'standard', 'detailed'),
    '{}'::jsonb,
    false,
    false,
    true,
    40,
    'select',
    'Standard is recommended for normal operations.'
  ),
  (
    'document_signoff.require_scroll_to_end_before_signing',
    'documents',
    'Require scroll to end before signing',
    'Reserved for a future controlled document viewer. Not enforced until viewer support is complete.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    true,
    false,
    true,
    90,
    'toggle',
    'Locked by system for now. This will be enabled only when a reliable controlled document viewer exists.'
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
-- 4. Notifications / System Messages settings
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
    'notifications.default_message_type',
    'notifications',
    'Default system message type',
    'Default message type selected when sending an admin system message.',
    'select',
    to_jsonb('info'::text),
    jsonb_build_array('info', 'warning', 'maintenance', 'access_update', 'refresh_required'),
    '{}'::jsonb,
    false,
    false,
    true,
    10,
    'select',
    'Used as a default only. Admins can still choose a different type when sending.'
  ),
  (
    'notifications.default_message_expiry_minutes',
    'notifications',
    'Default message expiry minutes',
    'Default expiry time for admin system messages.',
    'integer',
    to_jsonb(60),
    null,
    jsonb_build_object('min', 5, 'max', 1440),
    false,
    false,
    true,
    20,
    'number',
    'Default is 60 minutes.'
  ),
  (
    'notifications.default_required_action_grace_seconds',
    'notifications',
    'Default required-action grace seconds',
    'Default grace period for required refresh/sign-out actions.',
    'integer',
    to_jsonb(300),
    null,
    jsonb_build_object('min', 30, 'max', 86400),
    false,
    false,
    true,
    30,
    'number',
    'Default is 300 seconds / 5 minutes.'
  ),
  (
    'notifications.default_force_after_grace',
    'notifications',
    'Default force after grace period',
    'Default state for forcing required actions after the grace period.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    40,
    'toggle',
    'Recommended OFF. Forced actions should be deliberate.'
  ),
  (
    'notifications.online_users_default_window_seconds',
    'notifications',
    'Online users default window seconds',
    'Default recent-activity window used by Online Users / probably-online views.',
    'integer',
    to_jsonb(120),
    null,
    jsonb_build_object('min', 30, 'max', 3600),
    false,
    false,
    true,
    50,
    'number',
    'Presence is probably-online, not guaranteed attendance.'
  ),
  (
    'notifications.message_history_default_rows',
    'notifications',
    'Message history default rows',
    'Default number of rows shown in System Message History.',
    'integer',
    to_jsonb(100),
    null,
    jsonb_build_object('min', 25, 'max', 500),
    false,
    false,
    true,
    60,
    'number',
    'Users can still change row limits in the history view where supported.'
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
-- 5. Privacy / Data Governance settings
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
    'privacy.case_reference_prefix',
    'privacy_data_governance',
    'Privacy case reference prefix',
    'Prefix used for privacy case references where supported.',
    'text',
    to_jsonb('PRIV'::text),
    null,
    jsonb_build_object('maxLength', 12),
    false,
    false,
    true,
    10,
    'text',
    'Keep short. Example: PRIV or SAR.'
  ),
  (
    'privacy.sar_pack_include_timeline_by_default',
    'privacy_data_governance',
    'SAR pack includes timeline by default',
    'Controls whether SAR/evidence packs include the case timeline by default where supported.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    20,
    'toggle',
    'Recommended ON for transparency and auditability.'
  ),
  (
    'privacy.sar_pack_include_source_references_by_default',
    'privacy_data_governance',
    'SAR pack includes source references by default',
    'Controls whether SAR/evidence packs include source/reference identifiers by default where supported.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    30,
    'toggle',
    'Recommended ON for internal evidence review.'
  ),
  (
    'privacy.anonymisation_requires_preview',
    'privacy_data_governance',
    'Anonymisation requires preview',
    'Requires anonymisation preview before anonymisation can proceed.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    true,
    false,
    true,
    40,
    'toggle',
    'Locked by system. Preview is required as a safety guardrail.'
  ),
  (
    'privacy.anonymisation_requires_confirmation_phrase',
    'privacy_data_governance',
    'Anonymisation requires confirmation phrase',
    'Requires a confirmation phrase for anonymisation operations.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    true,
    false,
    true,
    50,
    'toggle',
    'Locked by system. Confirmation phrase protects against accidental irreversible actions.'
  ),
  (
    'privacy.show_technical_references_by_default',
    'privacy_data_governance',
    'Show technical references by default',
    'Controls whether technical references/UUIDs are expanded by default in privacy views where supported.',
    'boolean',
    to_jsonb(false),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    60,
    'toggle',
    'Usually OFF. Technical references can still be available in advanced detail areas.'
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
-- 6. Access Control / Diagnostics settings
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
    'access_diagnostics.capability_inspector_available',
    'access_diagnostics',
    'Capability Inspector available',
    'Indicates whether Capability Inspector is available to users with the required diagnostic capability.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    true,
    false,
    true,
    10,
    'toggle',
    'Locked by system. Access is controlled by capabilities.'
  ),
  (
    'access_diagnostics.capability_inspector_session_only',
    'access_diagnostics',
    'Capability Inspector is session-only',
    'Indicates whether Capability Inspector mode is session-only.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    true,
    false,
    true,
    20,
    'toggle',
    'Locked by system. Inspector mode should not persist as a normal user setting.'
  ),
  (
    'access_diagnostics.show_effective_capability_source',
    'access_diagnostics',
    'Show effective capability source',
    'Shows whether effective capabilities come from role presets, direct allows, direct denies, or are not granted where supported.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    30,
    'toggle',
    'Useful for access-control troubleshooting.'
  ),
  (
    'access_diagnostics.default_user_assignment_include_inactive',
    'access_diagnostics',
    'Include inactive users by default',
    'Controls whether user role assignment lists include inactive profiles by default where supported.',
    'boolean',
    to_jsonb(true),
    null,
    '{}'::jsonb,
    false,
    false,
    true,
    40,
    'toggle',
    'Admins can still filter the list where supported.'
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
-- 7. Category-aware write/reset RPCs
-- ------------------------------------------------------------

create or replace function public.update_application_setting(
  p_setting_key text,
  p_setting_value jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_definition record;
  v_normalized_value jsonb;
begin
  select *
  into v_definition
  from public.application_setting_definitions d
  where d.setting_key = p_setting_key
    and d.active is true;

  if not found then
    raise exception 'Application setting was not found';
  end if;

  if not public.can_manage_application_settings_category(v_definition.category_code) then
    raise exception 'You do not have permission to manage this application settings category';
  end if;

  if v_definition.locked_by_system is true then
    raise exception 'This setting is locked by the system';
  end if;

  if p_setting_value is null then
    raise exception 'Setting value is required';
  end if;

  v_normalized_value := p_setting_value;

  if v_definition.value_type = 'boolean'
     and jsonb_typeof(v_normalized_value) <> 'boolean' then
    raise exception 'Expected boolean setting value';
  end if;

  if v_definition.value_type in ('integer', 'numeric')
     and jsonb_typeof(v_normalized_value) <> 'number' then
    raise exception 'Expected numeric setting value';
  end if;

  if v_definition.value_type in ('text', 'select')
     and jsonb_typeof(v_normalized_value) <> 'string' then
    raise exception 'Expected text setting value';
  end if;

  if v_definition.allowed_values is not null
     and jsonb_typeof(v_definition.allowed_values) = 'array'
     and not exists (
       select 1
       from jsonb_array_elements(v_definition.allowed_values) av(value)
       where av.value = v_normalized_value
     ) then
    raise exception 'Setting value is not in the allowed values list';
  end if;

  insert into public.application_setting_values (
    setting_key,
    setting_value,
    updated_by,
    updated_at
  )
  values (
    p_setting_key,
    v_normalized_value,
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
      'application_setting.updated',
      'application_setting_values',
      p_setting_key,
      jsonb_build_object(
        'summary', 'Application setting updated.',
        'setting_key', p_setting_key
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during application setting update: %', sqlerrm;
  end;

  return p_setting_key;
end;
$$;

grant execute on function public.update_application_setting(text, jsonb) to authenticated;

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
  select *
  into v_definition
  from public.application_setting_definitions d
  where d.setting_key = p_setting_key
    and d.active is true;

  if not found then
    raise exception 'Application setting was not found';
  end if;

  if not public.can_manage_application_settings_category(v_definition.category_code) then
    raise exception 'You do not have permission to manage this application settings category';
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
  if nullif(trim(coalesce(p_category_code, '')), '') is null then
    raise exception 'Category is required';
  end if;

  if not public.can_manage_application_settings_category(p_category_code) then
    raise exception 'You do not have permission to manage this application settings category';
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
-- 8. Ensure values exist
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
  -- Documents
  'document_signoff.use_confirmed_identity_links_for_compliance',
  'document_signoff.show_canonical_identity_context',
  'document_signoff.print_use_branding_logo',
  'document_signoff.default_evidence_detail_level',
  'document_signoff.require_scroll_to_end_before_signing',

  -- Notifications
  'notifications.default_message_type',
  'notifications.default_message_expiry_minutes',
  'notifications.default_required_action_grace_seconds',
  'notifications.default_force_after_grace',
  'notifications.online_users_default_window_seconds',
  'notifications.message_history_default_rows',

  -- Privacy
  'privacy.case_reference_prefix',
  'privacy.sar_pack_include_timeline_by_default',
  'privacy.sar_pack_include_source_references_by_default',
  'privacy.anonymisation_requires_preview',
  'privacy.anonymisation_requires_confirmation_phrase',
  'privacy.show_technical_references_by_default',

  -- Access diagnostics
  'access_diagnostics.capability_inspector_available',
  'access_diagnostics.capability_inspector_session_only',
  'access_diagnostics.show_effective_capability_source',
  'access_diagnostics.default_user_assignment_include_inactive'
)
on conflict (setting_key) do nothing;

-- ------------------------------------------------------------
-- 9. Verification
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

select
  'OHP-017E platform settings consolidation installed' as result,
  (select count(*) from public.application_setting_definitions where category_code = 'documents') as document_settings,
  (select count(*) from public.application_setting_definitions where category_code = 'notifications') as notification_settings,
  (select count(*) from public.application_setting_definitions where category_code = 'privacy_data_governance') as privacy_settings,
  (select count(*) from public.application_setting_definitions where category_code = 'access_diagnostics') as access_diagnostic_settings;
