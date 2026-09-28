export function rocDate(value) {
  const text = String(value ?? "").trim();
  const roc = text.match(/^(\d{1,3})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (roc)
    return `${roc[1].padStart(3, "0")}/${roc[2].padStart(2, "0")}/${roc[3].padStart(2, "0")}`;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso)
    return `${String(Number(iso[1]) - 1911).padStart(3, "0")}/${iso[2].padStart(2, "0")}/${iso[3].padStart(2, "0")}`;
  if (!/^\d{5,7}$/.test(text)) return text;
  const padded = text.padStart(7, "0");
  return `${padded.slice(0, 3)}/${padded.slice(3, 5)}/${padded.slice(5, 7)}`;
}

export function rocDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return rocDate(value);
  const year = String(date.getFullYear() - 1911).padStart(3, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}

export function money(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(
        number,
      )
    : "—";
}

export function usedDuration(value) {
  const match = String(value || "").match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return "—";
  const acquired = new Date(
    Number(match[1]) + 1911,
    Number(match[2]) - 1,
    Number(match[3]),
  );
  const today = new Date();
  if (Number.isNaN(acquired.getTime()) || acquired > today) return "—";
  let months =
    (today.getFullYear() - acquired.getFullYear()) * 12 +
    today.getMonth() -
    acquired.getMonth();
  if (today.getDate() < acquired.getDate()) months -= 1;
  return `${Math.floor(months / 12)} 年 ${months % 12} 月`;
}

export function assetMajorClass(assetNo) {
  const number = String(assetNo || "").trim();
  if (number.startsWith("111")) return "土地改良物";
  if (number.startsWith("1")) return "土地";
  if (number.startsWith("2")) return "房屋建築及設備";
  if (number.startsWith("3")) return "機械及設備";
  if (number.startsWith("4")) return "交通及運輸設備";
  if (number.startsWith("5")) return "什項設備";
  if (number.startsWith("6")) return "非消耗品";
  return "—";
}
