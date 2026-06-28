-- OH-009 Reference Data Administration RLS
-- Allow authenticated super_user profiles to manage reference data.

grant usage on schema public to authenticated;

grant select, insert, update on public.sites to authenticated;
grant select, insert, update on public.departments to authenticated;
grant select, insert, update on public.contracts to authenticated;
grant select, insert, update on public.job_roles to authenticated;
grant select, insert, update on public.shift_patterns to authenticated;
grant select, insert, update on public.break_rules to authenticated;
grant select, insert, update on public.organisations to authenticated;

drop policy if exists "super_user can manage sites" on public.sites;
create policy "super_user can manage sites"
on public.sites
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
);

drop policy if exists "super_user can manage departments" on public.departments;
create policy "super_user can manage departments"
on public.departments
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
);

drop policy if exists "super_user can manage contracts" on public.contracts;
create policy "super_user can manage contracts"
on public.contracts
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
);

drop policy if exists "super_user can manage job roles" on public.job_roles;
create policy "super_user can manage job roles"
on public.job_roles
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
);

drop policy if exists "super_user can manage shift patterns" on public.shift_patterns;
create policy "super_user can manage shift patterns"
on public.shift_patterns
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
);

drop policy if exists "super_user can manage break rules" on public.break_rules;
create policy "super_user can manage break rules"
on public.break_rules
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
);

drop policy if exists "super_user can manage organisations" on public.organisations;
create policy "super_user can manage organisations"
on public.organisations
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_user'
      and coalesce(p.active, true) = true
  )
);

select 'OH-009 reference data RLS installed' as result;