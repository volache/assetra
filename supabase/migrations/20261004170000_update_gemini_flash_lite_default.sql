alter table public.user_ai_settings
  drop constraint if exists user_ai_settings_gemini_model_format;

alter table public.user_ai_settings
  alter column gemini_model set default 'gemini-flash-lite-latest';

alter table public.user_ai_settings
  add constraint user_ai_settings_gemini_model_format
  check (
    gemini_model ~ '^(gemini-flash-lite-latest|gemini-(3[.](5|[6-9]|[1-9][0-9]+)|[4-9][0-9]*([.][0-9]+)?)-[a-z0-9.-]+)$'
  );
