// Pure helpers for the semantic query function.  They have no network or
// database access so they can be unit tested, and they keep the planner
// prompt, the query compiler and the search rules in one place.

// Spellings this inventory mixes freely.  Must stay in step with
// normalized() in src/features/inventory/search.js and ai_fold_text() in SQL.
export const foldText = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase("zh-TW")
    .replace(/傢俱|傢具|家俱/g, "家具")
    .replace(/[臺檯]/g, "台")
    .replace(/汙/g, "污");

// ---- search rule syntax (what the keyword box understands) ----

// Text that is safe to put after "欄位:" in a search rule.
export function ruleValue(value: unknown) {
  const text = String(value ?? "").replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/\?/g, "\\?");
  return /[\s|]/.test(text) && !text.includes('"') ? `"${text}"` : text;
}

export function rocDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return `${String(year - 1911).padStart(3, "0")}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

// ---- 財產編號 (7碼-4碼) + 流水號 (7碼) ----

const assetNoSource = "\\d{7}-[0-9A-Za-z]{4}";
export type IdentifierBound = { assetNo: string; serial: string | null };
export type IdentifierSpan = {
  from: IdentifierBound;
  to: IdentifierBound;
  lowKey: string;
  highKey: string;
  single: boolean;
  sameItem: boolean;
};

export function parseIdentifierBound(text: string): IdentifierBound | null {
  const match = new RegExp(`^(${assetNoSource})(?:-(\\d{1,7}))?$`).exec(String(text ?? "").trim());
  if (!match) return null;
  return { assetNo: match[1].toUpperCase(), serial: match[2] === undefined ? null : match[2].padStart(7, "0") };
}

// A bound written without a 流水號 stands for the whole 財產編號, so the
// low end starts at its first unit and the high end stops at its last one.
export function identifierSpan(fromText: unknown, toText?: unknown): IdentifierSpan {
  const from = parseIdentifierBound(String(fromText ?? ""));
  if (!from) throw new Error("財產編號必須是「7碼-4碼」或「7碼-4碼-流水號」。");
  const rawTo = String(toText ?? fromText).trim();
  let to: IdentifierBound | null;
  if (/^\d{1,7}$/.test(rawTo)) {
    if (from.serial === null) throw new Error("只寫流水號的結尾時，起點必須包含流水號。");
    to = { assetNo: from.assetNo, serial: rawTo.padStart(7, "0") };
  } else to = parseIdentifierBound(rawTo);
  if (!to) throw new Error("財產編號範圍的結尾格式不正確。");
  const lowKey = `${from.assetNo}-${from.serial ?? "0000000"}`;
  const highKey = `${to.assetNo}-${to.serial ?? "9999999"}`;
  if (lowKey > highKey) throw new Error("財產編號範圍的起訖順序顛倒。");
  return {
    from,
    to,
    lowKey,
    highKey,
    single: from.serial !== null && to.serial !== null && lowKey === highKey,
    sameItem: from.assetNo === to.assetNo,
  };
}

// The same range written the way a person types it in the search box.
export function identifierRule(fromText: unknown, toText?: unknown) {
  const span = identifierSpan(fromText, toText);
  const text = (bound: IdentifierBound) => (bound.serial === null ? bound.assetNo : `${bound.assetNo}-${bound.serial}`);
  if (span.single) return text(span.from);
  if (span.sameItem && span.from.serial !== null && span.to.serial !== null) return `${text(span.from)}~${Number(span.to.serial)}`;
  return `${text(span.from)}~${text(span.to)}`;
}

// deno-lint-ignore no-explicit-any
export function applyIdentifierSpan(request: any, span: IdentifierSpan) {
  const low = span.from.serial ?? "0000000";
  const high = span.to.serial ?? "9999999";
  const first = span.from.assetNo;
  const last = span.to.assetNo;
  if (first === last) return request.eq("asset_no", first).gte("serial_no", low).lte("serial_no", high);
  return request
    .or(`asset_no.gt.${first},and(asset_no.eq.${first},serial_no.gte.${low})`)
    .or(`asset_no.lt.${last},and(asset_no.eq.${last},serial_no.lte.${high})`);
}

// ---- dates ----

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const unitLabel: Record<string, string> = { day: "天", week: "週", month: "個月", year: "年" };

export function subtractDate(value: string, amount: number, unit: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const day = date.getUTCDate();
  if (unit === "day") date.setUTCDate(day - amount);
  else if (unit === "week") date.setUTCDate(day - amount * 7);
  else if (unit === "month") {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - amount);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  } else if (unit === "year") {
    date.setUTCDate(1);
    date.setUTCFullYear(date.getUTCFullYear() - amount);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  } else throw new Error("相對日期單位僅支援天、週、月或年。");
  return date.toISOString().slice(0, 10);
}

// relative.direction "within" (default) is the last N units up to today;
// "before" is everything up to and including N units ago.
export function resolveDateRange(predicate: Record<string, unknown>, today: string) {
  const relative = predicate.relative as Record<string, unknown> | undefined;
  if (relative) {
    const amount = Number(relative.amount);
    const unit = String(relative.unit ?? "");
    if (!Number.isInteger(amount) || amount < 1 || amount > 120) throw new Error("相對日期期間必須在 1 至 120 之間。");
    const edge = subtractDate(today, amount, unit);
    if (String(relative.direction ?? "within") === "before")
      return { from: null as string | null, to: edge, description: `${amount}${unitLabel[unit] || ""}前（含）以前` };
    return { from: edge as string | null, to: today as string | null, description: `最近${amount}${unitLabel[unit] || ""}` };
  }
  const from = predicate.from === undefined || predicate.from === null || predicate.from === "" ? null : String(predicate.from);
  const to = predicate.to === undefined || predicate.to === null || predicate.to === "" ? from : String(predicate.to);
  if ((from && !isoDate.test(from)) || (to && !isoDate.test(to)) || (!from && !to)) throw new Error("日期範圍必須使用有效的 ISO 日期。");
  if (from && to && from > to) throw new Error("日期範圍的起日不得晚於迄日。");
  return { from, to, description: from && to ? `${from}至${to}` : from ? `${from}（含）以後` : `${to}（含）以前` };
}

// ---- flags that come from photos and collaboration records ----

export const photoValues = ["with", "without"];
export const collaborationValues = ["open", "in_progress", "any", "none"];
export const flagLabels: Record<string, string> = {
  with: "有照片",
  without: "沒有照片",
  open: "有待處理協作",
  in_progress: "有處理中協作",
  any: "有未結協作",
  none: "沒有未結協作",
};

// ---- "my assets": the signed-in person, resolved from their custodian codes ----

export const selfScopes = ["custodian", "user", "either"];
export const selfLabels: Record<string, string> = {
  custodian: "我保管的",
  user: "我使用的",
  either: "我保管或使用的",
};
// 我的 / 本人 / 我 in a question.
export const refersToSelf = (question: string) => /(?:我的|本人|我)/u.test(question);

// deno-lint-ignore no-explicit-any
export function applySelfScope(request: any, scope: string, codes: string[]) {
  const list = `(${codes.map((code) => `"${code.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
  if (scope === "custodian") return request.in("custodian_code", codes);
  if (scope === "user") return request.in("user_code", codes);
  return request.or(`custodian_code.in.${list},user_code.in.${list}`);
}

// ---- planner prompt ----

export const searchRuleReference = [
  "- 欄位:值 是完全相符；欄位:~文字 是包含；前面加 - 是排除；空白代表「且」；| 代表「或」。",
  "- * 代表任意數量字元，? 代表單一字元；\\* 與 \\? 代表符號本身。",
  "- 數字、日期、年資可用 > >= < <= = 比較；購置日期用民國年，例如 110/01/01。",
  "- 財產編號分兩層：品項（7碼-4碼，如 5010304-0004）與流水號（7碼，如 0000120）。完整編號是 5010304-0004-0000120。",
  "- 編號區間：5010304-0004-0000120~128 是同一品項的流水號 120 到 128；5010304-0004-0000120~5010400-0001-0000050 可以跨品項，中間的品項整個納入；5010304-0001~5010400-0001 是整個品項到整個品項。沒寫流水號就是整個品項；起訖都包含，流水號不用補零。",
  "- 台／臺／檯、污／汙、傢俱／傢具／家具視為同一種寫法，只需要寫其中一種。",
].join("\n");

export const dataSourceGuide = [
  "1. 語意目錄是你唯一可以篩選與分析的欄位，一律使用其 field_key 與 value_kind。",
  "2. entity 欄位的值必須逐字取自「完整值清單」或「相關候選值」；清單沒有的值不要自行創造，系統會再到索引驗證。",
  "3. 完整值清單列出筆數少的欄位的全部值（括號是筆數），請直接在其中選擇。",
  "4. 筆數多的欄位（例如財產名稱、型式、存置地點）只列出與問題相關的候選值。問題的用詞沒出現在候選時，改用 contains 並給最短的關鍵片段，由系統到索引確認。",
  "5. 備註是自由文字，只能用 text 欄位的 contains 或 not。",
  "6. 有無照片與協作狀態來自照片與協作紀錄，使用 flag。",
  "7. 日期請盡量用 relative，不要自己換算成日期；需要「超過 N 年前」時使用 direction:\"before\"。",
  "8. 「我、我的、本人」指登入者本人：使用 self 條件，不要自行填人名；系統會用帳號綁定的保管人代碼查詢。",
].join("\n");

export function buildPlannerPrompt(input: {
  today: string;
  capabilities: string;
  domains: string;
  facts: string;
  question: string;
  feedback?: string;
}) {
  return `你是財產查詢與分析規劃器。理解使用者自然語言後，只輸出 JSON，不要回答筆數或加入 Markdown。今天是 ${input.today}（台北時間）。

【搜尋規則】系統最後會用下面這套規則執行並顯示結果，你輸出的條件會被翻譯成同樣的規則，所以請依規則思考：
${searchRuleReference}

【資料在哪裡、怎麼查】
${dataSourceGuide}

【語意目錄】
${input.capabilities}

【完整值清單】（筆數少的欄位，值逐字可用）
${input.domains || "（無）"}

【相關候選值】（筆數多的欄位，依問題挑出）
${input.facts}

你要自行判斷使用者真正要完成的工作。intent 有三種：lookup 是取回符合條件的原始財產資料；analysis 是從一組資料導出排名、統計、比較、分布、資料品質或不同欄位值；clarify 是索引事實支持兩種以上合理解讀，且沒有足夠語境選擇其中一種。不要因為資料筆數多或文字簡短而追問；能合理完成就選 lookup 或 analysis。追問時必須淺顯、只問一件事，並提供 2 到 5 個可直接執行的選項。

【工具協定】每個篩選都必須使用語意目錄中完全相同的 field_key 與 value_kind。範例：
- entity：{"kind":"entity","field":"custodian","operator":"=","value":"蕭詣程"}；包含比對仍是 kind:"entity"、operator:"contains"；排除用 operator:"not"。
- number：{"kind":"number","field":"net_value","operator":">=","value":100000}
- identifier_range：單一件 {"kind":"identifier_range","field":"asset_identifier","from":"5010304-0004-0000120"}；同品項區間 {"kind":"identifier_range","field":"asset_identifier","from":"5010304-0004-0000120","to":"128"}；跨品項 {"kind":"identifier_range","field":"asset_identifier","from":"5010304-0004-0000120","to":"5010400-0001-0000050"}；整個品項 {"kind":"identifier_range","field":"asset_identifier","from":"5010304-0004"}
- date_range：{"kind":"date_range","field":"acquired_at","relative":{"amount":3,"unit":"month"}}；購置超過 5 年的 {"kind":"date_range","field":"acquired_at","relative":{"amount":5,"unit":"year","direction":"before"}}
- service_life_status：{"kind":"service_life_status","field":"service_life_expired","operator":"expired"}
- text：{"kind":"text","field":"notes","operator":"contains","value":"搬遷"}
- flag：{"kind":"flag","field":"has_photo","value":"without"}；協作 {"kind":"flag","field":"collaboration","value":"open"}（open、in_progress、any、none）
- self（登入者本人，不屬於語意目錄）：{"kind":"self","as":"either"}；as 可為 custodian（我保管的）、user（我使用的）、either（我的財產，預設）。可以和其他條件放在同一個 all 裡。
groups 內 all 是 AND，groups 之間是 OR。

analysis 僅能使用語意目錄所列的分析能力。rank 格式是 {"type":"rank","field":"acquired_at","direction":"asc","limit":1}；aggregate 格式是 {"type":"aggregate","field":"original_value","aggregate":"sum"}；group 格式是 {"type":"group","groupBy":"unit","aggregate":"count","limit":10}；資料品質使用 {"type":"quality","checks":[...]}.

lookup 或 analysis 的 groups 必須至少一組；clarify 的頂層 groups 必須是 []，analysis 必須為 null，並於 clarification 提供 prompt 與 options；每個 option 要有 id、label、以及可執行的 groups。

只回傳：{"version":1,"intent":"lookup","groups":[{"all":[...]}],"analysis":null,"clarification":null}

${input.feedback ? `前一份計畫未通過工具驗證：${input.feedback}\n請保留正確的使用者意圖，依上述目錄與協定重新輸出完整計畫。\n\n` : ""}問題：${input.question}`;
}
