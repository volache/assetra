import { readFileSync } from "node:fs";

const sourcePath = "data/private/geospatial/land-properties.geojson";
const collection = JSON.parse(readFileSync(sourcePath, "utf8"));

const sqlText = (value) => {
  if (value === null || value === undefined || value === "") return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
};
const jsonValue = (value) => `${sqlText(JSON.stringify(value ?? {}))}::jsonb`;

function assetReference(property) {
  const reference = property.asset_reference || {};
  if (reference.asset_no && reference.serial_no) {
    return {
      assetNo: String(reference.asset_no),
      categoryTypeCode: reference.category_type_code || null,
      serialNo: String(reference.serial_no),
      sourceType: reference.source_type || "asset",
    };
  }

  // Backward-compatible import support only. The identifier is resolved to an
  // asset identity during import and is never stored on the land parcel.
  const legacy = String(property.property_number || "").trim();
  const parts = legacy.split("-").filter(Boolean);
  if (parts.length < 3) return null;
  return {
    assetNo: parts.slice(1, -1).join("-"),
    categoryTypeCode: property.category_type_code || parts[0],
    serialNo: parts.at(-1),
    sourceType: "asset",
  };
}

const imported = collection.features.map((feature, index) => {
    const basic = feature.properties?.basic_info || {};
    const property = feature.properties?.property_info || {};
    const parcelKey =
      [basic.section_code, basic.land_number].filter(Boolean).join("-") ||
      `parcel-${index + 1}`;

    return {
      assetReference: assetReference(property),
      parcelKey,
      values: `(${[
      sqlText(parcelKey),
      sqlText(basic.section_code),
      sqlText(basic.section_name),
      sqlText(basic.land_number),
      sqlText(basic.county),
      sqlText(basic.township),
      sqlText(basic.registration_date),
      basic.area ?? "null",
      sqlText(basic.zoning),
      sqlText(basic.land_use_type),
      basic.announced_land_value ?? "null",
      basic.announced_land_price ?? "null",
      sqlText(basic.announced_price_date),
      sqlText(property.public_classification),
      sqlText(feature.properties?.cadastral_link),
      sqlText(feature.properties?.notes),
      jsonValue(feature.properties?.related_building_numbers),
      jsonValue({
        legacy_import_documents: feature.properties?.documents,
        legacy_import_photos: feature.properties?.photos,
        source_feature_index: index,
        source_file: "land-properties.geojson",
      }),
      `extensions.ST_Multi(extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(${sqlText(JSON.stringify(feature.geometry))}), 4326))`,
    ].join(",")})`,
    };
  });

const values = imported.map((entry) => entry.values).join(",\n");

const columns = [
  "parcel_key", "section_code", "section_name", "land_number", "county", "township",
  "registration_date", "area", "zoning", "land_use_type", "announced_land_value",
  "announced_land_price", "announced_price_date", "public_classification", "cadastral_link", "notes",
  "related_building_numbers", "source_metadata", "geometry",
].join(", ");

console.log(`insert into public.land_parcels (${columns}) values ${values}
on conflict (parcel_key) do update set
  section_code = excluded.section_code, section_name = excluded.section_name,
  land_number = excluded.land_number, county = excluded.county, township = excluded.township,
  registration_date = excluded.registration_date, area = excluded.area, zoning = excluded.zoning,
  land_use_type = excluded.land_use_type, announced_land_value = excluded.announced_land_value,
  announced_land_price = excluded.announced_land_price, announced_price_date = excluded.announced_price_date,
  public_classification = excluded.public_classification, cadastral_link = excluded.cadastral_link,
  notes = excluded.notes,
  related_building_numbers = excluded.related_building_numbers, source_metadata = excluded.source_metadata,
  geometry = excluded.geometry, is_active = true;`);

const linkValues = imported
  .filter((entry) => entry.assetReference)
  .map(({ assetReference: reference, parcelKey }) => `(${[
    sqlText(parcelKey),
    sqlText(reference.sourceType),
    sqlText(reference.categoryTypeCode),
    sqlText(reference.assetNo),
    sqlText(reference.serialNo),
  ].join(",")})`)
  .join(",\n");

if (linkValues) {
  console.log(`
with imported_links (parcel_key, source_type, category_type_code, asset_no, serial_no) as (
  values ${linkValues}
), candidates as (
  select
    input.parcel_key,
    identity.id as asset_identity_id,
    count(*) over (partition by input.parcel_key) as candidate_count
  from imported_links input
  join public.asset_identities identity
    on identity.source_type::text = input.source_type
   and identity.asset_no = input.asset_no
   and identity.serial_no = input.serial_no
   and (input.category_type_code is null or identity.category_type_code = input.category_type_code)
)
insert into public.land_parcel_asset_links (land_parcel_id, asset_identity_id, relationship_type)
select parcel.id, candidates.asset_identity_id, 'associated'
from candidates
join public.land_parcels parcel on parcel.parcel_key = candidates.parcel_key
where candidates.candidate_count = 1
on conflict (land_parcel_id, asset_identity_id, relationship_type) do nothing;`);
}
