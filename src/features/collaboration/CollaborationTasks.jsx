import React, { useEffect, useMemo, useState } from "react";
import { DatePicker } from "../../components/DatePicker";
import { rocDateTime } from "../../lib/formatters";
import { FilterCombo } from "../inventory/QueryControls";
import { collaborationKindLabels, collaborationStatusLabel, requestCollaboration } from "./api";

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
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await requestCollaboration({ action: "list_tasks", status: "all" });
      setTasks(data.tasks || []);
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
  const sortLabel = sortOptions.find(([value]) => value === sortBy)?.[1] || "最近更新";
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
              <button className="button button-secondary" disabled={loading} onClick={() => load()} type="button">重新整理</button>
            </div>
          </div>
          <div className="filter-grid collaboration-filter-grid">
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
          </div>
          <fieldset className="collaboration-status-filter">
            <legend>範圍</legend>
            <div className="segmented-controls" aria-label="範圍">
              <button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")} type="button">全部可見</button>
              <button className={scope === "mine" ? "active" : ""} onClick={() => setScope("mine")} type="button">我提出的</button>
            </div>
          </fieldset>
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
        {!loading && <div className="result-summary collaboration-result-summary"><p className="result-count">查詢結果：<strong>{visibleTasks.length}</strong> 筆</p><p>共 {tasks.length} 筆協作追蹤</p></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? (
          <p className="muted collaboration-task-loading">正在載入協作追蹤…</p>
        ) : visibleTasks.length ? (
          <div className="collaboration-task-list">
            {visibleTasks.map((task) => (
              <article className="collaboration-task" key={task.id}>
                <div className="collaboration-task-main">
                  <div className="collaboration-task-meta">
                    <span className={`collaboration-status is-${task.status}`}>
                      {collaborationStatusLabel(task.status)}
                    </span>
                    <span className="collaboration-kind">{collaborationKindLabels[task.kind] || "其他"}</span>
                    <span>{task.created_by_name || "系統"}</span>
                    <time dateTime={task.created_at}>提出於 {rocDateTime(task.created_at)}</time>
                  </div>
                  <h2>{task.asset?.name || "未命名財物"}</h2>
                  <p className="collaboration-task-asset">
                    {[task.asset?.assetNo, task.asset?.serialNo].filter(Boolean).join("-") || "—"}
                    {task.asset?.unitName && ` · 保管單位：${task.asset.unitName}`}
                  </p>
                  <p className="collaboration-task-body">{task.body}</p>
                  {task.resolution && <p className="collaboration-task-resolution"><strong>處理結果</strong>{task.resolution}</p>}
                  <small>最後更新：{rocDateTime(task.updated_at)}</small>
                </div>
                <button className="button button-secondary" onClick={() => onOpenTask?.(task)} type="button">
                  定位財物
                </button>
              </article>
            ))}
          </div>
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
