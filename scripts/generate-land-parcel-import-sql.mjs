import { readFileSync } from "node:fs";

const sourcePath = "data/private/geospatial/land-properties.geojson";
const collection = JSON.parse(readFileSync(sourcePath, "utf8"));

const sqlText = (value) => {
  if (value === null || value === undefined || value === "") return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
};
const jsonValue = (value) => `${sqlText(JSON.stringify(value ?? {}))}::jsonb`;

const values = collection.features
  .map((feature, index) => {
    const basic = feature.properties?.basic_info || {};
    const property = feature.properties?.property_info || {};
    const parcelKey =
      property.property_number ||
      [basic.section_code, basic.land_number, index + 1].filter(Boolean).join("-");

    return `(${[
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
      sqlText(property.property_number),
      sqlText(property.property_name),
      sqlText(property.acquisition_date),
      property.property_value ?? "null",
      sqlText(feature.properties?.cadastral_link),
      jsonValue(feature.properties?.documents),
      jsonValue(feature.properties?.photos),
      sqlText(feature.properties?.notes),
      jsonValue(feature.properties?.related_building_numbers),
      jsonValue({ source_file: "land-properties.geojson", source_feature_index: index }),
      `extensions.ST_Multi(extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(${sqlText(JSON.stringify(feature.geometry))}), 4326))`,
    ].join(",")})`;
  })
  .join(",\n");

const columns = [
  "parcel_key", "section_code", "section_name", "land_number", "county", "township",
  "registration_date", "area", "zoning", "land_use_type", "announced_land_value",
  "announced_land_price", "announced_price_date", "public_classification", "property_number",
  "property_name", "acquisition_date", "property_value", "cadastral_link", "documents",
  "photos", "notes", "related_building_numbers", "source_metadata", "geometry",
].join(", ");

console.log(`insert into public.land_parcels (${columns}) values ${values}
on conflict (parcel_key) do update set
  section_code = excluded.section_code, section_name = excluded.section_name,
  land_number = excluded.land_number, county = excluded.county, township = excluded.township,
  registration_date = excluded.registration_date, area = excluded.area, zoning = excluded.zoning,
  land_use_type = excluded.land_use_type, announced_land_value = excluded.announced_land_value,
  announced_land_price = excluded.announced_land_price, announced_price_date = excluded.announced_price_date,
  public_classification = excluded.public_classification, property_number = excluded.property_number,
  property_name = excluded.property_name, acquisition_date = excluded.acquisition_date,
  property_value = excluded.property_value, cadastral_link = excluded.cadastral_link,
  documents = excluded.documents, photos = excluded.photos, notes = excluded.notes,
  related_building_numbers = excluded.related_building_numbers, source_metadata = excluded.source_metadata,
  geometry = excluded.geometry, is_active = true;`);
