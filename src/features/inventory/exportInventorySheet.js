import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import fontUrl from "../../assets/fonts/NotoSansTC-Regular-subset.ttf?url";
import { assetMajorClass, usedDuration } from "../../lib/formatters";

export const AGENCY = "交通部民用航空局花蓮航空站";
const IN_USE = "使用中";
export const FONT = "NotoSansTC";
const SIGNATURES = [
  "保管人",
  "保管單位主管",
  "財產管理人員",
  "主辦財產管理人員",
  "主辦會計人員",
  "機關首長",
];
export const CLASS_ORDER = [
  "土地",
  "土地改良物",
  "房屋建築及設備",
  "機械及設備",
  "交通及運輸設備",
  "什項設備",
  "非消耗品",
];
export const classRank = (name) => {
  const index = CLASS_ORDER.indexOf(name);
  return index === -1 ? CLASS_ORDER.length : index;
};

export const page = { width: 297, height: 210, side: 8, top: 25, bottom: 12 };
export const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });

let fontPromise;
export function loadFontBase64() {
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

export function rocPrintDate(date = new Date()) {
  return `${date.getFullYear() - 1911}年${String(date.getMonth() + 1).padStart(2, "0")}月${String(date.getDate()).padStart(2, "0")}日`;
}

export const cleanCode = (code) => String(code || "").trim();

/** Two "code + name" lines whose names are aligned at their first character. */
export function pair(codeA, nameA, codeB, nameB) {
  return {
    content: "",
    lines: [
      { code: cleanCode(codeA), name: nameA || "" },
      { code: cleanCode(codeB), name: nameB || "" },
    ],
  };
}

const COL = {
  NO: 0,
  ASSET: 1,
  NAME: 2,
  DATE: 3,
  BRAND: 4,
  MODEL: 5,
  QTY: 6,
  LIFE: 7,
  UNIT: 8,
  USE: 9,
  CHECK: 10,
  TAG: 11,
  REMARK: 12,
};
const COLUMN_COUNT = 13;
const FIXED_WIDTHS = {
  [COL.NO]: 8,
  [COL.ASSET]: 24,
  [COL.DATE]: 18,
  [COL.BRAND]: 17,
  [COL.MODEL]: 20,
  [COL.QTY]: 14,
  [COL.LIFE]: 20,
  [COL.CHECK]: 18,
  [COL.TAG]: 17,
};
const REMARK_MIN_WIDTH = 16;
const REMARK_MAX_WIDTH = 26;
export const CODE_GAP = 1.4;
export const TABLE_FONT_SIZE = 8;
export const CELL_PAD = 1;
const CHECK_SIZE = 3.2;
export const LOCATION_ROW_HEIGHT = 7.5;
export const ALIAS_FONT_SIZE = 7;
export const ALIAS_COLOR = 65;
export const ALIAS_DIVIDER_COLOR = 155;
export const ALIAS_DIVIDER_GAP = 1.8;
export const ALIAS_DIVIDER_INSET = 2.2;
const SIGNATURE_HEIGHT = 22;
export const GRID_STYLES = {
  font: FONT,
  fontSize: TABLE_FONT_SIZE,
  cellPadding: CELL_PAD,
  lineWidth: 0.15,
  lineColor: [60, 60, 60],
  textColor: 20,
  valign: "middle",
  overflow: "linebreak",
};

/** Sizes the content-driven columns so names and places do not wrap. */
function measureLayout(doc, assets) {
  const width = (text, size) => {
    doc.setFontSize(size);
    return text ? doc.getTextWidth(String(text)) : 0;
  };
  let nameMax = 0;
  const merged = {
    [COL.UNIT]: { code: 0, name: 0 },
    [COL.USE]: { code: 0, name: 0 },
  };
  for (const asset of assets) {
    nameMax = Math.max(nameMax, width(asset.name, TABLE_FONT_SIZE), width(asset.categoryName, ALIAS_FONT_SIZE));
    [
      [COL.UNIT, asset.unitCode, asset.unitName],
      [COL.UNIT, asset.custodianCode, asset.custodianName],
      [COL.USE, asset.useUnitCode, asset.useUnitName],
      [COL.USE, asset.userCode, asset.userName],
    ].forEach(([column, code, name]) => {
      merged[column].code = Math.max(merged[column].code, width(cleanCode(code), TABLE_FONT_SIZE));
      merged[column].name = Math.max(merged[column].name, width(name, TABLE_FONT_SIZE));
    });
  }
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const pad = CELL_PAD * 2 + 0.8;
  const offsets = {
    [COL.UNIT]: merged[COL.UNIT].code ? merged[COL.UNIT].code + CODE_GAP : 0,
    [COL.USE]: merged[COL.USE].code ? merged[COL.USE].code + CODE_GAP : 0,
  };
  const dynamic = {
    [COL.NAME]: clamp(nameMax + pad, 34, 60),
    [COL.UNIT]: clamp(offsets[COL.UNIT] + merged[COL.UNIT].name + pad, 20, 29),
    [COL.USE]: clamp(offsets[COL.USE] + merged[COL.USE].name + pad, 20, 29),
  };
  const fixed = Object.values(FIXED_WIDTHS).reduce((sum, value) => sum + value, 0);
  const room = page.width - page.side * 2 - fixed;
  const total = Object.values(dynamic).reduce((sum, value) => sum + value, 0);
  let remark = REMARK_MIN_WIDTH;
  let scale = 1;
  if (total > room - REMARK_MIN_WIDTH) scale = (room - REMARK_MIN_WIDTH) / total;
  else {
    // Spare width: a little more for the remarks, the rest spread over the content columns.
    const spare = room - REMARK_MIN_WIDTH - total;
    remark = Math.min(REMARK_MAX_WIDTH, REMARK_MIN_WIDTH + spare * 0.4);
    scale = (room - remark) / total;
  }
  const widths = { ...FIXED_WIDTHS };
  for (const [column, value] of Object.entries(dynamic)) widths[column] = value * scale;
  return { widths, offsets, nameWidth: widths[COL.NAME] };
}

function toRow(asset, sequence) {
  const duration = usedDuration(asset.acquiredAt);
  return [
    String(sequence),
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
    pair(asset.unitCode, asset.unitName, asset.custodianCode, asset.custodianName),
    pair(asset.useUnitCode, asset.useUnitName, asset.userCode, asset.userName),
    "符合\n不符合",
    "補標籤",
    "",
  ];
}

const HEAD = [
  "序號",
  "財產編號\n流水號",
  "財產名稱\n財產別名",
  "購置日期",
  "廠牌",
  "型式",
  "數量\n計量單位",
  "使用年限\n已使用年月",
  "保管單位\n保管人",
  "使用單位\n使用人",
  "檢查情形",
  "標籤",
  "備註",
];
const CHECK_COLUMNS = new Set([COL.CHECK, COL.TAG]);

export const locationKey = (asset) =>
  `${cleanCode(asset.locationCode)}\u0000${asset.locationName || ""}`;
export const locationLabel = (asset) =>
  [cleanCode(asset.locationCode), asset.locationName].filter(Boolean).join(" ") || "未指定";

function locationRow({ text, hint = "" }) {
  return [
    {
      content: text,
      hint,
      colSpan: COLUMN_COUNT,
      styles: {
        halign: "left",
        fillColor: [240, 240, 240],
        minCellHeight: LOCATION_ROW_HEIGHT,
      },
    },
  ];
}

export function buildGroups(assets) {
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

/** Frame drawn on every page once the total page count is known. */
export function drawPageFrame(doc, meta, total, printDate, options = {}) {
  const center = page.width / 2;
  doc.setFontSize(16);
  doc.text(AGENCY, center, 10, { align: "center" });
  doc.setFontSize(11);
  const heading =
    options.titles?.[meta.kind] ??
    (meta.kind === "index"
      ? "存置地點索引"
      : meta.kind === "cover"
        ? "財物盤點清冊　總覽"
        : "財物盤點清冊");
  doc.text(heading, center, 17, { align: "center" });
  doc.setFontSize(8);
  doc.text(`印表日期：${printDate}`, page.side, 8);
  if (options.printedBy) doc.text(`印表人：${options.printedBy}`, page.side, 12.5);
  doc.text(`總頁數：${total}`, page.width - page.side, 8, { align: "right" });
  doc.text(`頁次：${meta.pageNumber}`, page.width - page.side, 12.5, { align: "right" });
  if (meta.kind !== "content") return;
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
  if (meta.pageCount > 0) {
    doc.setFontSize(7);
    doc.text(
      `本頁 ${meta.pageCount} 筆，${meta.group.klass}累計 ${meta.cumulative} / ${meta.group.assets.length} 筆`,
      page.side,
      page.height - 5,
    );
  }
}

function drawSignatures(doc, top) {
  const boxWidth = (page.width - page.side * 2) / SIGNATURES.length;
  doc.setFont(FONT, "normal");
  doc.setFontSize(9);
  SIGNATURES.forEach((label, index) => {
    doc.text(`${label}：`, page.side + index * boxWidth + 2, top + 3);
  });
}

export function inventorySheetFileName(unitName, custodianCode, custodianName) {
  const clean = (value) => String(value || "").replace(/[\\/:*?"<>|\s]+/g, "");
  return [clean(unitName), clean(custodianCode), clean(custodianName)]
    .filter(Boolean)
    .concat("財物盤點清冊.pdf")
    .join("_");
}

/** Builds one 財物盤點清冊 PDF (assets and items together) and returns its Blob. */
export async function buildSheet(assets) {
  const base64 = await loadFontBase64();
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  doc.addFileToVFS(`${FONT}.ttf`, base64);
  doc.addFont(`${FONT}.ttf`, FONT, "normal");
  doc.setFont(FONT, "normal");

  const groups = buildGroups(assets);
  const layout = measureLayout(doc, assets);
  doc.setFontSize(TABLE_FONT_SIZE);
  const metaByPage = new Map();
  const printDate = rocPrintDate();
  const lineHeight = () => doc.getLineHeight() / doc.internal.scaleFactor;
  const checkPadding = {
    top: CELL_PAD,
    bottom: CELL_PAD,
    left: CELL_PAD + CHECK_SIZE + 0.8,
    right: CELL_PAD,
  };

  const tableOptions = (body, extra = {}) => ({
    head: [HEAD],
    body,
    startY: page.top,
    margin: { top: page.top, bottom: page.bottom, left: page.side, right: page.side },
    theme: "grid",
    styles: { ...GRID_STYLES, minCellHeight: 11 },
    headStyles: {
      fillColor: [235, 235, 235],
      textColor: 20,
      halign: "center",
      fontStyle: "normal",
    },
    columnStyles: {
      [COL.NO]: { cellWidth: layout.widths[COL.NO], halign: "center" },
      [COL.ASSET]: { cellWidth: layout.widths[COL.ASSET] },
      [COL.NAME]: { cellWidth: layout.widths[COL.NAME] },
      [COL.DATE]: { cellWidth: layout.widths[COL.DATE], halign: "center" },
      [COL.BRAND]: { cellWidth: layout.widths[COL.BRAND] },
      [COL.MODEL]: { cellWidth: layout.widths[COL.MODEL] },
      [COL.QTY]: { cellWidth: layout.widths[COL.QTY], halign: "right" },
      [COL.LIFE]: { cellWidth: layout.widths[COL.LIFE] },
      [COL.UNIT]: { cellWidth: layout.widths[COL.UNIT] },
      [COL.USE]: { cellWidth: layout.widths[COL.USE] },
      [COL.CHECK]: { cellWidth: layout.widths[COL.CHECK], cellPadding: checkPadding },
      [COL.TAG]: { cellWidth: layout.widths[COL.TAG], cellPadding: checkPadding },
      [COL.REMARK]: { cellWidth: "auto" },
    },
    rowPageBreak: "avoid",
    didParseCell(data) {
      if (data.section === "head") {
        data.cell.styles.halign = "center";
        return;
      }
      if (data.section === "body" && data.column.index === COL.NAME && data.cell.raw?.name !== undefined) {
        const { name, alias } = data.cell.raw;
        const width = layout.nameWidth - CELL_PAD * 2 - 0.4;
        doc.setFontSize(TABLE_FONT_SIZE);
        const nameLines = name ? doc.splitTextToSize(name, width) : [""];
        doc.setFontSize(ALIAS_FONT_SIZE);
        const aliasLines = alias ? doc.splitTextToSize(alias, width) : [""];
        doc.setFontSize(TABLE_FONT_SIZE);
        data.cell.nameLines = nameLines;
        data.cell.aliasLines = aliasLines;
        // Reserve the right height; the lines themselves are drawn in didDrawCell.
        data.cell.text = [...nameLines, ...aliasLines];
        if (aliasLines.length) {
          const lineHeight = doc.getLineHeight() / doc.internal.scaleFactor;
          const contentHeight = (nameLines.length + aliasLines.length) * lineHeight + ALIAS_DIVIDER_GAP + CELL_PAD * 2;
          data.cell.styles.minCellHeight = Math.max(data.cell.styles.minCellHeight || 0, contentHeight);
        }
      }
    },
    willDrawCell(data) {
      if (data.section === "body" && data.column.index === COL.NAME && data.cell.nameLines)
        data.cell.text = [];
    },
    didDrawCell(data) {
      if (data.section !== "body") return;
      const index = data.column.index;
      if (index === COL.NO && data.cell.raw?.hint) {
        doc.setFontSize(TABLE_FONT_SIZE);
        doc.setTextColor(20);
        doc.text(data.cell.raw.hint, data.cell.x + data.cell.width - CELL_PAD, data.cell.y + data.cell.height / 2, {
          align: "right",
          baseline: "middle",
        });
        doc.setFontSize(TABLE_FONT_SIZE);
        doc.setTextColor(20);
        return;
      }
      if (index === COL.NAME && data.cell.nameLines) {
        const { nameLines, aliasLines } = data.cell;
        doc.setFontSize(TABLE_FONT_SIZE);
        const step = lineHeight();
        const aliasGap = aliasLines.length ? ALIAS_DIVIDER_GAP : 0;
        const contentHeight = (nameLines.length + aliasLines.length) * step + aliasGap;
        const top = data.cell.y + (data.cell.height - contentHeight) / 2;
        const x = data.cell.x + CELL_PAD;
        doc.setFontSize(TABLE_FONT_SIZE);
        doc.setTextColor(20);
        nameLines.forEach((line, i) => {
          doc.text(line, x, top + (i + 0.5) * step, { baseline: "middle" });
        });
        doc.setFontSize(ALIAS_FONT_SIZE);
        doc.setTextColor(ALIAS_COLOR);
        if (aliasLines.length) {
          const dividerY = top + nameLines.length * step + aliasGap / 2;
          doc.setDrawColor(ALIAS_DIVIDER_COLOR);
          doc.setLineWidth(0.12);
          doc.line(x + ALIAS_DIVIDER_INSET, dividerY, data.cell.x + data.cell.width - CELL_PAD - ALIAS_DIVIDER_INSET, dividerY);
        }
        aliasLines.forEach((line, i) => {
          doc.text(line, x, top + nameLines.length * step + aliasGap + (i + 0.5) * step, { baseline: "middle" });
        });
        doc.setFontSize(TABLE_FONT_SIZE);
        doc.setTextColor(20);
        return;
      }
      if ((index === COL.UNIT || index === COL.USE) && data.cell.raw?.lines) {
        const step = lineHeight();
        const top = data.cell.y + (data.cell.height - 2 * step) / 2;
        const offset = layout.offsets[index];
        data.cell.raw.lines.forEach(({ code, name }, i) => {
          const y = top + (i + 0.5) * step;
          doc.text(code, data.cell.x + CELL_PAD, y, { baseline: "middle" });
          doc.text(name, data.cell.x + CELL_PAD + offset, y, { baseline: "middle" });
        });
        return;
      }
      if (index === COL.LIFE && data.cell.raw?.life !== undefined) {
        const { life, used } = data.cell.raw;
        const step = lineHeight();
        const top = data.cell.y + (data.cell.height - 2 * step) / 2;
        const anchor = data.cell.x + 4.6;
        const draw = (value, line) => {
          const y = top + (line + 0.5) * step;
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
      if (!CHECK_COLUMNS.has(index)) return;
      const lines = index === COL.CHECK ? 2 : 1;
      const step = lineHeight();
      const textTop = data.cell.y + (data.cell.height - lines * step) / 2;
      doc.setLineWidth(0.2);
      for (let i = 0; i < lines; i += 1) {
        const y = textTop + i * step + (step - CHECK_SIZE) / 2;
        doc.rect(data.cell.x + CELL_PAD + 0.4, y, CHECK_SIZE, CHECK_SIZE);
      }
    },
    ...extra,
  });

  /** Lays the rows out once off-page to learn every row's real height. */
  function measureHeights(rows) {
    const before = doc.getNumberOfPages();
    doc.addPage();
    autoTable(doc, tableOptions(rows));
    const table = doc.lastAutoTable;
    const heights = {
      head: table.head[0].height,
      rows: table.body.map((row) => row.height),
    };
    while (doc.getNumberOfPages() > before) doc.deletePage(doc.getNumberOfPages());
    doc.setPage(before);
    return heights;
  }

  /**
   * Decides which rows go on which page of a group, with a location row in
   * front of each place (and again when a place continues on a new page).
   */
  function planGroup(group) {
    const dataRows = group.assets.map((asset, index) => toRow(asset, index + 1));
    const heights = measureHeights([locationRow({ text: "" }), ...dataRows]);
    const locationHeight = heights.rows[0];
    const capacity = page.height - page.bottom - page.top - heights.head - 0.6;
    const counts = new Map();
    group.assets.forEach((asset) => {
      const key = locationKey(asset);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const pages = [];
    const firstPageOfPlace = new Map();
    let current = null;
    let used = 0;
    let previousKey = null;
    group.assets.forEach((asset, index) => {
      const key = locationKey(asset);
      const startsPlace = key !== previousKey;
      const rowHeight = heights.rows[index + 1];
      const extra = startsPlace || !current ? locationHeight : 0;
      if (current && used + extra + rowHeight > capacity) {
        pages.push(current);
        current = null;
      }
      if (!current) {
        current = { items: [], count: 0, used: 0 };
        used = 0;
      }
      if (startsPlace || current.items.length === 0) {
        current.items.push({
          type: "place",
          asset,
          key,
          count: counts.get(key),
          continued: !startsPlace,
        });
        used += locationHeight;
        if (!firstPageOfPlace.has(key)) firstPageOfPlace.set(key, pages.length);
      }
      current.items.push({ type: "row", index });
      current.count += 1;
      used += rowHeight;
      current.used = used;
      previousKey = key;
    });
    if (current) pages.push(current);
    const last = pages[pages.length - 1];
    const finalY = page.top + heights.head + (last ? last.used : 0);
    const signatureOnNewPage = finalY + 1.6 + SIGNATURE_HEIGHT > page.height - page.bottom;
    return { group, dataRows, pages, firstPageOfPlace, signatureOnNewPage };
  }

  // ---- plan every group first so pages can point at each other -------------
  const plans = groups.map(planGroup);
  let nextPage = 2; // page 1 is the overview
  plans.forEach((plan) => {
    plan.startPage = nextPage;
    nextPage += plan.pages.length + (plan.signatureOnNewPage ? 1 : 0);
  });
  const contentEnd = nextPage; // first page after the group pages

  const places = new Map(); // location key -> { label, code, perClass: [...] }
  plans.forEach((plan) => {
    plan.firstPageOfPlace.forEach((pageIndex, key) => {
      const asset = plan.group.assets.find((item) => locationKey(item) === key);
      const place = places.get(key) || {
        key,
        label: locationLabel(asset),
        code: cleanCode(asset.locationCode),
        name: asset.locationName || "",
        perClass: [],
      };
      place.perClass.push({
        klass: plan.group.klass,
        count: plan.group.assets.filter((item) => locationKey(item) === key).length,
        page: plan.startPage + pageIndex,
      });
      places.set(key, place);
    });
  });

  const placeText = (plan, item) => {
    const label = `存置地點：${locationLabel(item.asset)}`;
    if (item.continued) return { text: `${label}，接續上頁` };
    const others = (places.get(item.key)?.perClass || []).filter(
      (entry) => entry.klass !== plan.group.klass,
    );
    const text = `${label}，共 ${item.count} 筆`;
    if (!others.length) return { text };
    return {
      text,
      hint: `另有${others
        .map((entry) => `「${entry.klass}」${entry.count} 筆，見第 ${entry.page} 頁`)
        .join("；")}`,
    };
  };

  // ---- group pages (page 1 stays free for the overview) ---------------------
  plans.forEach((plan, groupIndex) => {
    const { group } = plan;
    let cumulative = 0;
    plan.pages.forEach((pageSpec, pageIndex) => {
      doc.addPage();
      const rows = pageSpec.items.map((item) =>
        item.type === "place"
          ? locationRow(placeText(plan, item))
          : plan.dataRows[item.index],
      );
      cumulative += pageSpec.count;
      const pageCumulative = cumulative;
      autoTable(
        doc,
        tableOptions(rows, {
          didDrawPage() {
            const pageNumber = doc.getCurrentPageInfo().pageNumber;
            metaByPage.set(pageNumber, {
              pageNumber,
              kind: "content",
              group,
              first: pageIndex === 0,
              pageCount: pageSpec.count,
              cumulative: pageCumulative,
            });
          },
        }),
      );
    });
    let signTop = doc.lastAutoTable.finalY + 1.6;
    if (plan.signatureOnNewPage) {
      doc.addPage();
      const pageNumber = doc.getNumberOfPages();
      metaByPage.set(pageNumber, {
        pageNumber,
        kind: "content",
        group,
        first: false,
        pageCount: 0,
        cumulative: group.assets.length,
      });
      signTop = page.top;
    }
    drawSignatures(doc, signTop);
  });

  // ---- location index -----------------------------------------------------
  const sortedPlaces = [...places.values()].sort(
    (a, b) => collator.compare(a.code, b.code) || collator.compare(a.name, b.name),
  );
  const classOrder = [...new Set(plans.map((plan) => plan.group.klass))];
  const indexRows = sortedPlaces.map((place) => {
    const byClass = new Map();
    place.perClass.forEach((entry) => {
      const current = byClass.get(entry.klass);
      byClass.set(entry.klass, {
        count: (current?.count || 0) + entry.count,
        page: Math.min(current?.page ?? Infinity, entry.page),
      });
    });
    const total = [...byClass.values()].reduce((sum, entry) => sum + entry.count, 0);
    return [
      place.label,
      ...classOrder.map((klass) => {
        const entry = byClass.get(klass);
        return entry
          ? { content: "", count: `${entry.count} 筆`, page: `第 ${entry.page} 頁` }
          : "—";
      }),
      String(total),
    ];
  });
  let indexStart = 0;
  if (indexRows.length) {
    doc.addPage();
    indexStart = doc.getNumberOfPages();
    const usable = page.width - page.side * 2;
    const locationWidth = 85;
    const totalWidth = 25;
    const classWidth = (usable - locationWidth - totalWidth) / classOrder.length;
    const columnStyles = {
      0: { cellWidth: locationWidth },
      [classOrder.length + 1]: { cellWidth: totalWidth, halign: "right" },
    };
    classOrder.forEach((_, index) => {
      columnStyles[index + 1] = { cellWidth: classWidth, halign: "center" };
    });
    autoTable(doc, {
      head: [["存置地點", ...classOrder, "合計筆數"]],
      body: indexRows,
      startY: page.top,
      margin: { top: page.top, bottom: page.bottom, left: page.side, right: page.side },
      theme: "grid",
      styles: { ...GRID_STYLES, fontSize: TABLE_FONT_SIZE, minCellHeight: 6 },
      headStyles: { fillColor: [235, 235, 235], textColor: 20, halign: "center", fontStyle: "normal" },
      rowPageBreak: "avoid",
      columnStyles,
      // "N 筆 / 第 P 頁": the slash sits on one vertical line in every cell.
      didDrawCell(data) {
        if (data.section !== "body" || !data.cell.raw?.count) return;
        const slash = data.cell.x + data.cell.width * 0.46;
        const y = data.cell.y + data.cell.height / 2;
        doc.setFontSize(TABLE_FONT_SIZE);
        doc.setTextColor(20);
        doc.text(data.cell.raw.count, slash - 1.6, y, { align: "right", baseline: "middle" });
        doc.text("/", slash, y, { align: "center", baseline: "middle" });
        doc.text(data.cell.raw.page, slash + 1.6, y, { baseline: "middle" });
      },
      didDrawPage() {
        const pageNumber = doc.getCurrentPageInfo().pageNumber;
        metaByPage.set(pageNumber, { pageNumber, kind: "index" });
      },
    });
  }

  // ---- overview (page 1) --------------------------------------------------
  doc.setPage(1);
  doc.setFont(FONT, "normal");
  const first = assets[0] || {};
  const usableWidth = page.width - page.side * 2;
  const lastContentPage = contentEnd - 1;
  const number = (value) => Math.round(value).toLocaleString("en-US");
  const pageRange = (from, to) => (to > from ? `第 ${from}-${to} 頁` : `第 ${from} 頁`);
  const categoryLabel = (plan) =>
    `${plan.group.categoryCode} ${plan.group.categoryName}`.trim();
  const overall = { count: assets.length };

  // identity line
  doc.setFontSize(9);
  doc.setTextColor(20);
  doc.text(
    `保管人：${[cleanCode(first.custodianCode), first.custodianName].filter(Boolean).join(" ")}`,
    page.side,
    25,
  );
  doc.text(
    `保管單位：${[cleanCode(first.unitCode), first.unitName].filter(Boolean).join(" ")}`,
    page.side + 90,
    25,
  );

  // key figures
  const tiles = [
    ["財產大類", `${classOrder.length} 類`],
    ["總筆數", `${number(overall.count)} 筆`],
    ["存置地點", `${places.size} 處`],
  ];
  const tileGap = 4;
  const tileWidth = (usableWidth - tileGap * (tiles.length - 1)) / tiles.length;
  doc.setDrawColor(60);
  doc.setLineWidth(0.2);
  tiles.forEach(([label, value], index) => {
    const x = page.side + index * (tileWidth + tileGap);
    doc.roundedRect(x, 30, tileWidth, 17, 1.5, 1.5);
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text(label, x + 3, 36);
    doc.setFontSize(11);
    doc.setTextColor(20);
    doc.text(value, x + 3, 44);
  });

  // per class summary (with hand-written result columns)
  const summaryRows = [];
  plans.forEach((plan, index) => {
    const label = categoryLabel(plan);
    const row = [];
    if (index === 0 || categoryLabel(plans[index - 1]) !== label) {
      let span = 1;
      while (plans[index + span] && categoryLabel(plans[index + span]) === label) span += 1;
      row.push({ content: label, rowSpan: span, styles: { valign: "middle" } });
    }
    const pageTotal = plan.pages.length + (plan.signatureOnNewPage ? 1 : 0);
    row.push(
      plan.group.klass,
      number(plan.group.assets.length),
      pageRange(plan.startPage, plan.startPage + pageTotal - 1),
    );
    summaryRows.push(row);
  });
  summaryRows.push([
    { content: "合計", colSpan: 2, styles: { halign: "center" } },
    number(overall.count),
    pageRange(2, lastContentPage),
  ]);
  autoTable(doc, {
    head: [["財產區分別", "財產大類", "筆數", "頁次"]],
    body: summaryRows,
    startY: 53,
    margin: { top: 53, bottom: page.bottom, left: page.side, right: page.side },
    theme: "grid",
    styles: { ...GRID_STYLES, fontSize: TABLE_FONT_SIZE, cellPadding: 1.6, minCellHeight: 8 },
    headStyles: { fillColor: [235, 235, 235], textColor: 20, halign: "center", fontStyle: "normal" },
    rowPageBreak: "avoid",
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 80 },
      2: { cellWidth: 40, halign: "right" },
      3: { cellWidth: "auto", halign: "center" },
    },
    didDrawPage() {
      metaByPage.set(1, { pageNumber: 1, kind: "cover" });
    },
  });
  if (indexStart) {
    doc.setFontSize(9);
    doc.setTextColor(60);
    doc.text(
      `存置地點索引：${pageRange(indexStart, doc.getNumberOfPages())}`,
      page.side,
      doc.lastAutoTable.finalY + 6,
    );
    doc.setTextColor(20);
  }

  const total = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    doc.setPage(pageNumber);
    doc.setFont(FONT, "normal");
    drawPageFrame(doc, metaByPage.get(pageNumber), total, printDate);
  }
  return doc.output("blob");
}

export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Builds the single 財物盤點清冊 of one custodian: [{ fileName, blob }] (empty when nothing is in use). */
export async function buildCustodianSheets(assets, custodianCode) {
  const own = assets.filter(
    (asset) => asset.custodianCode === custodianCode && asset.status === IN_USE,
  );
  if (!own.length) return [];
  return [
    {
      fileName: inventorySheetFileName(own[0].unitName, custodianCode, own[0].custodianName),
      blob: await buildSheet(own),
    },
  ];
}

/** Downloads one custodian's 財物盤點清冊. Returns the file names. */
export async function exportCustodianInventorySheets(assets, custodianCode) {
  const sheets = await buildCustodianSheets(assets, custodianCode);
  for (const { fileName, blob } of sheets) {
    saveBlob(blob, fileName);
    await delay(400);
  }
  return sheets.map((sheet) => sheet.fileName);
}

export function rocStamp(date = new Date()) {
  const year = String(date.getFullYear() - 1911).padStart(3, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/**
 * Packs the sheets of many custodians into one zip and downloads it.
 * Custodians without in-use assets are skipped and reported back.
 */
export async function exportInventorySheetsZip(assets, custodianCodes, onProgress) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const skipped = [];
  let fileCount = 0;
  for (const [index, code] of custodianCodes.entries()) {
    onProgress?.(index, custodianCodes.length);
    const sheets = await buildCustodianSheets(assets, code);
    if (!sheets.length) skipped.push(code);
    for (const { fileName, blob } of sheets) {
      zip.file(fileName, blob);
      fileCount += 1;
    }
    // Let the browser repaint between custodians so the page stays responsive.
    await delay(0);
  }
  if (!fileCount) return { fileName: "", fileCount, skipped };
  onProgress?.(custodianCodes.length, custodianCodes.length);
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  const fileName = `盤點清冊_${rocStamp()}.zip`;
  saveBlob(blob, fileName);
  return { fileName, fileCount, skipped };
}
