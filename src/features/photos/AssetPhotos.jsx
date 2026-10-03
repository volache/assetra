import React, { useEffect, useRef, useState } from "react";
import { requestAssetPhoto } from "./api";
import { CapsuleSpinner } from "../../components/FeedbackCenter";

const categoryLabels = { general: "現況", location: "位置", identification: "辨識", composition: "組合", tag: "標籤", evidence: "佐證" };
const maxPhotos = 12;
const readableSize = (bytes) => `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`;
const compressionSteps = [{ maxEdge: 1920, quality: .82 }, { maxEdge: 1600, quality: .76 }, { maxEdge: 1280, quality: .72 }];

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("此瀏覽器無法壓縮照片。")), "image/webp", quality));
}

async function compressPhoto(file) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("無法讀取選取的照片。")); element.src = sourceUrl; });
    let result = null;
    for (const step of compressionSteps) {
      const scale = Math.min(1, step.maxEdge / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      result = await canvasBlob(canvas, step.quality);
      if (result.size <= 1024 * 1024) break;
    }
    const filename = `${file.name.replace(/\.[^.]+$/, "") || "photo"}.webp`;
    return new File([result], filename, { type: "image/webp" });
  } finally { URL.revokeObjectURL(sourceUrl); }
}

export function AssetPhotos({ identityId, active, onCountChange }) {
  const inputRef = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [urls, setUrls] = useState({});
  const [category, setCategory] = useState("general");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false);

  const loadPhotos = async () => {
    if (!identityId) return;
    setLoading(true);
    try {
      const data = await requestAssetPhoto({ action: "list", identityId });
      const records = data.photos || [];
      const signed = await Promise.all(records.map(async (photo) => [photo.id, (await requestAssetPhoto({ action: "create_download", identityId, photoId: photo.id })).url]));
      setPhotos(records); setUrls(Object.fromEntries(signed)); onCountChange?.(records.length);
    } catch (requestError) { setError(requestError.message || "無法載入財物照片。"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!identityId) { setPhotos([]); setUrls({}); setError(""); onCountChange?.(0); return; }
    if (active) loadPhotos();
    // Signed URLs are renewed whenever this asset panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, identityId]);

  const upload = async (event) => {
    const files = Array.from(event.target.files || []); event.target.value = "";
    if (!files.length) return;
    if (photos.length + files.length > maxPhotos) { setError(`每筆財物最多可保留 ${maxPhotos} 張照片，目前還可上傳 ${Math.max(maxPhotos - photos.length, 0)} 張。`); return; }
    setUploading(true); setError("");
    try {
      for (const file of files) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("請選擇 JPEG、PNG 或 WebP 圖片。");
        const compressed = await compressPhoto(file);
        const payload = new FormData();
        payload.append("action", "upload"); payload.append("identityId", identityId);
        payload.append("category", category); payload.append("file", compressed);
        await requestAssetPhoto(payload);
      }
      setUploadPanelOpen(false); await loadPhotos();
    } catch (requestError) { setError(requestError.message || "照片上傳失敗，請再試一次。"); }
    finally { setUploading(false); }
  };

  const openPhoto = (photoId) => { if (urls[photoId]) window.open(urls[photoId], "_blank", "noopener,noreferrer"); };
  const deletePhoto = async (photoId) => {
    setUploading(true); setError("");
    try { await requestAssetPhoto({ action: "delete", identityId, photoId }); setPendingDelete(null); await loadPhotos(); }
    catch (requestError) { setError(requestError.message || "無法刪除照片。"); }
    finally { setUploading(false); }
  };

  if (!active) return null;
  return <section className="asset-photo-ledger" aria-labelledby="asset-photos-title">
    <header><div><p className="eyebrow">ASSET PHOTOS</p><h4 id="asset-photos-title">現場照片</h4><p>{photos.length}／{maxPhotos} 張</p></div><button className="button button-primary" disabled={uploading || loading || photos.length >= maxPhotos} onClick={() => setUploadPanelOpen((open) => !open)} type="button">{uploadPanelOpen ? "收起" : "上傳照片"}</button></header>
    {uploadPanelOpen && <div className="asset-photo-upload-panel"><label>照片類型<select disabled={uploading} onChange={(event) => setCategory(event.target.value)} value={category}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div><p>上傳後會轉為 WebP：最長邊 1,920 px、品質 82%，若仍超過 1 MB 會再縮小。</p><button className="button button-secondary" disabled={uploading} onClick={() => inputRef.current?.click()} type="button">{uploading && <CapsuleSpinner compact />}{uploading ? "壓縮與上傳中…" : "選取照片"}</button></div><input accept="image/jpeg,image/png,image/webp" hidden multiple onChange={upload} ref={inputRef} type="file" /></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {pendingDelete && <div aria-labelledby="photo-delete-title" aria-modal="false" className="asset-photo-delete-confirm" role="alertdialog"><div><strong id="photo-delete-title">刪除這張照片？</strong><p>刪除後無法復原。</p></div><div><button className="button button-secondary" disabled={uploading} onClick={() => setPendingDelete(null)} type="button">取消</button><button className="button button-danger" disabled={uploading} onClick={() => deletePhoto(pendingDelete)} type="button">{uploading && <CapsuleSpinner compact />}{uploading ? "刪除中…" : "刪除"}</button></div></div>}
    {loading ? <p className="asset-photo-status">正在讀取照片…</p> : photos.length ? <div className="asset-photo-grid">{photos.map((photo) => <article className="asset-photo-card" key={photo.id}>
      <button aria-label={`開啟 ${photo.original_filename}`} className="asset-photo-image" onClick={() => openPhoto(photo.id)} type="button">{urls[photo.id] ? <img alt="" src={urls[photo.id]} /> : <span>讀取中…</span>}</button>
      <div><span>{categoryLabels[photo.category] || "現況"}</span><small title={photo.original_filename}>{photo.original_filename} · {readableSize(photo.file_size)}</small><button className="text-button" disabled={uploading} onClick={() => setPendingDelete(photo.id)} type="button">刪除</button></div>
    </article>)}</div> : <p className="asset-photo-status">尚未上傳照片。</p>}
  </section>;
}
