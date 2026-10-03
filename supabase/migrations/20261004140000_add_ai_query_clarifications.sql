create table public.ai_query_clarifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  candidates jsonb not null default '[]'::jsonb,
  choices jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null default now() + interval '30 minutes',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index ai_query_clarifications_active_idx
  on public.ai_query_clarifications (user_id, expires_at)
  where resolved_at is null;

alter table public.ai_query_clarifications enable row level security;
revoke all on table public.ai_query_clarifications from anon, authenticated;
grant select, insert, update, delete on table public.ai_query_clarifications to service_role;
