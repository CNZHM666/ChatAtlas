import { useMemo, useState } from "react";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import { HomeEvidencePreview } from "./HomeEvidencePreview";
import { ReaderGuide } from "./ReaderGuide";

const referenceKey = (ref: FocusEvidence) => JSON.stringify([ref.conversationId, ref.messageId, ref.sourceVersionId ?? ref.sourceSignature ?? ""]);

export function HomeRecallAnswer({ answer, zh, onLocate, onSource }: { answer: FocusSession; zh: boolean; onLocate: (evidence: FocusEvidence) => void; onSource?: (evidence: FocusEvidence) => void }) {
  const [selected, setSelected] = useState<{ key: string; sectionId: string }>();
  const references = useMemo(() => [...new Map(answer.evidence.map(ref => [referenceKey(ref), ref])).values()], [answer.evidence]);
  const number = (id: string) => { const ref = answer.evidence.find(item => item.id === id); return ref ? references.findIndex(item => referenceKey(item) === referenceKey(ref)) + 1 : 0; };
  const pending = answer.sections.filter(section => section.reviewIssue || section.evidenceReview && ["partial", "unanchored"].includes(section.evidenceReview.status)).length;
  const active = references.find(ref => referenceKey(ref) === selected?.key);
  const preview = active ? <aside className="home-evidence-preview" aria-label={zh ? "依据预览" : "Source preview"}><header><strong>{active.title}</strong><button onClick={() => setSelected(undefined)}>{zh ? "收起" : "Close"}</button></header><HomeEvidencePreview key={selected?.key} evidence={active} answer={answer} zh={zh} /><button onClick={() => onLocate(active)}>{zh ? "阅读上下文" : "Read context"}</button></aside> : null;
  return <article className="home-recall-answer" aria-label={zh ? "历史回答" : "Historical answer"}>
    <header className="home-answer-heading"><span>{zh ? "根据历史讨论" : "From your discussions"}</span>{pending ? <details><summary>{zh ? `${pending} 处待核对` : `${pending} parts need verification`}</summary><p>{zh ? "以下结论尚未完成核验，可以展开来源核对。" : "Some conclusions still need verification against their sources."}</p><ul>{answer.sections.filter(section => section.reviewIssue || section.evidenceReview && ["partial", "unanchored"].includes(section.evidenceReview.status)).map(section => <li key={section.id}>{section.title}</li>)}</ul></details> : null}</header>
    {answer.sections.map(section => <section key={section.id}><h3>{section.title}</h3><ReaderGuide content={section.body} zh={zh} complete hideEvidenceMarkers /><div className="home-inline-citations" aria-label={zh ? `${section.title}的来源` : `Sources for ${section.title}`}>{[...new Set(section.evidenceIds.map(number).filter(Boolean))].map(index => { const ref = references[index - 1], key = referenceKey(ref); return <button key={index} className="home-citation" title={ref.title} aria-label={zh ? `展开依据 ${index}` : `Expand source ${index}`} aria-expanded={onSource ? undefined : selected?.key === key && selected.sectionId === section.id} onClick={() => onSource ? onSource(ref) : setSelected(selected?.key === key && selected.sectionId === section.id ? undefined : { key, sectionId: section.id })}>[{index}]</button>; })}</div>{selected?.sectionId === section.id ? preview : null}</section>)}
    {references.length ? onSource ? <div className="home-answer-actions"><button onClick={() => onSource(references[0])}>{zh ? `查看来源 · ${references.length}` : `View sources · ${references.length}`}</button></div> : <details className="home-recall-evidence"><summary>{zh ? `全部来源 · ${references.length}` : `All sources · ${references.length}`}</summary>{references.map((ref, index) => <button key={referenceKey(ref)} onClick={() => setSelected({ key: referenceKey(ref), sectionId: "all" })}>[{index + 1}] {ref.title}</button>)}</details> : null}
    {selected?.sectionId === "all" ? preview : null}
  </article>;
}
