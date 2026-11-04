import { useId, useState, type ReactNode } from "react";
import { ArrowRight, Check } from "lucide-react";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import type { Conversation } from "../../shared/types";
import { chronologicalGroups, reviewLead } from "../review-presentation";
import { overviewModel } from "../overview-model";
import { readingTitle } from "../../shared/reading-title";
import { evidencePresentation } from "../evidence-presentation";
import { DiscussionEvolution } from "./DiscussionEvolution";

export function FocusOverview({ session, conversations, zh, onRead, onAnalyze, onAdjustScope, onLocate, onOpenSource, children, route, query, showSourceNavigation = true }: { session: FocusSession; conversations: Conversation[]; zh: boolean; onRead: (id: string) => void; onAnalyze?: () => void; onAdjustScope?: () => void; onLocate: (evidence: FocusEvidence) => void; onOpenSource?: (id: string) => void; children?: ReactNode; route?: ReactNode; query?: ReactNode; showSourceNavigation?: boolean }) {
  const [showSources, setShowSources] = useState(false);
  const [view, setView] = useState<"overview" | "structure" | "discussion">("overview");
  const tabsId = useId();
  const tabs = [{ id: "overview", label: zh ? "复习概况" : "Review overview" }, { id: "structure", label: zh ? "知识结构" : "Knowledge structure" }, { id: "discussion", label: zh ? "讨论过程" : "Discussion history" }] as const;
  const finished = new Set(session.completedSectionIds);
  const resume = session.sections.find(section => section.id === session.activeSectionId && !finished.has(section.id)) ?? session.sections.find(section => session.reviewNeeds?.[section.id]) ?? session.sections.find(section => !finished.has(section.id)) ?? session.sections.find(section => section.id === session.activeSectionId) ?? session.sections[0];
  const orientation = overviewModel(session, zh);
  const complete = session.scope?.kind !== "goal" && session.coverage && session.coverage.method !== "sampled";
  const open = orientation.open.filter(question => question !== (resume ? session.reviewNeeds?.[resume.id] : undefined));
  return <section className="focus-overview focus-overview-layout review-workbench" aria-label={zh ? "阅读总览" : "Reading overview"}>
    {query}
    <header className="project-outcome-heading"><h1 title={evidencePresentation(session.title)}>{readingTitle(evidencePresentation(session.title))}</h1>
    <div className="overview-scope"><span>{zh ? `${session.sections.length} 个章节` : `${session.sections.length} chapters`}</span><span className="overview-coverage">{zh ? session.scope?.kind === "goal" ? "局部整理" : complete ? "已分析" : session.coverage ? "选读" : "旧版成果" : session.scope?.kind === "goal" ? "Selected discussions analyzed" : complete ? "All sources analyzed" : session.coverage ? "Goal-based sample" : "Analysis scope unavailable"}</span>{onAdjustScope ? <button type="button" onClick={onAdjustScope}>{zh ? "调整板块范围" : "Adjust discussion scope"}</button> : !complete && onAnalyze ? <button type="button" onClick={onAnalyze}>{zh ? "分析全部来源" : "Analyze all sources"}</button> : null}</div></header>
    {session.scope?.kind === "goal" ? <details className="overview-selected-topics"><summary>{zh ? "本次整理的板块" : "Included discussions"}</summary><ul>{session.scope.blocks?.map((block, index) => <li key={index}>{block.title}</li>)}</ul><p>{zh ? "仅分析这些板块及其中的连续上下文，不代表来源对话已全文分析。" : "Only these discussions and their continuous context were analyzed; the source conversations were not reviewed in full."}</p></details> : null}
    <div className="project-outcome-tabs review-workbench-tabs" role="tablist" aria-label={zh ? "复习内容" : "Review content"} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const index = tabs.findIndex(tab => tab.id === view); const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length; setView(tabs[next].id); event.currentTarget.querySelector<HTMLButtonElement>(`[id="${tabsId}-${tabs[next].id}"]`)?.focus(); }}>{tabs.map(tab => <button key={tab.id} id={`${tabsId}-${tab.id}`} type="button" role="tab" aria-selected={view === tab.id} aria-controls={`${tabsId}-${tab.id}-panel`} tabIndex={view === tab.id ? 0 : -1} onClick={() => setView(tab.id)}>{tab.label}</button>)}</div>
    <div role="tabpanel" id={`${tabsId}-overview-panel`} aria-labelledby={`${tabsId}-overview`} hidden={view !== "overview"}>
    {resume ? <section className="review-resume"><div className="review-resume-progress"><span>{zh ? "复习进度" : "Review progress"}</span><strong>{session.sections.filter(section => finished.has(section.id)).length}<small> / {session.sections.length}</small></strong><progress aria-label={zh ? "复习进度" : "Review progress"} max={Math.max(1, session.sections.length)} value={session.sections.filter(section => finished.has(section.id)).length} /></div><div className="review-resume-content"><small>{session.reviewNeeds?.[resume.id] ? zh ? "待复习" : "Revisit" : finished.has(resume.id) ? zh ? "再次回顾" : "Read again" : zh ? "接着上次阅读" : "Pick up where you left off"}</small><strong>{evidencePresentation(resume.title)}</strong>{session.reviewNeeds?.[resume.id] ? <p>{evidencePresentation(session.reviewNeeds[resume.id])}</p> : null}</div><button type="button" className="primary" onClick={() => onRead(resume.id)}>{finished.has(resume.id) && !session.reviewNeeds?.[resume.id] ? <Check size={16} /> : null}{zh ? "继续复习" : "Continue reviewing"}<ArrowRight size={16} /></button></section> : null}
    {children || orientation.summary || orientation.topics.length ? <div className="overview-context">
    {children}
    {orientation.summary || orientation.topics.length ? <section className="overview-summary" aria-label={zh ? "对话概况" : "Conversation summary"}>
      {orientation.summary && !(children && session.brief?.summary) ? <><h2>{zh ? "对话概况" : "Conversation summary"}</h2><p>{orientation.summary}</p></> : null}
    </section> : null}
    </div> : null}
    {open.length ? <section className="overview-open"><h2>{zh ? "下次继续" : "Continue next time"}</h2><ul>{open.slice(0, 3).map((question) => <li key={question}>{question}</li>)}</ul>{open.length > 3 ? <details><summary>{zh ? `还有 ${open.length - 3} 个问题` : `${open.length - 3} more questions`}</summary><ul>{open.slice(3).map(question => <li key={question}>{question}</li>)}</ul></details> : null}</section> : null}
    </div>
    <div role="tabpanel" id={`${tabsId}-structure-panel`} aria-labelledby={`${tabsId}-structure`} hidden={view !== "structure"}><section className="overview-reading-route" aria-label={zh ? "阅读路线" : "Reading path"}>{route ?? <><h2>{zh ? "主要经过" : "Main progression"}</h2>
    <ol className="overview-route compact-route">{session.sections.map((section, index) => <li key={section.id}>
      <div className="overview-stage"><span className="overview-stage-number">{index + 1}</span><div><button type="button" onClick={() => onRead(section.id)}>{evidencePresentation(section.title)}</button><small>{section.kind === "proposal" ? zh ? "AI 建议" : "AI proposal" : section.kind === "open_question" ? zh ? "待确认" : "Open question" : session.completedSectionIds.includes(section.id) ? zh ? "已理解" : "Reviewed" : zh ? "待阅读" : "To read"}</small><p>{reviewLead(section.body)}</p></div></div>
      {index < session.sections.length - 1 ? <div className="overview-connection"><span aria-hidden="true">↓</span><p>{evidencePresentation(section.transition) || (zh ? "接下来讨论" : "Next in reading order")}</p></div> : null}
    </li>)}</ol></>}</section></div>
    <div role="tabpanel" id={`${tabsId}-discussion-panel`} aria-labelledby={`${tabsId}-discussion`} hidden={view !== "discussion"}>{orientation.stages.length ? <DiscussionEvolution heading={zh ? "讨论过程" : "Discussion history"} orientation={orientation} zh={zh} onRead={onRead} onLocate={onLocate} /> : <p className="muted">{zh ? "暂时没有关联讨论" : "No linked discussion yet"}</p>}</div>
    {showSourceNavigation ? <details className="overview-original-stages" open={showSources} onToggle={(event) => setShowSources(event.currentTarget.open)}><summary>{zh ? `来源对话 · ${session.sourceConversationIds.length}` : `Source conversations · ${session.sourceConversationIds.length}`}</summary>
      {showSources ? session.sourceConversationIds.map((id) => {
        const chapters = session.sourceOutlines?.find((item) => item.conversationId === id)?.chapters ?? [];
        return <section className="overview-conversation-flow" key={id}><h3><button type="button" disabled={!onOpenSource} onClick={() => onOpenSource?.(id)}>{conversations.find((item) => item.id === id)?.title ?? session.evidence.find((item) => item.conversationId === id)?.title ?? id}</button></h3>
          {chapters.length ? <ol>{chronologicalGroups(chapters, zh).map((group) => <li key={group.id}><strong>{group.title}</strong><small>{zh ? `${group.items.length} 个章节` : `${group.items.length} chapters`}</small><button type="button" disabled={!onOpenSource} onClick={() => onOpenSource?.(id)}>{zh ? "打开对话" : "Open conversation"}</button></li>)}</ol> : <button type="button" onClick={() => { const ref = session.evidence.find((item) => item.conversationId === id); if (ref) onLocate(ref); }}>{zh ? "回看原文" : "Read original"}</button>}
        </section>;
      }) : null}
    </details> : null}
  </section>;
}
