import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { rocDateTime } from "../../lib/formatters";
import {
  collaborationKindIsTask,
  collaborationKindLabels,
  collaborationNoteCategoryLabels,
  collaborationStatusLabel,
  requestCollaboration,
} from "../collaboration/api";
import { AssetPhotos } from "../photos/AssetPhotos";
import { CapsuleSpinner } from "../../components/FeedbackCenter";
import { FilterCombo } from "./QueryControls";

const taskKinds = ["tag_missing", "disposal_candidate", "custodian_change", "location_change", "other"];

export const CollaborationNotebook = forwardRef(function CollaborationNotebook({ identityId, autoLoad = false, focusCollaborationId, onChanged, onComposerChange }, ref) {
  const closeTimer = useRef(null);
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
  const [activePanel, setActivePanel] = useState("records");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerClosing, setComposerClosing] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [openSelect, setOpenSelect] = useState(null);

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
    window.clearTimeout(closeTimer.current);
    setCollaborations([]); setActor(null); setDraft(""); setReplyDrafts({}); setError(""); setLoaded(false); setActivePanel("records"); setComposerOpen(false); setComposerClosing(false); setPhotoCount(0); setOpenSelect(null);
  }, [identityId]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
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
  useEffect(() => { onComposerChange?.({ open: composerOpen, closing: composerClosing }); }, [composerOpen, composerClosing, onComposerChange]);

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
      setDraft(""); closeComposer(); onChanged?.();
    } catch (requestError) { setError(requestError.message || "無法儲存協作紀錄。"); }
    finally { setBusy(false); }
  };
  const closeComposer = (afterClose) => {
    if (!composerOpen) { afterClose?.(); return; }
    if (composerClosing) return;
    setOpenSelect(null);
    setComposerClosing(true);
    closeTimer.current = window.setTimeout(() => { setComposerOpen(false); setComposerClosing(false); afterClose?.(); }, 100);
  };
  const selectPanel = (panel) => {
    if (composerOpen) { closeComposer(() => setActivePanel(panel)); return; }
    setActivePanel(panel);
  };
  const openComposer = (type) => { window.clearTimeout(closeTimer.current); setRecordType(type); setComposerClosing(false); setComposerOpen(true); };
  useImperativeHandle(ref, () => ({ collapse: closeComposer, restore: () => openComposer(recordType) }));

  return (
    <section className="collaboration-notes">
      <header>
        <div>
          <p className="eyebrow">COLLABORATION RECORD</p>
          <h3>協作紀錄</h3>
          <p>一般筆記補充現場脈絡；處理事項才會列入協作追蹤與待辦統計。</p>
        </div>
        {!loaded && <button className="button button-secondary collaboration-load" disabled={busy || !identityId} onClick={refresh} type="button">{busy && <CapsuleSpinner compact />}{busy ? "載入中…" : "查看紀錄"}</button>}
      </header>
      {!loaded && autoLoad && <div className="collaboration-loading" aria-live="polite"><div className="collaboration-loading-pills" aria-hidden="true"><span /><span /><span /></div><strong>正在載入協作紀錄</strong><p>整理此財物的現場筆記與處理事項。</p></div>}
      {loaded && <>
        {error && <p className="form-error" role="alert">{error}</p>}
        <nav aria-label="協作內容" className="collaboration-workbench-tabs" role="tablist"><button aria-selected={activePanel === "records"} className={activePanel === "records" ? "active" : ""} onClick={() => selectPanel("records")} role="tab" type="button">筆記與事項<span>{collaborations.length}</span></button><button aria-selected={activePanel === "photos"} className={activePanel === "photos" ? "active" : ""} onClick={() => selectPanel("photos")} role="tab" type="button">查看／上傳照片<span>{photoCount}</span></button></nav>
        <AssetPhotos active={activePanel === "photos"} identityId={identityId} onCountChange={setPhotoCount} />
        {activePanel === "records" && <><div className="collaboration-timeline" role="tabpanel">
          {!collaborations.length && !composerOpen && <section className="collaboration-start"><p className="eyebrow">從這裡開始</p><h4>這筆財產需要留下什麼？</h4><p>協作內容不會改動舊系統匯入的主檔資料；已有筆記或照片可從上方分頁查看。</p><div><button className="collaboration-start-card is-note" onClick={() => openComposer("note")} type="button"><span>筆記</span><strong>留下現場筆記</strong><small>記錄位置、查找提示或後續交接資訊。</small></button><button className="collaboration-start-card is-task" onClick={() => openComposer("task")} type="button"><span>處理</span><strong>提出處理事項</strong><small>請財產管理員協助補印、異動或後續報廢。</small></button><button className="collaboration-start-card is-photo" onClick={() => setActivePanel("photos")} type="button"><span>照片</span><strong>查看或上傳照片</strong><small>補足位置、標籤與現況的現場佐證。</small></button></div></section>}
          {collaborations.length ? collaborations.map((entry) => {
            const isTask = collaborationKindIsTask(entry.kind);
            const closed = isTask && entry.status === "resolved";
            const canResolve = isTask && actor && (actor.isAdmin || actor.id === entry.created_by);
            const noteLabel = collaborationNoteCategoryLabels[entry.details?.noteCategory] || collaborationNoteCategoryLabels.general;
            return <article className={`collaboration-entry ${isTask ? "is-task" : "is-note"} ${closed ? "is-resolved" : ""} ${focusCollaborationId === entry.id ? "is-focused" : ""}`} id={`collaboration-${entry.id}`} key={entry.id}>
              <header><div className="collaboration-entry-heading"><span className="collaboration-record-kind">{isTask ? "處理事項" : "一般筆記"}</span><strong>{isTask ? (collaborationKindLabels[entry.kind] || "其他事項") : noteLabel}</strong>{isTask && <span className="collaboration-status">{collaborationStatusLabel(entry.status)}</span>}</div><time dateTime={entry.created_at}>{rocDateTime(entry.created_at)}</time></header>
              <p className="collaboration-author">{entry.created_by_name} 建立</p>
              <div className="collaboration-issue"><p className="collaboration-body">{entry.body}</p></div>
              {entry.events.filter((event) => event.event_type !== "created").map((event) => <div className={`collaboration-event is-${event.event_type}`} key={event.id}>
                <div className="collaboration-event-meta"><strong>{event.actor_name}</strong><time dateTime={event.created_at}>{rocDateTime(event.created_at)}</time></div>
                {event.event_type === "commented" ? <p>{event.payload?.body}</p> : <span>完成處理</span>}
              </div>)}
              {!closed && canResolve && <div className="collaboration-resolve"><button className="text-button" disabled={busy} onClick={() => submit("resolve", entry.id)} type="button">{busy && <CapsuleSpinner compact />}完成處理</button></div>}
              {!closed && <form className="collaboration-reply" onSubmit={(event) => { event.preventDefault(); submit("comment", entry.id, replyDrafts[entry.id] || ""); }}><label><span className="sr-only">補充內容</span><input disabled={busy} maxLength="2000" onChange={(event) => setReplyDrafts((current) => ({ ...current, [entry.id]: event.target.value }))} placeholder={isTask ? "補充處理進度…" : "補充筆記…"} value={replyDrafts[entry.id] || ""} /></label><button className="button button-secondary" disabled={busy || !(replyDrafts[entry.id] || "").trim()} type="submit">補充</button></form>}
            </article>;
          }) : null}
        </div>
        {!composerOpen ? collaborations.length > 0 && <div className="collaboration-primary-action"><button className="button button-secondary" onClick={() => openComposer("note")} type="button">留下筆記</button><button className="button button-primary" onClick={() => openComposer("task")} type="button">提出事項</button></div> : <form aria-label={recordType === "note" ? "筆記工作區" : "處理事項工作區"} className={`collaboration-compose collaboration-workspace ${composerClosing ? "is-closing" : ""}`} onSubmit={createRecord}>
          <fieldset className="collaboration-record-type"><legend>{recordType === "note" ? "留下現場筆記" : "提出處理事項"}</legend><p>{recordType === "note" ? "不改動主檔；供日後查找、交接與理解現場狀況。" : "會列入協作追蹤，供財產管理員接手處理。"}</p><div className="segmented"><label><input checked={recordType === "note"} name="collaboration-record-type" onChange={() => setRecordType("note")} type="radio" /><span>一般筆記</span></label><label><input checked={recordType === "task"} name="collaboration-record-type" onChange={() => setRecordType("task")} type="radio" /><span>處理事項</span></label></div></fieldset>
          {recordType === "note" ? <FilterCombo id="collaboration-note-category" label="筆記類型" menuPlacement="above" onChange={(label) => setNoteCategory(Object.entries(collaborationNoteCategoryLabels).find(([, value]) => value === label)?.[0] || "general")} onOpenChange={setOpenSelect} open={openSelect === "collaboration-note-category"} options={["一般筆記", "實際位置"]} showAllOptions value={collaborationNoteCategoryLabels[noteCategory] || collaborationNoteCategoryLabels.general} /> : <FilterCombo id="collaboration-task-kind" label="處理類型" menuPlacement="above" onChange={(label) => setTaskKind(taskKinds.find((kind) => collaborationKindLabels[kind] === label) || "other")} onOpenChange={setOpenSelect} open={openSelect === "collaboration-task-kind"} options={taskKinds.map((kind) => collaborationKindLabels[kind])} showAllOptions value={collaborationKindLabels[taskKind]} />}
          <label>{recordType === "note" ? "筆記內容" : "處理說明"}<textarea disabled={busy} maxLength="2000" onChange={(event) => setDraft(event.target.value)} placeholder={recordType === "note" && noteCategory === "location_hint" ? "例如：三樓西側檔案室，最內層鐵櫃。" : recordType === "note" ? "記錄有助於日後查找或理解的現場資訊。" : "說明需要協助處理的情況。"} value={draft} /></label>
          <div><button className="text-button" disabled={busy} onClick={() => closeComposer()} type="button">取消</button><small>{draft.length}/2,000</small><button className="button button-primary" disabled={busy || !draft.trim()} type="submit">{busy && <CapsuleSpinner compact />}{recordType === "note" ? "新增筆記" : "建立處理事項"}</button></div>
        </form>}</>}
      </>}
    </section>
  );
});
