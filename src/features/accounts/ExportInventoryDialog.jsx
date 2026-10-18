import { FormCombo } from "../../components/Comboboxes";
import { CapsuleSpinner } from "../../components/FeedbackCenter";

// Dialog for exporting inventory sheets: one custodian, or everyone as a zip.
export function ExportInventoryDialog({
  exportState,
  exportUnit,
  exportUnitOptions,
  exportSelected,
  exportPersonOptions,
  exportPeople,
  openEditorCombo,
  onUnitChange,
  onPersonChange,
  onOpenComboChange,
  onExport,
  onClose,
}) {
  return (
    <dialog
      open
      className="detail-dialog user-editor export-sheets-dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget && !exportState) onClose();
      }}
    >
      <div>
        <header>
          <div>
            <p className="eyebrow">INVENTORY SHEETS</p>
            <h2>匯出盤點清冊</h2>
          </div>
          <button
            className="close-button"
            disabled={Boolean(exportState)}
            onClick={() => onClose()}
            aria-label="關閉"
          >
            ×
          </button>
        </header>
        <div className="account-form user-account-form">
          <p className="export-note">
            依清冊上的保管人產生財物盤點清冊（僅「使用中」財物），每位保管人一份，財產與物品併為不同的財產大類。
            未建立使用者帳號的保管人也會一併匯出。
          </p>
          <div className="user-form-grid user-editor-grid">
            <FormCombo
              id="export-unit"
              label="保管單位"
              value={exportUnit}
              options={exportUnitOptions}
              open={openEditorCombo === "export-unit"}
              onChange={onUnitChange}
              onOpenChange={onOpenComboChange}
            />
            <FormCombo
              id="export-person"
              label="保管人"
              value={exportSelected}
              options={exportPersonOptions}
              open={openEditorCombo === "export-person"}
              onChange={onPersonChange}
              onOpenChange={onOpenComboChange}
            />
          </div>
          <footer className="user-editor-actions">
            <button
              className="button button-secondary"
              disabled={Boolean(exportState)}
              onClick={() => onClose()}
              type="button"
            >
              取消
            </button>
            <button
              className="button button-primary"
              disabled={!exportPeople.length || Boolean(exportState)}
              onClick={onExport}
              type="button"
            >
              {exportState && <CapsuleSpinner compact />}
              {exportState
                ? `產生中 ${exportState.label}`
                : exportSelected
                  ? "匯出盤點清冊（PDF）"
                  : `打包匯出（${exportPeople.length} 位保管人）`}
            </button>
          </footer>
        </div>
      </div>
    </dialog>
  );
}
