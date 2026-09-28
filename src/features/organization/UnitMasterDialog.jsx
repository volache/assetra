import React, { useEffect, useState } from "react";
import { FormCombo } from "../../components/Comboboxes";

export function UnitMasterDialog({ error, profiles, units, onClose, onSave }) {
  const [selectedCode, setSelectedCode] = useState(units[0]?.code || "");
  const [draft, setDraft] = useState({ name: "", parentCode: "" });
  const [openCombo, setOpenCombo] = useState(null);
  const selected = units.find((unit) => unit.code === selectedCode);
  useEffect(() => {
    if (!selected) return;
    const profile = profiles[selected.code] || {};
    setDraft({
      name: profile.name || selected.rawName,
      parentCode: profile.parentCode ?? selected.defaultParentCode ?? "",
    });
    setOpenCombo(null);
  }, [selectedCode]);
  if (!selected) return null;
  const unitOptions = units.map((unit) => ({
    value: unit.code,
    label: `${unit.code}／${unit.name}`,
  }));
  const parentOptions = [
    { value: "", label: "花蓮航空站" },
    ...units
      .filter((unit) => unit.code !== selected.code)
      .map((unit) => ({
        value: unit.code,
        label: `${unit.code}／${unit.name}`,
      })),
  ];
  function submit(event) {
    event.preventDefault();
    onSave(selected.code, draft);
  }
  return (
    <dialog
      className="detail-dialog user-editor unit-master-editor"
      open
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div>
        <header>
          <div>
            <p className="eyebrow">UNIT DIRECTORY</p>
            <h2>編輯單位</h2>
          </div>
          <button
            aria-label="關閉"
            className="close-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <form className="account-form user-account-form" onSubmit={submit}>
          <div className="user-form-grid user-editor-grid">
            <FormCombo
              id="unit-master-unit"
              label="選擇單位"
              onChange={setSelectedCode}
              onOpenChange={setOpenCombo}
              open={openCombo === "unit-master-unit"}
              options={unitOptions}
              value={selected.code}
            />
            <FormCombo
              id="unit-master-parent"
              label="上級單位"
              onChange={(parentCode) =>
                setDraft((current) => ({ ...current, parentCode }))
              }
              onOpenChange={setOpenCombo}
              open={openCombo === "unit-master-parent"}
              options={parentOptions}
              value={draft.parentCode}
            />
            <label>
              單位名稱
              <input
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                value={draft.name}
              />
            </label>
            <label>
              單位代碼
              <input readOnly value={selected.code} />
            </label>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="user-editor-actions">
            <button
              className="button button-secondary"
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button className="button button-primary" type="submit">
              儲存變更
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
