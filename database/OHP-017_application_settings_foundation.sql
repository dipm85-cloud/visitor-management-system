-- ============================================================
-- Operations Hub - OHP-017 Application Settings Foundation
--
-- Purpose:
-- - Create a central Application Settings foundation.
-- - Add capability-gated access to settings.
-- - Add a safe settings registry.
-- - Add configurable Assignment Field Requirements.
-- - Keep system-required fields locked.
--
-- Safety:
-- - Admins cannot create arbitrary setting keys.
-- - Admins can only change platform-defined settings/rules.
-- - System-required fields remain locked.
-- - Existing legacy settings are not removed.
-- - Existing assignment behaviour is preserved until admin enables
--   configurable required fields.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Capability catalogue
-- ------------------------------------------------------------

insert into public.capability_groups (
  group_code,
  group_name,
  description,
  display_order,
  active
)
values (
  'application_settings',
  'Application Settings',
  'Central application settings and controlled business configuration.',
  120,
  true
)
on conflict (group_code) do update
set
  group_name = excluded.group_name,
  description = excluded.description,
  display_order = excluded.display_order,
  active = true;

insert into public.capabilities (
  capability_code,
  capability_name,
  group_id,
  description,
  active
)
select
  c.capability_code,
  c.capability_name,
  cg.id,
  c.capability_description,
  true
from public.capability_groups cg
cross join (
  values
    (
      'application_settings.view',
      'View application settings',
      'Allows authorised users to view the central Application Settings workspace.'
    ),
    (
      'application_settings.manage',
      'Manage application settings',
      'Allows authorised users to manage central application settings exposed by the platform.'
    ),
    (
      'assignment_field_requirements.view',
      'View assignment field requirements',
      'Allows authorised users to view assignment field requirement configuration.'
    ),
    (
      'assignment_field_requirements.manage',
      'Manage assignment field requirements',
      'Allows authorised users to configure which assignment fields are required where the platform allows it.'
    )
) as c(capability_code, capability_name, capability_description)
where cg.group_code = 'application_settings'
on conflict (capability_code) do update
set
  capability_name = excluded.capability_name,
  group_id = excluded.group_id,
  description = excluded.description,
  active = true;

-- SuperUser gets these capabilities by default.
insert into public.role_preset_capabilities (
  role_preset_id,
  capability_id
)
select
  rp.id,
  c.id
from public.role_presets rp
cross join public.capabilities c
where rp.role_code = 'super_user'
  and c.capability_code in (
    'application_settings.view',
    'application_settings.manage',
    'assignment_field_requirements.view',
    'assignment_field_requirements.manage'
  )
on conflict do nothing;

-- ------------------------------------------------------------
-- 2. Permission helpers
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
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('access_control.manage')
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

create or replace function public.can_view_assignment_field_requirements()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('assignment_field_requirements.view')
      or public.user_has_capability('assignment_field_requirements.manage')
      or public.user_has_capability('application_settings.view')
      or public.user_has_capability('application_settings.manage')
      or public.user_has_capability('work_time_profiles.view')
      or public.user_has_capability('work_time_profiles.manage')
      or public.user_has_capability('workforce_calendar.manage')
      or public.user_has_capability('settings.view')
      or public.user_has_capability('settings.edit')
      or public.user_has_capability('access_control.manage')
    );
$$;

create or replace function public.can_manage_assignment_field_requirements()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('assignment_field_requirements.manage')
      or public.user_has_capability('application_settings.manage')
      or public.user_has_capability('workforce_calendar.manage')
      or public.user_has_capability('settings.edit')
      or public.user_has_capability('access_control.manage')
    );
$$;

grant execute on function public.can_view_application_settings() to authenticated;
grant execute on function public.can_manage_application_settings() to authenticated;
grant execute on function public.can_view_assignment_field_requirements() to authenticated;
grant execute on function public.can_manage_assignment_field_requirements() to authenticated;

-- ------------------------------------------------------------
-- 3. Application Settings categories and registry
-- ------------------------------------------------------------

create table if not exists public.application_setting_categories (
  category_code text primary key,
  category_name text not null,
  description text,
  display_order integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint application_setting_categories_code_not_blank
    check (length(trim(category_code)) > 0),

  constraint application_setting_categories_name_not_blank
    check (length(trim(category_name)) > 0)
);

create table if not exists public.application_setting_definitions (
  setting_key text primary key,
  category_code text not null references public.application_setting_categories(category_code) on delete restrict,

  setting_name text not null,
  description text,

  value_type text not null,
  default_value jsonb not null default 'null'::jsonb,
  allowed_values jsonb,
  validation_json jsonb not null default '{}'::jsonb,

  locked_by_system boolean not null default false,
  sensitive boolean not null default false,
  active boolean not null default true,

  display_order integer,
  ui_component text,
  help_text text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint application_setting_definitions_key_not_blank
    check (length(trim(setting_key)) > 0),

  constraint application_setting_definitions_name_not_blank
    check (length(trim(setting_name)) > 0),

  constraint application_setting_definitions_value_type_check
    check (value_type in ('boolean', 'integer', 'numeric', 'text', 'select', 'json'))
);

create table if not exists public.application_setting_values (
  setting_key text primary key references public.application_setting_definitions(setting_key) on delete cascade,

  setting_value jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),

  created_at timestamptz not null default now()
);

create index if not exists idx_application_setting_definitions_category
on public.application_setting_definitions(category_code, display_order);

-- ------------------------------------------------------------
-- 4. Updated-at helper
-- ------------------------------------------------------------

create or replace function public.oh_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_application_setting_categories_updated_at
on public.application_setting_categories;

create trigger trg_application_setting_categories_updated_at
before update on public.application_setting_categories
for each row
execute function public.oh_set_updated_at();

drop trigger if exists trg_application_setting_definitions_updated_at
on public.application_setting_definitions;

create trigger trg_application_setting_definitions_updated_at
before update on public.application_setting_definitions
for each row
execute function public.oh_set_updated_at();

-- ------------------------------------------------------------
-- 5. Application Setting RLS
-- ------------------------------------------------------------

alter table public.application_setting_categories enable row level security;
alter table public.application_setting_definitions enable row level security;
alter table public.application_setting_values enable row level security;

drop policy if exists "admins can view setting categories" on public.application_setting_categories;
drop policy if exists "admins can view setting definitions" on public.application_setting_definitions;
drop policy if exists "admins can view setting values" on public.application_setting_values;
drop policy if exists "admins can update setting values" on public.application_setting_values;
drop policy if exists "admins can insert setting values" on public.application_setting_values;

create policy "admins can view setting categories"
on public.application_setting_categories
for select
to authenticated
using (public.can_view_application_settings());

create policy "admins can view setting definitions"
on public.application_setting_definitions
for select
to authenticated
using (public.can_view_application_settings());

create policy "admins can view setting values"
on public.application_setting_values
for select
to authenticated
using (public.can_view_application_settings());

create policy "admins can insert setting values"
on public.application_setting_values
for insert
to authenticated
with check (public.can_manage_application_settings());

create policy "admins can update setting values"
on public.application_setting_values
for update
to authenticated
using (public.can_manage_application_settings())
with check (public.can_manage_application_settings());

grant select on public.application_setting_categories to authenticated;
grant select on public.application_setting_definitions to authenticated;
grant select, insert, update on public.application_setting_values to authenticated;

-- ------------------------------------------------------------
-- 6. Seed Application Settings categories
-- ------------------------------------------------------------

insert into public.application_setting_categories (
  category_code,
  category_name,
  description,
  display_order,
  active
)
values
  ('general', 'General', 'General application settings and product identity.', 10, true),
  ('branding', 'Branding', 'Logo, colours, appearance, and visual identity settings.', 20, true),
  ('modules', 'Modules', 'Module availability and module-level configuration.', 30, true),
  ('visitors', 'Visitors', 'Visitor Management and Shared Terminal settings.', 40, true),
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
-- 7. Seed controlled setting definitions
-- ------------------------------------------------------------
-- These are registry items only. Admins can change values only through
-- platform-defined keys, not arbitrary settings.

insert into public.application_setting_definitions (
  setting_key,
  category_code,
  setting_name,
  description,
  value_type,
  default_value,
  allowed_values,
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
    false,
    false,
    true,
    10,
    'text',
    'Used in application headers and future generated documents where supported.'
  ),
  (
    'application.settings_workspace_enabled',
    'general',
    'Application Settings workspace enabled',
    'Controls whether the new central Application Settings workspace is available.',
    'boolean',
    to_jsonb(true),
    null,
    true,
    false,
    true,
    20,
    'toggle',
    'Locked by system. The workspace is required once enabled.'
  ),
  (
    'assignments.field_requirements_enabled',
    'people_assignments',
    'Assignment field requirements enabled',
    'Enables configurable required-field validation for assignment create/edit flows.',
    'boolean',
    to_jsonb(true),
    null,
    false,
    false,
    true,
    10,
    'toggle',
    'When enabled, assignment forms use the configured field requirement rules.'
  ),
  (
    'assignments.enforce_requirements_on_save',
    'people_assignments',
    'Enforce assignment requirements on save',
    'Blocks assignment save when configured required fields are missing.',
    'boolean',
    to_jsonb(true),
    null,
    false,
    false,
    true,
    20,
    'toggle',
    'Recommended ON. This does not allow system-required fields to be unlocked.'
  ),
  (
    'settings.show_legacy_vms_settings_link',
    'advanced',
    'Show legacy VMS settings link',
    'Shows a link from Application Settings to the older VMS settings area while migration is in progress.',
    'boolean',
    to_jsonb(true),
    null,
    false,
    false,
    true,
    200,
    'toggle',
    'Temporary bridge while legacy Visitor settings are migrated.'
  )
on conflict (setting_key) do update
set
  category_code = excluded.category_code,
  setting_name = excluded.setting_name,
  description = excluded.description,
  value_type = excluded.value_type,
  default_value = excluded.default_value,
  allowed_values = excluded.allowed_values,
  locked_by_system = excluded.locked_by_system,
  sensitive = excluded.sensitive,
  active = excluded.active,
  display_order = excluded.display_order,
  ui_component = excluded.ui_component,
  help_text = excluded.help_text;

-- Ensure values exist for all seeded definitions.
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
  'application.settings_workspace_enabled',
  'assignments.field_requirements_enabled',
  'assignments.enforce_requirements_on_save',
  'settings.show_legacy_vms_settings_link'
)
on conflict (setting_key) do nothing;

-- ------------------------------------------------------------
-- 8. Field requirement framework
-- ------------------------------------------------------------

create table if not exists public.field_requirement_areas (
  area_code text primary key,
  area_name text not null,
  description text,
  display_order integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint field_requirement_areas_code_not_blank
    check (length(trim(area_code)) > 0),

  constraint field_requirement_areas_name_not_blank
    check (length(trim(area_name)) > 0)
);

create table if not exists public.field_requirement_definitions (
  id uuid primary key default gen_random_uuid(),

  area_code text not null references public.field_requirement_areas(area_code) on delete cascade,

  field_key text not null,
  field_label text not null,
  description text,

  system_required boolean not null default false,
  configurable boolean not null default true,
  default_required boolean not null default false,
  default_visible boolean not null default true,

  validation_keys text[] not null default '{}',
  input_type text,
  display_order integer,
  active boolean not null default true,
  help_text text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(area_code, field_key),

  constraint field_requirement_definitions_key_not_blank
    check (length(trim(field_key)) > 0),

  constraint field_requirement_definitions_label_not_blank
    check (length(trim(field_label)) > 0),

  constraint field_requirement_system_required_locked_check
    check (
      configurable is true
      or system_required is true
      or default_required is false
    )
);

create table if not exists public.field_requirement_rules (
  field_definition_id uuid primary key references public.field_requirement_definitions(id) on delete cascade,

  is_required boolean not null,
  is_visible boolean not null default true,

  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_field_requirement_definitions_area_order
on public.field_requirement_definitions(area_code, display_order);

drop trigger if exists trg_field_requirement_areas_updated_at
on public.field_requirement_areas;

create trigger trg_field_requirement_areas_updated_at
before update on public.field_requirement_areas
for each row
execute function public.oh_set_updated_at();

drop trigger if exists trg_field_requirement_definitions_updated_at
on public.field_requirement_definitions;

create trigger trg_field_requirement_definitions_updated_at
before update on public.field_requirement_definitions
for each row
execute function public.oh_set_updated_at();

-- ------------------------------------------------------------
-- 9. Field requirement RLS
-- ------------------------------------------------------------

alter table public.field_requirement_areas enable row level security;
alter table public.field_requirement_definitions enable row level security;
alter table public.field_requirement_rules enable row level security;

drop policy if exists "admins can view field requirement areas" on public.field_requirement_areas;
drop policy if exists "admins can view field requirement definitions" on public.field_requirement_definitions;
drop policy if exists "admins can view field requirement rules" on public.field_requirement_rules;
drop policy if exists "admins can insert field requirement rules" on public.field_requirement_rules;
drop policy if exists "admins can update field requirement rules" on public.field_requirement_rules;

create policy "admins can view field requirement areas"
on public.field_requirement_areas
for select
to authenticated
using (public.can_view_assignment_field_requirements());

create policy "admins can view field requirement definitions"
on public.field_requirement_definitions
for select
to authenticated
using (public.can_view_assignment_field_requirements());

create policy "admins can view field requirement rules"
on public.field_requirement_rules
for select
to authenticated
using (public.can_view_assignment_field_requirements());

create policy "admins can insert field requirement rules"
on public.field_requirement_rules
for insert
to authenticated
with check (public.can_manage_assignment_field_requirements());

create policy "admins can update field requirement rules"
on public.field_requirement_rules
for update
to authenticated
using (public.can_manage_assignment_field_requirements())
with check (public.can_manage_assignment_field_requirements());

grant select on public.field_requirement_areas to authenticated;
grant select on public.field_requirement_definitions to authenticated;
grant select, insert, update on public.field_requirement_rules to authenticated;

-- ------------------------------------------------------------
-- 10. Seed Assignment field requirement definitions
-- ------------------------------------------------------------

insert into public.field_requirement_areas (
  area_code,
  area_name,
  description,
  display_order,
  active
)
values (
  'work_assignments',
  'Assignments',
  'Field requirement configuration for workforce/person assignment create and edit flows.',
  10,
  true
)
on conflict (area_code) do update
set
  area_name = excluded.area_name,
  description = excluded.description,
  display_order = excluded.display_order,
  active = excluded.active;

-- System-required fields are shown as locked.
-- Configurable fields default optional to preserve current behaviour.
-- Admin can make configurable fields required.

insert into public.field_requirement_definitions (
  area_code,
  field_key,
  field_label,
  description,
  system_required,
  configurable,
  default_required,
  default_visible,
  validation_keys,
  input_type,
  display_order,
  active,
  help_text
)
values
  (
    'work_assignments',
    'person',
    'Person',
    'The person being assigned.',
    true,
    false,
    true,
    true,
    array['person_id', 'profile_id', 'people_id', 'personId'],
    'reference',
    10,
    true,
    'Locked by system. An assignment must belong to a person.'
  ),
  (
    'work_assignments',
    'start_date',
    'Start date',
    'The assignment start date.',
    true,
    false,
    true,
    true,
    array['start_date', 'assignment_start_date', 'effective_from', 'startDate'],
    'date',
    20,
    true,
    'Locked by system. An assignment must have a start date.'
  ),
  (
    'work_assignments',
    'contract',
    'Contract',
    'The contract or workstream for the assignment.',
    false,
    true,
    false,
    true,
    array['contract_id', 'contract', 'contractId'],
    'reference',
    30,
    true,
    'Can be required by company policy.'
  ),
  (
    'work_assignments',
    'department',
    'Department',
    'The department for the assignment.',
    false,
    true,
    false,
    true,
    array['department_id', 'department', 'departmentId'],
    'reference',
    40,
    true,
    'Can be required by company policy.'
  ),
  (
    'work_assignments',
    'site',
    'Site',
    'The site/location for the assignment.',
    false,
    true,
    false,
    true,
    array['site_id', 'site', 'siteId', 'location_id', 'location'],
    'reference',
    50,
    true,
    'Can be required by company policy.'
  ),
  (
    'work_assignments',
    'employer',
    'Employer',
    'The employer/agency/company for the assignment.',
    false,
    true,
    false,
    true,
    array['employer_id', 'employer', 'employerId', 'company_id', 'company'],
    'reference',
    60,
    true,
    'Can be required by company policy.'
  ),
  (
    'work_assignments',
    'job_role',
    'Role / Job title',
    'The role or job title for the assignment.',
    false,
    true,
    false,
    true,
    array['role_id', 'job_role_id', 'job_title', 'role', 'jobRoleId'],
    'reference',
    70,
    true,
    'Can be required by company policy.'
  ),
  (
    'work_assignments',
    'shift_pattern',
    'Shift pattern',
    'The shift pattern assigned to the person.',
    false,
    true,
    false,
    true,
    array['shift_pattern_id', 'shift_pattern', 'shiftPatternId'],
    'reference',
    80,
    true,
    'Can be required by company policy.'
  ),
  (
    'work_assignments',
    'work_time_profile',
    'Work Time Profile',
    'The working time template for the assignment.',
    false,
    true,
    false,
    true,
    array['work_time_profile_id', 'work_time_profile', 'workTimeProfileId'],
    'reference',
    90,
    true,
    'Recommended for rota/LMT readiness.'
  ),
  (
    'work_assignments',
    'notes',
    'Notes',
    'Assignment notes or comments.',
    false,
    true,
    false,
    true,
    array['notes', 'assignment_notes'],
    'textarea',
    200,
    true,
    'Optional notes field.'
  )
on conflict (area_code, field_key) do update
set
  field_label = excluded.field_label,
  description = excluded.description,
  system_required = excluded.system_required,
  configurable = excluded.configurable,
  default_required = excluded.default_required,
  default_visible = excluded.default_visible,
  validation_keys = excluded.validation_keys,
  input_type = excluded.input_type,
  display_order = excluded.display_order,
  active = excluded.active,
  help_text = excluded.help_text;

-- Ensure rules exist from definitions.
insert into public.field_requirement_rules (
  field_definition_id,
  is_required,
  is_visible,
  updated_by
)
select
  d.id,
  case
    when d.system_required is true then true
    else d.default_required
  end,
  d.default_visible,
  auth.uid()
from public.field_requirement_definitions d
where d.area_code = 'work_assignments'
on conflict (field_definition_id) do nothing;

-- ------------------------------------------------------------
-- 11. RPCs: Application Settings
-- ------------------------------------------------------------

create or replace function public.list_application_setting_categories()
returns table (
  category_code text,
  category_name text,
  description text,
  display_order integer,
  active boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_application_settings() then
    raise exception 'You do not have permission to view application settings';
  end if;

  return query
  select
    c.category_code,
    c.category_name,
    c.description,
    c.display_order,
    c.active
  from public.application_setting_categories c
  where c.active is true
  order by c.display_order asc nulls last, c.category_name asc;
end;
$$;

grant execute on function public.list_application_setting_categories() to authenticated;

create or replace function public.list_application_settings(
  p_category_code text default null,
  p_search_text text default null
)
returns table (
  setting_key text,
  category_code text,
  category_name text,
  setting_name text,
  description text,
  value_type text,
  setting_value jsonb,
  default_value jsonb,
  allowed_values jsonb,
  locked_by_system boolean,
  sensitive boolean,
  active boolean,
  display_order integer,
  ui_component text,
  help_text text,
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_application_settings() then
    raise exception 'You do not have permission to view application settings';
  end if;

  return query
  select
    d.setting_key,
    d.category_code,
    c.category_name,
    d.setting_name,
    d.description,
    d.value_type,
    coalesce(v.setting_value, d.default_value) as setting_value,
    d.default_value,
    d.allowed_values,
    d.locked_by_system,
    d.sensitive,
    d.active,
    d.display_order,
    d.ui_component,
    d.help_text,
    v.updated_by,
    p.display_name as updated_by_name,
    v.updated_at
  from public.application_setting_definitions d
  join public.application_setting_categories c
    on c.category_code = d.category_code
  left join public.application_setting_values v
    on v.setting_key = d.setting_key
  left join public.profiles p
    on p.id = v.updated_by
  where d.active is true
    and c.active is true
    and (
      p_category_code is null
      or trim(p_category_code) = ''
      or d.category_code = p_category_code
    )
    and (
      p_search_text is null
      or trim(p_search_text) = ''
      or (
        coalesce(d.setting_key, '') || ' ' ||
        coalesce(d.setting_name, '') || ' ' ||
        coalesce(d.description, '') || ' ' ||
        coalesce(d.help_text, '') || ' ' ||
        coalesce(c.category_name, '')
      ) ilike '%' || p_search_text || '%'
    )
  order by
    c.display_order asc nulls last,
    d.display_order asc nulls last,
    d.setting_name asc;
end;
$$;

grant execute on function public.list_application_settings(text, text) to authenticated;

create or replace function public.get_application_setting(
  p_setting_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select coalesce(v.setting_value, d.default_value)
  into v_value
  from public.application_setting_definitions d
  left join public.application_setting_values v
    on v.setting_key = d.setting_key
  where d.setting_key = p_setting_key
    and d.active is true;

  if not found then
    raise exception 'Application setting was not found';
  end if;

  return v_value;
end;
$$;

grant execute on function public.get_application_setting(text) to authenticated;

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

  if p_setting_value is null then
    raise exception 'Setting value is required';
  end if;

  v_normalized_value := p_setting_value;

  -- Light type validation. The app controls the UI, but backend protects basics.
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

-- ------------------------------------------------------------
-- 12. RPCs: Field requirements
-- ------------------------------------------------------------

create or replace function public.list_field_requirements(
  p_area_code text default 'work_assignments'
)
returns table (
  area_code text,
  area_name text,
  field_key text,
  field_label text,
  description text,
  system_required boolean,
  configurable boolean,
  is_required boolean,
  is_visible boolean,
  validation_keys text[],
  input_type text,
  display_order integer,
  active boolean,
  help_text text,
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_assignment_field_requirements() then
    raise exception 'You do not have permission to view field requirements';
  end if;

  return query
  select
    d.area_code,
    a.area_name,
    d.field_key,
    d.field_label,
    d.description,
    d.system_required,
    d.configurable,
    case
      when d.system_required is true then true
      else coalesce(r.is_required, d.default_required)
    end as is_required,
    coalesce(r.is_visible, d.default_visible) as is_visible,
    d.validation_keys,
    d.input_type,
    d.display_order,
    d.active,
    d.help_text,
    r.updated_by,
    p.display_name as updated_by_name,
    r.updated_at
  from public.field_requirement_definitions d
  join public.field_requirement_areas a
    on a.area_code = d.area_code
  left join public.field_requirement_rules r
    on r.field_definition_id = d.id
  left join public.profiles p
    on p.id = r.updated_by
  where d.active is true
    and a.active is true
    and d.area_code = coalesce(nullif(trim(p_area_code), ''), 'work_assignments')
  order by
    d.display_order asc nulls last,
    d.field_label asc;
end;
$$;

grant execute on function public.list_field_requirements(text) to authenticated;

create or replace function public.update_field_requirement(
  p_area_code text,
  p_field_key text,
  p_is_required boolean,
  p_is_visible boolean default true
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_definition record;
begin
  if not public.can_manage_assignment_field_requirements() then
    raise exception 'You do not have permission to manage field requirements';
  end if;

  select *
  into v_definition
  from public.field_requirement_definitions d
  where d.area_code = p_area_code
    and d.field_key = p_field_key
    and d.active is true;

  if not found then
    raise exception 'Field requirement definition was not found';
  end if;

  if v_definition.configurable is false then
    raise exception 'This field requirement is locked by the system';
  end if;

  insert into public.field_requirement_rules (
    field_definition_id,
    is_required,
    is_visible,
    updated_by,
    updated_at
  )
  values (
    v_definition.id,
    coalesce(p_is_required, v_definition.default_required),
    coalesce(p_is_visible, v_definition.default_visible),
    auth.uid(),
    now()
  )
  on conflict (field_definition_id) do update
  set
    is_required = excluded.is_required,
    is_visible = excluded.is_visible,
    updated_by = excluded.updated_by,
    updated_at = now();

  begin
    perform public.write_audit_event(
      'field_requirement.updated',
      'field_requirement_rules',
      p_area_code || '.' || p_field_key,
      jsonb_build_object(
        'summary', 'Field requirement updated.',
        'area_code', p_area_code,
        'field_key', p_field_key,
        'is_required', p_is_required,
        'is_visible', p_is_visible
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during field requirement update: %', sqlerrm;
  end;

  return p_area_code || '.' || p_field_key;
end;
$$;

grant execute on function public.update_field_requirement(text, text, boolean, boolean) to authenticated;

-- Validation helper.
-- Payload should be a JSON object built from the assignment form.
-- It checks configured required fields using each definition's validation_keys.
create or replace function public.validate_field_requirements_payload(
  p_area_code text,
  p_payload jsonb
)
returns table (
  field_key text,
  field_label text,
  missing boolean,
  system_required boolean,
  configurable boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Validation payload must be a JSON object';
  end if;

  return query
  with reqs as (
    select
      d.field_key,
      d.field_label,
      d.system_required,
      d.configurable,
      d.validation_keys,
      case
        when d.system_required is true then true
        else coalesce(r.is_required, d.default_required)
      end as is_required,
      coalesce(r.is_visible, d.default_visible) as is_visible
    from public.field_requirement_definitions d
    left join public.field_requirement_rules r
      on r.field_definition_id = d.id
    where d.area_code = coalesce(nullif(trim(p_area_code), ''), 'work_assignments')
      and d.active is true
  ),
  evaluated as (
    select
      reqs.field_key,
      reqs.field_label,
      reqs.system_required,
      reqs.configurable,
      reqs.is_required,
      exists (
        select 1
        from unnest(reqs.validation_keys) as k(validation_key)
        where p_payload ? k.validation_key
          and nullif(trim(coalesce(p_payload ->> k.validation_key, '')), '') is not null
          and lower(trim(coalesce(p_payload ->> k.validation_key, ''))) not in ('null', 'undefined', 'none', 'select')
      ) as has_value
    from reqs
    where reqs.is_required is true
      and reqs.is_visible is true
  )
  select
    e.field_key,
    e.field_label,
    not e.has_value as missing,
    e.system_required,
    e.configurable
  from evaluated e
  where not e.has_value
  order by e.field_label asc;
end;
$$;

grant execute on function public.validate_field_requirements_payload(text, jsonb) to authenticated;

-- Convenience helper for Assignment create/edit.
create or replace function public.validate_assignment_requirements_payload(
  p_payload jsonb
)
returns table (
  field_key text,
  field_label text,
  missing boolean,
  system_required boolean,
  configurable boolean
)
language sql
security definer
set search_path = public
as $$
  select *
  from public.validate_field_requirements_payload('work_assignments', p_payload);
$$;

grant execute on function public.validate_assignment_requirements_payload(jsonb) to authenticated;

-- ------------------------------------------------------------
-- 13. Verification
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

select
  'OHP-017 application settings foundation installed' as result,
  (select count(*) from public.capabilities where capability_code in (
    'application_settings.view',
    'application_settings.manage',
    'assignment_field_requirements.view',
    'assignment_field_requirements.manage'
  )) as capabilities_verified,
  (select count(*) from public.application_setting_categories) as setting_categories,
  (select count(*) from public.application_setting_definitions) as setting_definitions,
  (select count(*) from public.field_requirement_definitions where area_code = 'work_assignments') as assignment_field_definitions;