-- ============================================================
-- Operations Hub - OH-048D Privacy Case Workspace SQL Alignment
-- Align native privacy case tables/RPCs with the OH-048 UI.
--
-- Foundation only:
--   - stores privacy case metadata, timeline events and manual links
--   - does not anonymise, erase, export, complete legacy GDPR records,
--     update visitor/document/audit records, or infer identities
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- Capabilities
-- ============================================================

insert into public.capability_groups (
  group_code,
  group_name,
  description,
  display_order,
  active
)
values (
  'privacy',
  'Privacy / Data Governance',
  'Privacy case workspace, GDPR review and data-governance administration.',
  90,
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
  capability.capability_code,
  capability.capability_name,
  capability_group.id,
  capability.description,
  true
from (
  values
    (
      'privacy.view',
      'View Privacy / Data Governance',
      'Can view the native Privacy / Data Governance workspace.'
    ),
    (
      'privacy.manage',
      'Manage Privacy / Data Governance',
      'Can manage native privacy case metadata and governance review records.'
    ),
    (
      'privacy.case.view',
      'View Privacy Cases',
      'Can view native privacy case workspace records and timelines.'
    ),
    (
      'privacy.case.manage',
      'Manage Privacy Cases',
      'Can create and update native privacy case metadata, timeline events and manual case links.'
    ),
    (
      'gdpr.view',
      'View GDPR Workspace',
      'Can view GDPR review and privacy case workspace information.'
    ),
    (
      'gdpr.manage',
      'Manage GDPR Workspace',
      'Can manage GDPR review metadata and privacy case workspace records.'
    )
) as capability(capability_code, capability_name, description)
join public.capability_groups capability_group
  on capability_group.group_code = 'privacy'
on conflict (capability_code) do update
set
  capability_name = excluded.capability_name,
  group_id = excluded.group_id,
  description = excluded.description,
  active = true;

insert into public.role_preset_capabilities (role_preset_id, capability_id)
select role_preset.id, capability.id
from public.role_presets role_preset
cross join public.capabilities capability
where role_preset.role_code = 'super_user'
  and capability.capability_code in (
    'privacy.view',
    'privacy.manage',
    'privacy.case.view',
    'privacy.case.manage',
    'gdpr.view',
    'gdpr.manage'
  )
on conflict (role_preset_id, capability_id) do nothing;

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.privacy_cases (
  id uuid primary key default gen_random_uuid(),
  case_reference text not null default (
    'PC-' ||
    to_char(now(), 'YYYYMMDD') ||
    '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  case_type text not null default 'access',
  status text not null default 'open',
  priority text not null default 'normal',
  subject_name text,
  subject_company text,
  subject_email text,
  subject_reference text,
  search_text text,
  request_received_date date,
  due_date date,
  completed_date date,
  reason text,
  notes text,
  outcome_summary text,
  legacy_reference text,
  identity_verified boolean not null default false,
  identity_verification_method text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ux_privacy_cases_case_reference unique (case_reference),
  constraint chk_privacy_cases_case_type check (
    case_type in (
      'access',
      'sar',
      'erasure',
      'rectification',
      'restriction',
      'objection',
      'other'
    )
  ),
  constraint chk_privacy_cases_status check (
    status in (
      'open',
      'in_review',
      'awaiting_legacy_action',
      'completed',
      'cancelled',
      'rejected'
    )
  ),
  constraint chk_privacy_cases_priority check (
    priority in ('low', 'normal', 'high', 'urgent')
  ),
  constraint chk_privacy_cases_due_after_received check (
    request_received_date is null
    or due_date is null
    or due_date >= request_received_date
  ),
  constraint chk_privacy_cases_metadata_object check (
    jsonb_typeof(metadata) = 'object'
  )
);

alter table public.privacy_cases
  add column if not exists id uuid,
  add column if not exists case_reference text,
  add column if not exists case_type text,
  add column if not exists status text,
  add column if not exists priority text,
  add column if not exists subject_name text,
  add column if not exists subject_company text,
  add column if not exists subject_email text,
  add column if not exists subject_reference text,
  add column if not exists search_text text,
  add column if not exists request_received_date date,
  add column if not exists due_date date,
  add column if not exists completed_date date,
  add column if not exists reason text,
  add column if not exists notes text,
  add column if not exists outcome_summary text,
  add column if not exists legacy_reference text,
  add column if not exists identity_verified boolean,
  add column if not exists identity_verification_method text,
  add column if not exists metadata jsonb,
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists updated_by uuid references public.profiles(id),
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.privacy_cases
  alter column id set default gen_random_uuid(),
  alter column case_reference set default (
    'PC-' ||
    to_char(now(), 'YYYYMMDD') ||
    '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  alter column case_type set default 'access',
  alter column status set default 'open',
  alter column priority set default 'normal',
  alter column identity_verified set default false,
  alter column metadata set default '{}'::jsonb,
  alter column created_at set default now(),
  alter column updated_at set default now();

update public.privacy_cases
set
  id = coalesce(id, gen_random_uuid()),
  case_reference = coalesce(
    case_reference,
    'PC-' ||
    to_char(coalesce(created_at, now()), 'YYYYMMDD') ||
    '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  case_type = coalesce(case_type, 'access'),
  status = coalesce(status, 'open'),
  priority = coalesce(priority, 'normal'),
  identity_verified = coalesce(identity_verified, false),
  metadata = coalesce(metadata, '{}'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.privacy_cases
  alter column id set not null,
  alter column case_reference set not null,
  alter column case_type set not null,
  alter column status set not null,
  alter column priority set not null,
  alter column identity_verified set not null,
  alter column metadata set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

create unique index if not exists ux_privacy_cases_case_reference_idx
on public.privacy_cases(case_reference);

create unique index if not exists ux_privacy_cases_id_idx
on public.privacy_cases(id);

create index if not exists ix_privacy_cases_status_due
on public.privacy_cases(status, due_date);

create index if not exists ix_privacy_cases_case_type
on public.privacy_cases(case_type);

create index if not exists ix_privacy_cases_received
on public.privacy_cases(request_received_date);

create index if not exists ix_privacy_cases_subject_search
on public.privacy_cases(
  lower(coalesce(subject_name, '')),
  lower(coalesce(subject_company, '')),
  lower(coalesce(subject_email, '')),
  lower(coalesce(subject_reference, ''))
);

drop trigger if exists trg_privacy_cases_updated_at on public.privacy_cases;
create trigger trg_privacy_cases_updated_at
before update on public.privacy_cases
for each row execute function public.oh_set_updated_at();

create table if not exists public.privacy_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.privacy_cases(id) on delete cascade,
  event_type text not null default 'note',
  title text,
  details text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint chk_privacy_case_events_metadata_object check (
    jsonb_typeof(metadata) = 'object'
  )
);

alter table public.privacy_case_events
  add column if not exists id uuid,
  add column if not exists case_id uuid references public.privacy_cases(id) on delete cascade,
  add column if not exists event_type text,
  add column if not exists title text,
  add column if not exists details text,
  add column if not exists metadata jsonb,
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists created_at timestamptz;

alter table public.privacy_case_events
  alter column id set default gen_random_uuid(),
  alter column event_type set default 'note',
  alter column metadata set default '{}'::jsonb,
  alter column created_at set default now();

update public.privacy_case_events
set
  id = coalesce(id, gen_random_uuid()),
  event_type = coalesce(event_type, 'note'),
  metadata = coalesce(metadata, '{}'::jsonb),
  created_at = coalesce(created_at, now());

alter table public.privacy_case_events
  alter column id set not null,
  alter column case_id set not null,
  alter column event_type set not null,
  alter column metadata set not null,
  alter column created_at set not null;

create index if not exists ix_privacy_case_events_case_time
on public.privacy_case_events(case_id, created_at desc);

create unique index if not exists ux_privacy_case_events_id_idx
on public.privacy_case_events(id);

create table if not exists public.privacy_case_record_links (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.privacy_cases(id) on delete cascade,
  record_type text not null,
  record_id text not null,
  source_module text,
  link_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint chk_privacy_case_record_links_metadata_object check (
    jsonb_typeof(metadata) = 'object'
  )
);

alter table public.privacy_case_record_links
  add column if not exists id uuid,
  add column if not exists case_id uuid references public.privacy_cases(id) on delete cascade,
  add column if not exists record_type text,
  add column if not exists record_id text,
  add column if not exists source_module text,
  add column if not exists link_reason text,
  add column if not exists metadata jsonb,
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists created_at timestamptz;

alter table public.privacy_case_record_links
  alter column id set default gen_random_uuid(),
  alter column metadata set default '{}'::jsonb,
  alter column created_at set default now();

update public.privacy_case_record_links
set
  id = coalesce(id, gen_random_uuid()),
  metadata = coalesce(metadata, '{}'::jsonb),
  created_at = coalesce(created_at, now());

alter table public.privacy_case_record_links
  alter column id set not null,
  alter column case_id set not null,
  alter column record_type set not null,
  alter column record_id set not null,
  alter column metadata set not null,
  alter column created_at set not null;

create unique index if not exists ux_privacy_case_record_links_manual
on public.privacy_case_record_links(case_id, record_type, record_id);

create unique index if not exists ux_privacy_case_record_links_id_idx
on public.privacy_case_record_links(id);

create index if not exists ix_privacy_case_record_links_case
on public.privacy_case_record_links(case_id);

-- ============================================================
-- Permission Helpers
-- ============================================================

create or replace function public.can_view_privacy_cases()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role = 'super_user'
      and coalesce(profile.active, true) = true
  )
  or public.user_has_capability('privacy.case.view')
  or public.user_has_capability('privacy.case.manage')
  or public.user_has_capability('privacy.view')
  or public.user_has_capability('privacy.manage')
  or public.user_has_capability('gdpr.view')
  or public.user_has_capability('gdpr.manage')
  or public.user_has_capability('module_configuration.manage')
  or public.user_has_capability('settings.view');
$$;

create or replace function public.can_manage_privacy_cases()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role = 'super_user'
      and coalesce(profile.active, true) = true
  )
  or public.user_has_capability('privacy.case.manage')
  or public.user_has_capability('privacy.manage')
  or public.user_has_capability('gdpr.manage')
  or public.user_has_capability('module_configuration.manage');
$$;

grant execute on function public.can_view_privacy_cases() to authenticated;
grant execute on function public.can_manage_privacy_cases() to authenticated;

-- ============================================================
-- RLS
-- ============================================================

grant usage on schema public to authenticated;
grant select, insert, update on public.privacy_cases to authenticated;
grant select, insert on public.privacy_case_events to authenticated;
grant select, insert on public.privacy_case_record_links to authenticated;

alter table public.privacy_cases enable row level security;
alter table public.privacy_case_events enable row level security;
alter table public.privacy_case_record_links enable row level security;

drop policy if exists "capability can read privacy cases" on public.privacy_cases;
drop policy if exists "capability can insert privacy cases" on public.privacy_cases;
drop policy if exists "capability can update privacy cases" on public.privacy_cases;

create policy "capability can read privacy cases"
on public.privacy_cases
for select
to authenticated
using (public.can_view_privacy_cases());

create policy "capability can insert privacy cases"
on public.privacy_cases
for insert
to authenticated
with check (public.can_manage_privacy_cases());

create policy "capability can update privacy cases"
on public.privacy_cases
for update
to authenticated
using (public.can_manage_privacy_cases())
with check (public.can_manage_privacy_cases());

drop policy if exists "capability can read privacy case events" on public.privacy_case_events;
drop policy if exists "capability can insert privacy case events" on public.privacy_case_events;

create policy "capability can read privacy case events"
on public.privacy_case_events
for select
to authenticated
using (public.can_view_privacy_cases());

create policy "capability can insert privacy case events"
on public.privacy_case_events
for insert
to authenticated
with check (public.can_manage_privacy_cases());

drop policy if exists "capability can read privacy case record links" on public.privacy_case_record_links;
drop policy if exists "capability can insert privacy case record links" on public.privacy_case_record_links;

create policy "capability can read privacy case record links"
on public.privacy_case_record_links
for select
to authenticated
using (public.can_view_privacy_cases());

create policy "capability can insert privacy case record links"
on public.privacy_case_record_links
for insert
to authenticated
with check (public.can_manage_privacy_cases());

-- ============================================================
-- Privacy Case RPCs
-- ============================================================

create or replace function public.list_privacy_cases(
  p_search_text text default null,
  p_status text default null,
  p_case_type text default null,
  p_from_date date default null,
  p_to_date date default null
)
returns table (
  id uuid,
  case_reference text,
  case_type text,
  request_type text,
  status text,
  priority text,
  subject_name text,
  subject_company text,
  subject_email text,
  subject_reference text,
  search_text text,
  requester_name text,
  requester_contact text,
  request_received_date date,
  request_received_at timestamptz,
  due_date date,
  completed_date date,
  completed_at timestamptz,
  reason text,
  notes text,
  outcome_summary text,
  legacy_reference text,
  identity_verified boolean,
  identity_verification_method text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid,
  updated_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_privacy_cases() then
    raise exception 'Permission denied for privacy cases';
  end if;

  return query
  select
    privacy_case.id,
    privacy_case.case_reference,
    privacy_case.case_type,
    privacy_case.case_type as request_type,
    privacy_case.status,
    privacy_case.priority,
    privacy_case.subject_name,
    privacy_case.subject_company,
    privacy_case.subject_email,
    privacy_case.subject_reference,
    privacy_case.search_text,
    privacy_case.subject_name as requester_name,
    coalesce(
      privacy_case.subject_email,
      privacy_case.subject_reference,
      privacy_case.search_text
    ) as requester_contact,
    privacy_case.request_received_date,
    privacy_case.request_received_date::timestamptz as request_received_at,
    privacy_case.due_date,
    privacy_case.completed_date,
    privacy_case.completed_date::timestamptz as completed_at,
    privacy_case.reason,
    privacy_case.notes,
    privacy_case.outcome_summary,
    privacy_case.legacy_reference,
    privacy_case.identity_verified,
    privacy_case.identity_verification_method,
    privacy_case.metadata,
    privacy_case.created_at,
    privacy_case.updated_at,
    privacy_case.created_by,
    privacy_case.updated_by
  from public.privacy_cases privacy_case
  where (p_status is null or privacy_case.status = p_status)
    and (p_case_type is null or privacy_case.case_type = p_case_type)
    and (
      p_from_date is null
      or privacy_case.request_received_date is null
      or privacy_case.request_received_date >= p_from_date
    )
    and (
      p_to_date is null
      or privacy_case.request_received_date is null
      or privacy_case.request_received_date <= p_to_date
    )
    and (
      p_search_text is null
      or p_search_text = ''
      or concat_ws(
        ' ',
        privacy_case.case_reference,
        privacy_case.case_type,
        privacy_case.status,
        privacy_case.priority,
        privacy_case.subject_name,
        privacy_case.subject_company,
        privacy_case.subject_email,
        privacy_case.subject_reference,
        privacy_case.search_text,
        privacy_case.reason,
        privacy_case.notes,
        privacy_case.outcome_summary,
        privacy_case.legacy_reference
      ) ilike '%' || p_search_text || '%'
    )
  order by
    coalesce(privacy_case.request_received_date, privacy_case.created_at::date) desc,
    privacy_case.created_at desc;
end;
$$;

create or replace function public.get_privacy_case(p_case_id uuid)
returns table (
  id uuid,
  case_reference text,
  case_type text,
  request_type text,
  status text,
  priority text,
  subject_name text,
  subject_company text,
  subject_email text,
  subject_reference text,
  search_text text,
  requester_name text,
  requester_contact text,
  request_received_date date,
  request_received_at timestamptz,
  due_date date,
  completed_date date,
  completed_at timestamptz,
  reason text,
  notes text,
  outcome_summary text,
  legacy_reference text,
  identity_verified boolean,
  identity_verification_method text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid,
  updated_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_privacy_cases() then
    raise exception 'Permission denied for privacy cases';
  end if;

  return query
  select listed_case.*
  from public.list_privacy_cases() listed_case
  where listed_case.id = p_case_id;
end;
$$;

create or replace function public.create_privacy_case(
  p_case_type text default 'access',
  p_status text default 'open',
  p_subject_name text default null,
  p_subject_company text default null,
  p_subject_email text default null,
  p_subject_reference text default null,
  p_search_text text default null,
  p_request_received_date date default null,
  p_due_date date default null,
  p_reason text default null,
  p_notes text default null,
  p_outcome_summary text default null,
  p_legacy_reference text default null
)
returns table (
  id uuid,
  case_reference text,
  case_type text,
  request_type text,
  status text,
  priority text,
  subject_name text,
  subject_company text,
  subject_email text,
  subject_reference text,
  search_text text,
  requester_name text,
  requester_contact text,
  request_received_date date,
  request_received_at timestamptz,
  due_date date,
  completed_date date,
  completed_at timestamptz,
  reason text,
  notes text,
  outcome_summary text,
  legacy_reference text,
  identity_verified boolean,
  identity_verification_method text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid,
  updated_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  created_case_id uuid;
begin
  if not public.can_manage_privacy_cases() then
    raise exception 'Permission denied for managing privacy cases';
  end if;

  insert into public.privacy_cases (
    case_type,
    status,
    subject_name,
    subject_company,
    subject_email,
    subject_reference,
    search_text,
    request_received_date,
    due_date,
    reason,
    notes,
    outcome_summary,
    legacy_reference,
    created_by,
    updated_by
  )
  values (
    coalesce(nullif(p_case_type, ''), 'access'),
    coalesce(nullif(p_status, ''), 'open'),
    nullif(p_subject_name, ''),
    nullif(p_subject_company, ''),
    nullif(p_subject_email, ''),
    nullif(p_subject_reference, ''),
    nullif(p_search_text, ''),
    p_request_received_date,
    p_due_date,
    nullif(p_reason, ''),
    nullif(p_notes, ''),
    nullif(p_outcome_summary, ''),
    nullif(p_legacy_reference, ''),
    auth.uid(),
    auth.uid()
  )
  returning privacy_cases.id into created_case_id;

  return query
  select created_case.*
  from public.get_privacy_case(created_case_id) created_case;
end;
$$;

create or replace function public.update_privacy_case(
  p_case_id uuid,
  p_case_type text default 'access',
  p_status text default 'open',
  p_subject_name text default null,
  p_subject_company text default null,
  p_subject_email text default null,
  p_subject_reference text default null,
  p_search_text text default null,
  p_request_received_date date default null,
  p_due_date date default null,
  p_reason text default null,
  p_notes text default null,
  p_outcome_summary text default null,
  p_legacy_reference text default null
)
returns table (
  id uuid,
  case_reference text,
  case_type text,
  request_type text,
  status text,
  priority text,
  subject_name text,
  subject_company text,
  subject_email text,
  subject_reference text,
  search_text text,
  requester_name text,
  requester_contact text,
  request_received_date date,
  request_received_at timestamptz,
  due_date date,
  completed_date date,
  completed_at timestamptz,
  reason text,
  notes text,
  outcome_summary text,
  legacy_reference text,
  identity_verified boolean,
  identity_verification_method text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid,
  updated_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_privacy_cases() then
    raise exception 'Permission denied for managing privacy cases';
  end if;

  update public.privacy_cases privacy_case
  set
    case_type = coalesce(nullif(p_case_type, ''), privacy_case.case_type),
    status = coalesce(nullif(p_status, ''), privacy_case.status),
    subject_name = nullif(p_subject_name, ''),
    subject_company = nullif(p_subject_company, ''),
    subject_email = nullif(p_subject_email, ''),
    subject_reference = nullif(p_subject_reference, ''),
    search_text = nullif(p_search_text, ''),
    request_received_date = p_request_received_date,
    due_date = p_due_date,
    reason = nullif(p_reason, ''),
    notes = nullif(p_notes, ''),
    outcome_summary = nullif(p_outcome_summary, ''),
    legacy_reference = nullif(p_legacy_reference, ''),
    updated_by = auth.uid()
  where privacy_case.id = p_case_id;

  if not found then
    raise exception 'Privacy case not found';
  end if;

  return query
  select updated_case.*
  from public.get_privacy_case(p_case_id) updated_case;
end;
$$;

create or replace function public.add_privacy_case_event(
  p_case_id uuid,
  p_event_type text default 'note',
  p_title text default null,
  p_details text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  case_id uuid,
  event_type text,
  title text,
  details text,
  metadata jsonb,
  created_at timestamptz,
  created_by uuid,
  created_by_name text,
  note_type text,
  note_text text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  created_event_id uuid;
begin
  if not public.can_manage_privacy_cases() then
    raise exception 'Permission denied for managing privacy case events';
  end if;

  if not exists (
    select 1
    from public.privacy_cases privacy_case
    where privacy_case.id = p_case_id
  ) then
    raise exception 'Privacy case not found';
  end if;

  insert into public.privacy_case_events (
    case_id,
    event_type,
    title,
    details,
    metadata,
    created_by
  )
  values (
    p_case_id,
    coalesce(nullif(p_event_type, ''), 'note'),
    nullif(p_title, ''),
    nullif(p_details, ''),
    coalesce(p_metadata, '{}'::jsonb),
    auth.uid()
  )
  returning privacy_case_events.id into created_event_id;

  return query
  select event_row.*
  from public.list_privacy_case_events(p_case_id) event_row
  where event_row.id = created_event_id;
end;
$$;

create or replace function public.list_privacy_case_events(p_case_id uuid)
returns table (
  id uuid,
  case_id uuid,
  event_type text,
  title text,
  details text,
  metadata jsonb,
  created_at timestamptz,
  created_by uuid,
  created_by_name text,
  note_type text,
  note_text text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_privacy_cases() then
    raise exception 'Permission denied for privacy case events';
  end if;

  return query
  select
    event_row.id,
    event_row.case_id,
    event_row.event_type,
    event_row.title,
    event_row.details,
    event_row.metadata,
    event_row.created_at,
    event_row.created_by,
    coalesce(profile.display_name, 'Unknown') as created_by_name,
    event_row.event_type as note_type,
    coalesce(event_row.title, event_row.details, event_row.event_type) as note_text
  from public.privacy_case_events event_row
  left join public.profiles profile
    on profile.id = event_row.created_by
  where event_row.case_id = p_case_id
  order by event_row.created_at desc;
end;
$$;

create or replace function public.add_privacy_case_record_link(
  p_case_id uuid,
  p_record_type text,
  p_record_id text,
  p_source_module text default null,
  p_link_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  case_id uuid,
  record_type text,
  record_id text,
  source_module text,
  link_reason text,
  metadata jsonb,
  created_at timestamptz,
  created_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  created_link_id uuid;
begin
  if not public.can_manage_privacy_cases() then
    raise exception 'Permission denied for managing privacy case links';
  end if;

  if not exists (
    select 1
    from public.privacy_cases privacy_case
    where privacy_case.id = p_case_id
  ) then
    raise exception 'Privacy case not found';
  end if;

  insert into public.privacy_case_record_links (
    case_id,
    record_type,
    record_id,
    source_module,
    link_reason,
    metadata,
    created_by
  )
  values (
    p_case_id,
    nullif(p_record_type, ''),
    nullif(p_record_id, ''),
    nullif(p_source_module, ''),
    nullif(p_link_reason, ''),
    coalesce(p_metadata, '{}'::jsonb),
    auth.uid()
  )
  on conflict (case_id, record_type, record_id) do update
  set
    source_module = excluded.source_module,
    link_reason = excluded.link_reason,
    metadata = excluded.metadata
  returning privacy_case_record_links.id into created_link_id;

  return query
  select record_link.*
  from public.list_privacy_case_record_links(p_case_id) record_link
  where record_link.id = created_link_id;
end;
$$;

create or replace function public.list_privacy_case_record_links(p_case_id uuid)
returns table (
  id uuid,
  case_id uuid,
  record_type text,
  record_id text,
  source_module text,
  link_reason text,
  metadata jsonb,
  created_at timestamptz,
  created_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_privacy_cases() then
    raise exception 'Permission denied for privacy case links';
  end if;

  return query
  select
    record_link.id,
    record_link.case_id,
    record_link.record_type,
    record_link.record_id,
    record_link.source_module,
    record_link.link_reason,
    record_link.metadata,
    record_link.created_at,
    record_link.created_by
  from public.privacy_case_record_links record_link
  where record_link.case_id = p_case_id
  order by record_link.created_at desc;
end;
$$;

grant execute on function public.list_privacy_cases(text, text, text, date, date) to authenticated;
grant execute on function public.get_privacy_case(uuid) to authenticated;
grant execute on function public.create_privacy_case(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  text
) to authenticated;
grant execute on function public.update_privacy_case(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  text
) to authenticated;
grant execute on function public.add_privacy_case_event(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.list_privacy_case_events(uuid) to authenticated;
grant execute on function public.add_privacy_case_record_link(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.list_privacy_case_record_links(uuid) to authenticated;

-- ============================================================
-- Verification
-- ============================================================

select
  'OH-048D privacy case workspace SQL alignment installed' as result,
  (
    select count(*)
    from public.capabilities
    where capability_code in (
      'privacy.view',
      'privacy.manage',
      'privacy.case.view',
      'privacy.case.manage',
      'gdpr.view',
      'gdpr.manage'
    )
  ) as privacy_capability_count,
  to_regclass('public.privacy_cases') is not null as privacy_cases_ready,
  to_regclass('public.privacy_case_events') is not null as privacy_case_events_ready,
  to_regclass('public.privacy_case_record_links') is not null as privacy_case_record_links_ready;
