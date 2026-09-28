import React, { useEffect, useState } from "react";
import { CollaborationNotes } from "../inventory/CollaborationNotes";

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
        aria-label="共同筆記"
        aria-modal="true"
        className="collaboration-drawer"
        onAnimationEnd={(event) => {
          if (isClosing && event.target === event.currentTarget) onClose();
        }}
        role="dialog"
      >
        <header className="collaboration-drawer-header">
          <div>
            <p className="eyebrow">共同筆記</p>
            <h2>{asset.name || "財物共同筆記"}</h2>
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
        <CollaborationNotes
          autoLoad
          focusCollaborationId={focusCollaborationId}
          identityId={asset.identityId}
          onChanged={onChanged}
        />
      </aside>
    </div>
  );
}
