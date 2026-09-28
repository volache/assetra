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
  useEffect(() => { load(); }, []);
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
  }, [creator, dateFrom, dateTo, sortBy, status, tasks, unitName]);
  const hasFilters = Boolean(creator || unitName || dateFrom || dateTo || status !== "all");
  const sortLabel = sortOptions.find(([value]) => value === sortBy)?.[1] || "最近更新";
  function clearFilters() {
    setStatus("all");
    setCreator("");
    setUnitName("");
    setDateFrom("");
    setDateTo("");
  }
  return (
    <section className="page collaboration-tasks-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">COLLABORATION</p>
          <h1>協作追蹤</h1>
          <p>依處理狀態、提出來源與時間整理可追蹤的協作紀錄。</p>
        </div>
      </div>
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
    </section>
  );
}
