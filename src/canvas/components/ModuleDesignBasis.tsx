import type { FocusEvidence } from "../../shared/focus-session";
import type { ProjectRecord } from "../../shared/project-state";
import { evidencePresentation } from "../evidence-presentation";

export function ModuleDesignBasis({ decisions, constraints, evidence, zh, onLocate }: {
  decisions: Array<ProjectRecord & { confirmed?: boolean }>; constraints: ProjectRecord[];
  evidence: FocusEvidence[]; zh: boolean; onLocate: (ref: FocusEvidence) => void;
}) {
  if (!decisions.length && !constraints.length) return null;
  return <div className="module-design-basis">{[
    { title: zh ? "为什么这样设计" : "Design decisions", items: decisions },
    { title: zh ? "关键约束" : "Constraints", items: constraints },
  ].filter(group => group.items.length).map(group => <section key={group.title}><h3>{group.title}</h3><ul>{group.items.map(item => <li key={item.id}>
    <strong>{evidencePresentation(item.text)}</strong><small>{"confirmed" in item && item.confirmed ? zh ? "我的确认" : "Confirmed by me" : item.status === "proposal" ? zh ? "历史建议" : "Historical proposal" : item.status === "uncertain" ? zh ? "待确认" : "Uncertain" : zh ? "讨论记录" : "Discussion record"}</small>
    {item.reason ? <p>{evidencePresentation(item.reason)}</p> : null}
    {evidence.filter(ref => item.evidenceIds.includes(ref.id)).map(ref => <button type="button" key={ref.id} onClick={() => onLocate(ref)}>{zh ? "阅读依据" : "Read evidence"} · {evidencePresentation(ref.title)}</button>)}
  </li>)}</ul></section>)}</div>;
}
