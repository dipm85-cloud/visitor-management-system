begin;

-- Shared-terminal startup has no staff session. Validate only the existing
-- kiosk token against an active registered device, while allowing the anon
-- role to call this narrowly scoped boolean function.
create or replace function public.validate_kiosk_device_token(
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

commit;
