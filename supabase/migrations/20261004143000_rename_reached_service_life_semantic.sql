update public.ai_query_semantic_fields
set label = '已達年限',
    configuration = jsonb_set(configuration, '{rule}', '"已達年限:true"'::jsonb),
    updated_at = now()
where field_key = 'service_life_expired';
