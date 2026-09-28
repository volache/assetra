import React, { useEffect, useState } from "react";
import { CollaborationNotebook } from "../inventory/CollaborationNotebook";

export function CollaborationDrawer({ asset, focusCollaborationId, onClose, onChanged }) {
  const [isClosing, setIsClosing] = useState(false);
  useEffect(() => setIsClosing(false), [asset?.identityId]);
  if (!asset?.identityId) return null;
  const title = [asset.assetNo, asset.serialNo].filter(Boolean).join("-");
  return (
    <div
      className={`collaboration-drawer-backdrop ${isClosing ? "is-closing" : ""}`}
      role="presentation"
    >
      <aside
        aria-label="協作追蹤"
        aria-modal="true"
        className="collaboration-drawer"
        onAnimationEnd={(event) => {
          if (isClosing && event.target === event.currentTarget) onClose();
        }}
        role="dialog"
      >
        <header className="collaboration-drawer-header">
          <div>
            <p className="eyebrow">協作追蹤</p>
            <h2>{asset.name || "財物協作追蹤"}</h2>
            <p>{title || "此財物"}</p>
          </div>
          <button
            className="button button-secondary collaboration-drawer-close"
            onClick={() => {
              if (isClosing) return;
              setIsClosing(true);
            }}
            type="button"
          >
            關閉
          </button>
        </header>
        <CollaborationNotebook
          autoLoad
          focusCollaborationId={focusCollaborationId}
          identityId={asset.identityId}
          onChanged={onChanged}
        />
      </aside>
    </div>
  );
}
