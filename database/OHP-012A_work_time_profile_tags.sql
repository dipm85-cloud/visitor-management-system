-- ============================================================
-- Operations Hub - OHP-012A
-- Work Time Profile Tags and Calendar Filter Readiness
--
-- Adds three optional custom tag fields to Work Time Profiles.
--
-- Purpose:
-- - Prepare Work Time Profiles for future rota/calendar filtering.
-- - Allow companies to tag profiles with local meanings such as:
--   AM / PM, Blue / Red shift, Weekend, Night, Standard, etc.
--
-- Safety:
-- - Does NOT implement calendar/rota yet.
-- - Does NOT implement LMT yet.
-- - Does NOT modify People assignments.
-- - Does NOT remove existing Work Time Profile fields.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Add tag columns
-- ------------------------------------------------------------

alter table public.work_time_profiles
add column if not exists custom_tag_1 text;

alter table public.work_time_profiles
add column if not exists custom_tag_2 text;

alter table public.work_time_profiles
add column if not exists custom_tag_3 text;

-- ------------------------------------------------------------
-- 2. Rebuild search index to include tags
-- ------------------------------------------------------------

drop index if exists public.idx_work_time_profiles_search;

create index if not exists idx_work_time_profiles_search
on public.work_time_profiles using gin (
  to_tsvector(
    'simple',
    coalesce(profile_code, '') || ' ' ||
    coalesce(profile_name, '') || ' ' ||
    coalesce(custom_tag_1, '') || ' ' ||
    coalesce(custom_tag_2, '') || ' ' ||
    coalesce(custom_tag_3, '') || ' ' ||
    coalesce(notes, '')
  )
);

-- ------------------------------------------------------------
-- 3. Drop old RPC signatures before recreating tag-aware versions
-- ------------------------------------------------------------

drop function if exists public.create_work_time_profile(
  text,
  text,
  time,
  time,
  boolean,
  integer,
  numeric,
  numeric,
  boolean,
  integer,
  text,
  jsonb
);

drop function if exists public.update_work_time_profile(
  uuid,
  text,
  text,
  time,
  time,
  boolean,
  integer,
  numeric,
  numeric,
  boolean,
  integer,
  text,
  jsonb
);

-- ------------------------------------------------------------
-- 4. Tag-aware create RPC
-- ------------------------------------------------------------

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
  p_custom_tag_1 text default null,
  p_custom_tag_2 text default null,
  p_custom_tag_3 text default null,
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
    custom_tag_1,
    custom_tag_2,
    custom_tag_3,
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
    nullif(trim(coalesce(p_custom_tag_1, '')), ''),
    nullif(trim(coalesce(p_custom_tag_2, '')), ''),
    nullif(trim(coalesce(p_custom_tag_3, '')), ''),
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
        'profile_name', v_profile.profile_name,
        'custom_tag_1', v_profile.custom_tag_1,
        'custom_tag_2', v_profile.custom_tag_2,
        'custom_tag_3', v_profile.custom_tag_3
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during work time profile create: %', sqlerrm;
  end;

  return v_profile;
end;
$$;

-- ------------------------------------------------------------
-- 5. Tag-aware update RPC
-- ------------------------------------------------------------

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
  p_custom_tag_1 text default null,
  p_custom_tag_2 text default null,
  p_custom_tag_3 text default null,
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
    custom_tag_1 = case
      when p_custom_tag_1 is null then custom_tag_1
      else nullif(trim(p_custom_tag_1), '')
    end,
    custom_tag_2 = case
      when p_custom_tag_2 is null then custom_tag_2
      else nullif(trim(p_custom_tag_2), '')
    end,
    custom_tag_3 = case
      when p_custom_tag_3 is null then custom_tag_3
      else nullif(trim(p_custom_tag_3), '')
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
        'new_profile_name', v_after.profile_name,
        'custom_tag_1', v_after.custom_tag_1,
        'custom_tag_2', v_after.custom_tag_2,
        'custom_tag_3', v_after.custom_tag_3
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during work time profile update: %', sqlerrm;
  end;

  return v_after;
end;
$$;

-- ------------------------------------------------------------
-- 6. Grants
-- ------------------------------------------------------------

grant execute on function public.create_work_time_profile(
  text,
  text,
  time,
  time,
  boolean,
  integer,
  numeric,
  numeric,
  boolean,
  integer,
  text,
  text,
  text,
  text,
  jsonb
) to authenticated;

grant execute on function public.update_work_time_profile(
  uuid,
  text,
  text,
  time,
  time,
  boolean,
  integer,
  numeric,
  numeric,
  boolean,
  integer,
  text,
  text,
  text,
  text,
  jsonb
) to authenticated;

-- Ask PostgREST/Supabase API to reload its schema cache.
notify pgrst, 'reload schema';

select
  'OHP-012A work time profile tags installed' as result;