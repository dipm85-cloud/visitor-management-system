-- ============================================================
-- Operations Hub - OH-019 Access Control Read RLS
-- Allow authenticated super_user profiles to read capability foundation.
-- Read-only access for Access Control administration foundation.
-- ============================================================

grant usage on schema public to authenticated;

grant select on public.capability_groups to authenticated;
grant select on public.capabilities to authenticated;
grant select on public.role_presets to authenticated;
grant select on public.role_preset_capabilities to authenticated;
grant select on public.profile_capabilities to authenticated;

drop policy if exists "super_user can read capability groups" on public.capability_groups;
create policy "super_user can read capability groups"
on public.capability_groups
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
);

drop policy if exists "super_user can read capabilities" on public.capabilities;
create policy "super_user can read capabilities"
on public.capabilities
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
);

drop policy if exists "super_user can read role presets" on public.role_presets;
create policy "super_user can read role presets"
on public.role_presets
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
);

drop policy if exists "super_user can read role preset capabilities" on public.role_preset_capabilities;
create policy "super_user can read role preset capabilities"
on public.role_preset_capabilities
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
);

drop policy if exists "super_user can read profile capabilities" on public.profile_capabilities;
create policy "super_user can read profile capabilities"
on public.profile_capabilities
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
);

select 'OH-019 access control read RLS installed' as result;