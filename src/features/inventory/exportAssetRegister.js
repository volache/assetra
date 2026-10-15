import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { assetMajorClass, usedDuration } from "../../lib/formatters";
import {
  AGENCY,
  ALIAS_COLOR,
  ALIAS_DIVIDER_COLOR,
  ALIAS_DIVIDER_GAP,
  ALIAS_DIVIDER_INSET,
  ALIAS_FONT_SIZE,
  CELL_PAD,
  CODE_GAP,
  FONT,
  GRID_STYLES,
  LOCATION_ROW_HEIGHT,
  TABLE_FONT_SIZE,
  buildGroups,
  classRank,
  cleanCode,
  collator,
  delay,
  drawPageFrame,
  loadFontBase64,
  locationKey,
  locationLabel,
  page,
  pair,
  rocPrintDate,
  rocStamp,
  saveBlob,
} from "./exportInventorySheet";

// 財產清冊: the register of the assets currently on screen.  It reads like the
// 財物盤點清冊 (same fonts, sizes, frame, location rows and overview), minus
// the hand-written columns, plus the money columns and subtotals.

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
  VALUE: 10,
  REMARK: 11,
};
const COLUMN_COUNT = 12;
// 原值 / －累折 / ＝淨值 share one stacked cell, written like a subtraction.
const MONEY = [
  ["原值", "originalValue"],
  ["累折", "depreciation"],
  ["淨值", "netValue"],
];
const FIXED_WIDTHS = {
  [COL.NO]: 8,
  [COL.ASSET]: 24,
  [COL.DATE]: 18,
  [COL.BRAND]: 17,
  [COL.MODEL]: 20,
  [COL.QTY]: 14,
  [COL.LIFE]: 20,
};
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
  "原值\n－累折\n＝淨值",
  "備註",
];
const REMARK_MIN_WIDTH = 16;
const REMARK_MAX_WIDTH = 46;
const REMARK_MAX_LINES = 4;
const VALUE_MIN_WIDTH = 26;
const VALUE_MAX_WIDTH = 44;
const VALUE_SIGN_WIDTH = 4;
const VALUE_RULE_COLOR = 60;
const VALUE_RULE_GAP = 1.2;
const SUBTOTAL_FILL = [240, 240, 240];
const TITLES = { cover: "財產清冊 總覽", index: "存置地點索引", content: "財產清冊" };

const isBlank = (value) => value === null || value === undefined || value === "";
const amount = (value) =>
  isBlank(value) || !Number.isFinite(Number(value))
    ? ""
    : Math.round(Number(value)).toLocaleString("en-US");
const total = (assets, key) =>
  assets.reduce((sum, asset) => sum + (Number(asset[key]) || 0), 0);
const count = (value) => Math.round(value).toLocaleString("en-US");

function measureLayout(doc, assets, grandTotals) {
  const width = (text, size) => {
    doc.setFontSize(size);
    return text ? doc.getTextWidth(String(text)) : 0;
  };
  let nameMax = 0;
  const merged = {
    [COL.UNIT]: { code: 0, name: 0 },
    [COL.USE]: { code: 0, name: 0 },
  };
  let moneyMax = 0;
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
    for (const [, key] of MONEY)
      moneyMax = Math.max(moneyMax, width(amount(asset[key]), TABLE_FONT_SIZE));
  }
  // The grand total is the widest figure any subtotal can reach.
  for (const [, key] of MONEY)
    moneyMax = Math.max(moneyMax, width(amount(grandTotals[key]), TABLE_FONT_SIZE));
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
  const widths = { ...FIXED_WIDTHS };
  widths[COL.VALUE] = clamp(moneyMax + VALUE_SIGN_WIDTH + pad, VALUE_MIN_WIDTH, VALUE_MAX_WIDTH);
  const fixed = Object.values(widths).reduce((sum, value) => sum + value, 0);
  const room = page.width - page.side * 2 - fixed;
  const dynamicTotal = Object.values(dynamic).reduce((sum, value) => sum + value, 0);
  let remark = REMARK_MIN_WIDTH;
  let scale = 1;
  if (dynamicTotal > room - REMARK_MIN_WIDTH) scale = (room - REMARK_MIN_WIDTH) / dynamicTotal;
  else {
    const spare = room - REMARK_MIN_WIDTH - dynamicTotal;
    remark = Math.min(REMARK_MAX_WIDTH, REMARK_MIN_WIDTH + spare * 0.4);
    scale = (room - remark) / dynamicTotal;
  }
  for (const [column, value] of Object.entries(dynamic)) widths[column] = value * scale;
  widths[COL.REMARK] = room - dynamicTotal * scale;
  return { widths, offsets, nameWidth: widths[COL.NAME] };
}

function locationRow({ text, hint = "" }) {
  return [
    {
      content: text,
      hint,
      colSpan: COLUMN_COUNT,
      styles: { halign: "left", fillColor: SUBTOTAL_FILL, minCellHeight: LOCATION_ROW_HEIGHT },
    },
  ];
}

/** Builds the 財產清冊 PDF and returns its Blob. */
export async function buildRegisterPdf(assets, { printedBy = "", filterSummary = [] } = {}) {
  const base64 = await loadFontBase64();
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  doc.addFileToVFS(`${FONT}.ttf`, base64);
  doc.addFont(`${FONT}.ttf`, FONT, "normal");
  doc.setFont(FONT, "normal");

  const groups = buildGroups(assets);
  const grandTotals = Object.fromEntries(MONEY.map(([, key]) => [key, total(assets, key)]));
  const layout = measureLayout(doc, assets, grandTotals);
  doc.setFontSize(TABLE_FONT_SIZE);
  const metaByPage = new Map();
  const printDate = rocPrintDate();
  const lineHeight = () => doc.getLineHeight() / doc.internal.scaleFactor;

  const remarkText = (notes) => {
    const text = String(notes || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    doc.setFontSize(TABLE_FONT_SIZE);
    const lines = doc.splitTextToSize(text, layout.widths[COL.REMARK] - CELL_PAD * 2 - 0.4);
    if (lines.length <= REMARK_MAX_LINES) return lines.join("\n");
    // The workbook carries the full text; the printed page stays compact.
    return `${lines.slice(0, REMARK_MAX_LINES - 1).join("\n")}\n${lines[REMARK_MAX_LINES - 1].replace(/.$/, "")}…`;
  };

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
      { content: "", value: MONEY.map(([, key]) => amount(asset[key])) },
      remarkText(asset.notes),
    ];
  }

  function subtotalRow(group) {
    return [
      {
        content: `${group.klass} 小計：${group.assets.length} 筆`,
        colSpan: COL.VALUE,
        styles: { halign: "right", fillColor: SUBTOTAL_FILL },
      },
      {
        content: "",
        value: MONEY.map(([, key]) => amount(total(group.assets, key))),
        styles: { fillColor: SUBTOTAL_FILL },
      },
      { content: "", styles: { fillColor: SUBTOTAL_FILL } },
    ];
  }

  const tableOptions = (body, extra = {}) => ({
    head: [HEAD],
    body,
    startY: page.top,
    margin: { top: page.top, bottom: page.bottom, left: page.side, right: page.side },
    theme: "grid",
    styles: { ...GRID_STYLES, minCellHeight: 11 },
    headStyles: { fillColor: [235, 235, 235], textColor: 20, halign: "center", fontStyle: "normal" },
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
      [COL.VALUE]: { cellWidth: layout.widths[COL.VALUE] },
      [COL.REMARK]: { cellWidth: layout.widths[COL.REMARK] },
    },
    rowPageBreak: "avoid",
    didParseCell(data) {
      if (data.section === "head") {
        data.cell.styles.halign = "center";
        return;
      }
      if (data.section === "body" && data.column.index === COL.VALUE && data.cell.raw?.value) {
        doc.setFontSize(TABLE_FONT_SIZE);
        const step = doc.getLineHeight() / doc.internal.scaleFactor;
        const height = 3 * step + VALUE_RULE_GAP + CELL_PAD * 1.4;
        data.cell.styles.minCellHeight = Math.max(data.cell.styles.minCellHeight || 0, height);
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
        data.cell.text = [...nameLines, ...aliasLines];
        if (aliasLines.length) {
          const step = doc.getLineHeight() / doc.internal.scaleFactor;
          const contentHeight = (nameLines.length + aliasLines.length) * step + ALIAS_DIVIDER_GAP + CELL_PAD * 2;
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
      if (index === COL.VALUE && data.cell.raw?.value) {
        // 原值, －累折, rule, ＝淨值: figures right-aligned so the digits line up.
        const [original, depreciation, net] = data.cell.raw.value;
        const step = lineHeight();
        const gap = VALUE_RULE_GAP;
        const top = data.cell.y + (data.cell.height - (3 * step + gap)) / 2;
        const left = data.cell.x + CELL_PAD;
        const right = data.cell.x + data.cell.width - CELL_PAD;
        doc.setFontSize(TABLE_FONT_SIZE);
        doc.setTextColor(20);
        const line = (text, sign, y) => {
          if (sign && text) doc.text(sign, left, y, { baseline: "middle" });
          if (text) doc.text(text, right, y, { align: "right", baseline: "middle" });
        };
        line(original, "", top + step * 0.5);
        line(depreciation, "－", top + step * 1.5);
        line(net, "＝", top + step * 2 + gap + step * 0.5);
        doc.setDrawColor(VALUE_RULE_COLOR);
        doc.setLineWidth(0.15);
        const ruleY = top + step * 2 + gap / 2;
        doc.line(left, ruleY, right, ruleY);
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
    const heights = { head: table.head[0].height, rows: table.body.map((row) => row.height) };
    while (doc.getNumberOfPages() > before) doc.deletePage(doc.getNumberOfPages());
    doc.setPage(before);
    return heights;
  }

  /** Which rows go on which page of a group; a location row leads each place. */
  function planGroup(group) {
    const dataRows = group.assets.map((asset, index) => toRow(asset, index + 1));
    const totalRow = subtotalRow(group);
    const heights = measureHeights([locationRow({ text: "" }), ...dataRows, totalRow]);
    const locationHeight = heights.rows[0];
    const totalHeight = heights.rows[heights.rows.length - 1];
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
        current.items.push({ type: "place", asset, key, count: counts.get(key), continued: !startsPlace });
        used += locationHeight;
        if (!firstPageOfPlace.has(key)) firstPageOfPlace.set(key, pages.length);
      }
      current.items.push({ type: "row", index });
      current.count += 1;
      used += rowHeight;
      current.used = used;
      previousKey = key;
    });
    if (current && used + totalHeight > capacity) {
      pages.push(current);
      current = null;
    }
    if (!current) {
      current = { items: [], count: 0, used: 0 };
      used = 0;
    }
    current.items.push({ type: "total" });
    used += totalHeight;
    current.used = used;
    pages.push(current);
    return { group, dataRows, totalRow, pages, firstPageOfPlace };
  }

  // ---- plan every group first so pages can point at each other -------------
  const plans = groups.map(planGroup);
  let nextPage = 2; // page 1 is the overview
  plans.forEach((plan) => {
    plan.startPage = nextPage;
    nextPage += plan.pages.length;
  });
  const contentEnd = nextPage;

  const places = new Map();
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
    const others = (places.get(item.key)?.perClass || []).filter((entry) => entry.klass !== plan.group.klass);
    const text = `${label}，共 ${item.count} 筆`;
    if (!others.length) return { text };
    const full = `另有${others.map((entry) => `「${entry.klass}」${entry.count} 筆，見第 ${entry.page} 頁`).join("；")}`;
    // A place spread over many classes would overrun the row: point at the index instead.
    doc.setFontSize(TABLE_FONT_SIZE);
    const room = page.width - page.side * 2 - CELL_PAD * 4 - doc.getTextWidth(text) - 6;
    return {
      text,
      hint: doc.getTextWidth(full) <= room ? full : `另有 ${others.length} 類，見存置地點索引（第 ${contentEnd} 頁）`,
    };
  };

  // ---- group pages ----------------------------------------------------------
  plans.forEach((plan) => {
    const { group } = plan;
    let cumulative = 0;
    plan.pages.forEach((pageSpec, pageIndex) => {
      doc.addPage();
      const rows = pageSpec.items.map((item) => {
        if (item.type === "place") return locationRow(placeText(plan, item));
        if (item.type === "total") return plan.totalRow;
        return plan.dataRows[item.index];
      });
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
    const placeTotal = [...byClass.values()].reduce((sum, entry) => sum + entry.count, 0);
    return [
      place.label,
      ...classOrder.map((klass) => {
        const entry = byClass.get(klass);
        return entry ? { content: "", count: `${entry.count} 筆`, page: `第 ${entry.page} 頁` } : "—";
      }),
      String(placeTotal),
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
  const usableWidth = page.width - page.side * 2;
  const lastContentPage = contentEnd - 1;
  const pageRange = (from, to) => (to > from ? `第 ${from}-${to} 頁` : `第 ${from} 頁`);
  const categoryLabel = (plan) => `${plan.group.categoryCode} ${plan.group.categoryName}`.trim();

  doc.setFontSize(9);
  doc.setTextColor(20);
  const summaryText = `篩選條件：${filterSummary.length ? filterSummary.join("；") : "無（全部財物）"}`;
  const summaryLines = doc.splitTextToSize(summaryText, usableWidth).slice(0, 3);
  summaryLines.forEach((line, index) => doc.text(line, page.side, 25 + index * 4.5));
  const tilesTop = 25 + (summaryLines.length - 1) * 4.5 + 5;

  const tiles = [
    ["財產大類", `${classOrder.length} 類`],
    ["總筆數", `${count(assets.length)} 筆`],
    ["存置地點", `${places.size} 處`],
    ["原值合計", count(grandTotals.originalValue)],
    ["累折合計", count(grandTotals.depreciation)],
    ["淨值合計", count(grandTotals.netValue)],
  ];
  const tileGap = 4;
  const tileWidth = (usableWidth - tileGap * (tiles.length - 1)) / tiles.length;
  doc.setDrawColor(60);
  doc.setLineWidth(0.2);
  tiles.forEach(([label, value], index) => {
    const x = page.side + index * (tileWidth + tileGap);
    doc.roundedRect(x, tilesTop, tileWidth, 17, 1.5, 1.5);
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text(label, x + 3, tilesTop + 6);
    doc.setFontSize(11);
    doc.setTextColor(20);
    doc.text(value, x + 3, tilesTop + 14);
  });

  const summaryRows = [];
  plans.forEach((plan, index) => {
    const label = categoryLabel(plan);
    const row = [];
    if (index === 0 || categoryLabel(plans[index - 1]) !== label) {
      let span = 1;
      while (plans[index + span] && categoryLabel(plans[index + span]) === label) span += 1;
      row.push({ content: label, rowSpan: span, styles: { valign: "middle" } });
    }
    row.push(
      plan.group.klass,
      count(plan.group.assets.length),
      ...MONEY.map(([, key]) => amount(total(plan.group.assets, key))),
      pageRange(plan.startPage, plan.startPage + plan.pages.length - 1),
    );
    summaryRows.push(row);
  });
  summaryRows.push([
    { content: "合計", colSpan: 2, styles: { halign: "center" } },
    count(assets.length),
    ...MONEY.map(([, key]) => amount(grandTotals[key])),
    pageRange(2, lastContentPage),
  ]);
  const summaryTop = tilesTop + 23;
  autoTable(doc, {
    head: [["財產區分別", "財產大類", "筆數", "原值", "累折", "淨值", "頁次"]],
    body: summaryRows,
    startY: summaryTop,
    margin: { top: summaryTop, bottom: page.bottom, left: page.side, right: page.side },
    theme: "grid",
    styles: { ...GRID_STYLES, fontSize: TABLE_FONT_SIZE, cellPadding: 1.6, minCellHeight: 8 },
    headStyles: { fillColor: [235, 235, 235], textColor: 20, halign: "center", fontStyle: "normal" },
    rowPageBreak: "avoid",
    columnStyles: {
      0: { cellWidth: 50 },
      1: { cellWidth: 50 },
      2: { cellWidth: 22, halign: "right" },
      3: { cellWidth: 42, halign: "right" },
      4: { cellWidth: 42, halign: "right" },
      5: { cellWidth: 42, halign: "right" },
      6: { cellWidth: "auto", halign: "center" },
    },
    didDrawPage() {
      metaByPage.set(1, { pageNumber: 1, kind: "cover" });
    },
  });
  if (indexStart) {
    doc.setFontSize(9);
    doc.setTextColor(60);
    doc.text(`存置地點索引：${pageRange(indexStart, doc.getNumberOfPages())}`, page.side, doc.lastAutoTable.finalY + 6);
    doc.setTextColor(20);
  }

  const pageTotal = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageTotal; pageNumber += 1) {
    doc.setPage(pageNumber);
    doc.setFont(FONT, "normal");
    drawPageFrame(doc, metaByPage.get(pageNumber), pageTotal, printDate, { titles: TITLES, printedBy });
  }
  return doc.output("blob");
}

// ---- Excel: one asset per row, every field -----------------------------------

const SHEET_COLUMNS = [
  ["財產區分別代碼", (a) => a.categoryTypeCode, 12],
  ["財產區分別", (a) => a.categoryType, 14],
  ["財產大類", (a) => a.klass, 16],
  ["財產編號", (a) => a.assetNo, 16],
  ["流水號", (a) => a.serialNo, 10],
  ["財產名稱", (a) => a.name, 24],
  ["財產別名", (a) => a.categoryName, 18],
  ["購置日期", (a) => a.acquiredAt, 12],
  ["廠牌", (a) => a.brand, 14],
  ["型式", (a) => a.model, 18],
  ["數量", (a) => numberOrBlank(a.quantity), 10, "#,##0.00"],
  ["計量單位", (a) => a.measureUnit, 8],
  ["使用年限", (a) => numberOrBlank(a.usefulLife), 8, "0"],
  ["已使用年限", (a) => usedDuration(a.acquiredAt), 12],
  ["保管單位代碼", (a) => cleanCode(a.unitCode), 12],
  ["保管單位", (a) => a.unitName, 16],
  ["保管人代碼", (a) => cleanCode(a.custodianCode), 12],
  ["保管人", (a) => a.custodianName, 12],
  ["使用單位代碼", (a) => cleanCode(a.useUnitCode), 12],
  ["使用單位", (a) => a.useUnitName, 16],
  ["使用人代碼", (a) => cleanCode(a.userCode), 12],
  ["使用人", (a) => a.userName, 12],
  ["存置地點代碼", (a) => cleanCode(a.locationCode), 12],
  ["存置地點", (a) => a.locationName, 20],
  ["原值", (a) => numberOrBlank(a.originalValue), 16, "#,##0"],
  ["累折", (a) => numberOrBlank(a.depreciation), 16, "#,##0"],
  ["淨值", (a) => numberOrBlank(a.netValue), 16, "#,##0"],
  ["使用現況", (a) => a.status, 10],
  ["資料類型", (a) => (a.sourceType === "item" ? "物品" : "財產"), 8],
  ["舊財產編號", (a) => a.oldNo, 14],
  ["備註", (a) => a.notes, 30],
];

function numberOrBlank(value) {
  return isBlank(value) || !Number.isFinite(Number(value)) ? "" : Number(value);
}

/** Rows ordered for processing: 區分別, 大類, 財產編號, 流水號. */
function orderedForSheet(assets) {
  return assets
    .map((asset) => ({ ...asset, klass: assetMajorClass(asset.assetNo) }))
    .sort(
      (a, b) =>
        collator.compare(String(a.categoryTypeCode || ""), String(b.categoryTypeCode || "")) ||
        classRank(a.klass) - classRank(b.klass) ||
        collator.compare(String(a.assetNo || ""), String(b.assetNo || "")) ||
        collator.compare(String(a.serialNo || ""), String(b.serialNo || "")),
    );
}

/** Builds the 財產清冊 workbook and returns its Blob. */
export async function buildRegisterWorkbook(assets, { printedBy = "", filterSummary = [] } = {}) {
  const XLSX = await import("xlsx");
  const rows = orderedForSheet(assets);
  const header = SHEET_COLUMNS.map(([label]) => label);
  const body = rows.map((asset) => SHEET_COLUMNS.map(([, read]) => read(asset) ?? ""));
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = SHEET_COLUMNS.map(([, , width]) => ({ wch: width }));
  sheet["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: header.length - 1 } }),
  };
  SHEET_COLUMNS.forEach(([, , , format], column) => {
    if (!format) return;
    for (let row = 1; row <= body.length; row += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell && cell.t === "n") cell.z = format;
    }
  });

  const info = XLSX.utils.aoa_to_sheet([
    ["報表名稱", "財產清冊"],
    ["機關", AGENCY],
    ["印表人", printedBy],
    ["印表日期", rocPrintDate()],
    ["篩選條件", filterSummary.length ? filterSummary.join("；") : "無（全部財物）"],
    ["總筆數", assets.length],
    ["原值合計", total(assets, "originalValue")],
    ["累折合計", total(assets, "depreciation")],
    ["淨值合計", total(assets, "netValue")],
  ]);
  info["!cols"] = [{ wch: 12 }, { wch: 70 }];
  ["B7", "B8", "B9"].forEach((ref) => {
    if (info[ref]) info[ref].z = "#,##0";
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "財產清冊");
  XLSX.utils.book_append_sheet(workbook, info, "清冊資訊");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Builds and downloads the register.  format: "pdf" | "xlsx". Returns the file name. */
export async function exportAssetRegister(format, assets, meta) {
  if (!assets.length) throw new Error("目前沒有可匯出的財物。");
  // Let the page paint its "producing" state before the heavy synchronous work.
  await delay(30);
  const blob = format === "xlsx" ? await buildRegisterWorkbook(assets, meta) : await buildRegisterPdf(assets, meta);
  const fileName = `財產清冊_${rocStamp()}_${assets.length}筆.${format === "xlsx" ? "xlsx" : "pdf"}`;
  saveBlob(blob, fileName);
  return fileName;
}
