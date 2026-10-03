create table public.user_ai_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  gemini_key_ciphertext text,
  gemini_key_iv text,
  updated_at timestamptz not null default now(),
  check ((gemini_key_ciphertext is null) = (gemini_key_iv is null))
);

alter table public.user_ai_settings enable row level security;
revoke all on table public.user_ai_settings from anon, authenticated;
grant select, insert, update, delete on table public.user_ai_settings to service_role;
