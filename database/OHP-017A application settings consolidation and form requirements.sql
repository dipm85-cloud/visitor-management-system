-- ============================================================
-- Operations Hub - OHP-017A
-- Application Settings Consolidation and Module Form Requirements
--
-- Purpose:
-- - Expand Assignment Field Requirements into reusable Form Requirements.
-- - Add batch-save support for field requirements.
-- - Add Visitor Walk-in and Planned Visit form requirement definitions.
-- - Keep system-required fields locked.
-- - Prepare Application Settings as the central settings hub.
--
-- Safety:
-- - Admins still cannot create arbitrary requirement fields.
-- - Admins can only configure platform-defined fields.
-- - System-required fields remain locked.
-- - Existing assignment requirement settings are preserved.
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
  'form_requirements',
  'Form Requirements',
  'Controlled required-field configuration for platform forms.',
  121,
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
      'form_requirements.view',
      'View form requirements',
      'Allows authorised users to view platform form requirement configuration.'
    ),
    (
      'form_requirements.manage',
      'Manage form requirements',
      'Allows authorised users to configure required fields where the platform allows it.'
    )
) as c(capability_code, capability_name, capability_description)
where cg.group_code = 'form_requirements'
on conflict (capability_code) do update
set
  capability_name = excluded.capability_name,
  group_id = excluded.group_id,
  description = excluded.description,
  active = true;

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
    'form_requirements.view',
    'form_requirements.manage'
  )
on conflict do nothing;

-- ------------------------------------------------------------
-- 2. Generic Form Requirement permission helpers
-- ------------------------------------------------------------

create or replace function public.can_view_form_requirements()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('form_requirements.view')
      or public.user_has_capability('form_requirements.manage')
      or public.user_has_capability('assignment_field_requirements.view')
      or public.user_has_capability('assignment_field_requirements.manage')
      or public.user_has_capability('application_settings.view')
      or public.user_has_capability('application_settings.manage')
      or public.user_has_capability('settings.view')
      or public.user_has_capability('settings.edit')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('access_control.manage')
    );
$$;

create or replace function public.can_manage_form_requirements()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('form_requirements.manage')
      or public.user_has_capability('assignment_field_requirements.manage')
      or public.user_has_capability('application_settings.manage')
      or public.user_has_capability('settings.edit')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('access_control.manage')
    );
$$;

grant execute on function public.can_view_form_requirements() to authenticated;
grant execute on function public.can_manage_form_requirements() to authenticated;

-- Keep existing assignment-specific helpers compatible, but route through the generic model.
create or replace function public.can_view_assignment_field_requirements()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_form_requirements();
$$;

create or replace function public.can_manage_assignment_field_requirements()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_form_requirements();
$$;

grant execute on function public.can_view_assignment_field_requirements() to authenticated;
grant execute on function public.can_manage_assignment_field_requirements() to authenticated;

-- ------------------------------------------------------------
-- 3. Ensure Field Requirement tables exist
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

-- ------------------------------------------------------------
-- 4. RLS
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
using (public.can_view_form_requirements());

create policy "admins can view field requirement definitions"
on public.field_requirement_definitions
for select
to authenticated
using (public.can_view_form_requirements());

create policy "admins can view field requirement rules"
on public.field_requirement_rules
for select
to authenticated
using (public.can_view_form_requirements());

create policy "admins can insert field requirement rules"
on public.field_requirement_rules
for insert
to authenticated
with check (public.can_manage_form_requirements());

create policy "admins can update field requirement rules"
on public.field_requirement_rules
for update
to authenticated
using (public.can_manage_form_requirements())
with check (public.can_manage_form_requirements());

grant select on public.field_requirement_areas to authenticated;
grant select on public.field_requirement_definitions to authenticated;
grant select, insert, update on public.field_requirement_rules to authenticated;

-- ------------------------------------------------------------
-- 5. Seed Form Requirement areas
-- ------------------------------------------------------------

insert into public.field_requirement_areas (
  area_code,
  area_name,
  description,
  display_order,
  active
)
values
  (
    'work_assignments',
    'Assignments',
    'Field requirement configuration for workforce/person assignment create and edit flows.',
    10,
    true
  ),
  (
    'visitor_walk_ins',
    'Visitor Walk-ins',
    'Field requirement configuration for visitor walk-in creation forms.',
    20,
    true
  ),
  (
    'planned_visits',
    'Planned Visits',
    'Field requirement configuration for planned visit creation/edit forms.',
    30,
    true
  )
on conflict (area_code) do update
set
  area_name = excluded.area_name,
  description = excluded.description,
  display_order = excluded.display_order,
  active = excluded.active;

-- ------------------------------------------------------------
-- 6. Seed Assignment definitions
-- ------------------------------------------------------------

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

-- ------------------------------------------------------------
-- 7. Seed Visitor Walk-in definitions
-- ------------------------------------------------------------

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
    'visitor_walk_ins',
    'visitor_name',
    'Visitor name',
    'The visitor name.',
    true,
    false,
    true,
    true,
    array['visitor_name', 'visitorName', 'name'],
    'text',
    10,
    true,
    'Locked by system. A walk-in visitor must have a name.'
  ),
  (
    'visitor_walk_ins',
    'company',
    'Company',
    'Visitor company or organisation.',
    false,
    true,
    false,
    true,
    array['company', 'company_name', 'companyName', 'visitor_company'],
    'text',
    20,
    true,
    'Can be required by site/customer policy.'
  ),
  (
    'visitor_walk_ins',
    'host',
    'Host',
    'Host/contact being visited.',
    false,
    true,
    false,
    true,
    array['host_id', 'host', 'hostId', 'host_name', 'hostName'],
    'reference',
    30,
    true,
    'Can be required by site/customer policy.'
  ),
  (
    'visitor_walk_ins',
    'reason',
    'Reason / purpose',
    'Reason or purpose for the visit.',
    false,
    true,
    false,
    true,
    array['reason', 'purpose', 'visit_reason', 'visitReason', 'comments'],
    'text',
    40,
    true,
    'Can be required by site/customer policy.'
  ),
  (
    'visitor_walk_ins',
    'vehicle_registration',
    'Vehicle registration',
    'Vehicle registration / licence plate.',
    false,
    true,
    false,
    true,
    array['vehicle_registration', 'vehicleRegistration', 'vehicle_reg', 'license_plate', 'licence_plate'],
    'text',
    50,
    true,
    'Can be required where vehicle control is needed.'
  ),
  (
    'visitor_walk_ins',
    'on_site_contact',
    'On-site contact',
    'On-site contact for the visitor.',
    false,
    true,
    false,
    true,
    array['on_site_contact', 'onSiteContact', 'site_contact', 'contact'],
    'text',
    60,
    true,
    'Can be required by operational policy.'
  ),
  (
    'visitor_walk_ins',
    'security_pass_id',
    'Security pass ID',
    'Security pass or badge identifier.',
    false,
    true,
    false,
    true,
    array['security_pass_id', 'securityPassId', 'pass_id', 'badge_id'],
    'text',
    70,
    true,
    'Can be required by security process.'
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

-- ------------------------------------------------------------
-- 8. Seed Planned Visit definitions
-- ------------------------------------------------------------

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
    'planned_visits',
    'visitor_name',
    'Visitor name',
    'The planned visitor name.',
    true,
    false,
    true,
    true,
    array['visitor_name', 'visitorName', 'name'],
    'text',
    10,
    true,
    'Locked by system. A planned visit must have a visitor name.'
  ),
  (
    'planned_visits',
    'visit_date',
    'Visit date',
    'The planned visit date.',
    true,
    false,
    true,
    true,
    array['visit_date', 'visitDate', 'date'],
    'date',
    20,
    true,
    'Locked by system. A planned visit must have a visit date.'
  ),
  (
    'planned_visits',
    'company',
    'Company',
    'Visitor company or organisation.',
    false,
    true,
    false,
    true,
    array['company', 'company_name', 'companyName', 'visitor_company'],
    'text',
    30,
    true,
    'Can be required by site/customer policy.'
  ),
  (
    'planned_visits',
    'host',
    'Host',
    'Planned host/contact.',
    false,
    true,
    false,
    true,
    array['host_id', 'host', 'hostId', 'host_name', 'hostName'],
    'reference',
    40,
    true,
    'Can be required by site/customer policy.'
  ),
  (
    'planned_visits',
    'expected_time',
    'Expected time',
    'Expected arrival time.',
    false,
    true,
    false,
    true,
    array['expected_time', 'expectedTime', 'arrival_time', 'arrivalTime'],
    'time',
    50,
    true,
    'Can be required by operational policy.'
  ),
  (
    'planned_visits',
    'reason',
    'Reason / purpose',
    'Reason or purpose for the visit.',
    false,
    true,
    false,
    true,
    array['reason', 'purpose', 'visit_reason', 'visitReason', 'comments'],
    'text',
    60,
    true,
    'Can be required by site/customer policy.'
  ),
  (
    'planned_visits',
    'vehicle_registration',
    'Vehicle registration',
    'Vehicle registration / licence plate.',
    false,
    true,
    false,
    true,
    array['vehicle_registration', 'vehicleRegistration', 'vehicle_reg', 'license_plate', 'licence_plate'],
    'text',
    70,
    true,
    'Can be required where vehicle control is needed.'
  ),
  (
    'planned_visits',
    'on_site_contact',
    'On-site contact',
    'On-site contact for the planned visit.',
    false,
    true,
    false,
    true,
    array['on_site_contact', 'onSiteContact', 'site_contact', 'contact'],
    'text',
    80,
    true,
    'Can be required by operational policy.'
  ),
  (
    'planned_visits',
    'notes',
    'Notes',
    'Planned visit notes.',
    false,
    true,
    false,
    true,
    array['notes', 'planned_notes'],
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

-- ------------------------------------------------------------
-- 9. Ensure rules exist for all seeded definitions
-- ------------------------------------------------------------

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
where d.area_code in (
  'work_assignments',
  'visitor_walk_ins',
  'planned_visits'
)
on conflict (field_definition_id) do nothing;

-- ------------------------------------------------------------
-- 10. RPC: list areas
-- ------------------------------------------------------------

create or replace function public.list_field_requirement_areas()
returns table (
  area_code text,
  area_name text,
  description text,
  display_order integer,
  active boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_form_requirements() then
    raise exception 'You do not have permission to view form requirement areas';
  end if;

  return query
  select
    a.area_code,
    a.area_name,
    a.description,
    a.display_order,
    a.active
  from public.field_requirement_areas a
  where a.active is true
  order by a.display_order asc nulls last, a.area_name asc;
end;
$$;

grant execute on function public.list_field_requirement_areas() to authenticated;

-- ------------------------------------------------------------
-- 11. RPC: list field requirements
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
  if not public.can_view_form_requirements() then
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

-- ------------------------------------------------------------
-- 12. RPC: update single field requirement
-- ------------------------------------------------------------

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
  if not public.can_manage_form_requirements() then
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

-- ------------------------------------------------------------
-- 13. RPC: batch update field requirements
-- ------------------------------------------------------------

create or replace function public.update_field_requirements_batch(
  p_area_code text,
  p_rules jsonb
)
returns table (
  area_code text,
  field_key text,
  is_required boolean,
  is_visible boolean,
  updated boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_area_code text := coalesce(nullif(trim(p_area_code), ''), 'work_assignments');
  v_rule jsonb;
  v_field_key text;
  v_definition record;
  v_is_required boolean;
  v_is_visible boolean;
begin
  if not public.can_manage_form_requirements() then
    raise exception 'You do not have permission to manage field requirements';
  end if;

  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then
    raise exception 'Rules must be supplied as a JSON array';
  end if;

  if not exists (
    select 1
    from public.field_requirement_areas a
    where a.area_code = v_area_code
      and a.active is true
  ) then
    raise exception 'Field requirement area was not found';
  end if;

  for v_rule in
    select value
    from jsonb_array_elements(p_rules)
  loop
    v_field_key := nullif(trim(coalesce(v_rule ->> 'field_key', '')), '');

    if v_field_key is null then
      raise exception 'Each rule must include field_key';
    end if;

    select *
    into v_definition
    from public.field_requirement_definitions d
    where d.area_code = v_area_code
      and d.field_key = v_field_key
      and d.active is true;

    if not found then
      raise exception 'Field requirement definition not found for %.%', v_area_code, v_field_key;
    end if;

    if v_definition.configurable is false then
      raise exception 'Field "%" is locked by the system', v_definition.field_label;
    end if;

    v_is_required := case
      when v_rule ? 'is_required' then (v_rule ->> 'is_required')::boolean
      else v_definition.default_required
    end;

    v_is_visible := case
      when v_rule ? 'is_visible' then (v_rule ->> 'is_visible')::boolean
      else v_definition.default_visible
    end;

    insert into public.field_requirement_rules (
      field_definition_id,
      is_required,
      is_visible,
      updated_by,
      updated_at
    )
    values (
      v_definition.id,
      coalesce(v_is_required, v_definition.default_required),
      coalesce(v_is_visible, v_definition.default_visible),
      auth.uid(),
      now()
    )
    on conflict (field_definition_id) do update
    set
      is_required = excluded.is_required,
      is_visible = excluded.is_visible,
      updated_by = excluded.updated_by,
      updated_at = now();

    area_code := v_area_code;
    field_key := v_field_key;
    is_required := coalesce(v_is_required, v_definition.default_required);
    is_visible := coalesce(v_is_visible, v_definition.default_visible);
    updated := true;

    return next;
  end loop;

  begin
    perform public.write_audit_event(
      'field_requirements.batch_updated',
      'field_requirement_rules',
      v_area_code,
      jsonb_build_object(
        'summary', 'Field requirements batch updated.',
        'area_code', v_area_code,
        'rule_count', jsonb_array_length(p_rules)
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during field requirement batch update: %', sqlerrm;
  end;
end;
$$;

grant execute on function public.update_field_requirements_batch(text, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 14. Validation helpers
-- ------------------------------------------------------------

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
          and lower(trim(coalesce(p_payload ->> k.validation_key, ''))) not in ('null', 'undefined', 'none', 'select', '')
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

create or replace function public.validate_visitor_walk_in_requirements_payload(
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
  from public.validate_field_requirements_payload('visitor_walk_ins', p_payload);
$$;

grant execute on function public.validate_visitor_walk_in_requirements_payload(jsonb) to authenticated;

create or replace function public.validate_planned_visit_requirements_payload(
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
  from public.validate_field_requirements_payload('planned_visits', p_payload);
$$;

grant execute on function public.validate_planned_visit_requirements_payload(jsonb) to authenticated;

-- ------------------------------------------------------------
-- 15. Verification
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

select
  'OHP-017A application settings consolidation and form requirements installed' as result,
  (select count(*) from public.capabilities where capability_code in (
    'form_requirements.view',
    'form_requirements.manage'
  )) as new_capabilities_verified,
  (select count(*) from public.field_requirement_areas where area_code in (
    'work_assignments',
    'visitor_walk_ins',
    'planned_visits'
  )) as form_areas_verified,
  (select count(*) from public.field_requirement_definitions where area_code = 'work_assignments') as assignment_fields,
  (select count(*) from public.field_requirement_definitions where area_code = 'visitor_walk_ins') as walk_in_fields,
  (select count(*) from public.field_requirement_definitions where area_code = 'planned_visits') as planned_visit_fields;