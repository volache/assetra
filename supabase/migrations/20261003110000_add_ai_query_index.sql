create table public.ai_query_index_values (
  field_name text not null,
  normalized_value text not null,
  display_value text not null,
  record_count integer not null default 0 check (record_count > 0),
  updated_at timestamptz not null default now(),
  primary key (field_name, normalized_value)
);

alter table public.ai_query_index_values enable row level security;
revoke all on table public.ai_query_index_values from anon, authenticated;
grant select, insert, update, delete on table public.ai_query_index_values to service_role;

create index ai_query_index_values_field_count_idx
  on public.ai_query_index_values (field_name, record_count desc);

with index_sources as (
  select '保管單位'::text as field_name, unit_name as display_value from public.asset_records where is_current
  union all select '使用單位', use_unit_name from public.asset_records where is_current
  union all select '保管人', custodian_name from public.asset_records where is_current
  union all select '使用人', user_name from public.asset_records where is_current
  union all select '存置地點', location_name from public.asset_records where is_current
  union all select '財產名稱', name from public.asset_records where is_current
  union all select '財產別名', category_name from public.asset_records where is_current
  union all select '財產區分別', category_type from public.asset_records where is_current
  union all select '使用現況', status from public.asset_records where is_current
  union all select '廠牌', brand from public.asset_records where is_current
  union all select '型式', model from public.asset_records where is_current
  union all select '計量單位', measure_unit from public.asset_records where is_current
), cleaned as (
  select field_name, btrim(display_value) as display_value
  from index_sources
  where nullif(btrim(display_value), '') is not null
)
insert into public.ai_query_index_values (field_name, normalized_value, display_value, record_count)
select field_name, lower(display_value), min(display_value), count(*)::integer
from cleaned
group by field_name, lower(display_value);
