-- ============================================================
-- Operations Hub - OHP-012 Work Time Profiles
--
-- Adds reusable Work Time Profiles for People assignments.
--
-- Design:
-- - Shift Pattern = which days / rota pattern someone works.
-- - Work Time Profile = one working-day time template.
--
-- Examples:
-- - 06:00-14:30, 8 paid hours, 0 unsociable hours, 30 min break.
-- - 22:00-06:00, 7.5 paid hours, 7.5 unsociable hours, crosses midnight.
--
-- Safety:
-- - Does NOT remove old assignment shift start/end fields.
-- - Does NOT recalculate existing assignments.
-- - Does NOT implement LMT yet.
-- - Adds a nullable work_time_profile_id to likely People assignment tables if present.
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
  'work_time_profiles',
  'Work Time Profiles',
  'Reusable working-time templates for People assignments and future LMT calculations.',
  170,
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
      'work_time_profiles.view',
      'View work time profiles',
      'Allows authorised users to view reusable Work Time Profiles.'
    ),
    (
      'work_time_profiles.manage',
      'Manage work time profiles',
      'Allows authorised users to create and update reusable Work Time Profiles.'
    )
) as c(capability_code, capability_name, capability_description)
where cg.group_code = 'work_time_profiles'
on conflict (capability_code) do update
set
  capability_name = excluded.capability_name,
  group_id = excluded.group_id,
  description = excluded.description,
  active = true;

-- SuperUser gets both capabilities by default.
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
    'work_time_profiles.view',
    'work_time_profiles.manage'
  )
on conflict do nothing;

-- ------------------------------------------------------------
-- 2. Helper: normalise code
-- ------------------------------------------------------------

create or replace function public.normalise_work_time_profile_code(p_value text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(
      lower(trim(coalesce(p_value, ''))),
      '[^a-z0-9]+',
      '_',
      'g'
    ),
    '^_+|_+$',
    '',
    'g'
  );
$$;

grant execute on function public.normalise_work_time_profile_code(text) to authenticated;

-- ------------------------------------------------------------
-- 3. Work Time Profiles table
-- ------------------------------------------------------------

create table if not exists public.work_time_profiles (
  id uuid primary key default gen_random_uuid(),

  profile_code text not null unique,
  profile_name text not null,

  start_time time not null,
  end_time time not null,
  crosses_midnight boolean not null default false,

  break_minutes integer not null default 0,

  paid_hours numeric(6,2) not null,
  unsociable_hours numeric(6,2) not null default 0,

  active boolean not null default true,
  display_order integer not null default 100,
  notes text,

  metadata jsonb not null default '{}'::jsonb,

  created_by uuid default auth.uid(),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint work_time_profiles_profile_code_not_blank
    check (length(trim(profile_code)) > 0),

  constraint work_time_profiles_profile_name_not_blank
    check (length(trim(profile_name)) > 0),

  constraint work_time_profiles_break_minutes_check
    check (break_minutes >= 0 and break_minutes <= 1440),

  constraint work_time_profiles_paid_hours_check
    check (paid_hours >= 0 and paid_hours <= 24),

  constraint work_time_profiles_unsociable_hours_check
    check (unsociable_hours >= 0 and unsociable_hours <= 24),

  constraint work_time_profiles_unsociable_not_more_than_paid_check
    check (unsociable_hours <= paid_hours)
);

create index if not exists idx_work_time_profiles_active
on public.work_time_profiles(active);

create index if not exists idx_work_time_profiles_display_order
on public.work_time_profiles(display_order, profile_name);

create index if not exists idx_work_time_profiles_search
on public.work_time_profiles using gin (
  to_tsvector(
    'simple',
    coalesce(profile_code, '') || ' ' ||
    coalesce(profile_name, '') || ' ' ||
    coalesce(notes, '')
  )
);

-- ------------------------------------------------------------
-- 4. Updated-at trigger
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

drop trigger if exists trg_work_time_profiles_updated_at on public.work_time_profiles;

create trigger trg_work_time_profiles_updated_at
before update on public.work_time_profiles
for each row
execute function public.oh_set_updated_at();

-- ------------------------------------------------------------
-- 5. Best-effort add work_time_profile_id to likely People assignment tables
-- ------------------------------------------------------------
-- This is intentionally non-destructive. Existing shift_start/end columns remain.
-- If the actual assignment table uses a different name, Codex/frontend should
-- inspect and patch separately.

do $$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'work_assignments',
    'people_assignments',
    'person_assignments',
    'people_assignment',
    'person_assignment'
  ]
  loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = v_table_name
    ) then
      execute format(
        'alter table public.%I add column if not exists work_time_profile_id uuid references public.work_time_profiles(id)',
        v_table_name
      );

      execute format(
        'create index if not exists %I on public.%I(work_time_profile_id)',
        'idx_' || v_table_name || '_work_time_profile_id',
        v_table_name
      );

      raise notice 'Added/verified work_time_profile_id on public.%', v_table_name;
    end if;
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 6. Permission helpers
-- ------------------------------------------------------------

create or replace function public.can_view_work_time_profiles()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('work_time_profiles.view')
      or public.user_has_capability('work_time_profiles.manage')
      or public.user_has_capability('reference_data.view')
      or public.user_has_capability('reference_data.manage')
      or public.user_has_capability('people.view')
      or public.user_has_capability('people.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.view')
    );
$$;

create or replace function public.can_manage_work_time_profiles()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('work_time_profiles.manage')
      or public.user_has_capability('reference_data.manage')
      or public.user_has_capability('people.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.edit')
    );
$$;

grant execute on function public.can_view_work_time_profiles() to authenticated;
grant execute on function public.can_manage_work_time_profiles() to authenticated;

-- ------------------------------------------------------------
-- 7. RLS
-- ------------------------------------------------------------

alter table public.work_time_profiles enable row level security;

drop policy if exists "work time profiles can be viewed by authorised users" on public.work_time_profiles;
drop policy if exists "work time profiles can be created by authorised users" on public.work_time_profiles;
drop policy if exists "work time profiles can be updated by authorised users" on public.work_time_profiles;

create policy "work time profiles can be viewed by authorised users"
on public.work_time_profiles
for select
to authenticated
using (public.can_view_work_time_profiles());

create policy "work time profiles can be created by authorised users"
on public.work_time_profiles
for insert
to authenticated
with check (public.can_manage_work_time_profiles());

create policy "work time profiles can be updated by authorised users"
on public.work_time_profiles
for update
to authenticated
using (public.can_manage_work_time_profiles())
with check (public.can_manage_work_time_profiles());

grant select, insert, update on public.work_time_profiles to authenticated;

-- ------------------------------------------------------------
-- 8. RPCs
-- ------------------------------------------------------------

create or replace function public.list_work_time_profiles(
  p_include_inactive boolean default true,
  p_search_text text default null
)
returns setof public.work_time_profiles
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_work_time_profiles() then
    raise exception 'You do not have permission to view work time profiles';
  end if;

  return query
  select wtp.*
  from public.work_time_profiles wtp
  where (p_include_inactive is true or wtp.active is true)
    and (
      p_search_text is null
      or trim(p_search_text) = ''
      or (
        coalesce(wtp.profile_code, '') || ' ' ||
        coalesce(wtp.profile_name, '') || ' ' ||
        coalesce(wtp.notes, '')
      ) ilike '%' || p_search_text || '%'
    )
  order by
    wtp.active desc,
    wtp.display_order asc,
    wtp.profile_name asc;
end;
$$;

create or replace function public.get_work_time_profile(
  p_work_time_profile_id uuid
)
returns public.work_time_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.work_time_profiles;
begin
  if not public.can_view_work_time_profiles() then
    raise exception 'You do not have permission to view work time profiles';
  end if;

  select *
  into v_profile
  from public.work_time_profiles
  where id = p_work_time_profile_id;

  if not found then
    raise exception 'Work time profile not found';
  end if;

  return v_profile;
end;
$$;

create or replace function public.create_work_time_profile(
  p_profile_code text default null,
  p_profile_name text default null,
  p_start_time time default null,
  p_end_time time default null,
  p_crosses_midnight boolean default false,
  p_break_minutes integer default 0,
  p_paid_hours numeric default null,
  p_unsociable_hours numeric default 0,
  p_active boolean default true,
  p_display_order integer default 100,
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.work_time_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_name text;
  v_profile public.work_time_profiles;
begin
  if not public.can_manage_work_time_profiles() then
    raise exception 'You do not have permission to create work time profiles';
  end if;

  v_name := nullif(trim(coalesce(p_profile_name, '')), '');

  if v_name is null then
    raise exception 'Work time profile name is required';
  end if;

  if p_start_time is null then
    raise exception 'Start time is required';
  end if;

  if p_end_time is null then
    raise exception 'End time is required';
  end if;

  if p_paid_hours is null then
    raise exception 'Paid working hours are required';
  end if;

  v_code := public.normalise_work_time_profile_code(
    coalesce(nullif(trim(coalesce(p_profile_code, '')), ''), v_name)
  );

  if v_code is null or v_code = '' then
    raise exception 'Work time profile code is required';
  end if;

  insert into public.work_time_profiles (
    profile_code,
    profile_name,
    start_time,
    end_time,
    crosses_midnight,
    break_minutes,
    paid_hours,
    unsociable_hours,
    active,
    display_order,
    notes,
    metadata,
    created_by,
    updated_by
  )
  values (
    v_code,
    v_name,
    p_start_time,
    p_end_time,
    coalesce(p_crosses_midnight, false),
    greatest(0, least(coalesce(p_break_minutes, 0), 1440)),
    greatest(0, least(p_paid_hours, 24)),
    greatest(0, least(coalesce(p_unsociable_hours, 0), 24)),
    coalesce(p_active, true),
    coalesce(p_display_order, 100),
    nullif(trim(coalesce(p_notes, '')), ''),
    coalesce(p_metadata, '{}'::jsonb),
    auth.uid(),
    auth.uid()
  )
  returning *
  into v_profile;

  begin
    perform public.write_audit_event(
      'work_time_profile.created',
      'work_time_profiles',
      v_profile.id::text,
      jsonb_build_object(
        'summary', 'Work time profile created.',
        'profile_code', v_profile.profile_code,
        'profile_name', v_profile.profile_name
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during work time profile create: %', sqlerrm;
  end;

  return v_profile;
end;
$$;

create or replace function public.update_work_time_profile(
  p_work_time_profile_id uuid,
  p_profile_code text default null,
  p_profile_name text default null,
  p_start_time time default null,
  p_end_time time default null,
  p_crosses_midnight boolean default null,
  p_break_minutes integer default null,
  p_paid_hours numeric default null,
  p_unsociable_hours numeric default null,
  p_active boolean default null,
  p_display_order integer default null,
  p_notes text default null,
  p_metadata jsonb default null
)
returns public.work_time_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.work_time_profiles;
  v_after public.work_time_profiles;
  v_code text;
  v_name text;
begin
  if not public.can_manage_work_time_profiles() then
    raise exception 'You do not have permission to update work time profiles';
  end if;

  select *
  into v_before
  from public.work_time_profiles
  where id = p_work_time_profile_id
  for update;

  if not found then
    raise exception 'Work time profile not found';
  end if;

  v_name := coalesce(nullif(trim(coalesce(p_profile_name, '')), ''), v_before.profile_name);

  v_code := case
    when p_profile_code is null or trim(p_profile_code) = '' then v_before.profile_code
    else public.normalise_work_time_profile_code(p_profile_code)
  end;

  update public.work_time_profiles
  set
    profile_code = v_code,
    profile_name = v_name,
    start_time = coalesce(p_start_time, start_time),
    end_time = coalesce(p_end_time, end_time),
    crosses_midnight = coalesce(p_crosses_midnight, crosses_midnight),
    break_minutes = case
      when p_break_minutes is null then break_minutes
      else greatest(0, least(p_break_minutes, 1440))
    end,
    paid_hours = case
      when p_paid_hours is null then paid_hours
      else greatest(0, least(p_paid_hours, 24))
    end,
    unsociable_hours = case
      when p_unsociable_hours is null then unsociable_hours
      else greatest(0, least(p_unsociable_hours, 24))
    end,
    active = coalesce(p_active, active),
    display_order = coalesce(p_display_order, display_order),
    notes = case
      when p_notes is null then notes
      else nullif(trim(p_notes), '')
    end,
    metadata = coalesce(p_metadata, metadata),
    updated_by = auth.uid()
  where id = p_work_time_profile_id
  returning *
  into v_after;

  begin
    perform public.write_audit_event(
      'work_time_profile.updated',
      'work_time_profiles',
      v_after.id::text,
      jsonb_build_object(
        'summary', 'Work time profile updated.',
        'old_profile_code', v_before.profile_code,
        'new_profile_code', v_after.profile_code,
        'old_profile_name', v_before.profile_name,
        'new_profile_name', v_after.profile_name
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during work time profile update: %', sqlerrm;
  end;

  return v_after;
end;
$$;

grant execute on function public.list_work_time_profiles(boolean, text) to authenticated;
grant execute on function public.get_work_time_profile(uuid) to authenticated;
grant execute on function public.create_work_time_profile(text, text, time, time, boolean, integer, numeric, numeric, boolean, integer, text, jsonb) to authenticated;
grant execute on function public.update_work_time_profile(uuid, text, text, time, time, boolean, integer, numeric, numeric, boolean, integer, text, jsonb) to authenticated;

-- Ask PostgREST/Supabase API to reload its schema cache.
notify pgrst, 'reload schema';

select
  'OHP-012 work time profiles installed' as result;
