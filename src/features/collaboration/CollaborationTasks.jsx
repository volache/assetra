import React, { useEffect, useMemo, useState } from "react";
import { rocDateTime } from "../../lib/formatters";
import { FilterCombo } from "../inventory/QueryControls";
import {
  collaborationKindLabels,
  collaborationStatusLabel,
  requestCollaboration,
} from "./api";

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
  const [unitCode, setUnitCode] = useState("");
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
      setError(requestError.message || "無法載入協作待辦。");
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
    () => labelOptions(tasks, (task) => task.asset?.unitCode),
    [tasks],
  );
  const visibleTasks = useMemo(() => {
    const filtered = tasks.filter((task) => {
      const createdOn = dateValue(task.created_at);
      return (
        (status === "all" || task.status === status) &&
        (!creator || task.created_by_name === creator) &&
        (!unitCode || task.asset?.unitCode === unitCode) &&
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
  }, [creator, dateFrom, dateTo, sortBy, status, tasks, unitCode]);
  const hasFilters = Boolean(creator || unitCode || dateFrom || dateTo || status !== "all");
  const sortLabel = sortOptions.find(([value]) => value === sortBy)?.[1] || "最近更新";
  function clearFilters() {
    setStatus("all");
    setCreator("");
    setUnitCode("");
    setDateFrom("");
    setDateTo("");
  }
  return (
    <section className="page collaboration-tasks-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">COLLABORATION</p>
          <h1>協作待辦</h1>
          <p>依處理狀態、提出來源與時間整理可追蹤的共同筆記。</p>
        </div>
      </div>
      <section className="collaboration-task-panel">
        <header className="collaboration-task-toolbar">
          <div className="segmented-controls" aria-label="待辦狀態">
            {statusFilters.map(([value, label]) => (
              <button
                className={status === value ? "active" : ""}
                key={value}
                onClick={() => setStatus(value)}
                type="button"
              >
                {label} {counts[value]}
              </button>
            ))}
          </div>
          <button className="button button-secondary" disabled={loading} onClick={() => load()} type="button">
            重新整理
          </button>
        </header>
        <div className="collaboration-task-filters" aria-label="待辦篩選條件">
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
            onChange={setUnitCode}
            onOpenChange={setOpenFilterId}
            open={openFilterId === "task-unit"}
            options={units}
            value={unitCode}
          />
          <label className="filter-field">
            提出日期起
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label className="filter-field">
            提出日期迄
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <FilterCombo
            id="task-sort"
            label="排序方式"
            onChange={(label) => setSortBy(sortOptions.find(([, text]) => text === label)?.[0] || "updated_desc")}
            onOpenChange={setOpenFilterId}
            open={openFilterId === "task-sort"}
            options={sortOptions.map(([, label]) => label)}
            value={sortLabel}
          />
          {hasFilters && <button className="text-button collaboration-filter-reset" onClick={clearFilters} type="button">清除篩選</button>}
        </div>
        {!loading && <p className="collaboration-task-result">顯示 <strong>{visibleTasks.length}</strong>／{tasks.length} 筆協作事項</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? (
          <p className="muted collaboration-task-loading">正在載入協作待辦…</p>
        ) : visibleTasks.length ? (
          <div className="collaboration-task-list">
            {visibleTasks.map((task) => (
              <article className="collaboration-task" key={task.id}>
                <div className="collaboration-task-main">
                  <div className="collaboration-task-meta">
                    <span className={`collaboration-status is-${task.status}`}>
                      {collaborationStatusLabel(task.status)}
                    </span>
                    <span>{collaborationKindLabels[task.kind] || "協作事項"}</span>
                    <time dateTime={task.created_at}>提出於 {rocDateTime(task.created_at)}</time>
                  </div>
                  <h2>{task.asset?.name || "未命名財物"}</h2>
                  <p className="collaboration-task-asset">
                    {[task.asset?.assetNo, task.asset?.serialNo].filter(Boolean).join("-") || "—"}
                    {task.asset?.unitCode && ` · 保管單位：${task.asset.unitCode}`}
                  </p>
                  <p className="collaboration-task-body">{task.body}</p>
                  <small>提出者：{task.created_by_name} · 最後更新：{rocDateTime(task.updated_at)}</small>
                </div>
                <button className="button button-secondary" onClick={() => onOpenTask?.(task)} type="button">
                  定位財物
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state collaboration-task-empty">
            <h2>{hasFilters ? "沒有符合篩選的事項" : "目前沒有協作事項"}</h2>
            <p>{hasFilters ? "調整篩選條件，或清除篩選後再查看。" : "此範圍內尚未建立共同筆記。"}</p>
          </div>
        )}
      </section>
    </section>
  );
}
