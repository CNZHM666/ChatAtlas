import { useState } from "react";
import type { FocusBrief as FocusBriefData } from "../../shared/focus-session";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import { evidencePresentation } from "../evidence-presentation";

export function FocusBrief({ session, zh, onOpenEvidence, onChange, hideOpenQuestions = false }: { session: FocusSession; zh: boolean; onOpenEvidence: (evidence: FocusEvidence) => void; onChange: (brief: FocusBriefData) => void; hideOpenQuestions?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [allClaims, setAllClaims] = useState(false);
  const brief = session.brief ?? {
    summary: session.sections.find((section) => section.kind === "finding")?.body.split(/\n\s*\n/u)[0]?.slice(0, 320) ?? "",
    turningPoints: session.sections.filter((section) => section.transition && section.evidenceIds.length).slice(0, 3).map((section) => ({ text: section.transition, evidenceIds: section.evidenceIds })),
    confirmed: [],
    openQuestions: session.sections.filter((section) => section.kind === "open_question").slice(0, 4).map((section) => section.title),
  };
  const evidence = new Map(session.evidence.map((item) => [item.id, item]));
  const summaryLabel = session.mode === "work" ? zh ? "项目概况" : "Project summary" : zh ? "复习概况" : "Review summary";
  const claims = (items: Array<{ text: string; evidenceIds: string[] }>) => items.map((item, index) => {
    const seen = new Set<string>();
    const sources = item.evidenceIds.flatMap(id => {
      const source = evidence.get(id), key = source ? `${source.conversationId}:${source.messageId}` : "";
      if (!source || seen.has(key)) return []; seen.add(key); return [source];
    });
    return <li key={`${index}:${item.text}`}><span>{evidencePresentation(item.text)}</span>{sources.length === 1 ? <button type="button" onClick={() => onOpenEvidence(sources[0])}>{zh ? "回看讨论" : "Read discussion"}</button> : sources.length > 1 ? <details className="brief-discussions"><summary>{zh ? `回看讨论 · ${sources.length}` : `Discussions · ${sources.length}`}</summary><div>{sources.map((source, position) => <button key={source.id} type="button" onClick={() => onOpenEvidence(source)}><span>{position + 1}. {source.title}</span><small>{source.excerpt.slice(0, 100)}</small></button>)}</div></details> : null}</li>;
  });
  return <section className="focus-brief" aria-label={session.mode === "work" ? zh ? "项目一览" : "Project overview" : zh ? "复习概况" : "Review summary"}>
    <div className="focus-brief-heading"><strong>{summaryLabel}</strong><button type="button" onClick={() => setEditing(!editing)}>{editing ? zh ? "完成编辑" : "Done editing" : zh ? "编辑概况" : "Edit overview"}</button></div>
    {editing ? <label className="focus-brief-edit">{summaryLabel}<textarea value={brief.summary} onChange={(event) => onChange({ ...brief, summary: event.target.value })} rows={3} /></label> : brief.summary ? <p className="focus-brief-summary">{evidencePresentation(brief.summary)}</p> : null}
    <div className="focus-brief-grid">
      {editing || brief.turningPoints.length ? <section><h3>{zh ? "关键转折" : "Turning points"}<small>{brief.turningPoints.length}</small></h3>{editing ? brief.turningPoints.map((item, index) => <label className="focus-brief-edit" key={index}><textarea aria-label={`${zh ? "关键转折" : "Turning point"} ${index + 1}`} value={item.text} onChange={(event) => onChange({ ...brief, turningPoints: brief.turningPoints.map((claim, position) => position === index ? { ...claim, text: event.target.value } : claim) })} rows={3} /></label>) : <ul>{claims(allClaims ? brief.turningPoints : brief.turningPoints.slice(0, 3))}</ul>}</section> : null}
      {editing || brief.confirmed.length ? <section><h3>{zh ? "已确认" : "Confirmed"}<small>{brief.confirmed.length}</small></h3>{editing ? brief.confirmed.map((item, index) => <label className="focus-brief-edit" key={index}><textarea aria-label={`${zh ? "已确认" : "Confirmed"} ${index + 1}`} value={item.text} onChange={(event) => onChange({ ...brief, confirmed: brief.confirmed.map((claim, position) => position === index ? { ...claim, text: event.target.value } : claim) })} rows={3} /></label>) : <ul>{claims(allClaims ? brief.confirmed : brief.confirmed.slice(0, 3))}</ul>}</section> : null}
      {(!hideOpenQuestions || editing) && (editing || brief.openQuestions.length) ? <section><h3>{zh ? "待确认" : "To clarify"}<small>{brief.openQuestions.length}</small></h3>{editing ? brief.openQuestions.map((item, index) => <label className="focus-brief-edit" key={index}><textarea aria-label={`${zh ? "待确认" : "Open question"} ${index + 1}`} value={item} onChange={(event) => onChange({ ...brief, openQuestions: brief.openQuestions.map((question, position) => position === index ? event.target.value : question) })} rows={2} /></label>) : <ul>{(allClaims ? brief.openQuestions : brief.openQuestions.slice(0, 3)).map((item) => <li key={item}>{evidencePresentation(item)}</li>)}</ul>}</section> : null}
    </div>
    {!editing && (brief.turningPoints.length > 3 || brief.confirmed.length > 3 || !hideOpenQuestions && brief.openQuestions.length > 3) ? <button className="brief-more-claims" type="button" aria-expanded={allClaims} onClick={() => setAllClaims(!allClaims)}>{allClaims ? zh ? "显示重点" : "Show highlights" : zh ? "查看全部事项" : "View all items"}</button> : null}

  </section>;
}
