-- ============================================================
-- Operations Hub - OHP-013B.3 Work Time Profile / Break Rule Alignment
-- FULL FIXED SQL
--
-- Fix included:
-- - Replaces unsupported min(uuid) usage with array_agg(... order by id::text)[1]
--
-- Purpose:
-- - Align Work Time Profiles with Break Rules before LMT.
-- - Add break_rule_id to Work Time Profiles.
-- - Preserve existing manual paid hours behaviour.
-- - Add calculated/suggested paid hours fields.
-- - Keep assignment-level break rule as advanced/legacy override.
--
-- Safety:
-- - Existing paid_hours values are preserved.
-- - Existing profiles default to manual override mode.
-- - No rota calculation should change unless admin explicitly applies
--   calculated/suggested paid hours.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Ensure Work Time Profile alignment columns exist
-- ------------------------------------------------------------

alter table public.work_time_profiles
add column if not exists break_rule_id uuid;

alter table public.work_time_profiles
add column if not exists paid_hours_manual_override boolean not null default true;

alter table public.work_time_profiles
add column if not exists gross_hours numeric(8,2);

alter table public.work_time_profiles
add column if not exists effective_break_minutes integer;

alter table public.work_time_profiles
add column if not exists calculated_paid_hours numeric(8,2);

alter table public.work_time_profiles
add column if not exists break_alignment_notes text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'work_time_profiles_break_rule_id_fkey'
      and conrelid = 'public.work_time_profiles'::regclass
  ) then
    alter table public.work_time_profiles
    add constraint work_time_profiles_break_rule_id_fkey
    foreign key (break_rule_id)
    references public.break_rules(id)
    on delete set null;
  end if;
end;
$$;

create index if not exists idx_work_time_profiles_break_rule_id
on public.work_time_profiles(break_rule_id);

-- ------------------------------------------------------------
-- 2. Ensure assignment-level break rule exists as advanced override
-- ------------------------------------------------------------

alter table public.work_assignments
add column if not exists break_rule_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'work_assignments_break_rule_id_fkey'
      and conrelid = 'public.work_assignments'::regclass
  ) then
    alter table public.work_assignments
    add constraint work_assignments_break_rule_id_fkey
    foreign key (break_rule_id)
    references public.break_rules(id)
    on delete set null;
  end if;
end;
$$;

create index if not exists idx_work_assignments_break_rule_id
on public.work_assignments(break_rule_id);

-- ------------------------------------------------------------
-- 3. Helper: calculate gross/break/paid hours
-- ------------------------------------------------------------

create or replace function public.calculate_work_time_profile_values(
  p_start_time time,
  p_end_time time,
  p_crosses_midnight boolean default false,
  p_break_rule_id uuid default null,
  p_break_minutes integer default null,
  p_paid_hours_manual_override boolean default true,
  p_manual_paid_hours numeric default null
)
returns table (
  gross_minutes integer,
  gross_hours numeric,
  break_rule_id uuid,
  break_rule_break_minutes integer,
  break_rule_paid_break boolean,
  effective_break_minutes integer,
  unpaid_break_minutes integer,
  calculated_paid_minutes integer,
  calculated_paid_hours numeric,
  final_paid_hours numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_gross_minutes integer;
  v_break_minutes integer := greatest(coalesce(p_break_minutes, 0), 0);
  v_rule_break_minutes integer;
  v_rule_paid_break boolean := false;
  v_unpaid_break_minutes integer;
  v_calculated_paid_minutes integer;
  v_calculated_paid_hours numeric;
begin
  if p_break_rule_id is not null then
    select
      br.break_minutes,
      coalesce(br.paid_break, false)
    into
      v_rule_break_minutes,
      v_rule_paid_break
    from public.break_rules br
    where br.id = p_break_rule_id;

    if found then
      v_break_minutes := greatest(coalesce(v_rule_break_minutes, 0), 0);
    end if;
  end if;

  if p_start_time is null or p_end_time is null then
    return query
    select
      null::integer,
      null::numeric,
      p_break_rule_id,
      v_rule_break_minutes,
      v_rule_paid_break,
      v_break_minutes,
      case when v_rule_paid_break then 0 else v_break_minutes end,
      null::integer,
      null::numeric,
      p_manual_paid_hours;
    return;
  end if;

  v_start_ts := timestamp '2000-01-01' + p_start_time;
  v_end_ts := timestamp '2000-01-01' + p_end_time;

  if coalesce(p_crosses_midnight, false) is true
     or p_end_time < p_start_time then
    v_end_ts := v_end_ts + interval '1 day';
  end if;

  v_gross_minutes := greatest(
    round(extract(epoch from (v_end_ts - v_start_ts)) / 60)::integer,
    0
  );

  v_unpaid_break_minutes := case
    when v_rule_paid_break is true then 0
    else least(v_break_minutes, v_gross_minutes)
  end;

  v_calculated_paid_minutes := greatest(v_gross_minutes - v_unpaid_break_minutes, 0);
  v_calculated_paid_hours := round((v_calculated_paid_minutes::numeric / 60), 2);

  return query
  select
    v_gross_minutes,
    round((v_gross_minutes::numeric / 60), 2),
    p_break_rule_id,
    v_rule_break_minutes,
    v_rule_paid_break,
    v_break_minutes,
    v_unpaid_break_minutes,
    v_calculated_paid_minutes,
    v_calculated_paid_hours,
    case
      when coalesce(p_paid_hours_manual_override, true) is true
        then p_manual_paid_hours
      else v_calculated_paid_hours
    end;
end;
$$;

grant execute on function public.calculate_work_time_profile_values(
  time,
  time,
  boolean,
  uuid,
  integer,
  boolean,
  numeric
) to authenticated;

-- ------------------------------------------------------------
-- 4. Trigger: maintain calculated values on Work Time Profiles
-- ------------------------------------------------------------

create or replace function public.apply_work_time_profile_break_alignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_calc record;
begin
  select *
  into v_calc
  from public.calculate_work_time_profile_values(
    new.start_time,
    new.end_time,
    coalesce(new.crosses_midnight, false),
    new.break_rule_id,
    new.break_minutes,
    coalesce(new.paid_hours_manual_override, true),
    new.paid_hours
  );

  new.gross_hours := v_calc.gross_hours;
  new.effective_break_minutes := v_calc.effective_break_minutes;
  new.calculated_paid_hours := v_calc.calculated_paid_hours;

  -- Preserve current behaviour by default.
  -- Existing and manual profiles keep paid_hours as the admin-entered value.
  -- Only when manual override is disabled does paid_hours follow calculation.
  if coalesce(new.paid_hours_manual_override, true) is false then
    new.paid_hours := v_calc.calculated_paid_hours;
  elsif new.paid_hours is null then
    new.paid_hours := v_calc.calculated_paid_hours;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_work_time_profiles_break_alignment
on public.work_time_profiles;

create trigger trg_work_time_profiles_break_alignment
before insert or update of
  start_time,
  end_time,
  crosses_midnight,
  break_rule_id,
  break_minutes,
  paid_hours_manual_override,
  paid_hours
on public.work_time_profiles
for each row
execute function public.apply_work_time_profile_break_alignment();

-- Backfill calculated fields while preserving existing paid_hours.
update public.work_time_profiles
set paid_hours_manual_override = coalesce(paid_hours_manual_override, true)
where true;

-- ------------------------------------------------------------
-- 5. Best-effort link existing profiles to exact matching break rule
-- ------------------------------------------------------------
-- FIX:
-- PostgreSQL does not support min(uuid), so this uses array_agg ordered
-- by UUID text and only links when exactly one break rule matches.

with exact_matches as (
  select
    wtp.id as work_time_profile_id,
    matched.break_rule_id,
    matched.match_count
  from public.work_time_profiles wtp
  cross join lateral (
    select
      (array_agg(br.id order by br.id::text))[1] as break_rule_id,
      count(*)::integer as match_count
    from public.break_rules br
    where br.break_minutes = wtp.break_minutes
  ) matched
  where wtp.break_rule_id is null
    and wtp.break_minutes is not null
    and matched.match_count = 1
)
update public.work_time_profiles wtp
set
  break_rule_id = em.break_rule_id,
  break_alignment_notes = coalesce(
    wtp.break_alignment_notes,
    'Break rule linked automatically where an exact single break-minute match existed.'
  )
from exact_matches em
where wtp.id = em.work_time_profile_id;

-- Re-run trigger-calculated fields after optional linking.
update public.work_time_profiles
set paid_hours_manual_override = coalesce(paid_hours_manual_override, true)
where true;

-- ------------------------------------------------------------
-- 6. Capability helper wrappers
-- ------------------------------------------------------------

create or replace function public.can_view_work_time_profile_alignment()
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
      or public.user_has_capability('workforce_calendar.view')
      or public.user_has_capability('workforce_calendar.manage')
      or public.user_has_capability('settings.view')
      or public.user_has_capability('settings.edit')
    );
$$;

create or replace function public.can_manage_work_time_profile_alignment()
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
      or public.user_has_capability('workforce_calendar.manage')
      or public.user_has_capability('settings.edit')
    );
$$;

grant execute on function public.can_view_work_time_profile_alignment() to authenticated;
grant execute on function public.can_manage_work_time_profile_alignment() to authenticated;

-- ------------------------------------------------------------
-- 7. RPC: list break rule options for Work Time Profiles
-- ------------------------------------------------------------

create or replace function public.list_work_time_profile_break_rule_options()
returns table (
  break_rule_id uuid,
  break_minutes integer,
  paid_break boolean,
  break_rule_label text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_work_time_profile_alignment() then
    raise exception 'You do not have permission to view break rules';
  end if;

  return query
  select
    br.id as break_rule_id,
    br.break_minutes,
    coalesce(br.paid_break, false) as paid_break,
    (
      coalesce(br.break_minutes, 0)::text ||
      ' min ' ||
      case when coalesce(br.paid_break, false) then 'paid break' else 'unpaid break' end
    ) as break_rule_label
  from public.break_rules br
  order by
    br.break_minutes asc,
    coalesce(br.paid_break, false) asc,
    br.id;
end;
$$;

grant execute on function public.list_work_time_profile_break_rule_options() to authenticated;

-- ------------------------------------------------------------
-- 8. RPC: list Work Time Profiles with break alignment details
-- ------------------------------------------------------------

create or replace function public.list_work_time_profiles_with_break_alignment(
  p_include_inactive boolean default true,
  p_search_text text default null
)
returns table (
  profile_id uuid,
  profile_code text,
  profile_name text,
  start_time time,
  end_time time,
  crosses_midnight boolean,
  break_rule_id uuid,
  break_rule_label text,
  break_rule_break_minutes integer,
  break_rule_paid_break boolean,
  legacy_break_minutes integer,
  effective_break_minutes integer,
  gross_hours numeric,
  calculated_paid_hours numeric,
  paid_hours_manual_override boolean,
  paid_hours numeric,
  unsociable_hours numeric,
  active boolean,
  display_order integer,
  custom_tag_1 text,
  custom_tag_2 text,
  custom_tag_3 text,
  notes text,
  break_alignment_notes text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_work_time_profile_alignment() then
    raise exception 'You do not have permission to view work time profile alignment';
  end if;

  return query
  select
    wtp.id as profile_id,
    wtp.profile_code,
    wtp.profile_name,
    wtp.start_time,
    wtp.end_time,
    wtp.crosses_midnight,
    wtp.break_rule_id,
    case
      when br.id is null then null
      else (
        coalesce(br.break_minutes, 0)::text ||
        ' min ' ||
        case when coalesce(br.paid_break, false) then 'paid break' else 'unpaid break' end
      )
    end as break_rule_label,
    br.break_minutes as break_rule_break_minutes,
    coalesce(br.paid_break, false) as break_rule_paid_break,
    wtp.break_minutes as legacy_break_minutes,
    wtp.effective_break_minutes,
    wtp.gross_hours,
    wtp.calculated_paid_hours,
    coalesce(wtp.paid_hours_manual_override, true) as paid_hours_manual_override,
    wtp.paid_hours,
    wtp.unsociable_hours,
    wtp.active,
    wtp.display_order,
    wtp.custom_tag_1,
    wtp.custom_tag_2,
    wtp.custom_tag_3,
    wtp.notes,
    wtp.break_alignment_notes,
    wtp.metadata,
    wtp.created_at,
    wtp.updated_at
  from public.work_time_profiles wtp
  left join public.break_rules br
    on br.id = wtp.break_rule_id
  where (p_include_inactive is true or wtp.active is true)
    and (
      p_search_text is null
      or trim(p_search_text) = ''
      or (
        coalesce(wtp.profile_code, '') || ' ' ||
        coalesce(wtp.profile_name, '') || ' ' ||
        coalesce(wtp.custom_tag_1, '') || ' ' ||
        coalesce(wtp.custom_tag_2, '') || ' ' ||
        coalesce(wtp.custom_tag_3, '') || ' ' ||
        coalesce(wtp.notes, '') || ' ' ||
        coalesce(wtp.break_alignment_notes, '') || ' ' ||
        wtp.id::text
      ) ilike '%' || p_search_text || '%'
    )
  order by
    wtp.active desc,
    wtp.display_order asc nulls last,
    wtp.profile_name asc,
    wtp.profile_code asc;
end;
$$;

grant execute on function public.list_work_time_profiles_with_break_alignment(boolean, text) to authenticated;

-- ------------------------------------------------------------
-- 9. RPC: update alignment only
-- ------------------------------------------------------------

create or replace function public.update_work_time_profile_break_alignment(
  p_profile_id uuid,
  p_break_rule_id uuid default null,
  p_use_break_rule boolean default true,
  p_legacy_break_minutes integer default null,
  p_paid_hours_manual_override boolean default true,
  p_paid_hours numeric default null,
  p_break_alignment_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  if not public.can_manage_work_time_profile_alignment() then
    raise exception 'You do not have permission to manage work time profile alignment';
  end if;

  if p_profile_id is null then
    raise exception 'Work Time Profile is required';
  end if;

  if p_use_break_rule is true and p_break_rule_id is not null then
    if not exists (
      select 1
      from public.break_rules br
      where br.id = p_break_rule_id
    ) then
      raise exception 'Selected break rule was not found';
    end if;
  end if;

  update public.work_time_profiles
  set
    break_rule_id = case
      when coalesce(p_use_break_rule, true) is true then p_break_rule_id
      else null
    end,
    break_minutes = case
      when coalesce(p_use_break_rule, true) is true then break_minutes
      else greatest(coalesce(p_legacy_break_minutes, break_minutes, 0), 0)
    end,
    paid_hours_manual_override = coalesce(p_paid_hours_manual_override, true),
    paid_hours = case
      when coalesce(p_paid_hours_manual_override, true) is true
        then p_paid_hours
      else paid_hours
    end,
    break_alignment_notes = p_break_alignment_notes
  where id = p_profile_id
  returning id into v_profile_id;

  if v_profile_id is null then
    raise exception 'Work Time Profile was not found';
  end if;

  begin
    perform public.write_audit_event(
      'work_time_profile.break_alignment_updated',
      'work_time_profiles',
      v_profile_id::text,
      jsonb_build_object(
        'summary', 'Work Time Profile break alignment updated.',
        'break_rule_id', p_break_rule_id,
        'use_break_rule', p_use_break_rule,
        'paid_hours_manual_override', p_paid_hours_manual_override,
        'paid_hours', p_paid_hours
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during Work Time Profile break alignment update: %', sqlerrm;
  end;

  return v_profile_id;
end;
$$;

grant execute on function public.update_work_time_profile_break_alignment(
  uuid,
  uuid,
  boolean,
  integer,
  boolean,
  numeric,
  text
) to authenticated;

-- ------------------------------------------------------------
-- 10. Verification
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

select
  'OHP-013B.3 work time profile / break rule alignment installed' as result,
  (select count(*) from public.work_time_profiles) as work_time_profiles_checked,
  (select count(*) from public.work_time_profiles where break_rule_id is not null) as profiles_with_break_rule,
  (select count(*) from public.work_time_profiles where calculated_paid_hours is not null) as profiles_with_calculated_paid_hours;