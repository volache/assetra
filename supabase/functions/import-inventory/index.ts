import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:5173",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const asText = (value: unknown) => String(value ?? "").trim();
const asNumber = (value: unknown, fallback = 0) => {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const asInteger = (value: unknown) => {
  const normalized = asText(value);
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

function toIsoDate(value: unknown) {
  const text = asText(value);
  if (!text) return null;
  const roc = text.match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (roc) {
    const year = Number(roc[1]) + 1911;
    return `${year}-${roc[2].padStart(2, "0")}-${roc[3].padStart(2, "0")}`;
  }
  const iso = text.match(/^(\d{4})[-/]?(\d{1,2})[-/]?(\d{1,2})$/);
  return iso ? `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}` : null;
}

function normalizeRecord(value: Record<string, unknown>) {
  const categoryTypeCode = asText(value.categoryTypeCode);
  const assetNo = asText(value.assetNo);
  const name = asText(value.name);
  if (!categoryTypeCode || !assetNo || !name) throw new Error("每筆資料都必須包含區分別代碼、財產編號與中文名稱。");
  const originalValue = asNumber(value.originalValue);
  const depreciation = asNumber(value.depreciation);
  const netValue = asNumber(value.netValue);
  if (netValue > originalValue) throw new Error(`財產編號 ${assetNo} 的淨值不能大於原值。`);
  return {
    category_type_code: categoryTypeCode,
    asset_no: assetNo,
    serial_no: asText(value.serialNo),
    name,
    old_no: asText(value.oldNo),
    acquired_at: toIsoDate(value.acquiredAt),
    unit_code: asText(value.unitCode),
    unit_name: asText(value.unitName),
    use_unit_name: asText(value.useUnitName),
    location_code: asText(value.locationCode),
    location_name: asText(value.locationName),
    custodian_code: asText(value.custodianCode),
    custodian_name: asText(value.custodianName),
    user_code: asText(value.userCode),
    user_name: asText(value.userName),
    quantity: asNumber(value.quantity, 1),
    measure_unit: asText(value.measureUnit),
    original_value: originalValue,
    depreciation,
    net_value: netValue,
    useful_life: asInteger(value.usefulLife),
    category_name: asText(value.categoryName),
    category_type: asText(value.categoryType),
    model: asText(value.model),
    brand: asText(value.brand),
    notes: asText(value.notes),
    status: asText(value.status),
  };
}

const identityOf = (record: Record<string, unknown>) => `${record.category_type_code}\u0000${record.asset_no}\u0000${record.serial_no}`;
const compareFields = ['name', 'old_no', 'acquired_at', 'unit_code', 'unit_name', 'use_unit_name', 'location_code', 'location_name', 'custodian_code', 'custodian_name', 'user_code', 'user_name', 'quantity', 'measure_unit', 'original_value', 'depreciation', 'net_value', 'useful_life', 'category_name', 'category_type', 'model', 'brand', 'notes', 'status'];
const sameRecord = (left: Record<string, unknown>, right: Record<string, unknown>) => compareFields.every((field) => String(left[field] ?? '') === String(right[field] ?? ''));

async function loadCurrentRecords(client: ReturnType<typeof createClient>, sourceType: 'asset' | 'item') {
  const records: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from('asset_records').select('*').eq('is_current', true).eq('source_type', sourceType).range(from, from + 999);
    if (error) throw error;
    records.push(...(data || []));
    if (!data || data.length < 1000) return records;
  }
}

const aiIndexFields: Array<[string, string, string]> = [
  ['保管單位', 'unit_name', 'unit'], ['使用單位', 'use_unit_name', 'unit'], ['保管人', 'custodian_name', 'person'], ['使用人', 'user_name', 'person'], ['存置地點', 'location_name', 'location'], ['財產名稱', 'name', 'asset'], ['財產別名', 'category_name', 'asset'], ['財產區分別', 'category_type', 'asset'], ['財產大類', 'asset_major_class', 'asset'], ['使用現況', 'status', 'status'], ['廠牌', 'brand', 'brand'], ['型式', 'model', 'brand'], ['計量單位', 'measure_unit', 'measure'],
];
async function refreshAiQueryIndex(client: ReturnType<typeof createClient>) {
  const [assets, items] = await Promise.all([loadCurrentRecords(client, 'asset'), loadCurrentRecords(client, 'item')]);
  const values = new Map<string, { field_name: string; normalized_value: string; display_value: string; record_count: number; updated_at: string }>();
  const terms: Array<{ asset_record_id: string; asset_identity_id: string; entity_type: string; field_name: string; normalized_value: string; display_value: string }> = [];
  for (const record of [...assets, ...items]) for (const [fieldName, column, entityType] of aiIndexFields) {
    const displayValue = asText(record[column]);
    if (!displayValue) continue;
    const normalizedValue = displayValue.toLocaleLowerCase('zh-TW');
    const key = `${fieldName}\u0000${normalizedValue}`;
    const existing = values.get(key);
    if (existing) existing.record_count += 1;
    else values.set(key, { field_name: fieldName, normalized_value: normalizedValue, display_value: displayValue, record_count: 1, updated_at: new Date().toISOString() });
    terms.push({ asset_record_id: String(record.id), asset_identity_id: String(record.identity_id), entity_type: entityType, field_name: fieldName, normalized_value: normalizedValue, display_value: displayValue });
  }
  const { error: clearError } = await client.from('ai_query_index_values').delete().not('field_name', 'is', null);
  if (clearError) throw clearError;
  const entries = [...values.values()];
  for (let start = 0; start < entries.length; start += 500) {
    const { error } = await client.from('ai_query_index_values').insert(entries.slice(start, start + 500));
    if (error) throw error;
  }
  const { error: termClearError } = await client.from('ai_search_terms').delete().not('field_name', 'is', null);
  if (termClearError) throw termClearError;
  for (let start = 0; start < terms.length; start += 500) {
    const { error } = await client.from('ai_search_terms').insert(terms.slice(start, start + 500));
    if (error) throw error;
  }
  return { values: entries.length, terms: terms.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const [{ data: profile }, { data: role }] = await Promise.all([
    admin.from("profiles").select("status").eq("id", user.id).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle(),
  ]);
  if (profile?.status !== "active" || !role) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });

  try {
    const body = await req.json();
    if (body.mode === 'delete') {
      if (typeof body.importId !== 'string' || !body.importId) throw new Error("請指定要刪除的匯入批次。");
      const { data, error } = await admin.rpc('delete_inventory_import', { p_import_id: body.importId });
      if (error) throw error;
      return new Response(JSON.stringify({ deleted: data }), { headers: corsHeaders });
    }
    if (body.mode === 'changes') {
      const { data, error } = await admin.from('import_batch_changes').select('change_kind, category_type_code, asset_no, serial_no, asset_name, before_record, after_record').eq('import_id', body.importId).order('change_kind').limit(200);
      if (error) throw error;
      return new Response(JSON.stringify({ changes: data || [] }), { headers: corsHeaders });
    }
    if (!['asset', 'item'].includes(body.sourceType)) throw new Error("無效的清冊類型。");
    if (!Array.isArray(body.records) || body.records.length === 0) throw new Error("清冊不可為空。");
    if (body.records.length > 10000) throw new Error("單次匯入最多 10,000 筆資料。");
    const records = body.records.map(normalizeRecord);
    const current = await loadCurrentRecords(admin, body.sourceType);
    const currentByIdentity = new Map(current.map((record) => [identityOf(record), record]));
    const summary = { added: 0, changed: 0, unchanged: 0 };
    const samples = { added: [] as string[], changed: [] as string[] };
    for (const record of records) {
      const identity = identityOf(record);
      const existing = currentByIdentity.get(identity);
      if (!existing) { summary.added += 1; if (samples.added.length < 10) samples.added.push(identity.replaceAll('\u0000', '－')); }
      else if (sameRecord(record, existing)) summary.unchanged += 1;
      else { summary.changed += 1; if (samples.changed.length < 10) samples.changed.push(identity.replaceAll('\u0000', '－')); }
    }
    if (body.mode === 'preview') return new Response(JSON.stringify({ recordCount: records.length, summary, samples }), { headers: corsHeaders });
    const { data: importId, error } = await admin.rpc("commit_inventory_import", {
      p_source_type: body.sourceType,
      p_file_name: asText(body.fileName) || "未命名清冊",
      p_imported_by: user.id,
      p_records: records,
    });
    if (error) throw error;
    if (typeof importId !== 'string' || !importId) throw new Error('匯入已完成，但未取得批次識別碼。');
    const { error: summaryError } = await admin.from('imports').update({ summary }).eq('id', importId);
    if (summaryError) throw summaryError;
    const { data: reconciliation, error: reconciliationError } = await admin.rpc('reconcile_inventory_identities', {
      p_import_id: importId,
      p_source_type: body.sourceType,
    });
    if (reconciliationError) throw reconciliationError;
    let aiIndex: { values: number } | null = null;
    let aiIndexWarning: string | null = null;
    try { aiIndex = await refreshAiQueryIndex(admin); }
    catch (indexError) { console.error("AI query index refresh failed:", indexError); aiIndexWarning = '清冊已匯入，但 AI 候選索引更新失敗，稍後再次匯入會重試。'; }
    const changes = records.map((record) => {
      const before = currentByIdentity.get(identityOf(record));
      const change_kind = !before ? 'added' : sameRecord(record, before) ? 'unchanged' : 'changed';
      return { import_id: importId, change_kind, category_type_code: record.category_type_code, asset_no: record.asset_no, serial_no: record.serial_no, asset_name: record.name, before_record: before || null, after_record: record };
    });
    for (let start = 0; start < changes.length; start += 500) {
      const { error: changesError } = await admin.from('import_batch_changes').insert(changes.slice(start, start + 500));
      if (changesError) throw changesError;
    }
    const { data: retention, error: retentionError } = await admin.rpc('prune_inventory_imports', {
      p_source_type: body.sourceType,
      p_keep: 10,
    });
    if (retentionError) console.error("Import retention cleanup failed:", retentionError);
    return new Response(JSON.stringify({
      importId,
      recordCount: records.length,
      summary,
      reconciliation,
      aiIndex,
      aiIndexWarning,
      retention: retentionError ? { warning: '新批次已完成，但舊批次尚未清理。下次成功匯入時會再次嘗試。' } : retention,
    }), { headers: corsHeaders });
  } catch (error) {
    console.error("Inventory import failed:", error);
    const message = error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String(error.message)
        : "匯入失敗。";
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: corsHeaders });
  }
});
