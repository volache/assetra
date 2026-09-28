import React, { useEffect, useState } from "react";
import { supabase } from "../../supabase";
import { rocDateTime } from "../../lib/formatters";

export function CollaborationNotes({ identityId }) {
  const [collaborations, setCollaborations] = useState([]);
  const [actor, setActor] = useState(null);
  const [draft, setDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const invoke = async (body) => {
    const { data, error: requestError } = await supabase.functions.invoke(
      "manage-collaborations",
      { body: { identityId, ...body } },
    );
    if (requestError) {
      const detail = await requestError.context?.json().catch(() => null);
      throw new Error(detail?.error || requestError.message);
    }
    if (data?.error) throw new Error(data.error);
    setCollaborations(data?.collaborations || []);
    setActor(data?.actor || null);
    setLoaded(true);
  };
  const refresh = async () => {
    if (!identityId || busy) return;
    setBusy(true);
    setError("");
    try {
      await invoke({ action: "list" });
    } catch (requestError) {
      setError(requestError.message || "無法載入共同筆記。");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setCollaborations([]);
    setActor(null);
    setDraft("");
    setReplyDrafts({});
    setError("");
    setLoaded(false);
  }, [identityId]);
  const submit = async (action, collaborationId, body) => {
    if (!identityId || busy) return;
    setBusy(true);
    setError("");
    try {
      await invoke({ action, collaborationId, body });
      if (action === "create") setDraft("");
      if (action === "comment")
        setReplyDrafts((current) => ({ ...current, [collaborationId]: "" }));
    } catch (requestError) {
      setError(requestError.message || "無法儲存共同筆記。");
    } finally {
      setBusy(false);
    }
  };
  const labelFor = (status) =>
    status === "resolved"
      ? "已完成"
      : status === "in_progress"
        ? "處理中"
        : "待處理";
  return (
    <section className="collaboration-notes">
      <header>
        <div>
          <p className="eyebrow">SHARED NOTES</p>
          <h3>共同筆記</h3>
          <p>記錄不會覆寫舊系統清冊，並會隨此財物的穩定識別鍵延續。</p>
        </div>
        {!loaded && (
          <button
            className="button button-secondary collaboration-load"
            disabled={busy || !identityId}
            onClick={refresh}
            type="button"
          >
            {busy ? "載入中…" : "查看筆記"}
          </button>
        )}
      </header>
      {loaded && (
        <>
          <form
            className="collaboration-compose"
            onSubmit={(event) => {
              event.preventDefault();
              submit("create", null, draft);
            }}
          >
            <label>
              新增共同筆記
              <textarea
                disabled={busy}
                maxLength="2000"
                onChange={(event) => setDraft(event.target.value)}
                placeholder="例如：現場已確認標籤脫落，待補發。"
                value={draft}
              />
            </label>
            <div>
              <small>{draft.length}/2,000</small>
              <button
                className="button button-primary"
                disabled={busy || !draft.trim()}
                type="submit"
              >
                新增筆記
              </button>
            </div>
          </form>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="collaboration-timeline">
            {collaborations.length ? (
              collaborations.map((note) => {
                const canResolve =
                  actor && (actor.isAdmin || actor.id === note.created_by);
                const closed = note.status === "resolved";
                return (
                  <article
                    className={`collaboration-entry ${closed ? "is-resolved" : ""}`}
                    key={note.id}
                  >
                    <header>
                      <div>
                        <span className="collaboration-status">
                          {labelFor(note.status)}
                        </span>
                        <strong>{note.created_by_name}</strong>
                        <time dateTime={note.created_at}>
                          {rocDateTime(note.created_at)}
                        </time>
                      </div>
                      {!closed && canResolve && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => submit("resolve", note.id)}
                          type="button"
                        >
                          完成處理
                        </button>
                      )}
                    </header>
                    <p className="collaboration-body">{note.body}</p>
                    {note.events
                      .filter((event) => event.event_type !== "created")
                      .map((event) => (
                        <div
                          className={`collaboration-event is-${event.event_type}`}
                          key={event.id}
                        >
                          {event.event_type === "commented" ? (
                            <>
                              <strong>{event.actor_name}</strong>
                              <time dateTime={event.created_at}>
                                {rocDateTime(event.created_at)}
                              </time>
                              <p>{event.payload?.body}</p>
                            </>
                          ) : (
                            <>
                              <strong>{event.actor_name}</strong>
                              <span>完成處理</span>
                              <time dateTime={event.created_at}>
                                {rocDateTime(event.created_at)}
                              </time>
                            </>
                          )}
                        </div>
                      ))}
                    {!closed && (
                      <form
                        className="collaboration-reply"
                        onSubmit={(event) => {
                          event.preventDefault();
                          submit(
                            "comment",
                            note.id,
                            replyDrafts[note.id] || "",
                          );
                        }}
                      >
                        <label>
                          <span className="sr-only">補充內容</span>
                          <input
                            disabled={busy}
                            maxLength="2000"
                            onChange={(event) =>
                              setReplyDrafts((current) => ({
                                ...current,
                                [note.id]: event.target.value,
                              }))
                            }
                            placeholder="補充處理進度…"
                            value={replyDrafts[note.id] || ""}
                          />
                        </label>
                        <button
                          className="button button-secondary"
                          disabled={
                            busy || !(replyDrafts[note.id] || "").trim()
                          }
                          type="submit"
                        >
                          補充
                        </button>
                      </form>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="collaboration-empty">
                <strong>還沒有共同筆記</strong>
                <p>先留下第一筆現場查核或處理事項，供同仁接續追蹤。</p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
