create table public.asset_photos (
  id uuid primary key default gen_random_uuid(),
  asset_identity_id uuid not null references public.asset_identities(id) on delete restrict,
  object_key text not null unique,
  original_filename text not null,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  category text not null default 'general' check (category in ('general', 'location', 'identification', 'composition', 'tag', 'evidence')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index asset_photos_identity_created_idx on public.asset_photos (asset_identity_id, created_at desc);
create index asset_photos_created_by_idx on public.asset_photos (created_by);

alter table public.asset_photos enable row level security;
revoke all on table public.asset_photos from anon, authenticated;
grant select, insert, update, delete on table public.asset_photos to service_role;
