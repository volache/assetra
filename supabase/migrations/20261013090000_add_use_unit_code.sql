-- Keep the source "使用單位代碼" alongside the use unit's display name.
alter table public.asset_records add column if not exists use_unit_code text;

create or replace function public.commit_inventory_import(
  p_source_type public.source_type,
  p_file_name text,
  p_imported_by uuid,
  p_records jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_import_id uuid;
  v_count integer;
begin
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'p_records must be a JSON array';
  end if;

  select count(*) into v_count
  from (
    select distinct on (
      btrim(incoming.category_type_code),
      btrim(incoming.asset_no),
      btrim(incoming.serial_no)
    ) incoming.asset_no
    from jsonb_array_elements(p_records) with ordinality as entries(payload, row_order)
    cross join lateral jsonb_to_record(entries.payload) as incoming(
      category_type_code text, asset_no text, serial_no text
    )
    order by
      btrim(incoming.category_type_code),
      btrim(incoming.asset_no),
      btrim(incoming.serial_no),
      entries.row_order desc
  ) deduplicated;

  if v_count = 0 then
    raise exception 'An import must include at least one record';
  end if;

  insert into public.imports (source_type, file_name, record_count, status, imported_by)
  values (p_source_type, btrim(p_file_name), v_count, 'ready', p_imported_by)
  returning id into v_import_id;

  -- Each import is a complete snapshot for its own source type. Records absent
  -- from the new source are no longer exposed as current, but remain in history
  -- until their batch is pruned.
  update public.asset_records
  set is_current = false
  where is_current
    and source_type = p_source_type;

  insert into public.asset_records (
    import_id, source_type, category_type_code, asset_no, serial_no, name, old_no, acquired_at,
    unit_code, unit_name, use_unit_code, use_unit_name, location_code, location_name,
    custodian_code, custodian_name, user_code, user_name, quantity,
    measure_unit, original_value, depreciation, net_value, useful_life,
    category_name, category_type, model, brand, notes, status
  )
  select
    v_import_id, p_source_type, btrim(incoming.category_type_code), btrim(incoming.asset_no),
    btrim(incoming.serial_no), btrim(incoming.name), nullif(btrim(incoming.old_no), ''), incoming.acquired_at,
    nullif(btrim(incoming.unit_code), ''), nullif(btrim(incoming.unit_name), ''),
    nullif(btrim(incoming.use_unit_code), ''),
    nullif(btrim(incoming.use_unit_name), ''), nullif(btrim(incoming.location_code), ''),
    nullif(btrim(incoming.location_name), ''), nullif(btrim(incoming.custodian_code), ''),
    nullif(btrim(incoming.custodian_name), ''), nullif(btrim(incoming.user_code), ''),
    nullif(btrim(incoming.user_name), ''), coalesce(incoming.quantity, 1),
    nullif(btrim(incoming.measure_unit), ''), coalesce(incoming.original_value, 0),
    coalesce(incoming.depreciation, 0), coalesce(incoming.net_value, 0),
    incoming.useful_life, nullif(btrim(incoming.category_name), ''),
    nullif(btrim(incoming.category_type), ''), nullif(btrim(incoming.model), ''),
    nullif(btrim(incoming.brand), ''), nullif(btrim(incoming.notes), ''),
    nullif(btrim(incoming.status), '')
  from (
    select distinct on (
      btrim(source_rows.category_type_code),
      btrim(source_rows.asset_no),
      btrim(source_rows.serial_no)
    ) source_rows.*
    from jsonb_array_elements(p_records) with ordinality as entries(payload, row_order)
    cross join lateral jsonb_to_record(entries.payload) as source_rows(
      category_type_code text, asset_no text, serial_no text, name text, old_no text, acquired_at date,
      unit_code text, unit_name text, use_unit_code text, use_unit_name text, location_code text,
      location_name text, custodian_code text, custodian_name text,
      user_code text, user_name text, quantity numeric, measure_unit text,
      original_value numeric, depreciation numeric, net_value numeric,
      useful_life integer, category_name text, category_type text, model text,
      brand text, notes text, status text
    )
    order by
      btrim(source_rows.category_type_code),
      btrim(source_rows.asset_no),
      btrim(source_rows.serial_no),
      entries.row_order desc
  ) incoming;

  update public.imports
  set status = 'committed', committed_at = now()
  where id = v_import_id;

  return v_import_id;
end;
$$;

revoke all on function public.commit_inventory_import(public.source_type, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.commit_inventory_import(public.source_type, text, uuid, jsonb) to service_role;
