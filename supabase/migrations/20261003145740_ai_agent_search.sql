-- Search facts remain attached to concrete inventory rows so ordinary RLS also
-- limits every fact available to the AI agent.
create extension if not exists pg_trgm with schema extensions;

create table public.ai_search_terms (
  asset_record_id uuid not null references public.asset_records(id) on delete cascade,
  asset_identity_id uuid not null references public.asset_identities(id) on delete cascade,
  entity_type text not null check (entity_type in ('person', 'unit', 'location', 'asset', 'brand', 'status', 'measure')),
  field_name text not null,
  normalized_value text not null,
  display_value text not null,
  primary key (asset_record_id, field_name)
);

alter table public.ai_search_terms enable row level security;
revoke all on table public.ai_search_terms from anon;
grant select on table public.ai_search_terms to authenticated;
grant select, insert, update, delete on table public.ai_search_terms to service_role;

create policy "users search terms for visible inventory"
  on public.ai_search_terms for select to authenticated
  using (exists (select 1 from public.asset_records record where record.id = ai_search_terms.asset_record_id));

create index ai_search_terms_value_trgm_idx
  on public.ai_search_terms using gin (normalized_value extensions.gin_trgm_ops);
create index ai_search_terms_entity_value_idx
  on public.ai_search_terms (entity_type, normalized_value);
