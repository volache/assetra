import { invokeFunction } from "../../lib/functions";
import { supabase } from "../../supabase";

// The import-inventory Edge Function: "preview" and "delete" take their own mode,
// a plain body with records commits the import.
export const requestImportInventory = (body) => invokeFunction("import-inventory", body);

// Every changed row of one import batch, read in pages of 1000.
export async function loadImportBatchChanges(importId) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("import_batch_changes")
      .select(
        "change_kind, category_type_code, asset_no, serial_no, asset_name, before_record, after_record",
      )
      .eq("import_id", importId)
      .order("change_kind")
      .order("asset_no")
      .order("serial_no")
      .range(from, from + 999);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return all;
}
