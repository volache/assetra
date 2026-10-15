import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const origins = new Set(["http://localhost:5173", "http://127.0.0.1:5173", "https://volache.github.io"]);
const headers = (request: Request) => ({ "Access-Control-Allow-Origin": origins.has(request.headers.get("Origin") ?? "") ? request.headers.get("Origin")! : "http://localhost:5173", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", Vary: "Origin" });
const normalize = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("zh-TW");
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const fields: Record<string, string> = { "保管單位": "unit_name", "使用單位": "use_unit_name", "保管人": "custodian_name", "使用人": "user_name", "存置地點": "location_name", "財產名稱": "name", "財產別名": "category_name", "使用現況": "status", "廠牌": "brand", "型式": "model", "財產編號": "asset_no", "淨值": "net_value", "原值": "original_value", "數量": "quantity" };
const numeric = new Set(["淨值", "原值", "數量"]);
const assetNumber = /^(\d{7}-\d{4})-(\d{7})$/;

async function key() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
}

const tools = [{ functionDeclarations: [
  { name: "search_index", description: "搜尋使用者有權查看的財產索引，以確認人員、單位、地點、財產或廠牌等事實。不可根據名稱臆測欄位。", parameters: { type: "OBJECT", properties: { query: { type: "STRING" }, entity_types: { type: "ARRAY", items: { type: "STRING", enum: ["person", "unit", "location", "asset", "brand", "status", "measure"] } } }, required: ["query"] } },
  { name: "search_assets", description: "以已確認的索引事實或數值比較查詢財產。一般文字條件必須先從 search_index 取得相同欄位和值；財產編號是使用者可直接提供的固定格式識別碼，可用 =、>=、<= 表示單號或範圍。", parameters: { type: "OBJECT", properties: { filters: { type: "ARRAY", items: { type: "OBJECT", properties: { field: { type: "STRING" }, operator: { type: "STRING", enum: ["contains", "=", ">", ">=", "<", "<="] }, value: { type: "STRING" } }, required: ["field", "operator", "value"] } } }, required: ["filters"] } },
] }];

async function index(client: ReturnType<typeof createClient>, args: Record<string, unknown>) {
  const query = normalize(args.query); if (!query || query.length > 120) throw new Error("索引查詢格式錯誤。");
  let request = client.from("ai_search_terms").select("asset_identity_id,entity_type,field_name,display_value,normalized_value").ilike("normalized_value", `%${query}%`).limit(80);
  const types = Array.isArray(args.entity_types) ? args.entity_types.filter((value): value is string => typeof value === "string") : [];
  if (types.length) request = request.in("entity_type", types);
  const { data, error } = await request; if (error) throw error;
  const grouped = new Map<string, { entityType: string; fieldName: string; displayValue: string; recordCount: number }>();
  for (const row of data || []) { const id = `${row.entity_type}\0${row.field_name}\0${row.normalized_value}`; const item = grouped.get(id) || { entityType: row.entity_type, fieldName: row.field_name, displayValue: row.display_value, recordCount: 0 }; item.recordCount++; grouped.set(id, item); }
  return { candidates: [...grouped.values()].sort((a, b) => b.recordCount - a.recordCount).slice(0, 30) };
}

async function fastCandidates(client: ReturnType<typeof createClient>, question: string) {
  const text = normalize(question); const fragments = new Set<string>();
  for (let size = 2; size <= Math.min(4, text.length); size++) for (let start = 0; start + size <= text.length; start++) fragments.add(text.slice(start, start + size));
  const filters = [...fragments].slice(0, 18).map((fragment) => `normalized_value.ilike.%${fragment.replace(/[(),.%]/g, "")}%`).filter(Boolean);
  if (!filters.length) return [];
  const { data, error } = await client.from("ai_search_terms").select("entity_type,field_name,display_value,normalized_value").or(filters.join(",")).limit(1000);
  if (error) throw error;
  const grouped = new Map<string, { entityType: string; fieldName: string; displayValue: string; recordCount: number }>();
  for (const row of data || []) { const id = `${row.entity_type}\0${row.field_name}\0${row.normalized_value}`; const item = grouped.get(id) || { entityType: row.entity_type, fieldName: row.field_name, displayValue: row.display_value, recordCount: 0 }; item.recordCount++; grouped.set(id, item); }
  return [...grouped.values()].sort((left, right) => right.recordCount - left.recordCount).slice(0, 30);
}

function parsePlan(parts: Array<Record<string, unknown>>) {
  const text = parts.map((part) => String(part.text ?? "")).join("\n"); const start = text.indexOf("{"); const end = text.lastIndexOf("}"); if (start < 0 || end < start) throw new Error("AI 未回傳查詢計畫。");
  const plan = JSON.parse(text.slice(start, end + 1)); const groups = Array.isArray(plan.groups) ? plan.groups : Array.isArray(plan.filters) ? [plan.filters] : null; if (!groups || !groups.length || !groups.every((group: unknown) => Array.isArray(group))) throw new Error("AI 查詢計畫格式錯誤。"); return { groups: groups.slice(0, 4) as Array<Array<Record<string, unknown>>>, explanation: plan.explanation };
}

async function assets(client: ReturnType<typeof createClient>, args: Record<string, unknown>, issued: Map<string, string[]>) {
  const filters = Array.isArray(args.filters) ? args.filters : []; if (!filters.length || filters.length > 6) throw new Error("請提供 1 至 6 個條件。");
  let request = client.from("asset_records").select("identity_id,asset_no,serial_no,name,custodian_name,user_name,location_name,unit_name,brand,model,status,net_value,original_value,quantity", { count: "exact" }).eq("is_current", true); let assetNumberPrefix: string | null = null;
  for (const raw of filters) { const field = String(raw?.field ?? ""); const value = String(raw?.value ?? "").trim(); const op = String(raw?.operator ?? "contains"); const column = fields[field]; if (!column || !value) throw new Error("AI 提供了無效條件。");
    if (field === "財產編號") {
      const parts = assetNumber.exec(value);
      if (!parts || !["=", ">", ">=", "<", "<="].includes(op)) throw new Error("財產編號必須使用完整的 7碼-4碼-7碼格式，並以 =、>、>=、< 或 <= 查詢。");
      const [, prefix, serial] = parts;
      if (assetNumberPrefix && assetNumberPrefix !== prefix) throw new Error("單一財產編號範圍必須使用相同的前段編號。");
      assetNumberPrefix = prefix;
      request = request.eq("asset_no", prefix);
      request = op === ">" ? request.gt("serial_no", serial) : op === ">=" ? request.gte("serial_no", serial) : op === "<" ? request.lt("serial_no", serial) : op === "<=" ? request.lte("serial_no", serial) : request.eq("serial_no", serial);
    }
    else if (numeric.has(field)) { const amount = Number(value.replaceAll(",", "")); if (!Number.isFinite(amount)) throw new Error("數值條件無效。"); request = op === ">" ? request.gt(column, amount) : op === ">=" ? request.gte(column, amount) : op === "<" ? request.lt(column, amount) : op === "<=" ? request.lte(column, amount) : request.eq(column, amount); }
    else {
      const requested = normalize(value);
      const matches = [...new Set((issued.get(field) || []).filter((candidate) => normalize(candidate).includes(requested)))];
      if (!matches.length) throw new Error(`未由索引確認的條件：${field}：${value}`);
      if (matches.length > 1) throw new Error(`索引中有多個可能的${field}：${value}，請補充更具體的名稱。`);
      const confirmedValue = matches[0];
      request = op === "=" ? request.eq(column, confirmedValue) : request.ilike(column, `%${confirmedValue}%`);
    }
  }
  const { data, error, count } = await request.order("asset_no").limit(1000); if (error) throw error;
  const all = data || [];
  return { totalCount: count ?? all.length, identityIds: all.map((row) => row.identity_id), assets: all.slice(0, 60).map((row) => ({ identityId: row.identity_id, assetNo: row.asset_no, name: row.name, custodianName: row.custodian_name, userName: row.user_name, locationName: row.location_name, unitName: row.unit_name, brand: row.brand, netValue: row.net_value })) };
}

function final(parts: Array<Record<string, unknown>>) {
  const text = parts.map((part) => String(part.text ?? "")).join("\n"); const start = text.indexOf("{"); const end = text.lastIndexOf("}"); if (start < 0 || end < start) throw new Error("AI 未完成查詢。");
  const result = JSON.parse(text.slice(start, end + 1)); if (typeof result.summary !== "string" || typeof result.explanation !== "string" || !Array.isArray(result.assetIdentityIds)) throw new Error("AI 回應格式錯誤。");
  return { summary: result.summary.slice(0, 240), explanation: result.explanation.slice(0, 600), assetIdentityIds: result.assetIdentityIds.filter((id: unknown): id is string => typeof id === "string") };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(request) });
  try {
    const url = Deno.env.get("SUPABASE_URL")!; const anon = Deno.env.get("SUPABASE_ANON_KEY")!; const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; const auth = request.headers.get("Authorization") ?? "";
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } } }); const admin = createClient(url, service); const { data: { user } } = await client.auth.getUser(); if (!user) throw new Error("登入已失效。");
    const { query } = await request.json(); if (typeof query !== "string" || !query.trim() || query.length > 300) throw new Error("請輸入不超過 300 字的查詢。");
    const { data: setting } = await admin.from("user_ai_settings").select("gemini_key_ciphertext,gemini_key_iv,gemini_model").eq("user_id", user.id).maybeSingle(); if (!setting?.gemini_key_ciphertext || !setting.gemini_key_iv || !setting.gemini_model) throw new Error("請先在個人設定儲存 Gemini API Key 與模型。");
    const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(setting.gemini_key_iv) }, await key(), decode(setting.gemini_key_ciphertext)); const apiKey = new TextDecoder().decode(raw);
    const candidates = await fastCandidates(client, query);
    if (candidates.length) {
      const facts = candidates.map((item) => `${item.entityType}｜${item.fieldName}｜${item.displayValue}`).join("\n");
      const planResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(setting.gemini_model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `你是財產查詢代理。理解問題後，僅能使用下列索引事實中的完全相同「欄位｜值」組合來下文字條件；數值欄位可用比較。財產編號是例外：使用者提供完整格式（7碼-4碼-7碼）時，直接用 >= 與 <= 建立編號範圍，不須在索引找完全相同值。系統會將前 7碼-4碼比對資產編號，最後 7碼比對流水號；同一範圍兩端必須共用前段。不得猜測欄位或筆數。每個 groups 項目是 AND；groups 之間是 OR。問題提及多個人員、地點或單位時，必須為每個已匹配實體建立一個 OR group。只回傳 JSON：{"groups":[[{"field":"財產編號","operator":">=","value":"5010106-0003-0000284"},{"field":"財產編號","operator":"<=","value":"5010106-0003-0000290"}]],"explanation":"..."}\n\n問題：${query}\n\n索引事實：\n${facts}` }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }) });
      const planPayload = await planResponse.json(); if (!planResponse.ok) throw new Error(planPayload?.error?.message || "Gemini 查詢失敗。");
      const plan = parsePlan(planPayload.candidates?.[0]?.content?.parts || []); const issued = new Map<string, string[]>();
      for (const item of candidates) {
        const applicableFields = item.entityType === "person" ? ["保管人", "使用人"] : [item.fieldName];
        for (const field of applicableFields) issued.set(field, [...(issued.get(field) || []), item.displayValue]);
      }
      const groupResults = await Promise.all(plan.groups.map((filters) => assets(client, { filters }, issued))); const assetIdentityIds = [...new Set(groupResults.flatMap((result) => result.identityIds))];
      return Response.json({ summary: `已依索引事實完成查詢，系統驗證共 ${assetIdentityIds.length} 筆資料。`, explanation: String(plan.explanation ?? "AI 已依索引事實建立查詢條件。 ").slice(0, 600), assetIdentityIds, trace: ["快速索引", `查詢財產（${assetIdentityIds.length} 筆）`] }, { headers: headers(request) });
    }
    const contents: Array<Record<string, unknown>> = [{ role: "user", parts: [{ text: query.trim() }] }]; const issued = new Map<string, string[]>(); const resultIds = new Set<string>(); const trace: string[] = []; let searchedIndex = false; let searchedAssets = false;
    const instruction = "你是財產查詢代理。先理解自然語言，再用工具取得可驗證事實；不得用常識猜欄位。若名稱有歧義請說明，不要任意選擇。一般文字條件必須引用 search_index 的 fieldName 與 displayValue；財產編號若是使用者提供的完整 7碼-4碼-7碼格式，可直接用 search_assets 的 >= 與 <= 建立範圍，無須索引確認。系統會以其前 7碼-4碼比對資產編號、最後 7碼比對流水號，同一範圍兩端須為相同前段。search_assets 的 totalCount 是唯一可使用的筆數，絕不可自行估計或宣稱不同數量。完成後只輸出 JSON：{summary,explanation,assetIdentityIds}；ID 只能使用 search_assets 回傳的 identityId。";
    for (let round = 0; round < 4; round++) { const availableTools = searchedAssets ? undefined : searchedIndex ? [{ functionDeclarations: tools[0].functionDeclarations.filter((tool) => tool.name === "search_assets") }] : tools; const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(setting.gemini_model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify({ systemInstruction: { parts: [{ text: instruction }] }, contents, ...(availableTools ? { tools: availableTools } : {}), generationConfig: { temperature: 0, responseMimeType: "application/json" } }) }); const data = await response.json(); if (!response.ok) throw new Error(data?.error?.message || "Gemini 查詢失敗。"); const parts = data.candidates?.[0]?.content?.parts || []; const calls = parts.filter((part: Record<string, unknown>) => part.functionCall);
      if (!calls.length) { const answer = final(parts); const assetIdentityIds = answer.assetIdentityIds.filter((id) => resultIds.has(id)); if (assetIdentityIds.length !== answer.assetIdentityIds.length) throw new Error("AI 回傳了未驗證的財產。 "); return Response.json({ ...answer, assetIdentityIds, trace }, { headers: headers(request) }); }
      contents.push({ role: "model", parts }); const responses = [];
      for (const part of calls) { const call = part.functionCall as { name?: string; args?: Record<string, unknown> }; const output = call.name === "search_index" && !searchedIndex ? await index(client, call.args || {}) : call.name === "search_assets" && !searchedAssets ? await assets(client, call.args || {}, issued) : { error: "此步驟的工具已不可再呼叫，請依現有事實完成回答。" }; if (call.name === "search_index" && "candidates" in output) { searchedIndex = true; for (const item of output.candidates as Array<Record<string, unknown>>) { const field = String(item.fieldName ?? ""); const value = String(item.displayValue ?? ""); issued.set(field, [...(issued.get(field) || []), value]); } trace.push("搜尋索引"); } if (call.name === "search_assets" && "assets" in output) { for (const id of output.identityIds as string[]) resultIds.add(id); searchedAssets = true; trace.push(`查詢財產（${output.totalCount} 筆）`); } responses.push({ functionResponse: { name: call.name, response: output } }); }
      contents.push({ role: "user", parts: responses });
    }
    throw new Error("AI 查詢步驟超過上限。");
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "查詢失敗。" }, { status: 400, headers: headers(request) }); }
});
