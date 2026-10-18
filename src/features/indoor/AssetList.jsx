import React, { useEffect, useMemo, useRef, useState } from "react";
import { money } from "../../lib/formatters";

const STEP = 120;
const assetNumber = (asset) => [asset.assetNo, asset.serialNo].filter(Boolean).join("-");

/** The assets of a room (or of one 存置地點 code) as a list that scrolls on its own; a row opens that asset in 財物查詢. */
export function AssetList({ assets, highlightId, onOpenAsset, empty = "這裡沒有財物。" }) {
  const [term, setTerm] = useState("");
  const [shown, setShown] = useState(STEP);
  const highlightRef = useRef(null);
  useEffect(() => { setTerm(""); setShown(STEP); }, [assets]);
  const query = term.trim().toLowerCase();
  const rows = useMemo(() => (query ? assets.filter((asset) => `${asset.name} ${assetNumber(asset)} ${asset.categoryName} ${asset.custodianName}`.toLowerCase().includes(query)) : assets), [assets, query]);
  useEffect(() => {
    if (!highlightId) return;
    const at = rows.findIndex((asset) => asset.id === highlightId);
    if (at >= shown) setShown(at + 1);
    window.requestAnimationFrame(() => highlightRef.current?.scrollIntoView({ block: "center" }));
  }, [highlightId, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((sum, asset) => sum + (Number(asset.netValue) || 0), 0);
  if (!assets.length) return <p className="indoor-empty">{empty}</p>;
  return (
    <div className="indoor-assets">
      {assets.length > 8 && (
        <label className="indoor-assets-search">
          <span className="sr-only">在這裡搜尋財物</span>
          <input onChange={(event) => setTerm(event.target.value)} placeholder="名稱、財產編號、保管人…" value={term} />
        </label>
      )}
      <ul className="indoor-asset-rows">
        {rows.slice(0, shown).map((asset) => (
          <li key={asset.id}>
            <button className={asset.id === highlightId ? "is-highlight" : ""} onClick={() => onOpenAsset?.(asset)} ref={asset.id === highlightId ? highlightRef : null} title="在財物查詢中查看" type="button">
              <strong>{asset.name || "未命名財物"}</strong>
              <small>{assetNumber(asset)}{asset.categoryName ? `　${asset.categoryName}` : ""}</small>
              <span>{asset.custodianName || "未指定"}</span>
              <em>{money(asset.netValue)}</em>
            </button>
          </li>
        ))}
        {rows.length > shown && <li><button className="indoor-more" onClick={() => setShown((count) => count + STEP)} type="button">再顯示 {Math.min(STEP, rows.length - shown)} 筆（尚有 {rows.length - shown} 筆）</button></li>}
        {!rows.length && <li className="indoor-empty">沒有符合的財物。</li>}
      </ul>
      <footer className="indoor-assets-total"><span>{rows.length.toLocaleString()} 筆</span><span>帳面價值合計 NT$ {money(total)}</span></footer>
    </div>
  );
}
