create policy "service role manages AI query semantic catalog"
  on public.ai_query_semantic_fields for all to service_role
  using (true)
  with check (true);
