-- ============================================================
-- Operations Hub - OH-030 Visitor Sign-out Capability RLS
-- Align native staff sign-out with the visitor.sign_out capability.
-- ============================================================

grant update on public.visit_log to authenticated;

alter table public.visit_log enable row level security;

drop policy if exists "capability can sign out visits" on public.visit_log;

create policy "capability can sign out visits"
on public.visit_log
for update
to authenticated
using (
  public.user_has_capability('visitor.sign_out')
  and sign_out_time is null
)
with check (
  public.user_has_capability('visitor.sign_out')
  and sign_out_time is not null
  and visit_status = 'signed_out'
);

select 'OH-030 visitor sign-out capability RLS installed' as result;
