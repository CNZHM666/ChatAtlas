import type { FocusSection } from "../../shared/focus-session";
import { evidencePresentation } from "../evidence-presentation";
import { understandingSummary } from "../understanding-summary";
import { hasVersionHeading, type UnderstandingPresentationKind } from "../understanding-presentation";
import { ReaderGuide } from "./ReaderGuide";
import "../understanding-presentation.css";
import { UnderstandingDigest } from "./UnderstandingDigest";
import type { UnderstandingEdge } from "../understanding-model";

export function UnderstandingBlocks({ points, kind = "points", table, zh, onRead, review = false, compact = false, edges }: {
  points: Array<FocusSection & { layer?: string; semanticStatus?: string }>;
  kind?: UnderstandingPresentationKind; table?: string; zh: boolean; onRead: (id: string) => void; review?: boolean;
  compact?: boolean; edges?: UnderstandingEdge[];
}) {
  if (compact && kind !== "timeline" && kind !== "comparison") {
    const digest = <UnderstandingDigest points={points} kind={kind} edges={edges} zh={zh} onRead={onRead} />;
    return review ? <details className="understanding-recall"><summary>{zh ? "回想后查看理解" : "Recall, then reveal"}</summary>{digest}</details> : digest;
  }
  const groups = new Map<string, typeof points>();
  const primary = kind === "timeline" ? points.filter(hasVersionHeading) : points;
  const extra = kind === "timeline" ? points.filter(point => !hasVersionHeading(point)) : [];
  for (const point of primary) {
    const group = point.layer || point.phase || "";
    groups.set(group, [...(groups.get(group) ?? []), point]);
  }
  const content = <div className={`understanding-blocks${kind === "timeline" ? " understanding-version-points" : ""}`}>
    {kind === "comparison" && table ? <div className="understanding-comparison"><ReaderGuide content={table} zh={zh} complete hideEvidenceMarkers /></div> : null}
    {[...groups].map(([group, items]) => <section className="understanding-point-group" key={group}>
      {group ? <h3>{evidencePresentation(group)}</h3> : null}
      <ol>{items.map(point => {
        const personal = point.origin === "user" || point.userEdited;
        const title = personal ? point.title : evidencePresentation(point.title);
        const lead = understandingSummary(point);
        const status = (point.semanticStatus ?? point.semanticStructure?.nodes[0]?.status) === "superseded" ? zh ? "已修正" : "Superseded" : point.kind === "proposal" ? zh ? "建议" : "Proposal" : point.kind === "open_question" ? zh ? "待确认" : "Unresolved" : "";
        return <li key={point.id}><button type="button" data-point-id={point.id} onClick={() => onRead(point.id)}><span className="understanding-point-text"><strong>{title}</strong>{lead && lead !== title ? <span>{personal ? lead : evidencePresentation(lead)}</span> : null}</span>{status ? <small>{status}</small> : null}<span className="understanding-point-arrow" aria-hidden="true">↗</span></button></li>;
      })}</ol>
    </section>)}
    {extra.length ? <details className="understanding-secondary"><summary>{zh ? "补充要点" : "Additional points"} · {extra.length}</summary><UnderstandingBlocks points={extra} zh={zh} onRead={onRead} /></details> : null}
  </div>;
  return review ? <details className="understanding-recall"><summary>{zh ? "回想后查看要点" : "Recall, then reveal key points"}</summary>{content}</details> : content;
}
