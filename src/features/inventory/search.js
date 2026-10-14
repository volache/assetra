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
export const normalized = (value) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase("zh-TW");
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
export const searchRuleGroups = [
  {
    title: "邏輯",
    rules: [
      ["任一符合", " | "],
      ["排除文字", " -"],
      ["精確片語", '""'],
    ],
  },
  {
    title: "萬用字元",
    rules: [
      ["任意文字", "*"],
      ["單一字元", "?"],
    ],
  },
  {
    title: "指定欄位",
    rules: [
      ["保管單位", "保管單位:"],
      ["保管人", "保管人:"],
      ["存置地點", "存置地點:"],
      ["財產名稱", "財產名稱:"],
      ["財產別名", "財產別名:"],
      ["使用現況", "使用現況:"],
    ],
  },
  {
    title: "智慧查詢：包含比對",
    rules: [
      ["保管單位包含", "保管單位:~"],
      ["保管人包含", "保管人:~"],
      ["存置地點包含", "存置地點:~"],
      ["財產名稱包含", "財產名稱:~"],
      ["使用單位包含", "使用單位:~"],
      ["使用人包含", "使用人:~"],
      ["廠牌包含", "廠牌:~"],
      ["型式包含", "型式:~"],
    ],
  },
  {
    title: "其他欄位",
    rules: [
      ["廠牌", "廠牌:"],
      ["型式", "型式:"],
      ["使用單位", "使用單位:"],
      ["使用人", "使用人:"],
      ["計量單位", "計量單位:"],
      ["財產區分別", "財產區分別:"],
      ["財產大類", "財產大類:"],
      ["備註", "備註:"],
    ],
  },
  {
    title: "比較",
    rules: [
      ["已使用恰好 5 年", "已使用:=5年"],
      ["已使用至少 5 年", "已使用:>=5年"],
      ["年限至少 10 年", "年限:>=10"],
      ["已達年限", "已達年限:true"],
      ["數量大於", "數量:>1"],
      ["原值大於", "原值:>50000"],
      ["累折大於", "累折:>10000"],
      ["淨值大於", "淨值:>50000"],
      ["購置日期之後", "購置日期:>=110/01/01"],
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
function textMatches(value, needle) {
  const query = normalized(String(needle).replace(/^"|"$/g, ""));
  if (!/[?*]/.test(query)) return normalized(value).includes(query);
  const expression = [...query]
    .map((character) =>
      character === "*"
        ? ".*"
        : character === "?"
          ? "."
          : character.replace(/[.*+^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(expression, "u").test(normalized(value));
}
function exactMatches(value, needle) {
  return normalized(value) === normalized(String(needle).replace(/^"|"$/g, ""));
}
function fieldValues(asset, field) {
  return [
    asset[field],
    field === "custodianName" ? asset.rawCustodianName : "",
    field === "userName" ? asset.rawUserName : "",
  ];
}
function tokenMatches(asset, rawToken) {
  const negated = rawToken.startsWith("-");
  const token = negated ? rawToken.slice(1) : rawToken;
  const comparison = token.match(/^([^:]+):(>=|<=|>|<|=)(.+)$/);
  const fieldSearch = token.match(/^([^:]+):(.+)$/);
  let matched;
  if (comparison && searchFieldAliases[comparison[1]]) {
    const [, label, operator, expected] = comparison;
    const field = searchFieldAliases[label];
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
export function suggestionsForToken(raw, distinctValues) {
  const negated = raw.startsWith("-");
  const body = negated ? raw.slice(1) : raw;
  const prefix = negated ? "-" : "";
  const colon = body.indexOf(":");
  if (colon < 0) {
    if (!body || /["*?]/.test(body)) return [];
    const typed = normalized(body);
    return searchFieldLabels
      .filter((label) => label.includes(typed) && label !== body)
      .sort(
        (a, b) =>
          Number(b.startsWith(typed)) - Number(a.startsWith(typed)) ||
          a.length - b.length,
      )
      .slice(0, 8)
      .map((label) => ({
        kind: "field",
        label: `${label}:`,
        hint: "指定欄位",
        replacement: `${prefix}${label}:`,
      }));
  }
  const label = body.slice(0, colon);
  const field = searchFieldAliases[label];
  if (!field || !suggestableFields.has(field)) return [];
  let typedValue = body.slice(colon + 1);
  if (/^(>=|<=|>|<|=)/.test(typedValue)) return [];
  const contains = typedValue.startsWith("~");
  if (contains) typedValue = typedValue.slice(1);
  typedValue = typedValue.replace(/^"/, "");
  const needle = normalized(typedValue);
  return distinctValues(field)
    .filter((value) => normalized(value).includes(needle))
    .sort(
      (a, b) =>
        Number(normalized(b).startsWith(needle)) -
        Number(normalized(a).startsWith(needle)),
    )
    .slice(0, 8)
    .map((value) => ({
      kind: "value",
      label: value,
      hint: label,
      replacement: `${prefix}${label}:${contains ? "~" : ""}${quoteIfNeeded(value)} `,
    }));
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
      !Number.isFinite(numericValue(value))
    ) {
      warnings.push(`「${label}」要比較數字，「${value}」不是數字。`);
    }
  }
  return [...new Set(warnings)];
}
