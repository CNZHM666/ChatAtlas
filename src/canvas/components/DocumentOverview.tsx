import { ArrowUpRight, BookOpen, FileText, Quote } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { FocusEvidence, FocusSection, FocusSession } from "../../shared/focus-session";
import type { ProjectMaintenance } from "../../shared/project-state";
import { wikiSections, localizedWikiTitle } from "../../shared/wiki-navigation";
import { projectOverviewContent } from "../project-overview";
import { EvidenceReviewButton } from "./EvidenceReviewButton";
import { ProjectOverviewIntro } from "./ProjectOverviewIntro";
import {wikiTitleReviewIncomplete} from "../../shared/wiki-title-review";
import { projectOverviewReadingText } from "../../shared/project-overview";
import { approximatePoints } from "../wiki-evidence";
import { useEvidencePoints } from "../use-evidence-points";
import { WikiClaimMarkerContext } from "../wiki-claim-marker-context";
import { documentReview } from "../document-review";
import "../document-overview.css";

/** Saved prose and its reading order; opening this view never schedules AI work. */
export function DocumentOverview({ session, zh, title, preview = false, onRead, onLocate, onSources, onMaintain, onRename, scope, onReview }: {
  session: FocusSession; zh: boolean; title?: string; preview?: boolean;
  onRead: (id: string) => void; onLocate: (ref: FocusEvidence) => void;
  onSources?: () => void; onMaintain?: (value: ProjectMaintenance) => Promise<void>;
  onRename?:(name:string)=>void;
  /** Starts checking: evidence across the workspace, chapter by chapter ("issues" is kept for callers stepping through problems). */
  onReview?:(kind:"issues"|"evidence")=>void;
  /** Scope review has its own full-width row below the document facts. */
  scope?:ReactNode;
}) {
  // One numbered list: part labels are AI groupings that add reading load here.
  const pages = wikiSections(session), overview = projectOverviewContent(session);
  const [editTarget,setEditTarget]=useState<HTMLSpanElement|null>(null);
  // A chapter row is its title: the overview above already says what each chapter covers.
  const chapter = (page: FocusSection) => <li key={page.id}><button type="button" onClick={() => onRead(page.id)}>
    <span className="document-chapter-number">{String(pages.indexOf(page) + 1).padStart(2, "0")}</span><span><strong>{page.wikiDisplayTitle || localizedWikiTitle(page, zh)}</strong></span><ArrowUpRight size={17} aria-hidden="true"/>
  </button></li>;
  const references = session.evidence.filter(ref => overview.evidenceIds.includes(ref.id));
  // Evidence still to look at across the workspace; it feeds the one check button, not a row of counts.
  const review = useMemo(() => session.mode === "work" && !preview && onReview ? documentReview(session, zh) : undefined, [session, preview, zh, onReview]);
  const unchecked = review?.unchecked.reduce((sum, item) => sum + item.count, 0) ?? 0;
  // The overview is checked point by point too: each sentence that reuses a cited
  // original gets a marker; without a match in its own sources, any project source may serve.
  const personal = Boolean(session.briefUserEdited || session.projectMaintenance?.overview !== undefined);
  const readingText = projectOverviewReadingText(session, overview);
  const points = useMemo(() => {
    if (personal || preview) return [];
    const own = approximatePoints("overview", session.evidence.filter(ref => overview.evidenceIds.includes(ref.id)), readingText, zh, 12);
    return own.length ? own : approximatePoints("overview", session.evidence, readingText, zh, 12);
  }, [personal, preview, session.evidence, overview.evidenceIds, readingText, zh]);
  const { rootRef, claimMarkers, ordered, open: openPoint, markerContext } = useEvidencePoints(points, onLocate, zh, readingText);
  return <WikiClaimMarkerContext.Provider value={markerContext}><article ref={rootRef} className="document-overview" aria-label={zh ? "文档总览" : "Document overview"}>
    {!preview ? <header className="document-overview-heading">
      {/* Title, then ONE line of facts, status and scope; actions sit beside the title. */}
      {/* One check button, as in a chapter: with points to look at anywhere in the workspace it walks through all of
          them, chapter by chapter; otherwise it opens the overview's own sentences. */}
      <div className="document-overview-title-row"><h1>{title || session.title}</h1><div className="document-overview-actions">{unchecked ? <button type="button" className="evidence-review-button has-attention" title={zh ? "逐条核对整个工作区需要确认的地方，看完一章自动进入下一章" : "Check every point that needs a look across the workspace, chapter by chapter"} onClick={() => onReview!("evidence")}><Quote size={15} aria-hidden="true"/>{zh ? `核对依据 · ${unchecked} 条待看` : `Check evidence · ${unchecked} to look at`}</button> : ordered.length ? <button type="button" className="evidence-review-button" title={zh ? "逐条核对总览中的说法与原话" : "Check each overview statement against its original"} onClick={() => openPoint(ordered[0].key)}><Quote size={15} aria-hidden="true"/>{zh ? `核对依据 · ${ordered.length} 处` : `Check evidence · ${ordered.length}`}</button> : <EvidenceReviewButton sources={references} zh={zh} onLocate={onLocate} claim={overview.text} iconOnly/>}<span ref={setEditTarget}/></div></div>
    </header> : null}
    {!preview?scope:null}
    {session.wikiSuggestedTitle&&session.wikiSuggestedTitle!==(title||session.title)?<p className="document-overview-title-notice">{zh?"项目名称建议：":"Suggested project name: "}{session.wikiSuggestedTitle}{onRename?<button type="button" onClick={()=>onRename(session.wikiSuggestedTitle!)}>{zh?"检查名称":"Review name"}</button>:null}</p>:null}
    {wikiTitleReviewIncomplete(session.wikiTitleReview)?<p className="document-overview-title-notice" role="status">{zh?"部分标题未整理完成，已保留原名和正文；可在下次整理时重试。":"Some titles could not be refined. Original names and prose are preserved; you can retry during the next update."}</p>:null}
    <ProjectOverviewIntro session={session} zh={zh} preview={preview} onMaintain={onMaintain} editTarget={editTarget} claimMarkers={claimMarkers}/>
    {!preview ? <section className="document-overview-chapters"><h2><BookOpen size={18} aria-hidden="true"/>{zh ? "章节" : "Chapters"}</h2>
      <ol>{pages.map(chapter)}</ol>
    </section> : null}
    {!preview && onSources ? <button type="button" className="document-overview-sources" onClick={onSources}><FileText size={17} aria-hidden="true"/>{zh ? "查看来源对话" : "View source conversations"}<ArrowUpRight size={15} aria-hidden="true"/></button> : null}
  </article></WikiClaimMarkerContext.Provider>;
}
