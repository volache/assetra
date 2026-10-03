-- The semantic catalog is the query contract between the language model and
-- the compiler. It describes capabilities, never inventory facts.
create table public.ai_query_semantic_fields (
  field_key text primary key,
  label text not null unique,
  value_kind text not null check (value_kind in ('entity', 'number', 'identifier_range')),
  column_name text,
  entity_type text,
  operators text[] not null default '{}',
  configuration jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_query_semantic_fields enable row level security;
revoke all on table public.ai_query_semantic_fields from anon, authenticated;
grant select, insert, update, delete on table public.ai_query_semantic_fields to service_role;

insert into public.ai_query_semantic_fields (field_key, label, value_kind, column_name, entity_type, operators, configuration) values
  ('custodian', '保管人', 'entity', 'custodian_name', 'person', array['contains', '='], '{}'::jsonb),
  ('user', '使用人', 'entity', 'user_name', 'person', array['contains', '='], '{}'::jsonb),
  ('unit', '保管單位', 'entity', 'unit_name', 'unit', array['contains', '='], '{}'::jsonb),
  ('use_unit', '使用單位', 'entity', 'use_unit_name', 'unit', array['contains', '='], '{}'::jsonb),
  ('location', '存置地點', 'entity', 'location_name', 'location', array['contains', '='], '{}'::jsonb),
  ('name', '財產名稱', 'entity', 'name', 'asset', array['contains', '='], '{}'::jsonb),
  ('category_name', '財產別名', 'entity', 'category_name', 'asset', array['contains', '='], '{}'::jsonb),
  ('category_type', '財產區分別', 'entity', 'category_type', 'asset', array['contains', '='], '{}'::jsonb),
  ('status', '使用現況', 'entity', 'status', 'status', array['contains', '='], '{}'::jsonb),
  ('brand', '廠牌', 'entity', 'brand', 'brand', array['contains', '='], '{}'::jsonb),
  ('model', '型式', 'entity', 'model', 'brand', array['contains', '='], '{}'::jsonb),
  ('measure_unit', '計量單位', 'entity', 'measure_unit', 'measure', array['contains', '='], '{}'::jsonb),
  ('net_value', '淨值', 'number', 'net_value', null, array['=', '>', '>=', '<', '<='], '{}'::jsonb),
  ('original_value', '原值', 'number', 'original_value', null, array['=', '>', '>=', '<', '<='], '{}'::jsonb),
  ('quantity', '數量', 'number', 'quantity', null, array['=', '>', '>=', '<', '<='], '{}'::jsonb),
  ('asset_identifier', '財產編號', 'identifier_range', null, null, array['=', 'range'], '{"pattern":"7碼-4碼-7碼","storage":{"assetCode":"asset_no","serial":"serial_no"}}'::jsonb)
on conflict (field_key) do update set
  label = excluded.label,
  value_kind = excluded.value_kind,
  column_name = excluded.column_name,
  entity_type = excluded.entity_type,
  operators = excluded.operators,
  configuration = excluded.configuration,
  is_active = true,
  updated_at = now();

create index ai_query_semantic_fields_active_idx
  on public.ai_query_semantic_fields (is_active, value_kind);

create index asset_records_current_asset_serial_idx
  on public.asset_records (asset_no, serial_no)
  where is_current;
