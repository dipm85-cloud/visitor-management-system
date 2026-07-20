-- ============================================================
-- Operations Hub - OHP-016 Admin Presence and System Messages
--
-- Purpose:
-- - Track recently active authenticated app sessions.
-- - Allow authorised admins to see who is probably online.
-- - Allow authorised admins to send one-way system messages to:
--   - one selected user
--   - all currently connected users
-- - Support user acknowledgement.
-- - Audit admin message sends where audit helper exists.
--
-- Safety:
-- - No chat.
-- - No user-to-user messaging.
-- - No replies.
-- - No impersonation.
-- - No permission bypass.
-- - Presence is "probably online", based on heartbeat.
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
  'system_messages',
  'System Messages',
  'Admin presence and one-way system messages for connected users.',
  165,
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
      'online_users.view',
      'View online users',
      'Allows authorised users to view recently active app sessions.'
    ),
    (
      'admin_system_messages.send',
      'Send system messages',
      'Allows authorised users to send one-way system messages to users.'
    ),
    (
      'admin_system_messages.view',
      'View system message history',
      'Allows authorised users to view admin system message history.'
    )
) as c(capability_code, capability_name, capability_description)
where cg.group_code = 'system_messages'
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
    'online_users.view',
    'admin_system_messages.send',
    'admin_system_messages.view'
  )
on conflict do nothing;

-- ------------------------------------------------------------
-- 2. Presence sessions table
-- ------------------------------------------------------------

create table if not exists public.app_user_sessions (
  id uuid primary key default gen_random_uuid(),

  session_key text not null unique,
  profile_id uuid not null references public.profiles(id) on delete cascade,

  display_name text,
  current_workspace text,
  current_route text,

  user_agent text,
  device_label text,

  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,

  active boolean not null default true,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint app_user_sessions_session_key_not_blank
    check (length(trim(session_key)) > 0)
);

create index if not exists idx_app_user_sessions_profile
on public.app_user_sessions(profile_id);

create index if not exists idx_app_user_sessions_active_last_seen
on public.app_user_sessions(active, last_seen_at desc);

create index if not exists idx_app_user_sessions_session_key
on public.app_user_sessions(session_key);

-- ------------------------------------------------------------
-- 3. Admin system messages table
-- ------------------------------------------------------------

create table if not exists public.admin_system_messages (
  id uuid primary key default gen_random_uuid(),

  target_scope text not null,
  target_profile_id uuid references public.profiles(id) on delete set null,

  message_type text not null default 'info',
  title text not null,
  body text not null,

  action_hint text,
  expires_at timestamptz,

  sent_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz not null default now(),

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint admin_system_messages_target_scope_check
    check (target_scope in ('profile', 'all_connected')),

  constraint admin_system_messages_type_check
    check (message_type in ('info', 'warning', 'maintenance', 'access_update', 'refresh_required')),

  constraint admin_system_messages_title_not_blank
    check (length(trim(title)) > 0),

  constraint admin_system_messages_body_not_blank
    check (length(trim(body)) > 0),

  constraint admin_system_messages_profile_target_check
    check (
      (target_scope = 'profile' and target_profile_id is not null)
      or
      (target_scope = 'all_connected')
    )
);

create index if not exists idx_admin_system_messages_target
on public.admin_system_messages(target_scope, target_profile_id, sent_at desc);

create index if not exists idx_admin_system_messages_expires
on public.admin_system_messages(expires_at);

create index if not exists idx_admin_system_messages_sent_by
on public.admin_system_messages(sent_by, sent_at desc);

-- ------------------------------------------------------------
-- 4. Message acknowledgement table
-- ------------------------------------------------------------

create table if not exists public.admin_system_message_acknowledgements (
  id uuid primary key default gen_random_uuid(),

  message_id uuid not null references public.admin_system_messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  session_key text,

  acknowledged_at timestamptz not null default now(),

  unique(message_id, profile_id)
);

create index if not exists idx_admin_system_message_ack_profile
on public.admin_system_message_acknowledgements(profile_id, acknowledged_at desc);

-- ------------------------------------------------------------
-- 5. Updated-at helper and triggers
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

drop trigger if exists trg_app_user_sessions_updated_at on public.app_user_sessions;

create trigger trg_app_user_sessions_updated_at
before update on public.app_user_sessions
for each row
execute function public.oh_set_updated_at();

-- ------------------------------------------------------------
-- 6. Permission helpers
-- ------------------------------------------------------------

create or replace function public.can_view_online_users()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('online_users.view')
      or public.user_has_capability('admin_system_messages.send')
      or public.user_has_capability('access_control.manage')
      or public.user_has_capability('users.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.view')
    );
$$;

create or replace function public.can_send_admin_system_messages()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('admin_system_messages.send')
      or public.user_has_capability('access_control.manage')
      or public.user_has_capability('users.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.edit')
    );
$$;

create or replace function public.can_view_admin_system_messages()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('admin_system_messages.view')
      or public.user_has_capability('admin_system_messages.send')
      or public.user_has_capability('access_control.manage')
      or public.user_has_capability('users.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.view')
    );
$$;

grant execute on function public.can_view_online_users() to authenticated;
grant execute on function public.can_send_admin_system_messages() to authenticated;
grant execute on function public.can_view_admin_system_messages() to authenticated;

-- ------------------------------------------------------------
-- 7. RLS
-- ------------------------------------------------------------

alter table public.app_user_sessions enable row level security;
alter table public.admin_system_messages enable row level security;
alter table public.admin_system_message_acknowledgements enable row level security;

drop policy if exists "users can view own app sessions" on public.app_user_sessions;
drop policy if exists "admins can view app sessions" on public.app_user_sessions;
drop policy if exists "users can create own app sessions" on public.app_user_sessions;
drop policy if exists "users can update own app sessions" on public.app_user_sessions;

create policy "users can view own app sessions"
on public.app_user_sessions
for select
to authenticated
using (profile_id = auth.uid());

create policy "admins can view app sessions"
on public.app_user_sessions
for select
to authenticated
using (public.can_view_online_users());

create policy "users can create own app sessions"
on public.app_user_sessions
for insert
to authenticated
with check (profile_id = auth.uid());

create policy "users can update own app sessions"
on public.app_user_sessions
for update
to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

drop policy if exists "users can view own system messages" on public.admin_system_messages;
drop policy if exists "admins can view all system messages" on public.admin_system_messages;
drop policy if exists "admins can insert system messages" on public.admin_system_messages;

create policy "users can view own system messages"
on public.admin_system_messages
for select
to authenticated
using (
  (
    target_scope = 'profile'
    and target_profile_id = auth.uid()
  )
  or
  (
    target_scope = 'all_connected'
    and (
      expires_at is null
      or expires_at > now()
    )
  )
);

create policy "admins can view all system messages"
on public.admin_system_messages
for select
to authenticated
using (public.can_view_admin_system_messages());

create policy "admins can insert system messages"
on public.admin_system_messages
for insert
to authenticated
with check (public.can_send_admin_system_messages());

drop policy if exists "users can view own message acknowledgements" on public.admin_system_message_acknowledgements;
drop policy if exists "admins can view message acknowledgements" on public.admin_system_message_acknowledgements;
drop policy if exists "users can acknowledge own messages" on public.admin_system_message_acknowledgements;

create policy "users can view own message acknowledgements"
on public.admin_system_message_acknowledgements
for select
to authenticated
using (profile_id = auth.uid());

create policy "admins can view message acknowledgements"
on public.admin_system_message_acknowledgements
for select
to authenticated
using (public.can_view_admin_system_messages());

create policy "users can acknowledge own messages"
on public.admin_system_message_acknowledgements
for insert
to authenticated
with check (profile_id = auth.uid());

grant select, insert, update on public.app_user_sessions to authenticated;
grant select, insert on public.admin_system_messages to authenticated;
grant select, insert on public.admin_system_message_acknowledgements to authenticated;

-- ------------------------------------------------------------
-- 8. RPC: upsert current user presence
-- ------------------------------------------------------------

create or replace function public.upsert_app_user_presence(
  p_session_key text,
  p_current_workspace text default null,
  p_current_route text default null,
  p_user_agent text default null,
  p_device_label text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_display_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if nullif(trim(coalesce(p_session_key, '')), '') is null then
    raise exception 'Session key is required';
  end if;

  select p.display_name
  into v_display_name
  from public.profiles p
  where p.id = auth.uid()
    and p.active is true;

  if v_display_name is null then
    raise exception 'Active profile not found';
  end if;

  insert into public.app_user_sessions (
    session_key,
    profile_id,
    display_name,
    current_workspace,
    current_route,
    user_agent,
    device_label,
    last_seen_at,
    active,
    ended_at,
    metadata
  )
  values (
    trim(p_session_key),
    auth.uid(),
    v_display_name,
    nullif(trim(coalesce(p_current_workspace, '')), ''),
    nullif(trim(coalesce(p_current_route, '')), ''),
    nullif(trim(coalesce(p_user_agent, '')), ''),
    nullif(trim(coalesce(p_device_label, '')), ''),
    now(),
    true,
    null,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (session_key) do update
  set
    profile_id = excluded.profile_id,
    display_name = excluded.display_name,
    current_workspace = excluded.current_workspace,
    current_route = excluded.current_route,
    user_agent = excluded.user_agent,
    device_label = excluded.device_label,
    last_seen_at = now(),
    active = true,
    ended_at = null,
    metadata = coalesce(excluded.metadata, '{}'::jsonb)
  returning id into v_session_id;

  return v_session_id;
end;
$$;

grant execute on function public.upsert_app_user_presence(text, text, text, text, text, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 9. RPC: end current user presence
-- ------------------------------------------------------------

create or replace function public.end_app_user_presence(
  p_session_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  update public.app_user_sessions
  set
    active = false,
    ended_at = now(),
    last_seen_at = now()
  where session_key = trim(coalesce(p_session_key, ''))
    and profile_id = auth.uid()
  returning id into v_session_id;

  return v_session_id;
end;
$$;

grant execute on function public.end_app_user_presence(text) to authenticated;

-- ------------------------------------------------------------
-- 10. RPC: list probably online sessions
-- ------------------------------------------------------------

create or replace function public.list_online_user_sessions(
  p_online_seconds integer default 120,
  p_include_current_user boolean default true,
  p_search_text text default null
)
returns table (
  session_id uuid,
  session_key text,
  profile_id uuid,
  display_name text,
  current_workspace text,
  current_route text,
  device_label text,
  started_at timestamptz,
  last_seen_at timestamptz,
  seconds_since_seen integer,
  is_current_user boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_online_seconds integer := greatest(coalesce(p_online_seconds, 120), 30);
begin
  if not public.can_view_online_users() then
    raise exception 'You do not have permission to view online users';
  end if;

  return query
  select
    s.id as session_id,
    s.session_key,
    s.profile_id,
    s.display_name,
    s.current_workspace,
    s.current_route,
    s.device_label,
    s.started_at,
    s.last_seen_at,
    extract(epoch from (now() - s.last_seen_at))::integer as seconds_since_seen,
    s.profile_id = auth.uid() as is_current_user
  from public.app_user_sessions s
  where s.active is true
    and s.last_seen_at >= now() - make_interval(secs => v_online_seconds)
    and (p_include_current_user is true or s.profile_id <> auth.uid())
    and (
      p_search_text is null
      or trim(p_search_text) = ''
      or (
        coalesce(s.display_name, '') || ' ' ||
        coalesce(s.current_workspace, '') || ' ' ||
        coalesce(s.current_route, '') || ' ' ||
        s.profile_id::text
      ) ilike '%' || p_search_text || '%'
    )
  order by s.last_seen_at desc, s.display_name asc;
end;
$$;

grant execute on function public.list_online_user_sessions(integer, boolean, text) to authenticated;

-- ------------------------------------------------------------
-- 11. RPC: send one-way admin system message
-- ------------------------------------------------------------

create or replace function public.send_admin_system_message(
  p_target_scope text,
  p_target_profile_id uuid default null,
  p_title text default null,
  p_body text default null,
  p_message_type text default 'info',
  p_action_hint text default null,
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
  v_message_type text := lower(trim(coalesce(p_message_type, 'info')));
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_expires_at timestamptz;
begin
  if not public.can_send_admin_system_messages() then
    raise exception 'You do not have permission to send system messages';
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

  if v_title is null then
    raise exception 'Message title is required';
  end if;

  if v_body is null then
    raise exception 'Message body is required';
  end if;

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
    metadata
  )
  values (
    v_target_scope,
    case when v_target_scope = 'profile' then p_target_profile_id else null end,
    v_message_type,
    v_title,
    v_body,
    nullif(trim(coalesce(p_action_hint, '')), ''),
    v_expires_at,
    auth.uid(),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_message_id;

  begin
    perform public.write_audit_event(
      'admin_system_message.sent',
      'admin_system_messages',
      v_message_id::text,
      jsonb_build_object(
        'summary', 'Admin system message sent.',
        'target_scope', v_target_scope,
        'target_profile_id', p_target_profile_id,
        'message_type', v_message_type,
        'title', v_title,
        'expires_at', v_expires_at
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during admin system message send: %', sqlerrm;
  end;

  return v_message_id;
end;
$$;

grant execute on function public.send_admin_system_message(text, uuid, text, text, text, text, integer, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 12. RPC: acknowledge message
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
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if p_message_id is null then
    raise exception 'Message is required';
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
  ) then
    raise exception 'Message not found or not available to this user';
  end if;

  insert into public.admin_system_message_acknowledgements (
    message_id,
    profile_id,
    session_key
  )
  values (
    p_message_id,
    auth.uid(),
    nullif(trim(coalesce(p_session_key, '')), '')
  )
  on conflict (message_id, profile_id) do update
  set acknowledged_at = now(),
      session_key = excluded.session_key
  returning id into v_ack_id;

  return v_ack_id;
end;
$$;

grant execute on function public.acknowledge_admin_system_message(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 13. RPC: list pending direct messages for current user
-- ------------------------------------------------------------

create or replace function public.list_my_pending_system_messages()
returns table (
  message_id uuid,
  target_scope text,
  message_type text,
  title text,
  body text,
  action_hint text,
  sent_at timestamptz,
  expires_at timestamptz
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
    m.id as message_id,
    m.target_scope,
    m.message_type,
    m.title,
    m.body,
    m.action_hint,
    m.sent_at,
    m.expires_at
  from public.admin_system_messages m
  where m.target_scope = 'profile'
    and m.target_profile_id = auth.uid()
    and (m.expires_at is null or m.expires_at > now())
    and not exists (
      select 1
      from public.admin_system_message_acknowledgements a
      where a.message_id = m.id
        and a.profile_id = auth.uid()
    )
  order by m.sent_at asc;
end;
$$;

grant execute on function public.list_my_pending_system_messages() to authenticated;

-- ------------------------------------------------------------
-- 14. Realtime publication best-effort
-- ------------------------------------------------------------

alter table public.app_user_sessions replica identity full;
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
        and tablename = 'app_user_sessions'
    ) then
      execute 'alter publication supabase_realtime add table public.app_user_sessions';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'admin_system_messages'
    ) then
      execute 'alter publication supabase_realtime add table public.admin_system_messages';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'admin_system_message_acknowledgements'
    ) then
      execute 'alter publication supabase_realtime add table public.admin_system_message_acknowledgements';
    end if;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 15. Verification
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

select
  'OHP-016 admin presence and system messages installed' as result,
  (select count(*) from public.capabilities where capability_code in ('online_users.view', 'admin_system_messages.send', 'admin_system_messages.view')) as capabilities_verified;