import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import fontUrl from "../../assets/fonts/NotoSansTC-Regular-subset.ttf?url";
import { usedDuration } from "../../lib/formatters";

const AGENCY = "交通部民用航空局花蓮航空站";
const IN_USE = "使用中";
const FONT = "NotoSansTC";
const SIGNATURES = [
  "保管人",
  "保管單位主管",
  "財產管理人員",
  "主辦財產管理人員",
  "主辦會計人員",
  "機關首長",
];
const SHEET_LABEL = { asset: "財產", item: "物品" };
const MAJOR_CLASS = {
  1: "土地",
  2: "房屋建築及設備",
  3: "機械及設備",
  4: "交通及運輸設備",
  5: "雜項設備",
  6: "雜項設備",
};

const page = { width: 297, height: 210, side: 8, top: 29, bottom: 27 };
const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });

let fontPromise;
function loadFontBase64() {
  fontPromise ??= fetch(fontUrl)
    .then((response) => {
      if (!response.ok) throw new Error("無法載入 PDF 中文字型。");
      return response.arrayBuffer();
    })
    .then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    })
    .catch((error) => {
      fontPromise = undefined;
      throw error;
    });
  return fontPromise;
}

export function formatAssetNo(assetNo) {
  const [head, tail] = String(assetNo || "").trim().split("-");
  return /^\d{7}$/.test(head) && tail
    ? `${head[0]}-${head.slice(1, 3)}-${head.slice(3, 5)}-${head.slice(5, 7)}-${tail}`
    : String(assetNo || "");
}

function formatCategoryCode(code) {
  const text = String(code || "").trim();
  return /^\d{3}$/.test(text) ? text.split("").join("-") : text;
}

function rocPrintDate(date = new Date()) {
  return `${date.getFullYear() - 1911}年 ${String(date.getMonth() + 1).padStart(2, "0")}月 ${String(date.getDate()).padStart(2, "0")}日`;
}

function codeAndName(code, name) {
  const cleanCode = String(code || "").replace(/^\*/, "");
  return [cleanCode, name].filter(Boolean).join("\n");
}

function toRow(asset) {
  const duration = usedDuration(asset.acquiredAt);
  return [
    `${formatAssetNo(asset.assetNo)}\n${asset.serialNo}`,
    asset.name,
    asset.categoryName,
    String(asset.acquiredAt || "").replaceAll("/", "-"),
    asset.brand,
    asset.model,
    Number(asset.quantity ?? 0).toFixed(2),
    asset.measureUnit,
    asset.usefulLife ?? "",
    duration === "—" ? "" : duration.replace(/\s/g, ""),
    codeAndName(asset.locationCode, asset.locationName),
    codeAndName(asset.unitCode, asset.unitName),
    codeAndName(asset.custodianCode, asset.custodianName),
    asset.useUnitName,
    codeAndName(asset.userCode, asset.userName),
    "符合\n不符合",
    "補標籤",
    "",
  ];
}

const HEAD = [
  "財產編號\n流水號",
  "財產名稱",
  "財產別名",
  "購置日期",
  "廠牌",
  "型式",
  "數量",
  "計量單位",
  "使用年限",
  "已使用年月",
  "存置地點",
  "保管單位",
  "保管人",
  "使用單位",
  "使用人",
  "檢查情形",
  "標籤",
  "備註",
];
const CHECK_COLUMNS = new Set([15, 16]);

function buildGroups(assets) {
  const buckets = new Map();
  for (const asset of assets) {
    const number = String(asset.assetNo || "").trim();
    const klass = number.startsWith("111")
      ? "土地改良物"
      : MAJOR_CLASS[number[0]] || "其他";
    const category = `${formatCategoryCode(asset.categoryTypeCode)}\u0000${asset.categoryType}`;
    const key = `${category}\u0001${klass}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        categoryCode: formatCategoryCode(asset.categoryTypeCode),
        categoryName: asset.categoryType,
        klass,
        assets: [],
      });
    }
    buckets.get(key).assets.push(asset);
  }
  return [...buckets.values()]
    .map((group) => ({
      ...group,
      assets: group.assets.sort(
        (a, b) =>
          collator.compare(a.locationCode, b.locationCode) ||
          collator.compare(a.locationName, b.locationName) ||
          collator.compare(a.assetNo, b.assetNo) ||
          collator.compare(a.serialNo, b.serialNo),
      ),
    }))
    .sort(
      (a, b) =>
        collator.compare(a.categoryCode, b.categoryCode) ||
        collator.compare(a.klass, b.klass),
    );
}

function drawPageFrame(doc, meta, total, printDate, title) {
  const center = page.width / 2;
  doc.setFontSize(12);
  doc.text(`${AGENCY}${title.sourceSuffix}`, center, 10, { align: "center" });
  doc.setFontSize(14);
  doc.text(`${title.label}盤點清冊`, center, 17, { align: "center" });
  doc.setFontSize(8);
  doc.text(`印表日期：${printDate}`, page.width - page.side, 8, { align: "right" });
  doc.text(
    `頁次：${meta.pageNumber}　總頁數：${total}`,
    page.width - page.side,
    12.5,
    { align: "right" },
  );
  const line = (text, x, y) => doc.text(text, x, y);
  line(
    `財產區分：${meta.group.categoryCode} ${meta.group.categoryName}`.trim(),
    page.side,
    23,
  );
  line(`財產大類：${meta.group.klass}`, page.side + 70, 23);
  if (meta.first)
    line(`財產筆數：${meta.group.assets.length}`, page.side + 120, 23);

  const boxWidth = (page.width - page.side * 2) / SIGNATURES.length;
  const top = page.height - page.bottom + 3;
  doc.setLineWidth(0.2);
  SIGNATURES.forEach((label, index) => {
    const x = page.side + index * boxWidth;
    doc.rect(x, top, boxWidth, 18);
    doc.setFontSize(8);
    doc.text(label, x + 2, top + 4.5);
  });
}

export function inventorySheetFileName(unitName, custodianCode, custodianName, sourceType) {
  const clean = (value) => String(value || "").replace(/[\\/:*?"<>|\s]+/g, "");
  return [clean(unitName), clean(custodianCode), clean(custodianName)]
    .filter(Boolean)
    .concat(`${SHEET_LABEL[sourceType]}盤點清冊.pdf`)
    .join("_");
}

/** Builds one PDF for a single source type and returns its Blob. */
export async function buildSheet(assets, sourceType) {
  const base64 = await loadFontBase64();
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  doc.addFileToVFS(`${FONT}.ttf`, base64);
  doc.addFont(`${FONT}.ttf`, FONT, "normal");
  doc.setFont(FONT, "normal");

  const groups = buildGroups(assets);
  const metaByPage = new Map();
  const printDate = rocPrintDate();
  const lineHeight = () => doc.getLineHeight() / doc.internal.scaleFactor;

  groups.forEach((group, index) => {
    if (index > 0) doc.addPage();
    let first = true;
    autoTable(doc, {
      head: [HEAD],
      body: group.assets.map(toRow),
      startY: page.top,
      margin: { top: page.top, bottom: page.bottom, left: page.side, right: page.side },
      theme: "grid",
      styles: {
        font: FONT,
        fontSize: 6.5,
        cellPadding: 0.8,
        lineWidth: 0.15,
        lineColor: [60, 60, 60],
        textColor: 20,
        valign: "middle",
        overflow: "linebreak",
        minCellHeight: 8,
      },
      headStyles: {
        fillColor: [235, 235, 235],
        textColor: 20,
        halign: "center",
        fontStyle: "normal",
      },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 24 },
        2: { cellWidth: 20 },
        3: { cellWidth: 14 },
        4: { cellWidth: 15 },
        5: { cellWidth: 18 },
        6: { cellWidth: 8, halign: "right" },
        7: { cellWidth: 8, halign: "center" },
        8: { cellWidth: 8, halign: "center" },
        9: { cellWidth: 12 },
        10: { cellWidth: 20 },
        11: { cellWidth: 14 },
        12: { cellWidth: 14 },
        13: { cellWidth: 14 },
        14: { cellWidth: 14 },
        15: { cellWidth: 14, cellPadding: { top: 0.8, bottom: 0.8, left: 4.4, right: 0.8 } },
        16: { cellWidth: 12, cellPadding: { top: 0.8, bottom: 0.8, left: 4.4, right: 0.8 } },
        17: { cellWidth: "auto" },
      },
      rowPageBreak: "avoid",
      didDrawCell(data) {
        if (data.section !== "body" || !CHECK_COLUMNS.has(data.column.index)) return;
        const lines = data.column.index === 15 ? 2 : 1;
        const step = lineHeight();
        const size = 2;
        doc.setLineWidth(0.2);
        for (let i = 0; i < lines; i += 1) {
          const y = data.cell.y + 0.8 + i * step + (step - size) / 2 + 0.15;
          doc.rect(data.cell.x + 1.2, y, size, size);
        }
      },
      didDrawPage() {
        const pageNumber = doc.getCurrentPageInfo().pageNumber;
        metaByPage.set(pageNumber, { pageNumber, group, first });
        first = false;
      },
    });
  });

  const total = doc.getNumberOfPages();
  const title = {
    label: SHEET_LABEL[sourceType],
    sourceSuffix: sourceType === "item" ? "-物品" : "",
  };
  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    doc.setPage(pageNumber);
    doc.setFont(FONT, "normal");
    drawPageFrame(doc, metaByPage.get(pageNumber), total, printDate, title);
  }
  return doc.output("blob");
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Exports the in-use assets kept by one custodian as one PDF per source type
 * (財產 / 物品). Returns the exported file names.
 */
export async function exportCustodianInventorySheets(assets, custodianCode, sourceTypes = ["asset", "item"]) {
  const own = assets.filter(
    (asset) => asset.custodianCode === custodianCode && asset.status === IN_USE,
  );
  const fileNames = [];
  for (const sourceType of sourceTypes) {
    const rows = own.filter((asset) => asset.sourceType === sourceType);
    if (!rows.length) continue;
    const blob = await buildSheet(rows, sourceType);
    const name = inventorySheetFileName(
      rows[0].unitName,
      custodianCode,
      rows[0].custodianName,
      sourceType,
    );
    saveBlob(blob, name);
    fileNames.push(name);
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }
  return fileNames;
}
