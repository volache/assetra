insert into public.ai_query_semantic_fields (field_key, label, value_kind, column_name, operators, configuration) values
  ('depreciation', '折舊', 'number', 'depreciation', array['=', '>', '>=', '<', '<='], '{}'::jsonb),
  ('useful_life', '耐用年限', 'number', 'useful_life', array['=', '>', '>=', '<', '<='], '{}'::jsonb)
on conflict (field_key) do update set
  label = excluded.label,
  value_kind = excluded.value_kind,
  column_name = excluded.column_name,
  operators = excluded.operators,
  configuration = excluded.configuration,
  is_active = true,
  updated_at = now();
