begin;

-- OH-034D is intentionally self-contained. Applying this migration is enough
-- to install the native anonymous Shared Terminal visitor backend even when
-- the earlier OH-034B migration has not been applied.
--
-- The helper functions below are not executable by anon/authenticated roles.
-- Only the five narrowly scoped visitor workflow RPCs are granted to anon.

create or replace function public.shared_terminal_device_id(
  p_terminal_token text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select device.id
  from public.kiosk_devices as device
  where p_terminal_token is not null
    and btrim(p_terminal_token) <> ''
    and device.kiosk_token = p_terminal_token
    and device.active = true
  limit 1;
$function$;

create or replace function public.shared_terminal_setting_boolean(
  p_setting_key text,
  p_default boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (
      select case lower(trim(both '"' from setting.setting_value::text))
        when 'true' then true
        when 'false' then false
        else p_default
      end
      from public.system_settings as setting
      where setting.setting_key = p_setting_key
      limit 1
    ),
    p_default
  );
$function$;

revoke all on function public.shared_terminal_device_id(text) from public;
revoke all on function public.shared_terminal_setting_boolean(text, boolean)
  from public;
revoke all on function public.shared_terminal_device_id(text)
  from anon, authenticated;
revoke all on function public.shared_terminal_setting_boolean(text, boolean)
  from anon, authenticated;

create or replace function public.shared_terminal_search_planned_visits(
  p_terminal_token text,
  p_query text
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with terminal as (
    select public.shared_terminal_device_id(p_terminal_token) as id
  ),
  all_query_parts as (
    select part
    from pg_catalog.regexp_split_to_table(
      lower(
        pg_catalog.regexp_replace(
          btrim(coalesce(p_query, '')),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ),
      '[^[:alpha:]]+'
    ) as part
    where part <> ''
  ),
  eligible as (
    select planned.*
    from public.planned_visits as planned
    cross join terminal
    where terminal.id is not null
      and exists (
        select 1
        from all_query_parts
        where char_length(all_query_parts.part) >= 3
      )
      and planned.visit_date = current_date
      and lower(coalesce(planned.status, 'planned'))
        in ('', 'planned', 'pending')
      and not exists (
        select 1
        from public.visit_log as used_visit
        where used_visit.planned_visit_id = planned.id
          and used_visit.sign_in_time is not null
      )
      and not exists (
        select 1
        from pg_catalog.regexp_split_to_table(
          lower(coalesce(planned.visitor_name, '')),
          '[^[:alpha:]]+'
        ) as visitor_part
        where visitor_part <> ''
          and not exists (
            select 1
            from all_query_parts
            where (
              char_length(visitor_part) < 3
              and all_query_parts.part = visitor_part
            )
            or (
              char_length(visitor_part) >= 3
              and char_length(all_query_parts.part) >= 3
              and (
                visitor_part like ('%' || all_query_parts.part || '%')
                or all_query_parts.part like ('%' || visitor_part || '%')
                or left(visitor_part, 3) = left(all_query_parts.part, 3)
              )
            )
          )
      )
    order by planned.expected_time asc nulls last,
      lower(planned.visitor_name),
      planned.id
    limit 20
  )
  select pg_catalog.jsonb_build_object(
    'id', eligible.id,
    'visitor_name', eligible.visitor_name,
    'company', eligible.company,
    'expected_time', eligible.expected_time
  )
  from eligible;
$function$;

create or replace function public.shared_terminal_search_active_visits(
  p_terminal_token text,
  p_query text
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', visit.id,
    'visitor_name', visit.visitor_name,
    'company', visit.company,
    'security_pass_id', visit.security_pass_id,
    'sign_in_time', visit.sign_in_time
  )
  from public.visit_log as visit
  where public.shared_terminal_device_id(p_terminal_token) is not null
    and char_length(btrim(coalesce(p_query, ''))) >= 2
    and visit.sign_out_time is null
    and (
      position(
        lower(btrim(p_query))
        in lower(coalesce(visit.visitor_name, ''))
      ) > 0
      or position(
        lower(btrim(p_query))
        in lower(coalesce(visit.company, ''))
      ) > 0
      or position(
        lower(btrim(p_query))
        in lower(coalesce(visit.security_pass_id, ''))
      ) > 0
    )
  order by visit.sign_in_time, lower(visit.visitor_name), visit.id
  limit 20;
$function$;

create or replace function public.shared_terminal_sign_in_planned(
  p_terminal_token text,
  p_planned_visit_id uuid,
  p_privacy_notice_version text,
  p_privacy_notice_accepted_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  terminal_id uuid;
  planned public.planned_visits%rowtype;
  new_visit_id uuid;
  normalised_name text;
begin
  terminal_id := public.shared_terminal_device_id(p_terminal_token);
  if terminal_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Shared Terminal token is invalid or disabled.';
  end if;

  if public.shared_terminal_setting_boolean(
    'privacy_notice_enabled',
    true
  ) and public.shared_terminal_setting_boolean(
    'privacy_acknowledgement_required',
    true
  ) and (
    p_privacy_notice_version is null
    or p_privacy_notice_accepted_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Privacy acknowledgement is required before sign-in.';
  end if;

  select *
  into planned
  from public.planned_visits
  where id = p_planned_visit_id
    and visit_date = current_date
    and lower(coalesce(status, 'planned')) in ('', 'planned', 'pending')
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'This planned visit is no longer available.';
  end if;

  normalised_name := lower(
    pg_catalog.regexp_replace(
      btrim(coalesce(planned.visitor_name, '')),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(normalised_name, 34034)
  );

  if exists (
    select 1
    from public.visit_log
    where (
      planned_visit_id = planned.id
      or lower(
        pg_catalog.regexp_replace(
          btrim(coalesce(visitor_name, '')),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ) = normalised_name
    )
      and sign_out_time is null
  ) then
    raise exception using
      errcode = '23505',
      message = 'This visitor is already signed in.';
  end if;

  insert into public.visit_log (
    planned_visit_id,
    visitor_name,
    company,
    visit_reason,
    vehicle_plate,
    onsite_contact,
    security_pass_id,
    kiosk_device_id,
    privacy_notice_version,
    privacy_notice_accepted_at,
    sign_in_time,
    sign_out_time,
    visit_status,
    visit_origin
  )
  values (
    planned.id,
    planned.visitor_name,
    planned.company,
    planned.visit_reason,
    planned.vehicle_plate,
    planned.onsite_contact,
    planned.security_pass_id,
    terminal_id,
    p_privacy_notice_version,
    p_privacy_notice_accepted_at,
    now(),
    null,
    'signed_in',
    'planned'
  )
  returning id into new_visit_id;

  return new_visit_id;
end;
$function$;

create or replace function public.shared_terminal_sign_in_walk_in(
  p_terminal_token text,
  p_visitor_name text,
  p_company text,
  p_visit_reason text,
  p_vehicle_plate text,
  p_onsite_contact text,
  p_security_pass_id text,
  p_privacy_notice_version text,
  p_privacy_notice_accepted_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  terminal_id uuid;
  normalised_name text :=
    pg_catalog.regexp_replace(
      btrim(coalesce(p_visitor_name, '')),
      '[[:space:]]+',
      ' ',
      'g'
    );
  new_visit_id uuid;
  vehicle_required boolean;
  contact_required boolean;
  pass_required boolean;
begin
  terminal_id := public.shared_terminal_device_id(p_terminal_token);
  if terminal_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Shared Terminal token is invalid or disabled.';
  end if;

  if not public.shared_terminal_setting_boolean('allow_walk_ins', true) then
    raise exception using
      errcode = 'P0001',
      message = 'Walk-in registration is currently unavailable.';
  end if;

  if public.shared_terminal_setting_boolean(
    'privacy_notice_enabled',
    true
  ) and public.shared_terminal_setting_boolean(
    'privacy_acknowledgement_required',
    true
  ) and (
    p_privacy_notice_version is null
    or p_privacy_notice_accepted_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Privacy acknowledgement is required before sign-in.';
  end if;

  if (
    select count(*) < 2
      or pg_catalog.bool_or(
        part !~ '^[[:alpha:]]+([''’-][[:alpha:]]+)*$'
        or lower(part) = any(array[
          'test', 'visitor', 'temp', 'temporary', 'unknown',
          'guest', 'sample', 'demo', 'none'
        ])
      )
    from pg_catalog.regexp_split_to_table(
      normalised_name,
      '[[:space:]]+'
    ) as part
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Please enter your full name, for example John Smith.';
  end if;

  if public.shared_terminal_setting_boolean(
    'walkin_company_required',
    false
  ) and nullif(btrim(p_company), '') is null then
    raise exception using
      errcode = 'P0001',
      message = 'Company is required.';
  end if;
  if public.shared_terminal_setting_boolean(
    'walkin_reason_required',
    false
  ) and nullif(btrim(p_visit_reason), '') is null then
    raise exception using
      errcode = 'P0001',
      message = 'Reason for visit is required.';
  end if;

  vehicle_required :=
    public.shared_terminal_setting_boolean('require_vehicle_plate', false)
    or public.shared_terminal_setting_boolean(
      'walkin_vehicle_required',
      false
    );
  contact_required :=
    public.shared_terminal_setting_boolean('require_onsite_contact', false)
    or public.shared_terminal_setting_boolean(
      'walkin_contact_required',
      false
    );
  pass_required :=
    public.shared_terminal_setting_boolean('require_security_pass', false)
    or public.shared_terminal_setting_boolean(
      'walkin_pass_required',
      false
    );

  if vehicle_required and nullif(btrim(p_vehicle_plate), '') is null then
    raise exception using
      errcode = 'P0001',
      message = 'Vehicle licence plate is required.';
  end if;
  if contact_required and nullif(btrim(p_onsite_contact), '') is null then
    raise exception using
      errcode = 'P0001',
      message = 'On-site contact is required.';
  end if;
  if pass_required and nullif(btrim(p_security_pass_id), '') is null then
    raise exception using
      errcode = 'P0001',
      message = 'Security pass ID is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(lower(normalised_name), 34034)
  );

  if exists (
    select 1
    from public.visit_log
    where lower(
      pg_catalog.regexp_replace(
        btrim(coalesce(visitor_name, '')),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ) = lower(normalised_name)
      and sign_out_time is null
  ) then
    raise exception using
      errcode = '23505',
      message = 'A visitor with this name is already signed in.';
  end if;

  if exists (
    select 1
    from public.planned_visits
    where visit_date = current_date
      and lower(coalesce(status, 'planned')) in ('', 'planned', 'pending')
      and lower(
        pg_catalog.regexp_replace(
          btrim(coalesce(visitor_name, '')),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ) = lower(normalised_name)
  ) then
    raise exception using
      errcode = 'P0001',
      message =
        'A planned visit exists for this name. Please select it instead.';
  end if;

  insert into public.visit_log (
    visitor_name,
    company,
    visit_reason,
    vehicle_plate,
    onsite_contact,
    security_pass_id,
    kiosk_device_id,
    privacy_notice_version,
    privacy_notice_accepted_at,
    sign_in_time,
    sign_out_time,
    visit_status,
    visit_origin
  )
  values (
    normalised_name,
    nullif(btrim(p_company), ''),
    nullif(btrim(p_visit_reason), ''),
    nullif(btrim(p_vehicle_plate), ''),
    nullif(btrim(p_onsite_contact), ''),
    nullif(btrim(p_security_pass_id), ''),
    terminal_id,
    p_privacy_notice_version,
    p_privacy_notice_accepted_at,
    now(),
    null,
    'signed_in',
    'walk_in'
  )
  returning id into new_visit_id;

  return new_visit_id;
end;
$function$;

create or replace function public.shared_terminal_sign_out(
  p_terminal_token text,
  p_visit_log_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  terminal_id uuid;
  compliance_summary jsonb;
  signed_out_id uuid;
begin
  terminal_id := public.shared_terminal_device_id(p_terminal_token);
  if terminal_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Shared Terminal token is invalid or disabled.';
  end if;

  if public.shared_terminal_setting_boolean(
    'block_sign_out_if_required_agreements_missing',
    false
  ) then
    if pg_catalog.to_regprocedure(
      'public.get_visit_missing_required_agreement_summary(uuid)'
    ) is null then
      raise exception using
        errcode = 'P0001',
        message = 'Agreement compliance could not be verified.';
    end if;

    execute
      'select pg_catalog.to_jsonb(summary) '
      || 'from public.get_visit_missing_required_agreement_summary($1) '
      || 'as summary limit 1'
    into compliance_summary
    using p_visit_log_id;

    if coalesce(
      (compliance_summary ->> 'missing_count')::integer,
      0
    ) > 0 then
      raise exception using
        errcode = 'P0001',
        message =
          'Sign-out is blocked because required agreements are missing.';
    end if;
  end if;

  update public.visit_log
  set sign_out_time = now(),
      visit_status = 'signed_out'
  where id = p_visit_log_id
    and sign_out_time is null
  returning id into signed_out_id;

  if signed_out_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'This visitor is no longer actively signed in.';
  end if;

  return signed_out_id;
end;
$function$;

revoke all on function public.shared_terminal_search_planned_visits(text, text)
  from public;
revoke all on function public.shared_terminal_search_active_visits(text, text)
  from public;
revoke all on function public.shared_terminal_sign_in_planned(
  text,
  uuid,
  text,
  timestamptz
) from public;
revoke all on function public.shared_terminal_sign_in_walk_in(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) from public;
revoke all on function public.shared_terminal_sign_out(text, uuid)
  from public;

grant execute on function public.shared_terminal_search_planned_visits(
  text,
  text
) to anon, authenticated, service_role;
grant execute on function public.shared_terminal_search_active_visits(
  text,
  text
) to anon, authenticated, service_role;
grant execute on function public.shared_terminal_sign_in_planned(
  text,
  uuid,
  text,
  timestamptz
) to anon, authenticated, service_role;
grant execute on function public.shared_terminal_sign_in_walk_in(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) to anon, authenticated, service_role;
grant execute on function public.shared_terminal_sign_out(text, uuid)
  to anon, authenticated, service_role;

comment on function public.shared_terminal_search_planned_visits(text, text) is
  'Token-authenticated deterministic search of today''s available planned visits. Never resolves People identities.';
comment on function public.shared_terminal_search_active_visits(text, text) is
  'Token-authenticated active visitor search for Shared Terminal sign-out.';
comment on function public.shared_terminal_sign_in_planned(
  text,
  uuid,
  text,
  timestamptz
) is
  'Signs in one selected planned visit after validating the Shared Terminal token.';
comment on function public.shared_terminal_sign_in_walk_in(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) is
  'Creates a validated walk-in visit after validating the Shared Terminal token.';
comment on function public.shared_terminal_sign_out(text, uuid) is
  'Signs out one active visitor after validating the Shared Terminal token.';

-- The native terminal no longer calls these legacy kiosk RPCs. Remove their
-- anonymous/PUBLIC execution paths if the exact historical signatures exist,
-- while preserving authenticated kiosk/staff compatibility.
do $block$
declare
  legacy_rpc record;
begin
  for legacy_rpc in
    select proc.oid::regprocedure as signature
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname in (
        'get_kiosk_available_planned_visits',
        'kiosk_sign_in_planned',
        'kiosk_sign_in_walk_in',
        'kiosk_sign_out'
      )
  loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon',
      legacy_rpc.signature
    );
    execute pg_catalog.format(
      'grant execute on function %s to authenticated, service_role',
      legacy_rpc.signature
    );
  end loop;
end;
$block$;

notify pgrst, 'reload schema';

commit;
