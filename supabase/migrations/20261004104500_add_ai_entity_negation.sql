update public.ai_query_semantic_fields
set operators = array_append(operators, 'not'), updated_at = now()
where value_kind = 'entity' and not ('not' = any(operators));
