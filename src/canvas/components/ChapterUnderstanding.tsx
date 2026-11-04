import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, X } from "lucide-react";
import type { FocusSection, FocusEvidence } from "../../shared/focus-session";
import type { RouteCardDraft } from "./FocusUnderstandingPath";
import { chapterConceptSteps } from "../chapter-understanding";
import { understandingEdges, understandingRelationKinds, understandingEdgeLabel } from "../understanding-model";
import { diagramConceptIds, hasUsefulUnderstandingDiagram } from "../understanding-presentation";
import { understandingSummary } from "../understanding-summary";
import { readingTitle } from "../../shared/reading-title";
import { reviewLead } from "../review-presentation";
import { ChapterConceptMap } from "./ChapterConceptMap";
import { DiagramWorkspace } from "./DiagramWorkspace";
import { ReaderGuide } from "./ReaderGuide";
import { MapDetailPortal } from "./MapDetailPortal";
import { UnderstandingEditor } from "./UnderstandingEditor";
import "../understanding-editor.css";

export function ChapterUnderstanding({ sections, zh, project, rootTitle, evidence, onLocate, onRead, onSave, onDelete, onMove, onAddNote, hidePersonalNotes = false, headerActions }: {
  headerActions?:ReactNode;
  onAddNote?: () => void;
  hidePersonalNotes?: boolean;
  sections: FocusSection[]; zh: boolean; project: boolean; rootTitle?: string; evidence: FocusEvidence[];
  onLocate?: (ref: FocusEvidence) => void; onRead: (id: string) => void;
  onSave?: (draft: RouteCardDraft) => Promise<void>; onDelete?: (id: string) => Promise<void>; onMove?: (id: string, before?: string) => Promise<void>;
}) {
  const points = chapterConceptSteps(sections), edges = useMemo(() => understandingEdges(sections), [sections]);
  const useful = hasUsefulUnderstandingDiagram(points, edges), ids = diagramConceptIds(points, edges);
  const graph = points.filter(point => ids.has(point.id));
  const personal = sections.filter(point => point.origin === "user" || point.userEdited || point.structureEdited);
  const [draft, setDraft] = useState<RouteCardDraft>(), [selectedId, setSelectedId] = useState<string>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [full, setFull] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false), [pointsOpen, setPointsOpen] = useState(false);
  const selected = sections.find(point => point.id === selectedId);
  const close = () => { if (!busy) { setDraft(undefined); setSelectedId(undefined); setError(false); } };
  const perform = (action: () => Promise<void>, done?: () => void) => { if (busy) return; setBusy(true); setError(false); void action().then(done).catch(() => setError(true)).finally(() => setBusy(false)); };
  const edit = (point?: FocusSection) => { setError(false); setSelectedId(undefined); setDraft(point ? { id: point.id, title: point.title, body: point.body, transition: point.transition, phase: point.phase, responsibility: point.responsibility, links: point.understandingLinks } : { id: `user-${crypto.randomUUID()}`, title: "", body: "", transition: "" }); };
  const inspect = (id: string) => { setSelectedId(id); setError(false); };
  return <section className="chapter-understanding-simple">
    {useful ? <DiagramWorkspace title={rootTitle ?? (zh ? "本章图解" : "Chapter diagram")} heading={<div className="route-heading"><h2>{zh ? "本章图解" : "Chapter diagram"}</h2>{headerActions}</div>} collapseLabel={zh ? "本章图解" : "Chapter diagram"} zh={zh} expanded={full} onExpandedChange={setFull}>
      <div className="reader-understanding-map"><ChapterConceptMap sections={graph} project={project} showDetails zh={zh} activeId={selectedId ?? ""} relations={edges.filter(edge => !edge.uncertain && ids.has(edge.from) && ids.has(edge.to))} evidence={evidence} onLocate={onLocate} onRead={inspect} renderCard={point => <li key={point.id} data-route-id={point.id}><div className="route-card"><button className="route-card-main" type="button" onClick={() => inspect(point.id)}><span className="route-card-label"><span className="route-card-title"><strong>{point.title}</strong></span>{understandingSummary(point) ? <small className="route-responsibility">{understandingSummary(point)}</small> : null}</span></button></div></li>} /></div>
    </DiagramWorkspace> : null}
    {hidePersonalNotes || onAddNote ? null : onSave || personal.length ? <details className="chapter-personal-notes"><summary>{zh ? "我的补充" : "My notes"}{personal.length ? <small>{personal.length}</small> : null}</summary>
      {personal.length ? <ul>{personal.map(point => { const lead = reviewLead(point.body, 1); return <li key={point.id}><button type="button" onClick={() => inspect(point.id)}><strong>{point.title}</strong>{lead && lead !== point.title ? <span>{lead}</span> : null}</button></li>; })}</ul> : null}
      {onSave ? <button type="button" className="chapter-add-note" disabled={busy} onClick={() => edit()}>{zh ? "+ 补充理解" : "+ Add note"}</button> : null}
    </details> : null}
    {selected && !draft ? <MapDetailPortal onClose={close}><aside className="understanding-note-detail" role="dialog" aria-label={zh ? "理解详情" : "Understanding detail"}><header><strong>{selected.title}</strong><button type="button" aria-label={zh ? "关闭理解详情" : "Close understanding detail"} onClick={close}><X size={16} /></button></header><div><ReaderGuide content={selected.body || selected.responsibility || ""} zh={zh} complete hideEvidenceMarkers={!selected.userEdited && selected.origin !== "user"} /></div><footer>{onSave ? <button type="button" onClick={() => edit(selected)}>{zh ? "编辑" : "Edit"}</button> : null}{!selected.origin && !selected.userEdited ? <button type="button" onClick={() => { setSelectedId(undefined); setFull(false); onRead(selected.id); }}>{zh ? "定位正文" : "Locate in article"}</button> : null}</footer></aside></MapDetailPortal> : null}
    {draft && onSave ? <UnderstandingEditor zh={zh} busy={busy} error={error} requireDescription={!sections.some(point => point.id === draft.id)} title={draft.title} description={draft.body} onTitle={title => setDraft({ ...draft, title })} onDescription={body => setDraft({ ...draft, body })} onClose={close}
      onSave={() => perform(() => onSave({ ...draft, title: draft.title.trim() || readingTitle(reviewLead(draft.body, 1), 60) || (zh ? "我的补充" : "My note"), body: draft.body.trim() }), () => setDraft(undefined))}
      onDelete={onDelete && sections.find(point => point.id === draft.id)?.origin === "user" ? () => perform(() => onDelete(draft.id), () => setDraft(undefined)) : undefined}
      options={<>
        <label>{zh ? "分组（可选）" : "Group (optional)"}<input aria-label={zh ? "所属分组" : "Group"} maxLength={120} value={draft.phase ?? ""} disabled={busy} onChange={event => setDraft({ ...draft, phase: event.target.value })} /></label>
        <label>{zh ? "图中简短说明（可选）" : "Short diagram description"}<textarea aria-label={zh ? "职责说明" : "Responsibility"} rows={2} maxLength={400} value={draft.responsibility ?? ""} disabled={busy} onChange={event => setDraft({ ...draft, responsibility: event.target.value })} /></label>
        <fieldset disabled={busy} className="route-link-editor"><legend>{zh ? "个人关系" : "Personal relationships"}</legend>{(draft.links ?? []).map((link, index) => <div key={index}><select aria-label={zh ? `关系 ${index + 1}` : `Relation ${index + 1}`} value={link.kind} onChange={event => setDraft({ ...draft, links: draft.links?.map((item, i) => i === index ? { ...item, kind: event.target.value as typeof link.kind } : item) })}>{understandingRelationKinds.map(kind => <option key={kind} value={kind}>{understandingEdgeLabel(kind, zh)}</option>)}</select><select aria-label={zh ? `关联要点 ${index + 1}` : `Linked concept ${index + 1}`} value={link.targetId} onChange={event => setDraft({ ...draft, links: draft.links?.map((item, i) => i === index ? { ...item, targetId: event.target.value } : item) })}>{sections.filter(point => point.id !== draft.id).map(point => <option key={point.id} value={point.id}>{point.title}</option>)}</select><button type="button" aria-label={zh ? `移除关系 ${index + 1}` : `Remove relation ${index + 1}`} onClick={() => setDraft({ ...draft, links: draft.links?.filter((_, i) => i !== index) })}>×</button></div>)}{sections.some(point => point.id !== draft.id) ? <button type="button" onClick={() => setDraft({ ...draft, links: [...(draft.links ?? []), { targetId: sections.find(point => point.id !== draft.id)!.id, kind: "requires" }] })}>{zh ? "+ 关系" : "+ Relation"}</button> : null}</fieldset>
        {draft.transition ? <details><summary>{zh ? "已保存的阅读衔接" : "Saved reading transition"}</summary><p>{draft.transition}</p></details> : null}
      </>} /> : null}
    {!onAddNote && onSave && sections.length ? <details className="chapter-understanding-settings" open={settingsOpen}><summary className="workspace-disclosure-title" onClick={event => { event.preventDefault(); setSettingsOpen(!settingsOpen); }}>{zh ? "更多设置" : "More options"}<ChevronDown size={15} aria-hidden="true"/></summary>{settingsOpen ? <details open={pointsOpen}><summary className="workspace-disclosure-title" onClick={event => { event.preventDefault(); setPointsOpen(!pointsOpen); }}>{zh ? "已有要点与顺序" : "Existing points and order"}<ChevronDown size={15} aria-hidden="true"/></summary>{pointsOpen ? <ul>{sections.map((point, index) => <li key={point.id}><button type="button" onClick={() => inspect(point.id)}>{point.title}</button>{onMove ? <><button type="button" disabled={busy || index === 0} aria-label={`${zh ? "上移" : "Move up"} ${point.title}`} onClick={() => perform(() => onMove(point.id, sections[index - 1].id))}><ArrowUp size={14} /></button><button type="button" disabled={busy || index === sections.length - 1} aria-label={`${zh ? "下移" : "Move down"} ${point.title}`} onClick={() => perform(() => onMove(point.id, sections[index + 2]?.id))}><ArrowDown size={14} /></button></> : null}</li>)}</ul> : null}</details> : null}</details> : null}
    {error && !draft ? <p role="alert">{zh ? "未能保存，原内容已保留，请重试。" : "Could not save. Original content is preserved."}</p> : null}
  </section>;
}
