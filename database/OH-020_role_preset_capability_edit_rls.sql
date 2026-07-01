-- ============================================================
-- Operations Hub - OH-020 Role Preset Capability Edit RLS
-- Allow active authenticated SuperUsers to manage assignments
-- in the role_preset_capabilities junction table only.
-- ============================================================

grant usage on schema public to authenticated;
grant select, insert, delete on public.role_preset_capabilities to authenticated;

drop policy if exists "super_user can add role preset capabilities"
on public.role_preset_capabilities;
create policy "super_user can add role preset capabilities"
on public.role_preset_capabilities
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
);

drop policy if exists "super_user can remove role preset capabilities"
on public.role_preset_capabilities;
create policy "super_user can remove role preset capabilities"
on public.role_preset_capabilities
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
  and not exists (
    select 1
    from public.role_presets rp
    join public.capabilities c on c.id = role_preset_capabilities.capability_id
    where rp.id = role_preset_capabilities.role_preset_id
      and rp.role_code = 'super_user'
      and c.capability_code in (
        'settings.view',
        'users.manage',
        'people.manage',
        'audit.view'
      )
  )
);

select 'OH-020 role preset capability edit RLS installed' as result;
