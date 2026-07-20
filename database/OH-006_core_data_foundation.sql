-- ============================================================
-- Operations Hub - OH-006 Core Data Foundation
-- Foundation only. No existing Visitor app behaviour changed.
-- ============================================================

create extension if not exists pgcrypto;

create or replace function public.oh_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- Sites
-- ============================================================

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  site_code text unique,
  site_name text not null,
  timezone text not null default 'Europe/London',
  address_line_1 text,
  address_line_2 text,
  town_city text,
  county_region text,
  postcode text,
  country text default 'United Kingdom',
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_sites_updated_at on public.sites;
create trigger trg_sites_updated_at
before update on public.sites
for each row execute function public.oh_set_updated_at();

-- ============================================================
-- Organisations
-- ============================================================

create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  organisation_code text unique,
  organisation_name text not null,
  organisation_type text not null default 'other',
  email text,
  phone text,
  address_line_1 text,
  address_line_2 text,
  town_city text,
  county_region text,
  postcode text,
  country text default 'United Kingdom',
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_organisations_updated_at on public.organisations;
create trigger trg_organisations_updated_at
before update on public.organisations
for each row execute function public.oh_set_updated_at();

-- ============================================================
-- People
-- ============================================================

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  external_person_number text unique,
  first_name text not null,
  last_name text,
  preferred_name text,
  display_name text not null,
  email text,
  phone text,
  photo_url text,
  date_of_birth date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_people_updated_at on public.people;
create trigger trg_people_updated_at
before update on public.people
for each row execute function public.oh_set_updated_at();

-- ============================================================
-- Departments
-- ============================================================

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references public.sites(id),
  department_code text,
  department_name text not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_departments_site_code
on public.departments(site_id, department_code)
where department_code is not null;

drop trigger if exists trg_departments_updated_at on public.departments;
create trigger trg_departments_updated_at
before update on public.departments
for each row execute function public.oh_set_updated_at();

-- ============================================================
-- Contracts
-- ============================================================

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references public.sites(id),
  customer_organisation_id uuid references public.organisations(id),
  contract_code text,
  contract_name text not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_contracts_site_code
on public.contracts(site_id, contract_code)
where contract_code is not null;

drop trigger if exists trg_contracts_updated_at on public.contracts;
create trigger trg_contracts_updated_at
before update on public.contracts
for each row execute function public.oh_set_updated_at();

-- ============================================================
-- Job Roles
-- ============================================================

create table if not exists public.job_roles (
  id uuid primary key default gen_random_uuid(),
  role_code text unique,
  role_name text not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_job_roles_updated_at on public.job_roles;
create trigger trg_job_roles_updated_at
before update on public.job_roles
for each row execute function public.oh_set_updated_at();

-- ============================================================
-- Shift Patterns
-- ============================================================

create table if not exists public.shift_patterns (
  id uuid primary key default gen_random_uuid(),
  shift_code text unique,
  shift_name text not null,
  pattern_type text not null default 'static',
  static_weekdays jsonb,
  cycle_pattern jsonb,
  cycle_length_days integer,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_shift_pattern_type
    check (pattern_type in ('static', 'rotating', 'ad_hoc'))
);

drop trigger if exists trg_shift_patterns_updated_at on public.shift_patterns;
create trigger trg_shift_patterns_updated_at
before update on public.shift_patterns
for each row execute function public.oh_set_updated_at();

-- ============================================================
-- Break Rules
-- ============================================================

create table if not exists public.break_rules (
  id uuid primary key default gen_random_uuid(),
  break_rule_code text unique,
  break_rule_name text not null,
  break_minutes integer not null default 0,
  paid_break boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_break_minutes_non_negative check (break_minutes >= 0)
);

drop trigger if exists trg_break_rules_updated_at on public.break_rules;
create trigger trg_break_rules_updated_at
before update on public.break_rules
for each row execute function public.oh_set_updated_at();

-- ============================================================
-- Work Assignments
-- ============================================================

create table if not exists public.work_assignments (
  id uuid primary key default gen_random_uuid(),

  person_id uuid not null references public.people(id),
  site_id uuid references public.sites(id),
  employer_organisation_id uuid references public.organisations(id),
  department_id uuid references public.departments(id),
  contract_id uuid references public.contracts(id),
  job_role_id uuid references public.job_roles(id),
  manager_person_id uuid references public.people(id),

  assignment_type text not null default 'direct_employee',

  shift_pattern_id uuid references public.shift_patterns(id),
  break_rule_id uuid references public.break_rules(id),

  shift_start_time time,
  shift_end_time time,
  cycle_anchor_date date,

  employment_start_date date,
  assignment_start_date date not null default current_date,
  assignment_end_date date,

  active boolean not null default true,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_assignment_type check (
    assignment_type in (
      'direct_employee',
      'agency_worker',
      'contractor',
      'supplier_contact',
      'visitor_contact',
      'other'
    )
  ),

  constraint chk_assignment_dates check (
    assignment_end_date is null
    or assignment_end_date >= assignment_start_date
  )
);

create index if not exists ix_work_assignments_person
on public.work_assignments(person_id);

create index if not exists ix_work_assignments_site
on public.work_assignments(site_id);

create index if not exists ix_work_assignments_active_dates
on public.work_assignments(active, assignment_start_date, assignment_end_date);

drop trigger if exists trg_work_assignments_updated_at on public.work_assignments;
create trigger trg_work_assignments_updated_at
before update on public.work_assignments
for each row execute function public.oh_set_updated_at();

-- ============================================================
-- Current Assignment Helper View
-- ============================================================

create or replace view public.v_current_work_assignments as
select
  wa.*,
  p.external_person_number,
  p.display_name,
  s.site_name,
  o.organisation_name as employer_name,
  d.department_name,
  c.contract_name,
  jr.role_name as job_role_name,
  sp.shift_name,
  br.break_rule_name,
  br.break_minutes,
  br.paid_break
from public.work_assignments wa
join public.people p on p.id = wa.person_id
left join public.sites s on s.id = wa.site_id
left join public.organisations o on o.id = wa.employer_organisation_id
left join public.departments d on d.id = wa.department_id
left join public.contracts c on c.id = wa.contract_id
left join public.job_roles jr on jr.id = wa.job_role_id
left join public.shift_patterns sp on sp.id = wa.shift_pattern_id
left join public.break_rules br on br.id = wa.break_rule_id
where wa.active = true
  and wa.assignment_start_date <= current_date
  and (
    wa.assignment_end_date is null
    or wa.assignment_end_date >= current_date
  );

-- ============================================================
-- RLS
-- No frontend access policies yet.
-- Future OH milestones will add capability-based policies.
-- ============================================================

alter table public.sites enable row level security;
alter table public.organisations enable row level security;
alter table public.people enable row level security;
alter table public.departments enable row level security;
alter table public.contracts enable row level security;
alter table public.job_roles enable row level security;
alter table public.shift_patterns enable row level security;
alter table public.break_rules enable row level security;
alter table public.work_assignments enable row level security;

-- ============================================================
-- Verification
-- ============================================================

select
  'OH-006 core data foundation installed' as result;