import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assetMajorClass, money, serviceLifeExpired, usedDuration } from "../../lib/formatters";
import { CollaborationDrawer } from "../collaboration/CollaborationDrawer";
import { requestCollaboration } from "../collaboration/api";
import { AssetPhotoPicker } from "../photos/AssetPhotoPicker";
import { FilterCombo, HighlightText, SearchRuleMenu } from "./QueryControls";
import { CapsuleSpinner, useFeedback } from "../../components/FeedbackCenter";
import { supabase } from "../../supabase";
import {
  assetNumberCollator,
  collaborationFilterOptions,
  defaultPageSize,
  filterCellMatches,
  filterFields,
  numericCollator,
  textCollator,
  photoFilterOptions,
  matchesAdvancedSearch,
  normalizeSearchInput,
  highlightTermsFactory,
  looksLikeRuleSyntax,
  normalized,
  searchFieldAliases,
  searchTermWarnings,
  tokenizeSearch,
} from "./search";
import { KeywordSearchBox } from "./KeywordSearchBox";
import { rememberSearch } from "./searchHistory";
// The derived fields every row carries for searching and display.
function enrichAsset(asset) {
  return {
    ...asset,
    assetMajorClass: assetMajorClass(asset.assetNo),
    usedDuration: usedDuration(asset.acquiredAt),
    serviceLifeExpired: serviceLifeExpired(asset.acquiredAt, asset.usefulLife),
  };
}
const compareByAssetNumber = (left, right) =>
  assetNumberCollator.compare(String(left.assetNo || ""), String(right.assetNo || "")) ||
  assetNumberCollator.compare(String(left.serialNo || ""), String(right.serialNo || ""));
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
  const [photoFilter, setPhotoFilter] = useState("");
  const [collaborationFilter, setCollaborationFilter] = useState("");
  const [flagged, setFlagged] = useState(null);
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
  // { format, fraction, label } while a 財產清冊 is being produced.
  const [registerExport, setRegisterExport] = useState(null);
  const registerAbort = useRef(null);
  useEffect(() => () => registerAbort.current?.abort(), []);
  const [ruleMenuOpen, setRuleMenuOpen] = useState(false);
  const filterSentinelRef = useRef(null);
  const filterPanelRef = useRef(null);
  const searchBoxRef = useRef(null);
  // Folded once per filter change, not once per row and field.
  const filterNeedles = useMemo(
    () => filterFields.map(([key]) => [key, normalized(filters[key])]),
    [filters],
  );
  const matches = (asset, omit = null) =>
    filterNeedles.every(
      ([key, needle]) => key === omit || filterCellMatches(asset, key, needle),
    );
  const matchesFlags = (asset, photo = photoFilter, collaboration = collaborationFilter) => {
    if (!flagged || (!photo && !collaboration)) return true;
    const id = asset.identityId;
    const hasPhoto = flagged.photo.has(id);
    const isOpen = flagged.open.has(id);
    const isInProgress = flagged.inProgress.has(id);
    if (photo === "with" && !hasPhoto) return false;
    if (photo === "without" && hasPhoto) return false;
    if (collaboration === "open" && !isOpen) return false;
    if (collaboration === "in_progress" && !isInProgress) return false;
    if (collaboration === "any" && !isOpen && !isInProgress) return false;
    if (collaboration === "none" && (isOpen || isInProgress)) return false;
    return true;
  };
  const sourceRows = useMemo(
    () =>
      assets
        .filter((asset) => source === "all" || asset.sourceType === source)
        .map(enrichAsset),
    [assets, source],
  );
  const distinctValueCache = useMemo(() => new Map(), [sourceRows]);
  const distinctValues = useCallback(
    (field) => {
      if (!distinctValueCache.has(field))
        distinctValueCache.set(
          field,
          [
            ...new Set(
              sourceRows
                .map((asset) => String(asset[field] || "").trim())
                .filter(Boolean),
            ),
          ].sort(textCollator.compare),
        );
      return distinctValueCache.get(field);
    },
    [distinctValueCache, sourceRows],
  );
  const termWarnings = useMemo(() => searchTermWarnings(term), [term]);
  const options = useMemo(
    () =>
      Object.fromEntries(
        filterFields.map(([key]) => {
          const candidates = sourceRows.filter((asset) => matches(asset, key));
          if (key === "assetMajorClass") {
            // Order classes by their lowest asset number, ascending.
            const lowestNo = new Map();
            for (const asset of candidates) {
              const name = String(asset.assetMajorClass || "").trim();
              const no = String(asset.assetNo || "");
              if (!name) continue;
              const known = lowestNo.get(name);
              if (known === undefined || (no && (!known || numericCollator.compare(no, known) < 0)))
                lowestNo.set(name, no);
            }
            return [
              key,
              [...lowestNo.keys()].sort((a, b) => {
                const left = lowestNo.get(a);
                const right = lowestNo.get(b);
                if (!left !== !right) return left ? -1 : 1;
                return (
                  numericCollator.compare(String(left), String(right)) ||
                  textCollator.compare(a, b)
                );
              }),
            ];
          }
          return [
            key,
            [
              ...new Set(
                candidates
                  .map((asset) => String(asset[key] || "").trim())
                  .filter(Boolean),
              ),
            ].sort(textCollator.compare),
          ];
        }),
      ),
    [sourceRows, filters],
  );
  const rows = useMemo(
    () =>
      sourceRows
        .filter(
          (asset) =>
            matches(asset) &&
            matchesFlags(asset) &&
            matchesAdvancedSearch(asset, appliedTerm) &&
            (!aiAssetIds || aiAssetIds.has(asset.identityId)),
        )
        .sort(compareByAssetNumber),
    [sourceRows, filters, appliedTerm, aiAssetIds, photoFilter, collaborationFilter, flagged],
  );
  const highlightTermsFor = useMemo(
    () => highlightTermsFactory(appliedTerm, filters),
    [appliedTerm, filters],
  );
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
    Number(Boolean(photoFilter)) +
    Number(Boolean(collaborationFilter)) +
    Number(source !== "all");
  function loadFlagged() {
    requestCollaboration({ action: "flagged" })
      .then((data) =>
        setFlagged({
          photo: new Set(data.photoIds || []),
          open: new Set(data.openIds || []),
          inProgress: new Set(data.inProgressIds || []),
        }),
      )
      .catch(() => {});
  }
  useEffect(() => {
    loadFlagged();
  }, []);
  useEffect(() => {
    setCurrentPage(1);
    setExpandedId(null);
  }, [
    appliedTerm,
    source,
    photoFilter,
    collaborationFilter,
    ...filterFields.map(([key]) => filters[key]),
  ]);
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
    const orderedAssets = [...assets].sort(compareByAssetNumber);
    const index = orderedAssets.findIndex((item) => item.id === asset.id);
    setTerm("");
    setAppliedTerm("");
    setAiReport(null);
    setAiAnalysis(null);
    setAiClarification(null);
    setAiAssetIds(null);
    setSource("all");
    setPhotoFilter("");
    setCollaborationFilter("");
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
  function statusFilterSelects(prefix) {
    return [
      ["photo", "有無照片", photoFilter, setPhotoFilter, photoFilterOptions],
      [
        "collaboration",
        "協作狀態",
        collaborationFilter,
        setCollaborationFilter,
        collaborationFilterOptions,
      ],
    ].map(([key, label, value, onChange, choices]) => (
      <FilterCombo
        id={`${prefix}${key}`}
        key={`${prefix}${key}`}
        label={label}
        onChange={(picked) =>
          onChange(choices.find(([, optionLabel]) => optionLabel === picked)?.[0] ?? "")
        }
        onOpenChange={setOpenFilterId}
        open={openFilterId === `${prefix}${key}`}
        options={choices.map(([, optionLabel]) => optionLabel)}
        placeholder="全部"
        readOnly
        showAllOptions
        value={choices.find(([optionValue]) => optionValue === value)?.[1] ?? ""}
      />
    ));
  }
  // The register covers every row of the current result, not just this page.
  async function exportRegister(format) {
    if (!rows.length || registerExport) return;
    const optionLabel = (options, value) => options.find(([key]) => key === value)?.[1] || value;
    const filterSummary = [
      ...filterFields.filter(([key]) => filters[key]).map(([key, label]) => `${label}：${filters[key]}`),
      ...(source !== "all" ? [`資料類型：${source === "asset" ? "財產" : "物品"}`] : []),
      ...(photoFilter ? [`有無照片：${optionLabel(photoFilterOptions, photoFilter)}`] : []),
      ...(collaborationFilter ? [`協作狀態：${optionLabel(collaborationFilterOptions, collaborationFilter)}`] : []),
      ...(appliedTerm.trim() ? [`關鍵字：${appliedTerm.trim()}`] : []),
      ...(aiAssetIds ? [`智慧查詢：${aiReport?.question || "已套用"}`] : []),
    ];
    const controller = new AbortController();
    registerAbort.current = controller;
    setRegisterExport({ format, fraction: 0, label: "準備中" });
    try {
      const { exportAssetRegister } = await import("./exportRegisterClient");
      const fileName = await exportAssetRegister(
        format,
        rows,
        { printedBy: user?.name || "", filterSummary },
        {
          signal: controller.signal,
          onProgress: (fraction, label) =>
            setRegisterExport({ format, fraction, label }),
        },
      );
      notify(`已匯出 ${rows.length.toLocaleString()} 筆財產清冊：${fileName}`, "success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        notify("已取消匯出。");
      else notify(error instanceof Error ? error.message : "匯出財產清冊失敗。", "error");
    } finally {
      registerAbort.current = null;
      setRegisterExport(null);
    }
  }
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
    setPhotoFilter("");
    setCollaborationFilter("");
  }
  function resetAiState() {
    setAiReport(null);
    setAiAnalysis(null);
    setAiClarification(null);
    setAiAssetIds(null);
  }
  function changeTerm(next) {
    setTerm(next);
    resetAiState();
  }
  // Used by chip removal and picked suggestions: search right away.
  function applyTerm(next) {
    setTerm(next);
    setAppliedTerm(next.trim());
    rememberSearch(next);
    resetAiState();
    setRuleMenuOpen(false);
  }
  function runSearch() {
    const normalizedTerm = normalizeSearchInput(term);
    if (normalizedTerm !== term) setTerm(normalizedTerm);
    setAppliedTerm(normalizedTerm.trim());
    rememberSearch(normalizedTerm);
    setAiReport(null);
    setAiAnalysis(null);
    setAiClarification(null);
    setAiAssetIds(null);
    setRuleMenuOpen(false);
  }
  // The AI hands back the search it would have typed.  Use it only when the
  // local engine reproduces exactly the rows the server found; otherwise keep
  // the server's list so the answer is never different from what was verified.
  function searchRulesReproduce(result) {
    const rules = result.searchRules;
    if (typeof rules !== "string" || result.analysis) return false;
    const uiFilters = result.uiFilters || { photo: "", collaboration: "" };
    if ((uiFilters.photo || uiFilters.collaboration) && !flagged) return false;
    const expected = new Set(result.assetIdentityIds || []);
    let found = 0;
    for (const asset of assets) {
      const hit =
        matchesAdvancedSearch(enrichAsset(asset), rules) &&
        matchesFlags(asset, uiFilters.photo, uiFilters.collaboration);
      if (hit !== expected.has(asset.identityId)) return false;
      if (hit) found += 1;
    }
    return found === expected.size;
  }
  function applyAiResult(result, fallbackQuestion) {
    const asRules = searchRulesReproduce(result);
    const uiFilters = result.uiFilters || { photo: "", collaboration: "" };
    setFilters(Object.fromEntries(filterFields.map(([key]) => [key, ""])));
    setSource("all");
    if (asRules) {
      setPhotoFilter(uiFilters.photo || "");
      setCollaborationFilter(uiFilters.collaboration || "");
      setTerm(result.searchRules); setAppliedTerm(result.searchRules.trim()); rememberSearch(result.searchRules);
      setAiAssetIds(null);
    } else {
      setPhotoFilter("");
      setCollaborationFilter("");
      setAiAssetIds(new Set(result.displayIdentityIds || result.assetIdentityIds || [])); setAppliedTerm("");
    }
    setAiClarification(null); setClarificationText(""); setAiAnalysis(result.analysis || null);
    setAiReport({ question: result.question || fallbackQuestion, modelVersion: result.modelVersion || null, summary: result.summary, explanation: result.explanation, analysisDescription: result.analysisDescription, conditionGroups: result.conditionGroups || [], scopeCount: result.scopeCount, trace: [...(result.trace || []), ...(asRules ? ["轉成可編輯的搜尋條件"] : [])] });
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
    // Already written as search rules: run them here, no AI call needed.
    if (looksLikeRuleSyntax(term)) {
      runSearch();
      return;
    }
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
    searchBoxRef.current?.insert(value);
    setRuleMenuOpen(false);
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
          <div className="compact-search">
            <span className="sr-only">全局關鍵字搜尋</span>
            <KeywordSearchBox
              appliedTerm={appliedTerm}
              distinctValues={distinctValues}
              id="compact-search-input"
              onAiSearch={runAiSearch}
              onApply={applyTerm}
              onSearch={runSearch}
              onTermChange={changeTerm}
              placeholder="輸入後按 Enter 搜尋…"
              term={term}
            />
          </div>
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
                {statusFilterSelects("compact-")}
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
          {statusFilterSelects("")}
        </div>
        <div className="advanced-search">
          <div className="search-field">
            <label htmlFor="global-search-input">全局關鍵字搜尋</label>
            <KeywordSearchBox
              appliedTerm={appliedTerm}
              distinctValues={distinctValues}
              id="global-search-input"
              onAiSearch={runAiSearch}
              onApply={applyTerm}
              onSearch={runSearch}
              onTermChange={changeTerm}
              placeholder="輸入關鍵字，或以自然語言描述需求"
              ref={searchBoxRef}
              term={term}
            />
          </div>
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
          {termWarnings.length > 0 && (
            <ul aria-live="polite" className="search-hints">
              {termWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
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
        <div aria-label="匯出財產清冊" className="result-export" role="group">
          <button
            className="button button-secondary"
            disabled={!rows.length || Boolean(registerExport)}
            onClick={() => exportRegister("pdf")}
            title="依目前的篩選結果產生財產清冊 PDF（含所有分頁）"
            type="button"
          >
            {registerExport?.format === "pdf" ? <><CapsuleSpinner compact />{`產生中 ${Math.round(registerExport.fraction * 100)}%`}</> : "匯出清冊 PDF"}
          </button>
          <button
            className="button button-secondary"
            disabled={!rows.length || Boolean(registerExport)}
            onClick={() => exportRegister("xlsx")}
            title="依目前的篩選結果匯出 Excel，一筆資料一列"
            type="button"
          >
            {registerExport?.format === "xlsx" ? <><CapsuleSpinner compact />{`產生中 ${Math.round(registerExport.fraction * 100)}%`}</> : "匯出 Excel"}
          </button>
          {registerExport && (
            <>
              <button
                className="button button-secondary"
                onClick={() => registerAbort.current?.abort()}
                type="button"
              >
                取消
              </button>
              <span aria-live="polite" className="result-export-status" role="status">
                {registerExport.label}
              </span>
            </>
          )}
        </div>
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
                {pageRows.map((a) => {
                  const detailItems = [
                    { label: "財產區分別", value: a.categoryType, terms: highlightTermsFor("categoryType") },
                    { label: "類型", value: a.sourceType === "asset" ? "財產" : "物品", terms: highlightTermsFor("sourceType") },
                    { label: "財產大類", value: assetMajorClass(a.assetNo), terms: highlightTermsFor("assetMajorClass") },
                    { label: "保管單位", value: a.unitName, terms: highlightTermsFor("unitName") },
                    {
                      label: "使用單位／使用人",
                      value: [a.useUnitName, a.userName].filter(Boolean).join("／"),
                      terms: [...highlightTermsFor("useUnitName"), ...highlightTermsFor("userName")],
                    },
                    { label: "計量單位", value: a.measureUnit, terms: highlightTermsFor("measureUnit") },
                    { label: "購置日期", value: a.acquiredAt, terms: highlightTermsFor("acquiredAt") },
                    { label: "年限", value: a.usefulLife ? `${a.usefulLife} 年` : "—", terms: highlightTermsFor("usefulLife") },
                    { label: "已使用", value: usedDuration(a.acquiredAt), terms: highlightTermsFor("usedDuration") },
                    { label: "原值", value: money(a.originalValue), terms: highlightTermsFor("originalValue"), numeric: true },
                    { label: "累折", value: money(a.depreciation), terms: highlightTermsFor("depreciation"), numeric: true },
                    { label: "淨值", value: money(a.netValue), terms: highlightTermsFor("netValue"), numeric: true },
                    { label: "備註", value: a.notes, terms: highlightTermsFor("notes") },
                  ];
                  return (
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
                              {detailItems.map((item) => (
                                <div
                                  className={`detail-pair ${item.label === "備註" ? "detail-wide" : ""}`}
                                  key={item.label}
                                >
                                  <span>{item.label}</span>
                                  <strong>
                                    <HighlightText
                                      numeric={item.numeric}
                                      terms={item.terms}
                                      value={item.value}
                                    />
                                  </strong>
                                </div>
                              ))}
                            </dl>
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
          loadFlagged();
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
          loadFlagged();
        }}
        onClose={() => setPhotoPickerAsset(null)}
      />
    </section>
  );
}
