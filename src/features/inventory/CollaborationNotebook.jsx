import React, { useEffect, useState } from "react";
import { rocDateTime } from "../../lib/formatters";
import {
  collaborationKindIsTask,
  collaborationKindLabels,
  collaborationNoteCategoryLabels,
  collaborationStatusLabel,
  requestCollaboration,
} from "../collaboration/api";

const taskKinds = ["tag_missing", "disposal_candidate", "custodian_change", "location_change", "other"];

export function CollaborationNotebook({ identityId, autoLoad = false, focusCollaborationId, onChanged }) {
  const [collaborations, setCollaborations] = useState([]);
  const [actor, setActor] = useState(null);
  const [recordType, setRecordType] = useState("note");
  const [noteCategory, setNoteCategory] = useState("general");
  const [taskKind, setTaskKind] = useState("tag_missing");
  const [draft, setDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const invoke = async (body) => {
    const data = await requestCollaboration({ identityId, ...body });
    setCollaborations(data?.collaborations || []);
    setActor(data?.actor || null);
    setLoaded(true);
  };
  const refresh = async () => {
    if (!identityId || busy) return;
    setBusy(true);
    setError("");
    try { await invoke({ action: "list" }); }
    catch (requestError) { setError(requestError.message || "無法載入協作紀錄。"); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    setCollaborations([]); setActor(null); setDraft(""); setReplyDrafts({}); setError(""); setLoaded(false);
  }, [identityId]);
  useEffect(() => {
    if (!autoLoad || !identityId) return undefined;
    refresh();
    // refresh intentionally runs only when this asset is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, identityId]);
  useEffect(() => {
    if (!loaded || !focusCollaborationId) return;
    document.getElementById(`collaboration-${focusCollaborationId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focusCollaborationId, loaded]);

  const submit = async (action, collaborationId, body) => {
    if (!identityId || busy) return;
    setBusy(true); setError("");
    try {
      await invoke({ action, collaborationId, body });
      onChanged?.();
      if (action === "comment") setReplyDrafts((current) => ({ ...current, [collaborationId]: "" }));
    } catch (requestError) { setError(requestError.message || "無法儲存協作紀錄。"); }
    finally { setBusy(false); }
  };
  const createRecord = async (event) => {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await invoke({ action: "create", body: draft, kind: recordType === "note" ? "note" : taskKind, noteCategory });
      setDraft(""); onChanged?.();
    } catch (requestError) { setError(requestError.message || "無法儲存協作紀錄。"); }
    finally { setBusy(false); }
  };

  return (
    <section className="collaboration-notes">
      <header>
        <div>
          <p className="eyebrow">COLLABORATION RECORD</p>
          <h3>協作紀錄</h3>
          <p>一般筆記補充現場脈絡；處理事項才會列入協作追蹤與待辦統計。</p>
        </div>
        {!loaded && <button className="button button-secondary collaboration-load" disabled={busy || !identityId} onClick={refresh} type="button">{busy ? "載入中…" : "查看紀錄"}</button>}
      </header>
      {!loaded && autoLoad && <div className="collaboration-loading" aria-live="polite"><div className="collaboration-loading-pills" aria-hidden="true"><span /><span /><span /></div><strong>正在載入協作紀錄</strong><p>整理此財物的現場筆記與處理事項。</p></div>}
      {loaded && <>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="collaboration-timeline">
          {collaborations.length ? collaborations.map((entry) => {
            const isTask = collaborationKindIsTask(entry.kind);
            const closed = isTask && entry.status === "resolved";
            const canResolve = isTask && actor && (actor.isAdmin || actor.id === entry.created_by);
            const noteLabel = collaborationNoteCategoryLabels[entry.details?.noteCategory] || collaborationNoteCategoryLabels.general;
            return <article className={`collaboration-entry ${isTask ? "is-task" : "is-note"} ${closed ? "is-resolved" : ""} ${focusCollaborationId === entry.id ? "is-focused" : ""}`} id={`collaboration-${entry.id}`} key={entry.id}>
              <header><div>
                <span className="collaboration-record-kind">{isTask ? "處理事項" : "一般筆記"}</span>
                {isTask && <span className="collaboration-status">{collaborationStatusLabel(entry.status)}</span>}
                <span className="collaboration-kind">{isTask ? (collaborationKindLabels[entry.kind] || "其他") : noteLabel}</span>
                <span className="collaboration-author">{entry.created_by_name}</span>
              </div><time dateTime={entry.created_at}>{rocDateTime(entry.created_at)}</time></header>
              <div className="collaboration-issue"><p className="collaboration-body">{entry.body}</p></div>
              {entry.events.filter((event) => event.event_type !== "created").map((event) => <div className={`collaboration-event is-${event.event_type}`} key={event.id}>
                <div className="collaboration-event-meta"><strong>{event.actor_name}</strong><time dateTime={event.created_at}>{rocDateTime(event.created_at)}</time></div>
                {event.event_type === "commented" ? <p>{event.payload?.body}</p> : <span>完成處理</span>}
              </div>)}
              {!closed && canResolve && <div className="collaboration-resolve"><button className="text-button" disabled={busy} onClick={() => submit("resolve", entry.id)} type="button">完成處理</button></div>}
              {!closed && <form className="collaboration-reply" onSubmit={(event) => { event.preventDefault(); submit("comment", entry.id, replyDrafts[entry.id] || ""); }}><label><span className="sr-only">補充內容</span><input disabled={busy} maxLength="2000" onChange={(event) => setReplyDrafts((current) => ({ ...current, [entry.id]: event.target.value }))} placeholder={isTask ? "補充處理進度…" : "補充筆記…"} value={replyDrafts[entry.id] || ""} /></label><button className="button button-secondary" disabled={busy || !(replyDrafts[entry.id] || "").trim()} type="submit">補充</button></form>}
            </article>;
          }) : <div className="collaboration-empty"><strong>還沒有協作紀錄</strong><p>可留下查找提示等一般筆記，或建立需要處理的事項。</p></div>}
        </div>
        <form className="collaboration-compose" onSubmit={createRecord}>
          <fieldset className="collaboration-record-type"><legend>新增紀錄</legend><div className="segmented"><label><input checked={recordType === "note"} name="collaboration-record-type" onChange={() => setRecordType("note")} type="radio" /><span>一般筆記</span></label><label><input checked={recordType === "task"} name="collaboration-record-type" onChange={() => setRecordType("task")} type="radio" /><span>處理事項</span></label></div></fieldset>
          {recordType === "note" ? <label>筆記類型<select onChange={(event) => setNoteCategory(event.target.value)} value={noteCategory}><option value="general">一般筆記</option><option value="location_hint">實際位置</option></select></label> : <label>處理類型<select onChange={(event) => setTaskKind(event.target.value)} value={taskKind}>{taskKinds.map((kind) => <option key={kind} value={kind}>{collaborationKindLabels[kind]}</option>)}</select></label>}
          <label>{recordType === "note" ? "筆記內容" : "處理說明"}<textarea disabled={busy} maxLength="2000" onChange={(event) => setDraft(event.target.value)} placeholder={recordType === "note" && noteCategory === "location_hint" ? "例如：三樓西側檔案室，最內層鐵櫃。" : recordType === "note" ? "記錄有助於日後查找或理解的現場資訊。" : "說明需要協助處理的情況。"} value={draft} /></label>
          <div><small>{draft.length}/2,000</small><button className="button button-primary" disabled={busy || !draft.trim()} type="submit">{recordType === "note" ? "新增筆記" : "建立處理事項"}</button></div>
        </form>
      </>}
    </section>
  );
}
