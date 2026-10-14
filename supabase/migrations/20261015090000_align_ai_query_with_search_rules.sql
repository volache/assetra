-- Brings the AI query catalog in line with the keyword search rules.
--
--   * ai_fold_text() mirrors the spelling fold used by the search box
--     (臺 檯 -> 台, 汙 -> 污, 傢俱 傢具 家俱 -> 家具), so a value typed one way
--     finds the same record written another way.
--   * 備註 becomes searchable by the AI through a folded copy of the column.
--   * 有無照片 and 協作狀態 become catalog fields (they live in other tables,
--     so the function applies them after the asset query).
--   * the date semantic documents "before N units" as well as "within".

create or replace function public.ai_fold_text(value text)
returns text
language sql
immutable
parallel safe
as $$
  select replace(replace(replace(
    translate(lower(coalesce(value, '')), '臺檯汙', '台台污'),
    '傢俱', '家具'), '傢具', '家具'), '家俱', '家具')
$$;

alter table public.asset_records
  add column if not exists notes_folded text
  generated always as (public.ai_fold_text(notes)) stored;

create index if not exists asset_records_notes_folded_trgm_idx
  on public.asset_records using gin (notes_folded extensions.gin_trgm_ops)
  where is_current;

alter table public.ai_query_semantic_fields
  drop constraint if exists ai_query_semantic_fields_value_kind_check;

alter table public.ai_query_semantic_fields
  add constraint ai_query_semantic_fields_value_kind_check
  check (value_kind in (
    'entity', 'number', 'identifier_range', 'date_range',
    'service_life_status', 'data_quality', 'text', 'flag'
  ));

insert into public.ai_query_semantic_fields (field_key, label, value_kind, column_name, operators, configuration)
values
  ('notes', '備註', 'text', 'notes_folded', array['contains', 'not'], '{}'::jsonb),
  ('has_photo', '有無照片', 'flag', null, array['is'], '{"values":["with","without"]}'::jsonb),
  ('collaboration', '協作狀態', 'flag', null, array['is'], '{"values":["open","in_progress","any","none"]}'::jsonb)
on conflict (field_key) do update set
  label = excluded.label,
  value_kind = excluded.value_kind,
  column_name = excluded.column_name,
  operators = excluded.operators,
  configuration = excluded.configuration,
  is_active = true,
  updated_at = now();

update public.ai_query_semantic_fields
set configuration = configuration || '{"relativeDirections":["within","before"]}'::jsonb,
    updated_at = now()
where field_key = 'acquired_at';

update public.ai_query_semantic_fields
set configuration = configuration || '{"pattern":"7碼-4碼（品項）＋7碼流水號","forms":["單一件","同品項流水號區間","跨品項區間","整個品項"]}'::jsonb,
    updated_at = now()
where field_key = 'asset_identifier';
