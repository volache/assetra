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
  const [sorting, setSorting] = useState(false);
  const [orderDirty, setOrderDirty] = useState(false);
  const [dragState, setDragState] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const previewImageRef = useRef(null);
  const selectedOriginRef = useRef(null);
  const cardRefs = useRef(new Map());
  const handRef = useRef(null);
  const switchGhostRef = useRef(null);
  const inputRef = useRef(null);
  const closeTimerRef = useRef(null);
  const managerTimerRef = useRef(null);
  const photosRef = useRef([]);
  const dragSessionRef = useRef(null);
  const dragGhostRef = useRef(null);
  const dragFrameRef = useRef(null);
  const dragPositionRef = useRef(null);
  const managementOrderRef = useRef([]);
  const focusFrameRef = useRef(null);
  const suppressCardClickRef = useRef(null);
  const pendingFlipRef = useRef(null);
  const flipAnimationsRef = useRef(new Map());
  const hoverFrameRef = useRef(null);
  const pointerRef = useRef(null);

  const requestClose = () => {
    if (closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    setClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 210);
  };

  const focusCard = (photoId) => {
    if (focusFrameRef.current) window.cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = window.requestAnimationFrame(() => {
        cardRefs.current.get(photoId)?.focus({ preventScroll: true });
        focusFrameRef.current = null;
      });
    });
  };

  const enterManagement = () => {
    window.clearTimeout(managerTimerRef.current);
    const initialFocusId = selectedId || photosRef.current[0]?.id;
    managementOrderRef.current = [...photosRef.current];
    setOrderDirty(false); setManagerLeaving(false); setManaging(true); setManagerSelectionId(selectedId); setPendingDelete(false); setManagerError(""); setHandOpen(true);
    if (!selectedId && initialFocusId) focusCard(initialFocusId);
  };

  const finishManagementExit = () => {
    window.clearTimeout(managerTimerRef.current);
    setManaging(false); setManagerLeaving(true); setPendingDelete(false); setManagerError("");
    managerTimerRef.current = window.setTimeout(() => { setManagerLeaving(false); setManagerSelectionId(null); }, 220);
  };
  const cancelManagement = () => {
    if (orderDirty) applyPhotoOrder(managementOrderRef.current);
    setOrderDirty(false);
    finishManagementExit();
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
    setPhotos([]); setUrls({}); setSelectedId(null); setHandOpen(true); setFlight(null); setReturningId(null); setSwitching(false); setQueuedDirection(null); setSwitchedPreviewId(null); setManaging(false); setManagerLeaving(false); setManagerSelectionId(null); setClosing(false); setUploading(false); setSorting(false); setOrderDirty(false); setDragState(null); setHoveredId(null); setManagerError(""); setPendingDelete(false); setError(""); setLoading(true);
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

  useEffect(() => { photosRef.current = photos; }, [photos]);

  useLayoutEffect(() => {
    const before = pendingFlipRef.current;
    if (!before || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { pendingFlipRef.current = null; return; }
    pendingFlipRef.current = null;
    cardRefs.current.forEach((card, photoId) => {
      if (photoId === dragSessionRef.current?.photoId) return;
      const previous = before.get(photoId);
      if (!previous) return;
      const deltaX = previous - card.offsetLeft;
      if (Math.abs(deltaX) < .5) return;
      const animation = card.animate([
        { translate: `${deltaX}px 0` },
        { translate: "0 0" },
      ], { duration: 210, easing: "cubic-bezier(.2, .82, .24, 1)" });
      flipAnimationsRef.current.set(photoId, animation);
      animation.onfinish = () => { if (flipAnimationsRef.current.get(photoId) === animation) flipAnimationsRef.current.delete(photoId); };
      animation.oncancel = animation.onfinish;
    });
  }, [photos]);

  useEffect(() => () => {
    switchGhostRef.current?.remove();
    if (dragFrameRef.current) window.cancelAnimationFrame(dragFrameRef.current);
    if (focusFrameRef.current) window.cancelAnimationFrame(focusFrameRef.current);
    if (hoverFrameRef.current) window.cancelAnimationFrame(hoverFrameRef.current);
    flipAnimationsRef.current.forEach((animation) => animation.cancel());
    flipAnimationsRef.current.clear();
    window.clearTimeout(closeTimerRef.current);
    window.clearTimeout(managerTimerRef.current);
  }, []);

  useEffect(() => {
    const move = (event) => {
      pointerRef.current = { clientX: event.clientX, clientY: event.clientY, target: event.target };
      if (hoverFrameRef.current) return;
      hoverFrameRef.current = requestAnimationFrame(() => {
        hoverFrameRef.current = null;
        if (pointerRef.current) updateHoveredCard(pointerRef.current);
      });
    };
    const leave = () => { pointerRef.current = null; resetHover(); if (selectedId) setHandOpen(false); };
    window.addEventListener("pointermove", move);
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
      if (hoverFrameRef.current) cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = null;
    };
  }, [selectedId, handOpen, photos]);

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
        else if (managing) cancelManagement();
        else requestClose();
        return;
      }
      if (selectedId && event.key === "ArrowDown") {
        event.preventDefault();
        returnPhotoToHand(true);
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
  const applyPhotoOrder = (nextPhotos) => {
    // Capture layout + the current FLIP displacement, excluding lift/rotation.
    pendingFlipRef.current = new Map(Array.from(cardRefs.current.entries()).map(([photoId, card]) => {
      const translate = parseFloat(getComputedStyle(card).translate) || 0;
      return [photoId, card.offsetLeft + translate];
    }));
    flipAnimationsRef.current.forEach((animation) => animation.cancel());
    flipAnimationsRef.current.clear();
    photosRef.current = nextPhotos;
    setPhotos(nextPhotos);
  };
  const persistPhotoOrder = async (nextPhotos, previousPhotos) => {
    if (nextPhotos.map((photo) => photo.id).join(",") === previousPhotos.map((photo) => photo.id).join(",")) return true;
    setSorting(true); setManagerError("");
    try {
      await requestAssetPhoto({ action: "reorder", identityId: asset.identityId, photoIds: nextPhotos.map((photo) => photo.id) });
      return true;
    } catch (requestError) {
      setManagerError(requestError.message || "無法儲存照片順序，請再按一次完成。");
      return false;
    } finally { setSorting(false); }
  };
  const exitManagement = async () => {
    if (sorting) return;
    if (orderDirty) {
      const saved = await persistPhotoOrder([...photosRef.current], managementOrderRef.current);
      if (!saved) return;
      managementOrderRef.current = [...photosRef.current];
      setOrderDirty(false);
    }
    finishManagementExit();
  };
  const movePhoto = (photoId, direction) => {
    if (!managing || selectedId || sorting) return;
    const previous = [...photosRef.current];
    const fromIndex = previous.findIndex((photo) => photo.id === photoId);
    const toIndex = Math.max(0, Math.min(previous.length - 1, fromIndex + direction));
    if (fromIndex < 0 || fromIndex === toIndex) return;
    const next = [...previous];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    applyPhotoOrder(next);
    setOrderDirty(true);
    focusCard(photoId);
  };
  const beginCardDrag = (event, photo) => {
    if (!managing || selectedId || uploading || sorting || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const handRect = handRef.current?.getBoundingClientRect();
    dragSessionRef.current = {
      active: false,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      originalPhotos: [...photosRef.current],
      photoId: photo.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
      slotCenters: photosRef.current.map((item) => {
        const card = cardRefs.current.get(item.id);
        return card && handRect ? handRect.left + card.offsetLeft + card.offsetWidth / 2 : null;
      }),
      targetIndex: photosRef.current.findIndex((item) => item.id === photo.id),
      originalIndex: photosRef.current.findIndex((item) => item.id === photo.id),
    };
  };
  const scheduleDragGhostPosition = (x, y) => {
    dragPositionRef.current = { x, y };
    if (dragFrameRef.current) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const position = dragPositionRef.current;
      if (!position || !dragGhostRef.current) return;
      dragGhostRef.current.style.transform = `translate3d(${position.x}px, ${position.y}px, 0) scale(1.06)`;
      reorderDragAtX(position.x);
    });
  };
  const moveCardDrag = (event) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
    if (!session.active && distance < 7) return;
    if (!session.active) {
      session.active = true;
      // Capture on a stable node, only after the movement threshold preserves clicks.
      handRef.current.setPointerCapture(event.pointerId);
      resetHover();
      cardRefs.current.get(session.photoId)?.blur();
      suppressCardClickRef.current = session.photoId;
      const x = event.clientX - session.offsetX;
      const y = event.clientY - session.offsetY;
      dragPositionRef.current = { x, y };
      setDragState({
        height: session.height,
        photoId: session.photoId,
        width: session.width,
        x,
        y,
      });
    }
    event.preventDefault();
    scheduleDragGhostPosition(event.clientX - session.offsetX, event.clientY - session.offsetY);
  };
  const reorderDragAtX = (left) => {
    const session = dragSessionRef.current;
    if (!session?.active) return;
    const availableSlots = session.slotCenters.map((center, index) => ({ center, index })).filter((slot) => slot.center !== null);
    if (!availableSlots.length) return;
    // Use the dragged centre and a dead band, so a boundary cannot oscillate.
    const centerX = session.slotCenters[session.originalIndex] + left + session.offsetX - session.startX;
    let toIndex = session.targetIndex;
    while (toIndex < session.slotCenters.length - 1 && centerX > (session.slotCenters[toIndex] + session.slotCenters[toIndex + 1]) / 2 + 10) toIndex++;
    while (toIndex > 0 && centerX < (session.slotCenters[toIndex] + session.slotCenters[toIndex - 1]) / 2 - 10) toIndex--;
    if (toIndex === session.targetIndex) return;
    session.targetIndex = toIndex;
    const current = photosRef.current;
    const fromIndex = current.findIndex((photo) => photo.id === session.photoId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const next = [...current];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    applyPhotoOrder(next);
  };
  const finishCardDrag = (event, cancelled = false) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (!cancelled && session.active) reorderDragAtX(event.clientX - session.offsetX);
    const hand = handRef.current;
    if (hand?.hasPointerCapture(event.pointerId)) hand.releasePointerCapture(event.pointerId);
    dragSessionRef.current = null;
    if (dragFrameRef.current) window.cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null;
    dragPositionRef.current = null;
    setDragState(null);
    if (!session.active) return;
    // Suppress only the click from this pointerup, never the next keyboard click.
    window.setTimeout(() => {
      if (suppressCardClickRef.current === session.photoId) suppressCardClickRef.current = null;
    }, 0);
    if (cancelled) {
      suppressCardClickRef.current = null;
      applyPhotoOrder(session.originalPhotos);
      return;
    }
    if (photosRef.current.map((photo) => photo.id).join(",") !== session.originalPhotos.map((photo) => photo.id).join(",")) setOrderDirty(true);
  };
  function resetHover() {
    setHoveredId(null);
    cardRefs.current.forEach((card) => {
      card.style.setProperty("--dock-lift", "0px");
      card.style.setProperty("--dock-scale", "1");
      card.style.removeProperty("--dock-angle");
    });
  }
  function updateHoveredCard(event) {
    if (dragSessionRef.current?.active) return;
    const hand = handRef.current;
    if (!hand) return;
    const handRect = hand.getBoundingClientRect();
    const slots = photosRef.current.map((photo) => {
      const card = cardRefs.current.get(photo.id);
      return card ? { id: photo.id, card, left: handRect.left + card.offsetLeft - hand.scrollLeft, center: handRect.left + card.offsetLeft - hand.scrollLeft + card.offsetWidth / 2 } : null;
    }).filter(Boolean);
    if (!slots.length) return;
    const first = slots[0], last = slots[slots.length - 1];
    const collapsed = selectedId && !handOpen;
    const top = collapsed ? handRect.bottom - 48 : handRect.top + first.card.offsetTop - 40;
    // Empty areas pass clicks through. Only this bounded logical hand region reacts.
    const inBounds = event.clientX >= first.left - 12 && event.clientX <= last.left + last.card.offsetWidth + 12 && event.clientY >= top && event.clientY <= handRect.bottom;
    const overControls = event.target?.closest?.(".asset-photo-manager, .asset-photo-selected, .asset-photo-picker-manage, .asset-photo-picker-close");
    if (!inBounds || overControls) { resetHover(); if (selectedId && handOpen) setHandOpen(false); return; }
    if (hand.contains(document.activeElement)) document.activeElement.blur();
    if (selectedId && !handOpen) setHandOpen(true);
    const closest = slots.reduce((best, slot) => Math.abs(slot.center - event.clientX) < Math.abs(best.center - event.clientX) ? slot : best);
    setHoveredId((current) => current === closest.id ? current : closest.id);
    slots.forEach(({ card, id }) => {
      const weight = id !== selectedId && id === closest.id ? 1 : 0;
      const arc = parseFloat(card.style.getPropertyValue("--photo-card-arc")) * parseFloat(getComputedStyle(document.documentElement).fontSize) || 0;
      card.style.setProperty("--dock-lift", `${(-34 - arc) * weight}px`);
      card.style.setProperty("--dock-scale", `${1 + .055 * weight}`);
      card.style.setProperty("--dock-angle", `${(parseFloat(card.style.getPropertyValue("--photo-card-angle")) || 0) * (1 - weight)}deg`);
    });
  }
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
  const returnPhotoToHand = (restoreFocus = false) => {
    if (switching) return;
    const returningPhotoId = selectedId;
    const image = previewImageRef.current;
    const destination = selectedOriginRef.current;
    setHandOpen(true);
    setReturningId(selectedId);
    if (!image || !destination || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSelectedId(null); setHandOpen(true); setFlight(null); setReturningId(null); setSwitchedPreviewId(null); if (restoreFocus && returningPhotoId) focusCard(returningPhotoId); return;
    }
    const source = image.getBoundingClientRect();
    const translateX = (destination.left + destination.width / 2) - (source.left + source.width / 2);
    const translateY = (destination.top + destination.height / 2) - (source.top + source.height / 2);
    const scale = Math.min(destination.width / source.width, destination.height / source.height);
    const animation = image.animate([
      { filter: "brightness(1)", opacity: 1, transform: "translate(0, 0) scale(1)", transformOrigin: "center center" },
      { filter: "brightness(1.06)", opacity: 0, transform: `translate(${translateX}px, ${translateY}px) scale(${scale}) rotate(${destination.angle || "0deg"})`, transformOrigin: "center center" },
    ], { duration: 460, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "both" });
    animation.onfinish = () => { setSelectedId(null); setHandOpen(true); setFlight(null); setReturningId(null); setSwitchedPreviewId(null); if (restoreFocus && returningPhotoId) focusCard(returningPhotoId); };
  };

  return <div className={`asset-photo-picker-backdrop ${managing ? "is-managing" : ""} ${closing ? "is-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget && !managing) requestClose(); }}>
    <button aria-label="關閉照片選擇器" className="asset-photo-picker-close" onClick={requestClose} type="button">×</button>
    <button aria-pressed={managing} className={`asset-photo-picker-manage ${managing ? "is-active" : ""}`} disabled={sorting} onClick={managing ? exitManagement : enterManagement} type="button"><PhotoManagerIcon /><span className="asset-photo-manage-label" key={managing ? "done" : "manage"}>{sorting ? "儲存中…" : managing ? orderDirty ? "完成並儲存" : "完成" : "管理照片"}</span></button>
    <p className="asset-photo-picker-caption">{asset.name || "財物"} · {[asset.assetNo, asset.serialNo].filter(Boolean).join("-")}</p>
    {(managing || managerLeaving) && <section aria-label="照片管理工具" className={`asset-photo-manager ${managerLeaving ? "is-leaving" : ""} ${selected ? "is-photo-context" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
      <div className="asset-photo-manager-summary"><strong>{selected ? "目前照片" : "管理照片"}</strong><span>{selected ? `${photos.findIndex((photo) => photo.id === selected.id) + 1}／${photos.length}` : `${photos.length}／${maxPhotos}`}</span></div>
      {selected ? <div className="asset-photo-current-details">
        <span>{categoryLabels[selected.category] || "現況"}</span>
        <strong title={selected.original_filename}>{selected.original_filename || "現場照片"}</strong>
        <p>點擊照片可收回手牌；刪除只會移除這張照片。</p>
      </div> : <>
        <div className={`asset-photo-order-help ${orderDirty ? "has-changes" : ""}`}>{sorting ? <><CapsuleSpinner compact />正在儲存順序…</> : orderDirty ? "順序尚未儲存，按「完成並儲存」套用" : "已聚焦手牌：Alt + ←／→ 排序，↑ 展開，照片展開後按 ↓ 收回"}</div>
        <span className="asset-photo-manager-label">新照片類型</span>
        <div aria-label="新照片類型" className="asset-photo-category-pills" role="group">{Object.entries(categoryLabels).map(([value, label]) => <button aria-pressed={category === value} className={category === value ? "is-active" : ""} disabled={uploading || sorting} key={value} onClick={() => setCategory(value)} type="button">{label}</button>)}</div>
      </>}
      <div className="asset-photo-manager-actions">
        {!selected && <button className="asset-photo-manager-primary" disabled={uploading || sorting || photos.length >= maxPhotos} onClick={() => inputRef.current?.click()} type="button">{uploading ? <CapsuleSpinner compact /> : <UploadIcon />}{uploading ? "處理中…" : "新增照片"}</button>}
        {(selected || managerSelectionId) && !pendingDelete && <button className="asset-photo-manager-danger" disabled={uploading || sorting} onClick={() => setPendingDelete(true)} type="button"><TrashIcon />刪除此張</button>}
        {pendingDelete && <div className="asset-photo-manager-confirm"><span>確定刪除此張？</span><button disabled={uploading || sorting} onClick={() => setPendingDelete(false)} type="button">取消</button><button disabled={uploading || sorting} onClick={deleteSelectedPhoto} type="button">刪除</button></div>}
      </div>
      <input accept="image/jpeg,image/png,image/webp" hidden multiple onChange={uploadPhotos} ref={inputRef} type="file" />
      {managerError && <p className="is-error" role="alert">{managerError}</p>}
    </section>}
    {loading ? <div className="asset-photo-picker-empty asset-photo-picker-loading"><CapsuleSpinner /><strong>正在讀取現場照片</strong></div> : error ? <p className="form-error asset-photo-picker-message" role="alert">{error}</p> : !photos.length ? <div className="asset-photo-picker-empty"><strong>尚未上傳照片</strong><p>{managing ? "請從上方選擇照片類型，再新增第一張照片。" : "按「管理照片」即可直接在這裡新增。"}</p>{!managing && <button className="asset-photo-empty-action" onClick={enterManagement} type="button"><UploadIcon />新增照片</button>}</div> : <>
      {!selected && <p className="asset-photo-picker-hint">選一張照片查看完整內容</p>}
      {selected && <figure className="asset-photo-selected" aria-live="polite" onMouseDown={(event) => event.stopPropagation()}>
        {photos.length > 1 && <button aria-label="上一張照片" className="asset-photo-nav is-previous" onClick={() => showAdjacentPhoto(-1)} type="button">‹</button>}
        {urls[selected.id] ? <button aria-label="將照片收回手牌" className={`asset-photo-return ${switchedPreviewId === selected.id ? "is-switch-target" : ""}`} key={selected.id} onClick={() => returnPhotoToHand(false)} type="button"><img alt={`${categoryLabels[selected.category] || "現況"}照片`} ref={previewImageRef} src={urls[selected.id]} /></button> : <CapsuleSpinner />}
        {photos.length > 1 && <button aria-label="下一張照片" className="asset-photo-nav is-next" onClick={() => showAdjacentPhoto(1)} type="button">›</button>}
        <figcaption>{categoryLabels[selected.category] || "現況"} · {photos.findIndex((photo) => photo.id === selected.id) + 1}／{photos.length} · 點擊照片收回</figcaption>
      </figure>}
      <div aria-label="選擇照片" className={`asset-photo-hand ${dragState ? "is-sorting-hand" : ""} ${selected ? "has-selection" : ""} ${handOpen ? "is-open" : "is-collapsed"}`} onBlur={(event) => { if (selected && !event.currentTarget.contains(event.relatedTarget)) setHandOpen(false); }} onFocus={() => setHandOpen(true)} onPointerMove={moveCardDrag} onPointerUp={finishCardDrag} onPointerCancel={(event) => finishCardDrag(event, true)} ref={handRef} role="list">
        {photos.map((photo, index) => {
          const offset = index - ((photos.length - 1) / 2);
          const angle = Math.max(-8, Math.min(8, offset * 1.8));
          const arc = Math.min(1.35, Math.pow(Math.abs(offset), 1.18) * .16);
          const selectedClass = photo.id === selected?.id ? `is-selected is-dealt ${returningId === photo.id ? "is-returning" : ""}` : photo.id === managerSelectionId && managing ? "is-manager-selected" : "";
          const cardClass = `${selectedClass} ${hoveredId === photo.id ? "is-hovered" : ""} ${dragState?.photoId === photo.id ? "is-dragging-origin" : ""}`.trim();
          return <button aria-label={`選擇第 ${index + 1} 張${categoryLabels[photo.category] || "現況"}照片${managing && !selected ? "；可拖曳排序，Alt 加左右方向鍵移動，上方向鍵展開" : ""}`} className={cardClass} data-photo-card-id={photo.id} key={photo.id} onClick={(event) => { resetHover(); if (suppressCardClickRef.current === photo.id) { suppressCardClickRef.current = null; event.preventDefault(); return; } const sourceRect = event.currentTarget.getBoundingClientRect(); selectedOriginRef.current = cardOriginRect(photo.id) || sourceRect; setFlight({ photoId: photo.id, sourceRect }); setReturningId(null); setSwitchedPreviewId(null); setManagerSelectionId(managing ? photo.id : null); setSelectedId(photo.id); setHandOpen(false); if (event.detail > 0) event.currentTarget.blur(); }} onKeyDown={(event) => { if (!managing || selected) return; if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); movePhoto(photo.id, event.key === "ArrowRight" ? 1 : -1); } else if (event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); event.currentTarget.click(); } }} onPointerDown={(event) => beginCardDrag(event, photo)} ref={(node) => { if (node) cardRefs.current.set(photo.id, node); else cardRefs.current.delete(photo.id); }} role="listitem" style={{ "--photo-card-angle": `${angle}deg`, "--photo-card-arc": `${arc}rem`, "--photo-card-index": index }} type="button">
          {urls[photo.id] ? <img alt="" decoding="async" draggable="false" loading="eager" src={urls[photo.id]} /> : <span>讀取中…</span>}
          </button>;
        })}
      </div>
      {dragState && <div aria-hidden="true" className="asset-photo-drag-ghost" ref={dragGhostRef} style={{ height: dragState.height, transform: `translate3d(${dragState.x}px, ${dragState.y}px, 0) scale(1.06)`, width: dragState.width }}><img alt="" decoding="async" draggable="false" src={urls[dragState.photoId]} /></div>}
    </>}
  </div>;
}
