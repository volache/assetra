import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type CatalogField = { field_key: string; label: string; value_kind: "entity" | "number" | "identifier_range" | "date_range" | "service_life_status"; column_name: string | null; operators: string[] };
type Candidate = { fieldKey: string; label: string; value: string; normalized: string; count: number };
type Predicate = Record<string, unknown>;
const origins = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const headers = (request: Request) => ({ "Access-Control-Allow-Origin": origins.has(request.headers.get("Origin") ?? "") ? request.headers.get("Origin")! : "http://localhost:5173", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" });
const normalize = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("zh-TW");
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const assetIdentifier = /^(\d{7}-\d{4})-(\d{7})$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const resultFields = "identity_id,asset_no,serial_no,name,custodian_name,user_name,location_name,unit_name,brand,net_value";
const formatChineseTypography = (value: unknown) => String(value ?? "")
  .replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, "$1 $2")
  .replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, "$1 $2");

async function encryptionKey() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
}
function parsePlan(parts: Array<Record<string, unknown>>) {
  const text = parts.map((part) => String(part.text ?? "")).join("\n"); const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI 未回傳可驗證的查詢計畫。");
  const plan = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  if (plan.version !== 1 || !Array.isArray(plan.groups) || !plan.groups.length || plan.groups.length > 4) throw new Error("AI 查詢計畫格式錯誤。");
  return plan.groups.map((group) => {
    const all = (group as Record<string, unknown>)?.all;
    if (!Array.isArray(all) || !all.length || all.length > 6 || !all.every((item) => item && typeof item === "object")) throw new Error("AI 查詢條件格式錯誤。");
    return all as Predicate[];
  });
}
async function loadCatalog(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin.from("ai_query_semantic_fields").select("field_key,label,value_kind,column_name,operators").eq("is_active", true).order("field_key");
  if (error) throw error;
  const catalog = (data || []) as CatalogField[];
  if (!catalog.length) throw new Error("AI 查詢語意目錄尚未初始化。");
  return catalog;
}
function fragments(question: string) {
  const text = normalize(question); const found = new Set<string>();
  for (let size = 2; size <= Math.min(5, text.length); size++) for (let start = 0; start + size <= text.length; start++) {
    const piece = text.slice(start, start + size).replace(/[(),.%]/g, ""); if (piece) found.add(piece);
  }
  return [...found].slice(0, 24);
}
async function findCandidates(client: ReturnType<typeof createClient>, question: string, catalog: CatalogField[]) {
  const byLabel = new Map(catalog.filter((field) => field.value_kind === "entity").map((field) => [field.label, field]));
  const filters = fragments(question).map((piece) => `normalized_value.ilike.%${piece}%`);
  if (!filters.length) return [];
  const { data, error } = await client.from("ai_search_terms").select("field_name,display_value,normalized_value").in("field_name", [...byLabel.keys()]).or(filters.join(",")).limit(1500);
  if (error) throw error;
  const grouped = new Map<string, Candidate>();
  for (const row of data || []) {
    const field = byLabel.get(row.field_name); if (!field) continue;
    const key = `${field.field_key}\0${row.normalized_value}`; const item = grouped.get(key) || { fieldKey: field.field_key, label: field.label, value: row.display_value, normalized: row.normalized_value, count: 0 };
    item.count++; grouped.set(key, item);
  }
  return [...grouped.values()].sort((left, right) => right.count - left.count).slice(0, 40);
}
async function resolveEntity(client: ReturnType<typeof createClient>, field: CatalogField, input: unknown) {
  const requested = normalize(input); if (!requested || requested.length > 120) throw new Error(`無效的${field.label}條件。`);
  const { data, error } = await client.from("ai_search_terms").select("display_value,normalized_value").eq("field_name", field.label).ilike("normalized_value", `%${requested}%`).limit(300);
  if (error) throw error;
  const values = [...new Map((data || []).map((row) => [row.normalized_value, row.display_value])).values()];
  const exact = values.filter((value) => normalize(value) === requested); const matches = exact.length ? exact : values;
  if (!matches.length) throw new Error(`索引未找到${field.label}：${String(input)}。`);
  if (matches.length > 1) throw new Error(`${field.label}「${String(input)}」有 ${matches.length} 個可能值，請補充更具體的名稱。`);
  return matches[0] as string;
}
async function confirmEntityContains(client: ReturnType<typeof createClient>, field: CatalogField, input: unknown) {
  const requested = normalize(input); if (!requested || requested.length > 120) throw new Error(`無效的${field.label}條件。`);
  const { data, error } = await client.from("ai_search_terms").select("normalized_value").eq("field_name", field.label).ilike("normalized_value", `%${requested}%`).limit(1);
  if (error) throw error;
  if (!data?.length) throw new Error(`索引未找到${field.label}：${String(input)}。`);
  return String(input).trim();
}
function clarificationFor(question: string, candidates: Candidate[]) {
  const shared = new Map<string, Candidate[]>();
  for (const candidate of candidates) shared.set(candidate.normalized, [...(shared.get(candidate.normalized) || []), candidate]);
  const match = [...shared.values()]
    .filter((items) => new Set(items.map((item) => item.fieldKey)).size > 1)
    .filter((items) => normalize(question).includes(items[0].normalized))
    .sort((left, right) => right[0].normalized.length - left[0].normalized.length)[0];
  if (!match) return null;
  const value = match[0].value;
  const individual = match.map((item) => ({
    id: item.fieldKey,
    label: `只查${item.label}是「${value}」的財產`,
    groups: [[{ kind: "entity", field: item.fieldKey, operator: "=", value }]],
  }));
  return {
    prompt: `「${value}」可能是在說不同資料。您想找哪一種？`,
    options: [...individual, { id: "all", label: `只要跟「${value}」有關的財產都查`, groups: individual.flatMap((item) => item.groups) }],
  };
}
function comparison(request: any, column: string, operator: string, value: number | string) {
  return operator === ">" ? request.gt(column, value) : operator === ">=" ? request.gte(column, value) : operator === "<" ? request.lt(column, value) : operator === "<=" ? request.lte(column, value) : request.eq(column, value);
}
function taipeiToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
}
function subtractDate(value: string, amount: number, unit: string) {
  const date = new Date(`${value}T00:00:00.000Z`); const day = date.getUTCDate();
  if (unit === "day") date.setUTCDate(day - amount);
  else if (unit === "week") date.setUTCDate(day - amount * 7);
  else if (unit === "month") { date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - amount); const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(); date.setUTCDate(Math.min(day, last)); }
  else if (unit === "year") { date.setUTCDate(1); date.setUTCFullYear(date.getUTCFullYear() - amount); const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(); date.setUTCDate(Math.min(day, last)); }
  else throw new Error("相對日期單位僅支援天、週、月或年。");
  return date.toISOString().slice(0, 10);
}
function dateRange(predicate: Predicate) {
  const relative = predicate.relative as Record<string, unknown> | undefined; const today = taipeiToday();
  if (relative) {
    const amount = Number(relative.amount); const unit = String(relative.unit ?? "");
    if (!Number.isInteger(amount) || amount < 1 || amount > 120) throw new Error("相對日期期間必須在 1 至 120 之間。");
    return { from: subtractDate(today, amount, unit), to: today, description: `最近${amount}${({ day: "天", week: "週", month: "個月", year: "年" } as Record<string, string>)[unit] || ""}` };
  }
  const from = String(predicate.from ?? ""); const to = String(predicate.to ?? from);
  if (!isoDate.test(from) || !isoDate.test(to) || from > to) throw new Error("日期範圍必須使用有效的 ISO 日期，且起日不得晚於迄日。");
  return { from, to, description: `${from}至${to}` };
}
function rocDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return `${String(year - 1911).padStart(3, "0")}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}
async function compileGroup(client: ReturnType<typeof createClient>, predicates: Predicate[], catalog: Map<string, CatalogField>) {
  let request = client.from("asset_records").select(resultFields, { count: "exact" }).eq("is_current", true); const description: string[] = []; const rules: string[] = []; let prefix: string | null = null;
  for (const predicate of predicates) {
    const field = catalog.get(String(predicate.field ?? ""));
    if (!field || String(predicate.kind ?? "") !== field.value_kind) throw new Error("AI 使用了無效的語意欄位或查詢方式。");
    if (field.value_kind === "entity") {
      const operator = String(predicate.operator ?? "=");
      if (!field.operators.includes(operator)) throw new Error(`${field.label}不支援此查詢運算子。`);
      const value = operator === "contains" ? await confirmEntityContains(client, field, predicate.value) : await resolveEntity(client, field, predicate.value);
      request = operator === "not" ? request.neq(field.column_name!, value) : operator === "contains" ? request.ilike(field.column_name!, `%${value}%`) : request.eq(field.column_name!, value);
      description.push(operator === "not" ? `${field.label}不為${value}` : operator === "contains" ? `${field.label}包含${value}` : `${field.label}為${value}`);
      rules.push(operator === "not" ? `-${field.label}:${value}` : operator === "contains" ? `${field.label}:~${value}` : `${field.label}:${value}`);
    } else if (field.value_kind === "number") {
      const operator = String(predicate.operator ?? ""); const value = Number(String(predicate.value ?? "").replaceAll(",", ""));
      if (!field.operators.includes(operator) || !Number.isFinite(value)) throw new Error(`${field.label}的比較條件無效。`);
      request = comparison(request, field.column_name!, operator, value); description.push(`${field.label}${operator}${value}`);
      rules.push(`${field.label}:${operator}${value}`);
    } else if (field.value_kind === "identifier_range") {
      const from = String(predicate.from ?? ""); const rawTo = String(predicate.to ?? from); const first = assetIdentifier.exec(from);
      const to = first && /^\d{1,7}$/.test(rawTo) ? `${first[1]}-${rawTo.padStart(7, "0")}` : rawTo;
      const last = assetIdentifier.exec(to);
      if (!first || !last || first[1] !== last[1] || (prefix && prefix !== first[1])) throw new Error("財產編號範圍必須使用相同前段的完整 7碼-4碼-7碼格式。");
      prefix = first[1]; request = request.eq("asset_no", first[1]).gte("serial_no", first[2]).lte("serial_no", last[2]); description.push(`財產編號${from}至${to}`);
      rules.push(`${field.label}:${from}`, `${field.label}:<=${to}`);
    } else if (field.value_kind === "date_range") {
      const range = dateRange(predicate); request = request.gte(field.column_name!, range.from).lte(field.column_name!, range.to); description.push(`${field.label}${range.description}`);
      rules.push(`${field.label}:>=${rocDate(range.from)}`, `${field.label}:<=${rocDate(range.to)}`);
    } else {
      if (String(predicate.operator ?? "expired") !== "expired") throw new Error("已過年限僅支援逾期條件。");
      request = request.not(field.column_name!, "is", null).lte(field.column_name!, taipeiToday()); description.push(field.label);
      rules.push("已過年限:true");
    }
  }
  return { request, description, rules };
}
async function executeGroup(client: ReturnType<typeof createClient>, predicates: Predicate[], catalog: Map<string, CatalogField>) {
  const { request, description, rules } = await compileGroup(client, predicates, catalog); const identityIds: string[] = []; let totalCount = 0;
  for (let from = 0; from <= 10000; from += 1000) {
    const { data, error, count } = await request.order("asset_no").order("serial_no").range(from, from + 999);
    if (error) throw error; if (from === 0) totalCount = count ?? 0;
    identityIds.push(...(data || []).map((row) => row.identity_id)); if (!data || data.length < 1000) break;
  }
  if (identityIds.length < totalCount) throw new Error("查詢結果超過 10,000 筆，請補充條件後再試。");
  return { identityIds, description, rules };
}
async function plan(apiKey: string, model: string, question: string, catalog: CatalogField[], candidates: Candidate[]) {
  const capabilities = catalog.map((field) => `${field.field_key}｜${field.label}｜${field.value_kind}｜${field.operators.join(",") || "entity"}`).join("\n");
  const facts = candidates.length ? candidates.map((item) => `${item.fieldKey}｜${item.label}｜${item.value}`).join("\n") : "（沒有名稱候選；仍可使用數值或完整財產編號。）";
  const today = taipeiToday();
  const prompt = `你是財產查詢規劃器。理解使用者自然語言後，只輸出 JSON，不要回答筆數或加入 Markdown。\n\n語意目錄：\n${capabilities}\n\n可用索引事實（僅 entity 可使用；field 必須用 field_key）：\n${facts}\n\n規則：entity 精確比對是 {"kind":"entity","field":"custodian","operator":"=","value":"蕭詣程"}；使用者以類別、部分地點或泛稱描述時可使用 operator:"contains"，例如「宿舍的財產」是 {"kind":"entity","field":"location","operator":"contains","value":"宿舍"}。若問題含「不是／不在／排除／以外／除外」，entity 必須輸出 operator:"not"。number 是 {"kind":"number","field":"net_value","operator":">=","value":100000}；「已過年限／已過使用年限／超過年限／使用年限已到」必須輸出 {"kind":"service_life_status","field":"service_life_expired","operator":"expired"}，絕不可把它解讀為年限 <= 0。完整財產編號範圍是 {"kind":"identifier_range","field":"asset_identifier","from":"5010106-0003-0000284","to":"5010106-0003-0000290"}；日期明確區間是 {"kind":"date_range","field":"acquired_at","from":"2026-07-04","to":"2026-10-04"}，相對日期是 {"kind":"date_range","field":"acquired_at","relative":{"amount":3,"unit":"month"}}。今天台北日期是 ${today}；「最近」包含今天。若使用者在完整起始編號後只寫流水號尾段（例如「到 290」），將 to 寫成完整的同前段 7 碼編號。每個 groups 的 all 是 AND；groups 之間是 OR。提到多個可查實體時，為每個實體建立 OR group。勿自創欄位或值。\n\n只回傳：{"version":1,"groups":[{"all":[...]}]}\n\n問題：${question}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }) });
  const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message || "Gemini 查詢規劃失敗。");
  return parsePlan(payload.candidates?.[0]?.content?.parts || []);
}
async function completedResponse(client: ReturnType<typeof createClient>, question: string, candidates: Candidate[], groups: Predicate[][], catalog: CatalogField[], extraTrace: string[] = []) {
  const catalogByKey = new Map(catalog.map((field) => [field.field_key, field])); const results = await Promise.all(groups.map((predicates) => executeGroup(client, predicates, catalogByKey)));
  const assetIdentityIds = [...new Set(results.flatMap((result) => result.identityIds))]; const descriptions = [...new Set(results.flatMap((result) => result.description))]; const conditionGroups = results.map((result) => result.rules);
  return { question: formatChineseTypography(question), summary: formatChineseTypography(`已依語意目錄與索引事實完成查詢，系統驗證共 ${assetIdentityIds.length} 筆資料。`), explanation: formatChineseTypography(descriptions.length ? `查詢條件：${descriptions.join("；")}。` : "已依語意目錄完成查詢。"), conditionGroups, assetIdentityIds, trace: ["語意目錄", candidates.length ? "解析索引事實" : "直接識別條件", ...extraTrace, formatChineseTypography(`編譯查詢（${assetIdentityIds.length} 筆）`)] };
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(request) });
  try {
    const url = Deno.env.get("SUPABASE_URL")!; const anon = Deno.env.get("SUPABASE_ANON_KEY")!; const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; const auth = request.headers.get("Authorization") ?? "";
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } } }); const admin = createClient(url, service);
    const { data: { user } } = await client.auth.getUser(); if (!user) throw new Error("登入已失效。");
    const payload = await request.json(); const catalog = await loadCatalog(admin);
    if (payload?.action === "clarify") {
      const clarificationId = String(payload.clarificationId ?? ""); const choiceId = String(payload.choiceId ?? ""); const customAnswer = String(payload.customAnswer ?? "").trim();
      const { data: clarification, error } = await admin.from("ai_query_clarifications").select("question,candidates,choices,expires_at,resolved_at").eq("id", clarificationId).eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      if (!clarification || clarification.resolved_at || new Date(clarification.expires_at) < new Date()) throw new Error("這個問題已失效，請重新提問。");
      const candidates = (clarification.candidates || []) as Candidate[]; let groups: Predicate[][]; let question = clarification.question; let trace = ["依追問選擇"];
      if (choiceId === "custom") {
        if (!customAnswer || customAnswer.length > 200) throw new Error("請用不超過 200 字補充您的需求。");
        const { data: setting } = await admin.from("user_ai_settings").select("gemini_key_ciphertext,gemini_key_iv,gemini_model").eq("user_id", user.id).maybeSingle();
        if (!setting?.gemini_key_ciphertext || !setting.gemini_key_iv || !setting.gemini_model) throw new Error("請先在個人設定儲存 Gemini API Key 與模型。");
        const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(setting.gemini_key_iv) }, await encryptionKey(), decode(setting.gemini_key_ciphertext));
        question = `${question}\n使用者補充：${customAnswer}`; groups = await plan(new TextDecoder().decode(raw), setting.gemini_model, question, catalog, candidates); trace = ["依追問補充"];
      } else {
        const choices = (clarification.choices || []) as Array<{ id: string; groups: Predicate[][] }>;
        const choice = choices.find((item) => item.id === choiceId);
        if (!choice?.groups?.length) throw new Error("請選擇一個查詢方式，或補充說明。");
        groups = choice.groups;
      }
      await admin.from("ai_query_clarifications").update({ resolved_at: new Date().toISOString() }).eq("id", clarificationId).eq("user_id", user.id);
      return Response.json(await completedResponse(client, question, candidates, groups, catalog, trace), { headers: headers(request) });
    }
    const query = payload?.query; if (typeof query !== "string" || !query.trim() || query.length > 300) throw new Error("請輸入不超過 300 字的查詢。");
    const question = query.trim(); const candidates = await findCandidates(client, question, catalog); const clarification = clarificationFor(question, candidates);
    if (clarification) {
      const { data, error } = await admin.from("ai_query_clarifications").insert({ user_id: user.id, question, candidates, choices: clarification.options }).select("id").single();
      if (error) throw error;
      return Response.json({ status: "clarification", clarification: { id: data.id, question, prompt: clarification.prompt, options: clarification.options.map(({ id, label }) => ({ id, label })) } }, { headers: headers(request) });
    }
    const { data: setting } = await admin.from("user_ai_settings").select("gemini_key_ciphertext,gemini_key_iv,gemini_model").eq("user_id", user.id).maybeSingle();
    if (!setting?.gemini_key_ciphertext || !setting.gemini_key_iv || !setting.gemini_model) throw new Error("請先在個人設定儲存 Gemini API Key 與模型。");
    const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(setting.gemini_key_iv) }, await encryptionKey(), decode(setting.gemini_key_ciphertext));
    const groups = await plan(new TextDecoder().decode(raw), setting.gemini_model, question, catalog, candidates);
    return Response.json(await completedResponse(client, question, candidates, groups, catalog), { headers: headers(request) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "查詢失敗。" }, { status: 400, headers: headers(request) }); }
});
