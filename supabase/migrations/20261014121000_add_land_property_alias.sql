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
      'cadastral_link', parcel.cadastral_link,
      'notes', parcel.notes,
      'related_building_numbers', parcel.related_building_numbers
    )
  ) as feature
from public.land_parcels parcel
where parcel.is_active;

alter function public.save_land_parcel(uuid, jsonb, jsonb, uuid[]) rename to save_land_parcel_without_alias;

create function public.save_land_parcel(
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
declare v_id uuid;
begin
  v_id := public.save_land_parcel_without_alias(p_id, p_data, p_geometry, p_asset_identity_ids);
  update public.land_parcels
  set property_alias = nullif(btrim(p_data ->> 'property_alias'), '')
  where id = v_id;
  return v_id;
end;
$$;

revoke execute on function public.save_land_parcel(uuid, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.save_land_parcel(uuid, jsonb, jsonb, uuid[]) to authenticated;
revoke execute on function public.save_land_parcel_without_alias(uuid, jsonb, jsonb, uuid[]) from public, anon, authenticated;
