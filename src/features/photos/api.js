import { supabase } from "../../supabase";

export async function requestAssetPhoto(body) {
  const { data, error } = await supabase.functions.invoke("manage-asset-photos", { body });
  if (error) {
    let detail = null;
    if (typeof error.context?.json === "function") {
      try { detail = await error.context.json(); } catch { /* Use the function error below. */ }
    }
    throw new Error(detail?.error || error.message || "財物照片服務無法連線。");
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}
