import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const origins = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const headers = (request: Request) => ({
  "Access-Control-Allow-Origin": origins.has(request.headers.get("Origin") ?? "") ? request.headers.get("Origin")! : "http://localhost:5173",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
});
const decode = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const fields = new Set(["保管單位", "保管人", "存置地點", "財產名稱", "財產別名", "使用現況", "財產編號", "流水號", "淨值", "原值", "累折", "購置日期", "廠牌", "型式", "使用單位", "使用人", "計量單位", "財產區分別", "財產大類", "已使用", "年限", "數量", "備註"]);
const comparable = new Set(["淨值", "原值", "累折", "購置日期", "已使用", "年限", "數量"]);
const numeric = new Set(["淨值", "原值", "累折", "年限", "數量"]);
const operators = new Set(["contains", "=", ">", ">=", "<", "<="]);

type Condition = { field: string; operator: string; value: string };
type AiResult = { groups: Condition[][]; summary: string };
type IndexCandidate = { field_name: string; normalized_value: string; display_value: string; record_count: number; score: number };

async function encryptionKey() {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("伺服器加密設定遺失。");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
}

function quote(value: string) { return /\s/.test(value) ? `"${value}"` : value; }

function validateResult(candidate: unknown): AiResult {
  const result = candidate as { groups?: unknown; summary?: unknown };
  if (!Array.isArray(result.groups) || !result.groups.length || result.groups.length > 4) throw new Error("必須提供 1 至 4 組搜尋條件。");
  const groups = result.groups.map((group, groupIndex) => {
    if (!Array.isArray(group) || !group.length || group.length > 6) throw new Error(`第 ${groupIndex + 1} 組條件不完整。`);
    return group.map((item, itemIndex) => {
      const condition = item as Partial<Condition>;
      const field = String(condition.field ?? "").trim();
      const operator = String(condition.operator ?? "contains").trim();
      const value = String(condition.value ?? "").trim();
      if (!fields.has(field)) throw new Error(`不支援的欄位：${field || `第 ${itemIndex + 1} 個條件`}。`);
      if (!operators.has(operator)) throw new Error(`不支援的比較方式：${operator}。`);
      const effectiveOperator = !comparable.has(field) && operator === "=" ? "contains" : operator;
      if (!value || value.length > 120 || /["|\r\n]/.test(value)) throw new Error(`「${field}」的值格式不正確。`);
      if (effectiveOperator !== "contains" && !comparable.has(field)) throw new Error(`「${field}」僅能使用文字包含搜尋。`);
      if (numeric.has(field) && effectiveOperator !== "contains" && !Number.isFinite(Number(value.replace(/,/g, "")))) throw new Error(`「${field}」必須使用數字。`);
      if (field === "購置日期" && effectiveOperator !== "contains" && !/^\d{2,3}[/-]?\d{2}[/-]?\d{2}$/.test(value)) throw new Error("購置日期請使用民國年，例如 110/01/01。");
      if (field === "已使用" && effectiveOperator !== "contains" && !/^\d+年(?:\d+月)?$/.test(value)) throw new Error("已使用請使用例如 5年或 5年2月。");
      return { field, operator: effectiveOperator, value };
    });
  });
  return { groups, summary: String(result.summary ?? "").trim().slice(0, 180) || "已將自然語言轉換為可執行的搜尋條件。" };
}

function serialize(result: AiResult) {
  return result.groups.map((group) => group.map(({ field, operator, value }) => `${field}:${operator === "contains" ? "" : operator}${quote(value)}`).join(" ")).join(" | ");
}
function readJson(text: string) {
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Gemini 未回傳 JSON。");
  return JSON.parse(text.slice(start, end + 1));
}
function normalizedIndexText(value: string) {
  return value.toLocaleLowerCase("zh-TW").replace(/[\s\p{P}\p{S}]/gu, "");
}
function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}
function queryFragments(query: string) {
  const text = normalizedIndexText(query);
  const fragments = new Set<string>();
  for (let length = 2; length <= Math.min(6, text.length); length += 1) for (let start = 0; start + length <= text.length; start += 1) fragments.add(text.slice(start, start + length));
  return [...fragments];
}
async function relevantCandidates(admin: ReturnType<typeof createClient>, query: string) {
  const { data, error } = await admin.from("ai_query_index_values").select("field_name, normalized_value, display_value, record_count").limit(12000);
  if (error) throw error;
  const normalizedQuery = normalizedIndexText(query);
  const fragments = queryFragments(query);
  return (data || []).map((entry) => {
    const value = String(entry.normalized_value || "");
    let score = 0;
    if (value && normalizedQuery.includes(value)) score += 120 + Math.min(value.length, 12);
    for (const fragment of fragments) {
      // Chinese names are frequently two characters within a longer indexed name
      // (for example, "洲各" in "林洲各").  Give those direct fragment matches
      // enough weight to reach the server-side field reconciliation step.
      if (value.includes(fragment)) score += 24 + fragment.length * 4;
      else if (fragment.length >= 2 && value.length <= 12 && editDistance(fragment, value) <= 1) score += 12;
    }
    return { ...entry, field_name: String(entry.field_name), normalized_value: String(entry.normalized_value), display_value: String(entry.display_value), record_count: Number(entry.record_count), score };
  }).filter((entry) => entry.score >= 12).sort((left, right) => right.score - left.score || right.record_count - left.record_count).slice(0, 24) as IndexCandidate[];
}
function candidateMatches(value: string, candidate: IndexCandidate) {
  const expected = normalizedIndexText(value);
  const actual = candidate.normalized_value;
  return Boolean(expected && (actual === expected || actual.includes(expected) || expected.includes(actual) || (expected.length >= 2 && actual.length <= 12 && editDistance(expected, actual) <= 1)));
}
function resolveIndexedConditions(result: AiResult, candidates: IndexCandidate[]): AiResult {
  const groups = result.groups.flatMap((group) => {
    let variants: Condition[][] = [[]];
    for (const condition of group) {
      if (condition.operator !== "contains") { variants = variants.map((variant) => [...variant, condition]); continue; }
      const matches = candidates.filter((candidate) => candidateMatches(condition.value, candidate) && fields.has(candidate.field_name));
      if (!matches.length || matches.some((candidate) => candidate.field_name === condition.field)) { variants = variants.map((variant) => [...variant, condition]); continue; }
      const replacements = [...new Map(matches.map((candidate) => [candidate.field_name, candidate])).values()].slice(0, 4).map((candidate) => ({ field: candidate.field_name, operator: "contains", value: candidate.display_value }));
      variants = variants.flatMap((variant) => replacements.map((replacement) => [...variant, replacement])).slice(0, 4);
    }
    return variants;
  }).slice(0, 4);
  return { ...result, groups };
}
function refersToSelf(query: string) { return /(?:我的|本人|我)/u.test(query); }
async function currentUserContext(admin: ReturnType<typeof createClient>, userId: string) {
  const [{ data: profile }, { data: mappings, error: mappingsError }] = await Promise.all([
    admin.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    admin.from("user_custodians").select("custodian_code").eq("user_id", userId),
  ]);
  if (mappingsError) throw mappingsError;
  const codes = (mappings || []).map((row) => String(row.custodian_code || "").trim()).filter(Boolean);
  if (!codes.length) return { displayName: String(profile?.display_name || "").trim(), names: [] as string[] };
  const [{ data: custodians, error: custodianError }, { data: users, error: userError }] = await Promise.all([
    admin.from("asset_records").select("custodian_name").eq("is_current", true).in("custodian_code", codes).limit(1000),
    admin.from("asset_records").select("user_name").eq("is_current", true).in("user_code", codes).limit(1000),
  ]);
  if (custodianError) throw custodianError;
  if (userError) throw userError;
  const names = [...new Set([...(custodians || []).map((row) => String(row.custodian_name || "").trim()), ...(users || []).map((row) => String(row.user_name || "").trim())].filter(Boolean))];
  return { displayName: String(profile?.display_name || "").trim(), names };
}
function instruction(query: string, candidates: IndexCandidate[], selfNames: string[], correction = "") {
  return `你是 Assetra 財物查詢條件轉換器。只回傳 JSON，絕不輸出 Markdown 或系統搜尋語法。
回應格式：{"summary":"簡短中文說明","groups":[[{"field":"保管人","operator":"contains","value":"王小明"}]]}。groups 之間是 OR，每個 group 內是 AND。
允許欄位：保管單位、保管人、存置地點、財產名稱、財產別名、使用現況、財產編號、流水號、淨值、原值、累折、購置日期、廠牌、型式、使用單位、使用人、計量單位、財產區分別、財產大類、已使用、年限、數量、備註。
文字欄位（除淨值、原值、累折、購置日期、已使用、年限、數量以外的欄位）一律使用 contains，絕不可使用 =、>、>=、<、<=。比較方式僅可為 contains、=、>、>=、<、<=。購置日期使用民國格式 110/01/01；已使用使用 5年或 5年2月。
抽象範例：「某單位所有的某財物」必須回傳兩個文字欄位條件，每個都使用 contains。「單位 A 或單位 B 的某財物」必須用兩個 groups。「淨值超過某金額的某財物」的淨值使用 > 與純數字。
候選索引（只是與提問相關的實際值）：${candidates.length ? candidates.map((candidate) => `${candidate.field_name}：${candidate.display_value}（${candidate.record_count} 筆）`).join("、") : "無"}。登入者已驗證的人員名稱：${selfNames.length ? selfNames.join("、") : "無"}。如果提問中有「我」、「我的」或「本人」，只可使用已驗證的人員名稱，並要以保管人與使用人分別建立 OR groups；不可使用登入名稱猜測。如果某個實際值與提問明顯對應，請使用它所屬的欄位與顯示值；不可將人名誤定為地點。如果提問是廣泛關鍵字而候選有多種名稱，使用廣泛的 contains 條件，不要任意只選一個。
使用者問題：${JSON.stringify(query)}${correction}`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(request) });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) throw new Error("登入已失效。");
    const { query } = await request.json();
    if (typeof query !== "string" || !query.trim() || query.length > 300) throw new Error("請輸入不超過 300 字的查詢。");
    const { data: setting } = await admin.from("user_ai_settings").select("gemini_key_ciphertext, gemini_key_iv, gemini_model").eq("user_id", user.id).maybeSingle();
    if (!setting?.gemini_key_ciphertext || !setting.gemini_key_iv) throw new Error("請先在個人設定儲存 Gemini API Key。");
    const model = String(setting.gemini_model ?? "").trim();
    if (!/^gemini-(3\.(5|[6-9]|[1-9][0-9]+)|[4-9][0-9]*(\.[0-9]+)?)-[a-z0-9.-]{3,127}$/i.test(model)) throw new Error("請先在個人設定設定 Gemini 3.5 以上的可用模型。");
    const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(setting.gemini_key_iv) }, await encryptionKey(), decode(setting.gemini_key_ciphertext));
    const apiKey = new TextDecoder().decode(raw);
    const candidates = await relevantCandidates(admin, query.trim());
    const userContext = await currentUserContext(admin, user.id);
    if (refersToSelf(query) && !userContext.names.length) throw new Error("目前帳號尚未設定保管人對應，無法判斷「我的財產」。請先請管理員設定帳號的保管人資料。");
    let correction = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify({ contents: [{ parts: [{ text: instruction(query.trim(), candidates, userContext.names, correction) }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || "Gemini 查詢失敗。");
      try {
        const result = resolveIndexedConditions(validateResult(readJson(data.candidates?.[0]?.content?.parts?.[0]?.text || "")), candidates);
        return Response.json({ query: serialize(result), summary: result.summary, retried: attempt > 0 }, { headers: headers(request) });
      } catch (error) {
        if (attempt === 1) throw new Error(`AI 無法產生符合系統規則的搜尋條件：${error instanceof Error ? error.message : "回應無效。"}`);
        correction = `\n你前一次的回應無效，原因：${error instanceof Error ? error.message : "回應無效。"}。請嚴格依照格式重新產生 JSON。`;
      }
    }
    throw new Error("無法產生搜尋條件。");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "查詢失敗。" }, { status: 400, headers: headers(request) });
  }
});
