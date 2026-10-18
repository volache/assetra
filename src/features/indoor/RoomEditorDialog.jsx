import React, { useMemo, useState } from "react";
import { CapsuleSpinner } from "../../components/FeedbackCenter";
import { SPACE_TYPE_LABELS, spaceTitle } from "./geometry";

const USAGE_PRESETS = ["走廊", "樓梯間", "電梯", "廁所", "茶水間", "機房", "管道間", "儲藏", "出入口", "停車空間"];

/** Administrators change a room's name, note, kind and 存置地點 codes here; its outline comes from the tracing tool. */
export function RoomEditorDialog({ space, links, locations, onClose, onSave, onDelete }) {
  const [draft, setDraft] = useState(() => ({
    name: space.name || "", usage: space.usage || "", spaceType: space.space_type,
    codes: links.map((link) => ({ code: link.location_code, name: link.location_name || "" })),
  }));
  const [term, setTerm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  const used = new Set(draft.codes.map((item) => item.code));
  const options = useMemo(() => {
    const query = term.trim().toLowerCase();
    if (!query) return [];
    return locations.filter((row) => !used.has(row.location_code) && `${row.location_code} ${row.location_name || ""}`.toLowerCase().includes(query)).slice(0, 8);
  }, [term, locations, draft.codes]); // eslint-disable-line react-hooks/exhaustive-deps

  function addCode(row) {
    setDraft((current) => ({ ...current, codes: [...current.codes, { code: row.location_code, name: row.location_name || "" }] }));
    setTerm("");
    // the name of the main code is the room's name unless one was typed
    if (!draft.name && !draft.codes.length) update("name", row.location_name || "");
  }
  const removeCode = (code) => setDraft((current) => ({ ...current, codes: current.codes.filter((item) => item.code !== code) }));
  const makeMain = (code) => setDraft((current) => ({ ...current, codes: [...current.codes.filter((item) => item.code === code), ...current.codes.filter((item) => item.code !== code)] }));

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSave(draft); } catch (cause) { setError(cause.message || "儲存失敗，請稍後再試。"); setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`確定要刪除「${spaceTitle(space)}」嗎？這個房間會從平面圖移除，而存置地點與財物資料不受影響。`)) return;
    setBusy(true); setError("");
    try { await onDelete(); } catch (cause) { setError(cause.message || "刪除失敗，請稍後再試。"); setBusy(false); }
  }

  return (
    <dialog aria-labelledby="indoor-editor-title" className="detail-dialog indoor-editor" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} open>
      <div>
        <header>
          <div><p className="eyebrow">ROOM MAINTENANCE</p><h2 id="indoor-editor-title">編輯房間</h2></div>
          <button aria-label="關閉" className="close-button" disabled={busy} onClick={onClose} type="button">×</button>
        </header>
        <form id="indoor-editor-form" onSubmit={submit}>
          <label>名稱<input onChange={(event) => update("name", event.target.value)} placeholder="例如 業務組辦公室" value={draft.name} /></label>
          <label>空間用途 <small>自己加註的文字，會以小標籤顯示在平面圖上</small>
            <input list="indoor-usage-presets" onChange={(event) => update("usage", event.target.value)} placeholder="例如 走廊、樓梯間、機房" value={draft.usage} />
            <datalist id="indoor-usage-presets">{USAGE_PRESETS.map((item) => <option key={item} value={item} />)}</datalist>
          </label>
          <label>類型
            <select onChange={(event) => update("spaceType", event.target.value)} value={draft.spaceType}>
              {Object.entries(SPACE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <fieldset className="indoor-code-field">
            <legend>存置地點代碼 <small>第一個是主要代碼；同一個位置有多個代碼時可以全部加上</small></legend>
            <ul>
              {draft.codes.map((item, position) => (
                <li key={item.code}>
                  <strong>{item.code}</strong><span>{item.name || "—"}</span>
                  {position === 0 ? <em>主要</em> : <button onClick={() => makeMain(item.code)} type="button">設為主要</button>}
                  <button aria-label={`移除 ${item.code}`} onClick={() => removeCode(item.code)} type="button">移除</button>
                </li>
              ))}
              {!draft.codes.length && <li className="is-empty">尚未對應存置地點</li>}
            </ul>
            <label className="indoor-code-search">加上存置地點
              <input autoComplete="off" onChange={(event) => setTerm(event.target.value)} placeholder="輸入代碼或名稱搜尋…" value={term} />
              {options.length > 0 && (
                <ul aria-label="存置地點候選" className="land-inventory-options">
                  {options.map((row) => (
                    <li key={row.location_code}><button onClick={() => addCode(row)} type="button"><strong>{row.location_code}</strong><span>{row.location_name || "—"}　{row.asset_count} 筆財物</span></button></li>
                  ))}
                </ul>
              )}
            </label>
          </fieldset>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="indoor-editor-actions">
          <button className="button button-secondary indoor-danger" disabled={busy} onClick={remove} type="button">刪除房間</button>
          <span />
          <button className="button button-secondary" disabled={busy} onClick={onClose} type="button">取消</button>
          <button className="button button-primary" disabled={busy} form="indoor-editor-form" type="submit">{busy && <CapsuleSpinner compact />}{busy ? "儲存中…" : "儲存"}</button>
        </footer>
      </div>
    </dialog>
  );
}
