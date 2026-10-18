import React from "react";
import { formatNumber } from "../../lib/formatters";

// What the AI search answered: the interpreted question, an analysis summary, or a
// follow-up question the user can answer by choice or in their own words.
export function AiAnswerPanels({
  aiReport,
  aiAnalysis,
  aiClarification,
  aiBusy,
  rowCount,
  clarificationText,
  onClarificationTextChange,
  onAnswerClarification,
}) {
  return (
    <>
      {aiReport && (
        <aside aria-live="polite" className="ai-search-report">
          <strong>智慧查詢結果</strong>
          <span>提問：{aiReport.question}</span>
          {aiReport.modelVersion && <span>推理模型：{aiReport.modelVersion}</span>}
          <span>{aiReport.summary}</span>
          {aiReport.conditionGroups.some((group) => group.length) ? (
            <span className="ai-report-conditions">
              查詢條件：
              <span className="ai-condition-chips">
                {aiReport.conditionGroups.map((group, groupIndex) => (
                  <React.Fragment key={`group-${groupIndex}`}>
                    {groupIndex > 0 && <i className="ai-condition-or">或</i>}
                    {group.map((rule) => (
                      <code className="ai-condition-chip" key={`${groupIndex}-${rule}`}>
                        {rule}
                      </code>
                    ))}
                  </React.Fragment>
                ))}
              </span>
            </span>
          ) : (
            <span>{aiReport.analysisDescription || aiReport.explanation}</span>
          )}
          <span>
            {aiAnalysis
              ? `${typeof aiAnalysis.matchCount === "number" ? `符合分析條件共 ${formatNumber(aiAnalysis.matchCount)} 筆資料；` : ""}分析範圍共 ${formatNumber(aiReport.scopeCount ?? 0)} 筆資料。`
              : `共找到 ${formatNumber(rowCount)} 筆資料。`}
            {aiReport.trace.length ? ` 已執行：${aiReport.trace.join("、")}。` : ""}
          </span>
        </aside>
      )}
      {aiAnalysis && (
        <aside aria-live="polite" className="ai-analysis">
          <strong>分析摘要</strong>
          <span>{aiAnalysis.title}</span>
          <span>{aiAnalysis.summary}</span>
          {aiAnalysis.value ? (
            <b className="ai-analysis-value">
              {aiAnalysis.value}
              {aiAnalysis.unit}
            </b>
          ) : (
            <div className="ai-analysis-table-wrap">
              <table>
                <thead>
                  <tr>
                    {aiAnalysis.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {aiAnalysis.rows.map((row, index) => (
                    <tr key={`${row[0]}-${index}`}>
                      {row.map((value, cellIndex) => (
                        <td key={cellIndex}>{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </aside>
      )}
      {aiClarification && (
        <aside aria-live="polite" className="ai-clarification">
          <strong>想再確認一下</strong>
          <span>{aiClarification.prompt}</span>
          <div className="ai-clarification-options">
            {aiClarification.options.map((option) => (
              <button
                className="button button-secondary"
                disabled={aiBusy}
                key={option.id}
                onClick={() => onAnswerClarification(option.id)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="ai-clarification-custom-row">
            <label className="ai-clarification-custom">
              或用自己的話說明
              <input
                disabled={aiBusy}
                onChange={(event) => onClarificationTextChange(event.target.value)}
                placeholder="例如：放在消防班的財產"
                value={clarificationText}
              />
            </label>
            <button
              className="button button-primary ai-clarification-submit"
              disabled={aiBusy || !clarificationText.trim()}
              onClick={() => onAnswerClarification("custom")}
              type="button"
            >
              依這個說明查詢
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
