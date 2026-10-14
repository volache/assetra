import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  applyIdentifierSpan,
  applySelfScope,
  buildPlannerPrompt,
  collaborationValues,
  flagLabels,
  foldText,
  identifierRule,
  identifierSpan,
  photoValues,
  refersToSelf,
  resolveDateRange,
  rocDate,
  ruleValue,
  selfLabels,
  selfScopes,
} from "./query-rules.ts";

type Client = ReturnType<typeof createClient>;
type CatalogField = { field_key: string; label: string; value_kind: "entity" | "number" | "identifier_range" | "date_range" | "service_life_status" | "data_quality" | "text" | "flag"; column_name: string | null; operators: string[]; configuration: Record<string, unknown> };
type Candidate = { fieldKey: string; label: string; value: string; normalized: string; count: number };
type Predicate = Record<string, unknown>;
type AnalysisPlan = { type: "rank" | "aggregate" | "group" | "quality"; field?: string; aggregate?: "count" | "sum" | "average" | "min" | "max"; groupBy?: string; direction?: "asc" | "desc"; limit?: number; checks?: string[] };
type Clarification = { prompt: string; options: Array<{ id: string; label: string; groups: Predicate[][] }> };
type PlannedQuery = { intent: "lookup" | "analysis" | "clarify"; groups: Predicate[][]; analysis: AnalysisPlan | null; clarification: Clarification | null; modelVersion?: string | null };
type IndexRow = { field: string; display: string; folded: string; count: number };
type FlagSets = { photo: Set<string>; open: Set<string>; inProgress: Set<string> };
type FlagFilter = { field: string; value: string };
type Ctx = { client: Client; admin: Client; index: IndexRow[]; userId: string; flags?: FlagSets; selfCodes?: string[] };

const origins = new Set(["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"]);
const headers = (request: Request) => ({ "Access-Control-Allow-Origin": origins.has(request.headers.get("Origin") ?? "") ? request.headers.get("Origin")! : "http://localhost:5173", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", Vary: "Origin" });
const normalize = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("zh-TW");
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const resultFields = "identity_id,asset_no,serial_no,name,custodian_name,user_name,location_name,unit_name,brand,net_value";
const formatChineseTypography = (value: unknown) => String(value ?? "")
  .replace(/([㐀-鿿])([A-Za-z0-9])/g, "$1 $2")
  .replace(/([A-Za-z0-9])([㐀-鿿])/g, "$1 $2");
const formatCount = (value: number) => Number(value).toLocaleString("zh-TW");
const formatAiText = (value: unknown) => formatChineseTypography(value);
const postgrestQuoted = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const inList = (values: string[]) => `(${values.map(postgrestQuoted).join(",")})`;

async function encryptionKey() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
}
function parsePlan(parts: Array<Record<string, unknown>>): PlannedQuery {
  const text = parts.map((part) => String(part.text ?? "")).join("\n"); const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI 未回傳可驗證的查詢計畫。");
  const plan = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const intent = String(plan.intent ?? "");
  if (plan.version !== 1 || !["lookup", "analysis", "clarify"].includes(intent) || !Array.isArray(plan.groups) || plan.groups.length > 4) throw new Error("AI 查詢計畫格式錯誤。");
  const parseGroups = (rawGroups: unknown, allowEmpty = false) => {
    if (!Array.isArray(rawGroups) || (!allowEmpty && !rawGroups.length) || rawGroups.length > 4) throw new Error("AI 查詢條件格式錯誤。");
    const groups = rawGroups.map((group) => {
    const all = (group as Record<string, unknown>)?.all;
    if (!Array.isArray(all) || all.length > 6 || !all.every((item) => item && typeof item === "object")) throw new Error("AI 查詢條件格式錯誤。");
    return all as Predicate[];
  });
    if (groups.length > 1 && groups.some((group) => !group.length)) throw new Error("不限定條件時只能使用一個查詢群組。");
    return groups;
  };
  const groups = parseGroups(plan.groups, intent === "clarify");
  if (intent === "clarify") {
    const clarification = plan.clarification as Record<string, unknown> | null;
    const rawOptions = clarification?.options;
    if (!clarification || typeof clarification.prompt !== "string" || !clarification.prompt.trim() || clarification.prompt.length > 160 || !Array.isArray(rawOptions) || rawOptions.length < 2 || rawOptions.length > 5) throw new Error("AI 追問格式錯誤。");
    const optionIds = new Set<string>();
    const options = rawOptions.map((option) => {
      const item = option as Record<string, unknown>; const id = String(item.id ?? ""); const label = String(item.label ?? "");
      if (!/^[a-z][a-z0-9_-]{0,39}$/.test(id) || optionIds.has(id) || !label.trim() || label.length > 100) throw new Error("AI 追問選項格式錯誤。");
      optionIds.add(id); return { id, label, groups: parseGroups(item.groups) };
    });
    return { intent, groups, analysis: null, clarification: { prompt: clarification.prompt.trim(), options } };
  }
  const analysis = plan.analysis;
  if (intent === "lookup") return { intent, groups, analysis: null, clarification: null };
  if (analysis === undefined || analysis === null) return { intent, groups, analysis: null, clarification: null };
  if (!analysis || typeof analysis !== "object" || !["rank", "aggregate", "group", "quality"].includes(String((analysis as Record<string, unknown>).type ?? ""))) throw new Error("AI 分析計畫格式錯誤。");
  return { intent, groups, analysis: analysis as AnalysisPlan, clarification: null };
}
async function loadCatalog(admin: Client) {
  const { data, error } = await admin.from("ai_query_semantic_fields").select("field_key,label,value_kind,column_name,operators,configuration").eq("is_active", true).order("field_key");
  if (error) throw error;
  const catalog = (data || []) as CatalogField[];
  if (!catalog.length) throw new Error("AI 查詢語意目錄尚未初始化。");
  return catalog;
}

// ---- where the data is: the value index ----
// ai_query_index_values holds every distinct value of each entity field with
// its record count.  It is small (a few thousand rows), so it is read once and
// kept for a couple of minutes; matching then happens in memory with the same
// spelling fold the search box uses (台/臺/檯, 污/汙, 家具).
let indexCache: { at: number; rows: IndexRow[] } | null = null;
async function loadIndex(admin: Client) {
  if (indexCache && Date.now() - indexCache.at < 120_000) return indexCache.rows;
  const rows: IndexRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("ai_query_index_values").select("field_name,display_value,record_count").order("field_name").order("normalized_value").range(from, from + 999);
    if (error) throw error;
    for (const row of data || []) rows.push({ field: row.field_name, display: row.display_value, folded: foldText(row.display_value), count: row.record_count });
    if (!data || data.length < 1000) break;
  }
  indexCache = { at: Date.now(), rows };
  return rows;
}
const smallDomainLimit = 60;
// People's names are never sent as a full list; only names that match the
// question are offered as candidates, as before.
const personFieldKeys = new Set(["custodian", "user"]);
function listedInFull(field: CatalogField, sizes: Map<string, number>) {
  const size = sizes.get(field.label) || 0;
  return size > 0 && size <= smallDomainLimit && !personFieldKeys.has(field.field_key);
}
function domainSizes(index: IndexRow[]) {
  const sizes = new Map<string, number>();
  for (const row of index) sizes.set(row.field, (sizes.get(row.field) || 0) + 1);
  return sizes;
}
function smallDomainText(ctx: Ctx, catalog: CatalogField[]) {
  const sizes = domainSizes(ctx.index);
  const lines: string[] = [];
  for (const field of catalog.filter((item) => item.value_kind === "entity")) {
    if (!listedInFull(field, sizes)) continue;
    const values = ctx.index.filter((row) => row.field === field.label).sort((left, right) => right.count - left.count);
    lines.push(`${field.field_key}｜${field.label}｜${values.map((row) => `${row.display}(${formatCount(row.count)})`).join("、")}`);
  }
  return lines.join("\n");
}
function fragments(question: string) {
  const text = foldText(question); const found = new Set<string>();
  for (let size = 2; size <= Math.min(5, text.length); size++) for (let start = 0; start + size <= text.length; start++) {
    const piece = text.slice(start, start + size).replace(/[(),.%]/g, ""); if (piece.length >= 2) found.add(piece);
  }
  return [...found].slice(0, 120);
}
function findCandidates(ctx: Ctx, question: string, catalog: CatalogField[]) {
  const byLabel = new Map(catalog.filter((field) => field.value_kind === "entity").map((field) => [field.label, field]));
  const sizes = domainSizes(ctx.index); const pieces = fragments(question);
  const scored: Array<{ row: IndexRow; field: CatalogField; best: number }> = [];
  for (const row of ctx.index) {
    const field = byLabel.get(row.field);
    if (!field || listedInFull(field, sizes)) continue;
    let best = 0; for (const piece of pieces) if (piece.length > best && row.folded.includes(piece)) best = piece.length;
    if (best >= 2) scored.push({ row, field, best });
  }
  return scored.sort((left, right) => right.best - left.best || right.row.count - left.row.count).slice(0, 60)
    .map(({ row, field }): Candidate => ({ fieldKey: field.field_key, label: field.label, value: row.display, normalized: row.folded, count: row.count }));
}
// Every indexed spelling of a value, so 櫃台 reaches 櫃臺 and 櫃檯.
function resolveEntityValues(ctx: Ctx, field: CatalogField, input: unknown, operator: string) {
  const needle = foldText(input); if (!needle || needle.length > 120) throw new Error(`無效的${field.label}條件。`);
  const rows = ctx.index.filter((row) => row.field === field.label);
  const exact = rows.filter((row) => row.folded === needle).map((row) => row.display);
  const contains = rows.filter((row) => row.folded.includes(needle)).map((row) => row.display);
  const choose = (values: string[], mode: "exact" | "contains") => {
    if (values.length > 300) throw new Error(`${field.label}「${String(input)}」符合 ${values.length} 個寫法，請補充更具體的名稱。`);
    return { values, mode };
  };
  if (operator === "contains") {
    if (!contains.length) throw new Error(`索引未找到${field.label}：${String(input)}。`);
    return choose(contains, "contains");
  }
  if (exact.length) return choose(exact, "exact");
  if (contains.length === 1) return choose(contains, "exact");
  if (contains.length > 1) return choose(contains, "contains");
  throw new Error(`索引未找到${field.label}：${String(input)}。`);
}
function comparison(request: any, column: string, operator: string, value: number | string) {
  return operator === ">" ? request.gt(column, value) : operator === ">=" ? request.gte(column, value) : operator === "<" ? request.lt(column, value) : operator === "<=" ? request.lte(column, value) : request.eq(column, value);
}
function taipeiToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
}
async function flagSets(ctx: Ctx): Promise<FlagSets> {
  if (ctx.flags) return ctx.flags;
  const sets: FlagSets = { photo: new Set(), open: new Set(), inProgress: new Set() };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.admin.from("asset_photos").select("asset_identity_id").order("id").range(from, from + 999);
    if (error) throw error;
    for (const row of data || []) sets.photo.add(row.asset_identity_id);
    if (!data || data.length < 1000) break;
  }
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.admin.from("asset_collaborations").select("asset_identity_id,status").neq("kind", "note").in("status", ["open", "in_progress"]).order("id").range(from, from + 999);
    if (error) throw error;
    for (const row of data || []) (row.status === "in_progress" ? sets.inProgress : sets.open).add(row.asset_identity_id);
    if (!data || data.length < 1000) break;
  }
  return (ctx.flags = sets);
}
// The signed-in person's custodian codes come from their account mapping, never
// from the model, so "my assets" cannot be pointed at someone else.
async function selfCodes(ctx: Ctx) {
  if (ctx.selfCodes) return ctx.selfCodes;
  const { data, error } = await ctx.admin.from("user_custodians").select("custodian_code").eq("user_id", ctx.userId);
  if (error) throw error;
  return (ctx.selfCodes = [...new Set((data || []).map((row) => String(row.custodian_code ?? "").trim()).filter(Boolean))]);
}
const noSelfMapping = "目前帳號尚未設定保管人對應，無法判斷「我的財產」。請先請管理員設定帳號的保管人資料。";
function flagMatches(flag: FlagFilter, sets: FlagSets, id: string) {
  if (flag.field === "has_photo") return flag.value === "with" ? sets.photo.has(id) : !sets.photo.has(id);
  const open = sets.open.has(id); const progress = sets.inProgress.has(id);
  if (flag.value === "open") return open;
  if (flag.value === "in_progress") return progress;
  if (flag.value === "any") return open || progress;
  return !open && !progress;
}
async function compileGroup(ctx: Ctx, predicates: Predicate[], catalog: Map<string, CatalogField>) {
  let request = ctx.client.from("asset_records").select(resultFields, { count: "exact" }).eq("is_current", true); const description: string[] = []; const rules: string[] = []; const flags: FlagFilter[] = []; const selves: string[] = [];
  for (const predicate of predicates) {
    if (String(predicate.kind ?? "") === "self") {
      const scope = String(predicate.as ?? "either");
      if (!selfScopes.includes(scope)) throw new Error("「我的財產」的範圍必須是 custodian、user 或 either。");
      const codes = await selfCodes(ctx);
      if (!codes.length) throw new Error(noSelfMapping);
      request = applySelfScope(request, scope, codes); description.push(selfLabels[scope]); selves.push(selfLabels[scope]);
      continue;
    }
    const field = catalog.get(String(predicate.field ?? ""));
    if (!field || String(predicate.kind ?? "") !== field.value_kind) throw new Error("AI 使用了無效的語意欄位或查詢方式。");
    if (field.value_kind === "entity") {
      const operator = String(predicate.operator ?? "=");
      if (!field.operators.includes(operator)) throw new Error(`${field.label}不支援此查詢運算子。`);
      const input = String(predicate.value ?? "").trim();
      const { values, mode } = resolveEntityValues(ctx, field, input, operator);
      const column = field.column_name!; const asRule = mode === "contains" ? `~${ruleValue(input)}` : ruleValue(values[0]);
      if (operator === "not") {
        request = request.or(`${column}.is.null,${column}.not.in.${inList(values)}`);
        description.push(mode === "contains" ? `${field.label}不包含${input}` : `${field.label}不為${values[0]}`); rules.push(`-${field.label}:${asRule}`);
      } else {
        request = values.length === 1 ? request.eq(column, values[0]) : request.in(column, values);
        description.push(mode === "contains" ? `${field.label}包含${input}` : `${field.label}為${values.length > 1 ? values.join("／") : values[0]}`); rules.push(`${field.label}:${asRule}`);
      }
    } else if (field.value_kind === "number") {
      const operator = String(predicate.operator ?? ""); const value = Number(String(predicate.value ?? "").replaceAll(",", ""));
      if (!field.operators.includes(operator) || !Number.isFinite(value)) throw new Error(`${field.label}的比較條件無效。`);
      request = comparison(request, field.column_name!, operator, value); description.push(`${field.label}${operator}${value}`);
      rules.push(`${field.label}:${operator}${value}`);
    } else if (field.value_kind === "text") {
      const operator = String(predicate.operator ?? "contains");
      if (!field.operators.includes(operator)) throw new Error(`${field.label}不支援此查詢運算子。`);
      const value = String(predicate.value ?? "").trim(); if (!value || value.length > 120) throw new Error(`無效的${field.label}條件。`);
      const like = `%${foldText(value).replace(/[\\%_]/g, "\\$&")}%`; const column = field.column_name!;
      request = operator === "not" ? request.or(`${column}.is.null,${column}.not.ilike.${postgrestQuoted(like)}`) : request.ilike(column, like);
      description.push(`${field.label}${operator === "not" ? "不包含" : "包含"}${value}`); rules.push(`${operator === "not" ? "-" : ""}${field.label}:~${ruleValue(value)}`);
    } else if (field.value_kind === "identifier_range") {
      const span = identifierSpan(predicate.from, predicate.to); const rule = identifierRule(predicate.from, predicate.to);
      request = applyIdentifierSpan(request, span); description.push(`財產編號${rule}`); rules.push(rule);
    } else if (field.value_kind === "date_range") {
      const range = resolveDateRange(predicate, taipeiToday());
      if (range.from) { request = request.gte(field.column_name!, range.from); rules.push(`${field.label}:>=${rocDate(range.from)}`); }
      if (range.to) { request = request.lte(field.column_name!, range.to); rules.push(`${field.label}:<=${rocDate(range.to)}`); }
      description.push(`${field.label}${range.description}`);
    } else if (field.value_kind === "service_life_status") {
      if (String(predicate.operator ?? "expired") !== "expired") throw new Error("已達年限僅支援此條件。");
      request = request.not(field.column_name!, "is", null).lte(field.column_name!, taipeiToday()); description.push(field.label);
      rules.push("已達年限:true");
    } else if (field.value_kind === "flag") {
      const value = String(predicate.value ?? "");
      if (!(field.field_key === "has_photo" ? photoValues : collaborationValues).includes(value)) throw new Error(`${field.label}的值無效。`);
      flags.push({ field: field.field_key, value }); description.push(flagLabels[value]);
    } else throw new Error("資料品質欄位僅能用於分析。");
  }
  return { request, description, rules, flags, selves };
}
async function executeGroup(ctx: Ctx, predicates: Predicate[], catalog: Map<string, CatalogField>) {
  const { request, description, rules, flags, selves } = await compileGroup(ctx, predicates, catalog); let identityIds: string[] = []; let totalCount = 0;
  for (let from = 0; from <= 10000; from += 1000) {
    const { data, error, count } = await request.order("asset_no").order("serial_no").range(from, from + 999);
    if (error) throw error; if (from === 0) totalCount = count ?? 0;
    identityIds.push(...(data || []).map((row) => row.identity_id)); if (!data || data.length < 1000) break;
  }
  if (identityIds.length < totalCount) throw new Error("查詢結果超過 10,000 筆，請補充條件後再試。");
  if (flags.length) { const sets = await flagSets(ctx); identityIds = identityIds.filter((id) => flags.every((flag) => flagMatches(flag, sets, id))); }
  return { identityIds, description, rules, flags, selves };
}
function supportsAnalysis(field: CatalogField, capability: string) {
  return Array.isArray(field.configuration?.analysis) && field.configuration.analysis.includes(capability);
}
function analysisNumber(value: unknown) {
  const number = Number(value); return Number.isFinite(number) ? number : null;
}
function formatAnalysisValue(field: CatalogField, value: unknown) {
  if (value === null || value === undefined || value === "") return "未填";
  if (field.value_kind === "date_range") return rocDate(String(value));
  if (field.value_kind === "number") return Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
  return String(value);
}
async function loadAnalysisRows(client: Client, identityIds: string[], columns: string[]) {
  const rows: Array<Record<string, unknown>> = [];
  const selected = [...new Set(["identity_id", "asset_no", "serial_no", "name", ...columns])].join(",");
  for (let start = 0; start < identityIds.length; start += 200) {
    const { data, error } = await client.from("asset_records").select(selected).in("identity_id", identityIds.slice(start, start + 200));
    if (error) throw error; rows.push(...(data || []));
  }
  return rows;
}
async function runAnalysis(client: Client, input: AnalysisPlan, identityIds: string[], catalog: Map<string, CatalogField>) {
  const type = input.type;
  const field = input.field ? catalog.get(input.field) : undefined;
  const aggregate = input.aggregate ?? "count";
  const limit = Math.min(100, Math.max(1, Number.isInteger(input.limit) ? input.limit! : 10));
  if (type === "quality") {
    const allowed = new Set(["missing_custodian", "missing_location", "missing_acquired_at", "missing_useful_life", "unit_mismatch", "person_mismatch"]);
    const checks = (Array.isArray(input.checks) && input.checks.length ? input.checks : [...allowed]).filter((check) => allowed.has(check));
    const rows = await loadAnalysisRows(client, identityIds, ["custodian_name", "location_name", "acquired_at", "useful_life", "unit_name", "use_unit_name", "user_name"]);
    const absent = (value: unknown) => !String(value ?? "").trim();
    const definitions: Record<string, [string, (row: Record<string, unknown>) => boolean]> = {
      missing_custodian: ["未填保管人", (row) => absent(row.custodian_name)],
      missing_location: ["未填存置地點", (row) => absent(row.location_name)],
      missing_acquired_at: ["未填購置日期", (row) => absent(row.acquired_at)],
      missing_useful_life: ["未填年限", (row) => row.useful_life === null || row.useful_life === undefined],
      unit_mismatch: ["保管單位與使用單位不一致", (row) => !absent(row.unit_name) && !absent(row.use_unit_name) && normalize(row.unit_name) !== normalize(row.use_unit_name)],
      person_mismatch: ["保管人與使用人不一致", (row) => !absent(row.custodian_name) && !absent(row.user_name) && normalize(row.custodian_name) !== normalize(row.user_name)],
    };
    const qualityMatches = new Set<string>();
    const qualityRows = checks.map((check) => {
      const matched = rows.filter(definitions[check][1]);
      matched.forEach((row) => qualityMatches.add(String(row.identity_id)));
      return [definitions[check][0], matched.length];
    }).sort((left, right) => Number(right[1]) - Number(left[1]));
    const issues = qualityRows.reduce((sum, row) => sum + Number(row[1]), 0);
    return { kind: "quality", title: "資料品質檢查", summary: formatAiText(`在 ${formatCount(identityIds.length)} 筆資料中，檢出 ${formatCount(issues)} 項欄位缺漏或不一致。`), conditionDescription: `檢查項目：${qualityRows.map(([label]) => String(label)).join("、")}。`, matchCount: qualityMatches.size, columns: ["檢查項目", "筆數"], rows: qualityRows.map(([label, count]) => [String(label), formatCount(Number(count))]), displayIdentityIds: [...qualityMatches] };
  }
  if (type === "rank") {
    if (!field?.column_name || !supportsAnalysis(field, "sort")) throw new Error("此欄位不支援排序分析。");
    const direction = input.direction === "asc" ? "asc" : "desc";
    const rows = await loadAnalysisRows(client, identityIds, [field.column_name]);
    const ranked = rows.filter((row) => row[field.column_name!] !== null && row[field.column_name!] !== undefined).sort((left, right) => {
      const leftValue = field.value_kind === "number" ? analysisNumber(left[field.column_name!]) ?? 0 : String(left[field.column_name!]);
      const rightValue = field.value_kind === "number" ? analysisNumber(right[field.column_name!]) ?? 0 : String(right[field.column_name!]);
      return direction === "asc" ? (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0) : (leftValue > rightValue ? -1 : leftValue < rightValue ? 1 : 0);
    }).slice(0, limit);
    const directionLabel = direction === "asc" ? "由小到大" : "由大到小";
    return { kind: "rank", title: `${field.label}排名`, summary: formatAiText(`依 ${field.label} ${directionLabel}，顯示前 ${formatCount(ranked.length)} 筆。`), columns: ["財產", field.label], rows: ranked.map((row) => [`${row.asset_no ?? ""}-${row.serial_no ?? ""} ${row.name ?? ""}`.trim(), formatAnalysisValue(field, row[field.column_name!])]), displayIdentityIds: ranked.map((row) => String(row.identity_id)) };
  }
  if (type === "aggregate") {
    if (aggregate === "count") return { kind: "aggregate", title: "筆數統計", summary: formatAiText(`符合條件的財產共 ${formatCount(identityIds.length)} 筆。`), value: formatCount(identityIds.length), unit: "筆" };
    if (!field?.column_name || !supportsAnalysis(field, aggregate)) throw new Error("此欄位不支援指定的統計方式。");
    const values = (await loadAnalysisRows(client, identityIds, [field.column_name])).map((row) => analysisNumber(row[field.column_name!])).filter((value): value is number => value !== null);
    if (!values.length) return { kind: "aggregate", title: `${field.label}統計`, summary: "符合條件的資料沒有可計算的數值。", value: "—", unit: "" };
    const result = aggregate === "sum" ? values.reduce((sum, value) => sum + value, 0) : aggregate === "average" ? values.reduce((sum, value) => sum + value, 0) / values.length : aggregate === "min" ? Math.min(...values) : Math.max(...values);
    const labels: Record<string, string> = { sum: "總計", average: "平均", min: "最小", max: "最大" };
    return { kind: "aggregate", title: `${field.label}${labels[aggregate]}`, summary: formatAiText(`以 ${formatCount(values.length)} 筆可計算資料求得。`), value: formatAnalysisValue(field, result), unit: "" };
  }
  const groupField = input.groupBy ? catalog.get(input.groupBy) : undefined;
  if (!groupField?.column_name || !supportsAnalysis(groupField, "group")) throw new Error("此欄位不支援分組分析。");
  if (aggregate !== "count" && (!field?.column_name || !supportsAnalysis(field, aggregate))) throw new Error("此統計欄位不支援分組分析。");
  const columns = [groupField.column_name, ...(aggregate === "count" ? [] : [field!.column_name!])]; const grouped = new Map<string, { count: number; values: number[] }>();
  for (const row of await loadAnalysisRows(client, identityIds, columns)) {
    const key = formatAnalysisValue(groupField, row[groupField.column_name]); const item = grouped.get(key) || { count: 0, values: [] }; item.count++;
    if (aggregate !== "count") { const value = analysisNumber(row[field!.column_name!]); if (value !== null) item.values.push(value); } grouped.set(key, item);
  }
  const label = aggregate === "count" ? "筆數" : `${field!.label}${aggregate === "sum" ? "總計" : aggregate === "average" ? "平均" : aggregate === "min" ? "最小" : "最大"}`;
  const rows = [...grouped.entries()].map(([key, item]) => {
    const value = aggregate === "count" ? item.count : !item.values.length ? null : aggregate === "sum" ? item.values.reduce((sum, value) => sum + value, 0) : aggregate === "average" ? item.values.reduce((sum, value) => sum + value, 0) / item.values.length : aggregate === "min" ? Math.min(...item.values) : Math.max(...item.values);
    return { key, value: value ?? -Infinity };
  }).sort((left, right) => Number(right.value) - Number(left.value)).slice(0, limit);
  return { kind: "group", title: `${groupField.label}${label}分布`, summary: formatAiText(`依 ${groupField.label} 分組，顯示前 ${formatCount(rows.length)} 項。`), columns: [groupField.label, label], rows: rows.map((row) => [row.key, aggregate === "count" ? formatCount(Number(row.value)) : formatAnalysisValue(field!, row.value)]) };
}
async function plan(apiKey: string, model: string, question: string, catalog: CatalogField[], candidates: Candidate[], ctx: Ctx, validationFeedback = "") {
  const capabilities = catalog.map((field) => `${field.field_key}｜${field.label}｜${field.value_kind}｜查詢:${field.operators.join(",") || "entity"}｜分析:${Array.isArray(field.configuration?.analysis) ? field.configuration.analysis.join(",") : "無"}`).join("\n");
  const facts = candidates.length ? candidates.map((item) => `${item.fieldKey}｜${item.label}｜${item.value}（${formatCount(item.count)} 筆）`).join("\n") : "（沒有名稱候選；仍可使用完整值清單、數值、日期或完整財產編號。）";
  const prompt = buildPlannerPrompt({ today: taipeiToday(), capabilities, domains: smallDomainText(ctx, catalog), facts, question, feedback: validationFeedback });
  const generate = async (text: string) => {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }) });
    const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message || "Gemini 查詢規劃失敗。");
    return { ...parsePlan(payload.candidates?.[0]?.content?.parts || []), modelVersion: typeof payload.modelVersion === "string" ? payload.modelVersion : null };
  };
  const planned = await generate(prompt);
  if (planned.intent === "lookup" || planned.intent === "clarify" || planned.analysis) return planned;
  const repaired = await generate(`${prompt}\n\n重要：你已判定 intent 為 analysis，因此 analysis 不可為 null。請保留已確認的查詢範圍，重新輸出完整 JSON，並提供語意目錄支援的 analysis 計畫。`);
  if (repaired.intent !== "analysis" || !repaired.analysis) throw new Error("AI 未能產生與意圖一致的分析計畫，請換一種說法後重試。");
  return repaired;
}
async function validateClarification(ctx: Ctx, clarification: Clarification, catalog: CatalogField[]) {
  const catalogByKey = new Map(catalog.map((field) => [field.field_key, field]));
  for (const option of clarification.options) for (const predicates of option.groups) await compileGroup(ctx, predicates, catalogByKey);
}
async function saveClarification(admin: Client, userId: string, question: string, candidates: Candidate[], clarification: Clarification) {
  const { data, error } = await admin.from("ai_query_clarifications").insert({ user_id: userId, question, candidates, choices: clarification.options }).select("id").single();
  if (error) throw error;
  return { status: "clarification", clarification: { id: data.id, question, prompt: formatAiText(clarification.prompt), options: clarification.options.map(({ id, label }) => ({ id, label: formatAiText(label) })) } };
}
async function completedResponse(ctx: Ctx, question: string, candidates: Candidate[], groups: Predicate[][], catalog: CatalogField[], analysisPlan: AnalysisPlan | null, extraTrace: string[] = [], modelVersion: string | null = null) {
  const catalogByKey = new Map(catalog.map((field) => [field.field_key, field])); const results = await Promise.all(groups.map((predicates) => executeGroup(ctx, predicates, catalogByKey)));
  const assetIdentityIds = [...new Set(results.flatMap((result) => result.identityIds))]; const descriptions = [...new Set(results.flatMap((result) => result.description))];
  const conditionGroups = results.map((result) => [...result.selves, ...result.rules, ...result.flags.map((flag) => flagLabels[flag.value])]);
  const analysis = analysisPlan ? await runAnalysis(ctx.client, analysisPlan, assetIdentityIds, catalogByKey) : null;
  const displayIdentityIds = analysis && "displayIdentityIds" in analysis ? analysis.displayIdentityIds : assetIdentityIds;
  // A plain lookup can be handed back as the search the person would have
  // typed: editable chips, highlighting, and no second round trip.  Photo and
  // collaboration conditions map to the dropdown filters instead of rules.
  let searchRules: string | null = null; let uiFilters: { photo: string; collaboration: string } | null = null;
  // "My assets" is resolved by account code, which the search box cannot say.
  if (!analysisPlan && !results.some((result) => result.selves.length)) {
    const hasEmpty = results.some((result) => !result.rules.length); const hasFlags = results.some((result) => result.flags.length);
    if (results.length === 1 || (!hasEmpty && !hasFlags)) {
      searchRules = results.map((result) => result.rules.join(" ")).join(" | ");
      if (results.length === 1 && hasFlags) {
        uiFilters = { photo: "", collaboration: "" };
        for (const flag of results[0].flags) if (flag.field === "has_photo") uiFilters.photo = flag.value; else uiFilters.collaboration = flag.value;
      }
    }
  }
  return { question: formatAiText(question), modelVersion: modelVersion ? formatAiText(modelVersion) : null, summary: formatAiText(`已依語意目錄與索引事實完成${analysis ? "分析與" : ""}查詢，系統驗證共 ${formatCount(assetIdentityIds.length)} 筆資料。`), explanation: formatAiText(descriptions.length ? `查詢條件：${descriptions.join("；")}。` : "已依語意目錄完成查詢。"), analysisDescription: analysis && "conditionDescription" in analysis ? formatAiText(analysis.conditionDescription) : null, conditionGroups, searchRules, uiFilters, assetIdentityIds, displayIdentityIds, scopeCount: assetIdentityIds.length, analysis, trace: ["語意目錄", candidates.length ? "解析索引事實" : "直接識別條件", ...(analysis ? ["執行分析"] : []), ...extraTrace, formatAiText(`編譯查詢（${formatCount(assetIdentityIds.length)} 筆）`)] };
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(request) });
  try {
    const url = Deno.env.get("SUPABASE_URL")!; const anon = Deno.env.get("SUPABASE_ANON_KEY")!; const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; const auth = request.headers.get("Authorization") ?? "";
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } } }); const admin = createClient(url, service);
    const { data: { user } } = await client.auth.getUser(); if (!user) throw new Error("登入已失效。");
    const payload = await request.json(); const catalog = await loadCatalog(admin);
    const ctx: Ctx = { client, admin, index: await loadIndex(admin), userId: user.id };
    if (payload?.action === "clarify") {
      const clarificationId = String(payload.clarificationId ?? ""); const choiceId = String(payload.choiceId ?? ""); const customAnswer = String(payload.customAnswer ?? "").trim();
      const { data: clarification, error } = await admin.from("ai_query_clarifications").select("question,candidates,choices,expires_at,resolved_at").eq("id", clarificationId).eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      if (!clarification || clarification.resolved_at || new Date(clarification.expires_at) < new Date()) throw new Error("這個問題已失效，請重新提問。");
      const candidates = (clarification.candidates || []) as Candidate[]; let groups: Predicate[][]; let analysisPlan: AnalysisPlan | null = null; let modelVersion: string | null = null; let question = clarification.question; let trace = ["依追問選擇"];
      if (choiceId === "custom") {
        if (!customAnswer || customAnswer.length > 200) throw new Error("請用不超過 200 字補充您的需求。");
        const { data: setting } = await admin.from("user_ai_settings").select("gemini_key_ciphertext,gemini_key_iv,gemini_model").eq("user_id", user.id).maybeSingle();
        if (!setting?.gemini_key_ciphertext || !setting.gemini_key_iv || !setting.gemini_model) throw new Error("請先在個人設定儲存 Gemini API Key 與模型。");
        const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(setting.gemini_key_iv) }, await encryptionKey(), decode(setting.gemini_key_ciphertext));
        question = `${question}\n使用者補充：${customAnswer}`; const planned = await plan(new TextDecoder().decode(raw), setting.gemini_model, question, catalog, candidates, ctx);
        if (planned.intent === "clarify") {
          if (!planned.clarification) throw new Error("AI 未能提供可執行的追問選項。");
          await validateClarification(ctx, planned.clarification, catalog);
          await admin.from("ai_query_clarifications").update({ resolved_at: new Date().toISOString() }).eq("id", clarificationId).eq("user_id", user.id);
          return Response.json(await saveClarification(admin, user.id, question, candidates, planned.clarification), { headers: headers(request) });
        }
        groups = planned.groups; analysisPlan = planned.analysis; modelVersion = planned.modelVersion ?? null; trace = ["依追問補充"];
      } else {
        const choices = (clarification.choices || []) as Array<{ id: string; label?: string; groups: Predicate[][] }>;
        const choice = choices.find((item) => item.id === choiceId);
        if (!choice?.groups?.length) throw new Error("請選擇一個查詢方式，或補充說明。");
        groups = choice.groups;
        const { data: setting } = await admin.from("user_ai_settings").select("gemini_key_ciphertext,gemini_key_iv,gemini_model").eq("user_id", user.id).maybeSingle();
        if (!setting?.gemini_key_ciphertext || !setting.gemini_key_iv || !setting.gemini_model) throw new Error("請先在個人設定儲存 Gemini API Key 與模型。");
        const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(setting.gemini_key_iv) }, await encryptionKey(), decode(setting.gemini_key_ciphertext));
        const planned = await plan(new TextDecoder().decode(raw), setting.gemini_model, `${question}\n使用者選擇：${choice.label || choice.id}`, catalog, candidates, ctx);
        if (planned.intent === "clarify") {
          if (!planned.clarification) throw new Error("AI 未能提供可執行的追問選項。");
          await validateClarification(ctx, planned.clarification, catalog);
          await admin.from("ai_query_clarifications").update({ resolved_at: new Date().toISOString() }).eq("id", clarificationId).eq("user_id", user.id);
          return Response.json(await saveClarification(admin, user.id, question, candidates, planned.clarification), { headers: headers(request) });
        }
        analysisPlan = planned.analysis; modelVersion = planned.modelVersion ?? null;
      }
      await admin.from("ai_query_clarifications").update({ resolved_at: new Date().toISOString() }).eq("id", clarificationId).eq("user_id", user.id);
      return Response.json(await completedResponse(ctx, question, candidates, groups, catalog, analysisPlan, trace, modelVersion), { headers: headers(request) });
    }
    const query = payload?.query; if (typeof query !== "string" || !query.trim() || query.length > 300) throw new Error("請輸入不超過 300 字的查詢。");
    const question = query.trim(); const candidates = findCandidates(ctx, question, catalog);
    if (refersToSelf(question) && !(await selfCodes(ctx)).length) throw new Error(noSelfMapping);
    const { data: setting } = await admin.from("user_ai_settings").select("gemini_key_ciphertext,gemini_key_iv,gemini_model").eq("user_id", user.id).maybeSingle();
    if (!setting?.gemini_key_ciphertext || !setting.gemini_key_iv || !setting.gemini_model) throw new Error("請先在個人設定儲存 Gemini API Key 與模型。");
    const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(setting.gemini_key_iv) }, await encryptionKey(), decode(setting.gemini_key_ciphertext));
    let planned = await plan(new TextDecoder().decode(raw), setting.gemini_model, question, catalog, candidates, ctx);
    if (planned.intent === "clarify") {
      if (!planned.clarification) throw new Error("AI 未能提供可執行的追問選項。");
      await validateClarification(ctx, planned.clarification, catalog);
      return Response.json(await saveClarification(admin, user.id, question, candidates, planned.clarification), { headers: headers(request) });
    }
    try {
      return Response.json(await completedResponse(ctx, question, candidates, planned.groups, catalog, planned.analysis, [], planned.modelVersion), { headers: headers(request) });
    } catch (error) {
      planned = await plan(new TextDecoder().decode(raw), setting.gemini_model, question, catalog, candidates, ctx, error instanceof Error ? error.message : "工具驗證失敗。");
      if (planned.intent === "clarify") {
        if (!planned.clarification) throw new Error("AI 未能提供可執行的追問選項。");
        await validateClarification(ctx, planned.clarification, catalog);
        return Response.json(await saveClarification(admin, user.id, question, candidates, planned.clarification), { headers: headers(request) });
      }
      return Response.json(await completedResponse(ctx, question, candidates, planned.groups, catalog, planned.analysis, [], planned.modelVersion), { headers: headers(request) });
    }
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "查詢失敗。" }, { status: 400, headers: headers(request) }); }
});
