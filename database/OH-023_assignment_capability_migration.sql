-- ============================================================
-- Operations Hub - OH-023 Assignment Capability Migration
-- Adds dedicated assignment capabilities and RLS.
-- ============================================================

insert into public.capability_groups (
  group_code,
  group_name,
  description,
  display_order,
  active
)
values (
  'assignment',
  'Assignments',
  'Work assignment visibility and lifecycle management',
  37,
  true
)
on conflict (group_code) do update
set
  group_name = excluded.group_name,
  description = excluded.description,
  display_order = excluded.display_order,
  active = true;

insert into public.capabilities (
  capability_code,
  capability_name,
  group_id,
  description,
  active
)
select
  x.capability_code,
  x.capability_name,
  cg.id,
  x.description,
  true
from (
  values
    ('assignment.view', 'View Assignments', 'Can view work assignment records.'),
    ('assignment.manage', 'Manage Assignments', 'Can create, edit, end and reactivate work assignments.')
) as x(capability_code, capability_name, description)
join public.capability_groups cg on cg.group_code = 'assignment'
on conflict (capability_code) do update
set
  capability_name = excluded.capability_name,
  group_id = excluded.group_id,
  description = excluded.description,
  active = true;

insert into public.role_preset_capabilities (role_preset_id, capability_id)
select rp.id, c.id
from public.role_presets rp
cross join public.capabilities c
where rp.role_code = 'super_user'
  and c.capability_code in ('assignment.view', 'assignment.manage')
on conflict do nothing;

grant select, insert, update on public.work_assignments to authenticated;

drop policy if exists "super_user can manage work assignments" on public.work_assignments;
drop policy if exists "capability can read work assignments" on public.work_assignments;
drop policy if exists "capability can insert work assignments" on public.work_assignments;
drop policy if exists "capability can update work assignments" on public.work_assignments;

create policy "capability can read work assignments"
on public.work_assignments
for select
to authenticated
using (
  public.user_has_capability('assignment.view')
  or public.user_has_capability('assignment.manage')
);

create policy "capability can insert work assignments"
on public.work_assignments
for insert
to authenticated
with check (
  public.user_has_capability('assignment.manage')
);

create policy "capability can update work assignments"
on public.work_assignments
for update
to authenticated
using (
  public.user_has_capability('assignment.manage')
)
with check (
  public.user_has_capability('assignment.manage')
);

select 'OH-023 assignment capability migration installed' as result;
