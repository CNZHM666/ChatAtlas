import { useDeferredValue, useMemo, useState } from "react";
import { BookMarked, Search } from "lucide-react";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import type { WorkspaceEvidenceOptions } from "../workspace-evidence-context";
import { type WikiKnowledgeUnit, type WikiUnitStatus } from "../../shared/wiki-knowledge";
import { projectLedgerPage, type ProjectWikiPages } from "../project-wiki-pages";
import { useProjectReadingCache } from "../project-reading-cache";

const LABELS: Record<WikiUnitStatus, [string, string]> = {
  confirmed: ["你的决定", "Your decision"], reported: ["你报告的进展", "Your report"], relayed: ["你的资料", "Your material"], proposal: ["AI 建议", "AI proposal"],
  analysis: ["AI 分析", "AI analysis"], stated: ["你的看法", "Your view"], contested: ["有冲突", "Conflicting"], history: ["早期方案", "Earlier"], open: ["仍在讨论", "Open"],
};
const FILTERS: Array<{ id: string; statuses?: WikiUnitStatus[]; label: [string, string]; title?: [string, string] }> = [
  { id: "all", label: ["全部", "All"] }, { id: "decided", statuses: ["confirmed"], label: ["你的决定", "Your decisions"], title: ["你亲口做的选择（我们要、只做、不要、改成……）、你后来同意的 AI 方案，以及你在关键决定里确认的", "Choices in your own words, AI proposals you later agreed to, and what you confirmed in key decisions"] },
  { id: "proposal", statuses: ["proposal", "analysis"], label: ["AI 建议", "AI"] }, { id: "relayed", statuses: ["relayed", "stated", "reported"], label: ["你的资料与看法", "Your material"], title: ["你贴进来的资料、你的看法，以及你报告的进展", "Material you pasted, your views and the progress you reported"] },
  { id: "open", statuses: ["open", "contested"], label: ["仍在讨论", "Open"] }, { id: "history", statuses: ["history"], label: ["早期方案", "Earlier"], title: ["被替代或明确不采用的方案", "Superseded or rejected plans"] },
];
const PAGE = 40;

/** Browse the extracted points by chapter and by holder, with their original passages. */
export function KnowledgeLedger({ session, zh, onLocate, pageReading }: { session: FocusSession; zh: boolean; onLocate: (ref: FocusEvidence, options?: WorkspaceEvidenceOptions) => void; pageReading?: Partial<ProjectWikiPages> | null }) {
  const cache = useProjectReadingCache();
  const ledger = session.wikiKnowledge;
  const [filter, setFilter] = useState("all"), [query, setQuery] = useState(""), [shown, setShown] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // The point whose original is open beside the ledger stays marked, so the reader sees which one they are checking.
  const [checking, setChecking] = useState<string>();
  const data = pageReading === null ? undefined : pageReading?.ledger
    ?? cache.get(session, "ledger-page", () => projectLedgerPage(session));
  const active = FILTERS.find(item => item.id === filter)!;
  const needle = useDeferredValue(query.trim().toLocaleLowerCase());
  const chapters = useMemo(() => {
    if (!data || (!active.statuses && !needle)) return data?.chapters ?? [];
    return data.chapters.map(chapter => ({ ...chapter, rows: chapter.rows.filter(({ unit, search }) =>
      (!active.statuses || active.statuses.includes(data.statuses.get(unit.id)!)) && (!needle || search.includes(needle))) }));
  }, [data, active, needle]);
  const name = zh ? "知识点账本" : "Knowledge ledger";
  if (pageReading === null) return <section className="knowledge-ledger" aria-label={name}>
    <h2><BookMarked size={18} aria-hidden="true" />{name}</h2>
    <p className="muted" role="status">{zh ? "正在加载知识点…" : "Loading knowledge points…"}</p>
  </section>;
  if (!ledger || !data) return null;
  // The point's own words are marked, not the excerpt first saved for its message: points of one message each open at
  // their own place, and clicking another while the panel is open moves the panel to it.
  const open = (unit: WikiKnowledgeUnit) => {
    const ref = session.evidence.find(ref => ref.conversationId === unit.evidence.conversationId && ref.messageId === unit.evidence.messageId) ?? { id: `unit:${unit.id}`, conversationId: unit.evidence.conversationId, messageId: unit.evidence.messageId, title: unit.subject, excerpt: unit.evidence.quote };
    setChecking(unit.id);
    onLocate(ref, { references: [ref], quote: unit.evidence.quote, claim: unit.statement, mode: "view" });
  };
  const count = (statuses: WikiUnitStatus[]) => statuses.reduce((sum, status) => sum + (data.counts.get(status) ?? 0), 0);
  return <section className="knowledge-ledger" aria-label={name}>
    <h2><BookMarked size={18} aria-hidden="true" />{zh ? "知识点账本" : "Knowledge ledger"}<small>{zh ? `${data.total} 个知识点 · 你的决定 ${count(["confirmed"])} · AI 建议 ${count(["proposal", "analysis"])}` : `${data.total} points · yours ${count(["confirmed"])} · AI ${count(["proposal", "analysis"])}`}</small></h2>
    <div className="knowledge-ledger-tools">
      <div role="tablist" aria-label={zh ? "按来源筛选" : "Filter by holder"}>{FILTERS.filter(item => !item.statuses || count(item.statuses) > 0 || filter === item.id).map(item => <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} title={item.title?.[zh ? 0 : 1]} onClick={() => { if (item.id !== filter) { setFilter(item.id); setExpanded({}); } }}>{item.label[zh ? 0 : 1]}{item.statuses ? <small>{count(item.statuses)}</small> : null}</button>)}</div>
      <label><Search size={14} aria-hidden="true" /><input type="search" value={query} placeholder={zh ? "搜索知识点" : "Search points"} aria-label={zh ? "搜索知识点" : "Search points"} onChange={event => { setQuery(event.target.value); setExpanded({}); }} /></label>
    </div>
    {chapters.map(chapter => {
      const { rows } = chapter;
      if (!rows.length) return null;
      const limit = shown[chapter.id] ?? PAGE;
      const openChapter = expanded[chapter.id] ?? (Boolean(needle) || filter !== "all");
      return <details key={chapter.id} className="knowledge-ledger-chapter" open={openChapter}>
        <summary onClick={event => { event.preventDefault(); setExpanded(current => ({ ...current, [chapter.id]: !openChapter })); }}><strong>{chapter.title}</strong><small>{rows.length}</small></summary>
        {openChapter && <><ul>{rows.slice(0, limit).map(({ subject, unit }, index) => <li key={unit.id}>
          {index === 0 || rows[index - 1].subject !== subject ? <h3>{subject}</h3> : null}
          <button type="button" className={checking === unit.id ? "is-checking" : undefined} aria-current={checking === unit.id ? "true" : undefined} title={zh ? "查看原文" : "Read the original"} onClick={() => open(unit)}><span className={`knowledge-ledger-status is-${data.statuses.get(unit.id)}`}>{LABELS[data.statuses.get(unit.id)!][zh ? 0 : 1]}</span><span>{unit.statement}</span></button>
        </li>)}</ul>
        {rows.length > limit ? <button type="button" className="knowledge-ledger-more" onClick={() => setShown(current => ({ ...current, [chapter.id]: limit + PAGE }))}>{zh ? `再显示 ${Math.min(PAGE, rows.length - limit)} 条（共 ${rows.length}）` : `Show ${Math.min(PAGE, rows.length - limit)} more (${rows.length})`}</button> : null}</>}
      </details>;
    })}
  </section>;
}
