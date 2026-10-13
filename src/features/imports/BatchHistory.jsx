import React, { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { rocDate, rocDateTime } from "../../lib/formatters";
import { sourceLabels } from "../../lib/labels";
import { CapsuleSpinner } from "../../components/FeedbackCenter";

export function BatchHistory({ imports, onDeleted }) {
  const [selected, setSelected] = useState(null);
  const [changes, setChanges] = useState([]);
  const [kind, setKind] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [expandedKey, setExpandedKey] = useState(null);

  useEffect(() => {
    if (selected && !imports.some((entry) => entry.id === selected.id)) {
      setSelected(null);
      setChanges([]);
      setExpandedKey(null);
    }
  }, [imports, selected]);

  useEffect(() => {
    if (!selected) return undefined;
    let alive = true;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const all = [];
        for (let from = 0; ; from += 1000) {
          const { data, error: queryError } = await supabase
            .from("import_batch_changes")
            .select(
              "change_kind, category_type_code, asset_no, serial_no, asset_name, before_record, after_record",
            )
            .eq("import_id", selected.id)
            .order("change_kind")
            .order("asset_no")
            .order("serial_no")
            .range(from, from + 999);
          if (queryError) throw queryError;
          all.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
        if (alive) setChanges(all);
      } catch (queryError) {
        if (alive) setError(queryError.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected]);

  const latestBySource = useMemo(
    () =>
      Object.fromEntries(
        ["asset", "item"].map((sourceType) => [
          sourceType,
          imports.find((entry) => entry.sourceType === sourceType)?.id || null,
        ]),
      ),
    [imports],
  );
  const fieldLabels = {
    name: "中文名稱",
    old_no: "舊編號",
    acquired_at: "購置日期",
    unit_code: "保管單位代碼",
    unit_name: "保管單位",
    use_unit_code: "使用單位代碼",
    use_unit_name: "使用單位",
    location_code: "存置地點代碼",
    location_name: "存置地點",
    custodian_code: "保管人代碼",
    custodian_name: "保管人",
    user_code: "使用人代碼",
    user_name: "使用人",
    quantity: "數量",
    measure_unit: "計量單位",
    original_value: "原值",
    depreciation: "累折",
    net_value: "淨值",
    useful_life: "年限",
    category_name: "財產別名",
    category_type: "區分別",
    model: "型式",
    brand: "廠牌",
    notes: "備註",
    status: "使用現況",
  };
  const annotated = changes.map((change) => {
    if (change.change_kind !== "changed") return change;
    const differences = Object.keys(fieldLabels)
      .filter(
        (key) =>
          String(change.before_record?.[key] ?? "") !==
          String(change.after_record?.[key] ?? ""),
      )
      .map((key) => ({
        label: fieldLabels[key],
        before:
          key === "acquired_at"
            ? rocDate(change.before_record?.[key])
            : (change.before_record?.[key] ?? "—"),
        after:
          key === "acquired_at"
            ? rocDate(change.after_record?.[key])
            : (change.after_record?.[key] ?? "—"),
      }));
    return { ...change, differences };
  });
  const filtered =
    kind === "all"
      ? annotated
      : annotated.filter((change) => change.change_kind === kind);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const selectBatch = (entry) => {
    setSelected(entry);
    setKind("all");
    setPage(1);
    setExpandedKey(null);
    setMessage("");
  };
  const selectKind = (value) => {
    setKind(value);
    setPage(1);
    setExpandedKey(null);
  };
  const statusLabel = (value) =>
    ({ added: "新增", changed: "更新", unchanged: "未變更" })[value] || "—";
  const rowKey = (change, index) =>
    `${change.category_type_code}-${change.asset_no}-${change.serial_no}-${index}`;
  const isLatest =
    selected && latestBySource[selected.sourceType] === selected.id;

  function confirmBatchDeletion(fileName) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      const content = document.createElement("div");
      const header = document.createElement("header");
      const title = document.createElement("h2");
      const description = document.createElement("p");
      const warning = document.createElement("p");
      const actions = document.createElement("footer");
      const cancel = document.createElement("button");
      const confirm = document.createElement("button");

      dialog.className = "detail-dialog batch-delete-dialog";
      dialog.setAttribute("aria-labelledby", "batch-delete-title");
      title.id = "batch-delete-title";
      title.textContent = "刪除此匯入批次？";
      description.textContent = `將永久移除「${fileName}」的快照與差異資料。`;
      warning.className = "batch-delete-warning";
      warning.textContent = "此操作無法復原。";
      actions.className = "batch-delete-actions";
      cancel.className = "button button-secondary";
      cancel.type = "button";
      cancel.textContent = "取消";
      confirm.className = "button button-danger";
      confirm.type = "button";
      confirm.textContent = "確認刪除";
      header.append(title);
      actions.append(cancel, confirm);
      content.append(header, description, warning, actions);
      dialog.append(content);
      document.body.append(dialog);

      const finish = (approved) => {
        dialog.remove();
        resolve(approved);
      };
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        dialog.close("cancel");
      });
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close("cancel");
      });
      dialog.addEventListener(
        "close",
        () => finish(dialog.returnValue === "confirm"),
        { once: true },
      );
      cancel.addEventListener("click", () => dialog.close("cancel"));
      confirm.addEventListener("click", () => dialog.close("confirm"));
      dialog.showModal();
    });
  }

  async function deleteSelected() {
    if (!selected || isLatest || deletingId) return;
    if (!(await confirmBatchDeletion(selected.fileName))) return;
    setDeletingId(selected.id);
    setMessage("");
    try {
      const { data, error: deleteError } = await supabase.functions.invoke(
        "import-inventory",
        { body: { mode: "delete", importId: selected.id } },
      );
      if (deleteError) {
        const detail = await deleteError.context?.json().catch(() => null);
        throw new Error(detail?.error || deleteError.message);
      }
      if (data?.error) throw new Error(data.error);
      const snapshots = Number(data?.deleted?.deletedSnapshots || 0);
      const changesCount = Number(data?.deleted?.deletedChanges || 0);
      setSelected(null);
      setChanges([]);
      setMessage(
        `已刪除匯入批次，以及 ${snapshots.toLocaleString()} 筆快照與 ${changesCount.toLocaleString()} 筆差異資料。`,
      );
      await onDeleted();
    } catch (deleteError) {
      setMessage(
        deleteError instanceof Error
          ? deleteError.message
          : "無法刪除匯入批次。",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">IMPORT BATCHES</p>
          <h1>匯入批次</h1>
          <p>
            每類清冊會自動保留最近 10 筆成功匯入；系統管理者可清除非最新批次。
          </p>
        </div>
      </div>
      {message && (
        <p
          className={message.startsWith("已") ? "form-success" : "form-error"}
          role="status"
        >
          {message}
        </p>
      )}
      <section className="batch-layout">
        <div className="batch-list">
          {imports.length ? (
            imports.map((entry) => (
              <button
                className={`batch-item ${selected?.id === entry.id ? "active" : ""}`}
                key={entry.id}
                onClick={() => selectBatch(entry)}
                type="button"
              >
                <span className={`source-tag ${entry.sourceType}`}>
                  {sourceLabels[entry.sourceType]}
                </span>
                <strong>{entry.fileName}</strong>
                <small>
                  {entry.at} · {entry.count.toLocaleString()} 筆
                </small>
                <em>
                  新增 {entry.summary?.added ?? "—"}／更新{" "}
                  {entry.summary?.changed ?? "—"}／未變更{" "}
                  {entry.summary?.unchanged ?? "—"}
                </em>
              </button>
            ))
          ) : (
            <p className="muted">尚無已完成的匯入批次。</p>
          )}
        </div>
        <section className="batch-detail">
          {selected ? (
            <>
              <header>
                <div>
                  <p className="eyebrow">BATCH DETAIL</p>
                  <h2>{selected.fileName}</h2>
                  <p className="muted">{selected.at}</p>
                </div>
                {!isLatest && (
                  <button
                    className="button button-secondary"
                    disabled={Boolean(deletingId)}
                    onClick={deleteSelected}
                    type="button"
                  >
                    {deletingId === selected.id && <CapsuleSpinner compact />}
                    {deletingId === selected.id ? "正在刪除…" : "刪除此批次"}
                  </button>
                )}
              </header>
              {isLatest && (
                <p className="helper">這是此類清冊最新的成功批次，不能刪除。</p>
              )}
              <div className="preview-summary">
                <p>
                  新增<strong>{selected.summary?.added ?? "—"}</strong>
                </p>
                <p>
                  更新<strong>{selected.summary?.changed ?? "—"}</strong>
                </p>
                <p>
                  未變更<strong>{selected.summary?.unchanged ?? "—"}</strong>
                </p>
              </div>
              <div className="segmented batch-filter">
                {[
                  ["all", "全部"],
                  ["added", "新增"],
                  ["changed", "更新"],
                  ["unchanged", "未變更"],
                ].map(([value, label]) => (
                  <label key={value}>
                    <input
                      checked={kind === value}
                      onChange={() => selectKind(value)}
                      type="radio"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              {loading ? (
                <p className="muted">正在載入逐筆差異…</p>
              ) : error ? (
                <p className="form-error">{error}</p>
              ) : changes.length ? (
                <>
                  <div className="result-summary">
                    <p className="result-count">
                      查詢結果：
                      <strong>{filtered.length.toLocaleString()}</strong> 筆
                    </p>
                    <label className="page-size">
                      每頁
                      <select
                        value={pageSize}
                        onChange={(event) => {
                          setPageSize(Number(event.target.value));
                          setPage(1);
                          setExpandedKey(null);
                        }}
                      >
                        <option value="25">25 筆</option>
                        <option value="50">50 筆</option>
                        <option value="100">100 筆</option>
                      </select>
                    </label>
                    <p>
                      第 {currentPage}／{totalPages} 頁
                    </p>
                  </div>
                  <div className="asset-table-wrap">
                    <table className="batch-change-table">
                      <thead>
                        <tr>
                          <th>狀態</th>
                          <th>財產編號</th>
                          <th>摘要</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.length ? (
                          pageRows.map((change, index) => {
                            const key = rowKey(change, index);
                            const isExpanded = expandedKey === key;
                            const count = change.differences?.length ?? 0;
                            return (
                              <Fragment key={key}>
                                <tr>
                                  <td>{statusLabel(change.change_kind)}</td>
                                  <td className="mono">
                                    <strong>{change.asset_no}</strong>
                                    <small>{change.serial_no}</small>
                                  </td>
                                  <td>
                                    <strong>{change.asset_name}</strong>
                                    {change.change_kind === "changed" && (
                                      <div className="change-summary">
                                        <span>
                                          異動 {count} 項：
                                          {change.differences
                                            .map(
                                              (difference) => difference.label,
                                            )
                                            .join("、")}
                                        </span>
                                        <button
                                          aria-controls={`change-detail-${key}`}
                                          aria-expanded={isExpanded}
                                          className="text-button change-toggle"
                                          onClick={() =>
                                            setExpandedKey(
                                              isExpanded ? null : key,
                                            )
                                          }
                                          type="button"
                                        >
                                          {isExpanded ? "收合差異" : "查看差異"}
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                                {change.change_kind === "changed" && (
                                  <tr className="asset-detail-row change-detail-row">
                                    <td colSpan="3">
                                      <div
                                        className={
                                          "asset-detail " +
                                          (isExpanded ? "open" : "")
                                        }
                                        id={"change-detail-" + key}
                                      >
                                        <div>
                                          <dl>
                                            {change.differences.map(
                                              (difference) => (
                                                <div
                                                  className="detail-pair detail-wide"
                                                  key={difference.label}
                                                >
                                                  <span>
                                                    {difference.label}
                                                  </span>
                                                  <strong className="change-values">
                                                    <s>
                                                      {String(
                                                        difference.before,
                                                      )}
                                                    </s>
                                                    <b>→</b>
                                                    <em>
                                                      {String(difference.after)}
                                                    </em>
                                                  </strong>
                                                </div>
                                              ),
                                            )}
                                          </dl>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })
                        ) : (
                          <tr className="batch-empty-row">
                            <td colSpan="3">
                              <div className="batch-empty-state">
                                <strong>此篩選條件沒有符合的差異資料</strong>
                                <span>請改選其他狀態查看。</span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {totalPages > 1 && (
                    <nav className="pagination" aria-label="批次差異分頁">
                      <button
                        className="button button-secondary"
                        disabled={currentPage === 1}
                        onClick={() => {
                          setPage(currentPage - 1);
                          setExpandedKey(null);
                        }}
                        type="button"
                      >
                        上一頁
                      </button>
                      <span>
                        第 {currentPage}／{totalPages} 頁
                      </span>
                      <button
                        className="button button-secondary"
                        disabled={currentPage === totalPages}
                        onClick={() => {
                          setPage(currentPage + 1);
                          setExpandedKey(null);
                        }}
                        type="button"
                      >
                        下一頁
                      </button>
                    </nav>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <h2>此批次沒有逐筆快照</h2>
                  <p>這是差異追蹤啟用前的批次，仍保有匯入紀錄與筆數。</p>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <h2>選擇一個匯入批次</h2>
              <p>可查看該批次的摘要與逐筆差異。</p>
            </div>
          )}
        </section>
      </section>
    </section>
  );
}
