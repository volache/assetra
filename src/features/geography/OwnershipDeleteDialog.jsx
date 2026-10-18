export function OwnershipDeleteDialog({ document, onCancel, onConfirm }) {
  if (!document) return null;
  return (
    <dialog aria-labelledby="ownership-delete-title" className="detail-dialog batch-delete-dialog ownership-delete-dialog" onCancel={(event) => { event.preventDefault(); onCancel(); }} open>
      <div>
        <header><h2 id="ownership-delete-title">刪除權狀文件？</h2></header>
        <p>將刪除「{document.original_filename}」及其 R2 私有檔案。</p>
        <p className="batch-delete-warning">此操作無法復原。</p>
        <footer className="batch-delete-actions">
          <button className="button button-secondary" onClick={onCancel} type="button">取消</button>
          <button className="button button-danger" onClick={onConfirm} type="button">確認刪除</button>
        </footer>
      </div>
    </dialog>
  );
}
