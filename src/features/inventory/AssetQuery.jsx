import React, { useEffect, useMemo, useRef, useState } from "react";
import { assetMajorClass, money, serviceLifeExpired, usedDuration } from "../../lib/formatters";
import { CollaborationDrawer } from "../collaboration/CollaborationDrawer";
import { requestCollaboration } from "../collaboration/api";
import { AssetPhotoPicker } from "../photos/AssetPhotoPicker";
import { FilterCombo, HighlightText, SearchRuleMenu } from "./QueryControls";
import { CapsuleSpinner, useFeedback } from "../../components/FeedbackCenter";
import { supabase } from "../../supabase";
import {
  defaultPageSize,
  filterFields,
  matchesAdvancedSearch,
  normalized,
  searchFieldAliases,
  tokenizeSearch,
} from "./search";
export function AssetQuery({
  assets,
  focusTask,
  imports,
  onTaskFocusHandled,
  user,
}) {
  const defaultFilterApplied = useRef(false);
  const [term, setTerm] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReport, setAiReport] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiClarification, setAiClarification] = useState(null);
  const [clarificationText, setClarificationText] = useState("");
  const [aiAssetIds, setAiAssetIds] = useState(null);
  const { notify } = useFeedback();
  const [appliedTerm, setAppliedTerm] = useState("");
  const [source, setSource] = useState("all");
  const [filters, setFilters] = useState(() =>
    Object.fromEntries(filterFields.map(([key]) => [key, ""])),
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [expandedId, setExpandedId] = useState(null);
  const [collaborationSummaries, setCollaborationSummaries] = useState({});
  const [collaborationAsset, setCollaborationAsset] = useState(null);
  const [collaborationFocusId, setCollaborationFocusId] = useState(null);
  const [photoPickerAsset, setPhotoPickerAsset] = useState(null);
  const [compactFilters, setCompactFilters] = useState(false);
  const [compactFilterExpanded, setCompactFilterExpanded] = useState(false);
  const [openFilterId, setOpenFilterId] = useState(null);
  const [ruleMenuOpen, setRuleMenuOpen] = useState(false);
  const filterSentinelRef = useRef(null);
  const filterPanelRef = useRef(null);
  const searchInputRef = useRef(null);
  const matches = (asset, omit = null) =>
    filterFields.every(
      ([key]) =>
        key === omit ||
        !filters[key] ||
        normalized(asset[key]).includes(normalized(filters[key])),
    );
  const sourceRows = useMemo(
    () =>
      assets
        .filter((asset) => source === "all" || asset.sourceType === source)
        .map((asset) => ({
          ...asset,
          assetMajorClass: assetMajorClass(asset.assetNo),
          usedDuration: usedDuration(asset.acquiredAt),
          serviceLifeExpired: serviceLifeExpired(asset.acquiredAt, asset.usefulLife),
        })),
    [assets, source],
  );
  const options = useMemo(
    () =>
      Object.fromEntries(
        filterFields.map(([key]) => [
          key,
          [
            ...new Set(
              sourceRows
                .filter((asset) => matches(asset, key))
                .map((asset) => String(asset[key] || "").trim())
                .filter(Boolean),
            ),
          ].sort((a, b) => a.localeCompare(b, "zh-Hant")),
        ]),
      ),
    [sourceRows, filters],
  );
  const rows = useMemo(
    () =>
      sourceRows
        .filter(
          (asset) =>
            matches(asset) &&
            matchesAdvancedSearch(asset, appliedTerm) &&
            (!aiAssetIds || aiAssetIds.has(asset.identityId)),
        )
        .sort(
          (left, right) =>
            String(left.assetNo || "").localeCompare(
              String(right.assetNo || ""),
              "zh-Hant",
              { numeric: true, sensitivity: "base" },
            ) ||
            String(left.serialNo || "").localeCompare(
              String(right.serialNo || ""),
              "zh-Hant",
              { numeric: true, sensitivity: "base" },
            ),
        ),
    [sourceRows, filters, appliedTerm, aiAssetIds],
  );
  const globalHighlightTerms = useMemo(
    () =>
      tokenizeSearch(appliedTerm).filter(
        (token) =>
          token !== "|" && !token.startsWith("-") && !token.includes(":"),
      ),
    [appliedTerm],
  );
  function highlightTermsFor(field) {
    const terms = filters[field] ? [filters[field]] : [];
    tokenizeSearch(appliedTerm)
      .filter((token) => token !== "|" && !token.startsWith("-"))
      .forEach((token) => {
        const comparison = token.match(/^([^:]+):(>=|<=|>|<|=)(.+)$/);
        if (comparison) return;
        const fieldToken = token.match(/^([^:]+):(.+)$/);
        if (fieldToken) {
          if (searchFieldAliases[fieldToken[1]] === field)
            terms.push(fieldToken[2]);
        } else terms.push(token);
      });
    return terms;
  }
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const pageIdentityKey = pageRows
    .map((asset) => asset.identityId)
    .filter(Boolean)
    .join(",");
  const activeFilterCount =
    filterFields.filter(([key]) => filters[key]).length +
    Number(Boolean(appliedTerm)) +
    Number(source !== "all");
  useEffect(() => {
    setCurrentPage(1);
    setExpandedId(null);
  }, [appliedTerm, source, ...filterFields.map(([key]) => filters[key])]);
  useEffect(() => {
    if (defaultFilterApplied.current) return;
    if (focusTask?.identityId) {
      defaultFilterApplied.current = true;
      return;
    }
    const codes = user?.custodianCodes || [];
    if (!codes.length || !assets.length) return;
    defaultFilterApplied.current = true;
    const own = assets.find(
      (asset) => asset.custodianName && codes.includes(asset.custodianCode),
    );
    if (own) setFilters((current) => ({ ...current, custodianName: own.custodianName }));
  }, [assets, focusTask?.identityId, user]);
  useEffect(() => {
    if (!focusTask?.identityId) return;
    const asset = assets.find((item) => item.identityId === focusTask.identityId);
    if (!asset) {
      onTaskFocusHandled?.();
      return;
    }
    const orderedAssets = [...assets].sort(
      (left, right) =>
        String(left.assetNo || "").localeCompare(
          String(right.assetNo || ""),
          "zh-Hant",
          { numeric: true, sensitivity: "base" },
        ) ||
        String(left.serialNo || "").localeCompare(
          String(right.serialNo || ""),
          "zh-Hant",
          { numeric: true, sensitivity: "base" },
        ),
    );
    const index = orderedAssets.findIndex((item) => item.id === asset.id);
    setTerm("");
    setAppliedTerm("");
    setAiReport(null);
    setAiAnalysis(null);
    setAiClarification(null);
    setAiAssetIds(null);
    setSource("all");
    setFilters(Object.fromEntries(filterFields.map(([key]) => [key, ""])));
    window.requestAnimationFrame(() => {
      setCurrentPage(Math.floor(Math.max(0, index) / pageSize) + 1);
      setExpandedId(asset.id);
      setCollaborationFocusId(focusTask.collaborationId || null);
      setCollaborationAsset(asset);
      onTaskFocusHandled?.();
    });
  }, [assets, focusTask?.requestId, onTaskFocusHandled, pageSize]);
  useEffect(() => {
    const identityIds = pageIdentityKey ? pageIdentityKey.split(",") : [];
    if (!identityIds.length) {
      setCollaborationSummaries({});
      return;
    }
    let cancelled = false;
    requestCollaboration({ action: "summaries", identityIds })
      .then((data) => {
        if (cancelled) return;
        setCollaborationSummaries(
          Object.fromEntries(
            (data.summaries || []).map((summary) => [summary.identityId, summary]),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setCollaborationSummaries({});
      });
    return () => {
      cancelled = true;
    };
  }, [pageIdentityKey]);
  useEffect(() => {
    const updateCompactMode = () => {
      if (window.innerWidth < 960 || !filterSentinelRef.current)
        return setCompactFilters(false);
      setCompactFilters(
        filterSentinelRef.current.getBoundingClientRect().bottom <= 0,
      );
    };
    updateCompactMode();
    window.addEventListener("scroll", updateCompactMode, { passive: true });
    window.addEventListener("resize", updateCompactMode);
    return () => {
      window.removeEventListener("scroll", updateCompactMode);
      window.removeEventListener("resize", updateCompactMode);
    };
  }, []);
  useEffect(() => {
    const closeOutsideMenus = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".filter-combobox")) setOpenFilterId(null);
      if (!target.closest(".search-rule-menu")) setRuleMenuOpen(false);
      if (!target.closest(".compact-filter-bar"))
        setCompactFilterExpanded(false);
    };
    document.addEventListener("pointerdown", closeOutsideMenus);
    return () => document.removeEventListener("pointerdown", closeOutsideMenus);
  }, []);
  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }
  function clearFilters() {
    setFilters(Object.fromEntries(filterFields.map(([key]) => [key, ""])));
    setTerm("");
    setAppliedTerm("");
    setAiReport(null);
    setAiAnalysis(null);
    setAiClarification(null);
    setAiAssetIds(null);
    setSource("all");
  }
  function runSearch() {
    setAppliedTerm(term.trim());
    setAiReport(null);
    setAiAnalysis(null);
    setAiClarification(null);
    setAiAssetIds(null);
    setRuleMenuOpen(false);
  }
  function applyAiResult(result, fallbackQuestion) {
    setAiAssetIds(new Set(result.displayIdentityIds || result.assetIdentityIds || [])); setAppliedTerm(""); setAiClarification(null); setClarificationText(""); setAiAnalysis(result.analysis || null);
    setAiReport({ question: result.question || fallbackQuestion, modelVersion: result.modelVersion || null, summary: result.summary, explanation: result.explanation, analysisDescription: result.analysisDescription, conditionGroups: result.conditionGroups || [], scopeCount: result.scopeCount, trace: result.trace || [] });
  }
  async function callAiQuery(body) {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/semantic-asset-query`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }
  async function runAiSearch() {
    if (!term.trim()) return;
    setAiBusy(true);
    try {
      const question = term.trim();
      const result = await callAiQuery({ query: question });
      if (result.status === "clarification") {
        setAiReport(null); setAiAnalysis(null); setAiAssetIds(null); setAiClarification(result.clarification); setClarificationText("");
      } else { applyAiResult(result, question); notify("AI 已依索引事實完成查詢。"); }
    } catch (error) { notify(error instanceof Error ? error.message : "自然語言查詢失敗。", "error"); } finally { setAiBusy(false); }
  }
  async function answerClarification(choiceId) {
    if (!aiClarification) return;
    setAiBusy(true);
    try {
      const customAnswer = choiceId === "custom" ? clarificationText.trim() : "";
      if (choiceId === "custom" && !customAnswer) return notify("請先補充您想找的資料。", "error");
      const result = await callAiQuery({ action: "clarify", clarificationId: aiClarification.id, choiceId, customAnswer });
      applyAiResult(result, aiClarification.question); notify("已依您的選擇完成查詢。");
    } catch (error) { notify(error instanceof Error ? error.message : "無法完成追問查詢。", "error"); } finally { setAiBusy(false); }
  }
  function showFullFilters() {
    setCompactFilterExpanded((open) => !open);
  }
  function insertRule(value) {
    const input = searchInputRef.current;
    const start = input?.selectionStart ?? term.length;
    const end = input?.selectionEnd ?? term.length;
    const before = term.slice(0, start);
    const after = term.slice(end);
    const padding =
      before && !/\s$/.test(before) && !value.startsWith(" ") ? " " : "";
    const next = `${before}${padding}${value}${after}`;
    setTerm(next);
    setRuleMenuOpen(false);
    requestAnimationFrame(() => {
      input?.focus();
      const caret = (before + padding + value).length;
      input?.setSelectionRange(caret, caret);
    });
  }
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ASSET SEARCH</p>
          <h1>財物查詢</h1>
          <p>篩選條件彼此取交集；每個選單會依其餘條件即時縮小。</p>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="filter-sentinel"
        ref={filterSentinelRef}
      />
      {compactFilters && (
        <div className="compact-filter-bar compact-filter-bar-fixed">
          <button
            aria-expanded={compactFilterExpanded}
            className="compact-filter-trigger"
            onClick={showFullFilters}
            type="button"
          >
            篩選條件{activeFilterCount ? <b>{activeFilterCount}</b> : null}
          </button>
          <label className="compact-search">
            <span className="sr-only">全局關鍵字搜尋</span>
            <input
              value={term}
              onChange={(e) => { setTerm(e.target.value); setAiReport(null); setAiAnalysis(null); setAiClarification(null); setAiAssetIds(null); }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) runAiSearch(); else runSearch();
              }}
              placeholder="輸入後按 Enter 搜尋…"
            />
          </label>
          <button
            className="compact-clear"
            disabled={!activeFilterCount}
            onClick={clearFilters}
            type="button"
          >
            清除
          </button>
          {compactFilterExpanded && (
            <div className="compact-filter-popover">
              <div className="filter-grid">
                {filterFields.map(([key, label]) => (
                  <FilterCombo
                    id={`compact-${key}`}
                    key={key}
                    label={label}
                    onChange={(value) => updateFilter(key, value)}
                    onOpenChange={setOpenFilterId}
                    open={openFilterId === `compact-${key}`}
                    options={options[key]}
                    value={filters[key]}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <section
        className="search-panel"
        aria-label="篩選條件"
        ref={filterPanelRef}
      >
        <div className="filter-panel-heading">
          <div>
            <h2>篩選條件</h2>
            <p>可直接輸入文字，或由清冊資料中的選項挑選。</p>
          </div>
          <button
            className="button button-secondary filter-reset"
            type="button"
            onClick={clearFilters}
          >
            清除篩選
          </button>
        </div>
        <div className="filter-grid">
          {filterFields.map(([key, label]) => (
            <FilterCombo
              id={key}
              key={key}
              label={label}
              onChange={(value) => updateFilter(key, value)}
              onOpenChange={setOpenFilterId}
              open={openFilterId === key}
              options={options[key]}
              value={filters[key]}
            />
          ))}
        </div>
        <div className="advanced-search">
          <label className="search-field">
            全局關鍵字搜尋
            <input
              ref={searchInputRef}
              value={term}
              onChange={(e) => { setTerm(e.target.value); setAiReport(null); setAiAnalysis(null); setAiClarification(null); setAiAssetIds(null); }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) runAiSearch(); else runSearch();
              }}
              placeholder="輸入關鍵字，或以自然語言描述需求"
            />
          </label>
          <div className="advanced-search-actions">
            <button aria-keyshortcuts="Control+Enter" className="button button-secondary query-action ai-query-action" disabled={aiBusy || !term.trim()} onClick={runAiSearch} type="button">{aiBusy ? <><CapsuleSpinner compact /><span>施展魔法中</span></> : <><span>智慧查詢</span><small>Ctrl + Enter</small></>}</button>
            <button
              aria-keyshortcuts="Enter"
              className={`button button-primary search-submit query-action ${term !== appliedTerm ? "pending" : ""}`}
              onClick={runSearch}
              type="button"
            >
              <span>搜尋</span><small>Enter</small>
            </button>
            <SearchRuleMenu
              onInsert={insertRule}
              onToggle={() => setRuleMenuOpen((open) => !open)}
              open={ruleMenuOpen}
            />
          </div>
          {aiReport && <aside aria-live="polite" className="ai-search-report"><strong>智慧查詢結果</strong><span>提問：{aiReport.question}</span>{aiReport.modelVersion && <span>推理模型：{aiReport.modelVersion}</span>}<span>{aiReport.summary}</span>{aiReport.conditionGroups.some((group) => group.length) ? <span className="ai-report-conditions">查詢條件：<span className="ai-condition-chips">{aiReport.conditionGroups.map((group, groupIndex) => <React.Fragment key={`group-${groupIndex}`}>{groupIndex > 0 && <i className="ai-condition-or">或</i>}{group.map((rule) => <code className="ai-condition-chip" key={`${groupIndex}-${rule}`}>{rule}</code>)}</React.Fragment>)}</span></span> : <span>{aiReport.analysisDescription || aiReport.explanation}</span>}<span>{aiAnalysis ? `${typeof aiAnalysis.matchCount === "number" ? `符合分析條件共 ${aiAnalysis.matchCount.toLocaleString()} 筆資料；` : ""}分析範圍共 ${(aiReport.scopeCount ?? 0).toLocaleString()} 筆資料。` : `共找到 ${rows.length.toLocaleString()} 筆資料。`}{aiReport.trace.length ? ` 已執行：${aiReport.trace.join("、")}。` : ""}</span></aside>}
          {aiAnalysis && <aside aria-live="polite" className="ai-analysis"><strong>分析摘要</strong><span>{aiAnalysis.title}</span><span>{aiAnalysis.summary}</span>{aiAnalysis.value ? <b className="ai-analysis-value">{aiAnalysis.value}{aiAnalysis.unit}</b> : <div className="ai-analysis-table-wrap"><table><thead><tr>{aiAnalysis.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{aiAnalysis.rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((value, cellIndex) => <td key={cellIndex}>{value}</td>)}</tr>)}</tbody></table></div>}</aside>}
          {aiClarification && <aside aria-live="polite" className="ai-clarification"><strong>想再確認一下</strong><span>{aiClarification.prompt}</span><div className="ai-clarification-options">{aiClarification.options.map((option) => <button className="button button-secondary" disabled={aiBusy} key={option.id} onClick={() => answerClarification(option.id)} type="button">{option.label}</button>)}</div><div className="ai-clarification-custom-row"><label className="ai-clarification-custom">或用自己的話說明<input disabled={aiBusy} onChange={(event) => setClarificationText(event.target.value)} placeholder="例如：放在消防班的財產" value={clarificationText} /></label><button className="button button-primary ai-clarification-submit" disabled={aiBusy || !clarificationText.trim()} onClick={() => answerClarification("custom")} type="button">依這個說明查詢</button></div></aside>}
        </div>
        <fieldset>
          <legend>資料類型</legend>
          <div className="segmented">
            {[
              ["all", "全部"],
              ["asset", "財產"],
              ["item", "物品"],
            ].map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  checked={source === value}
                  onChange={() => setSource(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>
      <div className="result-summary">
        <p className="result-count">
          查詢結果：<strong>{rows.length.toLocaleString()}</strong> 筆
        </p>
        {imports[0] && <p className="latest-data">資料更新：{imports[0].at}</p>}
        {rows.length > pageSize && (
          <label className="page-size">
            每頁
            <select
              aria-label="每頁顯示筆數"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
            >
              <option value="25">25 筆</option>
              <option value="50">50 筆</option>
              <option value="100">100 筆</option>
            </select>
          </label>
        )}
        <p>
          第 {page}／{totalPages} 頁
        </p>
      </div>
      {rows.length ? (
        <>
          <div className="asset-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>使用現況</th>
                  <th>財產編號</th>
                  <th>名稱</th>
                  <th>廠牌／型式</th>
                  <th>保管人</th>
                  <th>存置地點</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((a) => (
                  <React.Fragment key={a.id}>
                    <tr>
                      <td>
                        <HighlightText
                          value={a.status}
                          terms={highlightTermsFor("status")}
                        />
                      </td>
                      <td className="mono">
                        <HighlightText
                          value={a.assetNo}
                          terms={highlightTermsFor("assetNo")}
                        />
                        <small>
                          <HighlightText
                            value={a.serialNo}
                            terms={highlightTermsFor("serialNo")}
                          />
                        </small>
                      </td>
                      <td>
                        <HighlightText
                          value={a.name}
                          terms={highlightTermsFor("name")}
                        />
                        <small>
                          <HighlightText
                            value={a.categoryName}
                            terms={highlightTermsFor("categoryName")}
                          />
                        </small>
                      </td>
                      <td>
                        <HighlightText
                          value={a.brand}
                          terms={highlightTermsFor("brand")}
                        />
                        <small>
                          <HighlightText
                            value={a.model}
                            terms={highlightTermsFor("model")}
                          />
                        </small>
                      </td>
                      <td>
                        <HighlightText
                          value={a.custodianName || "未指定"}
                          terms={highlightTermsFor("custodianName")}
                        />
                        <small>
                          <HighlightText
                            value={a.custodianCode}
                            terms={highlightTermsFor("custodianCode")}
                          />
                        </small>
                      </td>
                      <td>
                        <HighlightText
                          value={a.locationName}
                          terms={highlightTermsFor("locationName")}
                        />
                      </td>
                      <td>
                        <div className="asset-row-actions">
                          <button
                          className="row-action"
                          aria-expanded={expandedId === a.id}
                          aria-controls={`detail-${a.id}`}
                          onClick={() =>
                            setExpandedId((id) => (id === a.id ? null : a.id))
                          }
                          >
                            {expandedId === a.id ? "收合" : "展開"}
                          </button>
                          {a.identityId && (() => {
                            const photoCount = collaborationSummaries[a.identityId]?.photoCount || 0;
                            return <button aria-label={`照片${photoCount ? `，共 ${photoCount} 張` : ""}`} className="row-action asset-photo-action" onClick={() => setPhotoPickerAsset(a)} type="button">照片{photoCount ? <span className="collaboration-count-badge">{photoCount}</span> : null}</button>;
                          })()}
                          {a.identityId && (() => {
                          const summary = collaborationSummaries[a.identityId];
                          const total =
                            (summary?.openCount || 0) +
                            (summary?.inProgressCount || 0);
                            return (
                              <button
                              className={`row-action asset-collaboration-action ${total ? "has-open-items" : ""}`}
                              onClick={() => {
                                setCollaborationFocusId(null);
                                setCollaborationAsset(a);
                              }}
                              type="button"
                              >
                                協作{total ? <span className="collaboration-count-badge">{total}</span> : null}
                              </button>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                    <tr className="asset-detail-row">
                      <td colSpan="7">
                        <div
                          className={`asset-detail ${expandedId === a.id ? "open" : ""}`}
                          id={`detail-${a.id}`}
                        >
                          <div>
                            <dl>
                              {[
                                [
                                  "財產區分別",
                                  <HighlightText
                                    value={a.categoryType}
                                    terms={highlightTermsFor("categoryType")}
                                  />,
                                ],
                                [
                                  "類型",
                                  <HighlightText
                                    value={
                                      a.sourceType === "asset" ? "財產" : "物品"
                                    }
                                    terms={globalHighlightTerms}
                                  />,
                                ],
                                [
                                  "財產大類",
                                  <HighlightText
                                    value={assetMajorClass(a.assetNo)}
                                    terms={globalHighlightTerms}
                                  />,
                                ],
                                [
                                  "保管單位",
                                  <HighlightText
                                    value={a.unitName}
                                    terms={highlightTermsFor("unitName")}
                                  />,
                                ],
                                [
                                  "使用單位／使用人",
                                  <HighlightText
                                    value={[a.useUnitName, a.userName]
                                      .filter(Boolean)
                                      .join("／")}
                                    terms={[
                                      ...highlightTermsFor("useUnitName"),
                                      ...highlightTermsFor("userName"),
                                    ]}
                                  />,
                                ],
                                [
                                  "計量單位",
                                  <HighlightText
                                    value={a.measureUnit}
                                    terms={highlightTermsFor("measureUnit")}
                                  />,
                                ],
                                [
                                  "購置日期",
                                  <HighlightText
                                    value={a.acquiredAt}
                                    terms={highlightTermsFor("acquiredAt")}
                                  />,
                                ],
                                [
                                  "年限",
                                  <HighlightText
                                    value={
                                      a.usefulLife ? `${a.usefulLife} 年` : "—"
                                    }
                                    terms={highlightTermsFor("usefulLife")}
                                  />,
                                ],
                                [
                                  "已使用",
                                  <HighlightText
                                    value={usedDuration(a.acquiredAt)}
                                    terms={globalHighlightTerms}
                                  />,
                                ],
                                [
                                  "原值",
                                  <HighlightText
                                    value={money(a.originalValue)}
                                    terms={highlightTermsFor("originalValue")}
                                  />,
                                ],
                                [
                                  "累折",
                                  <HighlightText
                                    value={money(a.depreciation)}
                                    terms={highlightTermsFor("depreciation")}
                                  />,
                                ],
                                [
                                  "淨值",
                                  <HighlightText
                                    value={money(a.netValue)}
                                    terms={highlightTermsFor("netValue")}
                                  />,
                                ],
                                [
                                  "備註",
                                  <HighlightText
                                    value={a.notes}
                                    terms={highlightTermsFor("notes")}
                                  />,
                                ],
                              ].map(([label, value]) => (
                                <div
                                  className={`detail-pair ${label === "備註" ? "detail-wide" : ""}`}
                                  key={label}
                                >
                                  <span>{label}</span>
                                  <strong>{value || "—"}</strong>
                                </div>
                              ))}
                            </dl>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <nav className="pagination" aria-label="清冊分頁">
              <button
                className="button button-secondary"
                type="button"
                disabled={page === 1}
                onClick={() => setCurrentPage(page - 1)}
              >
                上一頁
              </button>
              <span>
                第 {page}／{totalPages} 頁
              </span>
              <button
                className="button button-secondary"
                type="button"
                disabled={page === totalPages}
                onClick={() => setCurrentPage(page + 1)}
              >
                下一頁
              </button>
            </nav>
          )}
        </>
      ) : (
        <div className="empty-state">
          <h2>目前沒有符合的資料</h2>
          <p>
            {assets.length
              ? "請調整篩選條件或搜尋文字。"
              : "尚未匯入可供查詢的清冊。"}
          </p>
        </div>
      )}
      <CollaborationDrawer
        asset={collaborationAsset}
        focusCollaborationId={collaborationFocusId}
        onChanged={() => {
          const identityIds = pageIdentityKey ? pageIdentityKey.split(",") : [];
          requestCollaboration({ action: "summaries", identityIds })
            .then((data) => setCollaborationSummaries(Object.fromEntries((data.summaries || []).map((summary) => [summary.identityId, summary]))))
            .catch(() => {});
        }}
        onClose={() => {
          setCollaborationFocusId(null);
          setCollaborationAsset(null);
        }}
      />
      <AssetPhotoPicker
        asset={photoPickerAsset}
        onChanged={(photoCount) => {
          const identityId = photoPickerAsset?.identityId;
          if (!identityId) return;
          setCollaborationSummaries((current) => ({
            ...current,
            [identityId]: { ...(current[identityId] || {}), identityId, photoCount },
          }));
        }}
        onClose={() => setPhotoPickerAsset(null)}
      />
    </section>
  );
}
