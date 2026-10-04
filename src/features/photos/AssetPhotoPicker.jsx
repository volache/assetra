import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { requestAssetPhoto } from "./api";
import { CapsuleSpinner } from "../../components/FeedbackCenter";

const categoryLabels = { general: "現況", location: "位置", identification: "辨識", composition: "組合", tag: "標籤", evidence: "佐證" };

export function AssetPhotoPicker({ asset, onClose }) {
  const [photos, setPhotos] = useState([]);
  const [urls, setUrls] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [handOpen, setHandOpen] = useState(true);
  const [flight, setFlight] = useState(null);
  const [returningId, setReturningId] = useState(null);
  const previewImageRef = useRef(null);
  const selectedOriginRef = useRef(null);
  const cardRefs = useRef(new Map());
  const handRef = useRef(null);
  const cardOriginRect = (photoId) => {
    const card = cardRefs.current.get(photoId);
    const hand = handRef.current;
    if (!card || !hand) return null;
    const clone = card.cloneNode(false);
    clone.className = "";
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
    setPhotos([]); setUrls({}); setSelectedId(null); setHandOpen(true); setFlight(null); setReturningId(null); setError(""); setLoading(true);
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
        if (selectedId) { setSelectedId(null); setHandOpen(true); setFlight(null); }
        else onClose();
        return;
      }
      if (!photos.length || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const index = Math.max(0, photos.findIndex((photo) => photo.id === selectedId));
      const next = (index + (event.key === "ArrowRight" ? 1 : -1) + photos.length) % photos.length;
      const nextOrigin = cardOriginRect(photos[next].id);
      if (nextOrigin) selectedOriginRef.current = nextOrigin;
      setFlight(null); setHandOpen(false);
      setSelectedId(photos[next].id);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, photos, selectedId]);

  useLayoutEffect(() => {
    const target = previewImageRef.current;
    if (!flight || !target || flight.photoId !== selectedId) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setFlight(null); return undefined; }
    const targetRect = target.getBoundingClientRect();
    if (!targetRect.width || !targetRect.height) return undefined;
    const translateX = (flight.sourceRect.left + flight.sourceRect.width / 2) - (targetRect.left + targetRect.width / 2);
    const translateY = (flight.sourceRect.top + flight.sourceRect.height / 2) - (targetRect.top + targetRect.height / 2);
    const scale = Math.min(flight.sourceRect.width / targetRect.width, flight.sourceRect.height / targetRect.height);
    const animation = target.animate([
      { borderRadius: ".72rem", filter: "brightness(1.06)", opacity: .82, transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`, transformOrigin: "center center" },
      { borderRadius: ".85rem", filter: "brightness(1)", opacity: 1, transform: "translate(0, 0) scale(1)", transformOrigin: "center center" },
    ], { duration: 560, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "both" });
    animation.onfinish = () => setFlight(null);
    return () => animation.cancel();
  }, [flight, selectedId]);

  if (!asset) return null;
  const selected = photos.find((photo) => photo.id === selectedId);
  const showAdjacentPhoto = (direction) => {
    if (!photos.length) return;
    const currentIndex = Math.max(0, photos.findIndex((photo) => photo.id === selectedId));
    const nextIndex = (currentIndex + direction + photos.length) % photos.length;
    const nextPhoto = photos[nextIndex];
    const nextOrigin = cardOriginRect(nextPhoto.id);
    if (nextOrigin) selectedOriginRef.current = nextOrigin;
    setFlight(null); setSelectedId(nextPhoto.id); setHandOpen(false);
  };
  const returnPhotoToHand = () => {
    const image = previewImageRef.current;
    const destination = selectedOriginRef.current;
    setHandOpen(true);
    setReturningId(selectedId);
    if (!image || !destination || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSelectedId(null); setHandOpen(true); setFlight(null); setReturningId(null); return;
    }
    const source = image.getBoundingClientRect();
    const translateX = (destination.left + destination.width / 2) - (source.left + source.width / 2);
    const translateY = (destination.top + destination.height / 2) - (source.top + source.height / 2);
    const scale = Math.min(destination.width / source.width, destination.height / source.height);
    const animation = image.animate([
      { filter: "brightness(1)", opacity: 1, transform: "translate(0, 0) scale(1)", transformOrigin: "center center" },
      { filter: "brightness(1.06)", opacity: 0, transform: `translate(${translateX}px, ${translateY}px) scale(${scale}) rotate(${destination.angle || "0deg"})`, transformOrigin: "center center" },
    ], { duration: 460, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "both" });
    animation.onfinish = () => { setSelectedId(null); setHandOpen(true); setFlight(null); setReturningId(null); };
  };

  return <div className="asset-photo-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <button aria-label="關閉照片選擇器" className="asset-photo-picker-close" onClick={onClose} type="button">×</button>
    <p className="asset-photo-picker-caption">{asset.name || "財物"} · {[asset.assetNo, asset.serialNo].filter(Boolean).join("-")}</p>
    {loading ? <div className="asset-photo-picker-empty asset-photo-picker-loading"><CapsuleSpinner /><strong>正在讀取現場照片</strong></div> : error ? <p className="form-error asset-photo-picker-message" role="alert">{error}</p> : !photos.length ? <div className="asset-photo-picker-empty"><strong>尚未上傳照片</strong><p>可從協作追蹤的「現場照片」新增這筆財物的照片。</p></div> : <>
      {!selected && <p className="asset-photo-picker-hint">選一張照片查看完整內容</p>}
      {selected && <figure className="asset-photo-selected" aria-live="polite" onMouseDown={(event) => event.stopPropagation()}>
        {photos.length > 1 && <button aria-label="上一張照片" className="asset-photo-nav is-previous" onClick={() => showAdjacentPhoto(-1)} type="button">‹</button>}
        {urls[selected.id] ? <button aria-label="將照片收回手牌" className="asset-photo-return" key={selected.id} onClick={returnPhotoToHand} type="button"><img alt={`${categoryLabels[selected.category] || "現況"}照片`} ref={previewImageRef} src={urls[selected.id]} /></button> : <CapsuleSpinner />}
        {photos.length > 1 && <button aria-label="下一張照片" className="asset-photo-nav is-next" onClick={() => showAdjacentPhoto(1)} type="button">›</button>}
        <figcaption>{categoryLabels[selected.category] || "現況"} · {photos.findIndex((photo) => photo.id === selected.id) + 1}／{photos.length} · 點擊照片收回</figcaption>
      </figure>}
      <div aria-label="選擇照片" className={`asset-photo-hand ${selected ? "has-selection" : ""} ${handOpen ? "is-open" : "is-collapsed"}`} onBlur={(event) => { if (selected && !event.currentTarget.contains(event.relatedTarget)) setHandOpen(false); }} onFocus={() => setHandOpen(true)} onPointerEnter={() => { if (selected) setHandOpen(true); }} onPointerLeave={() => { if (selected) setHandOpen(false); }} ref={handRef} role="list">
        {photos.map((photo, index) => {
          const offset = index - ((photos.length - 1) / 2);
          const angle = Math.max(-8, Math.min(8, offset * 1.8));
          const arc = Math.min(1.35, Math.pow(Math.abs(offset), 1.18) * .16);
          return <button aria-label={`選擇第 ${index + 1} 張${categoryLabels[photo.category] || "現況"}照片`} className={photo.id === selected?.id ? `is-selected is-dealt ${returningId === photo.id ? "is-returning" : ""}` : ""} key={photo.id} onClick={(event) => { const sourceRect = event.currentTarget.getBoundingClientRect(); selectedOriginRef.current = cardOriginRect(photo.id) || sourceRect; setFlight({ photoId: photo.id, sourceRect }); setReturningId(null); setSelectedId(photo.id); setHandOpen(false); if (event.detail > 0) event.currentTarget.blur(); }} ref={(node) => { if (node) cardRefs.current.set(photo.id, node); else cardRefs.current.delete(photo.id); }} role="listitem" style={{ "--photo-card-angle": `${angle}deg`, "--photo-card-arc": `${arc}rem`, "--photo-card-index": index }} type="button">
          {urls[photo.id] ? <img alt="" src={urls[photo.id]} /> : <span>讀取中…</span>}
          </button>;
        })}
      </div>
    </>}
  </div>;
}
