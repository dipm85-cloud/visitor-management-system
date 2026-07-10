-- ============================================================
-- Operations Hub - OHP-008 Custom Role Preset Management
--
-- Adds safe custom role preset management support.
--
-- Design:
-- - Role presets are templates.
-- - Capabilities remain the real permission model.
-- - Built-in/system role presets are protected.
-- - Custom role presets can be created and managed from the app.
--
-- Safety:
-- - Does not hard-code Compliance / Auditor / Operations Manager.
-- - Does not remove existing role presets.
-- - Does not change existing user assignments.
-- - Does not change existing business workflows.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Ensure role preset management metadata columns exist
-- ------------------------------------------------------------

alter table public.role_presets
add column if not exists description text;

alter table public.role_presets
add column if not exists active boolean not null default true;

alter table public.role_presets
add column if not exists is_system boolean not null default false;

alter table public.role_presets
add column if not exists created_by uuid default auth.uid();

alter table public.role_presets
add column if not exists updated_by uuid;

alter table public.role_presets
add column if not exists created_at timestamptz not null default now();

alter table public.role_presets
add column if not exists updated_at timestamptz not null default now();

-- Mark existing built-in presets as system presets.
update public.role_presets
set is_system = true
where role_code in (
  'super_user',
  'security',
  'general_user',
  'kiosk'
);

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
  'Manage roles, role presets, capabilities and user access.',
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
      'role_presets.view',
      'View role presets',
      'Allows authorised users to view role presets and their assigned capabilities.'
    ),
    (
      'role_presets.manage',
      'Manage custom role presets',
      'Allows authorised users to create and update custom role presets and their capability assignments.'
    )
) as c(capability_code, capability_name, capability_description)
where cg.group_code = 'access_control'
on conflict (capability_code) do update
set
  capability_name = excluded.capability_name,
  group_id = excluded.group_id,
  description = excluded.description,
  active = true;

-- SuperUser gets both role preset capabilities by default.
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
    'role_presets.view',
    'role_presets.manage'
  )
on conflict do nothing;

-- ------------------------------------------------------------
-- 3. Updated-at helper
-- ------------------------------------------------------------

create or replace function public.oh_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_role_presets_updated_at on public.role_presets;

create trigger trg_role_presets_updated_at
before update on public.role_presets
for each row
execute function public.oh_set_updated_at();

-- ------------------------------------------------------------
-- 4. Normalisation helpers
-- ------------------------------------------------------------

create or replace function public.normalise_role_preset_code(p_value text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(
      lower(trim(coalesce(p_value, ''))),
      '[^a-z0-9]+',
      '_',
      'g'
    ),
    '^_+|_+$',
    '',
    'g'
  );
$$;

grant execute on function public.normalise_role_preset_code(text) to authenticated;

-- ------------------------------------------------------------
-- 5. Permission helpers
-- ------------------------------------------------------------

create or replace function public.can_view_role_preset_management()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('role_presets.view')
      or public.user_has_capability('role_presets.manage')
      or public.user_has_capability('access_control.view')
      or public.user_has_capability('access_control.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.view')
    );
$$;

create or replace function public.can_manage_role_preset_management()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('role_presets.manage')
      or public.user_has_capability('access_control.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.edit')
    );
$$;

grant execute on function public.can_view_role_preset_management() to authenticated;
grant execute on function public.can_manage_role_preset_management() to authenticated;

-- ------------------------------------------------------------
-- 6. RPC: list role presets for management
-- ------------------------------------------------------------

create or replace function public.list_role_presets_for_management(
  p_include_inactive boolean default true,
  p_search_text text default null
)
returns table (
  role_preset_id uuid,
  role_code text,
  role_name text,
  description text,
  active boolean,
  is_system boolean,
  capability_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_role_preset_management() then
    raise exception 'You do not have permission to view role presets';
  end if;

  return query
  select
    rp.id as role_preset_id,
    rp.role_code,
    rp.role_name,
    rp.description,
    rp.active,
    rp.is_system,
    count(rpc.capability_id)::integer as capability_count,
    rp.created_at,
    rp.updated_at
  from public.role_presets rp
  left join public.role_preset_capabilities rpc
    on rpc.role_preset_id = rp.id
  where (p_include_inactive is true or rp.active is true)
    and (
      p_search_text is null
      or trim(p_search_text) = ''
      or (
        coalesce(rp.role_code, '') || ' ' ||
        coalesce(rp.role_name, '') || ' ' ||
        coalesce(rp.description, '')
      ) ilike '%' || p_search_text || '%'
    )
  group by
    rp.id,
    rp.role_code,
    rp.role_name,
    rp.description,
    rp.active,
    rp.is_system,
    rp.created_at,
    rp.updated_at
  order by
    rp.is_system desc,
    rp.role_name asc,
    rp.role_code asc;
end;
$$;

-- ------------------------------------------------------------
-- 7. RPC: get role preset detail
-- ------------------------------------------------------------

create or replace function public.get_role_preset_for_management(
  p_role_preset_id uuid
)
returns table (
  role_preset_id uuid,
  role_code text,
  role_name text,
  description text,
  active boolean,
  is_system boolean,
  capability_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_role_preset_management() then
    raise exception 'You do not have permission to view role presets';
  end if;

  return query
  select
    rp.id as role_preset_id,
    rp.role_code,
    rp.role_name,
    rp.description,
    rp.active,
    rp.is_system,
    count(rpc.capability_id)::integer as capability_count,
    rp.created_at,
    rp.updated_at
  from public.role_presets rp
  left join public.role_preset_capabilities rpc
    on rpc.role_preset_id = rp.id
  where rp.id = p_role_preset_id
  group by
    rp.id,
    rp.role_code,
    rp.role_name,
    rp.description,
    rp.active,
    rp.is_system,
    rp.created_at,
    rp.updated_at;

  if not found then
    raise exception 'Role preset not found';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 8. RPC: capability catalogue for preset assignment
-- ------------------------------------------------------------

create or replace function public.list_capability_catalogue_for_role_preset(
  p_role_preset_id uuid default null,
  p_search_text text default null,
  p_include_inactive boolean default false
)
returns table (
  capability_id uuid,
  capability_code text,
  capability_name text,
  capability_description text,
  capability_active boolean,
  group_code text,
  group_name text,
  group_display_order integer,
  assigned boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_role_preset_management() then
    raise exception 'You do not have permission to view capability catalogue';
  end if;

  return query
  select
    c.id as capability_id,
    c.capability_code,
    c.capability_name,
    c.description as capability_description,
    c.active as capability_active,
    cg.group_code,
    cg.group_name,
    cg.display_order as group_display_order,
    exists (
      select 1
      from public.role_preset_capabilities rpc
      where rpc.role_preset_id = p_role_preset_id
        and rpc.capability_id = c.id
    ) as assigned
  from public.capabilities c
  left join public.capability_groups cg
    on cg.id = c.group_id
  where (p_include_inactive is true or c.active is true)
    and (
      p_search_text is null
      or trim(p_search_text) = ''
      or (
        coalesce(c.capability_code, '') || ' ' ||
        coalesce(c.capability_name, '') || ' ' ||
        coalesce(c.description, '') || ' ' ||
        coalesce(cg.group_code, '') || ' ' ||
        coalesce(cg.group_name, '')
      ) ilike '%' || p_search_text || '%'
    )
  order by
    coalesce(cg.display_order, 9999),
    coalesce(cg.group_name, ''),
    c.capability_code;
end;
$$;

-- ------------------------------------------------------------
-- 9. RPC: list capabilities assigned to a role preset
-- ------------------------------------------------------------

create or replace function public.list_role_preset_assigned_capabilities(
  p_role_preset_id uuid
)
returns table (
  capability_id uuid,
  capability_code text,
  capability_name text,
  capability_description text,
  group_code text,
  group_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_role_preset_management() then
    raise exception 'You do not have permission to view role preset capabilities';
  end if;

  return query
  select
    c.id as capability_id,
    c.capability_code,
    c.capability_name,
    c.description as capability_description,
    cg.group_code,
    cg.group_name
  from public.role_preset_capabilities rpc
  join public.capabilities c
    on c.id = rpc.capability_id
  left join public.capability_groups cg
    on cg.id = c.group_id
  where rpc.role_preset_id = p_role_preset_id
  order by
    coalesce(cg.display_order, 9999),
    coalesce(cg.group_name, ''),
    c.capability_code;
end;
$$;

-- ------------------------------------------------------------
-- 10. RPC: create custom role preset
-- ------------------------------------------------------------

create or replace function public.create_custom_role_preset(
  p_role_code text default null,
  p_role_name text default null,
  p_description text default null,
  p_capability_codes text[] default '{}'::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_code text;
  v_role_name text;
  v_role_preset_id uuid;
begin
  if not public.can_manage_role_preset_management() then
    raise exception 'You do not have permission to create role presets';
  end if;

  v_role_name := nullif(trim(coalesce(p_role_name, '')), '');
  if v_role_name is null then
    raise exception 'Role preset name is required';
  end if;

  v_role_code := public.normalise_role_preset_code(coalesce(nullif(trim(coalesce(p_role_code, '')), ''), v_role_name));

  if v_role_code is null or v_role_code = '' then
    raise exception 'Role preset code is required';
  end if;

  if v_role_code in ('super_user', 'security', 'general_user', 'kiosk') then
    raise exception 'This role preset code is reserved for a system preset';
  end if;

  if exists (
    select 1
    from public.role_presets rp
    where rp.role_code = v_role_code
  ) then
    raise exception 'A role preset with this code already exists';
  end if;

  insert into public.role_presets (
    role_code,
    role_name,
    description,
    active,
    is_system,
    created_by,
    updated_by
  )
  values (
    v_role_code,
    v_role_name,
    nullif(trim(coalesce(p_description, '')), ''),
    true,
    false,
    auth.uid(),
    auth.uid()
  )
  returning id into v_role_preset_id;

  if p_capability_codes is not null and array_length(p_capability_codes, 1) is not null then
    insert into public.role_preset_capabilities (
      role_preset_id,
      capability_id
    )
    select
      v_role_preset_id,
      c.id
    from public.capabilities c
    where c.capability_code = any(p_capability_codes)
      and c.active is true
    on conflict do nothing;
  end if;

  begin
    perform public.write_audit_event(
      'role_preset.created',
      'role_presets',
      v_role_preset_id::text,
      jsonb_build_object(
        'summary', 'Custom role preset created.',
        'role_code', v_role_code,
        'role_name', v_role_name
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during role preset create: %', sqlerrm;
  end;

  return v_role_preset_id;
end;
$$;

-- ------------------------------------------------------------
-- 11. RPC: update custom role preset
-- ------------------------------------------------------------

create or replace function public.update_custom_role_preset(
  p_role_preset_id uuid,
  p_role_code text default null,
  p_role_name text default null,
  p_description text default null,
  p_active boolean default null,
  p_capability_codes text[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.role_presets;
  v_role_code text;
  v_role_name text;
begin
  if not public.can_manage_role_preset_management() then
    raise exception 'You do not have permission to update role presets';
  end if;

  select *
  into v_existing
  from public.role_presets
  where id = p_role_preset_id
  for update;

  if not found then
    raise exception 'Role preset not found';
  end if;

  if v_existing.is_system is true then
    raise exception 'System role presets are protected and cannot be edited through custom role preset management';
  end if;

  v_role_name := coalesce(nullif(trim(coalesce(p_role_name, '')), ''), v_existing.role_name);
  v_role_code := case
    when p_role_code is null or trim(p_role_code) = '' then v_existing.role_code
    else public.normalise_role_preset_code(p_role_code)
  end;

  if v_role_name is null or trim(v_role_name) = '' then
    raise exception 'Role preset name is required';
  end if;

  if v_role_code is null or v_role_code = '' then
    raise exception 'Role preset code is required';
  end if;

  if v_role_code in ('super_user', 'security', 'general_user', 'kiosk') then
    raise exception 'This role preset code is reserved for a system preset';
  end if;

  if exists (
    select 1
    from public.role_presets rp
    where rp.role_code = v_role_code
      and rp.id <> p_role_preset_id
  ) then
    raise exception 'A role preset with this code already exists';
  end if;

  update public.role_presets
  set
    role_code = v_role_code,
    role_name = v_role_name,
    description = case
      when p_description is null then description
      else nullif(trim(p_description), '')
    end,
    active = coalesce(p_active, active),
    updated_by = auth.uid()
  where id = p_role_preset_id;

  if p_capability_codes is not null then
    delete from public.role_preset_capabilities
    where role_preset_id = p_role_preset_id;

    if array_length(p_capability_codes, 1) is not null then
      insert into public.role_preset_capabilities (
        role_preset_id,
        capability_id
      )
      select
        p_role_preset_id,
        c.id
      from public.capabilities c
      where c.capability_code = any(p_capability_codes)
        and c.active is true
      on conflict do nothing;
    end if;
  end if;

  begin
    perform public.write_audit_event(
      'role_preset.updated',
      'role_presets',
      p_role_preset_id::text,
      jsonb_build_object(
        'summary', 'Custom role preset updated.',
        'old_role_code', v_existing.role_code,
        'new_role_code', v_role_code,
        'old_role_name', v_existing.role_name,
        'new_role_name', v_role_name
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during role preset update: %', sqlerrm;
  end;

  return p_role_preset_id;
end;
$$;

-- ------------------------------------------------------------
-- 12. RPC: set capabilities for custom role preset
-- ------------------------------------------------------------

create or replace function public.set_custom_role_preset_capabilities(
  p_role_preset_id uuid,
  p_capability_codes text[] default '{}'::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.role_presets;
begin
  if not public.can_manage_role_preset_management() then
    raise exception 'You do not have permission to update role preset capabilities';
  end if;

  select *
  into v_existing
  from public.role_presets
  where id = p_role_preset_id
  for update;

  if not found then
    raise exception 'Role preset not found';
  end if;

  if v_existing.is_system is true then
    raise exception 'System role presets are protected and cannot be edited through custom role preset management';
  end if;

  delete from public.role_preset_capabilities
  where role_preset_id = p_role_preset_id;

  if p_capability_codes is not null and array_length(p_capability_codes, 1) is not null then
    insert into public.role_preset_capabilities (
      role_preset_id,
      capability_id
    )
    select
      p_role_preset_id,
      c.id
    from public.capabilities c
    where c.capability_code = any(p_capability_codes)
      and c.active is true
    on conflict do nothing;
  end if;

  update public.role_presets
  set updated_by = auth.uid()
  where id = p_role_preset_id;

  begin
    perform public.write_audit_event(
      'role_preset.capabilities_updated',
      'role_preset_capabilities',
      p_role_preset_id::text,
      jsonb_build_object(
        'summary', 'Custom role preset capabilities updated.',
        'role_code', v_existing.role_code,
        'role_name', v_existing.role_name,
        'capability_count', coalesce(array_length(p_capability_codes, 1), 0)
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during role preset capability update: %', sqlerrm;
  end;

  return p_role_preset_id;
end;
$$;

-- ------------------------------------------------------------
-- 13. Grants
-- ------------------------------------------------------------

grant execute on function public.can_view_role_preset_management() to authenticated;
grant execute on function public.can_manage_role_preset_management() to authenticated;
grant execute on function public.list_role_presets_for_management(boolean, text) to authenticated;
grant execute on function public.get_role_preset_for_management(uuid) to authenticated;
grant execute on function public.list_capability_catalogue_for_role_preset(uuid, text, boolean) to authenticated;
grant execute on function public.list_role_preset_assigned_capabilities(uuid) to authenticated;
grant execute on function public.create_custom_role_preset(text, text, text, text[]) to authenticated;
grant execute on function public.update_custom_role_preset(uuid, text, text, text, boolean, text[]) to authenticated;
grant execute on function public.set_custom_role_preset_capabilities(uuid, text[]) to authenticated;

-- Ask PostgREST/Supabase API to reload its schema cache.
notify pgrst, 'reload schema';

select 'OHP-008 custom role preset management installed' as result;