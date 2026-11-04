import type { FocusEvidence, FocusSection } from "../../shared/focus-session";
import { evidencePresentation } from "../evidence-presentation";
import { understandingRelationText, understandingResponsibility, type UnderstandingEdge } from "../understanding-model";

/** A summary-derived relationship is navigation, never proof of a confirmed decision. */
export function UnderstandingDetail({ section, sections, edges, evidence, zh, onRead, onLocate, onClear }: {
  section: FocusSection; sections: FocusSection[]; edges: UnderstandingEdge[]; evidence: FocusEvidence[]; zh: boolean;
  onRead: (id: string) => void; onLocate?: (evidence: FocusEvidence) => void; onClear: () => void;
}) {
  const title = (item: FocusSection) => item.origin || item.userEdited ? item.title : evidencePresentation(item.title);
  const refs = evidence.filter(ref => section.evidenceIds.includes(ref.id));
  const sources = [...new Map(refs.map(ref => [`${ref.conversationId}:${ref.messageId}`, ref])).values()];
  const duty = understandingResponsibility(section);
  return <section className="understanding-detail" aria-label={zh ? "结构详情" : "Structure detail"}>
    <header><strong>{title(section)}</strong><button type="button" onClick={onClear} aria-label={zh ? "取消聚焦" : "Clear focus"}>×</button></header>
    {duty ? <p><small>{section.responsibility ? zh ? "我的说明" : "My explanation" : zh ? "正文职责" : "Responsibility in text"}</small>{duty}</p> : null}
    <ul>{edges.filter(edge => edge.from === section.id || edge.to === section.id).map(edge => {
      const from = sections.find(item => item.id === edge.from)!, to = sections.find(item => item.id === edge.to)!;
      return <li key={`${edge.from}:${edge.to}:${edge.kind}`}><span>{title(from)} <b>{understandingRelationText(edge, zh)}</b> {title(to)}</span><small>{edge.authored ? zh ? "我的关系" : "My relation" : edge.kind === "contains" ? zh ? "正文层级" : "Text hierarchy" : zh ? "整理内容" : "Organized text"}</small>{edge.excerpt && edge.kind !== "contains" ? <blockquote>{edge.excerpt}</blockquote> : null}</li>;
    })}</ul>
    <footer><button type="button" onClick={() => onRead(section.id)}>{zh ? "阅读章节" : "Read chapter"}</button>{onLocate && sources.length ? <details><summary>{zh ? "相关讨论" : "Related discussions"} · {sources.length}</summary>{sources.map(ref => <button type="button" key={ref.id} onClick={() => onLocate(ref)}>{evidencePresentation(ref.title)}{ref.excerpt ? <small>{evidencePresentation(ref.excerpt)}</small> : null}</button>)}</details> : null}</footer>
  </section>;
}
