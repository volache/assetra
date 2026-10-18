import React, { useEffect, useMemo, useState } from "react";
import { DatePicker } from "../../components/DatePicker";
import { CapsuleSpinner } from "../../components/FeedbackCenter";
import { rocDateTime } from "../../lib/formatters";
import { FilterCombo } from "../inventory/QueryControls";
import { collaborationKindLabels, collaborationStatusLabel, requestCollaboration } from "./api";

const resolutionTemplates = {
  tag_missing: "已補印標籤。",
  disposal_candidate: "已完成報廢評估。",
  custodian_change: "已於舊系統完成保管人異動。",
  location_change: "已於舊系統完成存置地點異動。",
  other: "已處理完成。",
};

const statusFilters = [
  ["all", "全部"],
  ["open", "待處理"],
  ["in_progress", "處理中"],
  ["resolved", "已完成"],
  ["cancelled", "已撤回"],
];
const noteCategoryFilters = [
  ["all", "全部"],
  ["location_hint", "實際位置"],
  ["general", "一般筆記"],
];
const sortOptions = [
  ["updated_desc", "最近更新"],
  ["created_desc", "最新提出"],
  ["created_asc", "最早提出"],
  ["asset", "財產編號"],
];

function dateValue(value) {
  return value ? value.slice(0, 10) : "";
}

function labelOptions(tasks, valueFor) {
  return [...new Set(tasks.map(valueFor).filter(Boolean))].sort((left, right) =>
    String(left).localeCompare(String(right), "zh-Hant"),
  );
}

export function CollaborationTasks({ onOpenTask }) {
  const [status, setStatus] = useState("all");
  const [creator, setCreator] = useState("");
  const [unitName, setUnitName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("updated_desc");
  const [openFilterId, setOpenFilterId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("tasks");
  const [scope, setScope] = useState("all");
  const [notes, setNotes] = useState(null);
  const [noteTerm, setNoteTerm] = useState("");
  const [noteCategory, setNoteCategory] = useState("all");
  const [noteUnit, setNoteUnit] = useState("");
  const [notesLoading, setNotesLoading] = useState(false);
  const [actor, setActor] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [resultDraft, setResultDraft] = useState("");
  const [actionError, setActionError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const isAdmin = Boolean(actor?.isAdmin);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await requestCollaboration({ action: "list_tasks", status: "all" });
      setTasks(data.tasks || []);
      setActor(data.actor || null);
    } catch (requestError) {
      setError(requestError.message || "無法載入協作追蹤。");
    } finally {
      setLoading(false);
    }
  };
  const loadNotes = async () => {
    setNotesLoading(true);
    setError("");
    try {
      const data = await requestCollaboration({ action: "list_notes" });
      setNotes(data.notes || []);
    } catch (requestError) {
      setError(requestError.message || "無法載入筆記彙整。");
    } finally {
      setNotesLoading(false);
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (view === "notes" && notes === null) loadNotes(); }, [view]);
  const noteUnits = useMemo(() => labelOptions(notes || [], (note) => note.asset?.unitName), [notes]);
  const visibleNotes = useMemo(() => {
    const term = noteTerm.trim().toLocaleLowerCase("zh-TW");
    return (notes || []).filter((note) => {
      const haystack = [note.body, note.asset?.name, note.asset?.assetNo, note.asset?.custodianName, note.asset?.locationName, note.created_by_name].join(" ").toLocaleLowerCase("zh-TW");
      return (
        (noteCategory === "all" || note.category === noteCategory) &&
        (!noteUnit || note.asset?.unitName === noteUnit) &&
        (!term || haystack.includes(term))
      );
    });
  }, [notes, noteCategory, noteTerm, noteUnit]);
  const counts = useMemo(
    () => Object.fromEntries(statusFilters.map(([value]) => [
      value,
      value === "all" ? tasks.length : tasks.filter((task) => task.status === value).length,
    ])),
    [tasks],
  );
  const creators = useMemo(
    () => labelOptions(tasks, (task) => task.created_by_name),
    [tasks],
  );
  const units = useMemo(
    () => labelOptions(tasks, (task) => task.asset?.unitName),
    [tasks],
  );
  const visibleTasks = useMemo(() => {
    const filtered = tasks.filter((task) => {
      const createdOn = dateValue(task.created_at);
      return (
        (scope === "all" || task.mine) &&
        (status === "all" || task.status === status) &&
        (!creator || task.created_by_name === creator) &&
        (!unitName || task.asset?.unitName === unitName) &&
        (!dateFrom || createdOn >= dateFrom) &&
        (!dateTo || createdOn <= dateTo)
      );
    });
    return filtered.sort((left, right) => {
      if (sortBy === "created_asc") return left.created_at.localeCompare(right.created_at);
      if (sortBy === "created_desc") return right.created_at.localeCompare(left.created_at);
      if (sortBy === "asset")
        return String(left.asset?.assetNo || "").localeCompare(
          String(right.asset?.assetNo || ""),
          "zh-Hant",
          { numeric: true, sensitivity: "base" },
        );
      return right.updated_at.localeCompare(left.updated_at);
    });
  }, [creator, dateFrom, dateTo, scope, sortBy, status, tasks, unitName]);
  const hasFilters = Boolean(creator || unitName || dateFrom || dateTo || status !== "all" || scope !== "all");
  const extraFilterCount = [creator, unitName, dateFrom, dateTo].filter(Boolean).length + Number(scope !== "all") + Number(sortBy !== "updated_desc");
  const sortLabel = sortOptions.find(([value]) => value === sortBy)?.[1] || "最近更新";
  // The administrator handles a request right on this page; the record is
  // patched from the server's reply so the list does not reload or flicker.
  async function act(task, action, body) {
    if (busyId) return;
    setBusyId(task.id);
    setActionError(null);
    try {
      const data = await requestCollaboration({ action, identityId: task.asset.identityId, collaborationId: task.id, body });
      const updated = (data.collaborations || []).find((entry) => entry.id === task.id);
      if (updated) {
        setTasks((current) => current.map((item) => item.id === task.id
          ? { ...item, status: updated.status, updated_at: updated.updated_at, resolution: updated.details?.resolution ?? null }
          : item));
      }
      setResolvingId(null);
      setResultDraft("");
    } catch (requestError) {
      setActionError({ id: task.id, message: requestError.message || "無法儲存處理進度。" });
    } finally {
      setBusyId(null);
    }
  }
  function startResolving(task) {
    setResolvingId(task.id);
    setResultDraft("");
    setActionError(null);
  }
  function toggleExpanded(taskId) {
    setExpandedId((current) => (current === taskId ? null : taskId));
    setResolvingId(null);
    setResultDraft("");
    setActionError(null);
  }
  const totalPages = Math.max(1, Math.ceil(visibleTasks.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const pageRows = visibleTasks.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setCurrentPage(1); setExpandedId(null); }, [creator, dateFrom, dateTo, scope, sortBy, status, unitName]);
  function clearFilters() {
    setStatus("all");
    setCreator("");
    setUnitName("");
    setDateFrom("");
    setDateTo("");
    setScope("all");
  }
  return (
    <section className="page collaboration-tasks-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">COLLABORATION</p>
          <h1>協作追蹤</h1>
          <p>處理事項是向管理員提出的申請；筆記彙整收攏舊系統放不下的現場資料。</p>
        </div>
      </div>
      <div className="collaboration-task-toolbar collaboration-view-switch">
        <div aria-label="檢視" className="segmented-controls" role="tablist">
          <button aria-selected={view === "tasks"} className={view === "tasks" ? "active" : ""} onClick={() => setView("tasks")} role="tab" type="button">處理事項 {tasks.length}</button>
          <button aria-selected={view === "notes"} className={view === "notes" ? "active" : ""} onClick={() => setView("notes")} role="tab" type="button">筆記彙整{notes ? ` ${notes.length}` : ""}</button>
        </div>
      </div>
      {view === "notes" ? (
        <section className="collaboration-task-panel">
          <section aria-label="篩選條件" className="search-panel collaboration-filter-panel">
            <div className="filter-panel-heading">
              <div>
                <h2>篩選條件</h2>
                <p>搜尋所有人留下的筆記，內容、財物名稱、編號、保管人與位置都會比對。</p>
              </div>
              <div className="collaboration-filter-actions">
                {(noteTerm || noteUnit || noteCategory !== "all") && <button className="button button-secondary filter-reset" onClick={() => { setNoteTerm(""); setNoteUnit(""); setNoteCategory("all"); }} type="button">清除篩選</button>}
                <button className="button button-secondary" disabled={notesLoading} onClick={() => loadNotes()} type="button">重新整理</button>
              </div>
            </div>
            <div className="filter-grid collaboration-filter-grid">
              <label className="filter-field collaboration-note-search"><span>搜尋筆記</span><input onChange={(event) => setNoteTerm(event.target.value)} placeholder="例如：檔案室、鐵櫃、已移交" type="search" value={noteTerm} /></label>
              <FilterCombo id="note-unit" label="保管單位" onChange={setNoteUnit} onOpenChange={setOpenFilterId} open={openFilterId === "note-unit"} options={noteUnits} value={noteUnit} />
            </div>
            <fieldset className="collaboration-status-filter">
              <legend>筆記類型</legend>
              <div className="segmented-controls" aria-label="筆記類型">
                {noteCategoryFilters.map(([value, label]) => (
                  <button className={noteCategory === value ? "active" : ""} key={value} onClick={() => setNoteCategory(value)} type="button">{label}</button>
                ))}
              </div>
            </fieldset>
          </section>
          {error && <p className="form-error" role="alert">{error}</p>}
          {notes && !notesLoading && <div className="result-summary collaboration-result-summary"><p className="result-count">查詢結果：<strong>{visibleNotes.length}</strong> 筆</p><p>共 {notes.length} 筆筆記</p></div>}
          {notesLoading || notes === null ? (
            <p className="muted collaboration-task-loading">正在載入筆記彙整…</p>
          ) : visibleNotes.length ? (
            <div className="collaboration-task-list">
              {visibleNotes.map((note) => (
                <article className="collaboration-task" key={note.id}>
                  <div className="collaboration-task-main">
                    <div className="collaboration-task-meta">
                      <span className="collaboration-kind">{note.category === "location_hint" ? "實際位置" : "一般筆記"}</span>
                      <span>{note.created_by_name || "系統"}</span>
                      <time dateTime={note.created_at}>記錄於 {rocDateTime(note.created_at)}</time>
                    </div>
                    <h2>{note.asset?.name || "未命名財物"}</h2>
                    <p className="collaboration-task-asset">
                      {[note.asset?.assetNo, note.asset?.serialNo].filter(Boolean).join("-") || "—"}
                      {note.asset?.unitName && ` · ${note.asset.unitName}`}
                      {note.asset?.custodianName && ` · 保管人：${note.asset.custodianName}`}
                    </p>
                    <p className="collaboration-task-body">{note.body}</p>
                  </div>
                  <button className="button button-secondary" onClick={() => onOpenTask?.(note)} type="button">定位財物</button>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state collaboration-task-empty">
              <h2>{noteTerm || noteUnit || noteCategory !== "all" ? "沒有符合篩選的筆記" : "還沒有人留下筆記"}</h2>
              <p>{noteTerm || noteUnit || noteCategory !== "all" ? "調整篩選條件，或清除篩選後再查看。" : "在財物查詢中開啟協作視窗，就能留下舊系統放不下的資料。"}</p>
            </div>
          )}
        </section>
      ) : (
      <section className="collaboration-task-panel">
        <section aria-label="篩選條件" className="search-panel collaboration-filter-panel">
          <div className="filter-panel-heading">
            <div>
              <h2>篩選條件</h2>
              <p>依提出人、保管單位、提出日期與處理狀態篩選協作追蹤。</p>
            </div>
            <div className="collaboration-filter-actions">
              {hasFilters && <button className="button button-secondary filter-reset" onClick={clearFilters} type="button">清除篩選</button>}
              <button aria-expanded={filtersOpen} className="button button-secondary" onClick={() => setFiltersOpen((open) => !open)} type="button">{filtersOpen ? "收合篩選" : `更多篩選${extraFilterCount ? `（${extraFilterCount}）` : ""}`}</button>
              <button className="button button-secondary" disabled={loading} onClick={() => load()} type="button">重新整理</button>
            </div>
          </div>
          {filtersOpen && <div className="filter-grid collaboration-filter-grid">
            <FilterCombo
              id="task-creator"
              label="提出人"
              onChange={setCreator}
              onOpenChange={setOpenFilterId}
              open={openFilterId === "task-creator"}
              options={creators}
              value={creator}
            />
            <FilterCombo
              id="task-unit"
              label="保管單位"
              onChange={setUnitName}
              onOpenChange={setOpenFilterId}
              open={openFilterId === "task-unit"}
              options={units}
              value={unitName}
            />
            <DatePicker id="task-date-from" label="提出日期起" onChange={setDateFrom} value={dateFrom} />
            <DatePicker id="task-date-to" label="提出日期迄" onChange={setDateTo} value={dateTo} />
            <FilterCombo
              id="task-sort"
              label="排序方式"
              onChange={(label) => setSortBy(sortOptions.find(([, text]) => text === label)?.[0] || "updated_desc")}
              onOpenChange={setOpenFilterId}
              open={openFilterId === "task-sort"}
              options={sortOptions.map(([, label]) => label)}
              value={sortLabel}
            />
          </div>}
          {filtersOpen && <fieldset className="collaboration-status-filter">
            <legend>範圍</legend>
            <div className="segmented-controls" aria-label="範圍">
              <button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")} type="button">全部可見</button>
              <button className={scope === "mine" ? "active" : ""} onClick={() => setScope("mine")} type="button">我提出的</button>
            </div>
          </fieldset>}
          <fieldset className="collaboration-status-filter">
            <legend>處理狀態</legend>
            <div className="segmented-controls" aria-label="處理狀態">
              {statusFilters.map(([value, label]) => (
                <button className={status === value ? "active" : ""} key={value} onClick={() => setStatus(value)} type="button">
                  {label} {counts[value]}
                </button>
              ))}
            </div>
          </fieldset>
        </section>
        {!loading && <div className="result-summary collaboration-result-summary"><p className="result-count">查詢結果：<strong>{visibleTasks.length}</strong> 筆</p><p>共 {tasks.length} 筆協作追蹤</p>{visibleTasks.length > pageSize && (
          <label className="page-size">每頁
            <select aria-label="每頁顯示筆數" onChange={(event) => { setPageSize(Number(event.target.value)); setCurrentPage(1); }} value={pageSize}>
              <option value="25">25 筆</option>
              <option value="50">50 筆</option>
              <option value="100">100 筆</option>
            </select>
          </label>
        )}</div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? (
          <p className="muted collaboration-task-loading">正在載入協作追蹤…</p>
        ) : visibleTasks.length ? (
          <>
            <div className="asset-table-wrap collaboration-task-table">
              <table>
                <thead>
                  <tr>
                    <th>狀態</th>
                    <th>財物</th>
                    <th>類型</th>
                    <th>提出人</th>
                    <th>說明</th>
                    <th>最後更新</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((task) => {
                    const open = expandedId === task.id;
                    const active = task.status === "open" || task.status === "in_progress";
                    return (
                      <React.Fragment key={task.id}>
                        <tr>
                          <td><span className={`collaboration-status is-${task.status}`}>{collaborationStatusLabel(task.status)}</span></td>
                          <td>
                            {task.asset?.name || "未命名財物"}
                            <small>{[task.asset?.assetNo, task.asset?.serialNo].filter(Boolean).join("-") || "—"}</small>
                          </td>
                          <td><span className="collaboration-kind">{collaborationKindLabels[task.kind] || "其他"}</span></td>
                          <td>
                            {task.created_by_name || "系統"}
                            {task.asset?.unitName && <small>{task.asset.unitName}</small>}
                          </td>
                          <td className="collaboration-task-summary" title={task.body}>{task.body}</td>
                          <td className="mono"><time dateTime={task.updated_at}>{rocDateTime(task.updated_at)}</time></td>
                          <td>
                            <div className="asset-row-actions">
                              <button aria-controls={`task-detail-${task.id}`} aria-expanded={open} className="row-action" onClick={() => toggleExpanded(task.id)} type="button">{open ? "收合" : "展開"}</button>
                              <button className="row-action" onClick={() => onOpenTask?.(task)} type="button">定位財物</button>
                            </div>
                          </td>
                        </tr>
                        <tr className="asset-detail-row">
                          <td colSpan="7">
                            <div className={`asset-detail ${open ? "open" : ""}`} id={`task-detail-${task.id}`}>
                              <div>
                                <div className="collaboration-task-detail">
                                  <p className="collaboration-task-detail-meta">{task.created_by_name || "系統"} 提出於 <time dateTime={task.created_at}>{rocDateTime(task.created_at)}</time></p>
                                  <p className="collaboration-task-body">{task.body}</p>
                                  {task.resolution && <p className="collaboration-task-resolution"><strong>處理結果</strong>{task.resolution}</p>}
                                  {isAdmin && active && (resolvingId === task.id ? (
                                    <form className="collaboration-task-resolve" onSubmit={(event) => { event.preventDefault(); if (resultDraft.trim()) act(task, "resolve", resultDraft); }}>
                                      <label>處理結果
                                        <textarea autoFocus disabled={busyId === task.id} maxLength="2000" onChange={(event) => setResultDraft(event.target.value)} placeholder="說明如何處理，提出者會看到這段文字。" value={resultDraft} />
                                      </label>
                                      <div>
                                        <button className="text-button" disabled={busyId === task.id} onClick={() => setResultDraft(resolutionTemplates[task.kind] || resolutionTemplates.other)} type="button">帶入範本</button>
                                        <span />
                                        <button className="text-button" disabled={busyId === task.id} onClick={() => { setResolvingId(null); setResultDraft(""); }} type="button">取消</button>
                                        <button className="button button-primary" disabled={busyId === task.id || !resultDraft.trim()} type="submit">{busyId === task.id && <CapsuleSpinner compact />}確認完成</button>
                                      </div>
                                    </form>
                                  ) : (
                                    <div className="collaboration-task-actions">
                                      {task.status === "open" && <button className="button button-secondary" disabled={Boolean(busyId)} onClick={() => act(task, "start")} type="button">{busyId === task.id && <CapsuleSpinner compact />}開始處理</button>}
                                      <button className="button button-primary" disabled={Boolean(busyId)} onClick={() => startResolving(task)} type="button">完成處理</button>
                                    </div>
                                  ))}
                                  {actionError?.id === task.id && <p className="form-error" role="alert">{actionError.message}</p>}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <nav aria-label="協作追蹤分頁" className="pagination">
                <button className="button button-secondary" disabled={page === 1} onClick={() => setCurrentPage(page - 1)} type="button">上一頁</button>
                <span>第 {page}／{totalPages} 頁</span>
                <button className="button button-secondary" disabled={page === totalPages} onClick={() => setCurrentPage(page + 1)} type="button">下一頁</button>
              </nav>
            )}
          </>
        ) : (
          <div className="empty-state collaboration-task-empty">
            <h2>{hasFilters ? "沒有符合篩選的協作追蹤" : "目前沒有協作追蹤"}</h2>
            <p>{hasFilters ? "調整篩選條件，或清除篩選後再查看。" : "此範圍內尚未建立協作追蹤。"}</p>
          </div>
        )}
      </section>
      )}
    </section>
  );
}
