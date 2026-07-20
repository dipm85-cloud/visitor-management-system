-- ============================================================
-- Operations Hub - OH-024 Reference Data Capability RLS
-- Aligns reference-data backend access with settings.* capabilities.
-- ============================================================

grant select, insert, update on public.sites to authenticated;
grant select, insert, update on public.departments to authenticated;
grant select, insert, update on public.contracts to authenticated;
grant select, insert, update on public.job_roles to authenticated;
grant select, insert, update on public.shift_patterns to authenticated;
grant select, insert, update on public.break_rules to authenticated;

drop policy if exists "super_user can manage sites" on public.sites;
drop policy if exists "super_user can manage departments" on public.departments;
drop policy if exists "super_user can manage contracts" on public.contracts;
drop policy if exists "super_user can manage job roles" on public.job_roles;
drop policy if exists "super_user can manage shift patterns" on public.shift_patterns;
drop policy if exists "super_user can manage break rules" on public.break_rules;

drop policy if exists "capability can read sites" on public.sites;
drop policy if exists "capability can insert sites" on public.sites;
drop policy if exists "capability can update sites" on public.sites;
drop policy if exists "capability can read departments" on public.departments;
drop policy if exists "capability can insert departments" on public.departments;
drop policy if exists "capability can update departments" on public.departments;
drop policy if exists "capability can read contracts" on public.contracts;
drop policy if exists "capability can insert contracts" on public.contracts;
drop policy if exists "capability can update contracts" on public.contracts;
drop policy if exists "capability can read job roles" on public.job_roles;
drop policy if exists "capability can insert job roles" on public.job_roles;
drop policy if exists "capability can update job roles" on public.job_roles;
drop policy if exists "capability can read shift patterns" on public.shift_patterns;
drop policy if exists "capability can insert shift patterns" on public.shift_patterns;
drop policy if exists "capability can update shift patterns" on public.shift_patterns;
drop policy if exists "capability can read break rules" on public.break_rules;
drop policy if exists "capability can insert break rules" on public.break_rules;
drop policy if exists "capability can update break rules" on public.break_rules;

create policy "capability can read sites"
on public.sites for select to authenticated
using (public.user_has_capability('settings.view') or public.user_has_capability('settings.edit'));

create policy "capability can insert sites"
on public.sites for insert to authenticated
with check (public.user_has_capability('settings.edit'));

create policy "capability can update sites"
on public.sites for update to authenticated
using (public.user_has_capability('settings.edit'))
with check (public.user_has_capability('settings.edit'));

create policy "capability can read departments"
on public.departments for select to authenticated
using (public.user_has_capability('settings.view') or public.user_has_capability('settings.edit'));

create policy "capability can insert departments"
on public.departments for insert to authenticated
with check (public.user_has_capability('settings.edit'));

create policy "capability can update departments"
on public.departments for update to authenticated
using (public.user_has_capability('settings.edit'))
with check (public.user_has_capability('settings.edit'));

create policy "capability can read contracts"
on public.contracts for select to authenticated
using (public.user_has_capability('settings.view') or public.user_has_capability('settings.edit'));

create policy "capability can insert contracts"
on public.contracts for insert to authenticated
with check (public.user_has_capability('settings.edit'));

create policy "capability can update contracts"
on public.contracts for update to authenticated
using (public.user_has_capability('settings.edit'))
with check (public.user_has_capability('settings.edit'));

create policy "capability can read job roles"
on public.job_roles for select to authenticated
using (public.user_has_capability('settings.view') or public.user_has_capability('settings.edit'));

create policy "capability can insert job roles"
on public.job_roles for insert to authenticated
with check (public.user_has_capability('settings.edit'));

create policy "capability can update job roles"
on public.job_roles for update to authenticated
using (public.user_has_capability('settings.edit'))
with check (public.user_has_capability('settings.edit'));

create policy "capability can read shift patterns"
on public.shift_patterns for select to authenticated
using (public.user_has_capability('settings.view') or public.user_has_capability('settings.edit'));

create policy "capability can insert shift patterns"
on public.shift_patterns for insert to authenticated
with check (public.user_has_capability('settings.edit'));

create policy "capability can update shift patterns"
on public.shift_patterns for update to authenticated
using (public.user_has_capability('settings.edit'))
with check (public.user_has_capability('settings.edit'));

create policy "capability can read break rules"
on public.break_rules for select to authenticated
using (public.user_has_capability('settings.view') or public.user_has_capability('settings.edit'));

create policy "capability can insert break rules"
on public.break_rules for insert to authenticated
with check (public.user_has_capability('settings.edit'));

create policy "capability can update break rules"
on public.break_rules for update to authenticated
using (public.user_has_capability('settings.edit'))
with check (public.user_has_capability('settings.edit'));

select 'OH-024 reference data capability RLS installed' as result;
