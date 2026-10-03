alter table public.ai_query_semantic_fields
  drop constraint ai_query_semantic_fields_value_kind_check;

alter table public.ai_query_semantic_fields
  add constraint ai_query_semantic_fields_value_kind_check
  check (value_kind in ('entity', 'number', 'identifier_range', 'date_range', 'service_life_status'));

alter table public.asset_records
  add column if not exists service_life_ends_at date;

create or replace function public.set_asset_record_service_life_end()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.service_life_ends_at := case
    when new.acquired_at is not null and new.useful_life is not null and new.useful_life >= 0
      then (new.acquired_at + (new.useful_life * interval '1 year'))::date
    else null
  end;
  return new;
end;
$$;

drop trigger if exists set_asset_record_service_life_end on public.asset_records;
create trigger set_asset_record_service_life_end
  before insert or update of acquired_at, useful_life on public.asset_records
  for each row execute function public.set_asset_record_service_life_end();

update public.asset_records
set service_life_ends_at = case
  when acquired_at is not null and useful_life is not null and useful_life >= 0
    then (acquired_at + (useful_life * interval '1 year'))::date
  else null
end;

create index if not exists asset_records_current_service_life_end_idx
  on public.asset_records (service_life_ends_at)
  where is_current and service_life_ends_at is not null;

update public.ai_query_semantic_fields
set label = '年限', updated_at = now()
where field_key = 'useful_life';

insert into public.ai_query_semantic_fields (field_key, label, value_kind, column_name, operators, configuration)
values ('service_life_expired', '已過使用年限', 'service_life_status', 'service_life_ends_at', array['expired'], '{"todayTimezone":"Asia/Taipei","rule":"已使用:>=年限"}'::jsonb)
on conflict (field_key) do update set
  label = excluded.label,
  value_kind = excluded.value_kind,
  column_name = excluded.column_name,
  operators = excluded.operators,
  configuration = excluded.configuration,
  is_active = true,
  updated_at = now();
