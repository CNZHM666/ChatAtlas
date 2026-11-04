import { DiagramNodeIO } from "./DiagramNodeIO";
import { DiagramHeaderSlot } from "./DiagramHeaderSlot";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import type { FocusEvidence, FocusSection, FocusSession, ProjectUnderstandingEdit, ProjectUnderstandingEdits } from "../../shared/focus-session";
import { understandingEdgeLabel, understandingRelationText, understandingRelationKinds } from "../understanding-model";
import { projectUnderstandingModel, removePersonalProjectConcept, saveProjectConcept } from "../project-understanding";
import { evidencePresentation } from "../evidence-presentation";
import { ChapterConceptMap } from "./ChapterConceptMap";
import { ReaderGuide } from "./ReaderGuide";
import { architectureGroups, moduleRecords } from "../map-presentation";
import { projectStateModel } from "../../shared/project-state";
import { ModuleDesignBasis } from "./ModuleDesignBasis";
import { DiagramWorkspace } from "./DiagramWorkspace";
import { MapDetailPortal } from "./MapDetailPortal";
import { UnderstandingBlocks } from "./UnderstandingBlocks";
import { diagramConceptIds, understandingPresentation, isUnderstandingDiagram, hasUsefulUnderstandingDiagram } from "../understanding-presentation";
import { ConceptWikiLinks } from "./ConceptWikiLinks";
import { understandingSummary } from "../understanding-summary";
import { UnderstandingEditor } from "./UnderstandingEditor";
import { readingTitle } from "../../shared/reading-title";
import { reviewLead } from "../review-presentation";

/** Modules/concepts link to many chapters; the sidebar owns the saved reading order. */
export function ProjectUnderstanding({ session, zh, onRead, onLocate, onSave, readingRoute, onAnalyze, analyzing, analysisError, complete = false, adaptive = false, onDelete, hideEmptyMessage = false }: {
  session: FocusSession; zh: boolean; onRead: (id: string) => void; onLocate: (ref: FocusEvidence) => void;
  onSave?: (value: ProjectUnderstandingEdits) => Promise<void>;
  complete?: boolean; adaptive?: boolean; hideEmptyMessage?: boolean; onDelete?: (id: string) => Promise<void>;
  readingRoute?: ReactNode;
  onAnalyze?: () => void; analyzing?: boolean; analysisError?: string;
}) {
  const model = useMemo(() => projectUnderstandingModel(session, complete), [session, complete]);
  const presentation = understandingPresentation(model.nodes, model.edges);
  const [fullDiagram, setFullDiagram] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(), [branch, setBranch] = useState<string>();
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState<ProjectUnderstandingEdit>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [dragging, setDragging] = useState<string>();
  const showDiagram = !adaptive || isUnderstandingDiagram(presentation) && hasUsefulUnderstandingDiagram(model.nodes, model.edges);
  const graphIds = diagramConceptIds(model.nodes, model.edges);
  const selected = model.nodes.find(node => node.id === selectedId);
  const parents = new Set(model.edges.filter(edge => edge.kind === "contains").map(edge => edge.to));
  const roots = model.nodes.filter(node => !parents.has(node.id));
  // A cycle or an old project without hierarchy remains readable, without inventing parents.
  const reachable = new Set(roots.map(node => node.id)), pendingRoots = [...reachable];
  for (let i = 0; i < pendingRoots.length; i++) for (const edge of model.edges) {
    if (edge.kind === "contains" && edge.from === pendingRoots[i] && !reachable.has(edge.to)) { reachable.add(edge.to); pendingRoots.push(edge.to); }
  }
  const skeleton = [...roots, ...model.nodes.filter(node => !reachable.has(node.id))];
  const branchIds = new Set(branch ? [branch] : []);
  if (branch) {
    const pending = [branch];
    for (let i = 0; i < pending.length; i++) for (const edge of model.edges) {
      if (edge.kind === "contains" && edge.from === pending[i] && !branchIds.has(edge.to)) { branchIds.add(edge.to); pending.push(edge.to); }
    }
  }
  const visible = adaptive || fullDiagram || complete || editing || model.nodes.length <= 8 ? model.nodes : model.nodes.filter(node => skeleton.some(root => root.id === node.id) || branchIds.has(node.id));
  const diagramPoints = adaptive && !complete && graphIds.size ? visible.filter(node => graphIds.has(node.id)) : visible;
  const extraPoints = adaptive && !complete && graphIds.size ? model.nodes.filter(node => !graphIds.has(node.id)) : [];
  const visibleIds = new Set(diagramPoints.map(node => node.id));
  const relations = model.edges.filter(edge => !edge.uncertain && visibleIds.has(edge.from) && visibleIds.has(edge.to));
  const related = selected ? model.edges.filter(edge => edge.from === selected.id || edge.to === selected.id) : [];
  const connected = new Set(selected ? [selected.id, ...related.flatMap(edge => [edge.from, edge.to])] : []);
  const editNode = (id: string) => {
    const node = model.nodes.find(item => item.id === id);
    if (!node) return;
    setEditing(true); setSelectedId(id); setError(false);
    setDraft(current => current?.id === id ? current : { id, title: node.title, responsibility: understandingSummary(node), personalExplanation: node.personalExplanation ?? node.body, sectionIds: [...node.sectionIds], links: node.understandingLinks ?? [] });
  };
  const pick = (id: string) => {
    setSelectedId(id); setError(false);
    const path = new Set([id]);
    let root = id;
    while (!skeleton.some(node => node.id === root)) {
      const parent = model.edges.find(edge => edge.kind === "contains" && edge.to === root);
      if (!parent || path.has(parent.from)) break;
      root = parent.from; path.add(root);
    }
    setBranch(root);
    if (editing) {
      editNode(id);
    }
  };
  const perform = (value: ProjectUnderstandingEdits, done?: () => void) => {
    if (busy || !onSave) return;
    setBusy(true); setError(false);
    void onSave(value).then(done).catch(() => setError(true)).finally(() => setBusy(false));
  };
  const deleteCard = (id: string) => {
    if (busy) return;
    if (!onDelete) { perform(removePersonalProjectConcept(session.projectUnderstanding, id), () => { setDraft(undefined); setSelectedId(undefined); setEditing(false); }); return; }
    setBusy(true); setError(false);
    void onDelete(id).then(() => { setDraft(undefined); setSelectedId(undefined); setEditing(false); }).catch(() => setError(true)).finally(() => setBusy(false));
  };
  const move = (id: string, before?: string) => {
    if (id === before) return;
    const order = model.nodes.map(node => node.id).filter(nodeId => nodeId !== id);
    if (before && !order.includes(before)) return;
    order.splice(before ? order.indexOf(before) : order.length, 0, id);
    perform({ nodes: session.projectUnderstanding?.nodes ?? [], order });
  };
  const renderCard = (item: FocusSection, placement?: CSSProperties) => {
    const node = model.nodes.find(candidate => candidate.id === item.id)!;
    const description = node.responsibility?.trim() || (node.userEdited && node.personalExplanation?.trim() ? reviewLead(node.personalExplanation, 2) : understandingSummary(node));
    const revisit = session.mode !== "work" && node.sectionIds.some(id => session.reviewNeeds?.[id]);
    const read = session.mode !== "work" && node.sectionIds.length > 0 && node.sectionIds.every(id => session.completedSectionIds.includes(id));
    return <li key={node.id} style={placement} data-route-id={node.id} draggable={editing && !busy}
      onDragStart={event => { setDragging(node.id); event.dataTransfer.setData("text/plain", node.id); event.dataTransfer.effectAllowed = "move"; }}
      onDragOver={event => { if (dragging) event.preventDefault(); }}
      onDrop={event => { event.preventDefault(); if (dragging) move(dragging, node.id); setDragging(undefined); }} onDragEnd={() => setDragging(undefined)}>
      <div className={`route-card${selectedId === node.id ? " is-active" : ""}${selected && !connected.has(node.id) ? " is-muted" : ""}`}>
        <button className="route-card-main" type="button" aria-pressed={selectedId === node.id} disabled={busy} onClick={() => pick(node.id)}
          onKeyDown={event => { if (!editing || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); const index = model.nodes.indexOf(node); if (event.key === "ArrowUp" && index > 0) move(node.id, model.nodes[index - 1].id); else if (event.key === "ArrowDown" && index < model.nodes.length - 1) move(node.id, model.nodes[index + 2]?.id); }}>
          <span className="route-card-label"><span className="route-card-title"><strong>{node.title}</strong></span>{description ? <small className="route-responsibility">{description}</small> : null}<DiagramNodeIO node={node} zh={zh} />{revisit || read ? <small className="route-review-state">{revisit ? zh ? "待复习" : "Revisit" : zh ? "已阅读" : "Read"}</small> : null}</span>
        </button>
      </div>
    </li>;
  };
  const sources = selected ? [...new Map(session.evidence.filter(ref => selected.evidenceIds.includes(ref.id)).map(ref => [JSON.stringify([ref.conversationId, ref.messageId]), ref])).values()] : [];
  const plan = complete ? projectStateModel(session) : undefined;
  const decisions = selected && plan ? moduleRecords(selected.title, plan.decisions).filter(item => item.status !== "superseded") : [];
  const constraints = selected && plan ? moduleRecords(selected.title, plan.constraints).filter(item => item.status !== "superseded") : [];
  const detail = !editing && selected ? <section className="project-concept-detail" aria-label={zh ? "结构详情" : "Structure detail"}>
      <header><strong>{selected.title}</strong><div>{onSave ? <button type="button" onClick={() => editNode(selected.id)}>{zh ? "编辑" : "Edit"}</button> : null}<button type="button" aria-label={zh ? "取消聚焦" : "Clear selection"} onClick={() => setSelectedId(undefined)}><X size={16} /></button></div></header>
      {selected.kind === "proposal" || selected.userEdited || selected.semanticStatus === "superseded" ? <p className="muted">{selected.userEdited ? zh ? "个人修改" : "Personal edit" : selected.semanticStatus === "superseded" ? zh ? "已修正的讨论" : "Superseded discussion" : zh ? "讨论中的建议" : "Proposal from discussion"}</p> : null}
      {selected.responsibility ? <p className="module-detail-purpose">{selected.responsibility}</p> : null}
      {selected.personalExplanation && selected.personalExplanation !== selected.body ? <ReaderGuide hideCitationAnnotations content={selected.personalExplanation} zh={zh} complete /> : null}
      {selected.body && selected.body !== selected.responsibility ? <details><summary>{zh ? "原始说明" : "Original explanation"}</summary><ReaderGuide hideCitationAnnotations content={selected.body} zh={zh} complete hideEvidenceMarkers={!selected.userEdited} /></details> : null}
      {selected.inputs?.length || selected.outputs?.length ? <dl className="project-concept-io">{selected.inputs?.length ? <><dt>{zh ? "输入" : "Inputs"}</dt><dd>{selected.inputs.join(" · ")}</dd></> : null}{selected.outputs?.length ? <><dt>{zh ? "输出" : "Outputs"}</dt><dd>{selected.outputs.join(" · ")}</dd></> : null}</dl> : null}
      <ConceptWikiLinks sections={session.sections.filter(section => selected.sectionIds.includes(section.id))} title={selected.title} completedIds={session.completedSectionIds} zh={zh} onRead={onRead} />
      <ModuleDesignBasis decisions={decisions} constraints={constraints} evidence={session.evidence} zh={zh} onLocate={onLocate} />
      {related.length ? <details className="project-concept-sources"><summary>{zh ? "关联关系" : "Related connections"} · {related.length}</summary><ul className="project-concept-relations">{related.map(edge => <li key={JSON.stringify([edge.from, edge.to, edge.kind])}>
        <button type="button" onClick={() => pick(edge.from)}>{model.nodes.find(node => node.id === edge.from)!.title}</button><span>{understandingRelationText(edge, zh)}{edge.uncertain ? <small>{zh ? " · 待确认" : " · Uncertain"}</small> : null}{edge.authored ? <small>{zh ? " · 我的关系" : " · My relation"}</small> : null}</span><button type="button" onClick={() => pick(edge.to)}>{model.nodes.find(node => node.id === edge.to)!.title}</button>{edge.excerpt && edge.kind !== "contains" && evidencePresentation(edge.excerpt) !== understandingRelationText(edge, zh) ? <p>{edge.excerpt}</p> : null}
      </li>)}</ul></details> : null}
      {sources.length ? <details className="project-concept-sources"><summary>{zh ? "相关讨论" : "Related discussions"} · {sources.length}</summary>{sources.map(ref => <button type="button" key={ref.id} onClick={() => onLocate(ref)}>{evidencePresentation(ref.title)} · {evidencePresentation(ref.excerpt)}</button>)}</details> : null}
    </section> : null;
  if (adaptive && session.mode === "work" && !showDiagram && !editing) {
    const personal = model.nodes.filter(node => node.userEdited || node.personalCard);
    return <section className="project-topic-index">
      {personal.length ? <section><h2>{zh ? "我的补充" : "My notes"}</h2><UnderstandingBlocks compact points={personal.map(node => ({ ...node, body: node.personalExplanation ?? node.body, responsibility: node.personalExplanation?.trim() ? reviewLead(node.personalExplanation, 2) : node.responsibility }))} zh={zh} onRead={pick} /></section> : null}
      <div className="project-architecture-empty">{!hideEmptyMessage ? <p>{zh ? "尚未形成可核对的产品架构。整理后可查看模块职责、输入输出和协作关系。" : "A source-backed product architecture is not available yet. Analyze modules, inputs, outputs and connections."}</p> : null}
        {onSave ? <button type="button" onClick={() => setEditing(true)}>{zh ? "调整结构" : "Edit structure"}</button> : null}
        {onAnalyze ? <button type="button" disabled={analyzing} onClick={onAnalyze}>{analyzing ? zh ? "分析中…" : "Analyzing…" : zh ? "AI 分析结构" : "Analyze structure"}</button> : null}
      </div>
      {detail ? <MapDetailPortal onClose={() => setSelectedId(undefined)}>{detail}</MapDetailPortal> : null}
    </section>;
  }
  return <DiagramWorkspace allowExpand={showDiagram || editing} collapseLabel={adaptive ? zh ? "项目架构" : "Project architecture" : undefined} regionLabel={zh ? "项目结构" : "Project structure"} title={session.mode === "work" ? zh ? complete ? "项目主题结构图" : "项目结构图" : complete ? "Project topic structure" : "Project structure diagram" : zh ? "知识结构图" : "Knowledge structure diagram"} zh={zh} onExpandedChange={expanded => { setFullDiagram(expanded); if (!expanded) { setEditing(false); setSelectedId(undefined); } }}><section className={`reader-understanding-map project-module-map${complete ? " is-complete" : ""}`}>
    <DiagramHeaderSlot><div className="route-heading"><div className="route-heading-title"><h2>{adaptive && !editing ? zh ? "项目架构" : "Project architecture" : complete ? zh ? session.mode === "work" ? "项目主题结构" : "知识结构" : session.mode === "work" ? "Project topics" : "Knowledge structure" : zh ? session.mode === "work" ? "项目结构" : "知识结构" : session.mode === "work" ? "Project structure" : "Knowledge structure"}</h2>{!adaptive ? <span>{zh ? `${model.nodes.length} 个要点` : `${model.nodes.length} concepts`}</span> : null}</div><div>

      {!complete && branch && model.nodes.length > 8 && !editing ? <button type="button" onClick={() => { setBranch(undefined); setSelectedId(undefined); }}>{zh ? "返回整体" : "Back to structure"}</button> : null}
      {editing ? <button type="button" disabled={busy} onClick={() => setDraft({ id: `personal-concept:${crypto.randomUUID()}`, title: "", responsibility: "", sectionIds: [], links: [] })}>{zh ? "+ 要点" : "+ Concept"}</button> : null}
      {onAnalyze && (editing || session.structureAnalysis?.status !== "ready" || (session.structureAnalysis?.version ?? 0) < 5) ? <button type="button" disabled={analyzing || busy} onClick={onAnalyze}>{analyzing ? zh ? "分析中…" : "Analyzing…" : session.structureAnalysis?.status === "partial" || session.structureAnalysis?.status === "failed" ? zh ? "继续结构分析" : "Resume analysis" : zh ? "AI 分析结构" : "Analyze structure"}</button> : null}
      {onSave ? <button type="button" disabled={busy} aria-pressed={editing} onClick={() => { if (!editing && selected && !draft) editNode(selected.id); else setEditing(!editing); }}>{editing ? zh ? "完成" : "Done" : zh ? "调整结构" : "Edit structure"}</button> : null}
    </div></div></DiagramHeaderSlot>
    {analysisError ? <p role="alert" className="muted">{analysisError}</p> : session.structureAnalysis?.status === "partial" && !analyzing ? <p className="muted">{zh ? "已保留完成的结构，可继续分析。" : "Completed structure is preserved. Resume when ready."}</p> : null}
    {showDiagram || editing ? <><ChapterConceptMap completeArchitecture={complete && session.mode === "work"} showDetails project={session.mode === "work"} sections={diagramPoints} rootTitle={complete ? session.title : session.goal || session.title} activeId={selectedId ?? ""} focusId={selectedId} relations={relations} groups={complete ? architectureGroups(diagramPoints) : undefined} onInspectRelation={() => setSelectedId(undefined)} evidence={session.evidence} onLocate={onLocate} zh={zh} renderCard={renderCard} onRead={pick} />{extraPoints.length && !editing ? <details className="understanding-secondary"><summary>{zh ? "其他要点" : "Other points"} · {extraPoints.length}</summary><UnderstandingBlocks compact points={extraPoints} zh={zh} onRead={pick} /></details> : null}</> : <UnderstandingBlocks compact={adaptive} kind={presentation} edges={model.edges} points={model.nodes.map(node => ({ ...node, phase: node.phase || (node.sectionIds.length === 1 ? session.sections.find(section => section.id === node.sectionIds[0])?.title : undefined) }))} zh={zh} onRead={pick} />}

    {editing && dragging ? <div className="route-drop-end" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); move(dragging); setDragging(undefined); }}>{zh ? "移到末尾" : "Move to end"}</div> : null}
    {detail ? <MapDetailPortal onClose={() => setSelectedId(undefined)}>{detail}</MapDetailPortal> : null}
    {editing && draft ? <UnderstandingEditor zh={zh} title={draft.title} description={draft.personalExplanation ?? ""} busy={busy} error={error} titleLabel={zh ? "要点标题" : "Concept title"} descriptionLabel={zh ? "详细说明" : "Detailed explanation"}
      requireDescription={!model.nodes.some(node => node.id === draft.id)} onDismiss={() => setEditing(false)} onTitle={title => setDraft({ ...draft, title })} onDescription={personalExplanation => setDraft({ ...draft, personalExplanation })} onClose={() => { setDraft(undefined); setEditing(false); setError(false); }}
      onSave={() => perform(saveProjectConcept(session.projectUnderstanding, { ...draft, title: draft.title.trim() || readingTitle(reviewLead(draft.personalExplanation ?? "", 1), 60) || (zh ? "我的补充" : "My note"), responsibility: draft.responsibility.trim(), links: draft.links.map(link => ({ ...link, targetTitle: model.nodes.find(node => node.id === link.targetId)?.title })) }), () => { setDraft(undefined); setSelectedId(draft.id); setEditing(false); })}
      onDelete={(draft.id.startsWith("personal-concept:") && session.projectUnderstanding?.nodes.some(node => node.id === draft.id) || onDelete && model.nodes.find(node => node.id === draft.id)?.personalCard) ? () => deleteCard(draft.id) : undefined}
      options={<><label>{zh ? "图中简短说明（可选）" : "Short diagram description"}
      <textarea aria-label={zh ? "职责说明" : "Responsibility"} placeholder={zh ? "职责或作用" : "Responsibility or purpose"} rows={2} maxLength={400} value={draft.responsibility} disabled={busy} onChange={event => setDraft({ ...draft, responsibility: event.target.value })} />
      </label>
      {selected?.body ? <details className="concept-editor-options"><summary>{zh ? "原始说明（保留原文）" : "Original explanation"}</summary><ReaderGuide hideCitationAnnotations content={selected.body} zh={zh} complete hideEvidenceMarkers /></details> : null}
      <details className="concept-editor-options"><summary>{zh ? "关联章节" : "Related chapters"}<small>{draft.sectionIds.length}</small></summary><fieldset className="project-concept-associations" disabled={busy}><legend className="sr-only">{zh ? "关联章节" : "Related chapters"}</legend>{session.sections.map(section => <label key={section.id}><input type="checkbox" checked={draft.sectionIds.includes(section.id)} onChange={event => setDraft({ ...draft, sectionIds: event.target.checked ? [...draft.sectionIds, section.id] : draft.sectionIds.filter(id => id !== section.id) })} />{section.title}</label>)}</fieldset></details>
      <details className="concept-editor-options" open={draft.links.length > 0 || undefined}><summary>{zh ? "个人添加的关系" : "Personal relationships"}<small>{draft.links.length}</small></summary><fieldset className="route-link-editor" disabled={busy}><legend className="sr-only">{zh ? "个人添加的关系" : "Personal relationships"}</legend>{draft.links.map((link, index) => <div key={index}><select aria-label={zh ? `关系 ${index + 1}` : `Relation ${index + 1}`} value={link.kind} onChange={event => setDraft({ ...draft, links: draft.links.map((value, i) => i === index ? { ...value, kind: event.target.value as typeof link.kind } : value) })}>{understandingRelationKinds.map(kind => <option key={kind} value={kind}>{understandingEdgeLabel(kind, zh)}</option>)}</select><select aria-label={zh ? `关联要点 ${index + 1}` : `Linked concept ${index + 1}`} value={link.targetId} onChange={event => setDraft({ ...draft, links: draft.links.map((value, i) => i === index ? { ...value, targetId: event.target.value } : value) })}>{model.nodes.filter(node => node.id !== draft.id).map(node => <option key={node.id} value={node.id}>{node.title}</option>)}</select><button type="button" aria-label={zh ? `移除关系 ${index + 1}` : `Remove relation ${index + 1}`} onClick={() => setDraft({ ...draft, links: draft.links.filter((_, i) => i !== index) })}>×</button></div>)}{model.nodes.some(node => node.id !== draft.id) ? <button type="button" onClick={() => setDraft({ ...draft, links: [...draft.links, { targetId: model.nodes.find(node => node.id !== draft.id)!.id, kind: "requires" }] })}>{zh ? "+ 关系" : "+ Relation"}</button> : null}</fieldset></details>
      </>} /> : null}
    {editing && readingRoute ? <details className="project-reading-order"><summary>{zh ? "调整阅读顺序" : "Adjust reading order"}</summary>{readingRoute}</details> : null}
    {error && !(editing && draft) ? <p role="alert">{zh ? "未能保存，修改已保留，请重试。" : "Could not save. Your edits are preserved; try again."}</p> : null}
  </section></DiagramWorkspace>;
}
