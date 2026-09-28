import React, { useEffect, useRef } from "react";
import { HighlightText } from "../../components/HighlightText";
import { normalized, searchRuleGroups } from "./search";

export { HighlightText };

export function FilterCombo({
  id,
  label,
  value,
  options,
  open,
  onChange,
  onOpenChange,
}) {
  const rootRef = useRef(null);
  const suggestions = options
    .filter((option) => normalized(option).includes(normalized(value)))
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
          value={value}
          onBlur={() =>
            setTimeout(
              () =>
                onOpenChange((current) => (current === id ? null : current)),
              120,
            )
          }
          onChange={(e) => {
            onChange(e.target.value);
            onOpenChange(id);
          }}
          onFocus={() => onOpenChange(id)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onOpenChange(null);
          }}
          placeholder={`全部${label}`}
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
          <span className="combo-menu" id={`${id}-options`} role="listbox">
            {suggestions.length ? (
              suggestions.map((option) => (
                <button
                  key={option}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(option);
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
          {searchRuleGroups.map((group) => (
            <span className="search-rule-group" key={group.title}>
              <b>{group.title}</b>
              {group.rules.map(([label, value]) => (
                <button
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
      )}
    </span>
  );
}
