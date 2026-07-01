-- ============================================================
-- Operations Hub - OH-022 Organisation Capability Migration
-- Adds dedicated organisation capabilities and RLS.
-- ============================================================

insert into public.capability_groups (
  group_code,
  group_name,
  description,
  display_order,
  active
)
values (
  'organisation',
  'Organisations',
  'Organisation master data and lifecycle management',
  35,
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
    ('organisation.view', 'View Organisations', 'Can view organisation records.'),
    (
      'organisation.manage',
      'Manage Organisations',
      'Can create, edit, activate and deactivate organisation records.'
    )
) as x(capability_code, capability_name, description)
join public.capability_groups cg on cg.group_code = 'organisation'
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
  and c.capability_code in ('organisation.view', 'organisation.manage')
on conflict do nothing;

grant select, insert, update on public.organisations to authenticated;

-- Keep the legacy SuperUser policy as a compatibility path. OH-022A
-- normalises the preset code without changing Organisation RLS policies.
drop policy if exists "capability can read organisations" on public.organisations;
drop policy if exists "capability can insert organisations" on public.organisations;
drop policy if exists "capability can update organisations" on public.organisations;

create policy "capability can read organisations"
on public.organisations
for select
to authenticated
using (
  public.user_has_capability('organisation.view')
  or public.user_has_capability('organisation.manage')
);

create policy "capability can insert organisations"
on public.organisations
for insert
to authenticated
with check (
  public.user_has_capability('organisation.manage')
);

create policy "capability can update organisations"
on public.organisations
for update
to authenticated
using (
  public.user_has_capability('organisation.manage')
)
with check (
  public.user_has_capability('organisation.manage')
);

select 'OH-022 organisation capability migration installed' as result;
