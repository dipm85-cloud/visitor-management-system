-- ============================================================
-- Operations Hub - OH-020A Access Control Capabilities
-- Add dedicated Access Control capabilities and protect
-- SuperUser recovery-critical role preset assignments.
-- ============================================================

insert into public.capabilities (
  capability_code,
  capability_name,
  group_id,
  description,
  active
)
select
  capability.capability_code,
  capability.capability_name,
  capability_group.id,
  capability.description,
  true
from (
  values
    (
      'access_control.view',
      'View Access Control',
      'Can view Access Control configuration.'
    ),
    (
      'access_control.manage',
      'Manage Access Control',
      'Can manage role preset capability assignments.'
    )
) as capability(capability_code, capability_name, description)
join public.capability_groups capability_group
  on capability_group.group_code = 'administration'
on conflict (capability_code) do update
set
  capability_name = excluded.capability_name,
  group_id = excluded.group_id,
  description = excluded.description,
  active = true;

insert into public.role_preset_capabilities (role_preset_id, capability_id)
select role_preset.id, capability.id
from public.role_presets role_preset
cross join public.capabilities capability
where role_preset.role_code = 'super_user'
  and capability.capability_code in (
    'access_control.view',
    'access_control.manage'
  )
on conflict (role_preset_id, capability_id) do nothing;

grant usage on schema public to authenticated;
grant select, insert, delete on public.role_preset_capabilities to authenticated;

-- Retire the earlier broad policy because permissive policies combine with OR.
drop policy if exists "super_user can manage role preset capabilities"
on public.role_preset_capabilities;
drop policy if exists "super_user can add role preset capabilities"
on public.role_preset_capabilities;
drop policy if exists "super_user can remove role preset capabilities"
on public.role_preset_capabilities;

create policy "super_user can add role preset capabilities"
on public.role_preset_capabilities
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role = 'super_user'
      and coalesce(profile.active, true) = true
  )
);

create policy "super_user can remove role preset capabilities"
on public.role_preset_capabilities
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role = 'super_user'
      and coalesce(profile.active, true) = true
  )
  and not exists (
    select 1
    from public.role_presets role_preset
    join public.capabilities capability
      on capability.id = role_preset_capabilities.capability_id
    where role_preset.id = role_preset_capabilities.role_preset_id
      and role_preset.role_code = 'super_user'
      and capability.capability_code in (
        'access_control.view',
        'access_control.manage',
        'settings.view',
        'settings.edit',
        'users.view',
        'users.manage',
        'people.manage',
        'audit.view'
      )
  )
);

select
  'OH-020A access control capabilities installed' as result,
  (
    select count(*)
    from public.capabilities
    where capability_code in (
      'access_control.view',
      'access_control.manage'
    )
  ) as access_control_capability_count;
