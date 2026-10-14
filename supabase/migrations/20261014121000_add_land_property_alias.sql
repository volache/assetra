-- Applied to the Assetra project as version 20261014110709
-- (name: repair_land_property_fields_and_alias).  Version numbers are stamped
-- when a migration is applied, so they differ from this file's prefix.
--
-- This file reproduces the objects exactly as they exist in the database:
-- the property_alias column, the feature view (with linked assets) and a single
-- save_land_parcel that writes the alias itself.  Do not re-run it against the
-- live database.  It depends on public.land_parcel_asset_links and the land
-- asset relationship changes applied as 20261005171808
-- (normalize_land_asset_relationships).

alter table public.land_parcels
  add column if not exists property_number text,
  add column if not exists property_name text,
  add column if not exists property_alias text,
  add column if not exists acquisition_date date,
  add column if not exists property_value numeric;

create or replace view public.land_parcel_features
with (security_invoker = true)
as
select parcel.id, parcel.parcel_key,
  jsonb_build_object('type', 'Feature', 'id', parcel.parcel_key,
    'geometry', extensions.st_asgeojson(parcel.geometry)::jsonb,
    'properties', jsonb_build_object(
      'basic_info', jsonb_strip_nulls(jsonb_build_object(
        'county', parcel.county, 'township', parcel.township,
        'section_code', parcel.section_code, 'section_name', parcel.section_name,
        'land_number', parcel.land_number, 'registration_date', parcel.registration_date,
        'area', parcel.area, 'zoning', parcel.zoning, 'land_use_type', parcel.land_use_type,
        'announced_land_value', parcel.announced_land_value,
        'announced_land_price', parcel.announced_land_price,
        'announced_price_date', parcel.announced_price_date
      )),
      'property_info', jsonb_strip_nulls(jsonb_build_object(
        'public_classification', parcel.public_classification,
        'property_number', parcel.property_number,
        'property_name', parcel.property_name,
        'property_alias', parcel.property_alias,
        'acquisition_date', parcel.acquisition_date,
        'property_value', parcel.property_value
      )),
      'linked_assets', coalesce(linked.assets, '[]'::jsonb),
      'cadastral_link', parcel.cadastral_link,
      'notes', parcel.notes,
      'related_building_numbers', parcel.related_building_numbers
    )
  ) as feature
from public.land_parcels parcel
left join lateral (
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'asset_identity_id', identity.id,
      'relationship_type', link.relationship_type,
      'property_number', concat_ws('-', identity.asset_no, nullif(identity.serial_no, '')),
      'property_name', record.name,
      'acquisition_date', record.acquired_at,
      'property_value', record.net_value
    )) order by link.relationship_type, identity.asset_no, identity.serial_no) as assets
  from public.land_parcel_asset_links link
  join public.asset_identities identity on identity.id = link.asset_identity_id
  left join public.asset_records record
    on record.identity_id = identity.id and record.is_current
  where link.land_parcel_id = parcel.id
) linked on true
where parcel.is_active;

create or replace function public.save_land_parcel(
  p_id uuid,
  p_data jsonb,
  p_geometry jsonb,
  p_asset_identity_ids uuid[] default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_geometry extensions.geometry;
  v_id uuid;
  v_section_code text := nullif(btrim(p_data ->> 'section_code'), '');
  v_section_name text := nullif(btrim(p_data ->> 'section_name'), '');
  v_land_number text := nullif(btrim(p_data ->> 'land_number'), '');
  v_parcel_key text := nullif(btrim(p_data ->> 'parcel_key'), '');
begin
  if not exists (
    select 1 from public.profiles p join public.user_roles r on r.user_id = p.id
    where p.id = (select auth.uid()) and p.status = 'active' and r.role = 'admin'
  ) then
    raise exception '僅系統管理員可維護土地資料。';
  end if;
  if v_section_code is null or v_section_name is null or v_land_number is null then
    raise exception '段別代碼、段別名稱及地號為必填欄位。';
  end if;
  if p_geometry is null or p_geometry ->> 'type' not in ('Polygon', 'MultiPolygon') then
    raise exception '地籍範圍必須是 Polygon 或 MultiPolygon GeoJSON。';
  end if;
  v_geometry := extensions.ST_Multi(
    extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geometry::text), 4326)
  );
  if extensions.ST_IsEmpty(v_geometry) or not extensions.ST_IsValid(v_geometry) then
    raise exception '地籍範圍不是有效的多邊形。';
  end if;
  v_parcel_key := coalesce(v_parcel_key, v_section_code || '-' || v_land_number);

  if p_id is null then
    insert into public.land_parcels (
      parcel_key, section_code, section_name, land_number, county, township,
      registration_date, area, zoning, land_use_type, announced_land_value,
      announced_land_price, announced_price_date, public_classification,
      property_number, property_name, property_alias, acquisition_date, property_value,
      cadastral_link, notes, related_building_numbers, geometry, created_by, updated_by
    ) values (
      v_parcel_key, v_section_code, v_section_name, v_land_number,
      nullif(btrim(p_data ->> 'county'), ''), nullif(btrim(p_data ->> 'township'), ''),
      nullif(p_data ->> 'registration_date', '')::date,
      nullif(p_data ->> 'area', '')::numeric,
      nullif(btrim(p_data ->> 'zoning'), ''), nullif(btrim(p_data ->> 'land_use_type'), ''),
      nullif(p_data ->> 'announced_land_value', '')::numeric,
      nullif(p_data ->> 'announced_land_price', '')::numeric,
      nullif(p_data ->> 'announced_price_date', '')::date,
      nullif(btrim(p_data ->> 'public_classification'), ''),
      nullif(btrim(p_data ->> 'property_number'), ''), nullif(btrim(p_data ->> 'property_name'), ''),
      nullif(btrim(p_data ->> 'property_alias'), ''),
      nullif(p_data ->> 'acquisition_date', '')::date,
      nullif(p_data ->> 'property_value', '')::numeric,
      nullif(btrim(p_data ->> 'cadastral_link'), ''), nullif(btrim(p_data ->> 'notes'), ''),
      coalesce(p_data -> 'related_building_numbers', '[]'::jsonb), v_geometry,
      (select auth.uid()), (select auth.uid())
    ) returning id into v_id;
  else
    update public.land_parcels
    set
      parcel_key = v_parcel_key,
      section_code = v_section_code,
      section_name = v_section_name,
      land_number = v_land_number,
      county = nullif(btrim(p_data ->> 'county'), ''),
      township = nullif(btrim(p_data ->> 'township'), ''),
      registration_date = nullif(p_data ->> 'registration_date', '')::date,
      area = nullif(p_data ->> 'area', '')::numeric,
      zoning = nullif(btrim(p_data ->> 'zoning'), ''),
      land_use_type = nullif(btrim(p_data ->> 'land_use_type'), ''),
      announced_land_value = nullif(p_data ->> 'announced_land_value', '')::numeric,
      announced_land_price = nullif(p_data ->> 'announced_land_price', '')::numeric,
      announced_price_date = nullif(p_data ->> 'announced_price_date', '')::date,
      public_classification = nullif(btrim(p_data ->> 'public_classification'), ''),
      property_number = nullif(btrim(p_data ->> 'property_number'), ''),
      property_name = nullif(btrim(p_data ->> 'property_name'), ''),
      property_alias = nullif(btrim(p_data ->> 'property_alias'), ''),
      acquisition_date = nullif(p_data ->> 'acquisition_date', '')::date,
      property_value = nullif(p_data ->> 'property_value', '')::numeric,
      cadastral_link = nullif(btrim(p_data ->> 'cadastral_link'), ''),
      notes = nullif(btrim(p_data ->> 'notes'), ''),
      related_building_numbers = coalesce(p_data -> 'related_building_numbers', '[]'::jsonb),
      geometry = v_geometry,
      updated_by = (select auth.uid())
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception '找不到土地資料，或您沒有編輯權限。';
    end if;
  end if;

  if p_asset_identity_ids is not null then
    delete from public.land_parcel_asset_links
    where land_parcel_id = v_id and relationship_type = 'associated';
    insert into public.land_parcel_asset_links (land_parcel_id, asset_identity_id, relationship_type, created_by)
    select v_id, identity_id, 'associated', (select auth.uid())
    from unnest(p_asset_identity_ids) identity_id
    on conflict do nothing;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.save_land_parcel(uuid, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.save_land_parcel(uuid, jsonb, jsonb, uuid[]) to authenticated;
