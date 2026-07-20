-- ============================================================
-- Operations Hub - OHP-017C.2
-- Branding Contrast and Preview Consistency
--
-- Purpose:
-- - Add controlled branded text contrast setting.
-- - Fix preview/app mismatch for branded button/navigation text.
--
-- Safety:
-- - No free arbitrary branded text colour picker.
-- - Admin can choose auto/light/dark contrast only.
-- - Normal app/body text is not affected.
-- ============================================================

create extension if not exists pgcrypto;

insert into public.application_setting_definitions (
  setting_key,
  category_code,
  setting_name,
  description,
  value_type,
  default_value,
  allowed_values,
  validation_json,
  locked_by_system,
  sensitive,
  active,
  display_order,
  ui_component,
  help_text
)
values (
  'branding.brand_contrast_mode',
  'branding',
  'Branded text contrast mode',
  'Controls text colour on branded surfaces such as primary buttons and active navigation.',
  'select',
  to_jsonb('auto'::text),
  jsonb_build_array('auto', 'light_text', 'dark_text'),
  '{}'::jsonb,
  false,
  false,
  true,
  56,
  'select',
  'Auto is recommended. This affects branded buttons/navigation only, not normal body text.'
)
on conflict (setting_key) do update
set
  category_code = excluded.category_code,
  setting_name = excluded.setting_name,
  description = excluded.description,
  value_type = excluded.value_type,
  default_value = excluded.default_value,
  allowed_values = excluded.allowed_values,
  validation_json = excluded.validation_json,
  locked_by_system = excluded.locked_by_system,
  sensitive = excluded.sensitive,
  active = excluded.active,
  display_order = excluded.display_order,
  ui_component = excluded.ui_component,
  help_text = excluded.help_text;

insert into public.application_setting_values (
  setting_key,
  setting_value,
  updated_by
)
select
  d.setting_key,
  d.default_value,
  auth.uid()
from public.application_setting_definitions d
where d.setting_key = 'branding.brand_contrast_mode'
on conflict (setting_key) do nothing;

update public.application_setting_definitions
set
  default_value = to_jsonb('#475569'::text),
  help_text = 'Use a hex colour value, for example #475569.'
where setting_key = 'branding.primary_color';

update public.application_setting_values
set
  setting_value = to_jsonb('#475569'::text),
  updated_at = now(),
  updated_by = auth.uid()
where setting_key = 'branding.primary_color'
  and setting_value in (
    to_jsonb('#2563eb'::text),
    to_jsonb('#1f4f8f'::text)
  );

notify pgrst, 'reload schema';

select
  'OHP-017C.2 branding contrast mode installed' as result,
  (
    select count(*)
    from public.application_setting_definitions
    where setting_key = 'branding.brand_contrast_mode'
  ) as setting_verified;
