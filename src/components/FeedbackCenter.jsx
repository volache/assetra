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
          <p className={`feedback-toast is-${notice.type}`} key={notice.id} role={notice.type === "error" ? "alert" : "status"}>
            {notice.message}
          </p>
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
