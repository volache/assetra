-- Private ownership certificates live in R2.  Postgres stores only the
-- searchable index and audit trail; never a public object URL or file bytes.
create table public.ownership_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in ('land', 'building')),
  land_parcel_id uuid references public.land_parcels(id) on delete cascade,
  building_number text,
  r2_key text not null unique,
  original_filename text not null,
  mime_type text not null default 'application/pdf'
    check (mime_type = 'application/pdf'),
  file_size bigint check (file_size is null or file_size > 0),
  sha256 text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'superseded', 'deleted')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  activated_at timestamptz,
  activated_by uuid references public.profiles(id) on delete set null,
  replaces_document_id uuid references public.ownership_documents(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  check (
    (document_type = 'land' and land_parcel_id is not null)
    or (document_type = 'building' and nullif(trim(building_number), '') is not null)
  )
);

create index ownership_documents_land_status_idx
  on public.ownership_documents (land_parcel_id, status, created_at desc);
create index ownership_documents_building_status_idx
  on public.ownership_documents (building_number, status, created_at desc);

create table public.ownership_document_access_logs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.ownership_documents(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('view', 'download', 'upload', 'delete')),
  created_at timestamptz not null default now()
);

create index ownership_document_access_logs_document_idx
  on public.ownership_document_access_logs (document_id, created_at desc);

alter table public.ownership_documents enable row level security;
alter table public.ownership_document_access_logs enable row level security;

-- Access is mediated by the Edge Function.  These policies preserve the
-- existing land-parcel rule: active administrators may manage the index.
create policy "admins read ownership document index"
on public.ownership_documents for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
);

create policy "admins manage ownership document index"
on public.ownership_documents for all to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
)
with check (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
);

create policy "admins read ownership document access logs"
on public.ownership_document_access_logs for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
);

grant all on public.ownership_documents, public.ownership_document_access_logs to service_role;
