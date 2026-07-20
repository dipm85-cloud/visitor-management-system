-- ============================================================
-- Operations Hub - OHP-007 Identity Resolution Queue Foundation
-- Creates platform identity resolution capabilities, candidate
-- queue tables, decision history, confirmed identity links,
-- RLS policies, permission helpers and RPCs.
--
-- Safety:
-- This does NOT merge source records.
-- This does NOT anonymise records.
-- This does NOT rewrite visitor/document/privacy history.
-- It only stores review candidates, decisions and link metadata.
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
      'identity_resolution.view',
      'View identity resolution queue',
      'Allows authorised users to view possible identity match candidates and confirmed identity links.'
    ),
    (
      'identity_resolution.manage',
      'Manage identity resolution queue',
      'Allows authorised users to create, confirm, reject, defer or ignore identity resolution candidates.'
    )
) as c(capability_code, capability_name, capability_description)
where cg.group_code = 'identity_resolution'
on conflict (capability_code) do update
set
  capability_name = excluded.capability_name,
  group_id = excluded.group_id,
  description = excluded.description,
  active = true;

-- SuperUser gets both identity resolution capabilities by default.
-- Security and General User do not get them by default.
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
    'identity_resolution.view',
    'identity_resolution.manage'
  )
on conflict do nothing;

-- ------------------------------------------------------------
-- 2. Normalisation helpers
-- ------------------------------------------------------------

create or replace function public.normalise_identity_candidate_type(p_candidate_type text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(p_candidate_type, ''))) in ('', 'person', 'visitor', 'employee', 'contractor') then 'person'
    when lower(trim(coalesce(p_candidate_type, ''))) in ('organisation', 'organization', 'company', 'business') then 'organisation'
    when lower(trim(coalesce(p_candidate_type, ''))) in ('vehicle', 'car', 'registration', 'license_plate', 'licence_plate') then 'vehicle'
    when lower(trim(coalesce(p_candidate_type, ''))) in ('email', 'email_address') then 'email'
    else 'other'
  end;
$$;

create or replace function public.normalise_identity_candidate_status(p_status text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(p_status, ''))) in ('', 'pending', 'new', 'open') then 'pending'
    when lower(trim(coalesce(p_status, ''))) in ('confirmed', 'confirm', 'linked', 'accepted') then 'confirmed'
    when lower(trim(coalesce(p_status, ''))) in ('rejected', 'reject', 'not_match', 'not_a_match') then 'rejected'
    when lower(trim(coalesce(p_status, ''))) in ('deferred', 'defer', 'later', 'hold') then 'deferred'
    when lower(trim(coalesce(p_status, ''))) in ('ignored', 'ignore', 'dismissed') then 'ignored'
    else 'pending'
  end;
$$;

create or replace function public.normalise_identity_decision_type(p_decision_type text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(p_decision_type, ''))) in ('confirmed', 'confirm', 'confirm_link', 'linked', 'accepted') then 'confirmed'
    when lower(trim(coalesce(p_decision_type, ''))) in ('rejected', 'reject', 'not_match', 'not_a_match') then 'rejected'
    when lower(trim(coalesce(p_decision_type, ''))) in ('deferred', 'defer', 'later', 'hold') then 'deferred'
    when lower(trim(coalesce(p_decision_type, ''))) in ('ignored', 'ignore', 'dismissed') then 'ignored'
    else 'deferred'
  end;
$$;

grant execute on function public.normalise_identity_candidate_type(text) to authenticated;
grant execute on function public.normalise_identity_candidate_status(text) to authenticated;
grant execute on function public.normalise_identity_decision_type(text) to authenticated;

-- ------------------------------------------------------------
-- 3. Tables
-- ------------------------------------------------------------

create table if not exists public.identity_resolution_candidates (
  id uuid primary key default gen_random_uuid(),

  candidate_reference text not null unique default (
    'IR-' ||
    to_char(now(), 'YYYYMMDD') ||
    '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),

  candidate_type text not null default 'person',
  status text not null default 'pending',

  confidence_score numeric(5,2),
  match_reason text,
  suggested_by text not null default 'manual',
  suggested_at timestamptz not null default now(),

  source_a_type text not null,
  source_a_record_id text not null,
  source_a_label text,
  source_a_summary jsonb not null default '{}'::jsonb,

  source_b_type text not null,
  source_b_record_id text not null,
  source_b_label text,
  source_b_summary jsonb not null default '{}'::jsonb,

  decision_type text,
  decision_reason text,
  decided_by uuid,
  decided_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,

  created_by uuid default auth.uid(),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint identity_resolution_candidates_candidate_type_check
  check (candidate_type in ('person', 'organisation', 'vehicle', 'email', 'other')),

  constraint identity_resolution_candidates_status_check
  check (status in ('pending', 'confirmed', 'rejected', 'deferred', 'ignored')),

  constraint identity_resolution_candidates_confidence_score_check
  check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 100)),

  constraint identity_resolution_candidates_decision_type_check
  check (decision_type is null or decision_type in ('confirmed', 'rejected', 'deferred', 'ignored')),

  constraint identity_resolution_candidates_different_sources_check
  check (
    source_a_type <> source_b_type
    or source_a_record_id <> source_b_record_id
  )
);

create table if not exists public.identity_links (
  id uuid primary key default gen_random_uuid(),

  link_reference text not null unique default (
    'IL-' ||
    to_char(now(), 'YYYYMMDD') ||
    '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),

  identity_type text not null default 'person',
  link_status text not null default 'active',
  canonical_label text,
  link_reason text,

  created_from_candidate_id uuid references public.identity_resolution_candidates(id) on delete set null,

  metadata jsonb not null default '{}'::jsonb,

  created_by uuid default auth.uid(),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint identity_links_identity_type_check
  check (identity_type in ('person', 'organisation', 'vehicle', 'email', 'other')),

  constraint identity_links_link_status_check
  check (link_status in ('active', 'revoked'))
);

create table if not exists public.identity_link_records (
  id uuid primary key default gen_random_uuid(),

  identity_link_id uuid not null references public.identity_links(id) on delete cascade,

  source_type text not null,
  source_record_id text not null,
  source_label text,
  source_summary jsonb not null default '{}'::jsonb,

  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),

  constraint identity_link_records_unique_source_per_link
  unique (identity_link_id, source_type, source_record_id)
);

create table if not exists public.identity_resolution_decisions (
  id uuid primary key default gen_random_uuid(),

  candidate_id uuid not null references public.identity_resolution_candidates(id) on delete cascade,
  identity_link_id uuid references public.identity_links(id) on delete set null,

  decision_type text not null,
  decision_reason text,
  decision_details jsonb not null default '{}'::jsonb,

  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),

  constraint identity_resolution_decisions_decision_type_check
  check (decision_type in ('confirmed', 'rejected', 'deferred', 'ignored'))
);

-- ------------------------------------------------------------
-- 4. Indexes
-- ------------------------------------------------------------

create index if not exists idx_identity_resolution_candidates_status
on public.identity_resolution_candidates(status);

create index if not exists idx_identity_resolution_candidates_type
on public.identity_resolution_candidates(candidate_type);

create index if not exists idx_identity_resolution_candidates_created
on public.identity_resolution_candidates(created_at desc);

create index if not exists idx_identity_resolution_candidates_source_a
on public.identity_resolution_candidates(source_a_type, source_a_record_id);

create index if not exists idx_identity_resolution_candidates_source_b
on public.identity_resolution_candidates(source_b_type, source_b_record_id);

create index if not exists idx_identity_resolution_candidates_search
on public.identity_resolution_candidates using gin (
  to_tsvector(
    'simple',
    coalesce(candidate_reference, '') || ' ' ||
    coalesce(candidate_type, '') || ' ' ||
    coalesce(status, '') || ' ' ||
    coalesce(match_reason, '') || ' ' ||
    coalesce(source_a_type, '') || ' ' ||
    coalesce(source_a_record_id, '') || ' ' ||
    coalesce(source_a_label, '') || ' ' ||
    coalesce(source_b_type, '') || ' ' ||
    coalesce(source_b_record_id, '') || ' ' ||
    coalesce(source_b_label, '') || ' ' ||
    coalesce(decision_reason, '')
  )
);

create index if not exists idx_identity_links_type_status
on public.identity_links(identity_type, link_status);

create index if not exists idx_identity_links_created
on public.identity_links(created_at desc);

create index if not exists idx_identity_link_records_link
on public.identity_link_records(identity_link_id);

create index if not exists idx_identity_link_records_source
on public.identity_link_records(source_type, source_record_id);

create index if not exists idx_identity_resolution_decisions_candidate
on public.identity_resolution_decisions(candidate_id, created_at desc);

create index if not exists idx_identity_resolution_decisions_link
on public.identity_resolution_decisions(identity_link_id);

-- ------------------------------------------------------------
-- 5. Updated-at helper
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

drop trigger if exists trg_identity_resolution_candidates_updated_at on public.identity_resolution_candidates;

create trigger trg_identity_resolution_candidates_updated_at
before update on public.identity_resolution_candidates
for each row
execute function public.oh_set_updated_at();

drop trigger if exists trg_identity_links_updated_at on public.identity_links;

create trigger trg_identity_links_updated_at
before update on public.identity_links
for each row
execute function public.oh_set_updated_at();

-- ------------------------------------------------------------
-- 6. Permission helpers
-- ------------------------------------------------------------

create or replace function public.can_view_identity_resolution()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('identity_resolution.view')
      or public.user_has_capability('identity_resolution.manage')
      or public.user_has_capability('privacy.case.view')
      or public.user_has_capability('privacy.case.manage')
      or public.user_has_capability('privacy.manage')
      or public.user_has_capability('gdpr.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.view')
    );
$$;

create or replace function public.can_manage_identity_resolution()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_has_capability('identity_resolution.manage')
      or public.user_has_capability('privacy.case.manage')
      or public.user_has_capability('privacy.manage')
      or public.user_has_capability('gdpr.manage')
      or public.user_has_capability('module_configuration.manage')
      or public.user_has_capability('settings.edit')
    );
$$;

grant execute on function public.can_view_identity_resolution() to authenticated;
grant execute on function public.can_manage_identity_resolution() to authenticated;

-- ------------------------------------------------------------
-- 7. RLS
-- ------------------------------------------------------------

alter table public.identity_resolution_candidates enable row level security;
alter table public.identity_links enable row level security;
alter table public.identity_link_records enable row level security;
alter table public.identity_resolution_decisions enable row level security;

drop policy if exists "identity candidates can be viewed by authorised users" on public.identity_resolution_candidates;
drop policy if exists "identity candidates can be created by authorised users" on public.identity_resolution_candidates;
drop policy if exists "identity candidates can be updated by authorised users" on public.identity_resolution_candidates;

create policy "identity candidates can be viewed by authorised users"
on public.identity_resolution_candidates
for select
to authenticated
using (public.can_view_identity_resolution());

create policy "identity candidates can be created by authorised users"
on public.identity_resolution_candidates
for insert
to authenticated
with check (public.can_manage_identity_resolution());

create policy "identity candidates can be updated by authorised users"
on public.identity_resolution_candidates
for update
to authenticated
using (public.can_manage_identity_resolution())
with check (public.can_manage_identity_resolution());

drop policy if exists "identity links can be viewed by authorised users" on public.identity_links;
drop policy if exists "identity links can be created by authorised users" on public.identity_links;
drop policy if exists "identity links can be updated by authorised users" on public.identity_links;

create policy "identity links can be viewed by authorised users"
on public.identity_links
for select
to authenticated
using (public.can_view_identity_resolution());

create policy "identity links can be created by authorised users"
on public.identity_links
for insert
to authenticated
with check (public.can_manage_identity_resolution());

create policy "identity links can be updated by authorised users"
on public.identity_links
for update
to authenticated
using (public.can_manage_identity_resolution())
with check (public.can_manage_identity_resolution());

drop policy if exists "identity link records can be viewed by authorised users" on public.identity_link_records;
drop policy if exists "identity link records can be created by authorised users" on public.identity_link_records;

create policy "identity link records can be viewed by authorised users"
on public.identity_link_records
for select
to authenticated
using (public.can_view_identity_resolution());

create policy "identity link records can be created by authorised users"
on public.identity_link_records
for insert
to authenticated
with check (public.can_manage_identity_resolution());

drop policy if exists "identity decisions can be viewed by authorised users" on public.identity_resolution_decisions;
drop policy if exists "identity decisions can be created by authorised users" on public.identity_resolution_decisions;

create policy "identity decisions can be viewed by authorised users"
on public.identity_resolution_decisions
for select
to authenticated
using (public.can_view_identity_resolution());

create policy "identity decisions can be created by authorised users"
on public.identity_resolution_decisions
for insert
to authenticated
with check (public.can_manage_identity_resolution());

grant select, insert, update on public.identity_resolution_candidates to authenticated;
grant select, insert, update on public.identity_links to authenticated;
grant select, insert on public.identity_link_records to authenticated;
grant select, insert on public.identity_resolution_decisions to authenticated;

-- ------------------------------------------------------------
-- 8. RPCs
-- ------------------------------------------------------------

create or replace function public.list_identity_resolution_candidates(
  p_status text default null,
  p_candidate_type text default null,
  p_search_text text default null,
  p_limit integer default 100
)
returns setof public.identity_resolution_candidates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := case
    when p_status is null or trim(p_status) = '' or lower(trim(p_status)) = 'all' then null
    else public.normalise_identity_candidate_status(p_status)
  end;
  v_candidate_type text := case
    when p_candidate_type is null or trim(p_candidate_type) = '' or lower(trim(p_candidate_type)) = 'all' then null
    else public.normalise_identity_candidate_type(p_candidate_type)
  end;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  if not public.can_view_identity_resolution() then
    raise exception 'You do not have permission to view identity resolution candidates';
  end if;

  return query
  select c.*
  from public.identity_resolution_candidates c
  where (v_status is null or c.status = v_status)
    and (v_candidate_type is null or c.candidate_type = v_candidate_type)
    and (
      p_search_text is null
      or trim(p_search_text) = ''
      or (
        coalesce(c.candidate_reference, '') || ' ' ||
        coalesce(c.candidate_type, '') || ' ' ||
        coalesce(c.status, '') || ' ' ||
        coalesce(c.match_reason, '') || ' ' ||
        coalesce(c.source_a_type, '') || ' ' ||
        coalesce(c.source_a_record_id, '') || ' ' ||
        coalesce(c.source_a_label, '') || ' ' ||
        coalesce(c.source_b_type, '') || ' ' ||
        coalesce(c.source_b_record_id, '') || ' ' ||
        coalesce(c.source_b_label, '') || ' ' ||
        coalesce(c.decision_reason, '')
      ) ilike '%' || p_search_text || '%'
    )
  order by
    case c.status
      when 'pending' then 1
      when 'deferred' then 2
      when 'confirmed' then 3
      when 'rejected' then 4
      when 'ignored' then 5
      else 9
    end,
    c.created_at desc
  limit v_limit;
end;
$$;

create or replace function public.get_identity_resolution_candidate(
  p_candidate_id uuid
)
returns public.identity_resolution_candidates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.identity_resolution_candidates;
begin
  if not public.can_view_identity_resolution() then
    raise exception 'You do not have permission to view identity resolution candidates';
  end if;

  select *
  into v_candidate
  from public.identity_resolution_candidates
  where id = p_candidate_id;

  if not found then
    raise exception 'Identity resolution candidate not found';
  end if;

  return v_candidate;
end;
$$;

create or replace function public.create_identity_resolution_candidate(
  p_candidate_type text default 'person',
  p_match_reason text default null,
  p_confidence_score numeric default null,
  p_source_a_type text default null,
  p_source_a_record_id text default null,
  p_source_a_label text default null,
  p_source_a_summary jsonb default '{}'::jsonb,
  p_source_b_type text default null,
  p_source_b_record_id text default null,
  p_source_b_label text default null,
  p_source_b_summary jsonb default '{}'::jsonb,
  p_suggested_by text default 'manual',
  p_metadata jsonb default '{}'::jsonb
)
returns public.identity_resolution_candidates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.identity_resolution_candidates;
  v_candidate_type text := public.normalise_identity_candidate_type(p_candidate_type);
begin
  if not public.can_manage_identity_resolution() then
    raise exception 'You do not have permission to create identity resolution candidates';
  end if;

  if nullif(trim(coalesce(p_source_a_type, '')), '') is null
    or nullif(trim(coalesce(p_source_a_record_id, '')), '') is null
    or nullif(trim(coalesce(p_source_b_type, '')), '') is null
    or nullif(trim(coalesce(p_source_b_record_id, '')), '') is null
  then
    raise exception 'Both source records are required to create an identity resolution candidate';
  end if;

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
    case
      when p_confidence_score is null then null
      else greatest(0, least(p_confidence_score, 100))
    end,
    nullif(trim(coalesce(p_match_reason, '')), ''),
    coalesce(nullif(trim(coalesce(p_suggested_by, '')), ''), 'manual'),
    nullif(trim(coalesce(p_source_a_type, '')), ''),
    nullif(trim(coalesce(p_source_a_record_id, '')), ''),
    nullif(trim(coalesce(p_source_a_label, '')), ''),
    coalesce(p_source_a_summary, '{}'::jsonb),
    nullif(trim(coalesce(p_source_b_type, '')), ''),
    nullif(trim(coalesce(p_source_b_record_id, '')), ''),
    nullif(trim(coalesce(p_source_b_label, '')), ''),
    coalesce(p_source_b_summary, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb),
    auth.uid(),
    auth.uid()
  )
  returning *
  into v_candidate;

  begin
    perform public.write_audit_event(
      'identity_resolution.candidate_created',
      'identity_resolution_candidates',
      v_candidate.id::text,
      jsonb_build_object(
        'summary', 'Identity resolution candidate created.',
        'candidate_reference', v_candidate.candidate_reference,
        'candidate_type', v_candidate.candidate_type,
        'status', v_candidate.status
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during identity candidate create: %', sqlerrm;
  end;

  return v_candidate;
end;
$$;

create or replace function public.decide_identity_resolution_candidate(
  p_candidate_id uuid,
  p_decision_type text default 'deferred',
  p_decision_reason text default null,
  p_canonical_label text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.identity_resolution_decisions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.identity_resolution_candidates;
  v_decision_type text := public.normalise_identity_decision_type(p_decision_type);
  v_link public.identity_links;
  v_decision public.identity_resolution_decisions;
begin
  if not public.can_manage_identity_resolution() then
    raise exception 'You do not have permission to decide identity resolution candidates';
  end if;

  select *
  into v_candidate
  from public.identity_resolution_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'Identity resolution candidate not found';
  end if;

  if v_decision_type = 'confirmed' then
    insert into public.identity_links (
      identity_type,
      link_status,
      canonical_label,
      link_reason,
      created_from_candidate_id,
      metadata,
      created_by,
      updated_by
    )
    values (
      v_candidate.candidate_type,
      'active',
      coalesce(
        nullif(trim(coalesce(p_canonical_label, '')), ''),
        nullif(trim(coalesce(v_candidate.source_a_label, '')), ''),
        nullif(trim(coalesce(v_candidate.source_b_label, '')), ''),
        v_candidate.candidate_reference
      ),
      nullif(trim(coalesce(p_decision_reason, '')), ''),
      v_candidate.id,
      coalesce(p_metadata, '{}'::jsonb),
      auth.uid(),
      auth.uid()
    )
    returning *
    into v_link;

    insert into public.identity_link_records (
      identity_link_id,
      source_type,
      source_record_id,
      source_label,
      source_summary,
      created_by
    )
    values (
      v_link.id,
      v_candidate.source_a_type,
      v_candidate.source_a_record_id,
      v_candidate.source_a_label,
      v_candidate.source_a_summary,
      auth.uid()
    )
    on conflict do nothing;

    insert into public.identity_link_records (
      identity_link_id,
      source_type,
      source_record_id,
      source_label,
      source_summary,
      created_by
    )
    values (
      v_link.id,
      v_candidate.source_b_type,
      v_candidate.source_b_record_id,
      v_candidate.source_b_label,
      v_candidate.source_b_summary,
      auth.uid()
    )
    on conflict do nothing;
  end if;

  update public.identity_resolution_candidates
  set
    status = v_decision_type,
    decision_type = v_decision_type,
    decision_reason = nullif(trim(coalesce(p_decision_reason, '')), ''),
    decided_by = auth.uid(),
    decided_at = now(),
    updated_by = auth.uid()
  where id = v_candidate.id;

  insert into public.identity_resolution_decisions (
    candidate_id,
    identity_link_id,
    decision_type,
    decision_reason,
    decision_details,
    created_by
  )
  values (
    v_candidate.id,
    case when v_decision_type = 'confirmed' then v_link.id else null end,
    v_decision_type,
    nullif(trim(coalesce(p_decision_reason, '')), ''),
    jsonb_build_object(
      'candidate_reference', v_candidate.candidate_reference,
      'candidate_type', v_candidate.candidate_type,
      'source_a_type', v_candidate.source_a_type,
      'source_a_record_id', v_candidate.source_a_record_id,
      'source_b_type', v_candidate.source_b_type,
      'source_b_record_id', v_candidate.source_b_record_id,
      'metadata', coalesce(p_metadata, '{}'::jsonb)
    ),
    auth.uid()
  )
  returning *
  into v_decision;

  begin
    perform public.write_audit_event(
      'identity_resolution.candidate_decided',
      'identity_resolution_candidates',
      v_candidate.id::text,
      jsonb_build_object(
        'summary', 'Identity resolution candidate decided.',
        'candidate_reference', v_candidate.candidate_reference,
        'decision_type', v_decision_type,
        'identity_link_id', case when v_decision_type = 'confirmed' then v_link.id::text else null end
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during identity candidate decision: %', sqlerrm;
  end;

  return v_decision;
end;
$$;

create or replace function public.list_identity_resolution_decisions(
  p_candidate_id uuid default null,
  p_identity_link_id uuid default null
)
returns setof public.identity_resolution_decisions
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_identity_resolution() then
    raise exception 'You do not have permission to view identity resolution decisions';
  end if;

  return query
  select d.*
  from public.identity_resolution_decisions d
  where (p_candidate_id is null or d.candidate_id = p_candidate_id)
    and (p_identity_link_id is null or d.identity_link_id = p_identity_link_id)
  order by d.created_at desc;
end;
$$;

create or replace function public.list_identity_links(
  p_identity_type text default null,
  p_search_text text default null,
  p_link_status text default null,
  p_limit integer default 100
)
returns setof public.identity_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_type text := case
    when p_identity_type is null or trim(p_identity_type) = '' or lower(trim(p_identity_type)) = 'all' then null
    else public.normalise_identity_candidate_type(p_identity_type)
  end;
  v_link_status text := case
    when p_link_status is null or trim(p_link_status) = '' or lower(trim(p_link_status)) = 'all' then null
    when lower(trim(p_link_status)) in ('active', 'revoked') then lower(trim(p_link_status))
    else 'active'
  end;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  if not public.can_view_identity_resolution() then
    raise exception 'You do not have permission to view identity links';
  end if;

  return query
  select l.*
  from public.identity_links l
  where (v_identity_type is null or l.identity_type = v_identity_type)
    and (v_link_status is null or l.link_status = v_link_status)
    and (
      p_search_text is null
      or trim(p_search_text) = ''
      or (
        coalesce(l.link_reference, '') || ' ' ||
        coalesce(l.identity_type, '') || ' ' ||
        coalesce(l.link_status, '') || ' ' ||
        coalesce(l.canonical_label, '') || ' ' ||
        coalesce(l.link_reason, '')
      ) ilike '%' || p_search_text || '%'
    )
  order by l.created_at desc
  limit v_limit;
end;
$$;

create or replace function public.list_identity_link_records(
  p_identity_link_id uuid
)
returns setof public.identity_link_records
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_identity_resolution() then
    raise exception 'You do not have permission to view identity link records';
  end if;

  return query
  select r.*
  from public.identity_link_records r
  where r.identity_link_id = p_identity_link_id
  order by r.created_at asc;
end;
$$;

grant execute on function public.list_identity_resolution_candidates(text, text, text, integer) to authenticated;
grant execute on function public.get_identity_resolution_candidate(uuid) to authenticated;
grant execute on function public.create_identity_resolution_candidate(text, text, numeric, text, text, text, jsonb, text, text, text, jsonb, text, jsonb) to authenticated;
grant execute on function public.decide_identity_resolution_candidate(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.list_identity_resolution_decisions(uuid, uuid) to authenticated;
grant execute on function public.list_identity_links(text, text, text, integer) to authenticated;
grant execute on function public.list_identity_link_records(uuid) to authenticated;

-- Ask PostgREST/Supabase API to reload its schema cache.
notify pgrst, 'reload schema';

select 'OHP-007 identity resolution queue foundation installed' as result;