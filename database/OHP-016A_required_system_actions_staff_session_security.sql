-- ============================================================
-- Operations Hub - OHP-016A Required System Actions
-- and Staff Inactivity Sign-out Foundation
--
-- Purpose:
-- - Extend one-way admin system messages with required actions.
-- - Allow authorised admins to require refresh/sign-out after grace.
-- - Add staff session security settings for inactivity timeout.
-- - Explicitly keep Shared Terminal/Kiosk separate from staff timeout.
--
-- Safety:
-- - No impersonation.
-- - No chat.
-- - No user replies.
-- - No backend permission bypass.
-- - Forced action is client-session action only.
-- - Staff inactivity timeout is based on real user activity, not heartbeat.
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
  'session_security',
  'Session Security',
  'Staff session timeout and required system action settings.',
  166,
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
      'admin_system_messages.force_action',
      'Send required system actions',
      'Allows authorised admins to send required system messages such as forced refresh or sign-out after a grace period.'
    ),
    (
      'session_security_settings.view',
      'View session security settings',
      'Allows authorised users to view staff session security settings.'
    ),
    (
      'session_security_settings.manage',
      'Manage session security settings',
      'Allows authorised users to manage staff inactivity timeout and session security settings.'
    )
) as c(capability_code, capability_name, capability_description)
where cg.group_code = 'session_security'
on conflict (capability_code) do update
set
  capability_name = excluded.capability_name,
  group_id = excluded.group_id,
  description = excluded.description,
  active = true;

-- SuperUser gets these capabilities by default.
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
    'admin_system_messages.force_action',
    'session_security_settings.view',
    'session_security_settings.manage'
  )
on conflict do nothing;

-- ------------------------------------------------------------
-- 2. Session security settings table
-- ------------------------------------------------------------

create table if not exists public.session_security_settings (
  id boolean primary key default true,

  staff_inactivity_enabled boolean not null default true,
  staff_idle_timeout_minutes integer not null default 30,
  staff_warning_seconds integer not null default 60,
  staff_auto_sign_out_enabled boolean not null default true,

  shared_terminal_idle_reset_enabled boolean not null default false,
  shared_terminal_idle_reset_seconds integer not null default 120,
  shared_terminal_excluded_from_staff_timeout boolean not null default true,

  notes text,

  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint session_security_settings_singleton check (id is true),
  constraint session_security_staff_idle_timeout_check check (staff_idle_timeout_minutes between 5 and 1440),
  constraint session_security_staff_warning_seconds_check check (staff_warning_seconds between 15 and 900),
  constraint session_security_terminal_reset_seconds_check check (shared_terminal_idle_reset_seconds between 30 and 3600)
);

insert into public.session_security_settings (id)
values (true)
on conflict (id) do nothing;

create or replace function public.oh_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_session_security_settings_updated_at on public.session_security_settings;

create trigger trg_session_security_settings_updated_at
before update on public.session_security_settings
for each row
execute function public.oh_set_updated_at();

-- ------------------------------------------------------------
-- 3. Extend admin system messages
-- ------------------------------------------------------------

alter table public.admin_system_messages
add column if not exists requires_action boolean not null default false;

alter table public.admin_system_messages
add column if not exists required_action text;

alter table public.admin_system_messages
add column if not exists required_action_grace_seconds integer;

alter table public.admin_system_messages
add column if not exists required_action_deadline_at timestamptz;

alter table public.admin_system_messages
add column if not exists force_after_grace boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_system_messages_required_action_check'
      and conrelid = 'public.admin_system_messages'::regclass
  ) then
    alter table public.admin_system_messages
    add constraint admin_system_messages_required_action_check
    check (
      required_action is null
      or required_action in (
        'acknowledge_only',
        'refresh_required',
        'sign_out_required',
        'sign_out_and_back_in_required'
      )
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_system_messages_required_action_consistency_check'
      and conrelid = 'public.admin_system_messages'::regclass
  ) then
    alter table public.admin_system_messages
    add constraint admin_system_messages_required_action_consistency_check
    check (
      requires_action is false
      or (
        requires_action is true
        and required_action is not null
        and required_action_grace_seconds is not null
        and required_action_grace_seconds between 30 and 86400
        and required_action_deadline_at is not null
      )
    );
  end if;
end;
$$;

create index if not exists idx_admin_system_messages_required_deadline
on public.admin_system_messages(requires_action, required_action_deadline_at);

-- ------------------------------------------------------------
-- 4. Extend acknowledgements
-- ------------------------------------------------------------

alter table public.admin_system_message_acknowledgements
add column if not exists acknowledgement_type text not null default 'acknowledged';

alter table public.admin_system_message_acknowledgements
add column if not exists action_taken text;

alter table public.admin_system_message_acknowledgements
add column if not exists action_completed_at timestamptz;

alter table public.admin_system_message_acknowledgements
add column if not exists auto_completed boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_system_message_ack_type_check'
      and conrelid = 'public.admin_system_message_acknowledgements'::regclass
  ) then
    alter table public.admin_system_message_acknowledgements
    add constraint admin_system_message_ack_type_check
    check (
      acknowledgement_type in (
        'acknowledged',
        'action_completed',
        'auto_completed'
      )
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_system_message_ack_action_taken_check'
      and conrelid = 'public.admin_system_message_acknowledgements'::regclass
  ) then
    alter table public.admin_system_message_acknowledgements
    add constraint admin_system_message_ack_action_taken_check
    check (
      action_taken is null
      or action_taken in (
        'acknowledge_only',
        'refresh_required',
        'sign_out_required',
        'sign_out_and_back_in_required',
        'refresh_now',
        'sign_out_now',
        'sign_out_and_back_in_now'
      )
    );
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 5. Permission helpers
-- ------------------------------------------------------------

create or replace function public.can_send_forced_admin_system_actions()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('admin_system_messages.force_action')
      or public.user_has_capability('access_control.manage')
      or public.user_has_capability('users.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.edit')
    );
$$;

create or replace function public.can_view_session_security_settings()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('session_security_settings.view')
      or public.user_has_capability('session_security_settings.manage')
      or public.user_has_capability('access_control.manage')
      or public.user_has_capability('settings.view')
      or public.user_has_capability('settings.edit')
    );
$$;

create or replace function public.can_manage_session_security_settings()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('session_security_settings.manage')
      or public.user_has_capability('access_control.manage')
      or public.user_has_capability('settings.edit')
    );
$$;

grant execute on function public.can_send_forced_admin_system_actions() to authenticated;
grant execute on function public.can_view_session_security_settings() to authenticated;
grant execute on function public.can_manage_session_security_settings() to authenticated;

-- ------------------------------------------------------------
-- 6. RLS for session security settings
-- ------------------------------------------------------------

alter table public.session_security_settings enable row level security;

drop policy if exists "admins can view session security settings" on public.session_security_settings;
drop policy if exists "admins can update session security settings" on public.session_security_settings;

create policy "admins can view session security settings"
on public.session_security_settings
for select
to authenticated
using (public.can_view_session_security_settings());

create policy "admins can update session security settings"
on public.session_security_settings
for update
to authenticated
using (public.can_manage_session_security_settings())
with check (public.can_manage_session_security_settings());

grant select, update on public.session_security_settings to authenticated;

-- ------------------------------------------------------------
-- 7. RPC: settings for current user/session runtime
-- ------------------------------------------------------------

create or replace function public.get_my_session_security_settings()
returns table (
  staff_inactivity_enabled boolean,
  staff_idle_timeout_minutes integer,
  staff_warning_seconds integer,
  staff_auto_sign_out_enabled boolean,
  shared_terminal_idle_reset_enabled boolean,
  shared_terminal_idle_reset_seconds integer,
  shared_terminal_excluded_from_staff_timeout boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  return query
  select
    s.staff_inactivity_enabled,
    s.staff_idle_timeout_minutes,
    s.staff_warning_seconds,
    s.staff_auto_sign_out_enabled,
    s.shared_terminal_idle_reset_enabled,
    s.shared_terminal_idle_reset_seconds,
    s.shared_terminal_excluded_from_staff_timeout
  from public.session_security_settings s
  where s.id is true;
end;
$$;

grant execute on function public.get_my_session_security_settings() to authenticated;

-- ------------------------------------------------------------
-- 8. RPC: admin view settings
-- ------------------------------------------------------------

create or replace function public.get_session_security_admin_settings()
returns table (
  staff_inactivity_enabled boolean,
  staff_idle_timeout_minutes integer,
  staff_warning_seconds integer,
  staff_auto_sign_out_enabled boolean,
  shared_terminal_idle_reset_enabled boolean,
  shared_terminal_idle_reset_seconds integer,
  shared_terminal_excluded_from_staff_timeout boolean,
  notes text,
  updated_by uuid,
  updated_by_name text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_session_security_settings() then
    raise exception 'You do not have permission to view session security settings';
  end if;

  return query
  select
    s.staff_inactivity_enabled,
    s.staff_idle_timeout_minutes,
    s.staff_warning_seconds,
    s.staff_auto_sign_out_enabled,
    s.shared_terminal_idle_reset_enabled,
    s.shared_terminal_idle_reset_seconds,
    s.shared_terminal_excluded_from_staff_timeout,
    s.notes,
    s.updated_by,
    p.display_name as updated_by_name,
    s.created_at,
    s.updated_at
  from public.session_security_settings s
  left join public.profiles p
    on p.id = s.updated_by
  where s.id is true;
end;
$$;

grant execute on function public.get_session_security_admin_settings() to authenticated;

-- ------------------------------------------------------------
-- 9. RPC: update settings
-- ------------------------------------------------------------

create or replace function public.update_session_security_settings(
  p_staff_inactivity_enabled boolean default null,
  p_staff_idle_timeout_minutes integer default null,
  p_staff_warning_seconds integer default null,
  p_staff_auto_sign_out_enabled boolean default null,
  p_shared_terminal_idle_reset_enabled boolean default null,
  p_shared_terminal_idle_reset_seconds integer default null,
  p_shared_terminal_excluded_from_staff_timeout boolean default null,
  p_notes text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_idle_timeout integer;
  v_staff_warning_seconds integer;
  v_terminal_reset_seconds integer;
begin
  if not public.can_manage_session_security_settings() then
    raise exception 'You do not have permission to manage session security settings';
  end if;

  v_staff_idle_timeout := coalesce(p_staff_idle_timeout_minutes, (
    select staff_idle_timeout_minutes
    from public.session_security_settings
    where id is true
  ));

  v_staff_warning_seconds := coalesce(p_staff_warning_seconds, (
    select staff_warning_seconds
    from public.session_security_settings
    where id is true
  ));

  v_terminal_reset_seconds := coalesce(p_shared_terminal_idle_reset_seconds, (
    select shared_terminal_idle_reset_seconds
    from public.session_security_settings
    where id is true
  ));

  if v_staff_idle_timeout not between 5 and 1440 then
    raise exception 'Staff idle timeout must be between 5 and 1440 minutes';
  end if;

  if v_staff_warning_seconds not between 15 and 900 then
    raise exception 'Staff warning countdown must be between 15 and 900 seconds';
  end if;

  if v_terminal_reset_seconds not between 30 and 3600 then
    raise exception 'Shared Terminal reset time must be between 30 and 3600 seconds';
  end if;

  update public.session_security_settings
  set
    staff_inactivity_enabled = coalesce(p_staff_inactivity_enabled, staff_inactivity_enabled),
    staff_idle_timeout_minutes = v_staff_idle_timeout,
    staff_warning_seconds = v_staff_warning_seconds,
    staff_auto_sign_out_enabled = coalesce(p_staff_auto_sign_out_enabled, staff_auto_sign_out_enabled),
    shared_terminal_idle_reset_enabled = coalesce(p_shared_terminal_idle_reset_enabled, shared_terminal_idle_reset_enabled),
    shared_terminal_idle_reset_seconds = v_terminal_reset_seconds,
    shared_terminal_excluded_from_staff_timeout = coalesce(p_shared_terminal_excluded_from_staff_timeout, shared_terminal_excluded_from_staff_timeout),
    notes = p_notes,
    updated_by = auth.uid()
  where id is true;

  begin
    perform public.write_audit_event(
      'session_security_settings.updated',
      'session_security_settings',
      'singleton',
      jsonb_build_object(
        'summary', 'Session security settings updated.',
        'staff_inactivity_enabled', p_staff_inactivity_enabled,
        'staff_idle_timeout_minutes', v_staff_idle_timeout,
        'staff_warning_seconds', v_staff_warning_seconds,
        'staff_auto_sign_out_enabled', p_staff_auto_sign_out_enabled,
        'shared_terminal_idle_reset_enabled', p_shared_terminal_idle_reset_enabled,
        'shared_terminal_idle_reset_seconds', v_terminal_reset_seconds,
        'shared_terminal_excluded_from_staff_timeout', p_shared_terminal_excluded_from_staff_timeout
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during session security settings update: %', sqlerrm;
  end;

  return true;
end;
$$;

grant execute on function public.update_session_security_settings(boolean, integer, integer, boolean, boolean, integer, boolean, text) to authenticated;

-- ------------------------------------------------------------
-- 10. RPC: send required admin system message
-- ------------------------------------------------------------

create or replace function public.send_required_admin_system_message(
  p_target_scope text,
  p_target_profile_id uuid default null,
  p_title text default null,
  p_body text default null,
  p_message_type text default 'access_update',
  p_required_action text default 'sign_out_required',
  p_force_after_grace boolean default true,
  p_grace_seconds integer default 300,
  p_expires_minutes integer default 60,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;
  v_target_scope text := lower(trim(coalesce(p_target_scope, '')));
  v_message_type text := lower(trim(coalesce(p_message_type, 'access_update')));
  v_required_action text := lower(trim(coalesce(p_required_action, 'sign_out_required')));
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_grace_seconds integer := greatest(coalesce(p_grace_seconds, 300), 30);
  v_expires_at timestamptz;
  v_deadline_at timestamptz;
begin
  if not public.can_send_admin_system_messages() then
    raise exception 'You do not have permission to send system messages';
  end if;

  if coalesce(p_force_after_grace, false) is true
     and not public.can_send_forced_admin_system_actions() then
    raise exception 'You do not have permission to send forced system actions';
  end if;

  if v_target_scope not in ('profile', 'all_connected') then
    raise exception 'Invalid message target';
  end if;

  if v_target_scope = 'profile' and p_target_profile_id is null then
    raise exception 'Target user is required';
  end if;

  if v_message_type not in ('info', 'warning', 'maintenance', 'access_update', 'refresh_required') then
    raise exception 'Invalid message type';
  end if;

  if v_required_action not in (
    'acknowledge_only',
    'refresh_required',
    'sign_out_required',
    'sign_out_and_back_in_required'
  ) then
    raise exception 'Invalid required action';
  end if;

  if v_title is null then
    raise exception 'Message title is required';
  end if;

  if v_body is null then
    raise exception 'Message body is required';
  end if;

  v_grace_seconds := least(v_grace_seconds, 86400);
  v_deadline_at := now() + make_interval(secs => v_grace_seconds);

  v_expires_at := case
    when coalesce(p_expires_minutes, 60) <= 0 then null
    else now() + make_interval(mins => least(coalesce(p_expires_minutes, 60), 1440))
  end;

  insert into public.admin_system_messages (
    target_scope,
    target_profile_id,
    message_type,
    title,
    body,
    action_hint,
    expires_at,
    sent_by,
    metadata,
    requires_action,
    required_action,
    required_action_grace_seconds,
    required_action_deadline_at,
    force_after_grace
  )
  values (
    v_target_scope,
    case when v_target_scope = 'profile' then p_target_profile_id else null end,
    v_message_type,
    v_title,
    v_body,
    v_required_action,
    v_expires_at,
    auth.uid(),
    coalesce(p_metadata, '{}'::jsonb),
    true,
    v_required_action,
    v_grace_seconds,
    v_deadline_at,
    coalesce(p_force_after_grace, false)
  )
  returning id into v_message_id;

  begin
    perform public.write_audit_event(
      'admin_system_message.required_sent',
      'admin_system_messages',
      v_message_id::text,
      jsonb_build_object(
        'summary', 'Required admin system message sent.',
        'target_scope', v_target_scope,
        'target_profile_id', p_target_profile_id,
        'message_type', v_message_type,
        'required_action', v_required_action,
        'force_after_grace', coalesce(p_force_after_grace, false),
        'grace_seconds', v_grace_seconds,
        'deadline_at', v_deadline_at,
        'expires_at', v_expires_at
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during required admin system message send: %', sqlerrm;
  end;

  return v_message_id;
end;
$$;

grant execute on function public.send_required_admin_system_message(text, uuid, text, text, text, text, boolean, integer, integer, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 11. RPC: safer acknowledge existing messages
-- ------------------------------------------------------------

create or replace function public.acknowledge_admin_system_message(
  p_message_id uuid,
  p_session_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ack_id uuid;
  v_requires_action boolean;
  v_force_after_grace boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if p_message_id is null then
    raise exception 'Message is required';
  end if;

  select
    m.requires_action,
    m.force_after_grace
  into
    v_requires_action,
    v_force_after_grace
  from public.admin_system_messages m
  where m.id = p_message_id
    and (
      (m.target_scope = 'profile' and m.target_profile_id = auth.uid())
      or
      (m.target_scope = 'all_connected')
    )
    and (m.expires_at is null or m.expires_at > now());

  if not found then
    raise exception 'Message not found or not available to this user';
  end if;

  if v_requires_action is true
     and v_force_after_grace is true then
    raise exception 'This message requires completing the requested action';
  end if;

  insert into public.admin_system_message_acknowledgements (
    message_id,
    profile_id,
    session_key,
    acknowledgement_type,
    action_taken,
    action_completed_at,
    auto_completed
  )
  values (
    p_message_id,
    auth.uid(),
    nullif(trim(coalesce(p_session_key, '')), ''),
    'acknowledged',
    'acknowledge_only',
    now(),
    false
  )
  on conflict (message_id, profile_id) do update
  set
    acknowledged_at = now(),
    session_key = excluded.session_key,
    acknowledgement_type = 'acknowledged',
    action_taken = 'acknowledge_only',
    action_completed_at = now(),
    auto_completed = false
  returning id into v_ack_id;

  return v_ack_id;
end;
$$;

grant execute on function public.acknowledge_admin_system_message(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 12. RPC: complete required action
-- ------------------------------------------------------------

create or replace function public.complete_admin_system_message_action(
  p_message_id uuid,
  p_session_key text default null,
  p_action_taken text default null,
  p_auto_completed boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ack_id uuid;
  v_action_taken text := lower(trim(coalesce(p_action_taken, 'acknowledge_only')));
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if p_message_id is null then
    raise exception 'Message is required';
  end if;

  if v_action_taken not in (
    'acknowledge_only',
    'refresh_required',
    'sign_out_required',
    'sign_out_and_back_in_required',
    'refresh_now',
    'sign_out_now',
    'sign_out_and_back_in_now'
  ) then
    raise exception 'Invalid action taken';
  end if;

  if not exists (
    select 1
    from public.admin_system_messages m
    where m.id = p_message_id
      and (
        (m.target_scope = 'profile' and m.target_profile_id = auth.uid())
        or
        (m.target_scope = 'all_connected')
      )
      and (m.expires_at is null or m.expires_at > now())
  ) then
    raise exception 'Message not found or not available to this user';
  end if;

  insert into public.admin_system_message_acknowledgements (
    message_id,
    profile_id,
    session_key,
    acknowledgement_type,
    action_taken,
    action_completed_at,
    auto_completed
  )
  values (
    p_message_id,
    auth.uid(),
    nullif(trim(coalesce(p_session_key, '')), ''),
    case when coalesce(p_auto_completed, false) then 'auto_completed' else 'action_completed' end,
    v_action_taken,
    now(),
    coalesce(p_auto_completed, false)
  )
  on conflict (message_id, profile_id) do update
  set
    acknowledged_at = now(),
    session_key = excluded.session_key,
    acknowledgement_type = excluded.acknowledgement_type,
    action_taken = excluded.action_taken,
    action_completed_at = now(),
    auto_completed = excluded.auto_completed
  returning id into v_ack_id;

  begin
    perform public.write_audit_event(
      'admin_system_message.action_completed',
      'admin_system_messages',
      p_message_id::text,
      jsonb_build_object(
        'summary', 'User completed required system message action.',
        'action_taken', v_action_taken,
        'auto_completed', coalesce(p_auto_completed, false)
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during required action completion: %', sqlerrm;
  end;

  return v_ack_id;
end;
$$;

grant execute on function public.complete_admin_system_message_action(uuid, text, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 13. RPC: pending messages v2 with required action fields
-- ------------------------------------------------------------

create or replace function public.list_my_pending_system_messages_v2(
  p_session_key text default null
)
returns table (
  message_id uuid,
  target_scope text,
  message_type text,
  title text,
  body text,
  action_hint text,
  sent_at timestamptz,
  expires_at timestamptz,
  requires_action boolean,
  required_action text,
  required_action_grace_seconds integer,
  required_action_deadline_at timestamptz,
  force_after_grace boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_started_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if nullif(trim(coalesce(p_session_key, '')), '') is not null then
    select s.started_at
    into v_session_started_at
    from public.app_user_sessions s
    where s.session_key = trim(p_session_key)
      and s.profile_id = auth.uid();
  end if;

  return query
  select
    m.id as message_id,
    m.target_scope,
    m.message_type,
    m.title,
    m.body,
    m.action_hint,
    m.sent_at,
    m.expires_at,
    coalesce(m.requires_action, false) as requires_action,
    m.required_action,
    m.required_action_grace_seconds,
    m.required_action_deadline_at,
    coalesce(m.force_after_grace, false) as force_after_grace
  from public.admin_system_messages m
  where (m.expires_at is null or m.expires_at > now())
    and not exists (
      select 1
      from public.admin_system_message_acknowledgements a
      where a.message_id = m.id
        and a.profile_id = auth.uid()
    )
    and (
      (
        m.target_scope = 'profile'
        and m.target_profile_id = auth.uid()
      )
      or
      (
        m.target_scope = 'all_connected'
        and v_session_started_at is not null
        and m.sent_at >= v_session_started_at - interval '5 seconds'
      )
    )
  order by
    coalesce(m.requires_action, false) desc,
    m.sent_at asc;
end;
$$;

grant execute on function public.list_my_pending_system_messages_v2(text) to authenticated;

-- ------------------------------------------------------------
-- 14. RPC: admin message history
-- ------------------------------------------------------------

create or replace function public.list_admin_system_message_history(
  p_limit integer default 50,
  p_search_text text default null
)
returns table (
  message_id uuid,
  target_scope text,
  target_profile_id uuid,
  target_display_name text,
  message_type text,
  title text,
  body text,
  action_hint text,
  requires_action boolean,
  required_action text,
  force_after_grace boolean,
  required_action_deadline_at timestamptz,
  expires_at timestamptz,
  sent_by uuid,
  sent_by_name text,
  sent_at timestamptz,
  acknowledgement_count integer,
  action_completed_count integer,
  auto_completed_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not public.can_view_admin_system_messages() then
    raise exception 'You do not have permission to view system message history';
  end if;

  return query
  select
    m.id as message_id,
    m.target_scope,
    m.target_profile_id,
    tp.display_name as target_display_name,
    m.message_type,
    m.title,
    m.body,
    m.action_hint,
    coalesce(m.requires_action, false) as requires_action,
    m.required_action,
    coalesce(m.force_after_grace, false) as force_after_grace,
    m.required_action_deadline_at,
    m.expires_at,
    m.sent_by,
    sp.display_name as sent_by_name,
    m.sent_at,
    coalesce(ack_counts.acknowledgement_count, 0)::integer as acknowledgement_count,
    coalesce(ack_counts.action_completed_count, 0)::integer as action_completed_count,
    coalesce(ack_counts.auto_completed_count, 0)::integer as auto_completed_count
  from public.admin_system_messages m
  left join public.profiles tp
    on tp.id = m.target_profile_id
  left join public.profiles sp
    on sp.id = m.sent_by
  left join lateral (
    select
      count(*) as acknowledgement_count,
      count(*) filter (where a.acknowledgement_type = 'action_completed') as action_completed_count,
      count(*) filter (where a.acknowledgement_type = 'auto_completed') as auto_completed_count
    from public.admin_system_message_acknowledgements a
    where a.message_id = m.id
  ) ack_counts on true
  where (
    p_search_text is null
    or trim(p_search_text) = ''
    or (
      coalesce(m.title, '') || ' ' ||
      coalesce(m.body, '') || ' ' ||
      coalesce(m.message_type, '') || ' ' ||
      coalesce(m.target_scope, '') || ' ' ||
      coalesce(tp.display_name, '') || ' ' ||
      coalesce(sp.display_name, '')
    ) ilike '%' || p_search_text || '%'
  )
  order by m.sent_at desc
  limit v_limit;
end;
$$;

grant execute on function public.list_admin_system_message_history(integer, text) to authenticated;

-- ------------------------------------------------------------
-- 15. Realtime publication best-effort
-- ------------------------------------------------------------

alter table public.session_security_settings replica identity full;
alter table public.admin_system_messages replica identity full;
alter table public.admin_system_message_acknowledgements replica identity full;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'session_security_settings'
    ) then
      execute 'alter publication supabase_realtime add table public.session_security_settings';
    end if;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 16. Verification
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

select
  'OHP-016A required system actions and staff session security installed' as result,
  (select count(*) from public.capabilities where capability_code in (
    'admin_system_messages.force_action',
    'session_security_settings.view',
    'session_security_settings.manage'
  )) as capabilities_verified,
  (select staff_idle_timeout_minutes from public.session_security_settings where id is true) as default_staff_idle_timeout_minutes;