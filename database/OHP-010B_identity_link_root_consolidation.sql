-- ============================================================
-- Operations Hub - OHP-010B
-- Identity Link Root Consolidation Patch
--
-- Purpose:
-- - Treat confirmed identity links as identity groups.
-- - Avoid endless pair-to-pair chains such as C -> B -> A.
-- - When confirming a candidate, attach new records to an existing
--   active identity link if either source is already linked.
-- - If two active links are connected by a newly confirmed candidate,
--   merge them into one active root link and revoke the secondary link.
-- - Resolve linked source records through the full active identity network.
--
-- Safety:
-- - Does NOT modify visitor records.
-- - Does NOT modify document evidence.
-- - Does NOT modify agreement evidence.
-- - Does NOT rewrite names/companies.
-- - Does NOT anonymise or erase records.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Source type normalisation helper
-- ------------------------------------------------------------

create or replace function public.normalise_identity_source_type(p_source_type text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(p_source_type, ''))) in ('visit_log', 'visitor_history', 'current_visitor', 'current_visitors') then 'visit_log'
    when lower(trim(coalesce(p_source_type, ''))) in ('planned_visit', 'planned_visits') then 'planned_visits'
    when lower(trim(coalesce(p_source_type, ''))) in ('privacy_case', 'privacy_cases') then 'privacy_cases'
    when lower(trim(coalesce(p_source_type, ''))) in ('document_evidence', 'document_signoff_evidence') then 'document_evidence'
    when lower(trim(coalesce(p_source_type, ''))) in ('agreement_evidence', 'agreement_signature', 'agreement_signatures') then 'agreement_evidence'
    when lower(trim(coalesce(p_source_type, ''))) in ('audit_event', 'audit_events') then 'audit_events'
    when lower(trim(coalesce(p_source_type, ''))) in ('manual', 'manual_record') then 'manual'
    else coalesce(nullif(lower(trim(coalesce(p_source_type, ''))), ''), 'other')
  end;
$$;

grant execute on function public.normalise_identity_source_type(text) to authenticated;

-- ------------------------------------------------------------
-- 2. Replace confirm-decision RPC so confirmed links use one root group
-- ------------------------------------------------------------

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
  v_existing_link_ids uuid[];
  v_primary_link_id uuid;
  v_secondary_link_id uuid;
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
    -- Find any existing active identity links that already contain either source.
    select array_agg(link_id order by first_created_at)
    into v_existing_link_ids
    from (
      select
        il.id as link_id,
        min(il.created_at) as first_created_at
      from public.identity_links il
      join public.identity_link_records ilr
        on ilr.identity_link_id = il.id
      where il.link_status = 'active'
        and il.identity_type = v_candidate.candidate_type
        and (
          (
            public.normalise_identity_source_type(ilr.source_type) = public.normalise_identity_source_type(v_candidate.source_a_type)
            and ilr.source_record_id = v_candidate.source_a_record_id
          )
          or
          (
            public.normalise_identity_source_type(ilr.source_type) = public.normalise_identity_source_type(v_candidate.source_b_type)
            and ilr.source_record_id = v_candidate.source_b_record_id
          )
        )
      group by il.id
    ) existing_links;

    if coalesce(array_length(v_existing_link_ids, 1), 0) > 0 then
      v_primary_link_id := v_existing_link_ids[1];

      select *
      into v_link
      from public.identity_links
      where id = v_primary_link_id
      for update;

      -- If both sides were already in different active links, merge secondary links into the primary link.
      if array_length(v_existing_link_ids, 1) > 1 then
        foreach v_secondary_link_id in array v_existing_link_ids loop
          if v_secondary_link_id <> v_primary_link_id then
            insert into public.identity_link_records (
              identity_link_id,
              source_type,
              source_record_id,
              source_label,
              source_summary,
              created_by
            )
            select
              v_primary_link_id,
              public.normalise_identity_source_type(ilr.source_type),
              ilr.source_record_id,
              ilr.source_label,
              ilr.source_summary,
              auth.uid()
            from public.identity_link_records ilr
            where ilr.identity_link_id = v_secondary_link_id
            on conflict do nothing;

            update public.identity_links
            set
              link_status = 'revoked',
              metadata = coalesce(metadata, '{}'::jsonb)
                || jsonb_build_object(
                  'merged_into_identity_link_id', v_primary_link_id::text,
                  'merged_at', now(),
                  'merged_by_candidate_id', v_candidate.id::text
                ),
              updated_by = auth.uid()
            where id = v_secondary_link_id;
          end if;
        end loop;
      end if;

      update public.identity_links
      set
        canonical_label = coalesce(
          nullif(trim(coalesce(p_canonical_label, '')), ''),
          canonical_label,
          nullif(trim(coalesce(v_candidate.source_a_label, '')), ''),
          nullif(trim(coalesce(v_candidate.source_b_label, '')), ''),
          link_reference
        ),
        link_reason = coalesce(
          nullif(trim(coalesce(p_decision_reason, '')), ''),
          link_reason
        ),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object(
            'last_confirmed_candidate_id', v_candidate.id::text,
            'last_confirmed_at', now()
          ),
        updated_by = auth.uid()
      where id = v_primary_link_id
      returning *
      into v_link;

    else
      -- No existing active link contains either source, so create a new root link.
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

      v_primary_link_id := v_link.id;
    end if;

    -- Add both candidate sources to the primary/root link.
    insert into public.identity_link_records (
      identity_link_id,
      source_type,
      source_record_id,
      source_label,
      source_summary,
      created_by
    )
    values (
      v_primary_link_id,
      public.normalise_identity_source_type(v_candidate.source_a_type),
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
      v_primary_link_id,
      public.normalise_identity_source_type(v_candidate.source_b_type),
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
    case when v_decision_type = 'confirmed' then v_primary_link_id else null end,
    v_decision_type,
    nullif(trim(coalesce(p_decision_reason, '')), ''),
    jsonb_build_object(
      'candidate_reference', v_candidate.candidate_reference,
      'candidate_type', v_candidate.candidate_type,
      'source_a_type', public.normalise_identity_source_type(v_candidate.source_a_type),
      'source_a_record_id', v_candidate.source_a_record_id,
      'source_b_type', public.normalise_identity_source_type(v_candidate.source_b_type),
      'source_b_record_id', v_candidate.source_b_record_id,
      'identity_link_id', case when v_primary_link_id is null then null else v_primary_link_id::text end,
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
        'identity_link_id', case when v_primary_link_id is null then null else v_primary_link_id::text end,
        'root_link_used', v_primary_link_id is not null
      )
    );
  exception
    when others then
      raise notice 'Audit write failed during identity candidate decision: %', sqlerrm;
  end;

  return v_decision;
end;
$$;

grant execute on function public.decide_identity_resolution_candidate(uuid, text, text, text, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 3. Recursive helper: list all active source records connected to a source
-- ------------------------------------------------------------

create or replace function public.list_active_identity_linked_source_records(
  p_source_type text,
  p_source_record_id text,
  p_source_type_filter text[] default null,
  p_include_requested_source boolean default false
)
returns table (
  identity_link_id uuid,
  link_reference text,
  identity_type text,
  link_status text,
  canonical_label text,
  link_reason text,
  link_created_at timestamptz,

  linked_source_type text,
  linked_source_record_id text,
  linked_source_label text,
  linked_source_summary jsonb,
  is_requested_source boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_identity_resolution() then
    raise exception 'You do not have permission to resolve linked identity records';
  end if;

  if nullif(trim(coalesce(p_source_type, '')), '') is null
    or nullif(trim(coalesce(p_source_record_id, '')), '') is null
  then
    raise exception 'Source type and source record ID are required';
  end if;

  return query
  with recursive connected_records(source_type, source_record_id) as (
    select
      public.normalise_identity_source_type(p_source_type),
      trim(p_source_record_id)

    union

    select
      public.normalise_identity_source_type(ilr_all.source_type),
      ilr_all.source_record_id
    from connected_records cr
    join public.identity_link_records ilr_seed
      on public.normalise_identity_source_type(ilr_seed.source_type) = public.normalise_identity_source_type(cr.source_type)
      and ilr_seed.source_record_id = cr.source_record_id
    join public.identity_links il
      on il.id = ilr_seed.identity_link_id
      and il.link_status = 'active'
    join public.identity_link_records ilr_all
      on ilr_all.identity_link_id = il.id
  ),
  connected_links as (
    select distinct il.id
    from connected_records cr
    join public.identity_link_records ilr
      on public.normalise_identity_source_type(ilr.source_type) = public.normalise_identity_source_type(cr.source_type)
      and ilr.source_record_id = cr.source_record_id
    join public.identity_links il
      on il.id = ilr.identity_link_id
      and il.link_status = 'active'
  )
  select
    il.id as identity_link_id,
    il.link_reference,
    il.identity_type,
    il.link_status,
    il.canonical_label,
    il.link_reason,
    il.created_at as link_created_at,

    public.normalise_identity_source_type(ilr.source_type) as linked_source_type,
    ilr.source_record_id as linked_source_record_id,
    ilr.source_label as linked_source_label,
    ilr.source_summary as linked_source_summary,
    (
      public.normalise_identity_source_type(ilr.source_type) = public.normalise_identity_source_type(p_source_type)
      and ilr.source_record_id = trim(p_source_record_id)
    ) as is_requested_source
  from connected_links cl
  join public.identity_links il
    on il.id = cl.id
  join public.identity_link_records ilr
    on ilr.identity_link_id = il.id
  where (
      p_include_requested_source is true
      or not (
        public.normalise_identity_source_type(ilr.source_type) = public.normalise_identity_source_type(p_source_type)
        and ilr.source_record_id = trim(p_source_record_id)
      )
    )
    and (
      p_source_type_filter is null
      or array_length(p_source_type_filter, 1) is null
      or exists (
        select 1
        from unnest(p_source_type_filter) as f(source_type_filter)
        where public.normalise_identity_source_type(ilr.source_type) = public.normalise_identity_source_type(f.source_type_filter)
      )
    )
  order by
    il.created_at desc,
    ilr.created_at asc;
end;
$$;

grant execute on function public.list_active_identity_linked_source_records(text, text, text[], boolean) to authenticated;

-- ------------------------------------------------------------
-- 4. Recursive helper: document compliance source candidates
-- ------------------------------------------------------------

create or replace function public.list_document_compliance_identity_link_sources(
  p_source_type text,
  p_source_record_id text
)
returns table (
  identity_link_id uuid,
  link_reference text,
  canonical_label text,
  link_reason text,
  link_created_at timestamptz,

  linked_source_type text,
  linked_source_record_id text,
  linked_source_label text,
  linked_source_summary jsonb,

  compliance_lookup_hint text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_identity_resolution() then
    raise exception 'You do not have permission to resolve document compliance identity links';
  end if;

  return query
  select
    src.identity_link_id,
    src.link_reference,
    src.canonical_label,
    src.link_reason,
    src.link_created_at,

    public.normalise_identity_source_type(src.linked_source_type) as linked_source_type,
    src.linked_source_record_id,
    src.linked_source_label,
    src.linked_source_summary,

    case
      when public.normalise_identity_source_type(src.linked_source_type) = 'visit_log' then 'check_visit_log_related_evidence'
      when public.normalise_identity_source_type(src.linked_source_type) = 'planned_visits' then 'check_planned_visit_related_evidence'
      when public.normalise_identity_source_type(src.linked_source_type) in ('document_evidence', 'agreement_evidence') then 'direct_evidence_record'
      when public.normalise_identity_source_type(src.linked_source_type) = 'privacy_cases' then 'context_only'
      else 'review_required'
    end as compliance_lookup_hint
  from public.list_active_identity_linked_source_records(
    p_source_type,
    p_source_record_id,
    array[
      'visit_log',
      'visitor_history',
      'planned_visits',
      'planned_visit',
      'document_evidence',
      'agreement_evidence',
      'document_signoff_evidence',
      'privacy_cases',
      'privacy_case',
      'manual',
      'other'
    ],
    false
  ) src;
end;
$$;

grant execute on function public.list_document_compliance_identity_link_sources(text, text) to authenticated;

-- ------------------------------------------------------------
-- 5. Recursive helper: linked identity context for a source record
-- ------------------------------------------------------------

create or replace function public.list_identity_context_for_source_record(
  p_source_type text,
  p_source_record_id text,
  p_include_revoked boolean default false
)
returns table (
  identity_link_id uuid,
  link_reference text,
  identity_type text,
  link_status text,
  canonical_label text,
  link_reason text,
  created_from_candidate_id uuid,
  link_created_at timestamptz,
  link_updated_at timestamptz,

  link_record_id uuid,
  linked_source_type text,
  linked_source_record_id text,
  linked_source_label text,
  linked_source_summary jsonb,
  linked_record_created_at timestamptz,

  is_requested_source boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_identity_resolution() then
    raise exception 'You do not have permission to view linked identity context';
  end if;

  if nullif(trim(coalesce(p_source_type, '')), '') is null
    or nullif(trim(coalesce(p_source_record_id, '')), '') is null
  then
    raise exception 'Source type and source record ID are required';
  end if;

  return query
  with recursive connected_records(source_type, source_record_id) as (
    select
      public.normalise_identity_source_type(p_source_type),
      trim(p_source_record_id)

    union

    select
      public.normalise_identity_source_type(ilr_all.source_type),
      ilr_all.source_record_id
    from connected_records cr
    join public.identity_link_records ilr_seed
      on public.normalise_identity_source_type(ilr_seed.source_type) = public.normalise_identity_source_type(cr.source_type)
      and ilr_seed.source_record_id = cr.source_record_id
    join public.identity_links il
      on il.id = ilr_seed.identity_link_id
      and (
        p_include_revoked is true
        or il.link_status = 'active'
      )
    join public.identity_link_records ilr_all
      on ilr_all.identity_link_id = il.id
  ),
  connected_links as (
    select distinct il.id
    from connected_records cr
    join public.identity_link_records ilr
      on public.normalise_identity_source_type(ilr.source_type) = public.normalise_identity_source_type(cr.source_type)
      and ilr.source_record_id = cr.source_record_id
    join public.identity_links il
      on il.id = ilr.identity_link_id
      and (
        p_include_revoked is true
        or il.link_status = 'active'
      )
  )
  select
    il.id as identity_link_id,
    il.link_reference,
    il.identity_type,
    il.link_status,
    il.canonical_label,
    il.link_reason,
    il.created_from_candidate_id,
    il.created_at as link_created_at,
    il.updated_at as link_updated_at,

    ilr.id as link_record_id,
    public.normalise_identity_source_type(ilr.source_type) as linked_source_type,
    ilr.source_record_id as linked_source_record_id,
    ilr.source_label as linked_source_label,
    ilr.source_summary as linked_source_summary,
    ilr.created_at as linked_record_created_at,

    (
      public.normalise_identity_source_type(ilr.source_type) = public.normalise_identity_source_type(p_source_type)
      and ilr.source_record_id = trim(p_source_record_id)
    ) as is_requested_source
  from connected_links cl
  join public.identity_links il
    on il.id = cl.id
  join public.identity_link_records ilr
    on ilr.identity_link_id = il.id
  order by
    il.created_at desc,
    is_requested_source desc,
    ilr.created_at asc;
end;
$$;

grant execute on function public.list_identity_context_for_source_record(text, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 6. Recursive helper: linked identity summary
-- ------------------------------------------------------------

create or replace function public.get_identity_context_summary_for_source_record(
  p_source_type text,
  p_source_record_id text,
  p_include_revoked boolean default false
)
returns table (
  source_type text,
  source_record_id text,
  active_link_count integer,
  revoked_link_count integer,
  linked_record_count integer,
  has_confirmed_context boolean,
  primary_canonical_label text,
  latest_link_reference text,
  latest_link_created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_identity_resolution() then
    raise exception 'You do not have permission to view linked identity context';
  end if;

  if nullif(trim(coalesce(p_source_type, '')), '') is null
    or nullif(trim(coalesce(p_source_record_id, '')), '') is null
  then
    raise exception 'Source type and source record ID are required';
  end if;

  return query
  with context_rows as (
    select *
    from public.list_identity_context_for_source_record(
      p_source_type,
      p_source_record_id,
      p_include_revoked
    )
  ),
  latest_link as (
    select
      cr.canonical_label,
      cr.link_reference,
      cr.link_created_at
    from context_rows cr
    order by cr.link_created_at desc
    limit 1
  )
  select
    public.normalise_identity_source_type(p_source_type) as source_type,
    trim(p_source_record_id) as source_record_id,
    count(distinct cr.identity_link_id) filter (where cr.link_status = 'active')::integer as active_link_count,
    count(distinct cr.identity_link_id) filter (where cr.link_status = 'revoked')::integer as revoked_link_count,
    count(distinct cr.link_record_id)::integer as linked_record_count,
    (count(distinct cr.identity_link_id) filter (where cr.link_status = 'active') > 0) as has_confirmed_context,
    (select latest_link.canonical_label from latest_link) as primary_canonical_label,
    (select latest_link.link_reference from latest_link) as latest_link_reference,
    (select latest_link.link_created_at from latest_link) as latest_link_created_at
  from context_rows cr;
end;
$$;

grant execute on function public.get_identity_context_summary_for_source_record(text, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 7. Connected helper: confirmed link detail with root/group records
-- ------------------------------------------------------------

create or replace function public.get_identity_link_detail(
  p_identity_link_id uuid
)
returns table (
  identity_link_id uuid,
  link_reference text,
  identity_type text,
  link_status text,
  canonical_label text,
  link_reason text,
  created_from_candidate_id uuid,
  link_created_at timestamptz,
  link_updated_at timestamptz,

  link_record_id uuid,
  source_type text,
  source_record_id text,
  source_label text,
  source_summary jsonb,
  source_record_linked_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seed_link_id uuid;
begin
  if not public.can_view_identity_resolution() then
    raise exception 'You do not have permission to view identity link details';
  end if;

  if p_identity_link_id is null then
    raise exception 'Identity link ID is required';
  end if;

  select
    coalesce(
      case
        when (identity_link.metadata ->> 'merged_into_identity_link_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (identity_link.metadata ->> 'merged_into_identity_link_id')::uuid
        else null
      end,
      identity_link.id
    )
  into v_seed_link_id
  from public.identity_links as identity_link
  where identity_link.id = p_identity_link_id;

  if v_seed_link_id is null then
    raise exception 'Identity link not found';
  end if;

  return query
  with recursive connected_records(source_type, source_record_id) as (
    select
      public.normalise_identity_source_type(ilr.source_type),
      ilr.source_record_id
    from public.identity_link_records ilr
    where ilr.identity_link_id = v_seed_link_id

    union

    select
      public.normalise_identity_source_type(ilr_all.source_type),
      ilr_all.source_record_id
    from connected_records cr
    join public.identity_link_records ilr_seed
      on public.normalise_identity_source_type(ilr_seed.source_type) = public.normalise_identity_source_type(cr.source_type)
      and ilr_seed.source_record_id = cr.source_record_id
    join public.identity_links il
      on il.id = ilr_seed.identity_link_id
      and il.link_status = 'active'
    join public.identity_link_records ilr_all
      on ilr_all.identity_link_id = il.id
  ),
  connected_links as (
    select distinct il.id
    from connected_records cr
    join public.identity_link_records ilr
      on public.normalise_identity_source_type(ilr.source_type) = public.normalise_identity_source_type(cr.source_type)
      and ilr.source_record_id = cr.source_record_id
    join public.identity_links il
      on il.id = ilr.identity_link_id
      and il.link_status = 'active'
  )
  select
    il.id as identity_link_id,
    il.link_reference,
    il.identity_type,
    il.link_status,
    il.canonical_label,
    il.link_reason,
    il.created_from_candidate_id,
    il.created_at as link_created_at,
    il.updated_at as link_updated_at,

    ilr.id as link_record_id,
    public.normalise_identity_source_type(ilr.source_type) as source_type,
    ilr.source_record_id,
    ilr.source_label,
    ilr.source_summary,
    ilr.created_at as source_record_linked_at
  from connected_links cl
  join public.identity_links il
    on il.id = cl.id
  join public.identity_link_records ilr
    on ilr.identity_link_id = il.id
  order by
    il.created_at asc,
    ilr.created_at asc;
end;
$$;

grant execute on function public.get_identity_link_detail(uuid) to authenticated;

-- Ask PostgREST/Supabase API to reload its schema cache.
notify pgrst, 'reload schema';

select 'OHP-010B identity link root consolidation patch installed' as result;
