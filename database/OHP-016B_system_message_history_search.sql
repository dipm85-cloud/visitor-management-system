-- ============================================================
-- Operations Hub - OHP-016B System Message History Search
--
-- Purpose:
-- - Add advanced admin history search for system messages.
-- - Add acknowledgement/action detail for selected messages.
-- - Keep OHP-016/OHP-016A messaging behaviour unchanged.
--
-- Safety:
-- - No chat.
-- - No replies.
-- - No user-to-user messaging.
-- - No impersonation.
-- - History access remains capability-gated.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Advanced message history search
-- ------------------------------------------------------------

create or replace function public.list_admin_system_message_history_v2(
  p_sent_from timestamptz default null,
  p_sent_to timestamptz default null,
  p_target_scope text default null,
  p_message_type text default null,
  p_message_mode text default 'all',
  p_ack_filter text default 'all',
  p_action_filter text default null,
  p_search_text text default null,
  p_limit integer default 100,
  p_offset integer default 0
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
  auto_completed_count integer,
  expected_recipient_count integer,
  delivery_status text,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_target_scope text := nullif(lower(trim(coalesce(p_target_scope, ''))), '');
  v_message_type text := nullif(lower(trim(coalesce(p_message_type, ''))), '');
  v_message_mode text := lower(trim(coalesce(p_message_mode, 'all')));
  v_ack_filter text := lower(trim(coalesce(p_ack_filter, 'all')));
  v_action_filter text := nullif(lower(trim(coalesce(p_action_filter, ''))), '');
begin
  if not public.can_view_admin_system_messages() then
    raise exception 'You do not have permission to view system message history';
  end if;

  if v_message_mode not in ('all', 'advisory', 'required', 'forced') then
    raise exception 'Invalid message mode filter';
  end if;

  if v_ack_filter not in (
    'all',
    'none',
    'any',
    'action_completed',
    'auto_completed',
    'overdue_forced'
  ) then
    raise exception 'Invalid acknowledgement filter';
  end if;

  return query
  with message_base as (
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
      coalesce(ack_counts.auto_completed_count, 0)::integer as auto_completed_count,
      case
        when (m.metadata ->> 'recipient_count') ~ '^[0-9]+$'
          then (m.metadata ->> 'recipient_count')::integer
        when (m.metadata ->> 'expected_recipient_count') ~ '^[0-9]+$'
          then (m.metadata ->> 'expected_recipient_count')::integer
        else null
      end as expected_recipient_count
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
    where (p_sent_from is null or m.sent_at >= p_sent_from)
      and (p_sent_to is null or m.sent_at <= p_sent_to)
      and (
        v_target_scope is null
        or m.target_scope = v_target_scope
      )
      and (
        v_message_type is null
        or m.message_type = v_message_type
      )
      and (
        v_action_filter is null
        or lower(coalesce(m.required_action, m.action_hint, '')) = v_action_filter
      )
      and (
        p_search_text is null
        or trim(p_search_text) = ''
        or (
          coalesce(m.title, '') || ' ' ||
          coalesce(m.body, '') || ' ' ||
          coalesce(m.message_type, '') || ' ' ||
          coalesce(m.target_scope, '') || ' ' ||
          coalesce(m.required_action, '') || ' ' ||
          coalesce(m.action_hint, '') || ' ' ||
          coalesce(tp.display_name, '') || ' ' ||
          coalesce(sp.display_name, '') || ' ' ||
          m.id::text
        ) ilike '%' || p_search_text || '%'
      )
  ),
  classified as (
    select
      mb.*,
      case
        when mb.force_after_grace is true
          and mb.required_action_deadline_at is not null
          and mb.required_action_deadline_at < now()
          and (mb.action_completed_count + mb.auto_completed_count) = 0
          then 'overdue_forced'
        when mb.auto_completed_count > 0
          then 'auto_completed'
        when mb.action_completed_count > 0
          then 'action_completed'
        when mb.acknowledgement_count > 0
          then 'acknowledged'
        when mb.expires_at is not null and mb.expires_at < now()
          then 'expired'
        else 'sent'
      end as delivery_status
    from message_base mb
    where (
      v_message_mode = 'all'
      or (v_message_mode = 'advisory' and mb.requires_action is false)
      or (v_message_mode = 'required' and mb.requires_action is true)
      or (v_message_mode = 'forced' and mb.force_after_grace is true)
    )
  ),
  filtered as (
    select *
    from classified c
    where (
      v_ack_filter = 'all'
      or (v_ack_filter = 'none' and c.acknowledgement_count = 0)
      or (v_ack_filter = 'any' and c.acknowledgement_count > 0)
      or (v_ack_filter = 'action_completed' and c.action_completed_count > 0)
      or (v_ack_filter = 'auto_completed' and c.auto_completed_count > 0)
      or (v_ack_filter = 'overdue_forced' and c.delivery_status = 'overdue_forced')
    )
  )
  select
    f.message_id,
    f.target_scope,
    f.target_profile_id,
    f.target_display_name,
    f.message_type,
    f.title,
    f.body,
    f.action_hint,
    f.requires_action,
    f.required_action,
    f.force_after_grace,
    f.required_action_deadline_at,
    f.expires_at,
    f.sent_by,
    f.sent_by_name,
    f.sent_at,
    f.acknowledgement_count,
    f.action_completed_count,
    f.auto_completed_count,
    f.expected_recipient_count,
    f.delivery_status,
    count(*) over() as total_count
  from filtered f
  order by f.sent_at desc
  limit v_limit
  offset v_offset;
end;
$$;

grant execute on function public.list_admin_system_message_history_v2(
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer
) to authenticated;

-- ------------------------------------------------------------
-- 2. Message acknowledgement/action detail
-- ------------------------------------------------------------

create or replace function public.list_admin_system_message_acknowledgement_detail(
  p_message_id uuid
)
returns table (
  acknowledgement_id uuid,
  message_id uuid,
  profile_id uuid,
  display_name text,
  session_key text,
  acknowledged_at timestamptz,
  acknowledgement_type text,
  action_taken text,
  action_completed_at timestamptz,
  auto_completed boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_admin_system_messages() then
    raise exception 'You do not have permission to view system message acknowledgement detail';
  end if;

  if p_message_id is null then
    raise exception 'Message is required';
  end if;

  return query
  select
    a.id as acknowledgement_id,
    a.message_id,
    a.profile_id,
    p.display_name,
    a.session_key,
    a.acknowledged_at,
    a.acknowledgement_type,
    a.action_taken,
    a.action_completed_at,
    coalesce(a.auto_completed, false) as auto_completed
  from public.admin_system_message_acknowledgements a
  left join public.profiles p
    on p.id = a.profile_id
  where a.message_id = p_message_id
  order by a.acknowledged_at desc, p.display_name asc;
end;
$$;

grant execute on function public.list_admin_system_message_acknowledgement_detail(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. Verification
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

select
  'OHP-016B system message history search installed' as result;