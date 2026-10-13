import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import fontUrl from "../../assets/fonts/NotoSansTC-Regular-subset.ttf?url";
import { assetMajorClass, usedDuration } from "../../lib/formatters";

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
const CLASS_ORDER = [
  "土地",
  "土地改良物",
  "房屋建築及設備",
  "機械及設備",
  "交通及運輸設備",
  "什項設備",
  "非消耗品",
];
const classRank = (name) => {
  const index = CLASS_ORDER.indexOf(name);
  return index === -1 ? CLASS_ORDER.length : index;
};

const page = { width: 297, height: 210, side: 8, top: 25, bottom: 10 };
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

function rocPrintDate(date = new Date()) {
  return `${date.getFullYear() - 1911}年${String(date.getMonth() + 1).padStart(2, "0")}月${String(date.getDate()).padStart(2, "0")}日`;
}

const cleanCode = (code) => String(code || "").replace(/^\*/, "");

/** Two "code + name" lines whose names are aligned at their first character. */
function pair(codeA, nameA, codeB, nameB) {
  return {
    content: "",
    lines: [
      { code: cleanCode(codeA), name: nameA || "" },
      { code: cleanCode(codeB), name: nameB || "" },
    ],
  };
}

const FIXED_WIDTHS = { 0: 24, 2: 14, 3: 17, 4: 20, 5: 14, 6: 15, 10: 15, 11: 14 };
const REMARK_MIN_WIDTH = 16;
const CODE_GAP = 1.4;
const CELL_PAD = 0.8;
const CHECK_SIZE = 3;

/** Sizes the content-driven columns so names and places do not wrap. */
function measureLayout(doc, assets) {
  const width = (text, size) => {
    doc.setFontSize(size);
    return text ? doc.getTextWidth(String(text)) : 0;
  };
  let nameMax = 0;
  let locationMax = 0;
  const merged = {
    8: { code: 0, name: 0 },
    9: { code: 0, name: 0 },
  };
  for (const asset of assets) {
    nameMax = Math.max(nameMax, width(asset.name, 6.5), width(asset.categoryName, ALIAS_FONT_SIZE));
    locationMax = Math.max(
      locationMax,
      width(cleanCode(asset.locationCode), 6.5),
      width(asset.locationName, 6.5),
    );
    [
      [8, asset.unitCode, asset.unitName],
      [8, asset.custodianCode, asset.custodianName],
      [9, asset.useUnitCode, asset.useUnitName],
      [9, asset.userCode, asset.userName],
    ].forEach(([column, code, name]) => {
      merged[column].code = Math.max(merged[column].code, width(cleanCode(code), 6.5));
      merged[column].name = Math.max(merged[column].name, width(name, 6.5));
    });
  }
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const pad = CELL_PAD * 2 + 0.8;
  const offsets = {
    8: merged[8].code ? merged[8].code + CODE_GAP : 0,
    9: merged[9].code ? merged[9].code + CODE_GAP : 0,
  };
  const dynamic = {
    1: clamp(nameMax + pad, 30, 60),
    7: clamp(locationMax + pad, 18, 36),
    8: clamp(offsets[8] + merged[8].name + pad, 20, 44),
    9: clamp(offsets[9] + merged[9].name + pad, 20, 44),
  };
  const fixed = Object.values(FIXED_WIDTHS).reduce((sum, value) => sum + value, 0);
  const available = page.width - page.side * 2 - fixed - REMARK_MIN_WIDTH;
  const total = Object.values(dynamic).reduce((sum, value) => sum + value, 0);
  const scale = total > available ? available / total : 1;
  const widths = { ...FIXED_WIDTHS };
  for (const [column, value] of Object.entries(dynamic)) widths[column] = value * scale;
  return { widths, offsets, nameWidth: widths[1] };
}

function toRow(asset) {
  const duration = usedDuration(asset.acquiredAt);
  return [
    `${asset.assetNo}\n${asset.serialNo}`,
    { content: "", name: asset.name || "", alias: asset.categoryName || "" },
    String(asset.acquiredAt || ""),
    asset.brand,
    asset.model,
    `${Number(asset.quantity ?? 0).toFixed(2)}\n${asset.measureUnit || ""}`,
    {
      content: "",
      life: asset.usefulLife ? `${asset.usefulLife}年` : "—",
      used: duration.replace(/\s/g, ""),
    },
    [String(asset.locationCode || "").replace(/^\*/, ""), asset.locationName]
      .filter(Boolean)
      .join("\n"),
    pair(asset.unitCode, asset.unitName, asset.custodianCode, asset.custodianName),
    pair(asset.useUnitCode, asset.useUnitName, asset.userCode, asset.userName),
    "符合\n不符合",
    "補標籤",
    "",
  ];
}

const HEAD = [
  "財產編號\n流水號",
  "財產名稱\n財產別名",
  "購置日期",
  "廠牌",
  "型式",
  "數量\n計量單位",
  "使用年限\n已使用年月",
  "存置地點",
  "保管單位\n保管人",
  "使用單位\n使用人",
  "檢查情形",
  "標籤",
  "備註",
];
const CHECK_COLUMNS = new Set([10, 11]);

function buildGroups(assets) {
  const buckets = new Map();
  for (const asset of assets) {
    const klass = assetMajorClass(asset.assetNo);
    const categoryCode = String(asset.categoryTypeCode || "").trim();
    const key = `${categoryCode}\u0000${asset.categoryType}\u0001${klass}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        categoryCode,
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
        classRank(a.klass) - classRank(b.klass) ||
        collator.compare(a.klass, b.klass),
    );
}

function drawPageFrame(doc, meta, total, printDate, title) {
  const center = page.width / 2;
  doc.setFontSize(16);
  doc.text(`${AGENCY}${title.sourceSuffix}`, center, 10, { align: "center" });
  doc.setFontSize(11);
  doc.text(`${title.label}盤點清冊`, center, 17, { align: "center" });
  doc.setFontSize(8);
  doc.text(`印表日期：${printDate}`, page.side, 8);
  doc.text(`總頁數：${total}`, page.width - page.side, 8, { align: "right" });
  doc.text(`頁次：${meta.pageNumber}`, page.width - page.side, 12.5, { align: "right" });
  doc.setFontSize(8);
  const parts = [
    `財產區分別：${meta.group.categoryCode} ${meta.group.categoryName}`.trim(),
    `財產大類：${meta.group.klass}`,
  ];
  if (meta.first) parts.push(`財產筆數：${meta.group.assets.length}`);
  let x = page.side;
  for (const text of parts) {
    doc.text(text, x, 22.5);
    x += doc.getTextWidth(text) + 8;
  }
}

const SIGNATURE_HEIGHT = 22;
const ALIAS_FONT_SIZE = 5.5;
const ALIAS_COLOR = 110;

function drawSignatures(doc, top) {
  const boxWidth = (page.width - page.side * 2) / SIGNATURES.length;
  doc.setFont(FONT, "normal");
  doc.setFontSize(9);
  SIGNATURES.forEach((label, index) => {
    doc.text(`${label}：`, page.side + index * boxWidth + 2, top + 3);
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
  const layout = measureLayout(doc, assets);
  doc.setFontSize(6.5);
  const metaByPage = new Map();
  const printDate = rocPrintDate();
  const lineHeight = () => doc.getLineHeight() / doc.internal.scaleFactor;
  const checkPadding = {
    top: CELL_PAD,
    bottom: CELL_PAD,
    left: CELL_PAD + CHECK_SIZE + 0.8,
    right: CELL_PAD,
  };

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
        0: { cellWidth: layout.widths[0] },
        1: { cellWidth: layout.widths[1] },
        2: { cellWidth: layout.widths[2], halign: "center" },
        3: { cellWidth: layout.widths[3] },
        4: { cellWidth: layout.widths[4] },
        5: { cellWidth: layout.widths[5], halign: "right" },
        6: { cellWidth: layout.widths[6] },
        7: { cellWidth: layout.widths[7] },
        8: { cellWidth: layout.widths[8] },
        9: { cellWidth: layout.widths[9] },
        10: { cellWidth: layout.widths[10], cellPadding: checkPadding },
        11: { cellWidth: layout.widths[11], cellPadding: checkPadding },
        12: { cellWidth: "auto" },
      },
      rowPageBreak: "avoid",
      didParseCell(data) {
        if (data.section === "head") {
          data.cell.styles.halign = "center";
          return;
        }
        if (data.section === "body" && data.column.index === 1) {
          const { name, alias } = data.cell.raw;
          const width = layout.nameWidth - CELL_PAD * 2 - 0.4;
          doc.setFontSize(6.5);
          const nameLines = name ? doc.splitTextToSize(name, width) : [""];
          doc.setFontSize(ALIAS_FONT_SIZE);
          const aliasLines = alias ? doc.splitTextToSize(alias, width) : [""];
          doc.setFontSize(6.5);
          data.cell.nameLines = nameLines;
          data.cell.aliasLines = aliasLines;
          // Reserve the right height; the lines themselves are drawn in didDrawCell.
          data.cell.text = [...nameLines, ...aliasLines];
        }
      },
      willDrawCell(data) {
        if (data.section === "body" && data.column.index === 1) data.cell.text = [];
      },
      didDrawCell(data) {
        if (data.section === "body" && data.column.index === 1) {
          const { nameLines, aliasLines } = data.cell;
          const step = lineHeight();
          const count = nameLines.length + aliasLines.length;
          const top = data.cell.y + (data.cell.height - count * step) / 2;
          const x = data.cell.x + 0.8;
          doc.setFontSize(6.5);
          doc.setTextColor(20);
          nameLines.forEach((line, index) => {
            doc.text(line, x, top + (index + 0.5) * step, { baseline: "middle" });
          });
          doc.setFontSize(ALIAS_FONT_SIZE);
          doc.setTextColor(ALIAS_COLOR);
          aliasLines.forEach((line, index) => {
            doc.text(line, x, top + (nameLines.length + index + 0.5) * step, {
              baseline: "middle",
            });
          });
          doc.setFontSize(6.5);
          doc.setTextColor(20);
          return;
        }
        if (data.section === "body" && (data.column.index === 8 || data.column.index === 9)) {
          const step = lineHeight();
          const top = data.cell.y + (data.cell.height - 2 * step) / 2;
          const offset = layout.offsets[data.column.index];
          data.cell.raw.lines.forEach(({ code, name }, index) => {
            const y = top + (index + 0.5) * step;
            doc.text(code, data.cell.x + CELL_PAD, y, { baseline: "middle" });
            doc.text(name, data.cell.x + CELL_PAD + offset, y, { baseline: "middle" });
          });
          return;
        }
        if (data.section === "body" && data.column.index === 6) {
          const { life, used } = data.cell.raw;
          const step = lineHeight();
          const top = data.cell.y + (data.cell.height - 2 * step) / 2;
          const anchor = data.cell.x + 4.6;
          const draw = (value, index) => {
            const y = top + (index + 0.5) * step;
            const match = String(value).match(/^(\d+)(年)(.*)$/);
            if (!match) {
              doc.text(String(value), anchor, y, { align: "center", baseline: "middle" });
              return;
            }
            doc.text(match[1], anchor, y, { align: "right", baseline: "middle" });
            doc.text(`年${match[3]}`, anchor, y, { baseline: "middle" });
          };
          draw(life, 0);
          draw(used, 1);
          return;
        }
        if (data.section !== "body" || !CHECK_COLUMNS.has(data.column.index)) return;
        const lines = data.column.index === 10 ? 2 : 1;
        const step = lineHeight();
        const size = CHECK_SIZE;
        const textTop = data.cell.y + (data.cell.height - lines * step) / 2;
        doc.setLineWidth(0.2);
        for (let i = 0; i < lines; i += 1) {
          const y = textTop + i * step + (step - size) / 2;
          doc.rect(data.cell.x + CELL_PAD + 0.4, y, size, size);
        }
      },
      didDrawPage() {
        const pageNumber = doc.getCurrentPageInfo().pageNumber;
        metaByPage.set(pageNumber, { pageNumber, group, first });
        first = false;
      },
    });
    let signTop = doc.lastAutoTable.finalY + 1.6;
    if (signTop + SIGNATURE_HEIGHT > page.height - page.bottom) {
      doc.addPage();
      const pageNumber = doc.getNumberOfPages();
      metaByPage.set(pageNumber, { pageNumber, group, first: false });
      signTop = page.top;
    }
    drawSignatures(doc, signTop);
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
