alter table public.user_ai_settings
  add column gemini_model text not null default 'gemini-3.5-flash-lite';

alter table public.user_ai_settings
  add constraint user_ai_settings_gemini_model_format
  check (gemini_model ~ '^gemini-[a-z0-9.-]+$');
