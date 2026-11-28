import { ArrowUpRight, Quote } from "lucide-react";
import { useMemo, useState } from "react";
import type { FocusEvidence, FocusSection, FocusSession } from "../../shared/focus-session";
import type { ProjectMaintenance } from "../../shared/project-state";
import { projectOverviewWorkspace } from "../project-overview-workspace";
import { wikiSections, localizedWikiTitle } from "../../shared/wiki-navigation";
import { EvidenceReviewButton } from "./EvidenceReviewButton";
import { ProjectOverviewIntro } from "./ProjectOverviewIntro";
import { ProjectConversationNotes } from "./ProjectConversationNotes";
import { DocumentOverviewDetails } from "./DocumentOverviewDetails";
import { WikiDisclosure } from "./ReaderSourceSupplement";
import { currentDecisions } from "../../shared/project-continuation";
import {wikiTitleReviewIncomplete} from "../../shared/wiki-title-review";
import { wikiProjectTitleSuggestion } from "../../shared/wiki-project-boundary";
import { useEvidencePoints } from "../use-evidence-points";
import { WikiClaimMarkerContext } from "../wiki-claim-marker-context";
import { documentEvidenceReview } from "../document-review";
import {useProjectReadingCache} from "../project-reading-cache";
import { projectOverviewPage, savedProjectOverviewPage, type ProjectWikiPages } from "../project-wiki-pages";
import type { WorkspaceEvidenceOptions } from "../workspace-evidence-context";
import "../document-overview.css";

type OverviewChapterCard = { summary?: string; decidedCount?: number; pendingReviewCount?: number };

const chapterFallbackSummary = (body: string): string => {
  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || /^(?:#|>|\||```|~~~|<details|<\/details|<summary|[-*+]\s|\d+\.\s|\*[^*\n]+\*$)/u.test(line)) continue;
    const clean = line
      .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
      .replace(/〔[^〕]*〕|\[(?:来源|Source)\s*\d*\]/gu, "")
      .replace(/\*\*([^*]+)\*\*/gu, "$1")
      .replace(/`([^`]+)`/gu, "$1")
      .replace(/\s+/gu, " ")
      .trim();
    if (clean.length < 10) continue;
    const first = clean.split(/(?<=[。！？.!?])\s*/u)[0] ?? clean;
    return first.length > 68 ? `${first.slice(0, 68).trimEnd()}…` : first;
  }
  return "";
};

/** Saved prose and its reading order; opening this view never schedules AI work. */
export function DocumentOverview({ session, reviewSession = session, zh, title, preview = false, onRead, onLocate, onMaintain, onRename, onReview, pageReading, onBeginEdit }: {
  session: FocusSession; zh: boolean; title?: string; preview?: boolean;
  reviewSession?:FocusSession;
  onRead: (id: string, heading?:string) => void; onLocate: (ref: FocusEvidence, options?: WorkspaceEvidenceOptions) => void;
  onMaintain?: (value: ProjectMaintenance) => Promise<void>;
  toolsHost?: HTMLElement | null;
  onBeginEdit?: () => void;
  onRename?:(name:string)=>void;
  /** Starts checking: evidence across the workspace, chapter by chapter ("issues" is kept for callers stepping through problems). */
  onReview?:(kind:"issues"|"evidence")=>void;
  pageReading?: Partial<ProjectWikiPages> | null;
}) {
  const readingCache=useProjectReadingCache();
  const suggestedTitle = wikiProjectTitleSuggestion(reviewSession, title);
  const pages = useMemo(() => wikiSections(session).filter(section => !section.continuationLoose), [session]);
  const personal = session.briefUserEdited || session.projectMaintenance?.overview !== undefined;
  const content = useMemo(() => pageReading === null && !personal ? undefined : (personal ? undefined : pageReading?.overview)
    ?? readingCache.get(session, `overview-page:${zh}:${preview}`, () => projectOverviewPage(session, zh, preview)),
  [pageReading,personal,readingCache,session,zh,preview]);
  const saved = useMemo(() => pageReading === null && !personal
    ? readingCache.get(session, "saved-overview", () => savedProjectOverviewPage(session)) : undefined,
  [pageReading,personal,readingCache,session]);
  const { overview, readingText = "", references = [], points = [] } = content ?? saved ?? {};
  const workspace = !preview && pageReading !== null ?
    pageReading?.workspace ?? readingCache.get(session, "overview-workspace:" + zh, () => projectOverviewWorkspace(session, zh)) : undefined;
  const notes = session.sections.filter(section => section.continuationLoose &&
    (!workspace || section.kind !== "open_question" && !currentDecisions(section).length));
  const [editTarget,setEditTarget]=useState<HTMLSpanElement|null>(null);
  // Evidence still to look at across the workspace; it feeds the one check button, not a row of counts.
  const review = useMemo(() => session.mode === "work" && !preview && onReview && content && pageReading !== null
    ? pageReading?.review ?? documentEvidenceReview(reviewSession, zh) : [], [session.mode, preview, onReview, content, pageReading, reviewSession, zh]);
  const reviewBySection = useMemo(() => new Map(review.map(item => [item.sectionId, item.count])), [review]);
  const chapterCards = (workspace as { chapterCards?: Record<string, OverviewChapterCard> } | undefined)?.chapterCards;
  const chapter = (page: FocusSection, index: number) => {
    const name = page.wikiDisplayTitle || localizedWikiTitle(page, zh);
    const question = page.wikiQuestion?.trim();
    const card = chapterCards?.[page.id];
    const summary = card?.summary?.trim() || chapterFallbackSummary(page.body);
    const decidedCount = card?.decidedCount ?? (page.claims?.filter(claim => claim.holder === "decided").length ?? 0);
    const pendingCount = card?.pendingReviewCount ?? reviewBySection.get(page.id) ?? 0;
    return <li key={page.id}><button type="button" title={question && question !== name ? question : undefined} onClick={() => onRead(page.id)}>
      <div className="overview-chapter-head">
        <span className="overview-chapter-index">{String(index + 1).padStart(2, "0")}</span>
        <strong className="overview-chapter-title">{name}</strong>
        <ArrowUpRight size={15} aria-hidden="true"/>
      </div>
      {summary ? <p className="overview-chapter-summary">{summary}</p> : null}
      {(decidedCount > 0 || pendingCount > 0) ? <div className="overview-chapter-meta">
        {decidedCount > 0 ? <span className="is-decided">{zh ? `已定 ${decidedCount}` : `${decidedCount} decided`}</span> : null}
        {pendingCount > 0 ? <span className="is-pending">{zh ? `待核对 ${pendingCount}` : `${pendingCount} to check`}</span> : null}
      </div> : null}
    </button></li>;
  };
  const unchecked = review.reduce((sum, item) => sum + item.count, 0);
  // The overview is checked point by point too: each sentence that reuses a cited
  // original gets a marker; without a match in its own sources, any project source may serve.
  const { rootRef, claimMarkers, ordered, open: openPoint, markerContext } = useEvidencePoints(points, onLocate, zh, readingText);
  const reviewLabel = unchecked ? zh ? "核对依据 · " + unchecked + " 条待确认" : "Check evidence · " + unchecked + " to confirm"
    : zh ? "核对依据 · " + ordered.length + " 处" : "Check evidence · " + ordered.length;
  const evidenceAction = unchecked || ordered.length ? <button type="button" className={`overview-header-action evidence-review-button${unchecked ? " has-attention" : ""}`}
    aria-label={reviewLabel} title={reviewLabel} onClick={() => unchecked ? onReview?.("evidence") : openPoint(ordered[0].key)}>
    <Quote size={14} aria-hidden="true"/>
    <span>{unchecked ? (zh ? `待核对 ${unchecked}` : `${unchecked} to review`) : (zh ? "核对依据" : "Check sources")}</span>
  </button> : overview && <EvidenceReviewButton sources={references} zh={zh} onLocate={onLocate} claim={overview.text} iconOnly/>;
  const headerActions = !preview && (evidenceAction || overview && onMaintain) ? <nav className="overview-header-actions" aria-label={zh ? "文档工具" : "Document tools"}>
    {evidenceAction}{onMaintain && <span ref={setEditTarget}/>}
  </nav> : null;
  return <WikiClaimMarkerContext.Provider value={markerContext}><article ref={rootRef} className="document-overview" aria-label={zh ? "文档总览" : "Document overview"}>
    {!preview ? <header className="document-overview-heading wiki-document-heading">
      <div className="wiki-document-location"><span>{zh ? "文档总览" : "Overview"}</span>{headerActions}</div>
      <h1>{title || session.title}</h1>
    </header> : null}
    {suggestedTitle?<p className="document-overview-title-notice">{zh?"项目名称建议：":"Suggested project name: "}{suggestedTitle}{onRename?<button type="button" onClick={()=>onRename(suggestedTitle)}>{zh?"检查名称":"Review name"}</button>:null}</p>:null}
    {wikiTitleReviewIncomplete(session.wikiTitleReview)?<p className="document-overview-title-notice" role="status">{zh?"部分标题未整理完成，已保留原名和正文；可在下次整理时重试。":"Some titles could not be refined. Original names and prose are preserved; you can retry during the next update."}</p>:null}
    {overview && <ProjectOverviewIntro session={session} text={overview.text} readingText={readingText} zh={zh} onMaintain={content ? onMaintain : undefined} editTarget={editTarget} onBeginEdit={onBeginEdit} claimMarkers={claimMarkers}/>}
    {!preview && pages.length > 0 && <section className="overview-block document-overview-chapters" aria-label={zh ? "一页速览" : "At a glance"}>
      <h2>{zh ? "一页速览" : "At a glance"}<small>{zh ? `${pages.length} 章` : `${pages.length} chapters`}</small></h2>
      <ul>{pages.map(chapter)}</ul>
    </section>}
    {workspace && <DocumentOverviewDetails session={session} data={workspace} zh={zh} onRead={onRead} onLocate={onLocate}/>}
    {!preview && notes.length > 0 && <WikiDisclosure className="overview-disclosure" label={<>{zh ? "项目记录" : "Project notes"}<small>{notes.length}</small></>}>
      <ProjectConversationNotes notes={notes} evidence={session.evidence} zh={zh} onRead={onRead}
        onSource={(ref, section) => onLocate(ref, { sectionId: section.id, quote: ref.excerpt, references: session.evidence.filter(item => section.evidenceIds.includes(item.id)) })}/>
    </WikiDisclosure>}
  </article></WikiClaimMarkerContext.Provider>;
}
