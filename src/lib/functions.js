import { supabase } from "../supabase";

const GENERIC_NON_2XX = "Edge Function returned a non-2xx status code";

// Calls an Edge Function through the Supabase SDK and turns every failure into an
// Error carrying the server's own message when it sent one.
//   fallback       - used when neither the server nor the SDK gave a message
//   genericMessage - replaces the SDK's unhelpful "non-2xx status code" text
export async function invokeFunction(name, body, { fallback, genericMessage } = {}) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // Edge Function errors do not always carry a Fetch Response (a network failure
    // can provide a plain context object), and the SDK may already have read the
    // body, so a clone is used when there is one.
    let detail = null;
    const response = error.context;
    if (typeof response?.json === "function") {
      try {
        detail = await (typeof response.clone === "function" ? response.clone() : response).json();
      } catch {
        // Keep the SDK's own error when the response body is unreadable.
      }
    }
    throw new Error(
      detail?.error ||
        (genericMessage && error.message === GENERIC_NON_2XX ? genericMessage : error.message) ||
        fallback,
    );
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}

// Calls an Edge Function with plain fetch, for functions that use GET or return
// their own JSON error shape.  Throws on a missing session or a non-2xx reply.
export async function fetchFunction(name, { method = "POST", body, fallback = "無法完成要求。" } = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("尚未登入。");
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || fallback);
  return result;
}
