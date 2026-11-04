import { ArrowRight, ArrowLeftRight, ChevronDown, CornerDownLeft, X } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { FocusSection, FocusEvidence } from "../../shared/focus-session";
import { understandingEdges, understandingRelationText, understandingEdgeLabel, type UnderstandingEdge } from "../understanding-model";
import { evidencePresentation } from "../evidence-presentation";
import { connectorKey } from "../concept-connectors";
import { mapPresentation, type MapGroup } from "../map-presentation";
import { MapDetailPortal } from "./MapDetailPortal";
import { DiagramCanvas } from "./DiagramCanvas";
import { useFullDiagram } from "../diagram-workspace-context";

export function ChapterConceptMap({ sections, zh, activeId, renderCard, onRead, focusId, project = false, relations, groups, evidence = [], onLocate, onInspectRelation, showDetails = false, completeArchitecture = false, diagramOnly = false }: {
  sections: FocusSection[]; rootTitle?: string; zh: boolean; activeId: string;
  renderCard: (section: FocusSection, placement?: CSSProperties) => ReactNode; onRead: (id: string) => void; focusId?: string; project?: boolean;
  relations?: UnderstandingEdge[];
  showRoot?: boolean; showDetails?: boolean; completeArchitecture?: boolean;
  diagramOnly?:boolean;
  groups?: MapGroup[]; evidence?: FocusEvidence[]; onLocate?: (ref: FocusEvidence) => void;
  onInspectRelation?: () => void;
}) {
  const fullDiagram = useFullDiagram();
  const raw = relations ?? understandingEdges(sections);
  const ids = new Set(sections.map(node => node.id));
  const supported = raw.filter(edge => !edge.uncertain && ids.has(edge.from) && ids.has(edge.to));
  const edges = supported.filter(edge => edge.authored || edge.kind !== "contains" || !supported.some(other => other.from === edge.from && other.to === edge.to && other.kind !== "contains"));
  const [selectedRelation, setSelectedRelation] = useState<string>();
  const [inspecting, setInspecting] = useState(false);
  useEffect(() => { if (!fullDiagram) setInspecting(false); }, [fullDiagram]);
  const presentation = mapPresentation(edges, Boolean(groups));
  const selectedEdge = edges.find(edge => connectorKey(edge) === selectedRelation);
  const title = (section: FocusSection) => section.origin === "user" || section.userEdited ? section.title : evidencePresentation(section.title);
  const selectRelation = (key: string, diagram = false) => { setSelectedRelation(current => current === key ? undefined : key); setInspecting(diagram); onInspectRelation?.(); };
  const context = edges.length ? <div className="map-legend">{[...new Set(edges.map(edge => edge.kind))].map(kind => <span key={kind} className={`diagram-legend-${kind}`}>
    {kind === "comparison" ? <ArrowLeftRight size={16} /> : kind === "feedback" ? <CornerDownLeft size={16} /> : kind === "contains" ? <i /> : <ArrowRight size={16} />}
    {kind === "requires" ? zh ? "前提" : "Prerequisite" : kind === "flow" ? zh ? "传递" : "Flow" : kind === "feedback" ? zh ? "反馈" : "Feedback" : understandingEdgeLabel(kind, zh)}
  </span>)}</div> : null;
  return <div className={`chapter-concept-map map-${presentation}${showDetails ? " chapter-map-details" : ""}`} aria-label={project ? zh ? "项目概念结构" : "Project concept structure" : zh ? "本章概念结构" : "Chapter concept structure"}>

    <p className="concept-map-accessible-relations">{edges.map(edge => `${title(sections.find(item => item.id === edge.from)!)} · ${understandingRelationText(edge, zh, false)} · ${title(sections.find(item => item.id === edge.to)!)}${edge.authored ? zh ? "（我的关系）" : " (My relation)" : ""}`).join("；")}</p>
    <DiagramCanvas compactControls={diagramOnly} completeArchitecture={completeArchitecture} showDetails={showDetails} key={completeArchitecture ? "project-architecture" : JSON.stringify([project, sections.map(section => section.id)])} sections={sections} edges={edges} groups={groups} zh={zh} review={!project} context={context} renderCard={renderCard} focusId={focusId} selectedRelation={selectedRelation} onRelation={key => selectRelation(key, true)} onNode={() => { setSelectedRelation(undefined); setInspecting(false); }} />
    {inspecting && selectedEdge ? <MapDetailPortal onClose={() => { setSelectedRelation(undefined); setInspecting(false); }}><aside className="map-relation-inspector" role="region" aria-label={zh ? "关系解释" : "Relation explanation"} onKeyDown={event => { if (event.key === "Escape") { setSelectedRelation(undefined); setInspecting(false); } }}><header><strong>{understandingRelationText(selectedEdge, zh, false)}</strong><button type="button" aria-label={zh ? "关闭关系解释" : "Close relation explanation"} onClick={() => { setSelectedRelation(undefined); setInspecting(false); }}><X size={16} /></button></header><small className="inspector-relation-kind">{understandingEdgeLabel(selectedEdge.kind, zh)}</small><div className="inspector-endpoints">{title(sections.find(item => item.id === selectedEdge.from)!)}{selectedEdge.kind === "comparison" ? <ArrowLeftRight size={16} /> : selectedEdge.kind === "contains" ? <span>{zh ? "包含" : "contains"}</span> : <ArrowRight size={16} />}{title(sections.find(item => item.id === selectedEdge.to)!)}</div>{selectedEdge.excerpt ? <p>{evidencePresentation(selectedEdge.excerpt)}</p> : null}{onLocate ? evidence.filter(ref => selectedEdge.evidenceIds?.includes(ref.id)).map(ref => <button type="button" className="inspector-source" key={ref.id} onClick={() => onLocate(ref)}>{zh ? "阅读讨论" : "Read discussion"} · {evidencePresentation(ref.title)}</button>) : null}</aside></MapDetailPortal> : null}
    {!diagramOnly && !fullDiagram && edges.length ? <details role="region" className="route-relations concrete-relations understanding-secondary" aria-label={zh ? "要点关系" : "Concept relationships"}><summary>{zh ? "关系与依据" : "Connections and evidence"} · {edges.length}</summary><ul>{edges.map((edge, index) => {
      const key = connectorKey(edge), open = selectedRelation === key && !inspecting;
      const sources = evidence.filter(ref => edge.evidenceIds?.includes(ref.id));
      return <li className={`${open || edge.from === activeId || edge.to === activeId ? "is-connected " : ""}${open ? "is-expanded" : ""}`} key={key}>
        <div className="relation-endpoints"><span className="relation-reference">{index + 1}</span><button type="button" onClick={() => onRead(edge.from)}>{title(sections.find(item => item.id === edge.from)!)}</button>{edge.kind === "comparison" ? <ArrowLeftRight size={16} aria-hidden="true" /> : edge.kind === "feedback" ? <CornerDownLeft size={16} aria-hidden="true" /> : edge.kind === "contains" ? <span className="relation-contains">{zh ? "包含" : "contains"}</span> : <ArrowRight size={16} aria-hidden="true" />}<button type="button" onClick={() => onRead(edge.to)}>{title(sections.find(item => item.id === edge.to)!)}</button>{edge.authored ? <small>{zh ? "我的关系" : "My relation"}</small> : null}</div>
        <button type="button" className="relation-explain" aria-expanded={open} aria-label={`${zh ? "解释关系" : "Explain relation"} ${index + 1}`} onClick={() => selectRelation(key)}><span>{showDetails ? zh ? "查看依据" : "View evidence" : understandingRelationText(edge, zh)}</span><ChevronDown size={14} aria-hidden="true" /></button>
        {open ? <div className="relation-evidence"><p>{edge.excerpt ? evidencePresentation(edge.excerpt) : zh ? "由你维护的关系。" : "A relationship maintained by you."}</p>{onLocate && sources.length ? <div>{sources.filter((ref, i) => sources.findIndex(other => other.conversationId === ref.conversationId && other.messageId === ref.messageId && other.sourceVersionId === ref.sourceVersionId) === i).map(ref => <button type="button" key={ref.id} onClick={() => onLocate(ref)}>{zh ? "阅读讨论" : "Read discussion"} · {evidencePresentation(ref.title)}</button>)}</div> : null}</div> : null}
      </li>;
    })}</ul></details> : null}
  </div>;
}
