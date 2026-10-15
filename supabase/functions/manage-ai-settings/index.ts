import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const origins = new Set(["http://localhost:5173", "http://127.0.0.1:5173", "https://volache.github.io"]);
const headers = (request: Request) => ({
  "Access-Control-Allow-Origin": origins.has(request.headers.get("Origin") ?? "") ? request.headers.get("Origin")! : "http://localhost:5173",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  Vary: "Origin",
});
const bytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const defaultModel = "gemini-flash-lite-latest";
const validModel = (value: string) => /^(gemini-flash-lite-latest|gemini-(3\.(5|[6-9]|[1-9][0-9]+)|[4-9][0-9]*(\.[0-9]+)?)-[a-z0-9.-]{3,127})$/i.test(value);
async function key() {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("伺服器加密設定遺失。");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(request) });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) throw new Error("登入已失效。");
    const { data: profile } = await admin.from("profiles").select("status").eq("id", user.id).maybeSingle();
    if (profile?.status !== "active") throw new Error("帳號尚未啟用。");
    if (request.method === "GET") {
      const { data, error } = await admin.from("user_ai_settings").select("gemini_key_ciphertext, gemini_model, updated_at").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      return Response.json({ configured: Boolean(data?.gemini_key_ciphertext), model: data?.gemini_model === defaultModel ? null : data?.gemini_model ?? null, updatedAt: data?.updated_at ?? null }, { headers: headers(request) });
    }
    const { geminiApiKey, geminiModel, removeKey } = await request.json();
    const value = String(geminiApiKey ?? "").trim();
    const model = typeof geminiModel === "string" ? geminiModel.trim() : "";
    if (value && (!/^\S{20,512}$/.test(value))) throw new Error("Gemini API Key 格式不正確。");
    if (model && !validModel(model)) throw new Error("請輸入支援的 Gemini 模型名稱。");
    if (removeKey === true) {
      const { error } = await admin.from("user_ai_settings").delete().eq("user_id", user.id);
      if (error) throw error;
      return Response.json({ configured: false }, { headers: headers(request) });
    }
    if (!value) {
      const { data: current, error: currentError } = await admin.from("user_ai_settings").select("user_id, gemini_key_ciphertext, gemini_model").eq("user_id", user.id).maybeSingle();
      if (currentError) throw currentError;
      if (!current?.gemini_key_ciphertext) throw new Error("請輸入 Gemini API Key。");
      const { error } = await admin.from("user_ai_settings").update({ gemini_model: model || defaultModel, updated_at: new Date().toISOString() }).eq("user_id", user.id);
      if (error) throw error;
      return Response.json({ configured: true, model: model || null }, { headers: headers(request) });
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(value));
    const { error } = await admin.from("user_ai_settings").upsert({ user_id: user.id, gemini_key_ciphertext: encode(new Uint8Array(ciphertext)), gemini_key_iv: encode(iv), gemini_model: model || defaultModel, updated_at: new Date().toISOString() });
    if (error) throw error;
    return Response.json({ configured: true, model: model || null }, { headers: headers(request) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "設定失敗。" }, { status: 400, headers: headers(request) });
  }
});
