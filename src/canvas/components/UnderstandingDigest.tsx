import type { FocusSection } from "../../shared/focus-session";
import { evidencePresentation } from "../evidence-presentation";
import { understandingSummary } from "../understanding-summary";
import { understandingSequence, type UnderstandingPresentationKind } from "../understanding-presentation";
import type { UnderstandingEdge } from "../understanding-model";
import "../understanding-presentation.css";

type Point = FocusSection & { semanticStatus?: string };

/** A reading aid, with details reached through the same source-backed node selection. */
export function UnderstandingDigest({ points, edges = [], kind, zh, onRead }: {
  points: Point[]; edges?: UnderstandingEdge[]; kind: UnderstandingPresentationKind; zh: boolean; onRead: (id: string) => void;
}) {
  const ordered = kind === "process" ? understandingSequence(points, edges) ?? points : points;
  const preview = ordered.slice(0, 5), remaining = ordered.slice(5);
  const rows = (items: Point[], start = 0) => <ol start={start + 1} className="understanding-digest-list">{items.map((point, index) => {
    const personal = point.origin === "user" || point.userEdited;
    const title = personal ? point.title : evidencePresentation(point.title);
    const summary = understandingSummary(point);
    const state = point.semanticStatus ?? point.semanticStructure?.nodes[0]?.status;
    const status = state === "superseded" ? zh ? "已修正" : "Superseded" : point.kind === "proposal" ? zh ? "建议" : "Proposal" : point.kind === "open_question" ? zh ? "待确认" : "Unresolved" : "";
    const previous = ordered[start + index - 1];
    const relation = kind === "process" && previous ? edges.find(edge => !edge.uncertain && edge.from === previous.id && edge.to === point.id) : undefined;
    return <li key={point.id}>
      {relation?.label ? <p className="understanding-step-transfer">↓ {evidencePresentation(relation.label)}</p> : null}
      <button type="button" aria-label={[title, summary !== title ? summary : "", status].filter(Boolean).join(" ")} data-point-id={point.id} onClick={() => onRead(point.id)}>
        {kind === "process" ? <span className="understanding-step-number" aria-hidden="true">{start + index + 1}</span> : null}
        <span className="understanding-digest-copy"><span className="understanding-digest-name"><strong>{title}</strong>{status ? <small>{status}</small> : null}</span>
          {summary && summary !== title ? <span>{personal ? summary : evidencePresentation(summary)}</span> : null}
          {point.inputs?.length || point.outputs?.length ? <span className="understanding-digest-io">{point.inputs?.length ? <span><b>{zh ? "输入" : "Input"}</b>{point.inputs.join(" · ")}</span> : null}{point.outputs?.length ? <span><b>{zh ? "输出" : "Output"}</b>{point.outputs.join(" · ")}</span> : null}</span> : null}
        </span><span aria-hidden="true" className="understanding-digest-open">↗</span>
      </button>
    </li>;
  })}</ol>;
  return <div className={`understanding-digest understanding-digest-${kind}`}>
    {kind === "modules" ? <div className="understanding-digest-heading">{zh ? "模块职责与输入输出" : "Responsibilities and interfaces"}</div> : kind === "decision" ? <div className="understanding-digest-heading">{zh ? "结论、取舍与适用边界" : "Decisions and boundaries"}</div> : null}
    {rows(preview)}
    {remaining.length ? <details className="understanding-secondary"><summary>{zh ? `其余 ${remaining.length} 项` : `${remaining.length} more items`}</summary>{rows(remaining, 5)}</details> : null}
  </div>;
}
