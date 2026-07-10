-- ============================================================
-- Operations Hub - OHP-007A Identity Review Request Flow
--
-- Adds a request-level identity review workflow.
--
-- Design:
-- - identity_resolution.request can raise review requests.
-- - identity_resolution.manage can decide/close/review.
-- - Requests may optionally create a pending candidate when both
--   source records are known.
-- - Source records are never modified.
--
-- Safety:
-- - Does NOT merge records.
-- - Does NOT rewrite source history.
-- - Does NOT anonymise records.
-- - Does NOT erase records.
-- - Does NOT auto-link identities.
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
  'identity_resolution',
  'Identity Resolution',
  'Review and manage possible identity matches across platform records.',
  150,
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
      'identity_resolution.request',
      'Request identity review',
      'Allows authorised users to request an identity review without approving identity links.'
    )
) as c(capability_code, capability_name, capability_description)
where cg.group_code = 'identity_resolution'
on conflict (capability_code) do update
set
  capability_name = excluded.capability_name,
  group_id = excluded.group_id,
  description = excluded.description,
  active = true;

-- SuperUser gets request capability by default.
-- Security/General User do not get it by SQL default.
-- They can receive it later via custom role presets.
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
    'identity_resolution.request'
  )
on conflict do nothing;

-- ------------------------------------------------------------
-- 2. Helper functions
-- ------------------------------------------------------------

create or replace function public.normalise_identity_request_status(p_status text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(p_status, ''))) in ('', 'pending', 'new', 'open') then 'pending'
    when lower(trim(coalesce(p_status, ''))) in ('in_review', 'review', 'reviewing') then 'in_review'
    when lower(trim(coalesce(p_status, ''))) in ('candidate_created', 'candidate', 'converted') then 'candidate_created'
    when lower(trim(coalesce(p_status, ''))) in ('closed', 'complete', 'completed', 'resolved') then 'closed'
    when lower(trim(coalesce(p_status, ''))) in ('cancelled', 'canceled') then 'cancelled'
    else 'pending'
  end;
$$;

create or replace function public.can_request_identity_resolution()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('identity_resolution.request')
      or public.user_has_capability('identity_resolution.manage')
      or public.user_has_capability('privacy.case.manage')
      or public.user_has_capability('privacy.manage')
      or public.user_has_capability('gdpr.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.edit')
    );
$$;

grant execute on function public.normalise_identity_request_status(text) to authenticated;
grant execute on function public.can_request_identity_resolution() to authenticated;

-- ------------------------------------------------------------
-- 3. Request table
-- ------------------------------------------------------------

create table if not exists public.identity_resolution_requests (
  id uuid primary key default gen_random_uuid(),

  request_reference text not null unique default (
    'IRR-' ||
    to_char(now(), 'YYYYMMDD') ||
    '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),

  candidate_type text not null default 'person',
  status text not null default 'pending',

  request_reason text not null,
  requester_notes text,

  source_type text not null,
  source_record_id text not null,
  source_label text,
  source_summary jsonb not null default '{}'::jsonb,

  suggested_match_type text,
  suggested_match_record_id text,
  suggested_match_label text,
  suggested_match_summary jsonb not null default '{}'::jsonb,

  context_type text,
  context_record_id text,
  context_summary jsonb not null default '{}'::jsonb,

  candidate_id uuid references public.identity_resolution_candidates(id) on delete set null,

  review_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,

  created_by uuid default auth.uid(),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint identity_resolution_requests_candidate_type_check
  check (candidate_type in ('person', 'organisation', 'vehicle', 'email', 'other')),

  constraint identity_resolution_requests_status_check
  check (status in ('pending', 'in_review', 'candidate_created', 'closed', 'cancelled')),

  constraint identity_resolution_requests_suggested_pair_check
  check (
    (
      suggested_match_type is null
      and suggested_match_record_id is null
    )
    or
    (
      suggested_match_type is not null
      and suggested_match_record_id is not null
    )
  )
);

create index if not exists idx_identity_resolution_requests_status
on public.identity_resolution_requests(status);

create index if not exists idx_identity_resolution_requests_candidate_type
on public.identity_resolution_requests(candidate_type);

create index if not exists idx_identity_resolution_requests_created
on public.identity_resolution_requests(created_at desc);

create index if not exists idx_identity_resolution_requests_created_by
on public.identity_resolution_requests(created_by);

create index if not exists idx_identity_resolution_requests_source
on public.identity_resolution_requests(source_type, source_record_id);

create index if not exists idx_identity_resolution_requests_candidate
on public.identity_resolution_requests(candidate_id);

create index if not exists idx_identity_resolution_requests_search
on public.identity_resolution_requests using gin (
  to_tsvector(
    'simple',
    coalesce(request_reference, '') || ' ' ||
    coalesce(candidate_type, '') || ' ' ||
    coalesce(status, '') || ' ' ||
    coalesce(request_reason, '') || ' ' ||
    coalesce(requester_notes, '') || ' ' ||
    coalesce(source_type, '') || ' ' ||
    coalesce(source_record_id, '') || ' ' ||
    coalesce(source_label, '') || ' ' ||
    coalesce(suggested_match_type, '') || ' ' ||
    coalesce(suggested_match_record_id, '') || ' ' ||
    coalesce(suggested_match_label, '') || ' ' ||
    coalesce(context_type, '') || ' ' ||
    coalesce(context_record_id, '') || ' ' ||
    coalesce(review_notes, '')
  )
);

-- ------------------------------------------------------------
-- 4. Updated-at trigger
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

drop trigger if exists trg_identity_resolution_requests_updated_at on public.identity_resolution_requests;

create trigger trg_identity_resolution_requests_updated_at
before update on public.identity_resolution_requests
for each row
execute function public.oh_set_updated_at();

-- ------------------------------------------------------------
-- 5. RLS
-- ------------------------------------------------------------

alter table public.identity_resolution_requests enable row level security;

drop policy if exists "identity review requests can be viewed by authorised users" on public.identity_resolution_requests;
drop policy if exists "identity review requests can be created by authorised users" on public.identity_resolution_requests;
drop policy if exists "identity review requests can be updated by authorised users" on public.identity_resolution_requests;

create policy "identity review requests can be viewed by authorised users"
on public.identity_resolution_requests
for select
to authenticated
using (
  public.can_view_identity_resolution()
  or created_by = auth.uid()
);

create policy "identity review requests can be created by authorised users"
on public.identity_resolution_requests
for insert
to authenticated
with check (public.can_request_identity_resolution());

create policy "identity review requests can be updated by authorised users"
on public.identity_resolution_requests
for update
to authenticated
using (public.can_manage_identity_resolution())
with check (public.can_manage_identity_resolution());

grant select, insert, update on public.identity_resolution_requests to authenticated;

-- ------------------------------------------------------------
-- 6. RPC: list requests
-- ------------------------------------------------------------

create or replace function public.list_identity_resolution_requests(
  p_status text default null,
  p_candidate_type text default null,
  p_search_text text default null,
  p_limit integer default 100
)
returns setof public.identity_resolution_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := case
    when p_status is null or trim(p_status) = '' or lower(trim(p_status)) = 'all' then null
    else public.normalise_identity_request_status(p_status)
  end;
  v_candidate_type text := case
    when p_candidate_type is null or trim(p_candidate_type) = '' or lower(trim(p_candidate_type)) = 'all' then null
    else public.normalise_identity_candidate_type(p_candidate_type)
  end;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  if not public.can_view_identity_resolution()
     and not public.can_request_identity_resolution()
  then
    raise exception 'You do not have permission to view identity review requests';
  end if;

  return query
  select r.*
  from public.identity_resolution_requests r
  where (
      public.can_view_identity_resolution()
      or r.created_by = auth.uid()
    )
    and (v_status is null or r.status = v_status)
    and (v_candidate_type is null or r.candidate_type = v_candidate_type)
    and (
      p_search_text is null
      or trim(p_search_text) = ''
      or (
        coalesce(r.request_reference, '') || ' ' ||
        coalesce(r.candidate_type, '') || ' ' ||
        coalesce(r.status, '') || ' ' ||
        coalesce(r.request_reason, '') || ' ' ||
        coalesce(r.requester_notes, '') || ' ' ||
        coalesce(r.source_type, '') || ' ' ||
        coalesce(r.source_record_id, '') || ' ' ||
        coalesce(r.source_label, '') || ' ' ||
        coalesce(r.suggested_match_type, '') || ' ' ||
        coalesce(r.suggested_match_record_id, '') || ' ' ||
        coalesce(r.suggested_match_label, '') || ' ' ||
        coalesce(r.context_type, '') || ' ' ||
        coalesce(r.context_record_id, '') || ' ' ||
        coalesce(r.review_notes, '')
      ) ilike '%' || p_search_text || '%'
    )
  order by
    case r.status
      when 'pending' then 1
      when 'in_review' then 2
      when 'candidate_created' then 3
      when 'closed' then 4
      when 'cancelled' then 5
      else 9
    end,
    r.created_at desc
  limit v_limit;
end;
$$;

-- ------------------------------------------------------------
-- 7. RPC: get request
-- ------------------------------------------------------------

create or replace function public.get_identity_resolution_request(
  p_request_id uuid
)
returns public.identity_resolution_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.identity_resolution_requests;
begin
  if not public.can_view_identity_resolution()
     and not public.can_request_identity_resolution()
  then
    raise exception 'You do not have permission to view identity review requests';
  end if;

  select *
  into v_request
  from public.identity_resolution_requests
  where id = p_request_id
    and (
      public.can_view_identity_resolution()
      or created_by = auth.uid()
    );

  if not found then
    raise exception 'Identity review request not found';
  end if;

  return v_request;
end;
$$;

-- ------------------------------------------------------------
-- 8. RPC: create request
-- ------------------------------------------------------------

create or replace function public.create_identity_resolution_request(
  p_candidate_type text default 'person',
  p_request_reason text default null,
  p_requester_notes text default null,
  p_source_type text default null,
  p_source_record_id text default null,
  p_source_label text default null,
  p_source_summary jsonb default '{}'::jsonb,
  p_suggested_match_type text default null,
  p_suggested_match_record_id text default null,
  p_suggested_match_label text default null,
  p_suggested_match_summary jsonb default '{}'::jsonb,
  p_context_type text default null,
  p_context_record_id text default null,
  p_context_summary jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns public.identity_resolution_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_type text := public.normalise_identity_candidate_type(p_candidate_type);
  v_request public.identity_resolution_requests;
  v_candidate public.identity_resolution_candidates;
  v_has_suggested_match boolean;
begin
  if not public.can_request_identity_resolution() then
    raise exception 'You do not have permission to request identity review';
  end if;

  if nullif(trim(coalesce(p_request_reason, '')), '') is null then
    raise exception 'Request reason is required';
  end if;

  if nullif(trim(coalesce(p_source_type, '')), '') is null
    or nullif(trim(coalesce(p_source_record_id, '')), '') is null
  then
    raise exception 'Source record is required';
  end if;

  v_has_suggested_match :=
    nullif(trim(coalesce(p_suggested_match_type, '')), '') is not null
    or nullif(trim(coalesce(p_suggested_match_record_id, '')), '') is not null;

  if v_has_suggested_match then
    if nullif(trim(coalesce(p_suggested_match_type, '')), '') is null
      or nullif(trim(coalesce(p_suggested_match_record_id, '')), '') is null
    then
      raise exception 'Suggested match source type and record ID are both required when a suggested match is provided';
    end if;

    if lower(trim(p_source_type)) = lower(trim(p_suggested_match_type))
      and trim(p_source_record_id) = trim(p_suggested_match_record_id)
    then
      raise exception 'Source record and suggested match record must be different';
    end if;
  end if;

  insert into public.identity_resolution_requests (
    candidate_type,
    status,
    request_reason,
    requester_notes,
    source_type,
    source_record_id,
    source_label,
    source_summary,
    suggested_match_type,
    suggested_match_record_id,
    suggested_match_label,
    suggested_match_summary,
    context_type,
    context_record_id,
    context_summary,
    metadata,
    created_by,
    updated_by
  )
  values (
    v_candidate_type,
    case when v_has_suggested_match then 'candidate_created' else 'pending' end,
    nullif(trim(coalesce(p_request_reason, '')), ''),
    nullif(trim(coalesce(p_requester_notes, '')), ''),
    nullif(trim(coalesce(p_source_type, '')), ''),
    nullif(trim(coalesce(p_source_record_id, '')), ''),
    nullif(trim(coalesce(p_source_label, '')), ''),
    coalesce(p_source_summary, '{}'::jsonb),
    nullif(trim(coalesce(p_suggested_match_type, '')), ''),
    nullif(trim(coalesce(p_suggested_match_record_id, '')), ''),
    nullif(trim(coalesce(p_suggested_match_label, '')), ''),
    coalesce(p_suggested_match_summary, '{}'::jsonb),
    nullif(trim(coalesce(p_context_type, '')), ''),
    nullif(trim(coalesce(p_context_record_id, '')), ''),
    coalesce(p_context_summary, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb),
    auth.uid(),
    auth.uid()
  )
  returning *
  into v_request;

  if v_has_suggested_match then
    insert into public.identity_resolution_candidates (
      candidate_type,
      status,
      confidence_score,
      match_reason,
      suggested_by,
      source_a_type,
      source_a_record_id,
      source_a_label,
      source_a_summary,
      source_b_type,
      source_b_record_id,
      source_b_label,
      source_b_summary,
      metadata,
      created_by,
      updated_by
    )
    values (
      v_candidate_type,
      'pending',
      null,
      nullif(trim(coalesce(p_request_reason, '')), ''),
      'request',
      nullif(trim(coalesce(p_source_type, '')), ''),
      nullif(trim(coalesce(p_source_record_id, '')), ''),
      nullif(trim(coalesce(p_source_label, '')), ''),
      coalesce(p_source_summary, '{}'::jsonb),
      nullif(trim(coalesce(p_suggested_match_type, '')), ''),
      nullif(trim(coalesce(p_suggested_match_record_id, '')), ''),
      nullif(trim(coalesce(p_suggested_match_label, '')), ''),
      coalesce(p_suggested_match_summary, '{}'::jsonb),
      jsonb_build_object(
        'identity_resolution_request_id', v_request.id,
        'identity_resolution_request_reference', v_request.request_reference,
        'request_metadata', coalesce(p_metadata, '{}'::jsonb)
      ),
      auth.uid(),
      auth.uid()
    )
    returning *
    into v_candidate;

    update public.identity_resolution_requests
    set
      candidate_id = v_candidate.id,
      updated_by = auth.uid()
    where id = v_request.id
    returning *
    into v_request;
  end if;

  begin
    perform public.write_audit_event(
      'identity_resolution.request_created',
      'identity_resolution_requests',
      v_request.id::text,
      jsonb_build_object(
        'summary', 'Identity review request created.',
        'request_reference', v_request.request_reference,
        'candidate_type', v_request.candidate_type,
        'status', v_request.status,
        'candidate_id', case when v_request.candidate_id is null then null else v_request.candidate_id::text end
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during identity review request create: %', sqlerrm;
  end;

  return v_request;
end;
$$;

-- ------------------------------------------------------------
-- 9. RPC: update request status
-- ------------------------------------------------------------

create or replace function public.update_identity_resolution_request_status(
  p_request_id uuid,
  p_status text default 'in_review',
  p_review_notes text default null,
  p_candidate_id uuid default null
)
returns public.identity_resolution_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.identity_resolution_requests;
  v_after public.identity_resolution_requests;
  v_status text := public.normalise_identity_request_status(p_status);
begin
  if not public.can_manage_identity_resolution() then
    raise exception 'You do not have permission to update identity review requests';
  end if;

  select *
  into v_before
  from public.identity_resolution_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Identity review request not found';
  end if;

  if p_candidate_id is not null
    and not exists (
      select 1
      from public.identity_resolution_candidates
      where id = p_candidate_id
    )
  then
    raise exception 'Candidate not found';
  end if;

  update public.identity_resolution_requests
  set
    status = v_status,
    review_notes = case
      when p_review_notes is null then review_notes
      else nullif(trim(p_review_notes), '')
    end,
    candidate_id = coalesce(p_candidate_id, candidate_id),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_by = auth.uid()
  where id = p_request_id
  returning *
  into v_after;

  begin
    perform public.write_audit_event(
      'identity_resolution.request_updated',
      'identity_resolution_requests',
      v_after.id::text,
      jsonb_build_object(
        'summary', 'Identity review request updated.',
        'request_reference', v_after.request_reference,
        'old_status', v_before.status,
        'new_status', v_after.status
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during identity review request update: %', sqlerrm;
  end;

  return v_after;
end;
$$;

-- ------------------------------------------------------------
-- 10. Grants
-- ------------------------------------------------------------

grant execute on function public.list_identity_resolution_requests(text, text, text, integer) to authenticated;
grant execute on function public.get_identity_resolution_request(uuid) to authenticated;
grant execute on function public.create_identity_resolution_request(
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  jsonb,
  jsonb
) to authenticated;
grant execute on function public.update_identity_resolution_request_status(uuid, text, text, uuid) to authenticated;

-- Ask PostgREST/Supabase API to reload its schema cache.
notify pgrst, 'reload schema';

select 'OHP-007A identity review request flow installed' as result;