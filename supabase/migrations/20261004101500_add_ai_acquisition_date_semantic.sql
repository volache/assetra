alter table public.ai_query_semantic_fields
  drop constraint ai_query_semantic_fields_value_kind_check;

alter table public.ai_query_semantic_fields
  add constraint ai_query_semantic_fields_value_kind_check
  check (value_kind in ('entity', 'number', 'identifier_range', 'date_range'));

insert into public.ai_query_semantic_fields (field_key, label, value_kind, column_name, operators, configuration)
values ('acquired_at', '購置日期', 'date_range', 'acquired_at', array['range', 'relative'], '{"timezone":"Asia/Taipei","relativeUnits":["day","week","month","year"]}'::jsonb)
on conflict (field_key) do update set
  label = excluded.label,
  value_kind = excluded.value_kind,
  column_name = excluded.column_name,
  operators = excluded.operators,
  configuration = excluded.configuration,
  is_active = true,
  updated_at = now();
