import React, { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../../supabase";
import { rocDate } from "../../lib/formatters";
import { sourceLabels } from "../../lib/labels";
import { CapsuleSpinner } from "../../components/FeedbackCenter";

const columns = {
  assetNo: ["財產編號"],
  serialNo: ["流水號"],
  name: ["中文名稱"],
  oldNo: ["OLDNUMBER"],
  acquiredAt: ["購置日期"],
  unitCode: ["保管單位代碼"],
  unitName: ["保管單位中文"],
  useUnitCode: ["使用單位代碼"],
  useUnitName: ["使用單位中文"],
  locationCode: ["存置地點代碼"],
  locationName: ["存置地點中文"],
  custodianCode: ["保管人"],
  custodianName: ["保管人中文"],
  userCode: ["使用人"],
  userName: ["使用人中文"],
  quantity: ["數量"],
  measureUnit: ["單位"],
  originalValue: ["原值"],
  depreciation: ["累折"],
  netValue: ["淨值"],
  usefulLife: ["年限"],
  categoryName: ["財產別名"],
  categoryTypeCode: ["區分別代碼", "區分別"],
  categoryType: ["區分別中文"],
  model: ["型式", "型試"],
  brand: ["廠牌"],
  notes: ["備註"],
  status: ["是否報廢"],
};

function valueOf(row, keys) {
  for (const key of keys)
    if (row[key] !== undefined && row[key] !== null) return row[key];
  return "";
}
function normalizeRows(rows, sourceType) {
  return rows
    .filter((row) => valueOf(row, columns.assetNo))
    .map((row, i) => {
      const get = (field) => valueOf(row, columns[field]);
      return {
        id: `${sourceType}:${get("assetNo")}:${get("serialNo")}:${i}`,
        sourceType,
        assetNo: String(get("assetNo")),
        serialNo: String(get("serialNo")).padStart(7, "0"),
        name: String(get("name")),
        oldNo: String(get("oldNo") || ""),
        acquiredAt: rocDate(get("acquiredAt")),
        unitCode: String(get("unitCode") || ""),
        unitName: String(get("unitName") || ""),
        useUnitCode: String(get("useUnitCode") || ""),
        useUnitName: String(get("useUnitName") || ""),
        locationCode: String(get("locationCode") || ""),
        locationName: String(get("locationName") || ""),
        custodianCode: String(get("custodianCode") || ""),
        custodianName: String(get("custodianName") || ""),
        userCode: String(get("userCode") || ""),
        userName: String(get("userName") || ""),
        quantity: get("quantity"),
        measureUnit: String(get("measureUnit") || ""),
        originalValue: get("originalValue"),
        depreciation: get("depreciation"),
        netValue: get("netValue"),
        usefulLife: get("usefulLife"),
        categoryName: String(get("categoryName") || ""),
        categoryTypeCode: String(get("categoryTypeCode") || ""),
        categoryType: String(
          get("categoryType") || get("categoryTypeCode") || "",
        ),
        model: String(get("model") || ""),
        brand: String(get("brand") || ""),
        notes: String(get("notes") || ""),
        status: String(get("status") || ""),
      };
    });
}
function toRocDate(value) {
  return rocDate(value);
}

function readWorksheetRows(sheet) {
  const [headers = [], ...records] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });
  const seen = new Map();
  const fields = headers.map((header) => {
    const name = String(header || "").trim();
    const count = (seen.get(name) || 0) + 1;
    seen.set(name, count);
    if (name === "保管人" && count === 2) return "使用人";
    if (name === "保管人中文" && count === 2) return "使用人中文";
    return name;
  });
  return records
    .filter((record) => record.some((value) => String(value ?? "").trim()))
    .map((record) =>
      Object.fromEntries(
        fields.map((field, index) => [field, record[index] ?? ""]),
      ),
    );
}

function inspectImportRows(rows, sourceType) {
  const errors = [];
  const accepted = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    const get = (field) => String(valueOf(row, columns[field]) ?? "").trim();
    const categoryTypeCode = get("categoryTypeCode");
    const assetNo = get("assetNo");
    const serialNo = get("serialNo");
    const name = get("name");
    const messages = [];
    if (!categoryTypeCode) messages.push("缺少區分別代碼");
    if (!assetNo) messages.push("缺少財產編號");
    if (!serialNo) messages.push("缺少流水號");
    if (!name) messages.push("缺少中文名稱");
    const originalValue = Number(get("originalValue").replace(/,/g, ""));
    const netValue = Number(get("netValue").replace(/,/g, ""));
    if (get("originalValue") && !Number.isFinite(originalValue))
      messages.push("原值不是有效數字");
    if (get("netValue") && !Number.isFinite(netValue))
      messages.push("淨值不是有效數字");
    if (
      Number.isFinite(originalValue) &&
      Number.isFinite(netValue) &&
      netValue > originalValue
    )
      messages.push("淨值不得大於原值");
    if (messages.length) errors.push({ line, messages });
    else accepted.push({ line, record: normalizeRows([row], sourceType)[0] });
  });
  const latestByIdentity = new Map();
  const duplicates = [];
  accepted.forEach(({ line, record }) => {
    const key = `${record.categoryTypeCode}\u0000${record.assetNo}\u0000${record.serialNo}`;
    const previous = latestByIdentity.get(key);
    if (previous)
      duplicates.push({
        line,
        previousLine: previous.line,
        identity: `${record.categoryTypeCode}－${record.assetNo}－${record.serialNo}`,
      });
    latestByIdentity.set(key, { line, record });
  });
  return {
    errors,
    duplicates,
    records: [...latestByIdentity.values()].map(({ record }) => record),
    total: rows.length,
  };
}

export function ImportInventory({ store, onImported }) {
  const [file, setFile] = useState(null);
  const [sourceType, setSourceType] = useState("asset");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [batchChanges, setBatchChanges] = useState(null);
  async function preparePreview(e) {
    e.preventDefault();
    if (!file) return setMessage("請先選擇 Excel 檔案。");
    setBusy(true);
    setMessage("");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const first = workbook.Sheets[workbook.SheetNames[0]];
      if (!first) throw new Error("找不到可讀取的工作表。");
      const result = inspectImportRows(readWorksheetRows(first), sourceType);
      if (!result.total) throw new Error("找不到有效的資料列。");
      if (!result.errors.length && result.records.length) {
        const { data, error } = await supabase.functions.invoke(
          "import-inventory",
          {
            body: {
              mode: "preview",
              sourceType,
              fileName: file.name,
              records: result.records,
            },
          },
        );
        if (error) {
          const detail = await error.context?.json().catch(() => null);
          throw new Error(detail?.error || error.message);
        }
        result.databaseSummary = data?.summary;
      }
      setPreview(result);
    } catch (error) {
      setPreview(null);
      setMessage(error.message || "無法讀取 Excel，請確認檔案格式。");
    } finally {
      setBusy(false);
    }
  }
  async function commitImport() {
    if (!preview?.records.length || !file) return;
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "import-inventory",
        { body: { sourceType, fileName: file.name, records: preview.records } },
      );
      if (error) {
        const detail = await error.context?.json().catch(() => null);
        throw new Error(detail?.error || error.message);
      }
      if (data?.error) throw new Error(data.error);
      await onImported();
      const deleted = Number(data?.retention?.deletedImports || 0);
      setMessage(
        `已完成匯入 ${Number(data?.recordCount || preview.records.length).toLocaleString()} 筆資料，並已寫入雲端清冊。${deleted ? ` 已依保留規則清除 ${deleted} 筆較早批次。` : ""}`,
      );
      setPreview(null);
    } catch (error) {
      setMessage(error.message || "匯入失敗，請確認預覽報告。");
    } finally {
      setBusy(false);
    }
  }
  function resetPreview(nextFile) {
    setFile(nextFile);
    setPreview(null);
    setMessage("");
  }
  async function viewChanges(entry) {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "import-inventory",
        { body: { mode: "changes", importId: entry.id } },
      );
      if (error) {
        const detail = await error.context?.json().catch(() => null);
        throw new Error(detail?.error || error.message);
      }
      setBatchChanges({ entry, rows: data?.changes || [] });
    } catch (error) {
      setMessage(error.message || "無法讀取批次差異。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">IMPORT REGISTER</p>
          <h1>匯入清冊</h1>
          <p>
            先檢查
            Excel，再確認寫入雲端清冊；主鍵為區分別代碼、財產編號與流水號。
          </p>
        </div>
      </div>
      <form className="import-form" onSubmit={preparePreview}>
        <fieldset>
          <legend>清冊類型</legend>
          <div className="source-options">
            {Object.entries(sourceLabels).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  checked={sourceType === value}
                  onChange={() => {
                    setSourceType(value);
                    setPreview(null);
                  }}
                />
                <span>
                  <strong>{label}</strong>
                  <small>
                    {value === "asset"
                      ? "含原值、累折與淨值"
                      : "通常不含折舊資料"}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="file-field">
          Excel 檔案
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm"
            onChange={(e) => resetPreview(e.target.files?.[0] || null)}
          />
          <span>{file ? file.name : "選擇 .xlsx、.xls 或 .xlsm 檔案"}</span>
        </label>
        <button className="button button-primary" disabled={busy} type="submit">
          {busy && <CapsuleSpinner compact />}
          {busy ? "正在檢查…" : "檢查並產生預覽"}
        </button>
        {message && (
          <p
            className={
              message.startsWith("已完成") ? "form-success" : "form-error"
            }
            role="status"
          >
            {message}
          </p>
        )}
      </form>
      {preview && (
        <section className="import-preview" aria-live="polite">
          <header>
            <div>
              <p className="eyebrow">IMPORT PREVIEW</p>
              <h2>匯入預覽</h2>
            </div>
            <strong>{preview.records.length.toLocaleString()} 筆可匯入</strong>
          </header>
          <div className="preview-summary">
            <p>
              Excel 資料列：<strong>{preview.total.toLocaleString()}</strong>
            </p>
            <p>
              錯誤：
              <strong className={preview.errors.length ? "is-error" : ""}>
                {preview.errors.length.toLocaleString()}
              </strong>
            </p>
            <p>
              重複主鍵：
              <strong className={preview.duplicates.length ? "is-warning" : ""}>
                {preview.duplicates.length.toLocaleString()}
              </strong>
            </p>
          </div>
          {preview.databaseSummary && (
            <>
              <h3>與現行清冊比較</h3>
              <div className="preview-summary">
                <p>
                  新增：
                  <strong>
                    {preview.databaseSummary.added.toLocaleString()}
                  </strong>
                </p>
                <p>
                  更新：
                  <strong>
                    {preview.databaseSummary.changed.toLocaleString()}
                  </strong>
                </p>
                <p>
                  未變更：
                  <strong>
                    {preview.databaseSummary.unchanged.toLocaleString()}
                  </strong>
                </p>
              </div>
            </>
          )}
          {preview.errors.length ? (
            <>
              <h3>錯誤報告</h3>
              <p className="helper">
                含錯誤的資料列不會匯入。請修正 Excel 後重新產生預覽。
              </p>
              <ul className="import-issues">
                {preview.errors.slice(0, 20).map((issue) => (
                  <li key={issue.line}>
                    <strong>第 {issue.line} 列</strong>
                    <span>{issue.messages.join("、")}</span>
                  </li>
                ))}
              </ul>
              {preview.errors.length > 20 && (
                <p className="helper">
                  另有 {preview.errors.length - 20} 項錯誤未列出。
                </p>
              )}
            </>
          ) : (
            <p className="form-success">必要欄位與金額檢查均通過。</p>
          )}
          {preview.duplicates.length ? (
            <>
              <h3>重複主鍵</h3>
              <p className="helper">
                將保留同一主鍵最後出現的資料，其他重複列不會寫入。
              </p>
              <ul className="import-issues">
                {preview.duplicates.slice(0, 10).map((issue) => (
                  <li key={`${issue.previousLine}-${issue.line}`}>
                    <strong>第 {issue.line} 列</strong>
                    <span>
                      與第 {issue.previousLine} 列重複：{issue.identity}
                    </span>
                  </li>
                ))}
              </ul>
              {preview.duplicates.length > 10 && (
                <p className="helper">
                  另有 {preview.duplicates.length - 10} 項重複未列出。
                </p>
              )}
            </>
          ) : null}
          <div className="import-preview-actions">
            <button
              className="button button-secondary"
              onClick={() => setPreview(null)}
              type="button"
            >
              返回修改
            </button>
            <button
              className="button button-primary"
              disabled={
                busy ||
                preview.errors.length > 0 ||
                preview.records.length === 0
              }
              onClick={commitImport}
              type="button"
            >
              {busy && <CapsuleSpinner compact />}
              {busy
                ? "正在寫入…"
                : `確認匯入 ${preview.records.length.toLocaleString()} 筆`}
            </button>
          </div>
        </section>
      )}
      <section className="import-history">
        <h2>匯入紀錄</h2>
        {store.imports.length ? (
          <ul>
            {store.imports.map((entry, i) => (
              <li key={`${entry.at}-${i}`}>
                <span className={`source-tag ${entry.sourceType}`}>
                  {sourceLabels[entry.sourceType]}
                </span>
                <strong>{entry.fileName}</strong>
                <span>{entry.count.toLocaleString()} 筆</span>
                <time>{entry.at}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">尚無匯入紀錄。</p>
        )}
      </section>
    </section>
  );
}
