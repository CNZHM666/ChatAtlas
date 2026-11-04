import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { FocusSection } from "../../shared/focus-session";
import { evidencePresentation } from "../evidence-presentation";
import { overviewRouteGroups } from "../understanding-route-layout";
import { understandingEdgeLabel, type UnderstandingEdge } from "../understanding-model";
import { ChapterConceptMap } from "./ChapterConceptMap";

/** Overview nodes are chapters; chapter maps remain responsible for concepts inside them. */
export function OverviewUnderstandingMap({ sections, rootTitle, zh, activeId, focusId, edges, renderCard, onRead }: {
  sections: FocusSection[]; rootTitle?: string; zh: boolean; activeId: string; focusId?: string; edges: UnderstandingEdge[];
  renderCard: (section: FocusSection, placement?: CSSProperties) => ReactNode; onRead: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => overviewRouteGroups(sections), [sections]);
  const title = (item: FocusSection) => item.origin || item.userEdited ? item.title : evidencePresentation(item.title);
  const groupOf = new Map(groups.flatMap(group => group.items.map(item => [item.id, group.id] as const)));
  const crossing = edges.filter(edge => groupOf.get(edge.from) !== groupOf.get(edge.to));
  if (groups.length <= 1 && !groups[0]?.title) return <ChapterConceptMap project sections={sections} rootTitle={rootTitle} activeId={activeId} focusId={focusId} relations={edges} zh={zh} renderCard={renderCard} onRead={onRead} />;
  return <div className="overview-understanding-map" role="group" aria-label={rootTitle}>
    <div className="overview-map-groups">{groups.map((group, index) => {
      const name = group.title || (zh ? `阅读段 ${index + 1}` : `Reading group ${index + 1}`);
      const focused = Boolean(focusId && group.items.some(item => item.id === focusId));
      const open = expanded[group.id] ?? focused;
      const current = group.items.some(item => item.id === activeId);
      const ids = new Set(group.items.map(item => item.id));
      return <details className={`overview-map-group${current ? " is-current" : ""}`} key={group.id} open={open}>
        <summary onClick={event => { event.preventDefault(); setExpanded(value => ({ ...value, [group.id]: !open })); }}>
          <span className="route-card-number">{index + 1}</span><strong>{group.items.some(item => item.origin || item.userEdited) ? name : evidencePresentation(name)}</strong>
          <span className="overview-map-range">{zh ? `第 ${group.start + 1}${group.items.length > 1 ? `–${group.start + group.items.length}` : ""} 节` : `Chapter${group.items.length > 1 ? "s" : ""} ${group.start + 1}${group.items.length > 1 ? `–${group.start + group.items.length}` : ""}`}</span>
          <ChevronDown className="route-group-chevron" size={16} aria-hidden="true" />
        </summary>
        {open ? <ChapterConceptMap project showRoot={false} sections={group.items} activeId={activeId} focusId={focusId} relations={edges.filter(edge => ids.has(edge.from) && ids.has(edge.to))} zh={zh} renderCard={renderCard} onRead={onRead} /> : null}
      </details>;
    })}</div>
    {crossing.length ? <details className="overview-map-crossings"><summary>{zh ? "章节关系" : "Chapter relationships"} · {crossing.length}</summary><div className="route-relations"><ul>{crossing.map(edge => <li key={JSON.stringify([edge.from, edge.to, edge.kind])}>
      <button type="button" onClick={() => onRead(edge.from)}>{title(sections.find(item => item.id === edge.from)!)}</button>
      <span className="route-relation-label"><span aria-hidden="true">{edge.kind === "comparison" ? "↔" : "→"}</span>{understandingEdgeLabel(edge.kind, zh)}{edge.authored ? <small>{zh ? "我的关系" : "My relation"}</small> : null}</span>
      <button type="button" onClick={() => onRead(edge.to)}>{title(sections.find(item => item.id === edge.to)!)}</button>
    </li>)}</ul></div></details> : null}
  </div>;
}
