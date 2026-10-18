import React, { useEffect, useRef, useState } from "react";
import { CollaborationNotebook } from "./CollaborationNotebook";

function WindowIcon({ name }) {
  const paths = {
    dockLeft: <><path d="M5 4v16" /><path d="M19 12H9" /><path d="m13 8-4 4 4 4" /></>,
    dockRight: <><path d="M19 4v16" /><path d="M5 12h10" /><path d="m11 8 4 4-4 4" /></>,
    minimize: <path d="m6 9 6 6 6-6" />,
    expand: <path d="m6 15 6-6 6 6" />,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  };
  return <svg aria-hidden="true" className="collaboration-window-icon" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24">{paths[name]}</svg>;
}

export function CollaborationDrawer({ asset, focusCollaborationId, onClose, onChanged }) {
  const drawerRef = useRef(null);
  const notebookRef = useRef(null);
  const restoreComposer = useRef(false);
  const windowTimer = useRef(null);
  const [windowTransitioning, setWindowTransitioning] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [dock, setDock] = useState("right");
  const [drag, setDrag] = useState(null);
  const [isReleasing, setIsReleasing] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [composerState, setComposerState] = useState({ open: false, closing: false });
  useEffect(() => { window.clearTimeout(windowTimer.current); restoreComposer.current = false; setWindowTransitioning(false); setIsClosing(false); setMinimized(false); setComposerState({ open: false, closing: false }); }, [asset?.identityId]);
  useEffect(() => () => window.clearTimeout(windowTimer.current), []);
  const toggleMinimized = () => {
    if (windowTransitioning || composerState.closing) return;
    setWindowTransitioning(true);
    if (minimized) {
      setMinimized(false);
      windowTimer.current = window.setTimeout(() => {
        if (restoreComposer.current) notebookRef.current?.restore();
        restoreComposer.current = false;
        setWindowTransitioning(false);
      }, 130);
    } else {
      restoreComposer.current = composerState.open;
      const minimize = () => {
        setMinimized(true);
        windowTimer.current = window.setTimeout(() => setWindowTransitioning(false), 130);
      };
      if (composerState.open) notebookRef.current?.collapse(minimize);
      else minimize();
    }
  };
  if (!asset?.identityId) return null;
  const title = [asset.assetNo, asset.serialNo].filter(Boolean).join("-");
  const startDrag = (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    const rect = drawerRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ left: rect.left, top: rect.top, startX: event.clientX, startY: event.clientY, moved: false, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top });
  };
  const moveDrag = (event) => {
    if (!drag || !drawerRef.current) return;
    const rect = drawerRef.current.getBoundingClientRect();
    setDrag((current) => current && ({ ...current, moved: current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 4, left: Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX - current.offsetX)), top: Math.max(8, Math.min(window.innerHeight - rect.height - 8, event.clientY - current.offsetY)) }));
  };
  const finishDrag = (event) => {
    if (!drag) return;
    const rect = drawerRef.current?.getBoundingClientRect();
    if (rect && drag.moved) {
      const nextDock = rect.left + rect.width / 2 < window.innerWidth / 2 ? "left" : "right";
      const targetLeft = nextDock === "left" ? 16 : window.innerWidth - drawerRef.current.offsetWidth - 16;
      const targetTop = window.innerHeight - drawerRef.current.offsetHeight - 16;
      drawerRef.current.animate([{ transform: `translate(${rect.left - targetLeft}px, ${rect.top - targetTop}px) scale(.985)` }, { transform: "translate(0, 0) scale(1)" }], { duration: 320, easing: "cubic-bezier(.16, 1, .3, 1)" });
      setDock(nextDock);
    }
    if (rect && !drag.moved) { setIsReleasing(true); window.setTimeout(() => setIsReleasing(false), 180); }
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const moveDock = (nextDock) => {
    if (nextDock === dock || !drawerRef.current) return;
    const rect = drawerRef.current.getBoundingClientRect();
    const distance = Math.max(0, window.innerWidth - rect.width - 32);
    setDock(nextDock);
    window.requestAnimationFrame(() => drawerRef.current?.animate([{ transform: `translateX(${nextDock === "right" ? -distance : distance}px)` }, { transform: "translateX(0)" }], { duration: 260, easing: "cubic-bezier(.16, 1, .3, 1)" }));
  };
  return (
    <div
      className={`collaboration-drawer-backdrop ${isClosing ? "is-closing" : ""}`}
      role="presentation"
    >
      <aside
        aria-label="協作追蹤"
        className={`collaboration-drawer is-dock-${dock} ${drag ? "is-dragging" : ""} ${isReleasing ? "is-releasing" : ""} ${minimized ? "is-minimized" : ""} ${composerState.open ? "is-composing" : ""} ${composerState.closing ? "is-composer-closing" : ""}`}
        onAnimationEnd={(event) => {
          if (isClosing && event.target === event.currentTarget) onClose();
        }}
        ref={drawerRef}
        role="dialog"
        style={drag ? { left: `${drag.left}px`, top: `${drag.top}px` } : undefined}
      >
        <header className="collaboration-drawer-header" onPointerCancel={finishDrag} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag}>
          <div className="collaboration-drawer-title"><div><p className="eyebrow">協作追蹤</p><h2>{asset.name || "財物協作追蹤"}</h2><p>{title || "此財物"}</p></div></div>
          <div className="collaboration-drawer-controls">
            <button aria-label={dock === "right" ? "移至左側" : "移至右側"} onClick={() => moveDock(dock === "right" ? "left" : "right")} title={dock === "right" ? "移至左側" : "移至右側"} type="button"><WindowIcon name={dock === "right" ? "dockLeft" : "dockRight"} /></button>
            <button aria-expanded={!minimized} aria-label={minimized ? "展開協作追蹤" : "縮小協作追蹤"} disabled={windowTransitioning || composerState.closing} onClick={toggleMinimized} title={minimized ? "展開" : "縮小"} type="button"><WindowIcon name={minimized ? "expand" : "minimize"} /></button>
            <button aria-label="關閉協作追蹤" onClick={() => { if (!isClosing) setIsClosing(true); }} title="關閉" type="button"><WindowIcon name="close" /></button>
          </div>
        </header>
        <CollaborationNotebook
          ref={notebookRef}
          autoLoad
          focusCollaborationId={focusCollaborationId}
          identityId={asset.identityId}
          onChanged={onChanged}
          onComposerChange={setComposerState}
        />
      </aside>
    </div>
  );
}
