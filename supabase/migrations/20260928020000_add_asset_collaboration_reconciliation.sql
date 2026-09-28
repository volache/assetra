-- Stable inventory identities are independent of import snapshots.  This keeps
-- collaborative work attached to the business record through later imports.
create type public.collaboration_kind as enum ('note', 'tag_missing', 'disposal_candidate', 'transfer_request');
create type public.collaboration_status as enum ('open', 'in_progress', 'resolved', 'cancelled');
create type public.reconciliation_status as enum ('open', 'resolved', 'dismissed');

create table public.asset_identities (
  id uuid primary key default gen_random_uuid(),
  source_type public.source_type not null,
  category_type_code text not null,
  asset_no text not null,
  serial_no text not null,
  first_seen_import_id uuid references public.imports(id) on delete set null,
  last_seen_import_id uuid references public.imports(id) on delete set null,
  last_seen_at timestamptz,
  is_present boolean not null default true,
  missing_since_import_id uuid references public.imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, category_type_code, asset_no, serial_no)
);

alter table public.asset_records add column identity_id uuid references public.asset_identities(id) on delete restrict;

insert into public.asset_identities (
  source_type, category_type_code, asset_no, serial_no,
  first_seen_import_id, last_seen_import_id, last_seen_at, is_present
)
select distinct on (r.source_type, r.category_type_code, r.asset_no, r.serial_no)
  r.source_type, r.category_type_code, r.asset_no, r.serial_no,
  r.import_id, r.import_id, r.created_at, r.is_current
from public.asset_records r
order by r.source_type, r.category_type_code, r.asset_no, r.serial_no, r.is_current desc, r.created_at desc;

update public.asset_records r
set identity_id = i.id
from public.asset_identities i
where i.source_type = r.source_type
  and i.category_type_code = r.category_type_code
  and i.asset_no = r.asset_no
  and i.serial_no = r.serial_no;

alter table public.asset_records alter column identity_id set not null;
drop index public.asset_records_current_identity_idx;
create unique index asset_records_current_identity_idx
  on public.asset_records (source_type, category_type_code, asset_no, serial_no)
  where is_current;
create index asset_records_identity_id_idx on public.asset_records (identity_id);

create table public.asset_collaborations (
  id uuid primary key default gen_random_uuid(),
  asset_identity_id uuid not null references public.asset_identities(id) on delete restrict,
  kind public.collaboration_kind not null default 'note',
  status public.collaboration_status not null default 'open',
  body text not null,
  details jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);
create index asset_collaborations_identity_status_idx on public.asset_collaborations (asset_identity_id, status, created_at desc);

create table public.asset_collaboration_events (
  id uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null references public.asset_collaborations(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index asset_collaboration_events_collaboration_idx on public.asset_collaboration_events (collaboration_id, created_at);

create table public.asset_identity_exceptions (
  id uuid primary key default gen_random_uuid(),
  asset_identity_id uuid not null references public.asset_identities(id) on delete restrict,
  detected_in_import_id uuid references public.imports(id) on delete set null,
  status public.reconciliation_status not null default 'open',
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset_identity_id, detected_in_import_id, reason)
);
create index asset_identity_exceptions_open_idx on public.asset_identity_exceptions (status, created_at) where status = 'open';

alter table public.asset_identities enable row level security;
alter table public.asset_collaborations enable row level security;
alter table public.asset_collaboration_events enable row level security;
alter table public.asset_identity_exceptions enable row level security;

grant select on public.asset_collaborations, public.asset_collaboration_events, public.asset_identity_exceptions to authenticated;
grant all on public.asset_identities, public.asset_collaborations, public.asset_collaboration_events, public.asset_identity_exceptions to service_role;

create policy "users read collaboration for visible inventory"
on public.asset_collaborations for select to authenticated
using (
  exists (
    select 1
    from public.asset_records r
    where r.identity_id = asset_collaborations.asset_identity_id
      and r.is_current
      and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
      and (
        exists (select 1 from public.user_roles role where role.user_id = (select auth.uid()) and role.role = 'admin')
        or (
          exists (select 1 from public.user_roles role where role.user_id = (select auth.uid()) and role.role = 'custodian')
          and exists (select 1 from public.user_custodians c where c.user_id = (select auth.uid()) and c.custodian_code = r.custodian_code)
        )
        or (
          exists (select 1 from public.user_roles role where role.user_id = (select auth.uid()) and role.role = 'chief')
          and exists (select 1 from public.user_units u where u.user_id = (select auth.uid()) and u.unit_code = r.unit_code)
        )
      )
  )
);

create policy "users read collaboration events for visible inventory"
on public.asset_collaboration_events for select to authenticated
using (
  exists (
    select 1 from public.asset_collaborations c
    where c.id = asset_collaboration_events.collaboration_id
  )
);

create policy "admins read reconciliation exceptions"
on public.asset_identity_exceptions for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
);

/* The established commit_inventory_import RPC remains unchanged so its snapshot,
   per-record change, and ten-batch retention behavior stays intact. */
/*
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
  v_missing_count integer := 0;
  v_exception_count integer := 0;
  v_resolved_count integer := 0;
begin
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'p_records must be a JSON array';
  end if;

  select count(*) into v_count
  from (
    select distinct on (btrim(incoming.category_type_code), btrim(incoming.asset_no), btrim(incoming.serial_no)) incoming.asset_no
    from jsonb_array_elements(p_records) with ordinality as entries(payload, row_order)
    cross join lateral jsonb_to_record(entries.payload) as incoming(category_type_code text, asset_no text, serial_no text)
    order by btrim(incoming.category_type_code), btrim(incoming.asset_no), btrim(incoming.serial_no), entries.row_order desc
  ) deduplicated;
  if v_count = 0 then raise exception 'An import must include at least one record'; end if;

  insert into public.imports (source_type, file_name, record_count, status, imported_by)
  values (p_source_type, btrim(p_file_name), v_count, 'ready', p_imported_by)
  returning id into v_import_id;

  update public.asset_records set is_current = false
  where is_current and source_type = p_source_type;

  insert into public.asset_identities (
    source_type, category_type_code, asset_no, serial_no,
    first_seen_import_id, last_seen_import_id, last_seen_at, is_present,
    missing_since_import_id, updated_at
  )
  select p_source_type, btrim(incoming.category_type_code), btrim(incoming.asset_no), btrim(incoming.serial_no),
    v_import_id, v_import_id, now(), true, null, now()
  from (
    select distinct on (btrim(source_rows.category_type_code), btrim(source_rows.asset_no), btrim(source_rows.serial_no)) source_rows.*
    from jsonb_array_elements(p_records) with ordinality as entries(payload, row_order)
    cross join lateral jsonb_to_record(entries.payload) as source_rows(category_type_code text, asset_no text, serial_no text)
    order by btrim(source_rows.category_type_code), btrim(source_rows.asset_no), btrim(source_rows.serial_no), entries.row_order desc
  ) incoming
  on conflict (source_type, category_type_code, asset_no, serial_no) do update
    set last_seen_import_id = excluded.last_seen_import_id,
        last_seen_at = excluded.last_seen_at,
        is_present = true,
        missing_since_import_id = null,
        updated_at = now();

  insert into public.asset_records (
    import_id, identity_id, source_type, category_type_code, asset_no, serial_no, name, old_no, acquired_at,
    unit_code, unit_name, use_unit_name, location_code, location_name,
    custodian_code, custodian_name, user_code, user_name, quantity,
    measure_unit, original_value, depreciation, net_value, useful_life,
    category_name, category_type, model, brand, notes, status
  )
  select v_import_id, identity.id, p_source_type, btrim(incoming.category_type_code), btrim(incoming.asset_no),
    btrim(incoming.serial_no), btrim(incoming.name), nullif(btrim(incoming.old_no), ''), incoming.acquired_at,
    nullif(btrim(incoming.unit_code), ''), nullif(btrim(incoming.unit_name), ''),
    nullif(btrim(incoming.use_unit_name), ''), nullif(btrim(incoming.location_code), ''), nullif(btrim(incoming.location_name), ''),
    nullif(btrim(incoming.custodian_code), ''), nullif(btrim(incoming.custodian_name), ''), nullif(btrim(incoming.user_code), ''),
    nullif(btrim(incoming.user_name), ''), coalesce(incoming.quantity, 1), nullif(btrim(incoming.measure_unit), ''),
    coalesce(incoming.original_value, 0), coalesce(incoming.depreciation, 0), coalesce(incoming.net_value, 0), incoming.useful_life,
    nullif(btrim(incoming.category_name), ''), nullif(btrim(incoming.category_type), ''), nullif(btrim(incoming.model), ''),
    nullif(btrim(incoming.brand), ''), nullif(btrim(incoming.notes), ''), nullif(btrim(incoming.status), '')
  from (
    select distinct on (btrim(source_rows.category_type_code), btrim(source_rows.asset_no), btrim(source_rows.serial_no)) source_rows.*
    from jsonb_array_elements(p_records) with ordinality as entries(payload, row_order)
    cross join lateral jsonb_to_record(entries.payload) as source_rows(
      category_type_code text, asset_no text, serial_no text, name text, old_no text, acquired_at date,
      unit_code text, unit_name text, use_unit_name text, location_code text, location_name text,
      custodian_code text, custodian_name text, user_code text, user_name text, quantity numeric, measure_unit text,
      original_value numeric, depreciation numeric, net_value numeric, useful_life integer, category_name text,
      category_type text, model text, brand text, notes text, status text
    )
    order by btrim(source_rows.category_type_code), btrim(source_rows.asset_no), btrim(source_rows.serial_no), entries.row_order desc
  ) incoming
  join public.asset_identities identity
    on identity.source_type = p_source_type
   and identity.category_type_code = btrim(incoming.category_type_code)
   and identity.asset_no = btrim(incoming.asset_no)
   and identity.serial_no = btrim(incoming.serial_no);

  with missing as (
    update public.asset_identities identity
    set is_present = false, missing_since_import_id = v_import_id, updated_at = now()
    where identity.source_type = p_source_type
      and identity.is_present
      and not exists (select 1 from public.asset_records r where r.import_id = v_import_id and r.identity_id = identity.id)
    returning identity.id, identity.source_type, identity.category_type_code, identity.asset_no, identity.serial_no
  ), inserted_exceptions as (
    insert into public.asset_identity_exceptions (asset_identity_id, detected_in_import_id, reason, details)
    select missing.id, v_import_id, 'missing_from_import', jsonb_build_object(
      'sourceType', missing.source_type,
      'categoryTypeCode', missing.category_type_code,
      'assetNo', missing.asset_no,
      'serialNo', missing.serial_no
    )
    from missing
    where exists (
      select 1 from public.asset_collaborations c
      where c.asset_identity_id = missing.id
        and c.status not in ('resolved', 'cancelled')
    )
    on conflict (asset_identity_id, detected_in_import_id, reason) do nothing
    returning id
  )
  select (select count(*) from missing), (select count(*) from inserted_exceptions)
    into v_missing_count, v_exception_count;

  update public.asset_identity_exceptions exception
  set status = 'resolved', resolved_at = now(), resolution = 'identity_reappeared', updated_at = now()
  where exception.status = 'open'
    and exists (
      select 1 from public.asset_records r
      where r.import_id = v_import_id and r.identity_id = exception.asset_identity_id
    );
  get diagnostics v_resolved_count = row_count;

  update public.imports set status = 'committed', committed_at = now() where id = v_import_id;
  return v_import_id;
end;
$$;

revoke all on function public.commit_inventory_import(public.source_type, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.commit_inventory_import(public.source_type, text, uuid, jsonb) to service_role;
*/

create or replace function public.sync_asset_record_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.asset_identities (
    source_type, category_type_code, asset_no, serial_no,
    first_seen_import_id, last_seen_import_id, last_seen_at, is_present,
    missing_since_import_id, updated_at
  ) values (
    new.source_type, new.category_type_code, new.asset_no, new.serial_no,
    new.import_id, new.import_id, now(), true, null, now()
  )
  on conflict (source_type, category_type_code, asset_no, serial_no) do update
    set last_seen_import_id = excluded.last_seen_import_id,
        last_seen_at = excluded.last_seen_at,
        is_present = true,
        missing_since_import_id = null,
        updated_at = now()
  returning id into new.identity_id;
  return new;
end;
$$;

create trigger assign_asset_record_identity
before insert on public.asset_records
for each row execute function public.sync_asset_record_identity();

create or replace function public.reconcile_inventory_identities(
  p_import_id uuid,
  p_source_type public.source_type
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing_count integer := 0;
  v_exception_count integer := 0;
  v_resolved_count integer := 0;
begin
  if not exists (
    select 1 from public.imports
    where id = p_import_id and source_type = p_source_type and status = 'committed'
  ) then
    raise exception '找不到已完成的對應匯入批次。';
  end if;

  with missing as (
    update public.asset_identities identity
    set is_present = false, missing_since_import_id = p_import_id, updated_at = now()
    where identity.source_type = p_source_type
      and identity.is_present
      and not exists (
        select 1 from public.asset_records record
        where record.import_id = p_import_id and record.identity_id = identity.id
      )
    returning identity.id, identity.source_type, identity.category_type_code, identity.asset_no, identity.serial_no
  ), inserted_exceptions as (
    insert into public.asset_identity_exceptions (asset_identity_id, detected_in_import_id, reason, details)
    select missing.id, p_import_id, 'missing_from_import', jsonb_build_object(
      'sourceType', missing.source_type,
      'categoryTypeCode', missing.category_type_code,
      'assetNo', missing.asset_no,
      'serialNo', missing.serial_no
    )
    from missing
    where exists (
      select 1 from public.asset_collaborations collaboration
      where collaboration.asset_identity_id = missing.id
        and collaboration.status not in ('resolved', 'cancelled')
    )
    on conflict (asset_identity_id, detected_in_import_id, reason) do nothing
    returning id
  )
  select (select count(*) from missing), (select count(*) from inserted_exceptions)
    into v_missing_count, v_exception_count;

  update public.asset_identity_exceptions exception
  set status = 'resolved', resolved_at = now(), resolution = 'identity_reappeared', updated_at = now()
  where exception.status = 'open'
    and exists (
      select 1 from public.asset_records record
      where record.import_id = p_import_id and record.identity_id = exception.asset_identity_id
    );
  get diagnostics v_resolved_count = row_count;

  return jsonb_build_object(
    'missingIdentities', v_missing_count,
    'exceptionsCreated', v_exception_count,
    'exceptionsAutoResolved', v_resolved_count
  );
end;
$$;

revoke all on function public.sync_asset_record_identity() from public, anon, authenticated;
revoke all on function public.reconcile_inventory_identities(uuid, public.source_type) from public, anon, authenticated;
grant execute on function public.reconcile_inventory_identities(uuid, public.source_type) to service_role;
