alter table public.ai_query_semantic_fields
  drop constraint ai_query_semantic_fields_value_kind_check;

alter table public.ai_query_semantic_fields
  add constraint ai_query_semantic_fields_value_kind_check
  check (value_kind in ('entity', 'number', 'identifier_range', 'date_range', 'service_life_status', 'data_quality'));

alter table public.asset_records
  add column if not exists asset_major_class text generated always as (
    case
      when asset_no like '111%' then '土地改良物'
      when asset_no like '1%' then '土地'
      when asset_no like '2%' then '房屋建築及設備'
      when asset_no like '3%' then '機械及設備'
      when asset_no like '4%' then '交通及運輸設備'
      when asset_no like '5%' then '什項設備'
      when asset_no like '6%' then '非消耗品'
      else null
    end
  ) stored;

create index if not exists asset_records_current_major_class_idx
  on public.asset_records (asset_major_class)
  where is_current and asset_major_class is not null;

update public.ai_query_semantic_fields
set configuration = configuration || '{"analysis":["group"]}'::jsonb,
    updated_at = now()
where field_key = 'category_type';

insert into public.ai_query_semantic_fields (field_key, label, value_kind, column_name, operators, configuration)
values
  ('asset_major_class', '財產大類', 'entity', 'asset_major_class', array['contains', '=', 'not'], '{"analysis":["group"]}'::jsonb),
  ('data_quality', '資料品質', 'data_quality', null, array['quality'], '{"checks":["missing_custodian","missing_location","missing_acquired_at","missing_useful_life","unit_mismatch","person_mismatch"]}'::jsonb)
on conflict (field_key) do update set
  label = excluded.label,
  value_kind = excluded.value_kind,
  column_name = excluded.column_name,
  operators = excluded.operators,
  configuration = excluded.configuration,
  is_active = true,
  updated_at = now();

insert into public.ai_query_index_values (field_name, normalized_value, display_value, record_count, updated_at)
select '財產大類', lower(asset_major_class), min(asset_major_class), count(*)::integer, now()
from public.asset_records
where is_current and nullif(btrim(asset_major_class), '') is not null
group by lower(asset_major_class)
on conflict (field_name, normalized_value) do update set
  display_value = excluded.display_value,
  record_count = excluded.record_count,
  updated_at = excluded.updated_at;

insert into public.ai_search_terms (asset_record_id, asset_identity_id, entity_type, field_name, normalized_value, display_value)
select id, identity_id, 'asset', '財產大類', lower(asset_major_class), asset_major_class
from public.asset_records
where is_current and nullif(btrim(asset_major_class), '') is not null
on conflict (asset_record_id, field_name) do update set
  normalized_value = excluded.normalized_value,
  display_value = excluded.display_value;
