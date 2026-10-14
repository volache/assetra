export const filterFields = [
  ["unitName", "保管單位"],
  ["custodianName", "保管人"],
  ["locationName", "存置地點"],
  ["name", "財產名稱"],
  ["categoryName", "財產別名"],
  ["assetMajorClass", "財產大類"],
  ["status", "使用現況"],
];
export const photoFilterOptions = [
  ["", "全部"],
  ["with", "有照片"],
  ["without", "無照片"],
];
export const collaborationFilterOptions = [
  ["", "全部"],
  ["open", "待處理"],
  ["in_progress", "處理中"],
  ["any", "有未結協作"],
  ["none", "無未結協作"],
];
export const defaultPageSize = 50;
// Spellings that this inventory (and its users) mix freely.  Both the query
// and the data are folded the same way before comparing, so 櫃台 finds 櫃臺
// and 櫃檯.  Only the comparison changes; stored and displayed text do not.
//   - single characters: 臺 檯 -> 台 and 汙 -> 污
//   - words: 傢俱 傢具 家俱 -> 家具 (家 and 具 are far too common to fold alone)
const characterFolds = { 臺: "台", 檯: "台", 汙: "污" };
const wordFolds = [
  ["傢俱", "家具"],
  ["傢具", "家具"],
  ["家俱", "家具"],
];
const foldedSpellings = {
  台: "[台臺檯]",
  污: "[污汙]",
};
const furnitureSpellings = "(?:家具|傢俱|傢具|家俱)";
export const normalized = (value) => {
  let text = String(value || "")
    .trim()
    .toLocaleLowerCase("zh-TW");
  for (const [variant, standard] of wordFolds)
    text = text.split(variant).join(standard);
  return text.replace(/[臺檯汙]/g, (character) => characterFolds[character]);
};
// Regular expression source that highlights where a search term matched, in
// any of the folded spellings.  Follows the search rules: * is any run of
// characters (kept short so only the matched part is marked), ? is one
// character, and \* \? \\ are literal.  With numeric, digits may be separated
// by thousands commas so 50000 finds 50,000.  Returns "" when nothing literal
// is left to mark.
export function highlightPatternSource(term, { numeric = false } = {}) {
  const characters = [
    ...normalized(String(term).replace(/^"|"$/g, "")),
  ];
  const escapeRegex = (character) =>
    character.replace(/[.*+^${}()|[\]\\]/g, "\\$&");
  let source = "";
  let literals = 0;
  for (let index = 0; index < characters.length; ) {
    const character = characters[index];
    const next = characters[index + 1];
    if (character === "\\" && next !== undefined && "*?\\".includes(next)) {
      source += escapeRegex(next);
      literals += 1;
      index += 2;
    } else if (character === "*") {
      source += ".*?";
      index += 1;
    } else if (character === "?") {
      source += ".";
      index += 1;
    } else if (character === "家" && next === "具") {
      source += furnitureSpellings;
      literals += 2;
      index += 2;
    } else {
      source += foldedSpellings[character] || escapeRegex(character);
      literals += 1;
      if (numeric && /\d/.test(character) && /\d/.test(next || ""))
        source += ",?";
      index += 1;
    }
  }
  // A * at either end adds nothing to mark, so only the literal core shows.
  source = source.replace(/^(?:\.\*\?)+/, "").replace(/(?:\.\*\?)+$/, "");
  return literals ? source : "";
}
export const searchFieldAliases = {
  保管單位: "unitName",
  保管人: "custodianName",
  存置地點: "locationName",
  財產名稱: "name",
  財產別名: "categoryName",
  使用現況: "status",
  財產編號: "assetNo",
  流水號: "serialNo",
  淨值: "netValue",
  原值: "originalValue",
  累折: "depreciation",
  購置日期: "acquiredAt",
  廠牌: "brand",
  型式: "model",
  使用單位: "useUnitName",
  使用人: "userName",
  計量單位: "measureUnit",
  財產區分別: "categoryType",
  財產大類: "assetMajorClass",
  已使用: "usedDuration",
  年限: "usefulLife",
  已達年限: "serviceLifeExpired",
  已過年限: "serviceLifeExpired",
  已過使用年限: "serviceLifeExpired",
  數量: "quantity",
  備註: "notes",
};
// Each group sits in one of three columns of the rule panel.  A rule is
// [label, text inserted, optional "stacked" to put the example under the label].
export const searchRuleGroups = [
  {
    column: 0,
    title: "邏輯",
    rules: [
      ["任一符合", " | "],
      ["排除文字", " -"],
      ["精確片語", '""'],
    ],
  },
  {
    column: 0,
    title: "萬用字元",
    rules: [
      ["任意數量字元", "*"],
      ["單一字元", "?"],
      ["星號本身", "\\*"],
      ["問號本身", "\\?"],
    ],
  },
  {
    column: 0,
    title: "比較（數字、日期）",
    rules: [
      ["原值至少", "原值:>=50000"],
      ["原值大於", "原值:>50000"],
      ["原值介於", "原值:>=10000 原值:<=50000"],
      ["累折大於", "累折:>10000"],
      ["淨值大於", "淨值:>50000"],
      ["淨值為 0", "淨值:=0"],
      ["數量大於", "數量:>1"],
      ["年限至少 10 年", "年限:>=10"],
      ["已使用至少 5 年", "已使用:>=5年"],
      ["已使用不到 5 年", "已使用:<5年"],
      ["已使用恰好 5 年", "已使用:=5年"],
      ["購置日期以後", "購置日期:>=110/01/01"],
      ["購置日期以前", "購置日期:<=110/01/01"],
    ],
  },
  {
    column: 1,
    title: "指定欄位（完全相符）",
    rules: [
      ["財產編號", "財產編號:"],
      ["流水號", "流水號:"],
      ["保管單位", "保管單位:"],
      ["保管人", "保管人:"],
      ["存置地點", "存置地點:"],
      ["財產名稱", "財產名稱:"],
      ["財產別名", "財產別名:"],
      ["財產大類", "財產大類:"],
      ["財產區分別", "財產區分別:"],
      ["使用現況", "使用現況:"],
      ["使用單位", "使用單位:"],
      ["使用人", "使用人:"],
      ["廠牌", "廠牌:"],
      ["型式", "型式:"],
      ["計量單位", "計量單位:"],
      ["備註", "備註:"],
    ],
  },
  {
    column: 1,
    title: "狀態",
    rules: [
      ["已達使用年限", "已達年限:true"],
      ["尚未達使用年限", "已達年限:false"],
    ],
  },
  {
    column: 2,
    title: "指定欄位（包含文字）",
    rules: [
      ["保管單位包含", "保管單位:~"],
      ["保管人包含", "保管人:~"],
      ["存置地點包含", "存置地點:~"],
      ["財產名稱包含", "財產名稱:~"],
      ["財產別名包含", "財產別名:~"],
      ["使用現況包含", "使用現況:~"],
      ["使用單位包含", "使用單位:~"],
      ["使用人包含", "使用人:~"],
      ["廠牌包含", "廠牌:~"],
      ["型式包含", "型式:~"],
      ["備註包含", "備註:~"],
    ],
  },
  {
    column: 2,
    title: "編號查詢（財產編號-流水號）",
    rules: [
      ["單一件", "5010304-0004-0000120", "stacked"],
      ["流水號區間", "5010304-0004-0000120~128", "stacked"],
      ["跨品項區間", "5010304-0004-0000120~5010400-0001-0000050", "stacked"],
      ["財產編號區間", "5010304-0001~5010400-0001", "stacked"],
      ["財產編號起", "財產編號:>=5010304-0001", "stacked"],
      ["財產編號迄", "財產編號:<=5010400-0001", "stacked"],
    ],
  },
];

export function tokenizeSearch(term) {
  return (
    String(term || "").match(/-?(?:[^\s"|]+:)?(?:"[^"]*"|[^\s|]+)|\|/g) || []
  );
}
function dateNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^\d{7}$/.test(digits) ? Number(digits) : NaN;
}
function numericValue(value) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : NaN;
}
function durationMonths(value) {
  const match = String(value ?? "")
    .trim()
    .match(/^(\d+)\s*年(?:\s*(\d+)\s*月)?$/);
  return match ? Number(match[1]) * 12 + Number(match[2] || 0) : NaN;
}
function searchableValues(asset) {
  return [
    asset.assetNo,
    asset.serialNo,
    asset.name,
    asset.oldNo,
    asset.acquiredAt,
    asset.unitCode,
    asset.unitName,
    asset.useUnitName,
    asset.locationCode,
    asset.locationName,
    asset.custodianCode,
    asset.custodianName,
    asset.rawCustodianName,
    asset.userCode,
    asset.userName,
    asset.rawUserName,
    asset.quantity,
    asset.measureUnit,
    asset.originalValue,
    asset.depreciation,
    asset.netValue,
    asset.usefulLife,
    asset.categoryName,
    asset.categoryTypeCode,
    asset.categoryType,
    asset.model,
    asset.brand,
    asset.notes,
    asset.status,
    asset.sourceType,
    asset.assetMajorClass,
    asset.usedDuration,
  ];
}
// Wildcards: * is any number of characters and ? is one character.  A
// backslash makes the next * ? or \ literal, e.g. 550\*500 finds "550*500".
function parsePattern(raw) {
  const characters = [...raw];
  let wildcard = false;
  let source = "";
  let literal = "";
  const escapeRegex = (character) =>
    character.replace(/[.*+^${}()|[\]\\]/g, "\\$&");
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const next = characters[index + 1];
    if (character === "\\" && next !== undefined && "*?\\".includes(next)) {
      index += 1;
      literal += next;
      source += escapeRegex(next);
    } else if (character === "*") {
      wildcard = true;
      source += ".*";
    } else if (character === "?") {
      wildcard = true;
      source += ".";
    } else {
      literal += character;
      source += escapeRegex(character);
    }
  }
  return { wildcard, source, literal };
}
function textMatches(value, needle) {
  const pattern = parsePattern(
    normalized(String(needle).replace(/^"|"$/g, "")),
  );
  if (!pattern.wildcard) return normalized(value).includes(pattern.literal);
  return new RegExp(pattern.source, "u").test(normalized(value));
}
function exactMatches(value, needle) {
  const pattern = parsePattern(
    normalized(String(needle).replace(/^"|"$/g, "")),
  );
  if (!pattern.wildcard) return normalized(value) === pattern.literal;
  // Wildcards in a field search still have to match the whole value.
  return new RegExp(`^${pattern.source}$`, "u").test(normalized(value));
}
function fieldValues(asset, field) {
  return [
    asset[field],
    field === "custodianName" ? asset.rawCustodianName : "",
    field === "userName" ? asset.rawUserName : "",
  ];
}
// Human-friendly asset numbers typed without a field name:
//   5010304-0004-0000120          one unit (財產編號 + 流水號)
//   5010304-0004-0000120~128      units 120..128 of that 財產編號
//   5010304-0001~5010400-0001     every 財產編號 from A to B, inclusive
const assetNoPattern = "\\d{7}-[0-9A-Za-z]{4}";
const serialFullPattern = new RegExp(`^(${assetNoPattern})-(\\d{1,7})$`);
const serialRangePattern = new RegExp(`^(${assetNoPattern})-(\\d{1,7})~(\\d{1,7})$`);
const spanPattern = new RegExp(
  `^(${assetNoPattern})(?:-(\\d{1,7}))?~(${assetNoPattern})(?:-(\\d{1,7}))?$`,
);
const serialKey = (value) => String(value).padStart(7, "0");
// Rows are ordered by 財產編號 then 流水號, so 財產編號-流水號 (fixed width)
// compared character by character gives the same order as the table.  A
// bound written without a 流水號 stands for the whole 財產編號.
export function parseAssetNumberToken(token) {
  const text = String(token || "");
  let match = text.match(serialRangePattern);
  if (match)
    return {
      kind: "serial-range",
      assetNo: match[1].toUpperCase(),
      from: Number(match[2]),
      to: Number(match[3]),
    };
  match = text.match(serialFullPattern);
  if (match)
    return {
      kind: "serial",
      assetNo: match[1].toUpperCase(),
      serial: Number(match[2]),
    };
  match = text.match(spanPattern);
  if (match) {
    const fromAssetNo = match[1].toUpperCase();
    const toAssetNo = match[3].toUpperCase();
    return {
      kind: "range",
      fromAssetNo,
      toAssetNo,
      from: `${fromAssetNo}-${match[2] === undefined ? "0000000" : serialKey(match[2])}`,
      to: `${toAssetNo}-${match[4] === undefined ? "9999999" : serialKey(match[4])}`,
    };
  }
  return null;
}
function assetNumberMatches(asset, parsed) {
  const assetNo = String(asset.assetNo || "").toUpperCase();
  const serial = numericValue(asset.serialNo);
  if (parsed.kind === "range") {
    if (!Number.isFinite(serial)) return false;
    // Character-by-character order, both ends included.
    const key = `${assetNo}-${serialKey(serial)}`;
    return key >= parsed.from && key <= parsed.to;
  }
  if (assetNo !== parsed.assetNo) return false;
  if (!Number.isFinite(serial)) return false;
  return parsed.kind === "serial"
    ? serial === parsed.serial
    : serial >= parsed.from && serial <= parsed.to;
}
function tokenMatches(asset, rawToken) {
  const negated = rawToken.startsWith("-");
  const token = negated ? rawToken.slice(1) : rawToken;
  const comparison = token.match(/^([^:]+):(>=|<=|>|<|=)(.+)$/);
  const fieldSearch = token.match(/^([^:]+):(.+)$/);
  let matched;
  const assetNumber = parseAssetNumberToken(token);
  if (assetNumber) {
    matched = assetNumberMatches(asset, assetNumber);
  } else if (comparison && searchFieldAliases[comparison[1]]) {
    const [, label, operator, expected] = comparison;
    const field = searchFieldAliases[label];
    if (field === "assetNo") {
      // 財產編號 compares as text, character by character.
      const actualText = String(asset.assetNo || "").toUpperCase();
      const targetText = String(expected).replace(/^"|"$/g, "").toUpperCase();
      matched =
        Boolean(actualText) &&
        Boolean(targetText) &&
        {
          ">": actualText > targetText,
          ">=": actualText >= targetText,
          "<": actualText < targetText,
          "<=": actualText <= targetText,
          "=": actualText === targetText,
        }[operator];
      return negated ? !matched : matched;
    }
    const actual =
      field === "acquiredAt"
        ? dateNumber(asset[field])
        : field === "usedDuration"
          ? durationMonths(asset[field])
          : numericValue(asset[field]);
    const target =
      field === "acquiredAt"
        ? dateNumber(expected)
        : field === "usedDuration"
          ? durationMonths(expected)
          : numericValue(expected);
    matched =
      Number.isFinite(actual) &&
      Number.isFinite(target) &&
      {
        ">": actual > target,
        ">=": actual >= target,
        "<": actual < target,
        "<=": actual <= target,
        "=": actual === target,
      }[operator];
  } else if (fieldSearch && searchFieldAliases[fieldSearch[1]]) {
    const value = fieldSearch[2];
    const field = searchFieldAliases[fieldSearch[1]];
    matched = fieldValues(asset, field).some((actual) =>
      value.startsWith("~")
        ? textMatches(actual, value.slice(1))
        : exactMatches(actual, value),
    );
  } else {
    matched = searchableValues(asset).some((value) =>
      textMatches(value, token),
    );
  }
  return negated ? !matched : matched;
}
export function matchesAdvancedSearch(asset, term) {
  const groups = tokenizeSearch(term)
    .reduce(
      (all, token) => {
        if (token === "|") all.push([]);
        else all[all.length - 1].push(token);
        return all;
      },
      [[]],
    )
    .filter((group) => group.length);
  return (
    !groups.length ||
    groups.some((group) => group.every((token) => tokenMatches(asset, token)))
  );
}

// Full-width punctuation that a Chinese IME produces, mapped one character to
// one character so the caret position stays valid after normalising.
const fullWidthSymbols = {
  "：": ":",
  "｜": "|",
  "＂": '"',
  "“": '"',
  "”": '"',
  "＊": "*",
  "？": "?",
  "～": "~",
  "＞": ">",
  "＜": "<",
  "＝": "=",
  "　": " ",
};
export function normalizeSearchInput(value) {
  return String(value || "")
    .replace(/[：｜＂“”＊？～＞＜＝　]/g, (character) => fullWidthSymbols[character])
    .replace(/(^|\s)－/g, "$1-");
}

const suggestableFields = new Set([
  "unitName",
  "custodianName",
  "locationName",
  "name",
  "categoryName",
  "status",
  "brand",
  "model",
  "useUnitName",
  "userName",
  "measureUnit",
  "categoryType",
  "assetMajorClass",
]);
const comparableFields = new Set([
  "assetNo",
  "serialNo",
  "netValue",
  "originalValue",
  "depreciation",
  "quantity",
  "usefulLife",
  "acquiredAt",
  "usedDuration",
]);
const aliasesHiddenFromSuggestions = new Set(["已過年限", "已過使用年限"]);
export const searchFieldLabels = Object.keys(searchFieldAliases).filter(
  (label) => !aliasesHiddenFromSuggestions.has(label),
);

// The token being typed at the caret.  Whitespace and "|" end a token unless
// they sit inside an open quotation.
export function tokenAtCaret(text, caret) {
  let start = 0;
  let inQuote = false;
  for (let index = 0; index < caret; index += 1) {
    const character = text[index];
    if (character === '"') inQuote = !inQuote;
    else if (!inQuote && (/\s/.test(character) || character === "|"))
      start = index + 1;
  }
  return { start, end: caret, raw: text.slice(start, caret) };
}

const quoteIfNeeded = (value) =>
  /[\s|]/.test(value) && !value.includes('"') ? `"${value}"` : value;

// Suggestions for the token at the caret: field names while a plain word is
// being typed, then real values of the chosen field after the colon.
export const suggestionLimit = 100;
export function suggestionsForToken(raw, distinctValues) {
  const none = { items: [], total: 0 };
  const helper = comparisonHelper(raw);
  if (helper) return helper;
  const assetNumberNote = assetNumberTypingNote(raw);
  if (assetNumberNote) return { items: [], total: 0, note: assetNumberNote };
  const negated = raw.startsWith("-");
  const body = negated ? raw.slice(1) : raw;
  const prefix = negated ? "-" : "";
  const colon = body.indexOf(":");
  if (colon < 0) {
    if (!body || /["*?]/.test(body)) return none;
    const typed = normalized(body);
    const items = searchFieldLabels
      .filter((label) => label.includes(typed))
      .sort(
        (a, b) =>
          Number(b === typed) - Number(a === typed) ||
          Number(b.startsWith(typed)) - Number(a.startsWith(typed)) ||
          a.length - b.length,
      )
      .map((label) => ({
        kind: "field",
        label: `${label}:`,
        hint: label === typed ? "按 Tab 加上冒號" : "指定欄位",
        replacement: `${prefix}${label}:`,
      }));
    return { items, total: items.length };
  }
  const label = body.slice(0, colon);
  const field = searchFieldAliases[label];
  if (!field || !suggestableFields.has(field)) return none;
  let typedValue = body.slice(colon + 1);
  if (/^(>=|<=|>|<|=)/.test(typedValue)) return none;
  const contains = typedValue.startsWith("~");
  if (contains) typedValue = typedValue.slice(1);
  typedValue = typedValue.replace(/^"/, "");
  const needle = normalized(typedValue);
  const matched = distinctValues(field)
    .filter((value) => normalized(value).includes(needle))
    .sort(
      (a, b) =>
        Number(normalized(b).startsWith(needle)) -
        Number(normalized(a).startsWith(needle)),
    );
  return {
    total: matched.length,
    items: matched.slice(0, suggestionLimit).map((value) => ({
      kind: "value",
      label: value,
      hint: label,
      replacement: `${prefix}${label}:${contains ? "~" : ""}${quoteIfNeeded(value)} `,
    })),
  };
}

// Mistakes that would silently return no rows.  Returns plain sentences.
export function searchTermWarnings(term) {
  const warnings = [];
  const text = normalizeSearchInput(term);
  if ((text.match(/"/g) || []).length % 2)
    warnings.push("引號沒有成對，後面的內容會被當成同一段文字。");
  for (const rawToken of tokenizeSearch(text)) {
    if (rawToken === "|") continue;
    const token = rawToken.startsWith("-") ? rawToken.slice(1) : rawToken;
    const assetNumber = parseAssetNumberToken(token);
    if (assetNumber) {
      const reversed =
        (assetNumber.kind === "serial-range" || assetNumber.kind === "range") &&
        assetNumber.from > assetNumber.to;
      if (reversed)
        warnings.push(`「${token}」的起訖順序顛倒，不會查到任何資料。`);
      continue;
    }
    const separator = token.indexOf(":");
    if (separator <= 0) continue;
    const label = token.slice(0, separator);
    const rest = token.slice(separator + 1);
    const field = searchFieldAliases[label];
    if (!field) {
      if (!/^\d+$/.test(label))
        warnings.push(
          `「${label}」不是可用欄位，「${token}」會被當成一般文字搜尋。`,
        );
      continue;
    }
    const comparison = rest.match(/^(>=|<=|>|<|=)(.*)$/);
    if (!comparison) continue;
    const value = comparison[2].replace(/^"|"$/g, "");
    if (!comparableFields.has(field)) {
      warnings.push(
        `「${label}」是文字欄位，不能用 ${comparison[1]} 比較；要包含比對請寫成「${label}:~文字」。`,
      );
    } else if (!value) {
      continue;
    } else if (field === "acquiredAt" && !Number.isFinite(dateNumber(value))) {
      warnings.push(`「${label}」要寫成 民國年/月/日，例如 ${label}:${comparison[1]}110/01/01。`);
    } else if (field === "usedDuration" && !Number.isFinite(durationMonths(value))) {
      warnings.push(`「${label}」要寫成「5年」或「5年6月」，例如 ${label}:${comparison[1]}5年。`);
    } else if (
      field !== "acquiredAt" &&
      field !== "usedDuration" &&
      field !== "assetNo" &&
      !Number.isFinite(numericValue(value))
    ) {
      warnings.push(`「${label}」要比較數字，「${value}」不是數字。`);
    }
  }
  return [...new Set(warnings)];
}

// Split the typed text into finished tokens (shown as chips) and the token
// still being typed.  `head` keeps its trailing separator so that
// head + draft rebuilds the original text exactly.
export function splitSearchTerm(term) {
  const text = String(term || "");
  const { start } = tokenAtCaret(text, text.length);
  return { head: text.slice(0, start), draft: text.slice(start) };
}

const comparisonOperators = [
  [">=", "大於或等於"],
  [">", "大於"],
  ["<=", "小於或等於"],
  ["<", "小於"],
  ["=", "等於"],
];
const quickValues = {
  originalValue: [10000, 50000, 100000, 500000, 1000000],
  depreciation: [10000, 50000, 100000, 500000, 1000000],
  netValue: [0, 10000, 50000, 100000, 1000000],
  quantity: [1, 2, 5, 10, 50],
  usefulLife: [3, 5, 10, 15, 20],
};
const durationQuickValues = ["1年", "3年", "5年", "10年", "15年"];

// Help for a comparison field the user is typing: pick the operator first,
// then a value (quick numbers, years, or a calendar for dates).
function comparisonHelper(raw) {
  const negated = raw.startsWith("-");
  const body = negated ? raw.slice(1) : raw;
  const match = body.match(/^([^:]+):(>=|<=|>|<|=)?(.*)$/);
  if (!match) return null;
  const [, label, operator = "", restRaw] = match;
  const field = searchFieldAliases[label];
  if (!field || !comparableFields.has(field)) return null;
  const rest = restRaw.replace(/^"|"$/g, "");
  const prefix = `${negated ? "-" : ""}${label}:`;
  if (!operator) {
    // "原值:50000" is a plain exact match; only offer operators on an empty value.
    if (rest) return null;
    const items = comparisonOperators.map(([symbol, name]) => ({
      kind: "operator",
      label: `${name}（${symbol}）`,
      hint: label,
      replacement: `${prefix}${symbol}`,
    }));
    return {
      items,
      total: items.length,
      note: `「${label}」要怎麼比較？`,
    };
  }
  const operatorName = comparisonOperators.find(([symbol]) => symbol === operator)[1];
  const base = `${prefix}${operator}`;
  const add = (value, hint) => ({
    kind: "value",
    label: `${base}${value}`,
    hint,
    replacement: `${base}${value} `,
  });
  const items = [];
  let note = `${label}${operatorName}…`;
  let calendar = null;
  if (field === "acquiredAt") {
    note = `${label}${operatorName}：點選日期，或直接輸入 110/01/01`;
    calendar = { prefix: base };
    if (Number.isFinite(dateNumber(rest)) && rest) items.push(add(rest, "加入"));
  } else if (field === "usedDuration") {
    note = `${label}${operatorName}：輸入「5年」或「5年6月」，再按空白鍵加入`;
    if (rest && Number.isFinite(durationMonths(rest))) items.push(add(rest, "加入"));
    for (const value of durationQuickValues)
      if (value !== rest) items.push(add(value, "快速填入"));
  } else if (field === "assetNo") {
    note = `${label}${operatorName}：輸入財產編號（如 5010304-0004），再按空白鍵加入`;
    if (rest) items.push(add(rest, "加入"));
  } else {
    const unit = field === "usefulLife"
        ? "年"
        : field === "quantity" || field === "serialNo"
          ? ""
          : "元";
    note = `${label}${operatorName}：輸入數字${unit ? `（${unit}）` : ""}，再按空白鍵加入`;
    if (rest && Number.isFinite(numericValue(rest))) items.push(add(rest, "加入"));
    for (const value of quickValues[field] || [])
      if (String(value) !== rest)
        items.push(add(String(value), value >= 10000 ? value.toLocaleString("en-US") : "快速填入"));
  }
  return { items, total: items.length, note, calendar };
}

// Short guidance while a 財產編號 / 流水號 / range is being typed.
function assetNumberTypingNote(raw) {
  const assetNo = "\\d{7}-[0-9A-Za-z]{4}";
  if (new RegExp(`^${assetNo}$`).test(raw))
    return "接「-流水號」查單一件（5010304-0004-0000120）；接「~」查區間";
  if (new RegExp(`^${assetNo}-\\d{0,7}$`).test(raw))
    return "流水號不用補零；接「~」查區間，起訖都包含";
  const span = raw.match(new RegExp(`^${assetNo}(?:-\\d{1,7})?~(.*)$`));
  if (!span) return "";
  const end = span[1];
  if (!end)
    return "「~」後面填結束的流水號（同一品項，如 128），或結束的財產編號（可再接 -流水號）";
  if (/^\d{7}$/.test(end))
    return "這是同一品項的流水號；若要指定結束的財產編號，請接「-4 碼」（如 5010400-0001）";
  if (/^\d+$/.test(end)) return "同一品項的流水號區間，起訖都包含，流水號不用補零";
  if (new RegExp(`^${assetNo}$`).test(end))
    return "到該財產編號的最後一件為止；接「-流水號」可指定到第幾件";
  if (new RegExp(`^${assetNo}-\\d{0,7}$`).test(end))
    return "到該財產編號的這一件為止，起訖都包含";
  return "輸入結束的財產編號（如 5010400-0001）";
}

// Which terms mark which field of a result row, for the applied search and
// the dropdown filters.  Returns a function: field name -> terms for
// HighlightText.  A term is a string, or { cell: true } when the whole value
// is what matched (comparisons, asset numbers).
export function highlightTermsFactory(appliedTerm, filters = {}) {
  const wholeCell = { cell: true };
  const plan = tokenizeSearch(appliedTerm)
    .filter((token) => token !== "|" && !token.startsWith("-"))
    .map((token) => {
      if (parseAssetNumberToken(token)) return { type: "assetNumber" };
      const comparison = token.match(/^([^:]+):(>=|<=|>|<|=)(.+)$/);
      if (comparison && searchFieldAliases[comparison[1]])
        return { type: "comparison", field: searchFieldAliases[comparison[1]] };
      const fieldToken = token.match(/^([^:]+):(.+)$/);
      if (fieldToken && searchFieldAliases[fieldToken[1]])
        return {
          type: "field",
          field: searchFieldAliases[fieldToken[1]],
          value: fieldToken[2],
        };
      // Anything else, including an unknown "x:y", is searched as plain text.
      return { type: "text", value: token };
    });
  return (field) => {
    const terms = filters[field] ? [filters[field]] : [];
    for (const item of plan) {
      if (item.type === "text") {
        terms.push(item.value);
      } else if (item.type === "field") {
        if (item.field === field) terms.push(item.value.replace(/^~/, ""));
        else if (
          field === "usedDuration" &&
          item.field === "serviceLifeExpired" &&
          /^true$/i.test(item.value)
        )
          terms.push(wholeCell);
      } else if (item.type === "comparison") {
        if (item.field === field) terms.push(wholeCell);
      } else if (field === "assetNo" || field === "serialNo") {
        terms.push(wholeCell);
      }
    }
    return terms;
  };
}
