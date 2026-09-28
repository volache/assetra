import { supabase } from "../../supabase";

export async function requestOwnershipDocument(body) {
  const { data, error } = await supabase.functions.invoke(
    "manage-ownership-documents",
    { body },
  );
  if (error) {
    let detail = null;
    if (typeof error.context?.json === "function") {
      try { detail = await error.context.json(); } catch { /* Keep the supplied error. */ }
    }
    throw new Error(detail?.error || error.message || "權狀文件服務無法連線。");
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}
