import React, { useEffect, useRef, useState } from "react";
import { CapsuleSpinner } from "../../components/FeedbackCenter";
import { DatePicker } from "../../components/DatePicker";
import { blankLandDraft, landToDraft, saveLandParcel } from "./landEditor";

function Field({ draft, field, label, onChange, required = false, type = "text" }) {
  return <label>{label}<input min={type === "number" ? "0" : undefined} onChange={(event) => onChange(field, event.target.value)} required={required} type={type} value={draft[field]} /></label>;
}

function DateField({ draft, field, label, onChange, popoverDirection }) {
  return <DatePicker id={`land-${field}`} label={label} onChange={(value) => onChange(field, value)} popoverDirection={popoverDirection} value={draft[field]} />;
}

function inventoryNumber(asset) {
  return [asset.category_type_code, asset.asset_no, asset.serial_no].filter(Boolean).join("-");
}

function InventoryNumberField({ draft, onChange, supabase }) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const requestRef = useRef(0);
  useEffect(() => {
    const term = draft.propertyNumber.trim();
    if (term.length < 2) { setCandidates([]); setOpen(false); return undefined; }
    const timer = window.setTimeout(async () => {
      const request = ++requestRef.current;
      setLoading(true);
      const { data, error } = await supabase.from("asset_records")
        .select("asset_no,serial_no,category_type_code,category_name,name,acquired_at,net_value")
        .eq("is_current", true).ilike("asset_no", `%${term}%`).order("asset_no").limit(8);
      if (request !== requestRef.current) return;
      setLoading(false); setCandidates(error ? [] : data || []); setOpen(!error && (data || []).length > 0);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [draft.propertyNumber, supabase]);
  function choose(asset) {
    onChange("propertyNumber", inventoryNumber(asset));
    onChange("propertyName", asset.name || "");
    onChange("propertyAlias", asset.category_name || "");
    onChange("acquisitionDate", asset.acquired_at ? String(asset.acquired_at).slice(0, 10) : "");
    onChange("propertyValue", asset.net_value ?? "");
    setCandidates([]); setOpen(false);
  }
  return <label className="land-inventory-field">財產編號<span className="land-inventory-input"><input autoComplete="off" onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={(event) => onChange("propertyNumber", event.target.value)} onFocus={() => candidates.length && setOpen(true)} placeholder="輸入至少兩個數字或編號" value={draft.propertyNumber} />{loading && <small>查找中…</small>}{open && <ul aria-label="財產編號候選" className="land-inventory-options">{candidates.map((asset) => <li key={`${asset.category_type_code}-${asset.asset_no}-${asset.serial_no}`}><button onMouseDown={(event) => { event.preventDefault(); choose(asset); }} type="button"><strong>{inventoryNumber(asset)}</strong><span>{asset.name || "未命名財產"}</span></button></li>)}</ul>}</span></label>;
}

export function LandEditorDialog({ land, onClose, onSaved, supabase }) {
  const [draft, setDraft] = useState(() => (land ? landToDraft(land) : blankLandDraft()));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(land ? landToDraft(land) : blankLandDraft()); setError(""); }, [land]);
  if (land === undefined) return null;
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError("");
    try { await saveLandParcel(supabase, draft); onSaved(); }
    catch (cause) { setError(cause.message || "儲存土地資料失敗。請稍後再試。"); }
    finally { setSaving(false); }
  }
  return <dialog aria-labelledby="land-editor-title" className="detail-dialog land-editor" onCancel={(event) => { event.preventDefault(); onClose(); }} open>
    <div><header><div><p className="eyebrow">LAND PARCEL MAINTENANCE</p><h2 id="land-editor-title">{draft.id ? "編輯土地資料" : "新增土地資料"}</h2></div><button aria-label="關閉" className="close-button" disabled={saving} onClick={onClose} type="button">×</button></header>
      <form id="land-editor-form" onSubmit={submit}><div className="land-editor-columns">
        <section className="land-editor-main" aria-label="土地基本資料">
          <div className="land-editor-row land-location-row"><Field draft={draft} field="county" label="縣市" onChange={update} /><Field draft={draft} field="township" label="鄉鎮市區" onChange={update} /><Field draft={draft} field="sectionCode" label="段別代碼" onChange={update} required /><Field draft={draft} field="sectionName" label="段別名稱" onChange={update} required /><Field draft={draft} field="landNumber" label="地號" onChange={update} required /></div>
          <div className="land-editor-row land-zoning-row"><Field draft={draft} field="zoning" label="使用分區" onChange={update} /><Field draft={draft} field="landUseType" label="使用地類別" onChange={update} /><Field draft={draft} field="announcedLandValue" label="公告土地現值" onChange={update} type="number" /><Field draft={draft} field="announcedLandPrice" label="公告地價" onChange={update} type="number" /><DateField draft={draft} field="announcedPriceDate" label="公告價格日期" onChange={update} /></div>
          <div className="land-editor-row land-property-row"><Field draft={draft} field="publicClassification" label="財產區分別" onChange={update} /><InventoryNumberField draft={draft} onChange={update} supabase={supabase} /><Field draft={draft} field="propertyName" label="財產名稱" onChange={update} /><Field draft={draft} field="propertyAlias" label="財產別名" onChange={update} /></div>
          <div className="land-editor-row land-financial-row"><DateField draft={draft} field="acquisitionDate" label="取得日期" onChange={update} popoverDirection="up" /><DateField draft={draft} field="registrationDate" label="登記日期" onChange={update} popoverDirection="up" /><Field draft={draft} field="area" label="面積（平方公尺）" onChange={update} type="number" /><Field draft={draft} field="propertyValue" label="帳面價值" onChange={update} type="number" /></div>
          <label className="land-editor-wide">備註<textarea onChange={(event) => update("notes", event.target.value)} value={draft.notes} /></label>
        </section>
        <aside className="land-editor-support" aria-label="土地關聯與地籍圖資"><Field draft={draft} field="relatedBuildingNumbers" label="關聯建號（以頓號或逗號分隔）" onChange={update} /><Field draft={draft} field="cadastralLink" label="地籍連結" onChange={update} type="url" /><label className="land-editor-wide land-geometry-field">地籍範圍 GeoJSON <small>接受 Polygon、MultiPolygon 或 Feature；座標須為 WGS84 經緯度。</small><textarea className="land-geometry-input" onChange={(event) => update("geometryText", event.target.value)} required value={draft.geometryText} /></label></aside>
      </div></form>{error && <p className="form-error" role="alert">{error}</p>}<footer className="land-editor-actions"><button className="button button-secondary" disabled={saving} onClick={onClose} type="button">取消</button><button className="button button-primary" disabled={saving} form="land-editor-form" type="submit">{saving && <CapsuleSpinner compact />}{saving ? "儲存中…" : "儲存土地資料"}</button></footer>
    </div>
  </dialog>;
}
