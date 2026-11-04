import { DiagramNodeIO } from "./DiagramNodeIO";
import { DiagramHeaderSlot } from "./DiagramHeaderSlot";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { FocusEvidence, FocusSection } from "../../shared/focus-session";
import { evidencePresentation } from "../evidence-presentation";
import { understandingEdgeLabel, understandingEdges, understandingLabels, understandingRelationKinds, understandingRole } from "../understanding-model";
import { readingRouteGroups, routeDepth } from "../understanding-route-layout";
import { DiagramWorkspace } from "./DiagramWorkspace";
import { ChapterConceptMap } from "./ChapterConceptMap";
import { UnderstandingDetail } from "./UnderstandingDetail";
import { OverviewUnderstandingMap } from "./OverviewUnderstandingMap";
import { chapterConceptSteps } from "../chapter-understanding";
import { UnderstandingBlocks } from "./UnderstandingBlocks";
import { comparisonTable, diagramConceptIds, understandingPresentation, isUnderstandingDiagram, hasUsefulUnderstandingDiagram } from "../understanding-presentation";
import { understandingSummary } from "../understanding-summary";
import { ChapterUnderstanding } from "./ChapterUnderstanding";
import { UnderstandingEditor } from "./UnderstandingEditor";
import { readingTitle } from "../../shared/reading-title";
import { reviewLead } from "../review-presentation";

export interface RouteCardDraft { id: string; title: string; body: string; transition: string; before?: string; phase?: string; links?: FocusSection["understandingLinks"]; responsibility?: string }

/** Saved reading order; adjusting uses drag and drop with keyboard equivalents. */
export function FocusUnderstandingPath({ sections, activeId, zh, onRead, onSave, onMove, chapter = false, project = false, rootTitle, projectStructure = false, evidence = [], onLocate, completedIds = [], reviewNeeds = {}, adaptive = false, presentationBody = "", onDelete, onAddNote, hidePersonalNotes = false, headerActions }: {
  headerActions?:ReactNode;
  onAddNote?: () => void;
  hidePersonalNotes?: boolean;
  sections: FocusSection[]; activeId: string; zh: boolean; onRead: (id: string) => void;
  onSave?: (draft: RouteCardDraft) => Promise<void>; onMove?: (id: string, before?: string) => Promise<void>; chapter?: boolean; project?: boolean; rootTitle?: string;
  adaptive?: boolean; presentationBody?: string; onDelete?: (id: string) => Promise<void>;
  projectStructure?: boolean; evidence?: FocusEvidence[]; onLocate?: (evidence: FocusEvidence) => void; completedIds?: string[]; reviewNeeds?: Record<string, string>;
}) {
  const [fullDiagram, setFullDiagram] = useState(false);
  const read = (id: string) => { if (chapter) setFullDiagram(false); onRead(id); };
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [draft, setDraft] = useState<RouteCardDraft>(), [dragging, setDragging] = useState<string>(), [dropBefore, setDropBefore] = useState<string>();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<"reading" | "structure">("reading"), [selectedId, setSelectedId] = useState<string>();
  const structure = projectStructure && view === "structure" && !editing;
  const selected = sections.find(item => item.id === selectedId);
  const chapterConcepts = chapter ? chapterConceptSteps(sections) : sections;
  const edges = useMemo(() => understandingEdges(sections), [sections]);
  const presentation = understandingPresentation(chapterConcepts, edges, rootTitle, presentationBody);
  const showDiagram = !adaptive || isUnderstandingDiagram(presentation) && hasUsefulUnderstandingDiagram(chapterConcepts, edges);
  const graphIds = diagramConceptIds(chapterConcepts, edges);
  const diagramPoints = adaptive && graphIds.size ? chapterConcepts.filter(point => graphIds.has(point.id)) : chapterConcepts;
  const extraPoints = adaptive && graphIds.size ? chapterConcepts.filter(point => !graphIds.has(point.id)) : [];
  const pointHeading = zh ? "本章图解" : "Chapter diagram";
  const focus = chapter ? activeId : selected?.id;
  const connected = new Set(focus ? [focus, ...edges.filter(edge => edge.from === focus || edge.to === focus).flatMap(edge => [edge.from, edge.to])] : sections.map(item => item.id));
  const active = sections.find(section => section.id === activeId);
  const groups = readingRouteGroups(sections, chapter);
  const singleColumn = (panel: Element | null) => {
    const list = panel?.querySelector(".route-adjusting");
    const columns = list ? getComputedStyle(list).gridTemplateColumns : "";
    return columns && columns !== "none" ? columns.split(/\s+/u).length === 1 : (panel?.getBoundingClientRect().width ?? 0) <= 480;
  };
  const pointerDestination = (x: number, y: number, grip: HTMLElement): { before?: string } | undefined => {
    const panel = grip.closest(".reader-understanding-map"), target = document.elementFromPoint(x, y);
    if (!target || !panel?.contains(target)) return;
    if (target.closest(".route-drop-end")) return {};
    const card = target.closest<HTMLElement>("[data-route-id]"); if (!card) return;
    const index = sections.findIndex(item => item.id === card.dataset.routeId), rect = card.getBoundingClientRect();
    const after = singleColumn(panel) ? y > rect.top + rect.height / 2 : x > rect.left + rect.width / 2;
    return { before: after ? sections[index + 1]?.id : sections[index]?.id };
  };
  const perform = (action: () => Promise<void>, done?: () => void) => { if (busy) return; setBusy(true); setError(false); void action().then(done).catch(() => setError(true)).finally(() => setBusy(false)); };
  const edit = (section: FocusSection) => { setError(false); setDraft({ id: section.id, title: section.title, body: section.body, transition: section.transition, phase: section.phase ?? "", links: section.understandingLinks ?? [], responsibility: section.responsibility ?? "" }); };
  const drop = () => { if (dragging && onMove && !busy && dragging !== dropBefore) perform(() => onMove(dragging, dropBefore)); setDragging(undefined); setDropBefore(undefined); };
  const renderCard = (section: FocusSection, placement?: CSSProperties) => {
    const index = sections.indexOf(section);
    const displayIndex = chapter && !editing ? chapterConcepts.indexOf(section) : index;
    const depth = chapter && !editing ? routeDepth(section, sections) : 0;
    const description = understandingSummary(section);
    return <li key={section.id} style={{ "--route-depth": depth, ...placement } as CSSProperties} className={`${depth ? "route-child " : ""}${dragging === section.id ? "route-dragging " : ""}${dragging && dropBefore === section.id ? "route-drop-before" : ""}`} data-route-id={section.id} draggable={editing && Boolean(onMove) && !busy}
      onDragStart={event => { if (!editing || busy) { event.preventDefault(); return; } setDragging(section.id); event.dataTransfer.setData("text/plain", section.id); event.dataTransfer.effectAllowed = "move"; }}
      onDragOver={event => { if (!dragging || !onMove) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; const rect = event.currentTarget.getBoundingClientRect(); const narrow = singleColumn(event.currentTarget.closest(".reader-understanding-map")); const after = narrow ? event.clientY > rect.top + rect.height / 2 : event.clientX > rect.left + rect.width / 2; setDropBefore(after ? sections[index + 1]?.id : section.id); }}
      onDrop={event => { event.preventDefault(); drop(); }} onDragEnd={() => { setDragging(undefined); setDropBefore(undefined); }}>
      <div className={`route-card${(structure ? selectedId : activeId) === section.id ? " is-active" : ""}${!editing && (structure || chapter) && !connected.has(section.id) ? " is-muted" : ""}`}><button className="route-card-main" type="button" aria-current={(structure ? selectedId : activeId) === section.id ? "step" : undefined} onClick={() => structure ? setSelectedId(section.id) : read(section.id)} onKeyDown={event => { if (!editing || !onMove || busy || !event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); const up = ["ArrowLeft", "ArrowUp"].includes(event.key); if (up && index === 0 || !up && index === sections.length - 1) return; perform(() => onMove(section.id, up ? sections[index - 1].id : sections[index + 2]?.id)); }}>
        <span className="route-card-number">{displayIndex + 1}</span><span className="route-card-label"><span className="route-card-title"><strong>{section.origin === "user" || section.userEdited ? section.title : evidencePresentation(section.title)}</strong>{chapter && understandingRole(section) ? <small className="understanding-role">{understandingLabels[understandingRole(section)!][zh ? 0 : 1]}</small> : null}</span>{chapter && !project && section.phase ? <small>{zh ? "属于：" : "Part of: "}{evidencePresentation(section.phase)}</small> : null}{!chapter && section.origin === "user" ? <small>{zh ? "我的理解" : "My understanding"}</small> : null}{(chapter || structure) && description && !section.title.includes(description) ? <small className="route-responsibility">{description}</small> : null}<DiagramNodeIO node={section} zh={zh} />{projectStructure && (reviewNeeds[section.id] || completedIds.includes(section.id)) ? <small className="route-review-state">{reviewNeeds[section.id] ? zh ? "待复习" : "Revisit" : zh ? "已阅读" : "Read"}</small> : null}</span>
      </button>{editing && onSave ? <div className="route-card-tools"><button type="button" className="route-grip" disabled={busy || !onMove} aria-label={zh ? `拖动 ${section.title}` : `Drag ${section.title}`}
        onPointerDown={event => { if (busy || !onMove || event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); setDragging(section.id); }}
        onPointerMove={event => { if (dragging !== section.id) return; const position = pointerDestination(event.clientX, event.clientY, event.currentTarget); if (position) setDropBefore(position.before); }}
        onPointerUp={event => { if (dragging !== section.id) return; const position = pointerDestination(event.clientX, event.clientY, event.currentTarget); if (position && onMove && position.before !== section.id) perform(() => onMove(section.id, position.before)); setDragging(undefined); setDropBefore(undefined); }}
        onPointerCancel={() => { setDragging(undefined); setDropBefore(undefined); }}>⠿</button><button type="button" disabled={busy} aria-label={zh ? `编辑 ${section.title}` : `Edit ${section.title}`} onClick={() => edit(section)}>{zh ? "编辑" : "Edit"}</button></div> : null}</div>
    </li>;
  };
  const pathLabel = chapter ? project ? zh ? "本章项目结构" : "Chapter project structure" : zh ? "本章理解路线" : "Chapter understanding path" : zh ? "项目理解路线" : "Project understanding path";
  if (adaptive && chapter) return <ChapterUnderstanding headerActions={headerActions} hidePersonalNotes={hidePersonalNotes} onAddNote={onAddNote} sections={sections} zh={zh} project={project} rootTitle={rootTitle} evidence={evidence} onLocate={onLocate} onRead={read} onSave={onSave} onDelete={onDelete} onMove={onMove} />;
  const content = <section className={`reader-understanding-map${chapter ? " chapter-understanding-map" : ""}${chapter && project ? " project-chapter-map" : ""}`} aria-label={chapter ? undefined : pathLabel}>
    <DiagramHeaderSlot><div className="route-heading"><div className="route-heading-title"><h2>{adaptive && !editing ? pointHeading : chapter ? project ? zh ? "本章项目结构" : "Chapter project structure" : zh ? "本章理解路线" : "Chapter understanding path" : projectStructure ? zh ? "整体理解路线" : "Overall understanding path" : zh ? "阅读路线" : "Reading path"}</h2>{!chapter && sections.length ? <span>{zh ? `${sections.length} 节` : `${sections.length} sections`}</span> : null}</div><div>{headerActions}{projectStructure && !chapter && !editing && (edges.length > 0 || structure) ? <button type="button" aria-pressed={structure} onClick={() => { setView(structure ? "reading" : "structure"); setSelectedId(undefined); }}>{structure ? zh ? "返回路线" : "Back to path" : zh ? "查看关系" : "Explore relations"}</button> : null}{onSave && (editing || !sections.length) ? <button type="button" disabled={busy} onClick={() => { setError(false); setDraft({ id: `user-${crypto.randomUUID()}`, title: "", body: "", transition: "", phase: "", links: [], responsibility: "" }); }}>{zh ? "+ 理解卡片" : "+ Understanding card"}</button> : null}{onSave && sections.length ? <button type="button" disabled={busy} aria-pressed={editing} onClick={() => { setEditing(!editing); setDragging(undefined); }}>{editing ? zh ? "完成调整" : "Done" : zh ? "调整路线" : "Edit path"}</button> : null}</div></div></DiagramHeaderSlot>
    {editing && onMove ? <small className="route-drag-hint">{zh ? "拖动调整阅读顺序" : "Drag to change reading order"}</small> : null}
    {editing ? <ol className="route-adjusting">{sections.map(section => renderCard(section))}</ol> : chapter && !showDiagram ? <UnderstandingBlocks compact={adaptive} edges={edges} points={chapterConcepts} kind={presentation} table={comparisonTable(presentationBody)} zh={zh} onRead={read} review={!project} /> : chapter ? <><ChapterConceptMap showDetails project={project} sections={diagramPoints} rootTitle={rootTitle} activeId={activeId} focusId={activeId} relations={edges.filter(edge => !edge.uncertain && diagramPoints.some(step => step.id === edge.from) && diagramPoints.some(step => step.id === edge.to))} zh={zh} renderCard={renderCard} onRead={read} evidence={evidence} onLocate={onLocate} />{extraPoints.length ? <details className="understanding-secondary"><summary>{zh ? "其他要点" : "Other points"} · {extraPoints.length}</summary><UnderstandingBlocks compact points={extraPoints} zh={zh} onRead={read} /></details> : null}</> : projectStructure ? <div className={`project-structure-layout${structure && selected ? " has-selection" : ""}`}><OverviewUnderstandingMap key={view} sections={sections} rootTitle={rootTitle} activeId={structure ? selectedId ?? "" : activeId} edges={edges} zh={zh} renderCard={renderCard} onRead={structure ? setSelectedId : onRead} focusId={structure ? selectedId : undefined} />{structure && selected ? <UnderstandingDetail section={selected} sections={sections} edges={edges} evidence={evidence} zh={zh} onRead={onRead} onLocate={onLocate} onClear={() => setSelectedId(undefined)} /> : null}</div> : <div className="route-groups">{groups.map((group, index) => {
      if (groups.length === 1 && !group.title) return <ol key={group.id}>{group.items.map(section => renderCard(section))}</ol>;
      const open = expanded[group.id] ?? (sections.length <= 6 || group.items.some(item => item.id === activeId) || index === 0);
      const title = group.title || (zh ? `阅读段 ${index + 1}` : `Reading group ${index + 1}`);
      return <details className="route-group route-reading-group" key={group.id} open={open}><summary onClick={event => { event.preventDefault(); setExpanded(current => ({ ...current, [group.id]: !open })); }}><span className="route-group-index">{index + 1}</span><strong>{title}</strong><span className="route-group-count">{zh ? `${group.items.length} 节` : `${group.items.length} sections`}</span><ChevronDown className="route-group-chevron" size={16} aria-hidden="true" /></summary><ol start={group.start + 1}>{group.items.map(section => renderCard(section))}</ol></details>;
    })}</div>}
    {editing && onMove ? <div className={`route-drop-end${dragging && dropBefore === undefined ? " active" : ""}`} onDragOver={event => { if (dragging) { event.preventDefault(); setDropBefore(undefined); } }} onDrop={event => { event.preventDefault(); drop(); }}>{dragging ? zh ? "移到末尾" : "Move to end" : null}</div> : null}
    {draft && onSave ? <UnderstandingEditor zh={zh} title={draft.title} description={draft.body} busy={busy} error={error} requireDescription={!sections.some(section => section.id === draft.id)} titleLabel={zh ? "理解卡片标题" : "Understanding card title"} descriptionLabel={zh ? "理解卡片内容" : "Understanding card content"} onTitle={title => setDraft({ ...draft, title })} onDescription={body => setDraft({ ...draft, body })} onClose={() => { setDraft(undefined); setError(false); }}
      onSave={() => perform(() => onSave({ ...draft, title: draft.title.trim() || readingTitle(reviewLead(draft.body, 1), 60) || (zh ? "我的补充" : "My note"), body: draft.body.trim() }), () => { setDraft(undefined); setEditing(true); })}
      onDelete={onDelete && sections.find(section => section.id === draft.id)?.origin === "user" ? () => perform(() => onDelete(draft.id), () => { setDraft(undefined); setEditing(false); }) : undefined}
      options={<><input aria-label={zh ? "所属分组" : "Group"} placeholder={zh ? "所属分组（可选）" : "Group (optional)"} maxLength={120} value={draft.phase ?? ""} disabled={busy} onChange={event => setDraft({ ...draft, phase: event.target.value })} />
      {chapter || projectStructure ? <textarea rows={2} aria-label={zh ? "职责说明" : "Responsibility"} placeholder={zh ? "补充职责或作用（可选）" : "Add responsibility or purpose (optional)"} maxLength={400} value={draft.responsibility ?? ""} disabled={busy} onChange={event => setDraft({ ...draft, responsibility: event.target.value })} /> : null}
      {chapter || projectStructure ? <fieldset className="route-link-editor" disabled={busy}><legend>{zh ? "我的关系" : "My relations"}</legend>{draft.links?.map((link, index) => <div key={index}><select aria-label={zh ? `关系 ${index + 1}` : `Relation ${index + 1}`} value={link.kind} onChange={event => setDraft({ ...draft, links: draft.links?.map((item, position) => position === index ? { ...item, kind: event.target.value as typeof link.kind } : item) })}>{understandingRelationKinds.map(kind => <option key={kind} value={kind}>{understandingEdgeLabel(kind, zh)}</option>)}</select><select aria-label={zh ? `关联要点 ${index + 1}` : `Linked concept ${index + 1}`} value={link.targetId} onChange={event => setDraft({ ...draft, links: draft.links?.map((item, position) => position === index ? { ...item, targetId: event.target.value } : item) })}>{sections.filter(item => item.id !== draft.id).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><button type="button" aria-label={zh ? `移除关系 ${index + 1}` : `Remove relation ${index + 1}`} onClick={() => setDraft({ ...draft, links: draft.links?.filter((_, position) => position !== index) })}>×</button></div>)}{sections.some(item => item.id !== draft.id) ? <button type="button" onClick={() => setDraft({ ...draft, links: [...(draft.links ?? []), { targetId: sections.find(item => item.id !== draft.id)!.id, kind: "requires" }] })}>{zh ? "+ 关系" : "+ Relation"}</button> : null}</fieldset> : null}
      {draft.transition ? <details><summary>{zh ? "已保存的阅读衔接" : "Saved reading transition"}</summary><p>{draft.transition}</p></details> : null}</>} /> : null}
    {error && !draft ? <p role="alert">{zh ? "未能保存，修改已保留，请重试。" : "Could not save. Your edits are preserved; try again."}</p> : null}
    {!structure && active?.transition ? <p className="reading-transition"><strong>{zh ? "接下来：" : "Next: "}</strong>{active.transition}</p> : null}
  </section>;
  return chapter ? <DiagramWorkspace allowExpand={showDiagram} collapseLabel={adaptive ? pointHeading : undefined} regionLabel={pathLabel} title={rootTitle || (zh ? "复习理解图" : "Review diagram")} zh={zh} expanded={fullDiagram} onExpandedChange={setFullDiagram}>{content}</DiagramWorkspace> : content;
}

