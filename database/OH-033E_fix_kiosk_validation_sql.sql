begin;

-- Remove stale overloads so PostgREST has one unambiguous function and one
-- canonical input parameter name/type for p_kiosk_token.
do $block$
declare
  existing_function record;
begin
  for existing_function in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'validate_kiosk_device_token'
  loop
    raise notice 'OH-033E replacing validation RPC overload: %',
      existing_function.signature;
    execute format('drop function %s', existing_function.signature);
  end loop;
end;
$block$;

create function public.validate_kiosk_device_token(
  p_kiosk_token text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_kiosk_token is null or btrim(p_kiosk_token) = '' then false
    else exists (
      select 1
      from public.kiosk_devices as device
      where device.kiosk_token = p_kiosk_token
        and device.active = true
    )
  end;
$function$;

revoke all on function public.validate_kiosk_device_token(text) from public;
grant execute on function public.validate_kiosk_device_token(text) to anon;
grant execute on function public.validate_kiosk_device_token(text) to authenticated;
grant execute on function public.validate_kiosk_device_token(text) to service_role;

comment on function public.validate_kiosk_device_token(text) is
  'Returns true only when p_kiosk_token exactly matches an active kiosk_devices.kiosk_token.';

-- Temporary OH-033E diagnostic. It exposes no token value: only the received
-- length, exact-match counts and the resulting boolean. Remove after the
-- registered-terminal startup path has been manually accepted.
create or replace function public.diagnose_kiosk_device_token(
  p_kiosk_token text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with token_counts as (
    select
      count(*) filter (
        where device.kiosk_token = p_kiosk_token
      ) as matching_kiosk_token_rows,
      count(*) filter (
        where device.kiosk_token = p_kiosk_token
          and device.active = true
      ) as matching_active_rows
    from public.kiosk_devices as device
  )
  select jsonb_build_object(
    'input_token_length', char_length(p_kiosk_token),
    'matching_kiosk_token_rows', matching_kiosk_token_rows,
    'matching_active_rows', matching_active_rows,
    'valid', matching_active_rows > 0
  )
  from token_counts;
$function$;

revoke all on function public.diagnose_kiosk_device_token(text) from public;
grant execute on function public.diagnose_kiosk_device_token(text) to anon;
grant execute on function public.diagnose_kiosk_device_token(text) to authenticated;
grant execute on function public.diagnose_kiosk_device_token(text) to service_role;

comment on function public.diagnose_kiosk_device_token(text) is
  'Temporary OH-033E token diagnostic returning lengths/counts only; never returns the token.';

-- Migration-time assertions prove the canonical function against real rows
-- without printing any token. The notices contain only the safe diagnostic.
do $block$
declare
  active_token text;
  inactive_token text;
  invalid_token text := '__oh_033e_invalid_token__';
  diagnostic jsonb;
begin
  select device.kiosk_token
  into active_token
  from public.kiosk_devices as device
  where device.active = true
    and device.kiosk_token is not null
    and device.kiosk_token <> ''
  limit 1;

  if active_token is not null then
    select public.diagnose_kiosk_device_token(active_token)
    into diagnostic;
    raise notice 'OH-033E active-token self-test: %', diagnostic;

    if public.validate_kiosk_device_token(active_token) is not true then
      raise exception 'OH-033E active kiosk token validation self-test failed';
    end if;
  else
    raise notice 'OH-033E active-token self-test skipped: no active kiosk token row';
  end if;

  select device.kiosk_token
  into inactive_token
  from public.kiosk_devices as device
  where device.active = false
    and device.kiosk_token is not null
    and device.kiosk_token <> ''
  limit 1;

  if inactive_token is not null
    and public.validate_kiosk_device_token(inactive_token) is not false then
    raise exception 'OH-033E inactive kiosk token validation self-test failed';
  end if;

  while exists (
    select 1
    from public.kiosk_devices as device
    where device.kiosk_token = invalid_token
  ) loop
    invalid_token := invalid_token || '_x';
  end loop;

  if public.validate_kiosk_device_token(invalid_token) is not false
    or public.validate_kiosk_device_token(null) is not false
    or public.validate_kiosk_device_token('') is not false then
    raise exception 'OH-033E missing/invalid kiosk token validation self-test failed';
  end if;
end;
$block$;

notify pgrst, 'reload schema';

commit;
