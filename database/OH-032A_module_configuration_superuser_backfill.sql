-- ============================================================
-- Operations Hub - OH-032A Module Configuration visibility
-- Ensure the default SuperUser preset includes framework access.
-- ============================================================

insert into public.role_preset_capabilities (role_preset_id, capability_id)
select role_preset.id, capability.id
from public.role_presets role_preset
join public.capabilities capability
  on capability.capability_code in (
    'module_configuration.view',
    'module_configuration.manage'
  )
where role_preset.role_code = 'super_user'
on conflict (role_preset_id, capability_id) do nothing;

select
  'OH-032A module configuration SuperUser backfill installed' as result,
  (
    select count(*)
    from public.role_preset_capabilities role_capability
    join public.role_presets role_preset
      on role_preset.id = role_capability.role_preset_id
    join public.capabilities capability
      on capability.id = role_capability.capability_id
    where role_preset.role_code = 'super_user'
      and capability.capability_code in (
        'module_configuration.view',
        'module_configuration.manage'
      )
  ) as assigned_capability_count;
