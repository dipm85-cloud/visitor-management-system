-- ============================================================
-- Operations Hub - OHP-015 Access Control User Role Assignment
--
-- Purpose:
-- - Allow role presets, including custom presets, to be assigned to users.
-- - Preserve legacy profiles.role for compatibility.
-- - Make role_preset_id the preferred capability source.
-- - Keep built-in/system presets protected from editing.
-- - Add effective-capability diagnostics for testing.
--
-- Safety:
-- - Does not remove profiles.role.
-- - Does not require assigning custom role_code into profiles.role.
-- - Does not remove existing role preset management.
-- - Does not remove direct profile_capabilities overrides.
-- - Does not weaken RLS.
--
-- Important:
-- - Existing user_has_capability(text) parameter name is required_capability.
-- - Do not rename it, or Postgres raises:
--   cannot change name of input parameter "required_capability"
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Ensure role preset/profile metadata columns exist
-- ------------------------------------------------------------

alter table public.role_presets
add column if not exists description text;

alter table public.role_presets
add column if not exists active boolean not null default true;

alter table public.role_presets
add column if not exists is_system boolean not null default false;

alter table public.role_presets
add column if not exists is_system_role boolean not null default false;

alter table public.role_presets
add column if not exists created_by uuid default auth.uid();

alter table public.role_presets
add column if not exists updated_by uuid;

alter table public.role_presets
add column if not exists created_at timestamptz not null default now();

alter table public.role_presets
add column if not exists updated_at timestamptz not null default now();

alter table public.profiles
add column if not exists role_preset_id uuid references public.role_presets(id);

create index if not exists idx_profiles_role_preset_id
on public.profiles(role_preset_id);

-- Ensure common system role presets exist.
insert into public.role_presets (
  role_code,
  role_name,
  description,
  active,
  is_system,
  is_system_role
)
values
  (
    'general_user',
    'General User',
    'Default operational user role preset.',
    true,
    true,
    true
  ),
  (
    'security',
    'Security',
    'Security team role preset.',
    true,
    true,
    true
  ),
  (
    'super_user',
    'SuperUser',
    'Full system administrator role preset.',
    true,
    true,
    true
  ),
  (
    'kiosk_user',
    'Kiosk User',
    'Shared terminal or kiosk profile role preset.',
    true,
    true,
    true
  )
on conflict (role_code) do update
set
  role_name = excluded.role_name,
  description = coalesce(public.role_presets.description, excluded.description),
  active = true,
  is_system = true,
  is_system_role = true;

-- Mark existing built-ins as system presets.
update public.role_presets
set
  is_system = true,
  is_system_role = true,
  active = true
where role_code in (
  'super_user',
  'security',
  'general_user',
  'kiosk_user'
);

-- Backfill profile role_preset_id from legacy profiles.role.
update public.profiles p
set role_preset_id = rp.id
from public.role_presets rp
where p.role_preset_id is null
  and rp.role_code = p.role;

-- ------------------------------------------------------------
-- 2. Capability catalogue
-- ------------------------------------------------------------

insert into public.capability_groups (
  group_code,
  group_name,
  description,
  display_order,
  active
)
values (
  'access_control',
  'Access Control',
  'Manage role presets, user role assignments and effective capabilities.',
  160,
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
      'user_role_assignments.view',
      'View user role assignments',
      'Allows authorised users to view user role preset assignments and effective capabilities.'
    ),
    (
      'user_role_assignments.manage',
      'Manage user role assignments',
      'Allows authorised users to assign role presets to user profiles.'
    ),
    (
      'capabilities.diagnose',
      'Diagnose effective capabilities',
      'Allows authorised users to inspect effective capability sources for troubleshooting.'
    )
) as c(capability_code, capability_name, capability_description)
where cg.group_code = 'access_control'
on conflict (capability_code) do update
set
  capability_name = excluded.capability_name,
  group_id = excluded.group_id,
  description = excluded.description,
  active = true;

-- SuperUser gets new access-control capabilities by default.
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
    'user_role_assignments.view',
    'user_role_assignments.manage',
    'capabilities.diagnose',
    'role_presets.view',
    'role_presets.manage',
    'users.view',
    'users.manage',
    'access_control.view',
    'access_control.manage'
  )
on conflict do nothing;

-- ------------------------------------------------------------
-- 3. Effective role/capability helpers
-- ------------------------------------------------------------

create or replace function public.get_profile_effective_role_preset_id(
  p_profile_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p.role_preset_id,
    (
      select rp.id
      from public.role_presets rp
      where rp.role_code = p.role
      limit 1
    )
  )
  from public.profiles p
  where p.id = p_profile_id
    and p.active is true;
$$;

grant execute on function public.get_profile_effective_role_preset_id(uuid) to authenticated;

-- Replace/standardise user_has_capability so assigned role_preset_id is preferred.
-- IMPORTANT: keep parameter name as required_capability.
-- Direct profile_capabilities deny overrides allow/role preset.
-- Direct profile_capabilities allow adds capability even if role preset lacks it.
create or replace function public.user_has_capability(
  required_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_profile_active boolean;
  v_capability_id uuid;
  v_role_preset_id uuid;
  v_direct_state text;
begin
  if v_profile_id is null then
    return false;
  end if;

  select p.active
  into v_profile_active
  from public.profiles p
  where p.id = v_profile_id;

  if coalesce(v_profile_active, false) is not true then
    return false;
  end if;

  select c.id
  into v_capability_id
  from public.capabilities c
  where c.capability_code = required_capability
    and c.active is true;

  if v_capability_id is null then
    return false;
  end if;

  select pc.grant_state
  into v_direct_state
  from public.profile_capabilities pc
  where pc.profile_id = v_profile_id
    and pc.capability_id = v_capability_id
  limit 1;

  if v_direct_state = 'deny' then
    return false;
  end if;

  if v_direct_state = 'allow' then
    return true;
  end if;

  v_role_preset_id := public.get_profile_effective_role_preset_id(v_profile_id);

  if v_role_preset_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.role_preset_capabilities rpc
    join public.role_presets rp
      on rp.id = rpc.role_preset_id
    where rpc.role_preset_id = v_role_preset_id
      and rpc.capability_id = v_capability_id
      and rp.active is true
  );
end;
$$;

grant execute on function public.user_has_capability(text) to authenticated;

-- ------------------------------------------------------------
-- 4. Permission helpers for user role assignment management
-- ------------------------------------------------------------

create or replace function public.can_view_user_role_assignments()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('user_role_assignments.view')
      or public.user_has_capability('user_role_assignments.manage')
      or public.user_has_capability('users.view')
      or public.user_has_capability('users.manage')
      or public.user_has_capability('access_control.view')
      or public.user_has_capability('access_control.manage')
      or public.user_has_capability('role_presets.view')
      or public.user_has_capability('role_presets.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.view')
    );
$$;

create or replace function public.can_manage_user_role_assignments()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('user_role_assignments.manage')
      or public.user_has_capability('users.manage')
      or public.user_has_capability('access_control.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.edit')
    );
$$;

grant execute on function public.can_view_user_role_assignments() to authenticated;
grant execute on function public.can_manage_user_role_assignments() to authenticated;

-- ------------------------------------------------------------
-- 5. RPC: list users with assigned/effective role preset
-- ------------------------------------------------------------

create or replace function public.list_user_role_assignments(
  p_include_inactive boolean default true,
  p_search_text text default null
)
returns table (
  profile_id uuid,
  display_name text,
  legacy_role text,
  active boolean,
  assigned_role_preset_id uuid,
  assigned_role_code text,
  assigned_role_name text,
  assigned_role_is_system boolean,
  effective_role_preset_id uuid,
  effective_role_code text,
  effective_role_name text,
  effective_role_is_system boolean,
  direct_allow_count integer,
  direct_deny_count integer,
  effective_capability_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_user_role_assignments() then
    raise exception 'You do not have permission to view user role assignments';
  end if;

  return query
  with profile_base as (
    select
      p.id,
      p.display_name,
      p.role,
      p.active,
      p.role_preset_id,
      p.created_at,
      p.updated_at,
      public.get_profile_effective_role_preset_id(p.id) as effective_role_preset_id
    from public.profiles p
    where (p_include_inactive is true or p.active is true)
      and (
        p_search_text is null
        or trim(p_search_text) = ''
        or (
          coalesce(p.display_name, '') || ' ' ||
          coalesce(p.role, '') || ' ' ||
          p.id::text
        ) ilike '%' || p_search_text || '%'
      )
  )
  select
    pb.id as profile_id,
    pb.display_name,
    pb.role as legacy_role,
    pb.active,
    arp.id as assigned_role_preset_id,
    arp.role_code as assigned_role_code,
    arp.role_name as assigned_role_name,
    coalesce(arp.is_system, arp.is_system_role, false) as assigned_role_is_system,
    erp.id as effective_role_preset_id,
    erp.role_code as effective_role_code,
    erp.role_name as effective_role_name,
    coalesce(erp.is_system, erp.is_system_role, false) as effective_role_is_system,
    coalesce(override_counts.allow_count, 0)::integer as direct_allow_count,
    coalesce(override_counts.deny_count, 0)::integer as direct_deny_count,
    coalesce(effective_counts.capability_count, 0)::integer as effective_capability_count,
    pb.created_at,
    pb.updated_at
  from profile_base pb
  left join public.role_presets arp
    on arp.id = pb.role_preset_id
  left join public.role_presets erp
    on erp.id = pb.effective_role_preset_id
  left join lateral (
    select
      count(*) filter (where pc.grant_state = 'allow') as allow_count,
      count(*) filter (where pc.grant_state = 'deny') as deny_count
    from public.profile_capabilities pc
    where pc.profile_id = pb.id
  ) override_counts on true
  left join lateral (
    select count(distinct c.id) as capability_count
    from public.capabilities c
    where c.active is true
      and (
        exists (
          select 1
          from public.role_preset_capabilities rpc
          where rpc.role_preset_id = pb.effective_role_preset_id
            and rpc.capability_id = c.id
        )
        or exists (
          select 1
          from public.profile_capabilities pc_allow
          where pc_allow.profile_id = pb.id
            and pc_allow.capability_id = c.id
            and pc_allow.grant_state = 'allow'
        )
      )
      and not exists (
        select 1
        from public.profile_capabilities pc_deny
        where pc_deny.profile_id = pb.id
          and pc_deny.capability_id = c.id
          and pc_deny.grant_state = 'deny'
      )
  ) effective_counts on true
  order by
    pb.active desc,
    pb.display_name asc,
    pb.id;
end;
$$;

grant execute on function public.list_user_role_assignments(boolean, text) to authenticated;

-- ------------------------------------------------------------
-- 6. RPC: assign role preset to user profile
-- ------------------------------------------------------------

create or replace function public.assign_profile_role_preset(
  p_profile_id uuid,
  p_role_preset_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_role_preset public.role_presets;
  v_old_role_preset_id uuid;
  v_old_role_code text;
  v_new_role_code text;
begin
  if not public.can_manage_user_role_assignments() then
    raise exception 'You do not have permission to assign role presets to users';
  end if;

  if p_profile_id is null then
    raise exception 'Profile is required';
  end if;

  if p_role_preset_id is null then
    raise exception 'Role preset is required';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = p_profile_id
  for update;

  if not found then
    raise exception 'Profile not found';
  end if;

  select *
  into v_role_preset
  from public.role_presets
  where id = p_role_preset_id
    and active is true;

  if not found then
    raise exception 'Active role preset not found';
  end if;

  -- Lockout safety: do not let the current user remove their own SuperUser preset in this milestone.
  if p_profile_id = auth.uid()
     and v_role_preset.role_code <> 'super_user' then
    raise exception 'For safety, you cannot assign a non-SuperUser preset to your own profile';
  end if;

  v_old_role_preset_id := public.get_profile_effective_role_preset_id(p_profile_id);

  select rp.role_code
  into v_old_role_code
  from public.role_presets rp
  where rp.id = v_old_role_preset_id;

  v_new_role_code := v_role_preset.role_code;

  update public.profiles
  set
    role_preset_id = p_role_preset_id,
    -- Keep legacy role synchronised only for protected built-in roles.
    -- For custom presets, keep the existing legacy role to avoid violating old role constraints.
    role = case
      when v_role_preset.role_code in ('super_user', 'security', 'general_user', 'kiosk_user')
        then v_role_preset.role_code
      else role
    end,
    updated_at = now()
  where id = p_profile_id;

  begin
    perform public.write_audit_event(
      'profile.role_preset_assigned',
      'profiles',
      p_profile_id::text,
      jsonb_build_object(
        'summary', 'User role preset assignment updated.',
        'profile_id', p_profile_id,
        'display_name', v_profile.display_name,
        'old_role_preset_id', v_old_role_preset_id,
        'old_role_code', v_old_role_code,
        'new_role_preset_id', p_role_preset_id,
        'new_role_code', v_new_role_code,
        'legacy_role_after_save', case
          when v_role_preset.role_code in ('super_user', 'security', 'general_user', 'kiosk_user')
            then v_role_preset.role_code
          else v_profile.role
        end
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during profile role preset assignment: %', sqlerrm;
  end;

  return p_profile_id;
end;
$$;

grant execute on function public.assign_profile_role_preset(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 7. RPC: clear explicit role preset assignment
-- ------------------------------------------------------------

create or replace function public.clear_profile_role_preset_assignment(
  p_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if not public.can_manage_user_role_assignments() then
    raise exception 'You do not have permission to clear role preset assignments';
  end if;

  if p_profile_id is null then
    raise exception 'Profile is required';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = p_profile_id
  for update;

  if not found then
    raise exception 'Profile not found';
  end if;

  if p_profile_id = auth.uid() then
    raise exception 'For safety, you cannot clear your own role preset assignment';
  end if;

  update public.profiles
  set
    role_preset_id = null,
    updated_at = now()
  where id = p_profile_id;

  begin
    perform public.write_audit_event(
      'profile.role_preset_cleared',
      'profiles',
      p_profile_id::text,
      jsonb_build_object(
        'summary', 'User role preset assignment cleared.',
        'profile_id', p_profile_id,
        'display_name', v_profile.display_name,
        'legacy_role', v_profile.role
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during profile role preset clear: %', sqlerrm;
  end;

  return p_profile_id;
end;
$$;

grant execute on function public.clear_profile_role_preset_assignment(uuid) to authenticated;

-- ------------------------------------------------------------
-- 8. RPC: effective capability diagnostics for one profile
-- ------------------------------------------------------------

create or replace function public.list_profile_effective_capabilities(
  p_profile_id uuid default null
)
returns table (
  capability_id uuid,
  capability_code text,
  capability_name text,
  capability_description text,
  group_code text,
  group_name text,
  role_preset_id uuid,
  role_code text,
  role_name text,
  role_assigned boolean,
  direct_grant_state text,
  effective boolean,
  effective_source text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := coalesce(p_profile_id, auth.uid());
  v_role_preset_id uuid;
begin
  if v_profile_id is null then
    raise exception 'Profile is required';
  end if;

  if v_profile_id <> auth.uid()
     and not public.can_view_user_role_assignments()
     and not public.user_has_capability('capabilities.diagnose') then
    raise exception 'You do not have permission to view effective capabilities for this user';
  end if;

  v_role_preset_id := public.get_profile_effective_role_preset_id(v_profile_id);

  return query
  select
    c.id as capability_id,
    c.capability_code,
    c.capability_name,
    c.description as capability_description,
    cg.group_code,
    cg.group_name,
    rp.id as role_preset_id,
    rp.role_code,
    rp.role_name,
    exists (
      select 1
      from public.role_preset_capabilities rpc
      where rpc.role_preset_id = v_role_preset_id
        and rpc.capability_id = c.id
    ) as role_assigned,
    pc.grant_state as direct_grant_state,
    case
      when pc.grant_state = 'deny' then false
      when pc.grant_state = 'allow' then true
      when exists (
        select 1
        from public.role_preset_capabilities rpc
        where rpc.role_preset_id = v_role_preset_id
          and rpc.capability_id = c.id
      ) then true
      else false
    end as effective,
    case
      when pc.grant_state = 'deny' then 'direct_deny'
      when pc.grant_state = 'allow' then 'direct_allow'
      when exists (
        select 1
        from public.role_preset_capabilities rpc
        where rpc.role_preset_id = v_role_preset_id
          and rpc.capability_id = c.id
      ) then 'role_preset'
      else 'not_granted'
    end as effective_source
  from public.capabilities c
  left join public.capability_groups cg
    on cg.id = c.group_id
  left join public.role_presets rp
    on rp.id = v_role_preset_id
  left join public.profile_capabilities pc
    on pc.profile_id = v_profile_id
   and pc.capability_id = c.id
  where c.active is true
  order by
    coalesce(cg.display_order, 9999),
    coalesce(cg.group_name, ''),
    c.capability_code;
end;
$$;

grant execute on function public.list_profile_effective_capabilities(uuid) to authenticated;

-- ------------------------------------------------------------
-- 9. Verification
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

select
  'OHP-015 access control user role assignment installed' as result,
  (select count(*) from public.profiles where role_preset_id is not null) as profiles_with_role_preset,
  (select count(*) from public.role_presets where active is true) as active_role_presets;
