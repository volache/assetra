import React, { useMemo, useState } from "react";
import { CapsuleSpinner, useFeedback } from "../../components/FeedbackCenter";

export function ExportInventoryControl({ assets, preferredCode = "" }) {
  const { notify } = useFeedback();
  const [chosenCode, setChosenCode] = useState("");
  const [busy, setBusy] = useState(false);
  const custodians = useMemo(() => {
    const byCode = new Map();
    for (const asset of assets) {
      if (asset.status !== "使用中" || !asset.custodianCode) continue;
      const entry = byCode.get(asset.custodianCode) || {
        code: asset.custodianCode,
        name: asset.custodianName,
        count: 0,
      };
      entry.count += 1;
      byCode.set(asset.custodianCode, entry);
    }
    return [...byCode.values()].sort((a, b) =>
      a.code.localeCompare(b.code, "zh-Hant", { numeric: true }),
    );
  }, [assets]);
  if (!custodians.length) return null;
  const selected = custodians.some((item) => item.code === chosenCode)
    ? chosenCode
    : custodians.some((item) => item.code === preferredCode)
      ? preferredCode
      : custodians[0].code;

  async function exportSheets() {
    setBusy(true);
    try {
      const { exportCustodianInventorySheets } = await import("./exportInventorySheet");
      const files = await exportCustodianInventorySheets(assets, selected);
      notify(
        files.length
          ? `已匯出 ${files.length} 份盤點清冊：${files.join("、")}`
          : "此保管人沒有「使用中」的財物可匯出。",
        files.length ? "success" : "error",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "匯出盤點清冊失敗。", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="export-inventory">
      <label>
        <span className="sr-only">匯出盤點清冊的保管人</span>
        <select
          aria-label="匯出盤點清冊的保管人"
          disabled={busy || custodians.length === 1}
          onChange={(event) => setChosenCode(event.target.value)}
          value={selected}
        >
          {custodians.map((item) => (
            <option key={item.code} value={item.code}>
              {item.code} {item.name}（{item.count} 筆）
            </option>
          ))}
        </select>
      </label>
      <button
        className="button button-secondary"
        disabled={busy}
        onClick={exportSheets}
        type="button"
      >
        {busy ? (
          <>
            <CapsuleSpinner compact />
            <span>產生中</span>
          </>
        ) : (
          "匯出盤點清冊"
        )}
      </button>
    </div>
  );
}
