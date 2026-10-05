begin;

-- Backfill the relationship from the former display-only identifier.  An
-- identity is accepted only when its business key resolves to exactly one
-- current asset identity; ambiguous or missing matches stop the migration so
-- that no legal-land record loses its reference silently.
with parsed_references as (
  select
    parcel.id as land_parcel_id,
    (regexp_match(trim(parcel.property_number), '^([^-]+)-(.+)-([^-]+)$'))[1] as category_type_code,
    (regexp_match(trim(parcel.property_number), '^([^-]+)-(.+)-([^-]+)$'))[2] as asset_no,
    (regexp_match(trim(parcel.property_number), '^([^-]+)-(.+)-([^-]+)$'))[3] as serial_no
  from public.land_parcels parcel
  where nullif(trim(parcel.property_number), '') is not null
), candidates as (
  select
    reference.land_parcel_id,
    identity.id as asset_identity_id,
    count(*) over (partition by reference.land_parcel_id) as candidate_count
  from parsed_references reference
  join public.asset_identities identity
    on identity.source_type = 'asset'
   and identity.asset_no = reference.asset_no
   and identity.serial_no = reference.serial_no
   and identity.category_type_code = reference.category_type_code
)
insert into public.land_parcel_asset_links (
  land_parcel_id, asset_identity_id, relationship_type
)
select land_parcel_id, asset_identity_id, 'associated'
from candidates
where candidate_count = 1
on conflict (land_parcel_id, asset_identity_id, relationship_type) do nothing;

do $$
declare
  unresolved_count integer;
begin
  select count(*)
  into unresolved_count
  from public.land_parcels parcel
  where nullif(trim(parcel.property_number), '') is not null
    and not exists (
      select 1
      from public.land_parcel_asset_links link
      where link.land_parcel_id = parcel.id
    );

  if unresolved_count > 0 then
    raise exception
      '無法安全移除 % 筆土地的舊財產編號：找不到唯一的財產主檔關聯。請先補齊財產清冊或人工建立 land_parcel_asset_links。',
      unresolved_count;
  end if;
end;
$$;

-- Parcel keys identify cadastral parcels, never inventory assets.  Add an
-- ordinal only when a source contains more than one geometry for a parcel.
-- The temporary value prevents a unique-key collision when an old asset-based
-- key happens to equal another parcel's new cadastral key.
update public.land_parcels
set parcel_key = concat('migrating-', id::text);

with numbered as (
  select
    id,
    row_number() over (
      partition by section_code, land_number
      order by id
    ) as ordinal
  from public.land_parcels
)
update public.land_parcels parcel
set parcel_key = concat_ws(
  '-',
  parcel.section_code,
  parcel.land_number,
  case when numbered.ordinal = 1 then null else numbered.ordinal::text end
)
from numbered
where numbered.id = parcel.id;

drop view public.land_parcel_features;
drop index if exists public.land_parcels_property_number_idx;

-- Ownership files now have one operational source: ownership_documents. Keep
-- historical GeoJSON payloads only as immutable import provenance.
update public.land_parcels
set source_metadata = source_metadata || jsonb_strip_nulls(jsonb_build_object(
  'legacy_import_documents', documents,
  'legacy_import_photos', photos
));

alter table public.land_parcels
  drop column property_number,
  drop column property_name,
  drop column acquisition_date,
  drop column property_value,
  drop column documents,
  drop column photos;

create view public.land_parcel_features
with (security_invoker = true)
as
select
  parcel.id,
  parcel.parcel_key,
  jsonb_build_object(
    'type', 'Feature',
    'id', parcel.parcel_key,
    'geometry', extensions.st_asgeojson(parcel.geometry)::jsonb,
    'properties', jsonb_build_object(
      'basic_info', jsonb_strip_nulls(jsonb_build_object(
        'county', parcel.county,
        'township', parcel.township,
        'section_code', parcel.section_code,
        'section_name', parcel.section_name,
        'land_number', parcel.land_number,
        'registration_date', parcel.registration_date,
        'area', parcel.area,
        'zoning', parcel.zoning,
        'land_use_type', parcel.land_use_type,
        'announced_land_value', parcel.announced_land_value,
        'announced_land_price', parcel.announced_land_price,
        'announced_price_date', parcel.announced_price_date
      )),
      'linked_assets', coalesce(linked.assets, '[]'::jsonb),
      'public_classification', parcel.public_classification,
      'cadastral_link', parcel.cadastral_link,
      'notes', parcel.notes,
      'related_building_numbers', parcel.related_building_numbers
    )
  ) as feature
from public.land_parcels parcel
left join lateral (
  select jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'asset_identity_id', identity.id,
      'relationship_type', link.relationship_type,
      'property_number', concat_ws('-', identity.asset_no, nullif(identity.serial_no, '')),
      'property_name', record.name,
      'acquisition_date', record.acquired_at,
      'property_value', record.net_value
    ))
    order by link.relationship_type, identity.asset_no, identity.serial_no
  ) as assets
  from public.land_parcel_asset_links link
  join public.asset_identities identity on identity.id = link.asset_identity_id
  left join public.asset_records record
    on record.identity_id = identity.id
   and record.is_current
  where link.land_parcel_id = parcel.id
) linked on true
where parcel.is_active;

grant select on public.land_parcel_features to authenticated;

commit;
