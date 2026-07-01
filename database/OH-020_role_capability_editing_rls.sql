-- OH-020 Access Control editing RLS
-- Allow authenticated super_user profiles to manage role preset capability assignments.

grant usage on schema public to authenticated;

grant select, insert, delete on public.role_preset_capabilities to authenticated;

drop policy if exists "super_user can manage role preset capabilities" on public.role_preset_capabilities;

create policy "super_user can manage role preset capabilities"
on public.role_preset_capabilities
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
);

select 'OH-020 role preset capability editing RLS installed' as result;