import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

const FeedbackContext = createContext(null);

export function CapsuleSpinner({ compact = false }) {
  return (
    <span
      aria-hidden="true"
      className={`capsule-spinner${compact ? " is-compact" : ""}`}
    >
      <i className="is-red" />
      <i className="is-blue" />
      <i className="is-green" />
    </span>
  );
}

function messageFor(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function FeedbackProvider({ children }) {
  const [notices, setNotices] = useState([]);
  const nextId = useRef(0);

  const createId = () => `${Date.now()}-${++nextId.current}`;
  const notify = useCallback((message, type = "success") => {
    if (!message) return;
    const id = createId();
    setNotices((current) => [...current, { id, message, type }].slice(-3));
    window.setTimeout(
      () => setNotices((current) => current.filter((notice) => notice.id !== id)),
      type === "error" ? 7000 : 5000,
    );
  }, []);
  const copyNotice = useCallback(async (id, message) => {
    try {
      await navigator.clipboard.writeText(String(message));
      setNotices((current) => current.map((notice) => (
        notice.id === id ? { ...notice, copied: true } : notice
      )));
    } catch {
      // 即使瀏覽器拒絕剪貼簿權限，訊息本身仍可讓使用者手動選取複製。
    }
  }, []);
  const run = useCallback(async (operation, options = {}) => {
    try {
      const result = await operation();
      notify(options.success, "success");
      return result;
    } catch (error) {
      notify(
        typeof options.error === "function"
          ? options.error(error)
          : options.error || messageFor(error, "操作失敗，請再試一次。"),
        "error",
      );
      throw error;
    }
  }, [notify]);

  const value = useMemo(() => ({ notify, run }), [notify, run]);
  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="feedback-center" aria-live="polite" aria-relevant="additions">
        {notices.map((notice) => (
          <button
            className={`feedback-toast is-${notice.type}${notice.copied ? " is-copied" : ""}`}
            key={notice.id}
            type="button"
            onClick={() => copyNotice(notice.id, notice.message)}
            title="點擊複製提示訊息"
            aria-label={`複製提示訊息：${notice.message}`}
          >
            <span className="feedback-toast-message">{notice.message}</span>
          </button>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error("useFeedback 必須在 FeedbackProvider 中使用。");
  return feedback;
}
