import React, { useEffect, useRef, useState } from "react";
import { HighlightText } from "../../components/HighlightText";
import { normalized, searchRuleGroups } from "./search";

export { HighlightText };

// How long typing may pause before the filters are re-run.
const typingPauseMs = 150;

export function FilterCombo({
  id,
  label,
  value,
  options,
  open,
  onChange,
  onOpenChange,
  showAllOptions = false,
  menuPlacement = "below",
  placeholder,
  readOnly = false,
}) {
  const rootRef = useRef(null);
  // What is typed lives here first.  The page-wide filters (and the table
  // under them) only hear about it once the input method has finished a
  // syllable or the typing pauses, so each Bopomofo symbol no longer triggers
  // a full re-filter.
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  const timer = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    // Outside changes (clear, choosing an option, the AI) replace the draft.
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (next) => {
    clearTimeout(timer.current);
    timer.current = null;
    if (next === committed.current) return;
    committed.current = next;
    onChangeRef.current(next);
  };
  const commitSoon = (next) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), typingPauseMs);
  };
  const suggestions = (showAllOptions
    ? options
    : options.filter((option) => normalized(option).includes(normalized(draft))))
    .slice(0, 100);
  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!rootRef.current?.contains(event.target)) onOpenChange(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [open, onOpenChange]);
  return (
    <label className="filter-field">
      {label}
      <span className="filter-combobox" ref={rootRef}>
        <input
          aria-autocomplete="list"
          aria-controls={`${id}-options`}
          aria-expanded={open}
          autoComplete="off"
          readOnly={readOnly}
          value={draft}
          onBlur={(e) => {
            commit(e.target.value);
            setTimeout(
              () =>
                onOpenChange((current) => (current === id ? null : current)),
              120,
            );
          }}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            onOpenChange(id);
            // Mid-composition text is not a real value yet.
            if (!e.nativeEvent.isComposing) commitSoon(next);
          }}
          onCompositionEnd={(e) => commitSoon(e.target.value)}
          onFocus={() => onOpenChange(id)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onOpenChange(null);
            if (e.key === "Enter" && !e.nativeEvent.isComposing) commit(e.currentTarget.value);
          }}
          placeholder={placeholder ?? `全部${label}`}
        />
        <button
          aria-label={`開啟${label}選項`}
          className={`combo-toggle ${open ? "open" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onOpenChange(open ? null : id)}
          type="button"
        >
          <span aria-hidden="true" />
        </button>
        {open && (
          <span className={`combo-menu ${menuPlacement === "above" ? "combo-menu-above" : ""}`} id={`${id}-options`} role="listbox">
            {suggestions.length ? (
              suggestions.map((option) => (
                <button
                  key={option}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setDraft(option);
                    commit(option);
                    onOpenChange(null);
                  }}
                  role="option"
                  type="button"
                >
                  {option}
                </button>
              ))
            ) : (
              <span className="combo-empty">沒有符合的選項</span>
            )}
          </span>
        )}
      </span>
    </label>
  );
}

export function SearchRuleMenu({ open, onInsert, onToggle }) {
  return (
    <span className="search-rule-menu">
      <button
        aria-expanded={open}
        aria-haspopup="true"
        className="search-rule-trigger"
        onClick={onToggle}
        type="button"
      >
        加入規則 <span aria-hidden="true" />
      </button>
      {open && (
        <span className="search-rule-popover">
          <strong>搜尋規則</strong>
          {[0, 1, 2].map((column) => (
            <span className="search-rule-column" key={column}>
              {searchRuleGroups
                .filter((group) => group.column === column)
                .map((group) => (
                  <span className="search-rule-group" key={group.title}>
                    <b>{group.title}</b>
                    {group.rules.map(([label, value, layout]) => (
                      <button
                        className={layout === "stacked" ? "stacked" : ""}
                        key={label}
                        onClick={() => onInsert(value)}
                        type="button"
                      >
                        <span>{label}</span>
                        <code>{value || "輸入文字"}</code>
                      </button>
                    ))}
                  </span>
                ))}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
