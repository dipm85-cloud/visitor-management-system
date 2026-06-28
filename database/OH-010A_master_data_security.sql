-- ============================================================
-- Operations Hub - OH-010A Master Data Security Foundation
-- Temporary role-based policies for super_user.
-- Future milestone will replace these with capability-based policies.
-- ============================================================

grant usage on schema public to authenticated;

grant select, insert, update on public.sites to authenticated;
grant select, insert, update on public.organisations to authenticated;
grant select, insert, update on public.people to authenticated;
grant select, insert, update on public.departments to authenticated;
grant select, insert, update on public.contracts to authenticated;
grant select, insert, update on public.job_roles to authenticated;
grant select, insert, update on public.shift_patterns to authenticated;
grant select, insert, update on public.break_rules to authenticated;
grant select, insert, update on public.work_assignments to authenticated;

drop policy if exists "super_user can manage sites" on public.sites;
drop policy if exists "super_user can manage organisations" on public.organisations;
drop policy if exists "super_user can manage people" on public.people;
drop policy if exists "super_user can manage departments" on public.departments;
drop policy if exists "super_user can manage contracts" on public.contracts;
drop policy if exists "super_user can manage job roles" on public.job_roles;
drop policy if exists "super_user can manage shift patterns" on public.shift_patterns;
drop policy if exists "super_user can manage break rules" on public.break_rules;
drop policy if exists "super_user can manage work assignments" on public.work_assignments;

create policy "super_user can manage sites"
on public.sites for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true));

create policy "super_user can manage organisations"
on public.organisations for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true));

create policy "super_user can manage people"
on public.people for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true));

create policy "super_user can manage departments"
on public.departments for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true));

create policy "super_user can manage contracts"
on public.contracts for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true));

create policy "super_user can manage job roles"
on public.job_roles for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true));

create policy "super_user can manage shift patterns"
on public.shift_patterns for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true));

create policy "super_user can manage break rules"
on public.break_rules for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true));

create policy "super_user can manage work assignments"
on public.work_assignments for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_user' and coalesce(p.active, true) = true));

select 'OH-010A master data security foundation installed' as result;