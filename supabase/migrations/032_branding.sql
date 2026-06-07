-- White-label branding, per instance. Logos + business_name already exist on
-- support_settings; add the app name and brand colours that drive the theme.
alter table public.support_settings add column if not exists app_name text;
alter table public.support_settings add column if not exists primary_color text;   -- hex, e.g. #15C26A
alter table public.support_settings add column if not exists secondary_color text; -- hex, e.g. #7C5CFF
