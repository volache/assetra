import React, { useEffect, useMemo, useRef, useState } from "react";

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

function fromValue(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
    ? new Date(year, month - 1, day)
    : null;
}

function toValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function rocDate(date) {
  return `${String(date.getFullYear() - 1911).padStart(3, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function isSameDay(left, right) {
  return left && right && left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

export function DatePicker({ id, label, value, onChange }) {
  const rootRef = useRef(null);
  const selected = fromValue(value);
  const today = useMemo(() => new Date(), []);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => selected || today);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const cells = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: last.getDate() }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1)),
  ];

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [open]);

  function choose(date) {
    onChange(toValue(date));
    setOpen(false);
  }

  return (
    <label className="filter-field date-picker-field" ref={rootRef}>
      {label}
      <span className="date-picker">
        <button
          aria-controls={`${id}-calendar`}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={`date-picker-trigger ${open ? "is-open" : ""}`}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
          type="button"
        >
          <span>{selected ? rocDate(selected) : "YYY/MM/DD"}</span>
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><rect height="14" rx="2" stroke="currentColor" strokeWidth="1.8" width="15" x="4.5" y="6.5" /><path d="M8 3.5v5m8-5v5M4.5 10.5h15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>
        </button>
        {open ? (
          <span className="date-picker-popover" id={`${id}-calendar`} role="dialog" aria-label={`${label}日期選擇器`}>
            <span className="date-picker-head">
              <button aria-label="上個月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} type="button">‹</button>
              <strong>{String(month.getFullYear() - 1911).padStart(3, "0")} 年 {String(month.getMonth() + 1).padStart(2, "0")} 月</strong>
              <button aria-label="下個月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} type="button">›</button>
            </span>
            <span className="date-picker-weekdays">{weekdays.map((day) => <i key={day}>{day}</i>)}</span>
            <span className="date-picker-days">
              {cells.map((date, index) => date ? (
                <button className={`${isSameDay(date, selected) ? "is-selected" : ""} ${isSameDay(date, today) ? "is-today" : ""}`} key={toValue(date)} onClick={() => choose(date)} type="button">{date.getDate()}</button>
              ) : <i aria-hidden="true" key={`blank-${index}`} />)}
            </span>
            <span className="date-picker-foot">
              <button onClick={() => { onChange(""); setOpen(false); }} type="button">清除</button>
              <button onClick={() => { setMonth(today); choose(today); }} type="button">今天</button>
            </span>
          </span>
        ) : null}
      </span>
    </label>
  );
}
