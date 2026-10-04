import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { requestAssetPhoto } from "./api";
import { CapsuleSpinner } from "../../components/FeedbackCenter";

const categoryLabels = { general: "現況", location: "位置", identification: "辨識", composition: "組合", tag: "標籤", evidence: "佐證" };
const maxPhotos = 12;
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
    return new File([result], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.webp`, { type: "image/webp" });
  } finally { URL.revokeObjectURL(sourceUrl); }
}

function PhotoManagerIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7.5h16v11H4zM8 7.5l1.2-2h5.6l1.2 2M8 14l2.2-2.2 2.3 2.3 1.7-1.7L17 15.2" /></svg>;
}

function UploadIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15.5v3.5h14v-3.5" /></svg>;
}

function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4.5h6V7m2 0-1 13H8L7 7m3 4v5m4-5v5" /></svg>;
}

export function AssetPhotoPicker({ asset, onChanged, onClose }) {
  const [photos, setPhotos] = useState([]);
  const [urls, setUrls] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [handOpen, setHandOpen] = useState(true);
  const [flight, setFlight] = useState(null);
  const [returningId, setReturningId] = useState(null);
  const [switching, setSwitching] = useState(false);
  const [queuedDirection, setQueuedDirection] = useState(null);
  const [switchedPreviewId, setSwitchedPreviewId] = useState(null);
  const [managing, setManaging] = useState(false);
  const [category, setCategory] = useState("general");
  const [uploading, setUploading] = useState(false);
  const [managerError, setManagerError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(false);
  const [managerLeaving, setManagerLeaving] = useState(false);
  const [managerSelectionId, setManagerSelectionId] = useState(null);
  const [closing, setClosing] = useState(false);
  const previewImageRef = useRef(null);
  const selectedOriginRef = useRef(null);
  const cardRefs = useRef(new Map());
  const handRef = useRef(null);
  const switchGhostRef = useRef(null);
  const inputRef = useRef(null);
  const closeTimerRef = useRef(null);
  const managerTimerRef = useRef(null);

  const requestClose = () => {
    if (closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    setClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 210);
  };

  const enterManagement = () => {
    window.clearTimeout(managerTimerRef.current);
    setManagerLeaving(false); setManaging(true); setManagerSelectionId(selectedId); setPendingDelete(false); setManagerError(""); setHandOpen(true);
  };

  const exitManagement = () => {
    window.clearTimeout(managerTimerRef.current);
    setManaging(false); setManagerLeaving(true); setPendingDelete(false); setManagerError("");
    managerTimerRef.current = window.setTimeout(() => { setManagerLeaving(false); setManagerSelectionId(null); }, 220);
  };
  const cardOriginRect = (photoId) => {
    const card = cardRefs.current.get(photoId);
    const hand = handRef.current;
    if (!card || !hand) return null;
    const clone = card.cloneNode(false);
    clone.className = "is-measuring";
    clone.tabIndex = -1;
    clone.setAttribute("aria-hidden", "true");
    Object.assign(clone.style, {
      animation: "none",
      left: `${card.offsetLeft}px`,
      margin: "0",
      pointerEvents: "none",
      position: "absolute",
      top: `${card.offsetTop}px`,
      transition: "none",
      visibility: "hidden",
    });
    hand.appendChild(clone);
    const rect = clone.getBoundingClientRect();
    clone.remove();
    const transform = handRef.current ? window.getComputedStyle(handRef.current).transform : "none";
    const translateY = transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m42 : 0;
    return { angle: card.style.getPropertyValue("--photo-card-angle") || "0deg", left: rect.left, top: rect.top - translateY, width: rect.width, height: rect.height };
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!asset?.identityId) return undefined;
    let cancelled = false;
    setPhotos([]); setUrls({}); setSelectedId(null); setHandOpen(true); setFlight(null); setReturningId(null); setSwitching(false); setQueuedDirection(null); setSwitchedPreviewId(null); setManaging(false); setManagerLeaving(false); setManagerSelectionId(null); setClosing(false); setUploading(false); setManagerError(""); setPendingDelete(false); setError(""); setLoading(true);
    requestAssetPhoto({ action: "list", identityId: asset.identityId })
      .then(async (data) => {
        const records = data.photos || [];
        const signed = await Promise.all(records.map(async (photo) => [photo.id, (await requestAssetPhoto({ action: "create_download", identityId: asset.identityId, photoId: photo.id })).url]));
        if (cancelled) return;
        setPhotos(records); setUrls(Object.fromEntries(signed));
      })
      .catch((requestError) => { if (!cancelled) setError(requestError.message || "無法讀取現場照片。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [asset?.identityId]);

  useEffect(() => () => {
    switchGhostRef.current?.remove();
    window.clearTimeout(closeTimerRef.current);
    window.clearTimeout(managerTimerRef.current);
  }, []);

  useEffect(() => {
    if (!asset?.identityId) return undefined;
    const root = document.documentElement;
    const pageScroller = document.querySelector(".main-area");
    const previousRootOverflow = root.style.overflow;
    const previousOverflow = document.body.style.overflow;
    const previousPageOverflow = pageScroller?.style.overflow || "";
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    if (pageScroller) pageScroller.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousOverflow;
      if (pageScroller) pageScroller.style.overflow = previousPageOverflow;
    };
  }, [asset?.identityId]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (pendingDelete) { setPendingDelete(false); return; }
        if (selectedId) { switchGhostRef.current?.remove(); switchGhostRef.current = null; setSelectedId(null); setHandOpen(true); setFlight(null); setSwitching(false); setQueuedDirection(null); setSwitchedPreviewId(null); }
        else if (managing) exitManagement();
        else requestClose();
        return;
      }
      if (!photos.length || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      showAdjacentPhoto(event.key === "ArrowRight" ? 1 : -1);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closing, managing, pendingDelete, photos, selectedId, switching]);

  useLayoutEffect(() => {
    const target = previewImageRef.current;
    if (!flight || !target || flight.photoId !== selectedId) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setFlight(null); return undefined; }
    const targetRect = target.getBoundingClientRect();
    if (!targetRect.width || !targetRect.height) return undefined;
    const translateX = (flight.sourceRect.left + flight.sourceRect.width / 2) - (targetRect.left + targetRect.width / 2);
    const translateY = (flight.sourceRect.top + flight.sourceRect.height / 2) - (targetRect.top + targetRect.height / 2);
    const scale = Math.min(flight.sourceRect.width / targetRect.width, flight.sourceRect.height / targetRect.height);
    const isSwitch = flight.mode === "switch";
    const animation = target.animate([
      { borderRadius: ".72rem", filter: "brightness(1.06)", opacity: isSwitch ? .28 : .82, transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`, transformOrigin: "center center" },
      { borderRadius: ".85rem", filter: "brightness(1)", opacity: 1, transform: "translate(0, 0) scale(1)", transformOrigin: "center center" },
    ], { duration: isSwitch ? 380 : 560, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "both" });
    animation.onfinish = () => { setFlight(null); if (isSwitch) setSwitching(false); };
    return () => animation.cancel();
  }, [flight, selectedId]);

  const selected = photos.find((photo) => photo.id === selectedId);
  function showAdjacentPhoto(direction) {
    if (!photos.length) return;
    if (switching) { setQueuedDirection(direction); return; }
    const currentIndex = Math.max(0, photos.findIndex((photo) => photo.id === selectedId));
    const nextIndex = (currentIndex + direction + photos.length) % photos.length;
    const nextPhoto = photos[nextIndex];
    if (nextPhoto.id === selectedId) return;
    const currentOrigin = selectedId ? cardOriginRect(selectedId) : null;
    const nextOrigin = cardOriginRect(nextPhoto.id);
    if (nextOrigin) selectedOriginRef.current = nextOrigin;
    const nextVisibleRect = cardRefs.current.get(nextPhoto.id)?.getBoundingClientRect() || nextOrigin;
    const image = previewImageRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!image || !currentOrigin || !nextOrigin || !nextVisibleRect || reduceMotion) {
      setFlight(null); setSwitchedPreviewId(nextPhoto.id); setSelectedId(nextPhoto.id); setHandOpen(false); setSwitching(false); return;
    }
    const collapsedDeltaX = (nextVisibleRect.left + nextVisibleRect.width / 2) - (nextOrigin.left + nextOrigin.width / 2);
    const collapsedDeltaY = (nextVisibleRect.top + nextVisibleRect.height / 2) - (nextOrigin.top + nextOrigin.height / 2);
    const currentDestination = { ...currentOrigin, left: currentOrigin.left + collapsedDeltaX, top: currentOrigin.top + collapsedDeltaY };
    const source = image.getBoundingClientRect();
    const clone = image.cloneNode(true);
    const computed = window.getComputedStyle(image);
    switchGhostRef.current?.remove();
    switchGhostRef.current = clone;
    clone.className = "asset-photo-switch-ghost";
    clone.setAttribute("aria-hidden", "true");
    Object.assign(clone.style, {
      borderRadius: computed.borderRadius,
      height: `${source.height}px`,
      left: `${source.left}px`,
      objectFit: computed.objectFit,
      top: `${source.top}px`,
      width: `${source.width}px`,
    });
    document.body.appendChild(clone);
    const translateX = (currentDestination.left + currentDestination.width / 2) - (source.left + source.width / 2);
    const translateY = (currentDestination.top + currentDestination.height / 2) - (source.top + source.height / 2);
    const scale = Math.min(currentDestination.width / source.width, currentDestination.height / source.height);
    const outgoing = clone.animate([
      { filter: "brightness(1)", opacity: 1, transform: "translate(0, 0) scale(1)", transformOrigin: "center center" },
      { filter: "brightness(1.05)", opacity: 0, transform: `translate(${translateX}px, ${translateY}px) scale(${scale}) rotate(${currentOrigin.angle || "0deg"})`, transformOrigin: "center center" },
    ], { duration: 380, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "both" });
    outgoing.onfinish = () => { clone.remove(); if (switchGhostRef.current === clone) switchGhostRef.current = null; };
    setQueuedDirection(null);
    setSwitching(true);
    setSwitchedPreviewId(nextPhoto.id);
    if (managing) setManagerSelectionId(nextPhoto.id);
    setFlight({ photoId: nextPhoto.id, sourceRect: nextVisibleRect, mode: "switch", direction });
    setSelectedId(nextPhoto.id);
    setHandOpen(false);
  }

  useEffect(() => {
    if (switching || queuedDirection === null) return undefined;
    const direction = queuedDirection;
    setQueuedDirection(null);
    const frame = window.requestAnimationFrame(() => showAdjacentPhoto(direction));
    return () => window.cancelAnimationFrame(frame);
  }, [switching, queuedDirection, selectedId]);

  if (!asset) return null;
  const refreshPhotos = async () => {
    const data = await requestAssetPhoto({ action: "list", identityId: asset.identityId });
    const records = data.photos || [];
    const signed = await Promise.all(records.map(async (photo) => [photo.id, (await requestAssetPhoto({ action: "create_download", identityId: asset.identityId, photoId: photo.id })).url]));
    setPhotos(records);
    setUrls(Object.fromEntries(signed));
    onChanged?.(records.length);
    return records;
  };
  const uploadPhotos = async (event) => {
    const files = Array.from(event.target.files || []); event.target.value = "";
    if (!files.length) return;
    if (photos.length + files.length > maxPhotos) { setManagerError(`每筆財物最多可保留 ${maxPhotos} 張照片，目前還可上傳 ${Math.max(maxPhotos - photos.length, 0)} 張。`); return; }
    setUploading(true); setManagerError("");
    try {
      for (const file of files) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("請選擇 JPEG、PNG 或 WebP 圖片。");
        const compressed = await compressPhoto(file);
        const payload = new FormData();
        payload.append("action", "upload"); payload.append("identityId", asset.identityId); payload.append("category", category); payload.append("file", compressed);
        await requestAssetPhoto(payload);
      }
      await refreshPhotos();
    } catch (requestError) { setManagerError(requestError.message || "照片上傳失敗，請再試一次。"); }
    finally { setUploading(false); }
  };
  const deleteSelectedPhoto = async () => {
    const photoId = managerSelectionId || selectedId;
    if (!photoId) return;
    setUploading(true); setManagerError("");
    try {
      await requestAssetPhoto({ action: "delete", identityId: asset.identityId, photoId });
      setSelectedId(null); setHandOpen(true); setFlight(null); setReturningId(null); setSwitchedPreviewId(null); setPendingDelete(false);
      setManagerSelectionId(null);
      await refreshPhotos();
    } catch (requestError) { setManagerError(requestError.message || "無法刪除照片。"); }
    finally { setUploading(false); }
  };
  const returnPhotoToHand = () => {
    if (switching) return;
    const image = previewImageRef.current;
    const destination = selectedOriginRef.current;
    setHandOpen(true);
    setReturningId(selectedId);
    if (!image || !destination || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSelectedId(null); setHandOpen(true); setFlight(null); setReturningId(null); setSwitchedPreviewId(null); return;
    }
    const source = image.getBoundingClientRect();
    const translateX = (destination.left + destination.width / 2) - (source.left + source.width / 2);
    const translateY = (destination.top + destination.height / 2) - (source.top + source.height / 2);
    const scale = Math.min(destination.width / source.width, destination.height / source.height);
    const animation = image.animate([
      { filter: "brightness(1)", opacity: 1, transform: "translate(0, 0) scale(1)", transformOrigin: "center center" },
      { filter: "brightness(1.06)", opacity: 0, transform: `translate(${translateX}px, ${translateY}px) scale(${scale}) rotate(${destination.angle || "0deg"})`, transformOrigin: "center center" },
    ], { duration: 460, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "both" });
    animation.onfinish = () => { setSelectedId(null); setHandOpen(true); setFlight(null); setReturningId(null); setSwitchedPreviewId(null); };
  };

  return <div className={`asset-photo-picker-backdrop ${managing ? "is-managing" : ""} ${closing ? "is-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget && !managing) requestClose(); }}>
    <button aria-label="關閉照片選擇器" className="asset-photo-picker-close" onClick={requestClose} type="button">×</button>
    <button aria-pressed={managing} className={`asset-photo-picker-manage ${managing ? "is-active" : ""}`} onClick={managing ? exitManagement : enterManagement} type="button"><PhotoManagerIcon /><span className="asset-photo-manage-label" key={managing ? "done" : "manage"}>{managing ? "完成" : "管理照片"}</span></button>
    <p className="asset-photo-picker-caption">{asset.name || "財物"} · {[asset.assetNo, asset.serialNo].filter(Boolean).join("-")}</p>
    {(managing || managerLeaving) && <section aria-label="照片管理工具" className={`asset-photo-manager ${managerLeaving ? "is-leaving" : ""} ${selected ? "is-photo-context" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
      <div className="asset-photo-manager-summary"><strong>{selected ? "目前照片" : "管理照片"}</strong><span>{selected ? `${photos.findIndex((photo) => photo.id === selected.id) + 1}／${photos.length}` : `${photos.length}／${maxPhotos}`}</span></div>
      {selected ? <div className="asset-photo-current-details">
        <span>{categoryLabels[selected.category] || "現況"}</span>
        <strong title={selected.original_filename}>{selected.original_filename || "現場照片"}</strong>
        <p>點擊照片可收回手牌；刪除只會移除這張照片。</p>
      </div> : <>
        <span className="asset-photo-manager-label">新照片類型</span>
        <div aria-label="新照片類型" className="asset-photo-category-pills" role="group">{Object.entries(categoryLabels).map(([value, label]) => <button aria-pressed={category === value} className={category === value ? "is-active" : ""} disabled={uploading} key={value} onClick={() => setCategory(value)} type="button">{label}</button>)}</div>
      </>}
      <div className="asset-photo-manager-actions">
        {!selected && <button className="asset-photo-manager-primary" disabled={uploading || photos.length >= maxPhotos} onClick={() => inputRef.current?.click()} type="button">{uploading ? <CapsuleSpinner compact /> : <UploadIcon />}{uploading ? "處理中…" : "新增照片"}</button>}
        {(selected || managerSelectionId) && !pendingDelete && <button className="asset-photo-manager-danger" disabled={uploading} onClick={() => setPendingDelete(true)} type="button"><TrashIcon />刪除此張</button>}
        {pendingDelete && <div className="asset-photo-manager-confirm"><span>確定刪除此張？</span><button disabled={uploading} onClick={() => setPendingDelete(false)} type="button">取消</button><button disabled={uploading} onClick={deleteSelectedPhoto} type="button">刪除</button></div>}
      </div>
      <input accept="image/jpeg,image/png,image/webp" hidden multiple onChange={uploadPhotos} ref={inputRef} type="file" />
      {managerError && <p className="is-error" role="alert">{managerError}</p>}
    </section>}
    {loading ? <div className="asset-photo-picker-empty asset-photo-picker-loading"><CapsuleSpinner /><strong>正在讀取現場照片</strong></div> : error ? <p className="form-error asset-photo-picker-message" role="alert">{error}</p> : !photos.length ? <div className="asset-photo-picker-empty"><strong>尚未上傳照片</strong><p>{managing ? "請從上方選擇照片類型，再新增第一張照片。" : "按「管理照片」即可直接在這裡新增。"}</p>{!managing && <button className="asset-photo-empty-action" onClick={enterManagement} type="button"><UploadIcon />新增照片</button>}</div> : <>
      {!selected && <p className="asset-photo-picker-hint">選一張照片查看完整內容</p>}
      {selected && <figure className="asset-photo-selected" aria-live="polite" onMouseDown={(event) => event.stopPropagation()}>
        {photos.length > 1 && <button aria-label="上一張照片" className="asset-photo-nav is-previous" onClick={() => showAdjacentPhoto(-1)} type="button">‹</button>}
        {urls[selected.id] ? <button aria-label="將照片收回手牌" className={`asset-photo-return ${switchedPreviewId === selected.id ? "is-switch-target" : ""}`} key={selected.id} onClick={returnPhotoToHand} type="button"><img alt={`${categoryLabels[selected.category] || "現況"}照片`} ref={previewImageRef} src={urls[selected.id]} /></button> : <CapsuleSpinner />}
        {photos.length > 1 && <button aria-label="下一張照片" className="asset-photo-nav is-next" onClick={() => showAdjacentPhoto(1)} type="button">›</button>}
        <figcaption>{categoryLabels[selected.category] || "現況"} · {photos.findIndex((photo) => photo.id === selected.id) + 1}／{photos.length} · 點擊照片收回</figcaption>
      </figure>}
      <div aria-label="選擇照片" className={`asset-photo-hand ${selected ? "has-selection" : ""} ${handOpen ? "is-open" : "is-collapsed"}`} onBlur={(event) => { if (selected && !event.currentTarget.contains(event.relatedTarget)) setHandOpen(false); }} onFocus={() => setHandOpen(true)} ref={handRef} role="list">
        {photos.map((photo, index) => {
          const offset = index - ((photos.length - 1) / 2);
          const angle = Math.max(-8, Math.min(8, offset * 1.8));
          const arc = Math.min(1.35, Math.pow(Math.abs(offset), 1.18) * .16);
          const cardClass = photo.id === selected?.id ? `is-selected is-dealt ${returningId === photo.id ? "is-returning" : ""}` : photo.id === managerSelectionId && managing ? "is-manager-selected" : "";
          return <button aria-label={`選擇第 ${index + 1} 張${categoryLabels[photo.category] || "現況"}照片`} className={cardClass} key={photo.id} onClick={(event) => { const sourceRect = event.currentTarget.getBoundingClientRect(); selectedOriginRef.current = cardOriginRect(photo.id) || sourceRect; setFlight({ photoId: photo.id, sourceRect }); setReturningId(null); setSwitchedPreviewId(null); setManagerSelectionId(managing ? photo.id : null); setSelectedId(photo.id); setHandOpen(false); if (event.detail > 0) event.currentTarget.blur(); }} onPointerEnter={() => { if (selected) setHandOpen(true); }} onPointerLeave={(event) => { const nextCard = event.relatedTarget?.closest?.("button"); if (selected && !(nextCard && handRef.current?.contains(nextCard))) setHandOpen(false); }} ref={(node) => { if (node) cardRefs.current.set(photo.id, node); else cardRefs.current.delete(photo.id); }} role="listitem" style={{ "--photo-card-angle": `${angle}deg`, "--photo-card-arc": `${arc}rem`, "--photo-card-index": index }} type="button">
          {urls[photo.id] ? <img alt="" src={urls[photo.id]} /> : <span>讀取中…</span>}
          </button>;
        })}
      </div>
    </>}
  </div>;
}
