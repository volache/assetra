import React, { useEffect, useRef } from "react";

export function UserFilterCombo({
  id,
  label,
  value,
  options,
  open,
  onChange,
  onOpenChange,
}) {
  const selected =
    options.find((option) => option.value === value) || options[0];
  return (
    <label className="filter-field">
      {label}
      <span className="filter-combobox">
        <input
          aria-controls={`${id}-options`}
          aria-expanded={open}
          aria-haspopup="listbox"
          readOnly
          placeholder={options[0]?.label}
          value={value ? selected?.label || "" : ""}
          onFocus={() => onOpenChange(id)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onOpenChange(null);
          }}
        />
        <button
          aria-label={`開啟${label}選項`}
          className={`combo-toggle ${open ? "open" : ""}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onOpenChange(open ? null : id)}
          type="button"
        >
          <span aria-hidden="true" />
        </button>
        {open && (
          <span className="combo-menu" id={`${id}-options`} role="listbox">
            {options.map((option) => (
              <button
                aria-selected={option.value === value}
                key={option.value || "all"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  onOpenChange(null);
                }}
                role="option"
                type="button"
              >
                {option.label}
              </button>
            ))}
          </span>
        )}
      </span>
    </label>
  );
}

export function FormCombo({
  id,
  label,
  value,
  options,
  open,
  onChange,
  onOpenChange,
}) {
  const selected =
    options.find((option) => option.value === value) || options[0];
  const comboRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!comboRef.current?.contains(event.target)) onOpenChange(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, onOpenChange]);
  return (
    <label className="editor-combo" ref={comboRef}>
      {label}
      <span className="filter-combobox">
        <input
          aria-controls={`${id}-options`}
          aria-expanded={open}
          aria-haspopup="listbox"
          readOnly
          value={selected?.label || ""}
          onFocus={() => onOpenChange(id)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onOpenChange(null);
          }}
        />
        <button
          aria-label={`開啟${label}選項`}
          className={`combo-toggle ${open ? "open" : ""}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onOpenChange(open ? null : id)}
          type="button"
        >
          <span aria-hidden="true" />
        </button>
        {open && (
          <span className="combo-menu" id={`${id}-options`} role="listbox">
            {options.map((option) => (
              <button
                aria-selected={option.value === value}
                key={option.value || "empty"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  onOpenChange(null);
                }}
                role="option"
                type="button"
              >
                {option.label}
              </button>
            ))}
          </span>
        )}
      </span>
    </label>
  );
}
