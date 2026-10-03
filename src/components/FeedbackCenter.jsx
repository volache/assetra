import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const FeedbackContext = createContext(null);

function messageFor(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function FeedbackProvider({ children }) {
  const [notices, setNotices] = useState([]);
  const [pending, setPending] = useState([]);
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
  const startLoading = useCallback((label = "處理中…", kind = "network") => {
    const id = createId();
    setPending((current) => [...current, { id, label, kind }]);
    return id;
  }, []);
  const stopLoading = useCallback((id) => {
    setPending((current) => current.filter((entry) => entry.id !== id));
  }, []);
  const run = useCallback(async (operation, options = {}) => {
    const id = startLoading(options.loading || "處理中…", "action");
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
    } finally {
      stopLoading(id);
    }
  }, [notify, startLoading, stopLoading]);

  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const id = startLoading("正在與伺服器連線…");
      try {
        return await originalFetch(...args);
      } finally {
        stopLoading(id);
      }
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [startLoading, stopLoading]);

  const value = useMemo(() => ({ notify, run }), [notify, run]);
  const activeAction = pending.find((entry) => entry.kind === "action");
  const loadingLabel = activeAction?.label || pending.at(-1)?.label;
  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="feedback-center" aria-live="polite" aria-relevant="additions">
        {pending.length > 0 && (
          <p className="feedback-loading" role="status">
            <span aria-hidden="true" className="feedback-spinner" />
            {loadingLabel}
          </p>
        )}
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
