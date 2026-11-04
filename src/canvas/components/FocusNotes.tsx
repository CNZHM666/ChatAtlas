import { useEffect, useState, type RefObject } from "react";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import { distinctEvidence } from "../overview-model";
import { ReaderGuide } from "./ReaderGuide";
import { ProjectNotes } from "./ProjectNotes";

export function FocusNotes({ session, sectionId, zh, open, onOpen, panelRef, headerActionsHost, onSave, onLocate, onRead, onModule, composeRequest }: {
  composeRequest?: import("./ProjectNotes").NoteComposeRequest;
  session: FocusSession; sectionId?: string; zh: boolean; open: boolean; onOpen: (open: boolean) => void;
  panelRef?: RefObject<HTMLDetailsElement>; headerActionsHost?: HTMLElement | null; onSave: (patch: Partial<FocusSession>) => Promise<void>;
  onLocate: (ref: FocusEvidence) => void; onRead: (id: string) => void; onModule?: (id: string) => void;
}) {
  const [all, setAll] = useState(!sectionId), [draft, setDraft] = useState<{ key: string; title: string; text: string }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [question, setQuestion] = useState("");
  const [chapterDrafts, setChapterDrafts] = useState<Record<string, string>>({});
  const [sharedDraft, setSharedDraft] = useState<string>();
  const [sharedOpen, setSharedOpen] = useState(false);
  const [showTitle, setShowTitle] = useState(false), [reviewEditing, setReviewEditing] = useState(false);
  const section = session.sections.find(item => item.id === sectionId);
  const current = sectionId ? session.sectionNotes?.[sectionId] : undefined;
  const savedText = current?.deletedAt ? "" : current?.text ?? "";
  const chapterText = sectionId ? chapterDrafts[sectionId] ?? savedText : "";
  useEffect(() => { setAll(!sectionId); setQuestion(""); setDraft(undefined); setError(""); setShowTitle(false); setReviewEditing(false); setSharedOpen(false); }, [sectionId, session.id]);
  const records = [
    ...Object.entries(session.sectionNotes ?? {}).filter(([, note]) => note.text.trim()).map(([id, note]) => ({ key: `chapter:${id}`, title: note.title || session.sections.find(item => item.id === id)?.title || (zh ? "章节笔记" : "Chapter note"), text: note.text, sectionId: id, sources: note.sources ?? session.evidence.filter(ref => note.evidenceIds.includes(ref.id)), deletedAt: note.deletedAt, origin: "chapter" })),
    ...(session.detachedNotes ?? []).map((note, index) => ({ ...note, key: `saved:${index}`, sectionId: undefined, origin: note.origin ?? "note" })),
  ];
  const visible = records.filter(record => !record.deletedAt && (all || !record.sectionId || record.sectionId === sectionId));
  const trash = records.filter(record => record.deletedAt);
  const commit = async (patch: Partial<FocusSession>, done?: () => void) => {
    if (busy) return; setBusy(true); setError("");
    try { await onSave(patch); done?.(); } catch { setError(zh ? "保存失败，修改已保留。" : "Save failed. Your edits are retained."); } finally { setBusy(false); }
  };
  const changeRecord = (key: string, changes: { title?: string; text?: string; deletedAt?: number }) => {
    if (key.startsWith("chapter:")) { const id = key.slice(8), note = session.sectionNotes?.[id]; return note ? { sectionNotes: { ...session.sectionNotes, [id]: { ...note, ...changes, updatedAt: Date.now() } } } : {}; }
    const index = Number(key.slice(6));
    return { detachedNotes: session.detachedNotes?.map((note, position) => position === index ? { ...note, ...changes } : note) };
  };
  const saveCurrent = (text: string) => {
    if (!section) return;
    const id = section.id;
    void commit({ sectionNotes: { ...session.sectionNotes, [id]: { ...current, text, evidenceIds: current?.evidenceIds ?? section.evidenceIds, sources: current?.sources ?? session.evidence.filter(ref => section.evidenceIds.includes(ref.id)), updatedAt: Date.now(), deletedAt: undefined } } }, () => setChapterDrafts(drafts => { if (drafts[id] !== text) return drafts; const next = { ...drafts }; delete next[id]; return next; }));
  };
  if (session.mode === "work") return <ProjectNotes composeRequest={composeRequest} key={session.id} session={session} sectionId={sectionId} zh={zh} open={open} onOpen={onOpen} panelRef={panelRef} headerActionsHost={headerActionsHost} onSave={onSave} onLocate={onLocate} onRead={onRead} onModule={onModule} />;
  return <details ref={panelRef} className="reader-notes focus-notes-hub" open={open} onToggle={event => onOpen(event.currentTarget.open)}>
    <summary>{zh ? "我的笔记" : "My notes"}{records.some(record => !record.deletedAt) || session.notes.trim() ? <small>{records.filter(record => !record.deletedAt).length + (session.notes.trim() ? 1 : 0)}</small> : null}</summary>
    {open ? <div className="notes-hub-body">
      <div className="notes-hub-toolbar">{draft ? <strong>{draft.key === "new" ? zh ? "新笔记" : "New note" : zh ? "编辑笔记" : "Edit note"}</strong> : section ? <div><button type="button" aria-pressed={!all} onClick={() => setAll(false)}>{zh ? "本章" : "This chapter"}</button><button type="button" aria-pressed={all} onClick={() => setAll(true)}>{zh ? "全部" : "All notes"}</button></div> : <span /> }{!draft ? <button type="button" disabled={busy} onClick={() => { setSharedOpen(false); setReviewEditing(false); setShowTitle(false); setDraft({ key: "new", title: "", text: "" }); }}>{zh ? "+ 笔记" : "+ Note"}</button> : null}</div>
      {section && !all && !draft && !sharedOpen ? <section className="chapter-note-editor">
        {!reviewEditing ? <><label>{zh ? "本节笔记" : "Chapter notes"}<textarea rows={6} disabled={busy} aria-label={zh ? "本节笔记" : "Chapter notes"} value={chapterText} onChange={event => setChapterDrafts(drafts => ({ ...drafts, [section.id]: event.target.value }))} placeholder={zh ? "记下你的理解…" : "Write your understanding…"} onBlur={event => { if (event.target.value !== savedText) saveCurrent(event.target.value); }} /></label>
        {chapterText !== savedText ? <button disabled={busy} onClick={() => saveCurrent(chapterText)}>{zh ? "保存笔记" : "Save note"}</button> : null}
        <button className="notes-secondary-action" type="button" disabled={busy} onClick={() => { setQuestion(session.reviewNeeds?.[section.id] ?? ""); setReviewEditing(true); }}>{zh ? "待复习问题" : "Review question"}</button></> : <div className="notes-review-editor"><label>{zh ? "待复习的问题" : "What still needs review?"}<textarea autoFocus rows={3} disabled={busy} aria-label={zh ? "待复习的问题" : "What still needs review?"} value={question} onChange={event => setQuestion(event.target.value)} placeholder={zh ? "下次想弄清什么？" : "What should you revisit?"} /></label><div><button type="button" disabled={busy} onClick={() => setReviewEditing(false)}>{zh ? "取消" : "Cancel"}</button><button disabled={busy || !question.trim()} onClick={() => void commit({ reviewNeeds: { ...session.reviewNeeds, [section.id]: question.trim() }, completedSectionIds: session.completedSectionIds.filter(id => id !== section.id) }, () => { setQuestion(""); setReviewEditing(false); })}>{zh ? "待复习" : "Revisit later"}</button></div></div>}
        {session.reviewNeeds?.[section.id] ? <div className="notes-review-current"><span>{session.reviewNeeds[section.id]}</span><button disabled={busy} onClick={() => { const needs = { ...session.reviewNeeds }; delete needs[section.id]; void commit({ reviewNeeds: needs }); }}>{zh ? "已解决" : "Resolved"}</button></div> : null}
      </section> : null}
      {draft ? <form className="notes-draft" onSubmit={event => { event.preventDefault(); if (!draft.text.trim()) return; const title = draft.title.trim() || draft.text.trim().split("\n").find(line => line.trim())!.replace(/^\s*#+\s*/u, "").trim().slice(0, 60) || (zh ? "笔记" : "Note"); const patch = draft.key === "new" ? { detachedNotes: [...(session.detachedNotes ?? []), { title, text: draft.text, sources: section ? session.evidence.filter(ref => section.evidenceIds.includes(ref.id)) : [] }] } : changeRecord(draft.key, { title, text: draft.text }); void commit(patch, () => setDraft(undefined)); }}>
        {showTitle ? <input disabled={busy} aria-label={zh ? "笔记标题" : "Note title"} placeholder={zh ? "标题（可选）" : "Title (optional)"} maxLength={200} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /> : <button className="notes-secondary-action" type="button" onClick={() => setShowTitle(true)}>{draft.title || (zh ? "添加标题" : "Add title")}</button>}
        <textarea autoFocus disabled={busy} aria-label={zh ? "笔记内容" : "Note content"} placeholder={zh ? "写下笔记…" : "Write a note…"} rows={6} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} />
        <div><button type="button" disabled={busy} onClick={() => setDraft(undefined)}>{zh ? "取消" : "Cancel"}</button><button className="primary" disabled={busy || !draft.text.trim()}>{zh ? "保存笔记" : "Save note"}</button></div>
      </form> : null}
      {!draft ? visible.filter(record => all || record.sectionId !== sectionId).map(record => <details className="notes-record" key={record.key}><summary><strong>{record.title}</strong><small>{record.origin === "query" ? zh ? "AI 摘录" : "AI excerpt" : record.sectionId ? zh ? "章节笔记" : "Chapter note" : zh ? "笔记" : "Note"}</small></summary><ReaderGuide content={record.text.replace(new RegExp(`^##?\\s+${record.title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*\\n+`, "u"), "")} zh={zh} complete hideEvidenceMarkers={record.origin === "query"} /><div className="notes-record-actions"><button disabled={busy} onClick={() => { setSharedOpen(false); setShowTitle(true); setDraft({ key: record.key, title: record.title, text: record.text }); }}>{zh ? "编辑" : "Edit"}</button>{record.sectionId ? <button onClick={() => onRead(record.sectionId!)}>{zh ? "打开章节" : "Open chapter"}</button> : null}<button disabled={busy} onClick={() => void commit(changeRecord(record.key, { deletedAt: Date.now() }))}>{zh ? "移入回收站" : "Move to trash"}</button></div>{distinctEvidence(record.sources ?? []).length ? <details className="notes-record-sources"><summary>{zh ? "来源" : "Sources"} · {distinctEvidence(record.sources ?? []).length}</summary>{distinctEvidence(record.sources ?? []).map(ref => <button key={ref.id} onClick={() => onLocate(ref)}>{zh ? "回看：" : "Revisit: "}{ref.title}</button>)}</details> : null}</details>) : null}
      {!draft && (session.notes.trim() || sharedDraft !== undefined) ? <details className="notes-record" open={sharedOpen} onToggle={event => setSharedOpen(event.currentTarget.open)}><summary>{zh ? "回顾共用笔记" : "Shared review notes"}</summary><textarea disabled={busy} aria-label={zh ? "回顾共用笔记" : "Shared review notes"} value={sharedDraft ?? session.notes} onChange={event => setSharedDraft(event.target.value)} rows={4} onBlur={event => { const text = event.target.value; if (text !== session.notes) void commit({ notes: text }, () => setSharedDraft(value => value === text ? undefined : value)); }} />{sharedDraft !== undefined && sharedDraft !== session.notes ? <button disabled={busy} onClick={() => void commit({ notes: sharedDraft }, () => setSharedDraft(undefined))}>{zh ? "保存笔记" : "Save note"}</button> : null}</details> : null}
      {trash.length ? <details className="notes-trash"><summary>{zh ? "回收站" : "Trash"} · {trash.length}</summary>{trash.map(record => <div key={record.key}><span>{record.title}</span><button disabled={busy} onClick={() => void commit(changeRecord(record.key, { deletedAt: undefined }))}>{zh ? "恢复" : "Restore"}</button></div>)}</details> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div> : null}
  </details>;
}
