import { EvidenceReviewButton } from "./EvidenceReviewButton";
import type { FocusEvidence } from "../../shared/focus-session";
import type { ProjectChange } from "../../shared/project-changes";

export function ProjectChangeHistory({ changes, zh, onLocate, preview = false, comparison = false }: { changes: ProjectChange[]; zh: boolean; onLocate: (ref: FocusEvidence) => void; preview?: boolean; comparison?: boolean }) {
  if (!changes.length) return null;
  const label = (kind: ProjectChange["kind"]) => ({ added: zh ? "新增" : "Added", changed: zh ? "调整" : "Changed", superseded: zh ? "替换" : "Superseded", conflict: zh ? "待确认" : "Uncertain", resolved: zh ? "已解决" : "Resolved", source_changed: zh ? "依据变化" : "Source changed" })[kind];
  return <details className="project-change-history" open={preview || undefined}><summary>{zh ? preview ? "方案变化" : "变更记录" : preview ? "Plan changes" : "Change history"}<span>{changes.length}</span></summary><ol>{[...changes].reverse().map(change => <li key={change.id}>
    <div className="project-change-caption"><strong>{label(change.kind)}</strong>{comparison ? <small>{({ module: zh ? "模块" : "Module", decision: zh ? "决策" : "Decision", constraint: zh ? "约束" : "Constraint", question: zh ? "问题" : "Question", relation: zh ? "关系" : "Relationship" })[change.category]}</small> : null}<time>{new Date(change.acceptedAt ?? change.proposedAt).toLocaleDateString(zh ? "zh-CN" : "en")}</time>{!change.acceptedAt && !comparison ? <small>{zh ? "待采用" : "Proposed"}</small> : null}</div>
    {change.before ? <p className="project-change-before">{change.before}</p> : null}{change.after ? <p>{change.after}</p> : null}
    <details className="project-change-evidence"><summary>{zh ? "查看依据" : "Sources"}</summary>{change.reason ? <p>{change.reason}</p> : change.before && change.after ? <small>{zh ? "变更原因未明确" : "Reason not specified"}</small> : null}
      {[[zh ? "原方案" : "Before", change.beforeQuote, change.beforeSources], [zh ? "新记录" : "After", change.afterQuote, change.afterSources]].map(([title, quote, sources], index) => quote ? <div key={index}><strong>{title as string}</strong><blockquote>{quote as string}</blockquote><EvidenceReviewButton sources={sources as FocusEvidence[]} zh={zh} onLocate={onLocate} quote={quote as string} historical/></div> : null)}
      {change.sourceSnapshots.some(source => source.discussedAt && source.discussedAt > 946684800000) ? <small>{zh ? "讨论时间：" : "Discussed: "}{[...new Set(change.sourceSnapshots.filter(source => source.discussedAt && source.discussedAt > 946684800000).map(source => new Date(source.discussedAt!).toLocaleDateString(zh ? "zh-CN" : "en")))].join(" · ")}</small> : null}
    </details>
  </li>)}</ol></details>;
}
