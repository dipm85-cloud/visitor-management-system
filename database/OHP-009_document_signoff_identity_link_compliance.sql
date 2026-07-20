-- ============================================================
-- Operations Hub - OHP-009
-- Document Sign-off Compliance Uses Confirmed Identity Links
--
-- Adds:
-- - a platform setting / feature flag where possible
-- - read-only helpers to resolve active confirmed identity-linked
--   source records for compliance checks
--
-- Safety:
-- - Does NOT merge records.
-- - Does NOT rewrite source history.
-- - Does NOT update visitor records.
-- - Does NOT update document evidence.
-- - Does NOT update agreement evidence.
-- - Does NOT update identity links.
-- - Does NOT anonymise or erase records.
-- - Does NOT itself change compliance status.
--
-- Frontend/business logic must decide how to consume these helpers.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Best-effort setting seed
-- ------------------------------------------------------------
-- The app has used system_settings over time, but the exact shape may
-- differ between environments. This block safely tries known patterns.
--
-- Setting:
-- document_signoff.use_confirmed_identity_links_for_compliance
--
-- Default:
-- false
--
-- If the local system_settings shape is not recognised, the SQL does not fail.
-- Codex/frontend should still implement a safe default of false.

do $$
declare
  v_has_system_settings boolean;
  v_has_setting_key boolean;
  v_has_key boolean;
  v_has_setting_value boolean;
  v_has_value boolean;
  v_has_value_json boolean;
  v_has_category boolean;
  v_sql text;
begin
  select exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'system_settings'
  )
  into v_has_system_settings;

  if not v_has_system_settings then
    raise notice 'system_settings table not found; skipping OHP-009 setting seed.';
    return;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'system_settings'
      and column_name = 'setting_key'
  ) into v_has_setting_key;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'system_settings'
      and column_name = 'key'
  ) into v_has_key;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'system_settings'
      and column_name = 'setting_value'
  ) into v_has_setting_value;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'system_settings'
      and column_name = 'value'
  ) into v_has_value;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'system_settings'
      and column_name = 'value_json'
  ) into v_has_value_json;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'system_settings'
      and column_name = 'category'
  ) into v_has_category;

  if v_has_setting_key and v_has_setting_value then
    if v_has_category then
      v_sql := $seed$
        insert into public.system_settings (
          setting_key,
          setting_value,
          category
        )
        values (
          'document_signoff.use_confirmed_identity_links_for_compliance',
          'false'::jsonb,
          'document_signoff'
        )
        on conflict (setting_key) do nothing
      $seed$;
    else
      v_sql := $seed$
        insert into public.system_settings (
          setting_key,
          setting_value
        )
        values (
          'document_signoff.use_confirmed_identity_links_for_compliance',
          'false'::jsonb
        )
        on conflict (setting_key) do nothing
      $seed$;
    end if;

    execute v_sql;
    raise notice 'Seeded OHP-009 setting using setting_key / setting_value.';
    return;
  end if;

  if v_has_key and v_has_value then
    if v_has_category then
      v_sql := $seed$
        insert into public.system_settings (
          key,
          value,
          category
        )
        values (
          'document_signoff.use_confirmed_identity_links_for_compliance',
          'false'::jsonb,
          'document_signoff'
        )
        on conflict (key) do nothing
      $seed$;
    else
      v_sql := $seed$
        insert into public.system_settings (
          key,
          value
        )
        values (
          'document_signoff.use_confirmed_identity_links_for_compliance',
          'false'::jsonb
        )
        on conflict (key) do nothing
      $seed$;
    end if;

    execute v_sql;
    raise notice 'Seeded OHP-009 setting using key / value.';
    return;
  end if;

  if v_has_key and v_has_value_json then
    if v_has_category then
      v_sql := $seed$
        insert into public.system_settings (
          key,
          value_json,
          category
        )
        values (
          'document_signoff.use_confirmed_identity_links_for_compliance',
          'false'::jsonb,
          'document_signoff'
        )
        on conflict (key) do nothing
      $seed$;
    else
      v_sql := $seed$
        insert into public.system_settings (
          key,
          value_json
        )
        values (
          'document_signoff.use_confirmed_identity_links_for_compliance',
          'false'::jsonb
        )
        on conflict (key) do nothing
      $seed$;
    end if;

    execute v_sql;
    raise notice 'Seeded OHP-009 setting using key / value_json.';
    return;
  end if;

  raise notice 'system_settings shape not recognised; skipped OHP-009 setting seed.';
end;
$$;

-- ------------------------------------------------------------
-- 2. Helper: active confirmed identity-linked source records
-- ------------------------------------------------------------
-- Given a source record, return other source records connected through
-- active confirmed identity links.
--
-- This is generic on purpose. It does not assume document evidence table
-- names or evidence schema. The frontend/compliance layer can filter and
-- consume this safely.

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
  with matching_links as (
    select distinct il.id
    from public.identity_links il
    join public.identity_link_records ilr
      on ilr.identity_link_id = il.id
    where il.link_status = 'active'
      and lower(ilr.source_type) = lower(trim(p_source_type))
      and ilr.source_record_id = trim(p_source_record_id)
  )
  select
    il.id as identity_link_id,
    il.link_reference,
    il.identity_type,
    il.link_status,
    il.canonical_label,
    il.link_reason,
    il.created_at as link_created_at,

    ilr.source_type as linked_source_type,
    ilr.source_record_id as linked_source_record_id,
    ilr.source_label as linked_source_label,
    ilr.source_summary as linked_source_summary,
    (
      lower(ilr.source_type) = lower(trim(p_source_type))
      and ilr.source_record_id = trim(p_source_record_id)
    ) as is_requested_source
  from matching_links ml
  join public.identity_links il
    on il.id = ml.id
  join public.identity_link_records ilr
    on ilr.identity_link_id = il.id
  where (
      p_include_requested_source is true
      or not (
        lower(ilr.source_type) = lower(trim(p_source_type))
        and ilr.source_record_id = trim(p_source_record_id)
      )
    )
    and (
      p_source_type_filter is null
      or array_length(p_source_type_filter, 1) is null
      or lower(ilr.source_type) = any (
        select lower(unnest(p_source_type_filter))
      )
    )
  order by
    il.created_at desc,
    ilr.source_type,
    ilr.source_label nulls last,
    ilr.source_record_id;
end;
$$;

grant execute on function public.list_active_identity_linked_source_records(text, text, text[], boolean) to authenticated;

-- ------------------------------------------------------------
-- 3. Helper: compliance candidate sources through identity links
-- ------------------------------------------------------------
-- This helper returns linked records that are likely to be useful for
-- Document Sign-off / Induction compliance lookup.
--
-- It intentionally returns source metadata only.
-- It does not read or validate document evidence itself because existing
-- deployments may use different evidence table/function shapes.
--
-- The frontend/Codex milestone should inspect existing document sign-off
-- evidence logic and use this output as an input to the existing evidence
-- resolver.

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

    src.linked_source_type,
    src.linked_source_record_id,
    src.linked_source_label,
    src.linked_source_summary,

    case
      when lower(src.linked_source_type) in ('visit_log', 'visitor_history') then 'check_visit_log_related_evidence'
      when lower(src.linked_source_type) in ('planned_visits', 'planned_visit') then 'check_planned_visit_related_evidence'
      when lower(src.linked_source_type) in ('document_evidence', 'agreement_evidence', 'document_signoff_evidence') then 'direct_evidence_record'
      when lower(src.linked_source_type) in ('privacy_cases', 'privacy_case') then 'context_only'
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
-- 4. Helper: feature flag check with safe default false
-- ------------------------------------------------------------
-- This tries common system_settings shapes and returns false if the setting
-- cannot be read. Frontend should also default to false if this RPC fails.

create or replace function public.get_use_identity_links_for_document_compliance()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_system_settings boolean;
  v_result boolean := false;
begin
  select exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'system_settings'
  )
  into v_has_system_settings;

  if not v_has_system_settings then
    return false;
  end if;

  -- Shape: setting_key / setting_value
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'system_settings'
      and column_name = 'setting_key'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'system_settings'
      and column_name = 'setting_value'
  )
  then
    execute $q$
      select coalesce(
        (
          case
            when jsonb_typeof(setting_value::jsonb) = 'boolean'
              then (setting_value::jsonb)::text::boolean
            when jsonb_typeof(setting_value::jsonb) = 'string'
              then trim(both '"' from (setting_value::jsonb)::text)::boolean
            else false
          end
        ),
        false
      )
      from public.system_settings
      where setting_key = 'document_signoff.use_confirmed_identity_links_for_compliance'
      limit 1
    $q$
    into v_result;

    return coalesce(v_result, false);
  end if;

  -- Shape: key / value
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'system_settings'
      and column_name = 'key'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'system_settings'
      and column_name = 'value'
  )
  then
    execute $q$
      select coalesce(
        (
          case
            when jsonb_typeof(value::jsonb) = 'boolean'
              then (value::jsonb)::text::boolean
            when jsonb_typeof(value::jsonb) = 'string'
              then trim(both '"' from (value::jsonb)::text)::boolean
            else false
          end
        ),
        false
      )
      from public.system_settings
      where key = 'document_signoff.use_confirmed_identity_links_for_compliance'
      limit 1
    $q$
    into v_result;

    return coalesce(v_result, false);
  end if;

  -- Shape: key / value_json
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'system_settings'
      and column_name = 'key'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'system_settings'
      and column_name = 'value_json'
  )
  then
    execute $q$
      select coalesce(
        (
          case
            when jsonb_typeof(value_json::jsonb) = 'boolean'
              then (value_json::jsonb)::text::boolean
            when jsonb_typeof(value_json::jsonb) = 'string'
              then trim(both '"' from (value_json::jsonb)::text)::boolean
            else false
          end
        ),
        false
      )
      from public.system_settings
      where key = 'document_signoff.use_confirmed_identity_links_for_compliance'
      limit 1
    $q$
    into v_result;

    return coalesce(v_result, false);
  end if;

  return false;
exception
  when others then
    raise notice 'Could not read OHP-009 identity-link compliance setting: %', sqlerrm;
    return false;
end;
$$;

grant execute on function public.get_use_identity_links_for_document_compliance() to authenticated;

-- Ask PostgREST/Supabase API to reload its schema cache.
notify pgrst, 'reload schema';

select 'OHP-009 document sign-off identity-link compliance helpers installed' as result;