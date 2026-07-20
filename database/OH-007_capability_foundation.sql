-- ============================================================
-- Operations Hub - OH-007 Capability Foundation
-- Foundation only. No existing role/login behaviour changed.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- Capability Groups
-- ============================================================

create table if not exists public.capability_groups (
  id uuid primary key default gen_random_uuid(),
  group_code text not null unique,
  group_name text not null,
  description text,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_capability_groups_updated_at on public.capability_groups;
create trigger trg_capability_groups_updated_at
before update on public.capability_groups
for each row execute function public.oh_set_updated_at();

-- ============================================================
-- Capabilities
-- ============================================================

create table if not exists public.capabilities (
  id uuid primary key default gen_random_uuid(),
  capability_code text not null unique,
  capability_name text not null,
  group_id uuid references public.capability_groups(id),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_capabilities_updated_at on public.capabilities;
create trigger trg_capabilities_updated_at
before update on public.capabilities
for each row execute function public.oh_set_updated_at();

-- ============================================================
-- Role Presets
-- These preserve current role concepts while we transition.
-- ============================================================

create table if not exists public.role_presets (
  id uuid primary key default gen_random_uuid(),
  role_code text not null unique,
  role_name text not null,
  description text,
  is_system_role boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_role_presets_updated_at on public.role_presets;
create trigger trg_role_presets_updated_at
before update on public.role_presets
for each row execute function public.oh_set_updated_at();

-- ============================================================
-- Role Preset Capabilities
-- ============================================================

create table if not exists public.role_preset_capabilities (
  id uuid primary key default gen_random_uuid(),
  role_preset_id uuid not null references public.role_presets(id) on delete cascade,
  capability_id uuid not null references public.capabilities(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(role_preset_id, capability_id)
);

-- ============================================================
-- Profile Direct Capabilities
-- Optional per-user overrides for future use.
-- grant_state:
--   allow = user explicitly has capability
--   deny  = user explicitly does not have capability
-- ============================================================

create table if not exists public.profile_capabilities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  capability_id uuid not null references public.capabilities(id) on delete cascade,
  grant_state text not null default 'allow',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id, capability_id),
  constraint chk_profile_capability_grant_state
    check (grant_state in ('allow', 'deny'))
);

drop trigger if exists trg_profile_capabilities_updated_at on public.profile_capabilities;
create trigger trg_profile_capabilities_updated_at
before update on public.profile_capabilities
for each row execute function public.oh_set_updated_at();

-- ============================================================
-- Seed Capability Groups
-- ============================================================

insert into public.capability_groups (group_code, group_name, description, display_order)
values
  ('dashboard', 'Dashboard', 'Dashboard and home workspace access', 10),
  ('visitor', 'Visitors', 'Visitor planning, sign-in, sign-out and history', 20),
  ('people', 'People', 'People and organisation master data', 30),
  ('labour', 'Labour', 'Labour allocation and validation', 40),
  ('planning', 'Planning', 'Planning calendars and resource planning', 50),
  ('reporting', 'Reporting', 'Reports, exports and analytics', 60),
  ('administration', 'Administration', 'Users, settings, devices and system administration', 70),
  ('audit', 'Audit', 'Audit log visibility and export', 80)
on conflict (group_code) do update
set
  group_name = excluded.group_name,
  description = excluded.description,
  display_order = excluded.display_order;

-- ============================================================
-- Seed Capabilities
-- ============================================================

insert into public.capabilities (capability_code, capability_name, group_id, description)
select x.capability_code, x.capability_name, cg.id, x.description
from (
  values
    ('dashboard.view', 'View Dashboard', 'dashboard', 'Can view the Operations Hub dashboard'),

    ('visitor.view', 'View Visitors', 'visitor', 'Can view visitor records and visitor workspace'),
    ('visitor.create', 'Create Visitors', 'visitor', 'Can create planned visits and visitor records'),
    ('visitor.edit', 'Edit Visitors', 'visitor', 'Can edit visitor and planned visit records'),
    ('visitor.delete', 'Delete Visitors', 'visitor', 'Can delete planned visit records where allowed'),
    ('visitor.sign_in', 'Sign In Visitors', 'visitor', 'Can sign visitors in'),
    ('visitor.sign_out', 'Sign Out Visitors', 'visitor', 'Can sign visitors out'),
    ('visitor.history.view', 'View Visitor History', 'visitor', 'Can view visitor history'),
    ('visitor.history.edit', 'Edit Visitor History', 'visitor', 'Can edit visitor history where allowed'),
    ('visitor.export', 'Export Visitors', 'visitor', 'Can export visitor data'),
    ('visitor.print', 'Print Visitors', 'visitor', 'Can print visitor lists'),

    ('people.view', 'View People', 'people', 'Can view people and organisations'),
    ('people.manage', 'Manage People', 'people', 'Can create and edit people and organisations'),

    ('labour.view', 'View Labour', 'labour', 'Can view labour data'),
    ('labour.enter', 'Enter Labour', 'labour', 'Can enter labour allocations'),
    ('labour.validate', 'Validate Labour', 'labour', 'Can validate labour submissions'),
    ('labour.export', 'Export Labour', 'labour', 'Can export labour data'),

    ('planning.view', 'View Planning', 'planning', 'Can view planning calendars'),
    ('planning.manage', 'Manage Planning', 'planning', 'Can manage planning and resource calendars'),

    ('reports.view', 'View Reports', 'reporting', 'Can view reports and analytics'),
    ('reports.export', 'Export Reports', 'reporting', 'Can export reports'),

    ('settings.view', 'View Settings', 'administration', 'Can view system settings'),
    ('settings.edit', 'Edit Settings', 'administration', 'Can edit system settings'),
    ('users.view', 'View Users', 'administration', 'Can view user profiles'),
    ('users.manage', 'Manage Users', 'administration', 'Can create, edit, deactivate and reset users'),
    ('devices.view', 'View Devices', 'administration', 'Can view kiosk devices'),
    ('devices.manage', 'Manage Devices', 'administration', 'Can create, deactivate and regenerate kiosk devices'),

    ('audit.view', 'View Audit', 'audit', 'Can view audit events'),
    ('audit.export', 'Export Audit', 'audit', 'Can export audit events')
) as x(capability_code, capability_name, group_code, description)
join public.capability_groups cg on cg.group_code = x.group_code
on conflict (capability_code) do update
set
  capability_name = excluded.capability_name,
  group_id = excluded.group_id,
  description = excluded.description;

-- ============================================================
-- Seed Current Role Presets
-- Existing app behaviour still uses profiles.role for now.
-- These presets are foundation for future migration only.
-- ============================================================

insert into public.role_presets (role_code, role_name, description, is_system_role)
values
  ('general_user', 'General User', 'Current General User role mapped to future capabilities', true),
  ('security', 'Security', 'Current Security role mapped to future capabilities', true),
  ('super_user', 'SuperUser', 'Current SuperUser role mapped to future capabilities', true)
on conflict (role_code) do update
set
  role_name = excluded.role_name,
  description = excluded.description,
  is_system_role = excluded.is_system_role;

-- ============================================================
-- General User Capabilities
-- ============================================================

insert into public.role_preset_capabilities (role_preset_id, capability_id)
select rp.id, c.id
from public.role_presets rp
join public.capabilities c on c.capability_code in (
  'dashboard.view',
  'visitor.view',
  'visitor.create',
  'visitor.edit'
)
where rp.role_code = 'general_user'
on conflict do nothing;

-- ============================================================
-- Security Capabilities
-- ============================================================

insert into public.role_preset_capabilities (role_preset_id, capability_id)
select rp.id, c.id
from public.role_presets rp
join public.capabilities c on c.capability_code in (
  'dashboard.view',
  'visitor.view',
  'visitor.create',
  'visitor.edit',
  'visitor.sign_in',
  'visitor.sign_out',
  'visitor.history.view',
  'visitor.history.edit',
  'visitor.export',
  'visitor.print',
  'reports.view',
  'audit.view',
  'devices.view'
)
where rp.role_code = 'security'
on conflict do nothing;

-- ============================================================
-- SuperUser Capabilities
-- ============================================================

insert into public.role_preset_capabilities (role_preset_id, capability_id)
select rp.id, c.id
from public.role_presets rp
cross join public.capabilities c
where rp.role_code = 'super_user'
on conflict do nothing;

-- ============================================================
-- Helper View: Role Preset Capability List
-- ============================================================

create or replace view public.v_role_preset_capabilities as
select
  rp.role_code,
  rp.role_name,
  cg.group_code,
  cg.group_name,
  c.capability_code,
  c.capability_name,
  c.description
from public.role_presets rp
join public.role_preset_capabilities rpc on rpc.role_preset_id = rp.id
join public.capabilities c on c.id = rpc.capability_id
left join public.capability_groups cg on cg.id = c.group_id
where rp.active = true
  and c.active = true
order by rp.role_code, cg.display_order, c.capability_code;

-- ============================================================
-- RLS
-- Foundation only. No frontend access yet.
-- Future milestone will add policies once UI uses capabilities.
-- ============================================================

alter table public.capability_groups enable row level security;
alter table public.capabilities enable row level security;
alter table public.role_presets enable row level security;
alter table public.role_preset_capabilities enable row level security;
alter table public.profile_capabilities enable row level security;

-- ============================================================
-- Verification
-- ============================================================

select
  'OH-007 capability foundation installed' as result,
  (select count(*) from public.capabilities) as capability_count,
  (select count(*) from public.role_presets) as role_preset_count;
