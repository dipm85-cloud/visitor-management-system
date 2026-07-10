-- ============================================================
-- Operations Hub - OHP-007D Linked Identity Context Helpers
--
-- Adds read-only helper RPCs so the app can show confirmed
-- identity-link context from source records such as:
-- - visit_log
-- - planned_visits
-- - privacy_cases
-- - document_evidence
-- - agreement_evidence
--
-- Safety:
-- - Does NOT merge records.
-- - Does NOT rewrite source history.
-- - Does NOT anonymise records.
-- - Does NOT erase records.
-- - Does NOT change compliance status.
-- - Does NOT update visitor/document/privacy records.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Helper: linked identity context for a source record
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
  with matching_links as (
    select distinct il.id
    from public.identity_links il
    join public.identity_link_records ilr
      on ilr.identity_link_id = il.id
    where lower(ilr.source_type) = lower(trim(p_source_type))
      and ilr.source_record_id = trim(p_source_record_id)
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
    ilr.source_type as linked_source_type,
    ilr.source_record_id as linked_source_record_id,
    ilr.source_label as linked_source_label,
    ilr.source_summary as linked_source_summary,
    ilr.created_at as linked_record_created_at,

    (
      lower(ilr.source_type) = lower(trim(p_source_type))
      and ilr.source_record_id = trim(p_source_record_id)
    ) as is_requested_source
  from matching_links ml
  join public.identity_links il
    on il.id = ml.id
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
-- 2. Helper: summary of linked identity context for a source record
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
  with matching_links as (
    select distinct
      il.id,
      il.link_status,
      il.canonical_label,
      il.link_reference,
      il.created_at
    from public.identity_links il
    join public.identity_link_records ilr
      on ilr.identity_link_id = il.id
    where lower(ilr.source_type) = lower(trim(p_source_type))
      and ilr.source_record_id = trim(p_source_record_id)
      and (
        p_include_revoked is true
        or il.link_status = 'active'
      )
  ),
  linked_records as (
    select
      ilr.id,
      ilr.identity_link_id
    from public.identity_link_records ilr
    join matching_links ml
      on ml.id = ilr.identity_link_id
  ),
  latest_link as (
    select
      ml.canonical_label,
      ml.link_reference,
      ml.created_at
    from matching_links ml
    order by ml.created_at desc
    limit 1
  )
  select
    trim(p_source_type) as source_type,
    trim(p_source_record_id) as source_record_id,
    count(distinct ml.id) filter (where ml.link_status = 'active')::integer as active_link_count,
    count(distinct ml.id) filter (where ml.link_status = 'revoked')::integer as revoked_link_count,
    count(distinct lr.id)::integer as linked_record_count,
    (count(distinct ml.id) filter (where ml.link_status = 'active') > 0) as has_confirmed_context,
    (select latest_link.canonical_label from latest_link) as primary_canonical_label,
    (select latest_link.link_reference from latest_link) as latest_link_reference,
    (select latest_link.created_at from latest_link) as latest_link_created_at
  from matching_links ml
  left join linked_records lr
    on lr.identity_link_id = ml.id;
end;
$$;

grant execute on function public.get_identity_context_summary_for_source_record(text, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 3. Helper: confirmed link detail with records
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
begin
  if not public.can_view_identity_resolution() then
    raise exception 'You do not have permission to view identity link details';
  end if;

  if p_identity_link_id is null then
    raise exception 'Identity link ID is required';
  end if;

  return query
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
    ilr.source_type,
    ilr.source_record_id,
    ilr.source_label,
    ilr.source_summary,
    ilr.created_at as source_record_linked_at
  from public.identity_links il
  left join public.identity_link_records ilr
    on ilr.identity_link_id = il.id
  where il.id = p_identity_link_id
  order by
    ilr.created_at asc;
end;
$$;

grant execute on function public.get_identity_link_detail(uuid) to authenticated;

-- Ask PostgREST/Supabase API to reload its schema cache.
notify pgrst, 'reload schema';

select 'OHP-007D linked identity context helpers installed' as result;