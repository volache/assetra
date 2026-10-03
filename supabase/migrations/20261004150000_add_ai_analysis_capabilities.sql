update public.ai_query_semantic_fields
set configuration = configuration || '{"analysis":["group"]}'::jsonb,
    updated_at = now()
where value_kind = 'entity';

update public.ai_query_semantic_fields
set configuration = configuration || '{"analysis":["sort","min","max"]}'::jsonb,
    updated_at = now()
where field_key = 'acquired_at';

update public.ai_query_semantic_fields
set configuration = configuration || '{"analysis":["sort","sum","average","min","max"]}'::jsonb,
    updated_at = now()
where value_kind = 'number';

update public.ai_query_semantic_fields
set configuration = configuration || '{"analysis":["count"]}'::jsonb,
    updated_at = now()
where field_key = 'service_life_expired';
