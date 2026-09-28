-- Assetra cloud schema reference. Apply changes through migrations; do not rerun this file on an existing project.
create type public.app_role as enum ('custodian', 'chief', 'admin');
create type public.account_status as enum ('active', 'inactive');
create type public.source_type as enum ('asset', 'item');
create type public.import_status as enum ('draft', 'ready', 'committed', 'failed');
create type public.collaboration_kind as enum ('note', 'tag_missing', 'disposal_candidate', 'transfer_request', 'custodian_change', 'location_change', 'other');
create type public.collaboration_status as enum ('open', 'in_progress', 'resolved', 'cancelled');
create type public.reconciliation_status as enum ('open', 'resolved', 'dismissed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  account_code text not null,
  display_name text not null,
  title text,
  contact_email text,
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_code)
);
create table public.user_roles (user_id uuid not null references public.profiles(id) on delete cascade, role public.app_role not null, primary key (user_id, role));
create table public.user_custodians (user_id uuid not null references public.profiles(id) on delete cascade, custodian_code text not null, primary key (user_id, custodian_code));
create table public.user_units (user_id uuid not null references public.profiles(id) on delete cascade, unit_code text not null, primary key (user_id, unit_code));
create table public.audit_logs (id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id), target_user_id uuid references public.profiles(id), action text not null, details jsonb, created_at timestamptz not null default now());

create table public.imports (
  id uuid primary key default gen_random_uuid(), source_type public.source_type not null, file_name text not null,
  file_checksum text, record_count integer not null default 0, error_count integer not null default 0,
  status public.import_status not null default 'draft', summary jsonb not null default '{}'::jsonb, imported_by uuid not null references public.profiles(id),
  imported_at timestamptz not null default now(), committed_at timestamptz, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.asset_identities (
  id uuid primary key default gen_random_uuid(), source_type public.source_type not null,
  category_type_code text not null, asset_no text not null, serial_no text not null,
  first_seen_import_id uuid references public.imports(id) on delete set null,
  last_seen_import_id uuid references public.imports(id) on delete set null,
  last_seen_at timestamptz, is_present boolean not null default true,
  missing_since_import_id uuid references public.imports(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (source_type, category_type_code, asset_no, serial_no)
);
create table public.asset_records (
  id uuid primary key default gen_random_uuid(), import_id uuid references public.imports(id) on delete set null, identity_id uuid not null references public.asset_identities(id) on delete restrict,
  source_type public.source_type not null, category_type_code text not null, asset_no text not null, serial_no text not null, name text not null, old_no text, acquired_at date,
  unit_code text, unit_name text, use_unit_name text, location_code text, location_name text,
  custodian_code text, custodian_name text, user_code text, user_name text, quantity numeric(18,3) not null default 1,
  measure_unit text, original_value numeric(18,2) not null default 0, depreciation numeric(18,2) not null default 0,
  net_value numeric(18,2) not null default 0, useful_life integer, category_name text, category_type text,
  model text, brand text, notes text, status text, is_current boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (net_value <= original_value)
);
-- 清冊的業務主鍵：清冊類型＋區分別代碼＋財產編號＋流水號；技術 UUID 仍用於保留歷程版本。
create unique index asset_records_current_identity_idx on public.asset_records (source_type, category_type_code, asset_no, serial_no) where is_current;
create index asset_records_current_custodian_idx on public.asset_records (custodian_code) where is_current;
create index asset_records_current_unit_idx on public.asset_records (unit_code) where is_current;
create index asset_records_current_name_idx on public.asset_records (name) where is_current;
create index asset_records_import_id_idx on public.asset_records (import_id);
create index asset_records_identity_id_idx on public.asset_records (identity_id);
create index imports_imported_by_idx on public.imports (imported_by, imported_at desc);

create table public.import_batch_changes (
  id uuid primary key default gen_random_uuid(), import_id uuid not null references public.imports(id) on delete cascade,
  change_kind text not null, category_type_code text not null, asset_no text not null, serial_no text not null,
  asset_name text, before_record jsonb, after_record jsonb not null, created_at timestamptz not null default now()
);
create index import_batch_changes_import_kind_idx on public.import_batch_changes (import_id, change_kind);

create table public.asset_collaborations (
  id uuid primary key default gen_random_uuid(), asset_identity_id uuid not null references public.asset_identities(id) on delete restrict,
  kind public.collaboration_kind not null default 'note', status public.collaboration_status,
  body text not null, details jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id), updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  resolved_at timestamptz, resolved_by uuid references public.profiles(id)
);
alter table public.asset_collaborations add constraint asset_collaborations_note_or_task_status_check check ((kind = 'note' and status is null) or (kind <> 'note' and status is not null));
create index asset_identities_first_seen_import_idx on public.asset_identities (first_seen_import_id);
create index asset_identities_last_seen_import_idx on public.asset_identities (last_seen_import_id);
create index asset_identities_missing_since_import_idx on public.asset_identities (missing_since_import_id);
create index asset_collaborations_identity_status_idx on public.asset_collaborations (asset_identity_id, status, created_at desc);
create index asset_collaborations_created_by_idx on public.asset_collaborations (created_by);
create index asset_collaborations_updated_by_idx on public.asset_collaborations (updated_by);
create index asset_collaborations_resolved_by_idx on public.asset_collaborations (resolved_by);
create table public.asset_collaboration_events (
  id uuid primary key default gen_random_uuid(), collaboration_id uuid not null references public.asset_collaborations(id) on delete cascade,
  event_type text not null, payload jsonb not null default '{}'::jsonb, actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index asset_collaboration_events_collaboration_idx on public.asset_collaboration_events (collaboration_id, created_at);
create index asset_collaboration_events_actor_idx on public.asset_collaboration_events (actor_id);
create table public.asset_identity_exceptions (
  id uuid primary key default gen_random_uuid(), asset_identity_id uuid not null references public.asset_identities(id) on delete restrict,
  detected_in_import_id uuid references public.imports(id) on delete set null, status public.reconciliation_status not null default 'open',
  reason text not null, details jsonb not null default '{}'::jsonb, resolved_at timestamptz,
  resolved_by uuid references public.profiles(id), resolution text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (asset_identity_id, detected_in_import_id, reason)
);
create index asset_identity_exceptions_open_idx on public.asset_identity_exceptions (status, created_at) where status = 'open';
create index asset_identity_exceptions_detected_import_idx on public.asset_identity_exceptions (detected_in_import_id);
create index asset_identity_exceptions_resolved_by_idx on public.asset_identity_exceptions (resolved_by);

-- Client reads are RLS-scoped. Management and import writes are Edge Functions using service_role.
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_custodians enable row level security;
alter table public.user_units enable row level security;
alter table public.audit_logs enable row level security;
alter table public.imports enable row level security;
alter table public.asset_records enable row level security;
alter table public.import_batch_changes enable row level security;
alter table public.asset_identities enable row level security;
alter table public.asset_collaborations enable row level security;
alter table public.asset_collaboration_events enable row level security;
alter table public.asset_identity_exceptions enable row level security;

create policy "active users read permitted inventory" on public.asset_records for select to authenticated using (
  is_current and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active') and (
    exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
    or (exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'custodian')
      and exists (select 1 from public.user_custodians c where c.user_id = (select auth.uid()) and c.custodian_code = asset_records.custodian_code))
    or (exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'chief')
      and exists (select 1 from public.user_units u where u.user_id = (select auth.uid()) and u.unit_code = asset_records.unit_code))
  )
);
create policy "admins read import history" on public.imports for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
);
create policy "users read collaboration for visible inventory" on public.asset_collaborations for select to authenticated using (
  exists (select 1 from public.asset_records r where r.identity_id = asset_collaborations.asset_identity_id)
);
create policy "users read collaboration events for visible inventory" on public.asset_collaboration_events for select to authenticated using (
  exists (select 1 from public.asset_collaborations c where c.id = asset_collaboration_events.collaboration_id)
);
create policy "admins read reconciliation exceptions" on public.asset_identity_exceptions for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
);
create policy "asset identities are service managed" on public.asset_identities for select to authenticated using (false);

-- `commit_inventory_import` is defined by its migration and executable only by service_role.
