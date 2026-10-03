export const filterFields = [
  ["unitName", "保管單位"],
  ["custodianName", "保管人"],
  ["locationName", "存置地點"],
  ["name", "財產名稱"],
  ["categoryName", "財產別名"],
  ["status", "使用現況"],
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
    matched = value.startsWith("~")
      ? textMatches(asset[searchFieldAliases[fieldSearch[1]]], value.slice(1))
      : exactMatches(asset[searchFieldAliases[fieldSearch[1]]], value);
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
