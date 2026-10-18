import { FormCombo } from "../../components/Comboboxes";
import { CapsuleSpinner } from "../../components/FeedbackCenter";
import { roleDescriptions, roleLabels } from "../../lib/labels";

// Dialog for creating or editing one user account.
export function UserEditorDialog({
  form,
  setForm,
  editingId,
  message,
  isSaving,
  accountOptions,
  editorUnitOptions,
  editorStatusOptions,
  openEditorCombo,
  onCustodianChange,
  onOpenComboChange,
  onToggleRole,
  onSubmit,
  onClose,
}) {
  return (
    <dialog
      open
      className="detail-dialog user-editor"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div>
        <header>
          <div>
            <p className="eyebrow">{editingId ? "EDIT USER" : "CREATE USER"}</p>
            <h2>{editingId ? "編輯使用者" : "新增使用者"}</h2>
          </div>
          <button className="close-button" onClick={() => onClose()} aria-label="關閉">
            ×
          </button>
        </header>
        <form className="account-form user-account-form" onSubmit={onSubmit}>
          <div className="user-form-grid user-editor-grid">
            <label>
              帳號
              <input
                value={form.accountCode}
                readOnly={Boolean(editingId)}
                onChange={(event) => setForm({ ...form, accountCode: event.target.value })}
              />
            </label>
            <label>
              {editingId ? "修改密碼" : "初始密碼"}
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            </label>
            <label>
              姓名
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <FormCombo
              id="editor-custodian"
              label="配對保管人（選填）"
              value={form.custodianCode}
              options={accountOptions}
              open={openEditorCombo === "editor-custodian"}
              onChange={onCustodianChange}
              onOpenChange={onOpenComboChange}
            />
            <FormCombo
              id="editor-unit"
              label="所屬單位"
              value={form.unitCode}
              options={editorUnitOptions}
              open={openEditorCombo === "editor-unit"}
              onChange={(value) => setForm({ ...form, unitCode: value })}
              onOpenChange={onOpenComboChange}
            />
            <label>
              職稱
              <input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              Email（選填）
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>
            <FormCombo
              id="editor-status"
              label="狀態"
              value={form.status}
              options={editorStatusOptions}
              open={openEditorCombo === "editor-status"}
              onChange={(value) => setForm({ ...form, status: value })}
              onOpenChange={onOpenComboChange}
            />
          </div>
          <fieldset>
            <legend>權限</legend>
            <div className="role-checks">
              {Object.entries(roleLabels).map(([role, label]) => (
                <label key={role}>
                  <input
                    type="checkbox"
                    checked={form.roles.includes(role)}
                    onChange={() => onToggleRole(role)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="role-guidance" aria-label="權限說明">
            {Object.entries(roleDescriptions).map(([role, description]) => (
              <p key={role}>
                <strong>{roleLabels[role]}</strong>
                <span>{description}</span>
              </p>
            ))}
          </div>
          {message && (
            <p className="form-error" role="alert">
              {message}
            </p>
          )}
          <footer className="user-editor-actions">
            <button className="button button-secondary" onClick={() => onClose()} type="button">
              取消
            </button>
            <button className="button button-primary" disabled={isSaving} type="submit">
              {isSaving && <CapsuleSpinner compact />}
              {isSaving ? "儲存中…" : editingId ? "儲存變更" : "新增使用者"}
            </button>
          </footer>
        </form>
      </div>
    </dialog>
  );
}
