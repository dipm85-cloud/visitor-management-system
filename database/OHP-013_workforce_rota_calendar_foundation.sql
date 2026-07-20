-- ============================================================
-- Operations Hub - OHP-013 Workforce Rota Calendar Foundation
--
-- Adds capability foundation for the Workforce / Rota Calendar.
--
-- Purpose:
-- - Prepare a visual rota/calendar view.
-- - Support future LMT expected-working-day logic.
-- - Keep this as calendar/read-only foundation first.
--
-- Safety:
-- - Does NOT implement LMT.
-- - Does NOT calculate payroll.
-- - Does NOT modify People assignments.
-- - Does NOT modify Work Time Profiles.
-- - Does NOT create holiday/absence/engagement overlays yet.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Capability catalogue
-- ------------------------------------------------------------

insert into public.capability_groups (
  group_code,
  group_name,
  description,
  display_order,
  active
)
values (
  'workforce_calendar',
  'Workforce Calendar',
  'View and manage workforce rota calendar foundations for People assignments and future LMT.',
  180,
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
  c.capability_code,
  c.capability_name,
  cg.id,
  c.capability_description,
  true
from public.capability_groups cg
cross join (
  values
    (
      'workforce_calendar.view',
      'View workforce calendar',
      'Allows authorised users to view the Workforce / Rota Calendar.'
    ),
    (
      'workforce_calendar.manage',
      'Manage workforce calendar',
      'Allows authorised users to manage Workforce / Rota Calendar settings and future rota planning controls.'
    )
) as c(capability_code, capability_name, capability_description)
where cg.group_code = 'workforce_calendar'
on conflict (capability_code) do update
set
  capability_name = excluded.capability_name,
  group_id = excluded.group_id,
  description = excluded.description,
  active = true;

-- SuperUser gets both capabilities by default.
insert into public.role_preset_capabilities (
  role_preset_id,
  capability_id
)
select
  rp.id,
  c.id
from public.role_presets rp
cross join public.capabilities c
where rp.role_code = 'super_user'
  and c.capability_code in (
    'workforce_calendar.view',
    'workforce_calendar.manage'
  )
on conflict do nothing;

-- ------------------------------------------------------------
-- 2. Permission helpers
-- ------------------------------------------------------------

create or replace function public.can_view_workforce_calendar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('workforce_calendar.view')
      or public.user_has_capability('workforce_calendar.manage')
      or public.user_has_capability('people.view')
      or public.user_has_capability('people.manage')
      or public.user_has_capability('work_time_profiles.view')
      or public.user_has_capability('work_time_profiles.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.view')
    );
$$;

create or replace function public.can_manage_workforce_calendar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('workforce_calendar.manage')
      or public.user_has_capability('people.manage')
      or public.user_has_capability('work_time_profiles.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.edit')
    );
$$;

grant execute on function public.can_view_workforce_calendar() to authenticated;
grant execute on function public.can_manage_workforce_calendar() to authenticated;

-- Ask PostgREST/Supabase API to reload its schema cache.
notify pgrst, 'reload schema';

select
  'OHP-013 workforce rota calendar capability foundation installed' as result;