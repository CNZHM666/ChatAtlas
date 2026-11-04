import { useContext, useMemo, useState } from "react";
import { BookMarked, Search } from "lucide-react";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import { type WikiKnowledgeUnit, type WikiUnitStatus, type WikiUserDecision } from "../../shared/wiki-knowledge";
import { resolveWikiReading } from "../../ai/wiki-knowledge-reading";
import { roadmaps } from "../../ai/wiki-knowledge-write";
import { ledgerDecisionsPending, withDecision } from "../../ai/wiki-key-decisions";
import { ProjectKnowledgeActions } from "../project-knowledge-actions";
import { KeyDecisions } from "./KeyDecisions";

/** What the ledger page shows a point as: its status, or an earlier plan the AI itself later replaced. */
type LedgerStatus = WikiUnitStatus | "earlier";
const LABELS: Record<LedgerStatus, [string, string]> = {
  confirmed: ["你的决定", "Your decision"], reported: ["你报告的进展", "Your report"], relayed: ["你的资料", "Your material"], proposal: ["AI 建议", "AI proposal"],
  analysis: ["AI 分析", "AI analysis"], stated: ["你的看法", "Your view"], contested: ["有冲突", "Conflicting"], history: ["早期方案", "Earlier"], earlier: ["早先方案", "Earlier plan"], open: ["仍在讨论", "Open"],
};
const FILTERS: Array<{ id: string; statuses?: LedgerStatus[]; label: [string, string]; title?: [string, string] }> = [
  { id: "all", label: ["全部", "All"] }, { id: "decided", statuses: ["confirmed"], label: ["你的决定", "Your decisions"], title: ["你亲口做的选择（我们要、只做、不要、改成……）、你后来同意的 AI 方案，以及你在关键决定里确认的", "Choices in your own words, AI proposals you later agreed to, and what you confirmed in key decisions"] },
  { id: "proposal", statuses: ["proposal", "analysis"], label: ["AI 建议", "AI"] }, { id: "relayed", statuses: ["relayed", "stated", "reported"], label: ["你的资料与看法", "Your material"], title: ["你贴进来的资料、你的看法，以及你报告的进展", "Material you pasted, your views and the progress you reported"] },
  { id: "open", statuses: ["open", "contested"], label: ["仍在讨论", "Open"] }, { id: "history", statuses: ["history", "earlier"], label: ["早期方案", "Earlier"], title: ["你改掉或不采用的旧方案，以及 AI 后来换掉的旧方案和旧路线", "Plans you changed or rejected, and earlier plans and roadmaps the AI later replaced"] },
];
const PAGE = 40;

/** Every knowledge point the document was written from, by chapter and subject: what it says, whose it is, and its
 * original one click away. The key decisions sit on top; a verdict here is kept in the ledger and the document is
 * rewritten around it on request. */
export function KnowledgeLedger({ session, zh, onLocate, onApplyDecisions }: { session: FocusSession; zh: boolean; onLocate: (ref: FocusEvidence) => void; onApplyDecisions?: () => void }) {
  const actions = useContext(ProjectKnowledgeActions);
  const ledger = session.wikiKnowledge;
  const [filter, setFilter] = useState("all"), [query, setQuery] = useState(""), [shown, setShown] = useState<Record<string, number>>({});
  const data = useMemo(() => {
    if (!ledger?.organization) return undefined;
    const { organization: effective, units: all, statuses } = resolveWikiReading(ledger);
    const organization = effective!;
    const merged = new Set(organization.merged.flatMap(row => row.from));
    const active = new Set(organization.subjects.flatMap(subject => subject.unitIds));
    const units = all.filter(unit => active.has(unit.id)), byId = new Map(units.map(unit => [unit.id, unit]));
    const subjects = new Map(organization.subjects.map(subject => [subject.id, subject]));
    const chapters = organization.chapters.map(chapter => ({ id: chapter.id, title: chapter.title, subjects: chapter.subtopics.flatMap(topic => topic.subjectIds).flatMap(id => { const subject = subjects.get(id); return subject ? [{ name: subject.name, units: subject.unitIds.filter(unit => !merged.has(unit)).flatMap(unit => byId.get(unit) ? [byId.get(unit)!] : []) }] : []; }) }));
    // Earlier plans the AI itself replaced: a roadmap older than the newest of its scope, or a proposal a later
    // assistant answer replaced while the user adopted neither. The Wiki's own statuses stay as they are.
    const replaceable = (id: string) => ["proposal", "analysis", "relayed"].includes(statuses.get(id)!);
    const earlier = new Set<string>(), scopeOf = new Map(organization.subjects.flatMap(subject => subject.unitIds.map(id => [id, subject.name] as const)));
    for (const chapter of organization.chapters) {
      const slots = chapter.subtopics.map(topic => ({ title: topic.title, units: topic.subjectIds.flatMap(id => subjects.get(id)?.unitIds ?? []).flatMap(id => !merged.has(id) && byId.get(id) ? [byId.get(id)!] : []) }));
      const { planOf, latestPlans } = roadmaps(slots, scopeOf, zh ? "zh-CN" : "en");
      for (const [id, label] of planOf) if (!latestPlans.has(label) && replaceable(id)) earlier.add(id);
    }
    const later = (older: string, newer: string) => { const a = byId.get(older)?.evidence, b = byId.get(newer)?.evidence; return Boolean(a && b && a.conversationId === b.conversationId && b.messageIndex > a.messageIndex); };
    const assistant = (id: string) => byId.get(id)?.evidence.role === "assistant" || Boolean(byId.get(id)?.evidence.pasted);
    for (const relation of organization.relations) if ((relation.kind === "replaces" || relation.kind === "rejects") && assistant(relation.newer) && replaceable(relation.older) && later(relation.older, relation.newer)) earlier.add(relation.older);
    const shownStatus = new Map<string, LedgerStatus>(units.map(unit => [unit.id, earlier.has(unit.id) ? "earlier" : statuses.get(unit.id)!]));
    const counts = new Map<LedgerStatus, number>();
    for (const unit of units) if (!merged.has(unit.id)) counts.set(shownStatus.get(unit.id)!, (counts.get(shownStatus.get(unit.id)!) ?? 0) + 1);
    return { chapters, statuses: shownStatus, total: units.filter(unit => !merged.has(unit.id)).length, counts };
  }, [ledger, zh]);
  if (!ledger || !data) return null;
  const active = FILTERS.find(item => item.id === filter)!, needle = query.trim().toLocaleLowerCase();
  const visible = (unit: WikiKnowledgeUnit) => (!active.statuses || active.statuses.includes(data.statuses.get(unit.id)!)) && (!needle || `${unit.statement} ${unit.subject}`.toLocaleLowerCase().includes(needle));
  const open = (unit: WikiKnowledgeUnit) => onLocate(session.evidence.find(ref => ref.conversationId === unit.evidence.conversationId && ref.messageId === unit.evidence.messageId) ?? { id: `unit:${unit.id}`, conversationId: unit.evidence.conversationId, messageId: unit.evidence.messageId, title: unit.subject, excerpt: unit.evidence.quote });
  const decide = async (unitIds: string[], verdict: WikiUserDecision["verdict"] | undefined) => { if (actions) await actions.save(current => current.wikiKnowledge ? { ...current, wikiKnowledge: withDecision(current.wikiKnowledge, unitIds, verdict) } : current); };
  const count = (statuses: LedgerStatus[]) => statuses.reduce((sum, status) => sum + (data.counts.get(status) ?? 0), 0);
  const pending = ledgerDecisionsPending(ledger);
  return <section className="knowledge-ledger" aria-label={zh ? "知识点账本" : "Knowledge ledger"}>
    <h2><BookMarked size={18} aria-hidden="true" />{zh ? "知识点账本" : "Knowledge ledger"}<small>{zh ? `${data.total} 个知识点 · 你的决定 ${count(["confirmed"])} · AI 建议 ${count(["proposal", "analysis"])}` : `${data.total} points · yours ${count(["confirmed"])} · AI ${count(["proposal", "analysis"])}`}</small></h2>
    {actions ? <KeyDecisions ledger={ledger} zh={zh} onDecide={decide} onLedger={change => actions.save(current => current.wikiKnowledge ? { ...current, wikiKnowledge: change(current.wikiKnowledge) } : current)} open={false}
      footer={pending && onApplyDecisions ? <div className="key-decisions-apply"><span>{zh ? "文档还没有按你的确认改写。" : "The document does not reflect your verdicts yet."}</span><button type="button" className="primary" onClick={onApplyDecisions}>{zh ? "按确认更新文档 · 先预览" : "Update the document · Preview"}</button></div> : undefined}/> : null}
    <div className="knowledge-ledger-tools">
      <div role="tablist" aria-label={zh ? "按来源筛选" : "Filter by holder"}>{FILTERS.filter(item => !item.statuses || count(item.statuses) > 0 || filter === item.id).map(item => <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} title={item.title?.[zh ? 0 : 1]} onClick={() => setFilter(item.id)}>{item.label[zh ? 0 : 1]}{item.statuses ? <small>{count(item.statuses)}</small> : null}</button>)}</div>
      <label><Search size={14} aria-hidden="true" /><input type="search" value={query} placeholder={zh ? "搜索知识点" : "Search points"} aria-label={zh ? "搜索知识点" : "Search points"} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    {data.chapters.map(chapter => {
      const rows = chapter.subjects.flatMap(subject => subject.units.filter(visible).map(unit => ({ subject: subject.name, unit })));
      if (!rows.length) return null;
      const limit = shown[chapter.id] ?? PAGE;
      return <details key={chapter.id} className="knowledge-ledger-chapter" open={Boolean(needle) || filter !== "all"}>
        <summary><strong>{chapter.title}</strong><small>{rows.length}</small></summary>
        <ul>{rows.slice(0, limit).map(({ subject, unit }, index) => <li key={unit.id}>
          {index === 0 || rows[index - 1].subject !== subject ? <h3>{subject}</h3> : null}
          <button type="button" title={zh ? "查看原文" : "Read the original"} onClick={() => open(unit)}><span className={`knowledge-ledger-status is-${data.statuses.get(unit.id)}`}>{LABELS[data.statuses.get(unit.id)!][zh ? 0 : 1]}</span><span>{unit.statement}</span></button>
        </li>)}</ul>
        {rows.length > limit ? <button type="button" className="knowledge-ledger-more" onClick={() => setShown(current => ({ ...current, [chapter.id]: limit + PAGE }))}>{zh ? `再显示 ${Math.min(PAGE, rows.length - limit)} 条（共 ${rows.length}）` : `Show ${Math.min(PAGE, rows.length - limit)} more (${rows.length})`}</button> : null}
      </details>;
    })}
  </section>;
}
