import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, FileText, Plus, Trash2 } from "lucide-react";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import { projectStateModel } from "../../shared/project-state";
import { distinctEvidence } from "../overview-model";
import { ReaderGuide } from "./ReaderGuide";
import { understandingNotes } from "../../shared/understanding-notes";

type ModuleLink = { id: string; title: string };
type Note = { key: string; title: string; text: string; module?: ModuleLink; section?: ModuleLink; sectionId?: string; sources: FocusEvidence[]; origin?: string; deletedAt?: number; understandingNoteId?: string };
export type NoteComposeRequest = { nonce: number; sectionId?: string; moduleId?: string };

export function ProjectNotes({ session, sectionId, zh, open, onOpen, panelRef, headerActionsHost, onSave, onLocate, onRead, onModule, composeRequest }: {
  composeRequest?: NoteComposeRequest;
  session: FocusSession; sectionId?: string; zh: boolean; open: boolean; onOpen: (open: boolean) => void;
  panelRef?: RefObject<HTMLDetailsElement>; headerActionsHost?: HTMLElement | null; onSave: (patch: Partial<FocusSession>) => Promise<void>;
  onLocate: (ref: FocusEvidence) => void; onRead: (id: string) => void; onModule?: (id: string) => void;
}) {
  const [filter, setFilter] = useState(sectionId ? `section:${sectionId}` : "all");
  const [selected, setSelected] = useState<string>();
  const [draft, setDraft] = useState<Note>();
  const [showTrash, setShowTrash] = useState(false);
  const [choosingOriginal, setChoosingOriginal] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const composeNonce = useRef<number>();
  const previousLocation = useRef(sectionId);
  useEffect(() => {
    if (previousLocation.current !== sectionId) { setSelected(undefined); setChoosingOriginal(false); previousLocation.current = sectionId; }
    if (open) { setFilter(sectionId ? `section:${sectionId}` : "all"); setShowTrash(false); }
  }, [open, sectionId]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const modules = useMemo(() => projectStateModel(session)?.modules.filter(item => item.status !== "superseded") ?? [], [session]);
  useEffect(() => {
    if (!composeRequest || composeNonce.current === composeRequest.nonce) return;
    composeNonce.current = composeRequest.nonce;
    setShowTrash(false); setSelected(undefined); setChoosingOriginal(false); setOptionsOpen(false);
    // Opening another location resumes an unfinished note instead of replacing it.
    setDraft(current => {
      if (current) return current;
      const module = modules.find(item => item.id === composeRequest.moduleId);
      const section = session.sections.find(item => item.id === composeRequest.sectionId);
      const ids = module?.evidenceIds ?? section?.evidenceIds ?? [];
      return { key: "new", title: "", text: "", module: module ? { id: module.id, title: module.title } : undefined, section: section ? { id: section.id, title: section.title } : undefined, sectionId: section?.id, sources: session.evidence.filter(ref => ids.includes(ref.id)) };
    });
  }, [composeRequest, modules, session]);
  const notes: Note[] = [
    ...(session.notes.trim() ? [{ key: "shared", title: zh ? "项目笔记" : "Project note", text: session.notes, sources: [] }] : []),
    ...Object.entries(session.sectionNotes ?? {}).filter(([, note]) => note.text.trim()).map(([id, note]) => ({ ...note, key: `section:${id}`, title: note.title || session.sections.find(item => item.id === id)?.title || (zh ? "内容笔记" : "Content note"), section: { id, title: session.sections.find(item => item.id === id)?.title || note.title || (zh ? "内容笔记" : "Content note") }, sectionId: id, sources: note.sources ?? session.evidence.filter(ref => note.evidenceIds.includes(ref.id)) })),
    ...(session.detachedNotes ?? []).map((note, index) => ({ ...note, key: `saved:${index}`, sectionId: note.section?.id, sources: note.sources ?? [] })),
    ...understandingNotes(session).map(note => ({ ...note, key: `legacy:${note.understandingNoteId}`, sectionId: note.section?.id, sources: note.sources ?? [] })),
  ];
  const live = notes.filter(note => !note.deletedAt), trash = notes.filter(note => note.deletedAt);
  const visible = live.filter(note => filter === "all" || filter === "project" && !note.module && !note.sectionId || filter.startsWith("module:") && note.module?.id === filter.slice(7) || filter.startsWith("section:") && note.sectionId === filter.slice(8));
  const active = live.find(note => note.key === selected);
  const titleFor = (note: Note) => note.module ? modules.find(module => module.id === note.module!.id)?.title || note.module.title : note.sectionId ? session.sections.find(item => item.id === note.sectionId)?.title || note.section?.title || note.title : zh ? "项目整体" : "Whole project";
  const originals = active ? distinctEvidence(active.sources).filter((ref, index, refs) => refs.findIndex(item => item.conversationId === ref.conversationId) === index) : [];
  const patchNote = (note: Note, changes: { title?: string; text?: string; module?: ModuleLink; section?: ModuleLink; deletedAt?: number }): Partial<FocusSession> => {
    if (note.key.startsWith("legacy:")) return { detachedNotes: [...(session.detachedNotes ?? []), { title: note.title, text: note.text, sources: note.sources, section: note.section, module: note.module, understandingNoteId: note.understandingNoteId, ...changes }] };
    if (note.key === "shared") return changes.deletedAt ? { notes: "", detachedNotes: [...(session.detachedNotes ?? []), { title: note.title, text: note.text, deletedAt: changes.deletedAt }] } : { notes: changes.text ?? note.text };
    if (note.key.startsWith("section:")) {
      const id = note.key.slice(8);
      if ("section" in changes && changes.section?.id !== id) {
        const sectionNotes = { ...session.sectionNotes }; delete sectionNotes[id];
        return { sectionNotes, detachedNotes: [...(session.detachedNotes ?? []), { title: changes.title ?? note.title, text: changes.text ?? note.text, module: changes.module, section: changes.section, sources: note.sources, deletedAt: note.deletedAt }] };
      }
      return { sectionNotes: { ...session.sectionNotes, [id]: { ...session.sectionNotes![id], ...changes, updatedAt: Date.now() } } };
    }
    const index = Number(note.key.slice(6));
    return { detachedNotes: session.detachedNotes?.map((item, position) => position === index ? { ...item, ...changes } : item) };
  };
  const commit = async (patch: Partial<FocusSession>, done: () => void) => {
    if (busy) return; setBusy(true); setError("");
    try { await onSave(patch); done(); } catch { setError(zh ? "保存失败，修改已保留。" : "Save failed. Your edits are retained."); } finally { setBusy(false); }
  };
  const add = () => {
    if (draft) return;
    setOptionsOpen(false);
    setSelected(undefined); setError(""); setChoosingOriginal(false);
    const module = filter.startsWith("module:") ? modules.find(item => item.id === filter.slice(7)) : undefined;
    const section = filter.startsWith("section:") ? session.sections.find(item => item.id === filter.slice(8)) : undefined;
    const ids = module?.evidenceIds ?? section?.evidenceIds ?? [];
    setDraft({ key: "new", title: "", text: "", ...(module ? { module: { id: module.id, title: module.title } } : {}), ...(section ? { section: { id: section.id, title: section.title }, sectionId: section.id } : {}), sources: session.evidence.filter(ref => ids.includes(ref.id)) });
  };
  const back = () => { setDraft(undefined); setSelected(undefined); setChoosingOriginal(false); setError(""); };
  const trashButton = <button type="button" aria-label={zh ? "回收站" : "Trash"} title={zh ? "回收站" : "Trash"} aria-pressed={showTrash} onClick={() => setShowTrash(value => !value)}><Trash2 size={18} aria-hidden="true" /></button>;
  return <details ref={panelRef} className="reader-notes focus-notes-hub project-notes" open={open} onToggle={event => onOpen(event.currentTarget.open)}>
    <summary>{zh ? "我的笔记" : "My notes"}</summary>
    {open ? <div className="project-notes-body">
      {headerActionsHost ? createPortal(trashButton, headerActionsHost) : <div className="project-notes-header-actions">{trashButton}</div>}
      {showTrash ? <section aria-label={zh ? "回收站笔记" : "Trashed notes"}>
        <div className="project-notes-toolbar"><button type="button" onClick={() => setShowTrash(false)}><ArrowLeft size={16} aria-hidden="true" />{zh ? "返回笔记" : "Back to notes"}</button><span>{zh ? "回收站" : "Trash"} · {trash.length}</span></div>
        {trash.length ? <div className="project-notes-trash-list">{trash.map(note => <div key={note.key}><span><strong>{note.title}</strong><small>{titleFor(note)}</small></span><button type="button" disabled={busy} onClick={() => void commit(patchNote(note, { deletedAt: undefined }), () => undefined)}>{zh ? "恢复" : "Restore"}</button></div>)}</div> : <p className="project-notes-empty">{zh ? "回收站为空" : "Trash is empty"}</p>}
      </section> : <>
      {draft || active ? <div className="project-notes-toolbar"><button type="button" disabled={busy} onClick={back}><ArrowLeft size={16} aria-hidden="true" />{zh ? "笔记列表" : "All notes"}</button>{active && !draft ? <button type="button" disabled={busy} onClick={() => { setOptionsOpen(false); setDraft({ ...active }); }}>{zh ? "编辑" : "Edit"}</button> : null}</div> : <div className="project-notes-toolbar">
        <select aria-label={zh ? "筛选笔记" : "Filter notes"} value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">{zh ? `全部笔记 · ${live.length}` : `All notes · ${live.length}`}</option><option value="project">{zh ? "项目整体" : "Whole project"}</option>
          {modules.length ? <optgroup label={zh ? "模块" : "Modules"}>{modules.map(module => <option key={module.id} value={`module:${module.id}`}>{module.title}</option>)}</optgroup> : null}
          {session.sections.length ? <optgroup label={zh ? "内容" : "Content"}>{session.sections.map(item => <option key={item.id} value={`section:${item.id}`}>{item.title}</option>)}</optgroup> : null}
          {live.filter(note => note.module && !modules.some(module => module.id === note.module!.id)).filter((note, index, items) => items.findIndex(item => item.module!.id === note.module!.id) === index).map(note => <option key={note.module!.id} value={`module:${note.module!.id}`}>{note.module!.title}</option>)}
        </select><button type="button" onClick={add}><Plus size={16} aria-hidden="true" />{zh ? "新笔记" : "New note"}</button>
      </div>}
      {draft ? <form className="project-note-editor" onSubmit={event => {
        event.preventDefault(); if (!draft.text.trim()) return;
        const title = draft.title.trim() || draft.text.trim().split("\n")[0].replace(/^#+\s*/u, "").slice(0, 60) || (zh ? "笔记" : "Note");
        const changed = { title, text: draft.text, module: draft.module, section: draft.section };
        const module = modules.find(item => item.id === draft.module?.id);
        const section = session.sections.find(item => item.id === draft.sectionId);
        const ids = module?.evidenceIds ?? section?.evidenceIds;
        const patch = draft.key === "new" ? { detachedNotes: [...(session.detachedNotes ?? []), { ...changed, sources: ids ? session.evidence.filter(ref => ids.includes(ref.id)) : draft.sources }] } : patchNote(draft, changed);
        const moved = draft.key.startsWith("section:") && draft.section?.id !== draft.key.slice(8);
        void commit(patch, () => { setDraft(undefined); setSelected(draft.key === "new" ? undefined : moved ? `saved:${session.detachedNotes?.length ?? 0}` : draft.key); if (draft.key === "new" || moved) setFilter(draft.module ? `module:${draft.module.id}` : draft.sectionId ? `section:${draft.sectionId}` : "project"); });
      }}>
        <span className="project-note-location">{titleFor(draft)}</span>
        <textarea autoFocus disabled={busy} aria-label={zh ? "笔记内容" : "Note content"} rows={7} placeholder={zh ? "记下你的想法…" : "Write your thoughts…"} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} />
        {draft.key !== "shared" ? <details className="project-note-options" open={optionsOpen}><summary onClick={event => { event.preventDefault(); setOptionsOpen(!optionsOpen); }}>{zh ? "标题与归属（可选）" : "Title and location (optional)"}</summary>{optionsOpen ? <>
        <input disabled={busy} aria-label={zh ? "笔记标题" : "Note title"} placeholder={zh ? "留空使用首句" : "Leave blank to use the first line"} value={draft.title} maxLength={200} onChange={event => setDraft({ ...draft, title: event.target.value })} />
        <select disabled={busy} aria-label={zh ? "笔记位置" : "Note location"} value={draft.module?.id ?? (draft.sectionId ? `section:${draft.sectionId}` : "")} onChange={event => {
          const module = modules.find(item => item.id === event.target.value);
          const section = event.target.value.startsWith("section:") ? session.sections.find(item => item.id === event.target.value.slice(8)) : undefined;
          setDraft({ ...draft, module: module ? { id: module.id, title: module.title } : undefined, section: section ? { id: section.id, title: section.title } : undefined, sectionId: section?.id });
        }}><option value="">{zh ? "项目整体" : "Whole project"}</option>{modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}{session.sections.map(item => <option key={item.id} value={`section:${item.id}`}>{item.title}</option>)}{draft.module && !modules.some(module => module.id === draft.module!.id) ? <option value={draft.module.id}>{draft.module.title}</option> : null}{draft.section && !session.sections.some(item => item.id === draft.sectionId) ? <option value={`section:${draft.sectionId}`}>{draft.section.title}</option> : null}</select></> : null}</details> : null}
        <div><button type="button" disabled={busy} onClick={() => setDraft(undefined)}>{zh ? "取消" : "Cancel"}</button><button className="primary" disabled={busy || !draft.text.trim()}>{busy ? zh ? "保存中…" : "Saving…" : zh ? "保存笔记" : "Save note"}</button></div>
      </form> : active ? <article className="project-note-detail"><div className="project-note-heading"><h3>{active.title}</h3><span className="project-note-location" title={titleFor(active)}>{titleFor(active)}</span></div>{active.origin === "query" ? <small className="project-note-origin">{zh ? "AI 摘录" : "AI excerpt"}</small> : null}
        <ReaderGuide content={active.text.replace(new RegExp(`^##?\\s+${active.title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*\\n+`, "u"), "")} zh={zh} complete hideEvidenceMarkers={active.origin === "query"} />
        <div className="project-note-links">{active.module && modules.some(module => module.id === active.module!.id) && onModule ? <button type="button" onClick={() => onModule(active.module!.id)}>{zh ? "查看模块" : "View module"}</button> : null}{active.sectionId && session.sections.some(item => item.id === active.sectionId) ? <button type="button" onClick={() => onRead(active.sectionId!)}>{zh ? "查看内容" : "Read content"}</button> : null}{originals.length ? <button type="button" aria-expanded={originals.length > 1 ? choosingOriginal : undefined} onClick={() => originals.length === 1 ? onLocate(originals[0]) : setChoosingOriginal(value => !value)}>{zh ? "查看原对话" : "Read original discussion"}</button> : null}</div>
        {choosingOriginal && originals.length > 1 ? <div className="project-note-originals" role="group" aria-label={zh ? "选择原对话" : "Choose original discussion"}>{originals.map(ref => <button type="button" key={ref.conversationId} onClick={() => { setChoosingOriginal(false); onLocate(ref); }}>{ref.title}</button>)}</div> : null}
        <button type="button" className="project-note-trash" disabled={busy} onClick={() => void commit(patchNote(active, { deletedAt: Date.now() }), () => setSelected(undefined))}>{zh ? "移入回收站" : "Move to trash"}</button>
      </article> : <>
        <div className="project-note-list">{visible.map(note => <button key={note.key} type="button" className="project-note-item" onClick={() => { setSelected(note.key); setChoosingOriginal(false); setError(""); }}><FileText size={18} aria-hidden="true" /><span><span className="project-note-heading"><strong>{note.title}</strong><small className="project-note-location" title={titleFor(note)}>{titleFor(note)}</small></span>{note.origin === "query" ? <small className="project-note-origin">{zh ? "AI 摘录" : "AI excerpt"}</small> : null}<p>{note.text.replace(/^#+\s+[^\n]+\n+/u, "").replace(/\s+/gu, " ")}</p></span></button>)}</div>
        {!visible.length ? <p className="project-notes-empty">{zh ? "还没有笔记" : "No notes yet"}</p> : null}
        {Object.keys(session.reviewNeeds ?? {}).length ? <details className="notes-trash"><summary>{zh ? "待复查问题" : "Questions to revisit"}</summary>{Object.entries(session.reviewNeeds ?? {}).map(([id, text]) => <button type="button" key={id} onClick={() => onRead(id)}>{text}</button>)}</details> : null}
      </>}
      </>}
      {error ? <p role="alert">{error}</p> : null}
    </div> : null}
  </details>;
}
