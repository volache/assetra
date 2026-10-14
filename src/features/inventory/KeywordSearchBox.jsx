import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clearSearchHistory,
  loadSearchHistory,
} from "./searchHistory";
import {
  normalizeSearchInput,
  splitSearchTerm,
  suggestionsForToken,
  tokenAtCaret,
  tokenizeSearch,
} from "./search";

// One search box shared by the main panel and the sticky compact bar.  The
// full query stays in `term`; finished tokens are drawn as chips and only the
// token being typed lives in the input.
export const KeywordSearchBox = forwardRef(function KeywordSearchBox(
  {
    appliedTerm,
    distinctValues,
    id,
    onAiSearch,
    onApply,
    onSearch,
    onTermChange,
    placeholder,
    term,
  },
  ref,
) {
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [history, setHistory] = useState([]);
  const { head, draft } = useMemo(() => splitSearchTerm(term), [term]);
  const chips = useMemo(() => tokenizeSearch(head), [head]);
  const appliedTokens = useMemo(
    () => new Set(tokenizeSearch(appliedTerm)),
    [appliedTerm],
  );
  const token = tokenAtCaret(draft, Math.min(caret, draft.length));
  const typed = useMemo(
    () => suggestionsForToken(token.raw, distinctValues),
    [token.raw, distinctValues],
  );
  // An empty box offers recent searches instead of field suggestions.
  const showHistory = !term.trim() && history.length > 0;
  const historyItems = useMemo(
    () =>
      history.map((entry) => ({
        kind: "history",
        label: entry,
        hint: "最近搜尋",
        replacement: entry,
      })),
    [history],
  );
  const suggestions = showHistory ? historyItems : typed.items;
  const suggestionTotal = showHistory ? historyItems.length : typed.total;
  const helperNote = showHistory ? "最近搜尋" : typed.note;
  const calendar = showHistory ? null : typed.calendar;
  const listOpen = open && suggestions.length > 0;
  const dateOpen = open && Boolean(calendar);
  const listPanelOpen =
    open && !calendar && (suggestions.length > 0 || Boolean(helperNote));
  const panelOpen = listPanelOpen || dateOpen;
  // Anchor the calendar under the token being typed, kept inside the box.
  const calendarLeft = Math.max(
    0,
    Math.min(
      inputRef.current?.offsetLeft ?? 0,
      (rootRef.current?.clientWidth ?? 0) - 296,
    ),
  );

  function placeCaret(position) {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(position, position);
    });
  }

  useImperativeHandle(ref, () => ({
    // Insert a rule snippet at the caret of the token being typed.
    insert(value) {
      const input = inputRef.current;
      const start = input?.selectionStart ?? draft.length;
      const end = input?.selectionEnd ?? draft.length;
      const before = draft.slice(0, start);
      const after = draft.slice(end);
      const padding =
        before && !/\s$/.test(before) && !value.startsWith(" ") ? " " : "";
      // An empty pair of quotes leaves the caret between them.
      const nextCaret =
        (before + padding).length + (value === '""' ? 1 : value.length);
      onTermChange(`${head}${before}${padding}${value}${after}`);
      setCaret(nextCaret);
      setOpen(true);
      placeCaret(nextCaret);
    },
    // Add a finished condition (from the comparison form) as a chip.
    append(value) {
      const base = term.trimEnd();
      onTermChange(`${base ? `${base} ` : ""}${value} `);
      setCaret(0);
      placeCaret(0);
    },
    focus: () => inputRef.current?.focus(),
  }));

  function accept(suggestion) {
    if (suggestion.kind === "history") {
      setActive(-1);
      setOpen(false);
      onApply(suggestion.replacement);
      return;
    }
    const before = draft.slice(0, token.start);
    const after = draft.slice(token.end);
    const nextDraft = `${before}${suggestion.replacement}${after}`;
    const next = `${head}${nextDraft}`;
    const nextCaret = (before + suggestion.replacement).length;
    setActive(-1);
    setCaret(nextCaret);
    // A picked value is a complete condition, so search straight away.
    if (suggestion.kind === "value") {
      onApply(next);
      setOpen(false);
    } else {
      onTermChange(next);
    }
    placeCaret(nextCaret);
  }

  function removeChip(index) {
    const cleaned = [];
    chips.forEach((chip, position) => {
      if (position === index) return;
      // Drop an "|" that would lead the query or follow another "|".
      if (chip === "|" && (!cleaned.length || cleaned[cleaned.length - 1] === "|"))
        return;
      cleaned.push(chip);
    });
    while (cleaned[cleaned.length - 1] === "|") cleaned.pop();
    onApply(`${cleaned.length ? `${cleaned.join(" ")} ` : ""}${draft}`);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <span className="keyword-box" ref={rootRef}>
      <span className="search-box">
        {chips.map((chip, index) =>
          chip === "|" ? (
            <i className="search-chip-or" key={`or-${index}`}>
              或
            </i>
          ) : (
            <span
              className={`search-chip ${appliedTokens.has(chip) ? "" : "pending"}`}
              key={`${index}-${chip}`}
              title={appliedTokens.has(chip) ? "已套用" : "尚未搜尋，按 Enter 套用"}
            >
              <code>{chip}</code>
              <button
                aria-label={`移除條件 ${chip}`}
                onClick={() => removeChip(index)}
                type="button"
              >
                ✕
              </button>
            </span>
          ),
        )}
        <input
          id={id}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            const raw = event.target.value;
            const position = event.target.selectionStart ?? raw.length;
            // Leave text alone while an IME composition is still open.
            let next = event.nativeEvent.isComposing
              ? raw
              : normalizeSearchInput(raw);
            // Quote helper: a typed " opens a pair, and typing the closing "
            // steps over the one that was added automatically.
            if (
              !event.nativeEvent.isComposing &&
              next.length === draft.length + 1 &&
              next[position - 1] === '"'
            ) {
              const quotesBefore = (next.slice(0, position - 1).match(/"/g) || []).length;
              const previous = next[position - 2];
              if (quotesBefore % 2 === 1) {
                if (next[position] === '"')
                  next = next.slice(0, position - 1) + next.slice(position);
              } else if (!previous || /[\s|:~\-]/.test(previous)) {
                next = `${next.slice(0, position)}"${next.slice(position)}`;
              }
            }
            onTermChange(`${head}${next}`);
            setCaret(position);
            setOpen(true);
            setActive(-1);
            if (next !== raw) placeCaret(position);
          }}
          onClick={(event) => setCaret(event.target.selectionStart ?? 0)}
          onCompositionEnd={(event) => {
            const next = normalizeSearchInput(event.target.value);
            if (next !== event.target.value) onTermChange(`${head}${next}`);
            setCaret(event.target.selectionStart ?? next.length);
          }}
          onFocus={() => {
            setHistory(loadSearchHistory());
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (listOpen && event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => (index + 1) % suggestions.length);
              return;
            }
            if (listOpen && event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) =>
                index <= 0 ? suggestions.length - 1 : index - 1,
              );
              return;
            }
            if (
              listOpen &&
              event.key === "Tab" &&
              !event.shiftKey &&
              !(showHistory && active < 0)
            ) {
              event.preventDefault();
              accept(suggestions[Math.max(active, 0)]);
              return;
            }
            if (panelOpen && event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              return;
            }
            if (
              event.key === "Backspace" &&
              draft &&
              !event.nativeEvent.isComposing &&
              event.target.selectionStart === event.target.selectionEnd
            ) {
              // Deleting the opening quote of an empty "" pair removes both.
              const position = event.target.selectionStart;
              if (
                draft[position - 1] === '"' &&
                draft[position] === '"' &&
                ((draft.slice(0, position - 1).match(/"/g) || []).length % 2 === 0)
              ) {
                event.preventDefault();
                onTermChange(
                  `${head}${draft.slice(0, position - 1)}${draft.slice(position + 1)}`,
                );
                setCaret(position - 1);
                placeCaret(position - 1);
                return;
              }
            }
            if (
              event.key === "Backspace" &&
              !draft &&
              term.trim() &&
              !event.nativeEvent.isComposing
            ) {
              // Pull the last chip back into the box for editing, or delete
              // a trailing "|" outright.
              event.preventDefault();
              let trimmed = term.trimEnd();
              if (trimmed.endsWith("|"))
                trimmed = trimmed.slice(0, -1).trimEnd();
              onTermChange(trimmed);
              setCaret(trimmed.length);
              return;
            }
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (listOpen && active >= 0) {
              accept(suggestions[active]);
              return;
            }
            setOpen(false);
            if (event.ctrlKey || event.metaKey) onAiSearch();
            else onSearch();
          }}
          onKeyUp={(event) => {
            if (event.key !== "Enter")
              setCaret(event.target.selectionStart ?? 0);
          }}
          placeholder={chips.length ? "" : placeholder}
          ref={inputRef}
          value={draft}
        />
      </span>
      {listPanelOpen && (
        <span
          className="search-popover"
          onMouseDown={(event) => event.preventDefault()}
          role="listbox"
        >
          {helperNote && <span className="search-popover-note">{helperNote}</span>}
          {suggestions.map((suggestion, index) => (
            <button
              aria-selected={index === active}
              className={index === active ? "active" : ""}
              key={`${suggestion.kind}-${suggestion.label}`}
              onClick={() => accept(suggestion)}
              role="option"
              type="button"
            >
              <span>{suggestion.label}</span>
              <small>{suggestion.hint}</small>
            </button>
          ))}
          {showHistory && (
            <button
              className="search-popover-clear"
              onClick={() => {
                clearSearchHistory();
                setHistory([]);
              }}
              type="button"
            >
              清除搜尋記錄
            </button>
          )}
          {suggestionTotal > suggestions.length && (
            <span className="search-popover-note">
              還有 {(suggestionTotal - suggestions.length).toLocaleString()} 筆，繼續輸入以縮小範圍
            </span>
          )}
        </span>
      )}
      {dateOpen && (
        <InlineCalendar
          addSuggestion={suggestions[0]}
          left={calendarLeft}
          note={helperNote}
          onAdd={accept}
          onPick={(roc) =>
            accept({
              kind: "value",
              label: roc,
              replacement: `${calendar.prefix}${roc} `,
            })
          }
        />
      )}
    </span>
  );
});

const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];
const pad = (value, length = 2) => String(value).padStart(length, "0");

// The same calendar as the shared DatePicker, floated under the token being
// typed; picking a day writes a ROC date (e.g. 110/01/01) into the token.
function InlineCalendar({ addSuggestion, left, note, onAdd, onPick }) {
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: month.getDay() }, () => null),
    ...Array.from({ length: lastDay }, (_, index) => index + 1),
  ];
  const roc = (year, monthIndex, day) =>
    `${pad(year - 1911, 3)}/${pad(monthIndex + 1)}/${pad(day)}`;
  const shift = (delta) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  return (
    <span
      aria-label="選擇日期"
      className="date-picker-popover search-date-popover"
      onMouseDown={(event) => event.preventDefault()}
      role="dialog"
      style={{ insetInlineStart: left }}
    >
      {note && <span className="search-popover-note">{note}</span>}
      <span className="date-picker-head">
        <button aria-label="上一年" onClick={() => shift(-12)} type="button">«</button>
        <button aria-label="上個月" onClick={() => shift(-1)} type="button">‹</button>
        <strong>
          {pad(month.getFullYear() - 1911, 3)} 年 {pad(month.getMonth() + 1)} 月
        </strong>
        <button aria-label="下個月" onClick={() => shift(1)} type="button">›</button>
        <button aria-label="下一年" onClick={() => shift(12)} type="button">»</button>
      </span>
      <span className="date-picker-weekdays">
        {weekdayNames.map((name) => (
          <i key={name}>{name}</i>
        ))}
      </span>
      <span className="date-picker-days">
        {cells.map((day, index) =>
          day ? (
            <button
              className={
                today.getFullYear() === month.getFullYear() &&
                today.getMonth() === month.getMonth() &&
                today.getDate() === day
                  ? "is-today"
                  : ""
              }
              key={day}
              onClick={() => onPick(roc(month.getFullYear(), month.getMonth(), day))}
              type="button"
            >
              {day}
            </button>
          ) : (
            <i aria-hidden="true" key={`blank-${index}`} />
          ),
        )}
      </span>
      <span className="date-picker-foot">
        <button
          onClick={() =>
            onPick(roc(today.getFullYear(), today.getMonth(), today.getDate()))
          }
          type="button"
        >
          今天
        </button>
        {addSuggestion && (
          <button onClick={() => onAdd(addSuggestion)} type="button">
            加入 {addSuggestion.replacement.trim().split(":").pop()}
          </button>
        )}
      </span>
    </span>
  );
}
