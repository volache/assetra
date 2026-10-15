import { supabase } from "../../supabase";

export async function requestOwnershipDocument(body) {
  const { data, error } = await supabase.functions.invoke(
    "manage-ownership-documents",
    { body },
  );
  if (error) {
    let detail = null;
    const response = error.context;
    if (typeof response?.json === "function") {
      try {
        // The SDK may have consumed the original response while constructing
        // its error.  A clone retains the server's useful, safe error text.
        detail = await (typeof response.clone === "function" ? response.clone() : response).json();
      } catch { /* Keep the supplied error. */ }
    }
    throw new Error(
      detail?.error ||
        (error.message === "Edge Function returned a non-2xx status code"
          ? "權狀文件服務暫時無法讀取，請重新整理後再試。"
          : error.message) ||
        "權狀文件服務無法連線。",
    );
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}
