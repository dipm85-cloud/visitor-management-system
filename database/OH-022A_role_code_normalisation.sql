-- ============================================================
-- Operations Hub - OH-022A Role Code Normalisation
-- Normalise role_presets.role_code to match profiles.role.
-- ============================================================

do $$
declare
  legacy_preset_id uuid;
  canonical_preset_id uuid;
begin
  select id into legacy_preset_id
  from public.role_presets
  where role_code = 'superuser';

  select id into canonical_preset_id
  from public.role_presets
  where role_code = 'super_user';

  if legacy_preset_id is null then
    return;
  end if;

  if canonical_preset_id is null then
    update public.role_presets
    set role_code = 'super_user'
    where id = legacy_preset_id;
    return;
  end if;

  insert into public.role_preset_capabilities (
    role_preset_id,
    capability_id
  )
  select
    canonical_preset_id,
    capability_id
  from public.role_preset_capabilities
  where role_preset_id = legacy_preset_id
  on conflict do nothing;

  delete from public.role_presets
  where id = legacy_preset_id;
end;
$$;

select
  'OH-022A role preset code normalised' as result,
  role_code,
  role_name
from public.role_presets
order by role_code;
