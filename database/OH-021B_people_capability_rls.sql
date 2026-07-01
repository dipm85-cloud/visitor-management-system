-- ============================================================
-- Operations Hub - OH-021B Security Helper Functions
-- Capability-aware RLS foundation for People.
-- ============================================================

create or replace function public.user_has_capability(required_capability text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_presets rp
      on rp.role_code = p.role
    join public.role_preset_capabilities rpc
      on rpc.role_preset_id = rp.id
    join public.capabilities c
      on c.id = rpc.capability_id
    where p.id = auth.uid()
      and coalesce(p.active, true) = true
      and rp.active = true
      and c.active = true
      and c.capability_code = required_capability
  )
  or exists (
    select 1
    from public.profiles p
    join public.profile_capabilities pc
      on pc.profile_id = p.id
    join public.capabilities c
      on c.id = pc.capability_id
    where p.id = auth.uid()
      and coalesce(p.active, true) = true
      and c.active = true
      and c.capability_code = required_capability
      and pc.grant_state = 'allow'
  )
  and not exists (
    select 1
    from public.profiles p
    join public.profile_capabilities pc
      on pc.profile_id = p.id
    join public.capabilities c
      on c.id = pc.capability_id
    where p.id = auth.uid()
      and c.capability_code = required_capability
      and pc.grant_state = 'deny'
  );
$$;

grant execute on function public.user_has_capability(text) to authenticated;

grant select, insert, update on public.people to authenticated;

drop policy if exists "super_user can manage people" on public.people;
drop policy if exists "super_user can read people" on public.people;
drop policy if exists "super_user can insert people" on public.people;
drop policy if exists "super_user can update people" on public.people;

create policy "capability can read people"
on public.people
for select
to authenticated
using (
  public.user_has_capability('people.view')
  or public.user_has_capability('people.manage')
);

create policy "capability can insert people"
on public.people
for insert
to authenticated
with check (
  public.user_has_capability('people.manage')
);

create policy "capability can update people"
on public.people
for update
to authenticated
using (
  public.user_has_capability('people.manage')
)
with check (
  public.user_has_capability('people.manage')
);

select 'OH-021B people capability RLS installed' as result;