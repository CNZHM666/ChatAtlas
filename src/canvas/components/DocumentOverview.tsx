import { ArrowUpRight, Quote } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { FocusEvidence, FocusSection, FocusSession } from "../../shared/focus-session";
import type { ProjectMaintenance } from "../../shared/project-state";
import { projectOverviewWorkspace } from "../project-overview-workspace";
import { wikiSections, localizedWikiTitle } from "../../shared/wiki-navigation";
import { EvidenceReviewButton } from "./EvidenceReviewButton";
import { ProjectOverviewIntro } from "./ProjectOverviewIntro";
import { DocumentOverviewDetails } from "./DocumentOverviewDetails";
import { LearningStanding } from "./LearningStanding";
import {wikiTitleReviewIncomplete} from "../../shared/wiki-title-review";
import { wikiProjectTitleSuggestion } from "../../shared/wiki-project-boundary";
import { useEvidencePoints } from "../use-evidence-points";
import { WikiClaimMarkerContext } from "../wiki-claim-marker-context";
import { documentEvidenceReview } from "../document-review";
import {useProjectReadingCache} from "../project-reading-cache";
import { projectOverviewPage, savedProjectOverviewPage, type ProjectWikiPages } from "../project-wiki-pages";
import type { WorkspaceEvidenceOptions } from "../workspace-evidence-context";
import "../document-overview.css";

/** Saved prose and its reading order; opening this view never schedules AI work. */
export function DocumentOverview({ session, reviewSession = session, zh, title, preview = false, onRead, onLocate, onMaintain, onRename, scope, onReview, pageReading, toolsHost, onBeginEdit }: {
  session: FocusSession; zh: boolean; title?: string; preview?: boolean;
  reviewSession?:FocusSession;
  onRead: (id: string, heading?:string) => void; onLocate: (ref: FocusEvidence, options?: WorkspaceEvidenceOptions) => void;
  onMaintain?: (value: ProjectMaintenance) => Promise<void>;
  toolsHost?: HTMLElement | null;
  onBeginEdit?: () => void;
  onRename?:(name:string)=>void;
  /** Starts checking: evidence across the workspace, chapter by chapter ("issues" is kept for callers stepping through problems). */
  onReview?:(kind:"issues"|"evidence")=>void;
  /** Scope review has its own full-width row below the document facts. */
  scope?:ReactNode;
  pageReading?: Partial<ProjectWikiPages> | null;
}) {
  const readingCache=useProjectReadingCache();
  const suggestedTitle = wikiProjectTitleSuggestion(reviewSession, title);
  const pages = useMemo(() => wikiSections(session), [session]);
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
  const [editTarget,setEditTarget]=useState<HTMLSpanElement|null>(null);
  const chapter = (page: FocusSection) => {
    const name = page.wikiDisplayTitle || localizedWikiTitle(page, zh);
    const question = page.wikiQuestion?.trim();
    return <li key={page.id}><button type="button" title={question && question !== name ? question : undefined} onClick={() => onRead(page.id)}>
      <span>{name}</span>
      <ArrowUpRight size={16} aria-hidden="true"/>
    </button></li>;
  };
  // Evidence still to look at across the workspace; it feeds the one check button, not a row of counts.
  const review = session.mode === "work" && !preview && onReview && content && pageReading !== null
    ? pageReading?.review ?? documentEvidenceReview(reviewSession,zh) : [];
  const unchecked = review.reduce((sum, item) => sum + item.count, 0);
  // The overview is checked point by point too: each sentence that reuses a cited
  // original gets a marker; without a match in its own sources, any project source may serve.
  const { rootRef, claimMarkers, ordered, open: openPoint, markerContext } = useEvidencePoints(points, onLocate, zh, readingText);
  const reviewLabel = unchecked ? zh ? "核对依据 · " + unchecked + " 条待确认" : "Check evidence · " + unchecked + " to confirm"
    : zh ? "核对依据 · " + ordered.length + " 处" : "Check evidence · " + ordered.length;
  const evidenceAction = unchecked || ordered.length ? <button type="button" className={`wiki-tool evidence-review-button${unchecked ? " has-attention" : ""}`}
    aria-label={reviewLabel} title={reviewLabel} onClick={() => unchecked ? onReview?.("evidence") : openPoint(ordered[0].key)}>
    <Quote size={17} aria-hidden="true"/>{unchecked > 0 && <span className="wiki-tool-badge" aria-hidden="true">{unchecked}</span>}
  </button> : overview && <EvidenceReviewButton sources={references} zh={zh} onLocate={onLocate} claim={overview.text} iconOnly/>;
  const tools = !preview && (evidenceAction || overview && onMaintain) ? <nav className="wiki-tool-rail overview-tool-rail" aria-label={zh ? "文档工具" : "Document tools"}>
    {evidenceAction}{onMaintain && <span ref={setEditTarget}/>}
  </nav> : null;
  return <WikiClaimMarkerContext.Provider value={markerContext}><article ref={rootRef} className="document-overview" aria-label={zh ? "文档总览" : "Document overview"}>
    {toolsHost && tools ? createPortal(tools, toolsHost) : tools}
    {!preview ? <header className="document-overview-heading wiki-document-heading">
      <div className="wiki-document-location"><span>{zh ? "文档总览" : "Overview"}</span></div>
      <h1>{title || session.title}</h1>
    </header> : null}
    {!preview?scope:null}
    {suggestedTitle?<p className="document-overview-title-notice">{zh?"项目名称建议：":"Suggested project name: "}{suggestedTitle}{onRename?<button type="button" onClick={()=>onRename(suggestedTitle)}>{zh?"检查名称":"Review name"}</button>:null}</p>:null}
    {wikiTitleReviewIncomplete(session.wikiTitleReview)?<p className="document-overview-title-notice" role="status">{zh?"部分标题未整理完成，已保留原名和正文；可在下次整理时重试。":"Some titles could not be refined. Original names and prose are preserved; you can retry during the next update."}</p>:null}
    {overview && <ProjectOverviewIntro session={session} text={overview.text} readingText={readingText} zh={zh} onMaintain={content ? onMaintain : undefined} editTarget={editTarget} onBeginEdit={onBeginEdit} claimMarkers={claimMarkers}/>}
    {content && <LearningStanding session={session} zh={zh}/>}
    {!preview && pages.length > 0 && <section className="overview-block document-overview-chapters" aria-label={zh ? "一页速览" : "At a glance"}>
      <h2>{zh ? "一页速览" : "At a glance"}</h2>
      <ul>{pages.map(chapter)}</ul>
    </section>}
    {overview && workspace && <DocumentOverviewDetails session={session} data={workspace} zh={zh} onRead={onRead} onLocate={onLocate}/>}
  </article></WikiClaimMarkerContext.Provider>;
}
