-- 財物清冊正式版資料結構。請在 Supabase SQL Editor 執行。
create type public.app_role as enum ('custodian', 'chief', 'admin');
create type public.source_type as enum ('asset', 'item');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);
create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  primary key (user_id, role)
);
create table public.user_custodians (
  user_id uuid not null references public.profiles(id) on delete cascade,
  custodian_code text not null,
  primary key (user_id, custodian_code)
);
create table public.user_units (
  user_id uuid not null references public.profiles(id) on delete cascade,
  unit_code text not null,
  primary key (user_id, unit_code)
);
create table public.imports (
  id uuid primary key default gen_random_uuid(),
  source_type public.source_type not null,
  file_name text not null,
  record_count integer not null,
  imported_by uuid not null references public.profiles(id),
  imported_at timestamptz not null default now()
);
create table public.asset_records (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references public.imports(id), source_type public.source_type not null,
  asset_no text not null, serial_no text not null, name text not null, old_no text,
  acquired_at text, unit_code text, unit_name text, location_code text, location_name text,
  custodian_code text, custodian_name text, quantity numeric, original_value numeric,
  depreciation numeric, net_value numeric, useful_life text, category_name text, model text,
  brand text, notes text, status text,
  unique (source_type, asset_no, serial_no)
);
create index asset_records_custodian_idx on public.asset_records(custodian_code);
create index asset_records_unit_idx on public.asset_records(unit_code);
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_custodians enable row level security;
alter table public.user_units enable row level security;
alter table public.imports enable row level security;
alter table public.asset_records enable row level security;

-- 角色資料僅能由本人讀取；管理端帳號與匯入寫入請透過安全的 server-side API 使用 service_role。
create policy "read own profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "read own roles" on public.user_roles for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own custodian mapping" on public.user_custodians for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own unit mapping" on public.user_units for select to authenticated using ((select auth.uid()) = user_id);
create policy "custodian or chief read permitted assets" on public.asset_records for select to authenticated using (
  exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
  or exists (select 1 from public.user_custodians c where c.user_id = (select auth.uid()) and c.custodian_code = asset_records.custodian_code)
  or exists (select 1 from public.user_units u join public.user_roles r on r.user_id = u.user_id and r.role = 'chief' where u.user_id = (select auth.uid()) and u.unit_code = asset_records.unit_code)
);
