const emptyGeometry = JSON.stringify(
  { type: "Polygon", coordinates: [] },
  null,
  2,
);

const text = (value) => String(value ?? "");
const dateValue = (value) => (value ? String(value).slice(0, 10) : "");
const displayedPropertyNumber = (value) => text(value).replace(/\s+([^\s]+)$/, "-$1");

export function blankLandDraft() {
  return {
    acquisitionDate: "", announcedLandPrice: "", announcedLandValue: "", announcedPriceDate: "",
    area: "", cadastralLink: "", county: "", geometryText: emptyGeometry, id: null,
    landNumber: "", landUseType: "", notes: "", parcelKey: "", propertyAlias: "", propertyName: "",
    propertyNumber: "", propertyValue: "", publicClassification: "", registrationDate: "",
    relatedBuildingNumbers: "", sectionCode: "", sectionName: "", township: "", zoning: "",
  };
}

export function landToDraft(land) {
  const basic = land?.feature?.properties?.basic_info || {};
  const property = land?.feature?.properties?.property_info || {};
  return {
    ...blankLandDraft(),
    acquisitionDate: dateValue(property.acquisition_date),
    announcedLandPrice: text(basic.announced_land_price),
    announcedLandValue: text(basic.announced_land_value),
    announcedPriceDate: dateValue(basic.announced_price_date),
    area: text(basic.area), cadastralLink: text(land?.feature?.properties?.cadastral_link),
    county: text(basic.county), geometryText: JSON.stringify(land?.feature?.geometry, null, 2),
    id: land?.documentLandParcelId || null, landNumber: text(basic.land_number),
    landUseType: text(basic.land_use_type), notes: text(land?.feature?.properties?.notes),
    parcelKey: text(land?.feature?.id), propertyAlias: text(property.property_alias), propertyName: text(property.property_name),
    propertyNumber: displayedPropertyNumber(property.property_number), propertyValue: text(property.property_value),
    publicClassification: text(property.public_classification), registrationDate: dateValue(basic.registration_date),
    relatedBuildingNumbers: (land?.feature?.properties?.related_building_numbers || []).join("、"),
    sectionCode: text(basic.section_code), sectionName: text(basic.section_name), township: text(basic.township),
    zoning: text(basic.zoning),
  };
}

function validateCoordinates(value) {
  if (!Array.isArray(value)) return false;
  if (value.length === 2 && value.every((item) => typeof item === "number"))
    return value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
  return value.length > 0 && value.every(validateCoordinates);
}

export function parseLandGeometry(geometryText) {
  let value;
  try { value = JSON.parse(geometryText); } catch { throw new Error("地籍範圍不是有效的 JSON。"); }
  const geometry = value?.type === "Feature" ? value.geometry : value;
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type))
    throw new Error("地籍範圍必須是 Polygon 或 MultiPolygon GeoJSON。");
  if (!validateCoordinates(geometry.coordinates))
    throw new Error("地籍座標必須是有效的經緯度數字（WGS84）。");
  return geometry;
}

const numberFields = ["area", "announcedLandPrice", "announcedLandValue", "propertyValue"];

export function landPayload(draft) {
  const required = [["sectionCode", "段別代碼"], ["sectionName", "段別名稱"], ["landNumber", "地號"]];
  const missing = required.find(([key]) => !draft[key].trim());
  if (missing) throw new Error(`請填寫${missing[1]}。`);
  for (const key of numberFields) {
    if (draft[key] !== "" && !Number.isFinite(Number(draft[key])))
      throw new Error("面積與金額欄位必須是數字。");
  }
  return {
    area: draft.area, acquisition_date: draft.acquisitionDate, announced_land_price: draft.announcedLandPrice,
    announced_land_value: draft.announcedLandValue, announced_price_date: draft.announcedPriceDate,
    cadastral_link: draft.cadastralLink, county: draft.county, land_number: draft.landNumber,
    land_use_type: draft.landUseType, notes: draft.notes, parcel_key: draft.parcelKey,
    property_alias: draft.propertyAlias, property_name: draft.propertyName, property_number: draft.propertyNumber, property_value: draft.propertyValue,
    public_classification: draft.publicClassification, registration_date: draft.registrationDate,
    related_building_numbers: draft.relatedBuildingNumbers.split(/[、,\n]/).map((item) => item.trim()).filter(Boolean),
    section_code: draft.sectionCode, section_name: draft.sectionName, township: draft.township, zoning: draft.zoning,
  };
}

export async function saveLandParcel(client, draft) {
  const geometry = parseLandGeometry(draft.geometryText);
  const { data, error } = await client.rpc("save_land_parcel", {
    p_data: landPayload(draft), p_geometry: geometry, p_id: draft.id,
  });
  if (error) throw error;
  return data;
}
