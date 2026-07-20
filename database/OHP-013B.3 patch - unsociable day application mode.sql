-- ============================================================
-- Operations Hub - OHP-013B.3 Patch
-- Unsociable Day Application Mode
--
-- Purpose:
-- - Add explicit day application mode to Unsociable Time Rules.
-- - Fix inconsistent overnight/weekend calculations.
--
-- Modes:
-- - shift_start_day:
--   The rule applies based on the day the shift starts.
--   Example: Sunday 22:00-06:00 with Sunday full-day rule = whole payable shift.
--
-- - calendar_minutes:
--   Each minute is tested against its actual calendar day/time.
--   Example: Sunday 22:00-Monday 06:00:
--   Sunday minutes follow Sunday rules, Monday minutes follow Monday rules.
--
-- Safety:
-- - Existing rules default to shift_start_day.
-- - Existing manual values are preserved.
-- - Final unsociable hours remain capped by paid hours.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Add day application mode to Unsociable Time Rules
-- ------------------------------------------------------------

alter table public.unsociable_time_rules
add column if not exists day_application_mode text not null default 'shift_start_day';

update public.unsociable_time_rules
set day_application_mode = coalesce(nullif(trim(day_application_mode), ''), 'shift_start_day')
where true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'unsociable_time_rules_day_application_mode_check'
      and conrelid = 'public.unsociable_time_rules'::regclass
  ) then
    alter table public.unsociable_time_rules
    add constraint unsociable_time_rules_day_application_mode_check
    check (day_application_mode in ('shift_start_day', 'calendar_minutes'));
  end if;
end;
$$;

create index if not exists idx_unsociable_time_rules_day_application_mode
on public.unsociable_time_rules(day_application_mode);

-- ------------------------------------------------------------
-- 2. Replace list_unsociable_time_rules with day_application_mode
-- ------------------------------------------------------------

drop function if exists public.list_unsociable_time_rules(boolean, text);

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
  day_application_mode text,
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
    coalesce(r.day_application_mode, 'shift_start_day') as day_application_mode,
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
        coalesce(r.day_application_mode, '') || ' ' ||
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

-- ------------------------------------------------------------
-- 3. Replace upsert_unsociable_time_rule with day_application_mode
--    New parameter added at the END to preserve old positional callers.
-- ------------------------------------------------------------

drop function if exists public.upsert_unsociable_time_rule(
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
);

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
  p_notes text default null,
  p_day_application_mode text default 'shift_start_day'
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
  v_day_application_mode text := lower(trim(coalesce(p_day_application_mode, 'shift_start_day')));
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

  if v_day_application_mode not in ('shift_start_day', 'calendar_minutes') then
    raise exception 'Invalid day application mode';
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
      day_application_mode,
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
      v_day_application_mode,
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
      day_application_mode = v_day_application_mode,
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

  -- Recalculate Work Time Profile suggestions after rule changes.
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
        'rule_name', v_rule_name,
        'day_application_mode', v_day_application_mode
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
  text,
  text
) to authenticated;

-- ------------------------------------------------------------
-- 4. Replace list_unsociable_time_rule_set_rules to expose mode
-- ------------------------------------------------------------

drop function if exists public.list_unsociable_time_rule_set_rules(uuid);

create or replace function public.list_unsociable_time_rule_set_rules(
  p_rule_set_id uuid
)
returns table (
  link_id uuid,
  rule_set_id uuid,
  rule_id uuid,
  rule_code text,
  rule_name text,
  start_time time,
  end_time time,
  crosses_midnight boolean,
  full_day boolean,
  day_application_mode text,
  active boolean,
  display_order integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_working_time_rules() then
    raise exception 'You do not have permission to view unsociable rule set rules';
  end if;

  if p_rule_set_id is null then
    raise exception 'Unsociable rule set is required';
  end if;

  return query
  select
    rsr.id as link_id,
    rsr.rule_set_id,
    r.id as rule_id,
    r.rule_code,
    r.rule_name,
    r.start_time,
    r.end_time,
    r.crosses_midnight,
    r.full_day,
    coalesce(r.day_application_mode, 'shift_start_day') as day_application_mode,
    r.active,
    rsr.display_order
  from public.unsociable_time_rule_set_rules rsr
  join public.unsociable_time_rules r
    on r.id = rsr.rule_id
  where rsr.rule_set_id = p_rule_set_id
  order by
    rsr.display_order asc nulls last,
    r.rule_name asc;
end;
$$;

grant execute on function public.list_unsociable_time_rule_set_rules(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. Replace calculation with explicit mode logic
-- ------------------------------------------------------------

create or replace function public.calculate_unsociable_minutes_for_shift_v2(
  p_start_time time,
  p_end_time time,
  p_crosses_midnight boolean default false,
  p_iso_dow integer default 1,
  p_unsociable_rule_set_id uuid default null
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shift_start_dow integer := least(greatest(coalesce(p_iso_dow, 1), 1), 7);
  v_start_date date := date '2024-01-01';
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_minute_ts timestamp;
  v_time time;
  v_current_dow integer;
  v_minutes integer := 0;
begin
  if p_start_time is null or p_end_time is null then
    return null;
  end if;

  -- No selected rule set means no automatic unsociable calculation.
  if p_unsociable_rule_set_id is null then
    return 0;
  end if;

  -- 2024-01-01 is Monday.
  v_start_date := v_start_date + (v_shift_start_dow - 1);

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

    if exists (
      select 1
      from public.unsociable_time_rule_set_rules rsr
      join public.unsociable_time_rules r
        on r.id = rsr.rule_id
      where rsr.rule_set_id = p_unsociable_rule_set_id
        and r.active is true
        and (
          -- ==================================================
          -- SHIFT START DAY MODE
          -- The rule's day flags are checked against the day
          -- the shift started.
          -- ==================================================
          (
            coalesce(r.day_application_mode, 'shift_start_day') = 'shift_start_day'
            and case v_shift_start_dow
              when 1 then r.applies_monday
              when 2 then r.applies_tuesday
              when 3 then r.applies_wednesday
              when 4 then r.applies_thursday
              when 5 then r.applies_friday
              when 6 then r.applies_saturday
              when 7 then r.applies_sunday
              else false
            end
            and (
              r.full_day is true
              or (
                coalesce(r.crosses_midnight, false) is false
                and r.start_time < r.end_time
                and v_time >= r.start_time
                and v_time < r.end_time
              )
              or (
                coalesce(r.crosses_midnight, false) is true
                and (
                  v_time >= r.start_time
                  or v_time < r.end_time
                )
              )
            )
          )

          or

          -- ==================================================
          -- CALENDAR MINUTES MODE
          -- The rule's day flags are checked against the
          -- actual calendar day of each minute.
          -- ==================================================
          (
            coalesce(r.day_application_mode, 'shift_start_day') = 'calendar_minutes'
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
            and (
              r.full_day is true
              or (
                coalesce(r.crosses_midnight, false) is false
                and r.start_time < r.end_time
                and v_time >= r.start_time
                and v_time < r.end_time
              )
              or (
                coalesce(r.crosses_midnight, false) is true
                and (
                  v_time >= r.start_time
                  or v_time < r.end_time
                )
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

grant execute on function public.calculate_unsociable_minutes_for_shift_v2(time, time, boolean, integer, uuid) to authenticated;

-- ------------------------------------------------------------
-- 6. Keep v3 using updated calculation and paid-hours cap
-- ------------------------------------------------------------

create or replace function public.calculate_work_time_profile_values_v3(
  p_start_time time,
  p_end_time time,
  p_crosses_midnight boolean default false,
  p_break_rule_id uuid default null,
  p_break_minutes integer default null,
  p_paid_hours_manual_override boolean default true,
  p_manual_paid_hours numeric default null,
  p_unsociable_hours_manual_override boolean default true,
  p_manual_unsociable_hours numeric default null,
  p_iso_dow integer default 1,
  p_unsociable_rule_set_id uuid default null
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
  unsociable_rule_set_id uuid,
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
  v_final_paid_hours numeric;
  v_final_paid_minutes integer;
  v_unsociable_window_minutes integer;
  v_payable_unsociable_minutes integer;
  v_payable_unsociable_hours numeric;
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
      p_unsociable_rule_set_id,
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

  v_final_paid_hours := case
    when coalesce(p_paid_hours_manual_override, true) is true
      then coalesce(p_manual_paid_hours, v_calculated_paid_hours)
    else v_calculated_paid_hours
  end;

  v_final_paid_minutes := greatest(
    coalesce(round(v_final_paid_hours * 60)::integer, v_calculated_paid_minutes),
    0
  );

  v_unsociable_window_minutes := public.calculate_unsociable_minutes_for_shift_v2(
    p_start_time,
    p_end_time,
    coalesce(p_crosses_midnight, false),
    p_iso_dow,
    p_unsociable_rule_set_id
  );

  v_payable_unsociable_minutes := least(
    greatest(coalesce(v_unsociable_window_minutes, 0), 0),
    v_final_paid_minutes
  );

  v_payable_unsociable_hours := round((v_payable_unsociable_minutes::numeric / 60), 2);

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
    p_unsociable_rule_set_id,
    v_payable_unsociable_minutes,
    v_payable_unsociable_hours,
    v_final_paid_hours,
    case
      when coalesce(p_unsociable_hours_manual_override, true) is true
        then p_manual_unsociable_hours
      else v_payable_unsociable_hours
    end;
end;
$$;

grant execute on function public.calculate_work_time_profile_values_v3(
  time,
  time,
  boolean,
  uuid,
  integer,
  boolean,
  numeric,
  boolean,
  numeric,
  integer,
  uuid
) to authenticated;

-- ------------------------------------------------------------
-- 7. Recalculate stored suggestions, preserving manual values
-- ------------------------------------------------------------

update public.work_time_profiles
set
  paid_hours_manual_override = coalesce(paid_hours_manual_override, true),
  unsociable_hours_manual_override = coalesce(unsociable_hours_manual_override, true)
where true;

-- ------------------------------------------------------------
-- 8. Verification
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

select
  'OHP-013B.3 patch - unsociable day application mode installed' as result,
  (select count(*) from public.unsociable_time_rules where day_application_mode = 'shift_start_day') as shift_start_day_rules,
  (select count(*) from public.unsociable_time_rules where day_application_mode = 'calendar_minutes') as calendar_minutes_rules,
  (
    select count(*)
    from public.work_time_profiles
    where calculated_unsociable_hours is not null
      and paid_hours is not null
      and calculated_unsociable_hours > paid_hours
  ) as profiles_where_suggested_unsociable_exceeds_final_paid_hours;