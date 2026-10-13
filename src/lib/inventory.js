import { rocDate, rocDateTime } from "./formatters.js";

export function fromDatabaseAsset(row) {
  return {
    id: row.id,
    identityId: row.identity_id,
    sourceType: row.source_type,
    assetNo: row.asset_no,
    serialNo: row.serial_no || "",
    name: row.name,
    oldNo: row.old_no || "",
    acquiredAt: rocDate(row.acquired_at),
    unitCode: row.unit_code || "",
    unitName: row.unit_name || "",
    useUnitCode: row.use_unit_code || "",
    useUnitName: row.use_unit_name || "",
    locationCode: row.location_code || "",
    locationName: row.location_name || "",
    custodianCode: row.custodian_code || "",
    custodianName: row.custodian_name || "",
    userCode: row.user_code || "",
    userName: row.user_name || "",
    quantity: row.quantity,
    measureUnit: row.measure_unit || "",
    originalValue: row.original_value,
    depreciation: row.depreciation,
    netValue: row.net_value,
    usefulLife: row.useful_life,
    categoryName: row.category_name || "",
    categoryTypeCode: row.category_type_code || "",
    categoryType: row.category_type || "",
    model: row.model || "",
    brand: row.brand || "",
    notes: row.notes || "",
    status: row.status || "",
  };
}

export function fromDatabaseImport(row) {
  return {
    id: row.id,
    fileName: row.file_name,
    sourceType: row.source_type,
    count: row.record_count,
    summary: row.summary || {},
    at: rocDateTime(row.committed_at || row.imported_at),
  };
}
