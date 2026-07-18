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

-- ============================================================
-- OHP-013B.3 Follow-up: Complete Working Time Rule Alignment
-- ============================================================

-- ============================================================
-- Operations Hub - OHP-013B.3 Follow-up
-- Complete Working Time Rule Alignment
--
-- Purpose:
-- - Extend Break Rules to support paid + unpaid break minutes.
-- - Add configurable Unsociable Time Rules.
-- - Add calculated unsociable-hours suggestion to Work Time Profiles.
-- - Preserve existing manual paid_hours and unsociable_hours by default.
-- - Keep Assignment-level break rule as hidden/advanced legacy override.
--
-- Safety:
-- - Existing break_rules.break_minutes and break_rules.paid_break are preserved
--   as compatibility fields.
-- - Existing Work Time Profile paid_hours values are preserved.
-- - Existing Work Time Profile unsociable_hours values are preserved.
-- - Rota output should not change unless admin explicitly changes profile values.
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
  'working_time_rules',
  'Working Time Rules',
  'Break rules and unsociable time rules used by Work Time Profiles and future LMT.',
  142,
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
      'break_rules.view',
      'View break rules',
      'Allows users to view paid/unpaid break rules.'
    ),
    (
      'break_rules.manage',
      'Manage break rules',
      'Allows users to create and update paid/unpaid break rules.'
    ),
    (
      'unsociable_time_rules.view',
      'View unsociable time rules',
      'Allows users to view configurable unsociable time bands.'
    ),
    (
      'unsociable_time_rules.manage',
      'Manage unsociable time rules',
      'Allows users to create and update configurable unsociable time bands.'
    )
) as c(capability_code, capability_name, capability_description)
where cg.group_code = 'working_time_rules'
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
    'break_rules.view',
    'break_rules.manage',
    'unsociable_time_rules.view',
    'unsociable_time_rules.manage'
  )
on conflict do nothing;

-- ------------------------------------------------------------
-- 2. Extend Break Rules to paid + unpaid minutes
-- ------------------------------------------------------------

alter table public.break_rules
add column if not exists rule_code text;

alter table public.break_rules
add column if not exists rule_name text;

alter table public.break_rules
add column if not exists paid_break_minutes integer;

alter table public.break_rules
add column if not exists unpaid_break_minutes integer;

alter table public.break_rules
add column if not exists total_break_minutes integer;

alter table public.break_rules
add column if not exists active boolean not null default true;

alter table public.break_rules
add column if not exists display_order integer;

alter table public.break_rules
add column if not exists notes text;

alter table public.break_rules
add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.break_rules
add column if not exists created_at timestamptz not null default now();

alter table public.break_rules
add column if not exists updated_at timestamptz not null default now();

-- Backfill paid/unpaid split from legacy fields.
update public.break_rules br
set
  paid_break_minutes = coalesce(
    br.paid_break_minutes,
    case
      when coalesce(br.paid_break, false) is true then greatest(coalesce(br.break_minutes, 0), 0)
      else 0
    end
  ),
  unpaid_break_minutes = coalesce(
    br.unpaid_break_minutes,
    case
      when coalesce(br.paid_break, false) is true then 0
      else greatest(coalesce(br.break_minutes, 0), 0)
    end
  )
where br.paid_break_minutes is null
   or br.unpaid_break_minutes is null;

update public.break_rules br
set
  total_break_minutes = greatest(coalesce(br.paid_break_minutes, 0), 0)
                      + greatest(coalesce(br.unpaid_break_minutes, 0), 0),
  break_minutes = greatest(coalesce(br.paid_break_minutes, 0), 0)
                + greatest(coalesce(br.unpaid_break_minutes, 0), 0),
  paid_break = case
    when greatest(coalesce(br.paid_break_minutes, 0), 0) > 0
     and greatest(coalesce(br.unpaid_break_minutes, 0), 0) = 0
      then true
    else false
  end,
  rule_code = coalesce(
    nullif(trim(br.rule_code), ''),
    'break_' || br.id::text
  ),
  rule_name = coalesce(
    nullif(trim(br.rule_name), ''),
    (
      greatest(coalesce(br.paid_break_minutes, 0), 0)
      + greatest(coalesce(br.unpaid_break_minutes, 0), 0)
    )::text || ' min break'
  )
where true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'break_rules_rule_code_unique'
      and conrelid = 'public.break_rules'::regclass
  ) then
    alter table public.break_rules
    add constraint break_rules_rule_code_unique unique (rule_code);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'break_rules_paid_unpaid_minutes_check'
      and conrelid = 'public.break_rules'::regclass
  ) then
    alter table public.break_rules
    add constraint break_rules_paid_unpaid_minutes_check
    check (
      paid_break_minutes >= 0
      and unpaid_break_minutes >= 0
      and total_break_minutes = paid_break_minutes + unpaid_break_minutes
      and break_minutes = total_break_minutes
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'break_rules_rule_code_not_blank'
      and conrelid = 'public.break_rules'::regclass
  ) then
    alter table public.break_rules
    add constraint break_rules_rule_code_not_blank
    check (length(trim(rule_code)) > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'break_rules_rule_name_not_blank'
      and conrelid = 'public.break_rules'::regclass
  ) then
    alter table public.break_rules
    add constraint break_rules_rule_name_not_blank
    check (length(trim(rule_name)) > 0);
  end if;
end;
$$;

create index if not exists idx_break_rules_active_order
on public.break_rules(active, display_order, rule_name);

-- Keep legacy compatibility fields aligned.
create or replace function public.apply_break_rule_paid_unpaid_alignment()
returns trigger
language plpgsql
as $$
begin
  if new.paid_break_minutes is null and new.unpaid_break_minutes is null then
    if coalesce(new.paid_break, false) is true then
      new.paid_break_minutes := greatest(coalesce(new.break_minutes, 0), 0);
      new.unpaid_break_minutes := 0;
    else
      new.paid_break_minutes := 0;
      new.unpaid_break_minutes := greatest(coalesce(new.break_minutes, 0), 0);
    end if;
  else
    new.paid_break_minutes := greatest(coalesce(new.paid_break_minutes, 0), 0);
    new.unpaid_break_minutes := greatest(coalesce(new.unpaid_break_minutes, 0), 0);
  end if;

  new.total_break_minutes := new.paid_break_minutes + new.unpaid_break_minutes;
  new.break_minutes := new.total_break_minutes;

  -- Legacy boolean cannot represent mixed breaks.
  -- True only means "fully paid break" for compatibility.
  new.paid_break := case
    when new.paid_break_minutes > 0 and new.unpaid_break_minutes = 0 then true
    else false
  end;

  if nullif(trim(coalesce(new.rule_code, '')), '') is null then
    new.rule_code := 'break_' || coalesce(new.id, gen_random_uuid())::text;
  end if;

  if nullif(trim(coalesce(new.rule_name, '')), '') is null then
    new.rule_name := new.total_break_minutes::text || ' min break';
  end if;

  new.updated_at := now();

  return new;
end;
$$;

drop trigger if exists trg_break_rules_paid_unpaid_alignment on public.break_rules;

create trigger trg_break_rules_paid_unpaid_alignment
before insert or update of
  break_minutes,
  paid_break,
  paid_break_minutes,
  unpaid_break_minutes,
  total_break_minutes,
  rule_code,
  rule_name
on public.break_rules
for each row
execute function public.apply_break_rule_paid_unpaid_alignment();

-- ------------------------------------------------------------
-- 3. Unsociable Time Rules
-- ------------------------------------------------------------

create table if not exists public.unsociable_time_rules (
  id uuid primary key default gen_random_uuid(),

  rule_code text not null unique,
  rule_name text not null,

  start_time time not null,
  end_time time not null,
  crosses_midnight boolean not null default false,
  full_day boolean not null default false,

  applies_monday boolean not null default true,
  applies_tuesday boolean not null default true,
  applies_wednesday boolean not null default true,
  applies_thursday boolean not null default true,
  applies_friday boolean not null default true,
  applies_saturday boolean not null default true,
  applies_sunday boolean not null default true,

  active boolean not null default true,
  display_order integer,
  notes text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint unsociable_time_rules_code_not_blank
    check (length(trim(rule_code)) > 0),

  constraint unsociable_time_rules_name_not_blank
    check (length(trim(rule_name)) > 0),

  constraint unsociable_time_rules_at_least_one_day
    check (
      applies_monday
      or applies_tuesday
      or applies_wednesday
      or applies_thursday
      or applies_friday
      or applies_saturday
      or applies_sunday
    )
);

create index if not exists idx_unsociable_time_rules_active_order
on public.unsociable_time_rules(active, display_order, rule_name);

create or replace function public.apply_unsociable_time_rules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();

  if nullif(trim(coalesce(new.rule_code, '')), '') is null then
    raise exception 'Rule code is required';
  end if;

  if nullif(trim(coalesce(new.rule_name, '')), '') is null then
    raise exception 'Rule name is required';
  end if;

  if new.full_day is true then
    new.start_time := time '00:00';
    new.end_time := time '00:00';
    new.crosses_midnight := false;
  elsif new.end_time < new.start_time then
    new.crosses_midnight := true;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_unsociable_time_rules_updated_at on public.unsociable_time_rules;

create trigger trg_unsociable_time_rules_updated_at
before insert or update
on public.unsociable_time_rules
for each row
execute function public.apply_unsociable_time_rules_updated_at();

-- ------------------------------------------------------------
-- 4. Extend Work Time Profiles for unsociable suggestions
-- ------------------------------------------------------------

alter table public.work_time_profiles
add column if not exists effective_paid_break_minutes integer;

alter table public.work_time_profiles
add column if not exists effective_unpaid_break_minutes integer;

alter table public.work_time_profiles
add column if not exists calculated_unsociable_hours numeric(8,2);

alter table public.work_time_profiles
add column if not exists unsociable_hours_manual_override boolean not null default true;

alter table public.work_time_profiles
add column if not exists unsociable_alignment_notes text;

-- Preserve existing unsociable hours as manual by default.
update public.work_time_profiles
set unsociable_hours_manual_override = coalesce(unsociable_hours_manual_override, true)
where true;

-- ------------------------------------------------------------
-- 5. Permission helpers
-- ------------------------------------------------------------

create or replace function public.can_view_working_time_rules()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('break_rules.view')
      or public.user_has_capability('break_rules.manage')
      or public.user_has_capability('unsociable_time_rules.view')
      or public.user_has_capability('unsociable_time_rules.manage')
      or public.user_has_capability('work_time_profiles.view')
      or public.user_has_capability('work_time_profiles.manage')
      or public.user_has_capability('workforce_calendar.view')
      or public.user_has_capability('workforce_calendar.manage')
      or public.user_has_capability('settings.view')
      or public.user_has_capability('settings.edit')
    );
$$;

create or replace function public.can_manage_working_time_rules()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('break_rules.manage')
      or public.user_has_capability('unsociable_time_rules.manage')
      or public.user_has_capability('work_time_profiles.manage')
      or public.user_has_capability('workforce_calendar.manage')
      or public.user_has_capability('settings.edit')
    );
$$;

grant execute on function public.can_view_working_time_rules() to authenticated;
grant execute on function public.can_manage_working_time_rules() to authenticated;

-- ------------------------------------------------------------
-- 6. RLS for Unsociable Time Rules
-- ------------------------------------------------------------

alter table public.unsociable_time_rules enable row level security;

drop policy if exists "admins can view unsociable time rules" on public.unsociable_time_rules;
drop policy if exists "admins can insert unsociable time rules" on public.unsociable_time_rules;
drop policy if exists "admins can update unsociable time rules" on public.unsociable_time_rules;

create policy "admins can view unsociable time rules"
on public.unsociable_time_rules
for select
to authenticated
using (public.can_view_working_time_rules());

create policy "admins can insert unsociable time rules"
on public.unsociable_time_rules
for insert
to authenticated
with check (public.can_manage_working_time_rules());

create policy "admins can update unsociable time rules"
on public.unsociable_time_rules
for update
to authenticated
using (public.can_manage_working_time_rules())
with check (public.can_manage_working_time_rules());

grant select, insert, update on public.unsociable_time_rules to authenticated;

-- ------------------------------------------------------------
-- 7. Helper: calculate unsociable minutes for a shift/day
-- ------------------------------------------------------------
-- ISO day of week:
-- 1 Monday ... 7 Sunday
--
-- This avoids double-counting overlapping unsociable rules.
-- A minute counts once if it matches any active rule.

create or replace function public.calculate_unsociable_minutes_for_shift(
  p_start_time time,
  p_end_time time,
  p_crosses_midnight boolean default false,
  p_iso_dow integer default 1
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_iso_dow integer := least(greatest(coalesce(p_iso_dow, 1), 1), 7);
  v_start_date date := date '2024-01-01';
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_minute_ts timestamp;
  v_time time;
  v_current_dow integer;
  v_previous_dow integer;
  v_minutes integer := 0;
begin
  if p_start_time is null or p_end_time is null then
    return null;
  end if;

  -- 2024-01-01 is Monday. Offset to requested ISO day.
  v_start_date := v_start_date + (v_iso_dow - 1);

  v_start_ts := v_start_date + p_start_time;
  v_end_ts := v_start_date + p_end_time;

  if coalesce(p_crosses_midnight, false) is true
     or p_end_time < p_start_time then
    v_end_ts := v_end_ts + interval '1 day';
  end if;

  if v_end_ts <= v_start_ts then
    return 0;
  end if;

  for v_minute_ts in
    select generate_series(v_start_ts, v_end_ts - interval '1 minute', interval '1 minute')
  loop
    v_time := v_minute_ts::time;
    v_current_dow := extract(isodow from v_minute_ts)::integer;
    v_previous_dow := case when v_current_dow = 1 then 7 else v_current_dow - 1 end;

    if exists (
      select 1
      from public.unsociable_time_rules r
      where r.active is true
        and (
          -- Full-day rule applies to the current minute's day.
          (
            r.full_day is true
            and case v_current_dow
              when 1 then r.applies_monday
              when 2 then r.applies_tuesday
              when 3 then r.applies_wednesday
              when 4 then r.applies_thursday
              when 5 then r.applies_friday
              when 6 then r.applies_saturday
              when 7 then r.applies_sunday
              else false
            end
          )

          or

          -- Same-day time band.
          (
            r.full_day is false
            and coalesce(r.crosses_midnight, false) is false
            and r.start_time < r.end_time
            and v_time >= r.start_time
            and v_time < r.end_time
            and case v_current_dow
              when 1 then r.applies_monday
              when 2 then r.applies_tuesday
              when 3 then r.applies_wednesday
              when 4 then r.applies_thursday
              when 5 then r.applies_friday
              when 6 then r.applies_saturday
              when 7 then r.applies_sunday
              else false
            end
          )

          or

          -- Cross-midnight rule.
          -- Minutes after midnight belong to the previous day's rule window.
          (
            r.full_day is false
            and coalesce(r.crosses_midnight, false) is true
            and (
              (
                v_time >= r.start_time
                and case v_current_dow
                  when 1 then r.applies_monday
                  when 2 then r.applies_tuesday
                  when 3 then r.applies_wednesday
                  when 4 then r.applies_thursday
                  when 5 then r.applies_friday
                  when 6 then r.applies_saturday
                  when 7 then r.applies_sunday
                  else false
                end
              )
              or
              (
                v_time < r.end_time
                and case v_previous_dow
                  when 1 then r.applies_monday
                  when 2 then r.applies_tuesday
                  when 3 then r.applies_wednesday
                  when 4 then r.applies_thursday
                  when 5 then r.applies_friday
                  when 6 then r.applies_saturday
                  when 7 then r.applies_sunday
                  else false
                end
              )
            )
          )
        )
      limit 1
    ) then
      v_minutes := v_minutes + 1;
    end if;
  end loop;

  return v_minutes;
end;
$$;

grant execute on function public.calculate_unsociable_minutes_for_shift(time, time, boolean, integer) to authenticated;

-- ------------------------------------------------------------
-- 8. Calculation helpers
-- ------------------------------------------------------------

create or replace function public.calculate_work_time_profile_values_v2(
  p_start_time time,
  p_end_time time,
  p_crosses_midnight boolean default false,
  p_break_rule_id uuid default null,
  p_break_minutes integer default null,
  p_paid_hours_manual_override boolean default true,
  p_manual_paid_hours numeric default null,
  p_unsociable_hours_manual_override boolean default true,
  p_manual_unsociable_hours numeric default null,
  p_iso_dow integer default 1
)
returns table (
  gross_minutes integer,
  gross_hours numeric,
  break_rule_id uuid,
  paid_break_minutes integer,
  unpaid_break_minutes integer,
  effective_break_minutes integer,
  unpaid_break_minutes_for_pay integer,
  calculated_paid_minutes integer,
  calculated_paid_hours numeric,
  calculated_unsociable_minutes integer,
  calculated_unsociable_hours numeric,
  final_paid_hours numeric,
  final_unsociable_hours numeric
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
  v_paid_break_minutes integer := 0;
  v_unpaid_break_minutes integer := greatest(coalesce(p_break_minutes, 0), 0);
  v_effective_break_minutes integer;
  v_calculated_paid_minutes integer;
  v_calculated_paid_hours numeric;
  v_unsociable_minutes integer;
  v_unsociable_hours numeric;
begin
  if p_break_rule_id is not null then
    select
      greatest(coalesce(br.paid_break_minutes, case when coalesce(br.paid_break, false) then br.break_minutes else 0 end, 0), 0),
      greatest(coalesce(br.unpaid_break_minutes, case when coalesce(br.paid_break, false) then 0 else br.break_minutes end, 0), 0)
    into
      v_paid_break_minutes,
      v_unpaid_break_minutes
    from public.break_rules br
    where br.id = p_break_rule_id;

    if not found then
      v_paid_break_minutes := 0;
      v_unpaid_break_minutes := greatest(coalesce(p_break_minutes, 0), 0);
    end if;
  end if;

  v_effective_break_minutes := v_paid_break_minutes + v_unpaid_break_minutes;

  if p_start_time is null or p_end_time is null then
    return query
    select
      null::integer,
      null::numeric,
      p_break_rule_id,
      v_paid_break_minutes,
      v_unpaid_break_minutes,
      v_effective_break_minutes,
      v_unpaid_break_minutes,
      null::integer,
      null::numeric,
      null::integer,
      null::numeric,
      p_manual_paid_hours,
      p_manual_unsociable_hours;
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

  v_unpaid_break_minutes := least(v_unpaid_break_minutes, v_gross_minutes);
  v_calculated_paid_minutes := greatest(v_gross_minutes - v_unpaid_break_minutes, 0);
  v_calculated_paid_hours := round((v_calculated_paid_minutes::numeric / 60), 2);

  v_unsociable_minutes := public.calculate_unsociable_minutes_for_shift(
    p_start_time,
    p_end_time,
    coalesce(p_crosses_midnight, false),
    p_iso_dow
  );

  v_unsociable_hours := case
    when v_unsociable_minutes is null then null
    else round((v_unsociable_minutes::numeric / 60), 2)
  end;

  return query
  select
    v_gross_minutes,
    round((v_gross_minutes::numeric / 60), 2),
    p_break_rule_id,
    v_paid_break_minutes,
    v_unpaid_break_minutes,
    v_effective_break_minutes,
    v_unpaid_break_minutes,
    v_calculated_paid_minutes,
    v_calculated_paid_hours,
    v_unsociable_minutes,
    v_unsociable_hours,
    case
      when coalesce(p_paid_hours_manual_override, true) is true
        then p_manual_paid_hours
      else v_calculated_paid_hours
    end,
    case
      when coalesce(p_unsociable_hours_manual_override, true) is true
        then p_manual_unsociable_hours
      else v_unsociable_hours
    end;
end;
$$;

grant execute on function public.calculate_work_time_profile_values_v2(
  time,
  time,
  boolean,
  uuid,
  integer,
  boolean,
  numeric,
  boolean,
  numeric,
  integer
) to authenticated;

-- Keep original function signature compatible, but use paid/unpaid rule model internally.
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
begin
  return query
  select
    v2.gross_minutes,
    v2.gross_hours,
    v2.break_rule_id,
    v2.effective_break_minutes as break_rule_break_minutes,
    case when v2.paid_break_minutes > 0 and v2.unpaid_break_minutes = 0 then true else false end as break_rule_paid_break,
    v2.effective_break_minutes,
    v2.unpaid_break_minutes_for_pay as unpaid_break_minutes,
    v2.calculated_paid_minutes,
    v2.calculated_paid_hours,
    v2.final_paid_hours
  from public.calculate_work_time_profile_values_v2(
    p_start_time,
    p_end_time,
    p_crosses_midnight,
    p_break_rule_id,
    p_break_minutes,
    p_paid_hours_manual_override,
    p_manual_paid_hours,
    true,
    null,
    1
  ) v2;
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
-- 9. Update Work Time Profile trigger to calculate paid/unpaid + unsociable
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
  from public.calculate_work_time_profile_values_v2(
    new.start_time,
    new.end_time,
    coalesce(new.crosses_midnight, false),
    new.break_rule_id,
    new.break_minutes,
    coalesce(new.paid_hours_manual_override, true),
    new.paid_hours,
    coalesce(new.unsociable_hours_manual_override, true),
    new.unsociable_hours,
    1
  );

  new.gross_hours := v_calc.gross_hours;
  new.effective_paid_break_minutes := v_calc.paid_break_minutes;
  new.effective_unpaid_break_minutes := v_calc.unpaid_break_minutes;
  new.effective_break_minutes := v_calc.effective_break_minutes;
  new.calculated_paid_hours := v_calc.calculated_paid_hours;
  new.calculated_unsociable_hours := v_calc.calculated_unsociable_hours;

  -- Preserve current behaviour by default.
  if coalesce(new.paid_hours_manual_override, true) is false then
    new.paid_hours := v_calc.calculated_paid_hours;
  elsif new.paid_hours is null then
    new.paid_hours := v_calc.calculated_paid_hours;
  end if;

  if coalesce(new.unsociable_hours_manual_override, true) is false then
    new.unsociable_hours := v_calc.calculated_unsociable_hours;
  elsif new.unsociable_hours is null then
    new.unsociable_hours := v_calc.calculated_unsociable_hours;
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
  paid_hours,
  unsociable_hours_manual_override,
  unsociable_hours
on public.work_time_profiles
for each row
execute function public.apply_work_time_profile_break_alignment();

-- Backfill calculated fields while preserving manual final values.
update public.work_time_profiles
set
  paid_hours_manual_override = coalesce(paid_hours_manual_override, true),
  unsociable_hours_manual_override = coalesce(unsociable_hours_manual_override, true)
where true;

-- ------------------------------------------------------------
-- 10. Replace Work Time Profile alignment RPCs with extended fields
-- ------------------------------------------------------------

drop function if exists public.list_work_time_profile_break_rule_options();

create or replace function public.list_work_time_profile_break_rule_options()
returns table (
  break_rule_id uuid,
  break_minutes integer,
  paid_break boolean,
  break_rule_label text,
  rule_code text,
  rule_name text,
  paid_break_minutes integer,
  unpaid_break_minutes integer,
  total_break_minutes integer,
  active boolean
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
    br.total_break_minutes as break_minutes,
    coalesce(br.paid_break, false) as paid_break,
    (
      coalesce(br.rule_name, 'Break rule') ||
      ' — ' ||
      coalesce(br.total_break_minutes, 0)::text ||
      ' min total (' ||
      coalesce(br.paid_break_minutes, 0)::text ||
      ' paid, ' ||
      coalesce(br.unpaid_break_minutes, 0)::text ||
      ' unpaid)'
    ) as break_rule_label,
    br.rule_code,
    br.rule_name,
    coalesce(br.paid_break_minutes, 0) as paid_break_minutes,
    coalesce(br.unpaid_break_minutes, 0) as unpaid_break_minutes,
    coalesce(br.total_break_minutes, br.break_minutes, 0) as total_break_minutes,
    coalesce(br.active, true) as active
  from public.break_rules br
  where coalesce(br.active, true) is true
  order by
    br.display_order asc nulls last,
    br.rule_name asc,
    br.total_break_minutes asc,
    br.id;
end;
$$;

grant execute on function public.list_work_time_profile_break_rule_options() to authenticated;

drop function if exists public.list_work_time_profiles_with_break_alignment(boolean, text);

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
  break_rule_paid_minutes integer,
  break_rule_unpaid_minutes integer,
  break_rule_total_minutes integer,
  break_rule_break_minutes integer,
  break_rule_paid_break boolean,
  legacy_break_minutes integer,
  effective_paid_break_minutes integer,
  effective_unpaid_break_minutes integer,
  effective_break_minutes integer,
  gross_hours numeric,
  calculated_paid_hours numeric,
  paid_hours_manual_override boolean,
  paid_hours numeric,
  calculated_unsociable_hours numeric,
  unsociable_hours_manual_override boolean,
  unsociable_hours numeric,
  active boolean,
  display_order integer,
  custom_tag_1 text,
  custom_tag_2 text,
  custom_tag_3 text,
  notes text,
  break_alignment_notes text,
  unsociable_alignment_notes text,
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
        coalesce(br.rule_name, 'Break rule') ||
        ' — ' ||
        coalesce(br.total_break_minutes, br.break_minutes, 0)::text ||
        ' min total (' ||
        coalesce(br.paid_break_minutes, 0)::text ||
        ' paid, ' ||
        coalesce(br.unpaid_break_minutes, 0)::text ||
        ' unpaid)'
      )
    end as break_rule_label,
    coalesce(br.paid_break_minutes, 0) as break_rule_paid_minutes,
    coalesce(br.unpaid_break_minutes, 0) as break_rule_unpaid_minutes,
    coalesce(br.total_break_minutes, br.break_minutes, 0) as break_rule_total_minutes,
    coalesce(br.total_break_minutes, br.break_minutes, 0) as break_rule_break_minutes,
    coalesce(br.paid_break, false) as break_rule_paid_break,
    wtp.break_minutes as legacy_break_minutes,
    wtp.effective_paid_break_minutes,
    wtp.effective_unpaid_break_minutes,
    wtp.effective_break_minutes,
    wtp.gross_hours,
    wtp.calculated_paid_hours,
    coalesce(wtp.paid_hours_manual_override, true) as paid_hours_manual_override,
    wtp.paid_hours,
    wtp.calculated_unsociable_hours,
    coalesce(wtp.unsociable_hours_manual_override, true) as unsociable_hours_manual_override,
    wtp.unsociable_hours,
    wtp.active,
    wtp.display_order,
    wtp.custom_tag_1,
    wtp.custom_tag_2,
    wtp.custom_tag_3,
    wtp.notes,
    wtp.break_alignment_notes,
    wtp.unsociable_alignment_notes,
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
        coalesce(wtp.unsociable_alignment_notes, '') || ' ' ||
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

drop function if exists public.update_work_time_profile_break_alignment(
  uuid,
  uuid,
  boolean,
  integer,
  boolean,
  numeric,
  text
);

create or replace function public.update_work_time_profile_break_alignment(
  p_profile_id uuid,
  p_break_rule_id uuid default null,
  p_use_break_rule boolean default true,
  p_legacy_break_minutes integer default null,
  p_paid_hours_manual_override boolean default true,
  p_paid_hours numeric default null,
  p_break_alignment_notes text default null,
  p_unsociable_hours_manual_override boolean default true,
  p_unsociable_hours numeric default null,
  p_unsociable_alignment_notes text default null
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
    break_alignment_notes = p_break_alignment_notes,
    unsociable_hours_manual_override = coalesce(p_unsociable_hours_manual_override, true),
    unsociable_hours = case
      when coalesce(p_unsociable_hours_manual_override, true) is true
        then p_unsociable_hours
      else unsociable_hours
    end,
    unsociable_alignment_notes = p_unsociable_alignment_notes
  where id = p_profile_id
  returning id into v_profile_id;

  if v_profile_id is null then
    raise exception 'Work Time Profile was not found';
  end if;

  begin
    perform public.write_audit_event(
      'work_time_profile.working_time_alignment_updated',
      'work_time_profiles',
      v_profile_id::text,
      jsonb_build_object(
        'summary', 'Work Time Profile working time alignment updated.',
        'break_rule_id', p_break_rule_id,
        'use_break_rule', p_use_break_rule,
        'paid_hours_manual_override', p_paid_hours_manual_override,
        'paid_hours', p_paid_hours,
        'unsociable_hours_manual_override', p_unsociable_hours_manual_override,
        'unsociable_hours', p_unsociable_hours
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during Work Time Profile working time alignment update: %', sqlerrm;
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
  text,
  boolean,
  numeric,
  text
) to authenticated;

-- ------------------------------------------------------------
-- 11. Break Rule management RPCs
-- ------------------------------------------------------------

create or replace function public.list_break_rules_with_paid_unpaid(
  p_include_inactive boolean default true,
  p_search_text text default null
)
returns table (
  break_rule_id uuid,
  rule_code text,
  rule_name text,
  paid_break_minutes integer,
  unpaid_break_minutes integer,
  total_break_minutes integer,
  legacy_paid_break boolean,
  active boolean,
  display_order integer,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_working_time_rules() then
    raise exception 'You do not have permission to view break rules';
  end if;

  return query
  select
    br.id,
    br.rule_code,
    br.rule_name,
    coalesce(br.paid_break_minutes, 0),
    coalesce(br.unpaid_break_minutes, 0),
    coalesce(br.total_break_minutes, br.break_minutes, 0),
    coalesce(br.paid_break, false),
    coalesce(br.active, true),
    br.display_order,
    br.notes,
    br.created_at,
    br.updated_at
  from public.break_rules br
  where (p_include_inactive is true or coalesce(br.active, true) is true)
    and (
      p_search_text is null
      or trim(p_search_text) = ''
      or (
        coalesce(br.rule_code, '') || ' ' ||
        coalesce(br.rule_name, '') || ' ' ||
        coalesce(br.notes, '') || ' ' ||
        br.id::text
      ) ilike '%' || p_search_text || '%'
    )
  order by
    coalesce(br.active, true) desc,
    br.display_order asc nulls last,
    br.rule_name asc;
end;
$$;

grant execute on function public.list_break_rules_with_paid_unpaid(boolean, text) to authenticated;

create or replace function public.upsert_break_rule_paid_unpaid(
  p_break_rule_id uuid default null,
  p_rule_code text default null,
  p_rule_name text default null,
  p_paid_break_minutes integer default 0,
  p_unpaid_break_minutes integer default 0,
  p_active boolean default true,
  p_display_order integer default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_break_rule_id uuid;
  v_rule_code text := lower(regexp_replace(trim(coalesce(p_rule_code, '')), '[^a-zA-Z0-9_]+', '_', 'g'));
  v_rule_name text := nullif(trim(coalesce(p_rule_name, '')), '');
  v_paid integer := greatest(coalesce(p_paid_break_minutes, 0), 0);
  v_unpaid integer := greatest(coalesce(p_unpaid_break_minutes, 0), 0);
begin
  if not public.can_manage_working_time_rules() then
    raise exception 'You do not have permission to manage break rules';
  end if;

  if v_rule_name is null then
    raise exception 'Break rule name is required';
  end if;

  if nullif(v_rule_code, '') is null then
    v_rule_code := lower(regexp_replace(v_rule_name, '[^a-zA-Z0-9_]+', '_', 'g'));
  end if;

  if v_paid + v_unpaid <= 0 then
    raise exception 'Break rule must have paid and/or unpaid break minutes';
  end if;

  if p_break_rule_id is null then
    insert into public.break_rules (
      rule_code,
      rule_name,
      paid_break_minutes,
      unpaid_break_minutes,
      active,
      display_order,
      notes
    )
    values (
      v_rule_code,
      v_rule_name,
      v_paid,
      v_unpaid,
      coalesce(p_active, true),
      p_display_order,
      p_notes
    )
    returning id into v_break_rule_id;
  else
    update public.break_rules
    set
      rule_code = v_rule_code,
      rule_name = v_rule_name,
      paid_break_minutes = v_paid,
      unpaid_break_minutes = v_unpaid,
      active = coalesce(p_active, true),
      display_order = p_display_order,
      notes = p_notes
    where id = p_break_rule_id
    returning id into v_break_rule_id;

    if v_break_rule_id is null then
      raise exception 'Break rule was not found';
    end if;
  end if;

  begin
    perform public.write_audit_event(
      'break_rule.upserted',
      'break_rules',
      v_break_rule_id::text,
      jsonb_build_object(
        'summary', 'Break rule created or updated.',
        'paid_break_minutes', v_paid,
        'unpaid_break_minutes', v_unpaid
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during break rule upsert: %', sqlerrm;
  end;

  return v_break_rule_id;
end;
$$;

grant execute on function public.upsert_break_rule_paid_unpaid(
  uuid,
  text,
  text,
  integer,
  integer,
  boolean,
  integer,
  text
) to authenticated;

-- ------------------------------------------------------------
-- 12. Unsociable Time Rule management RPCs
-- ------------------------------------------------------------

create or replace function public.list_unsociable_time_rules(
  p_include_inactive boolean default true,
  p_search_text text default null
)
returns table (
  rule_id uuid,
  rule_code text,
  rule_name text,
  start_time time,
  end_time time,
  crosses_midnight boolean,
  full_day boolean,
  applies_monday boolean,
  applies_tuesday boolean,
  applies_wednesday boolean,
  applies_thursday boolean,
  applies_friday boolean,
  applies_saturday boolean,
  applies_sunday boolean,
  active boolean,
  display_order integer,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_working_time_rules() then
    raise exception 'You do not have permission to view unsociable time rules';
  end if;

  return query
  select
    r.id,
    r.rule_code,
    r.rule_name,
    r.start_time,
    r.end_time,
    r.crosses_midnight,
    r.full_day,
    r.applies_monday,
    r.applies_tuesday,
    r.applies_wednesday,
    r.applies_thursday,
    r.applies_friday,
    r.applies_saturday,
    r.applies_sunday,
    r.active,
    r.display_order,
    r.notes,
    r.created_at,
    r.updated_at
  from public.unsociable_time_rules r
  where (p_include_inactive is true or r.active is true)
    and (
      p_search_text is null
      or trim(p_search_text) = ''
      or (
        coalesce(r.rule_code, '') || ' ' ||
        coalesce(r.rule_name, '') || ' ' ||
        coalesce(r.notes, '') || ' ' ||
        r.id::text
      ) ilike '%' || p_search_text || '%'
    )
  order by
    r.active desc,
    r.display_order asc nulls last,
    r.rule_name asc;
end;
$$;

grant execute on function public.list_unsociable_time_rules(boolean, text) to authenticated;

create or replace function public.upsert_unsociable_time_rule(
  p_rule_id uuid default null,
  p_rule_code text default null,
  p_rule_name text default null,
  p_start_time time default '00:00',
  p_end_time time default '00:00',
  p_crosses_midnight boolean default false,
  p_full_day boolean default false,
  p_applies_monday boolean default true,
  p_applies_tuesday boolean default true,
  p_applies_wednesday boolean default true,
  p_applies_thursday boolean default true,
  p_applies_friday boolean default true,
  p_applies_saturday boolean default true,
  p_applies_sunday boolean default true,
  p_active boolean default true,
  p_display_order integer default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule_id uuid;
  v_rule_code text := lower(regexp_replace(trim(coalesce(p_rule_code, '')), '[^a-zA-Z0-9_]+', '_', 'g'));
  v_rule_name text := nullif(trim(coalesce(p_rule_name, '')), '');
begin
  if not public.can_manage_working_time_rules() then
    raise exception 'You do not have permission to manage unsociable time rules';
  end if;

  if v_rule_name is null then
    raise exception 'Unsociable time rule name is required';
  end if;

  if nullif(v_rule_code, '') is null then
    v_rule_code := lower(regexp_replace(v_rule_name, '[^a-zA-Z0-9_]+', '_', 'g'));
  end if;

  if not (
    coalesce(p_applies_monday, false)
    or coalesce(p_applies_tuesday, false)
    or coalesce(p_applies_wednesday, false)
    or coalesce(p_applies_thursday, false)
    or coalesce(p_applies_friday, false)
    or coalesce(p_applies_saturday, false)
    or coalesce(p_applies_sunday, false)
  ) then
    raise exception 'Unsociable time rule must apply to at least one day';
  end if;

  if p_rule_id is null then
    insert into public.unsociable_time_rules (
      rule_code,
      rule_name,
      start_time,
      end_time,
      crosses_midnight,
      full_day,
      applies_monday,
      applies_tuesday,
      applies_wednesday,
      applies_thursday,
      applies_friday,
      applies_saturday,
      applies_sunday,
      active,
      display_order,
      notes
    )
    values (
      v_rule_code,
      v_rule_name,
      p_start_time,
      p_end_time,
      coalesce(p_crosses_midnight, false),
      coalesce(p_full_day, false),
      coalesce(p_applies_monday, false),
      coalesce(p_applies_tuesday, false),
      coalesce(p_applies_wednesday, false),
      coalesce(p_applies_thursday, false),
      coalesce(p_applies_friday, false),
      coalesce(p_applies_saturday, false),
      coalesce(p_applies_sunday, false),
      coalesce(p_active, true),
      p_display_order,
      p_notes
    )
    returning id into v_rule_id;
  else
    update public.unsociable_time_rules
    set
      rule_code = v_rule_code,
      rule_name = v_rule_name,
      start_time = p_start_time,
      end_time = p_end_time,
      crosses_midnight = coalesce(p_crosses_midnight, false),
      full_day = coalesce(p_full_day, false),
      applies_monday = coalesce(p_applies_monday, false),
      applies_tuesday = coalesce(p_applies_tuesday, false),
      applies_wednesday = coalesce(p_applies_wednesday, false),
      applies_thursday = coalesce(p_applies_thursday, false),
      applies_friday = coalesce(p_applies_friday, false),
      applies_saturday = coalesce(p_applies_saturday, false),
      applies_sunday = coalesce(p_applies_sunday, false),
      active = coalesce(p_active, true),
      display_order = p_display_order,
      notes = p_notes
    where id = p_rule_id
    returning id into v_rule_id;

    if v_rule_id is null then
      raise exception 'Unsociable time rule was not found';
    end if;
  end if;

  -- Recalculate Work Time Profile suggestions after rule changes,
  -- preserving final manual unsociable values by default.
  update public.work_time_profiles
  set unsociable_hours_manual_override = coalesce(unsociable_hours_manual_override, true)
  where true;

  begin
    perform public.write_audit_event(
      'unsociable_time_rule.upserted',
      'unsociable_time_rules',
      v_rule_id::text,
      jsonb_build_object(
        'summary', 'Unsociable time rule created or updated.',
        'rule_code', v_rule_code,
        'rule_name', v_rule_name
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during unsociable time rule upsert: %', sqlerrm;
  end;

  return v_rule_id;
end;
$$;

grant execute on function public.upsert_unsociable_time_rule(
  uuid,
  text,
  text,
  time,
  time,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  integer,
  text
) to authenticated;

-- ------------------------------------------------------------
-- 13. Preview Work Time Profile unsociable hours by day
-- ------------------------------------------------------------

create or replace function public.preview_work_time_profile_unsociable_by_day(
  p_profile_id uuid
)
returns table (
  iso_dow integer,
  day_name text,
  calculated_unsociable_minutes integer,
  calculated_unsociable_hours numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
begin
  if not public.can_view_work_time_profile_alignment() then
    raise exception 'You do not have permission to preview unsociable hours';
  end if;

  select
    wtp.start_time,
    wtp.end_time,
    wtp.crosses_midnight
  into v_profile
  from public.work_time_profiles wtp
  where wtp.id = p_profile_id;

  if not found then
    raise exception 'Work Time Profile was not found';
  end if;

  return query
  with days as (
    select *
    from (
      values
        (1, 'Monday'),
        (2, 'Tuesday'),
        (3, 'Wednesday'),
        (4, 'Thursday'),
        (5, 'Friday'),
        (6, 'Saturday'),
        (7, 'Sunday')
    ) as d(iso_dow, day_name)
  )
  select
    d.iso_dow,
    d.day_name,
    public.calculate_unsociable_minutes_for_shift(
      v_profile.start_time,
      v_profile.end_time,
      coalesce(v_profile.crosses_midnight, false),
      d.iso_dow
    ) as calculated_unsociable_minutes,
    round(
      public.calculate_unsociable_minutes_for_shift(
        v_profile.start_time,
        v_profile.end_time,
        coalesce(v_profile.crosses_midnight, false),
        d.iso_dow
      )::numeric / 60,
      2
    ) as calculated_unsociable_hours
  from days d
  order by d.iso_dow;
end;
$$;

grant execute on function public.preview_work_time_profile_unsociable_by_day(uuid) to authenticated;

-- ------------------------------------------------------------
-- 14. Verification
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

select
  'OHP-013B.3 follow-up working time rules installed' as result,
  (select count(*) from public.break_rules) as break_rules_checked,
  (select count(*) from public.unsociable_time_rules) as unsociable_time_rules_checked,
  (select count(*) from public.work_time_profiles where calculated_unsociable_hours is not null) as profiles_with_unsociable_suggestion;
