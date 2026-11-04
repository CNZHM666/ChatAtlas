import {projectKnowledgeReading} from "../../shared/project-knowledge-view";
import { WorkspaceEvidenceContext, needsConfirmation } from "../workspace-evidence-context";
import { EvidenceReviewButton } from "./EvidenceReviewButton";
import { localizedWikiTitle, wikiReadingLocation } from "../../shared/wiki-navigation";
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { FocusEvidence, FocusSection, FocusSession } from "../../shared/focus-session";
import { wikiDocument } from "../wiki-document";
import { hasChapterDiagram, suggestedDiagramHeading, wikiDiagramParts } from "../wiki-diagram";
import { ReaderGuide } from "./ReaderGuide";
import { WikiEvidence } from "./WikiEvidence";
import { ProjectChangeHistory } from "./ProjectChangeHistory";
import { WikiKnowledgeLinks } from "./WikiKnowledgeLinks";
import { WorkspaceDisclosureTitle } from "./WorkspaceDisclosureTitle";
import { RecordDetailDrawer } from "./RecordDetailDrawer";
import { WikiDiagram } from "./WikiDiagram";
import { WikiSources } from "./WikiSources";
import { WikiSectionLocator } from "./WikiSectionLocator";
import {stanceKey,wikiChapterNotice,wikiUnbackedStances} from "../../shared/wiki-chapter-status";
import {ProjectKnowledgeActions} from "../project-knowledge-actions";
import {jumpToSentence} from "../stance-jump";
import {wikiTitleReviewIncomplete} from "../../shared/wiki-title-review";
import {WikiChapterOverview} from "./WikiChapterOverview";
import { ChevronLeft, ChevronRight, Quote, Tags, X } from "lucide-react";
import { issueBlockText, issueLabel } from "../document-review";
import { meaningTerms, paintHolderRuns } from "../claim-highlight";
import type { WikiBlockIssue } from "../../shared/wiki-explanations";
import { useHolderMarks } from "../use-holder-marks";
import { wikiApproximatePoints, wikiEvidencePoints, wikiHistoryPoints } from "../wiki-evidence";
import { wikiHistoryEntries } from "../../shared/wiki-history";
import { WikiHistoryCard } from "./WikiHistoryCard";
import { WikiClaimMarkerContext } from "../wiki-claim-marker-context";
import { useEvidencePoints } from "../use-evidence-points";

export function WikiDocument({ section, session, zh, structure, editor, onLocate, onCurrent, onFinishEdit, onEdit, updatedConversationIds,headingTarget,scrollRef,issue,onIssueStep,onIssueClose,autoReview }: {
  section: FocusSection; session: FocusSession; zh: boolean; structure: ReactNode; editor?: ReactNode;
  /** A pending problem in this chapter the overview sent the reader to: its paragraph is marked and named. */
  issue?: { issue: WikiBlockIssue; index: number; total: number }; onIssueStep?: (delta: number) => void; onIssueClose?: () => void;
  /** Sent from the overview to check evidence: the review opens on its own, once per value. */
  autoReview?: number;
  onLocate: (ref: FocusEvidence) => void; onCurrent: () => void;
  onFinishEdit?: () => void; onEdit?: () => void; updatedConversationIds?: string[];
  headingTarget?:{title:string;revision:number};
  scrollRef?:RefObject<HTMLElement|null>;
}) {
  const evidencePanel=useContext(WorkspaceEvidenceContext);
  const review=session.mode==="review",[updatesOpen,setUpdatesOpen]=useState(false);
  const sourceIds=new Set([...section.evidenceIds,...(section.claims??[]).flatMap(claim=>claim.evidenceIds)]);
  const sources=session.evidence.filter(ref=>sourceIds.has(ref.id));
  const location=review?section.origin==="user"?zh?"我的理解":"My understanding":section.kind==="proposal"?zh?"AI 建议":"AI proposal":section.kind==="open_question"?zh?"待确认":"Open question":zh?"复习章节":"Review chapter":wikiReadingLocation(section,zh);
  const page=useMemo(()=>wikiDocument(projectKnowledgeReading(section,session).body,!section.userEdited&&!section.origin,session.evidence.filter(ref=>section.evidenceIds.includes(ref.id)).map(ref=>ref.excerpt),section.claims?.flatMap(claim=>[claim.text,...claim.formulations??[]])),[section,session]),content=useRef<HTMLDivElement>(null);
  // Point-by-point evidence: each claim found in the prose gets a marker; the panel
  // steps through markers in reading order, then through claims with no position.
  const generated=!section.userEdited&&!section.origin;
  // Evolution: structured Product Evolution records first, then real "历史：" notes.
  const history=useMemo(()=>generated?wikiHistoryEntries(session,section):[],[generated,session,section]);
  const historyPoints=useMemo(()=>wikiHistoryPoints(section,history,session.evidence,zh),[section,history,session.evidence,zh]);
  const points=useMemo(()=>{
   if(!generated||editor)return [];
   // One point per sentence and holder: a chapter saved with two claims on one sentence showed two 已定 marks after it.
   const seen=new Set<string>(),claims=wikiEvidencePoints(section,session.evidence,zh).filter(point=>{const key=`${point.claim}\u0000${point.holder??""}`;if(seen.has(key))return false;seen.add(key);return true;});
   // Chapters saved without claim records still get points, matched locally and labelled as approximate.
   const prose=claims.length?claims:wikiApproximatePoints(section,session.evidence,projectKnowledgeReading(section,session).body,zh);
   return [...prose,...historyPoints.points];
  },[generated,editor,section,session,zh,historyPoints]);
  const {rootRef:articleRef,claimMarkers,ordered,open:openPoint,markerContext}=useEvidencePoints(points,onLocate,zh,[page,editor,section.wikiDiagram]);
  // Source marks (你, 资料) and the colour each mark tints its text with stay out of the prose until the reader turns
  // them on, checking included: the check highlights only the sentence it is on. 已定, 未定 and 此前 always show.
  const [holderMarks,setHolderMarks]=useHolderMarks(),hasHolders=useMemo(()=>ordered.some(point=>point.holder),[ordered]),marksHidden=hasHolders&&!holderMarks;
  // Shown holders tint the text each mark covers in the mark's colour; hidden, nothing is painted.
  useEffect(()=>{const root=articleRef.current;const timer=window.setTimeout(()=>paintHolderRuns(root,hasHolders&&!marksHidden),0);return()=>{window.clearTimeout(timer);paintHolderRuns(root,false);};},[articleRef,hasHolders,marksHidden,page,ordered]);
  // Points whose quote is in the original pass on their own; the review steps only through those that need a look.
  const attention=useMemo(()=>ordered.filter(needsConfirmation),[ordered]);
  const reviewEvidence=()=>{
    const first=attention[0];
    if(!first){if(ordered[0])openPoint(ordered[0].key);return;}
    if(evidencePanel)evidencePanel.open(first.reference,{references:first.references,quote:first.quote,claim:first.claim,points:attention,pointIndex:0});else onLocate(first.reference);
  };
  // Sent here to check evidence: the review opens once the chapter's points are known.
  const reviewed=useRef<number>();
  useEffect(()=>{if(!autoReview||reviewed.current===autoReview||!ordered.length)return;reviewed.current=autoReview;reviewEvidence();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when sent here, not on every point change.
  },[autoReview,ordered.length]);
  // A pending problem: its paragraph is found in the rendered chapter, scrolled to and marked.
  const issueText=issue?issueBlockText(session,issue.issue):undefined;
  useEffect(()=>{
    if(!issueText)return;
    let target:HTMLElement|undefined,frame=0;
    // The paragraph whose words are closest to the problem's, read whole: a shared opening ("建议……") or a
    // marker inside it no longer sends the reader to the wrong one. Tried again once the chapter has rendered.
    const find=()=>{
      const root=articleRef.current;if(!root)return false;
      const wanted=meaningTerms(issueText);if(wanted.size<3)return false;
      let best:{element:HTMLElement;score:number}|undefined;
      for(const element of root.querySelectorAll<HTMLElement>("p, li")){
        if(element.closest(".wiki-issue-bar, button, summary")||element.querySelector("p, li"))continue;
        const own=meaningTerms(element.textContent??"");let shared=0;for(const term of own)if(wanted.has(term))shared++;
        const score=shared/Math.max(1,Math.min(own.size,wanted.size));
        if(score>=.5&&(!best||score>best.score))best={element,score};
      }
      if(!best)return false;
      target=best.element;target.setAttribute("data-issue-active","true");target.scrollIntoView?.({block:"center",behavior:"smooth"});return true;
    };
    const timer=window.setTimeout(()=>{if(!find())frame=requestAnimationFrame(()=>void find());},80);
    return()=>{window.clearTimeout(timer);cancelAnimationFrame(frame);target?.removeAttribute("data-issue-active");};
  },[issueText,articleRef,page]);
  const changes=session.projectChanges?.filter(change=>change.affectedSectionIds.includes(section.id))??[];
  const reviewSources=review&&!section.claims?.length?session.evidence.filter(ref=>section.evidenceIds.includes(ref.id)):[];
  useEffect(()=>{
    if(!headingTarget||editor)return;
    const target=[...content.current?.querySelectorAll<HTMLElement>(".chapter-guide h2")??[]].find(node=>node.textContent?.trim()===headingTarget.title);
    if(target){target.scrollIntoView?.({block:"start",behavior:"auto"});target.tabIndex=-1;target.focus({preventScroll:true});}
  },[headingTarget,editor,page.body]);
  // Wiki reads prose directly. Only an already saved, current, visible diagram
  // belongs here; topic keywords must not inject a generation suggestion card.
  const hasDiagram=!review&&hasChapterDiagram(section,session)&&!section.wikiDiagram?.hidden;
  const chapterStatus=wikiChapterNotice(section,zh);
  // The notice about the user's stance takes the reader to each such sentence in turn, to confirm or edit it.
  const stances=useMemo(()=>review||editor?[]:wikiUnbackedStances(section),[review,editor,section]);
  const [stanceAt,setStanceAt]=useState(0);
  useEffect(()=>setStanceAt(0),[section.id]);
  // The jump runs after the render the click causes, so the re-rendered prose keeps its highlight.
  const [stanceJump,setStanceJump]=useState<{sentence:string;count:number}>();
  // The opening paragraphs render in the chapter overview above the body, so the whole article is searched.
  useEffect(()=>{if(stanceJump)jumpToSentence(articleRef.current,stanceJump.sentence);},[stanceJump,articleRef]);
  // After a jump, the reader decides: these are my words (kept, no longer flagged), rewrite it, or go to the next one.
  const knowledgeActions=useContext(ProjectKnowledgeActions);
  const [stanceSaving,setStanceSaving]=useState(false);
  const keepStance=async()=>{
   if(!stanceJump||!knowledgeActions||stanceSaving)return;
   const key=stanceKey(stanceJump.sentence);setStanceSaving(true);
   try{await knowledgeActions.save(current=>({...current,sections:current.sections.map(item=>item.id===section.id?{...item,wikiStancesKept:[...new Set([...item.wikiStancesKept??[],key])]}:item)}));setStanceJump(undefined);setStanceAt(0);}
   catch{/* The notice stays; the reader can try again. */}
   finally{setStanceSaving(false);}
  };
  const jumpToStance=()=>{if(!stances.length)return;const at=stanceAt%stances.length;setStanceJump(current=>({sentence:stances[at],count:(current?.count??0)+1}));setStanceAt(at+1);};
  const readingBody=!review?page.overview?.readingBody??page.body:page.body;
  const parts=wikiDiagramParts(readingBody,section.wikiDiagram?.afterHeading??suggestedDiagramHeading(section));
  const read=(body:string)=>body.trim()?<div className="chapter-guide"><ReaderGuide hideCitationAnnotations collapseCode={!review&&!section.userEdited&&section.origin!=="user"&&!/架构|技术|接口|代码|实现|architecture|technical|implementation/iu.test(`${section.wikiGroup??""} ${section.title}`)} content={body} sourceTexts={session.evidence.filter(ref=>section.evidenceIds.includes(ref.id)).map(ref=>ref.excerpt)} zh={zh} complete hideEvidenceMarkers={!section.userEdited&&section.origin!=="user"} claimMarkers={claimMarkers}/></div>:null;
  return <WorkspaceEvidenceContext.Provider value={evidencePanel?{...evidencePanel,open:(ref,options)=>evidencePanel.open(ref,options?.points?options:{...options,sectionId:section.id,references:sources})}:undefined}><WikiClaimMarkerContext.Provider value={markerContext}><article ref={articleRef} className={`wiki-document${marksHidden?" hides-holder-marks":""}`} aria-label={review?zh?"复习文档":"Review document":zh?"Wiki 文档":"Wiki document"}>
    <header className="wiki-document-heading"><div className="wiki-document-location"><span>{location}</span><div>{!editor?ordered.length?<button type="button" className={`evidence-review-button${attention.length?" has-attention":""}`} title={attention.length?zh?"原话已自动对照原文；只带你看需要确认的几处":"Quotes were checked against the originals; only the points that need a look are shown":zh?"引文已在原文中找到；不代表结论准确、方案已采纳或实现已验证。点开逐条核对":"Quoted passages were located; this does not verify meaning, adoption or implementation. Open to review."} onClick={reviewEvidence}><Quote size={15} aria-hidden="true"/>{attention.length?zh?`核对依据 · ${attention.length} 条待看`:`Check evidence · ${attention.length} to review`:zh?"原文已定位":"Originals located"}</button>:<EvidenceReviewButton sources={sources} zh={zh} onLocate={onLocate} historical={Boolean(section.userEdited||section.origin)}/>:null}{!editor&&hasHolders?<button type="button" className="holder-marks-toggle" aria-pressed={holderMarks} title={zh?"标出哪些话是你说的、哪些来自你提供的资料，并给各自的句子上色；已定、未定和此前总会标出":"Mark what you said and what came from material you provided, and tint those sentences; decided, open and earlier points are always marked"} onClick={()=>setHolderMarks(!holderMarks)}><Tags size={15} aria-hidden="true"/>{holderMarks?zh?"收起出处":"Hide sources":zh?"显示出处":"Show sources"}</button>:null}{editor&&onFinishEdit?<button type="button" onClick={onFinishEdit}>{zh?"保存并结束编辑":"Save and finish editing"}</button>:!editor&&onEdit?<button type="button" onClick={onEdit}>{zh?"编辑":"Edit"}</button>:null}{!editor&&changes.length?<button type="button" onClick={onCurrent}>{zh?"当前方案":"Current plan"}</button>:null}{!review&&!editor&&(changes.length||session.wikiSuggestions?.[section.id])?<button type="button" onClick={()=>setUpdatesOpen(true)}>{zh?"相关更新":"Related updates"}</button>:null}</div></div><h1 title={section.title}>{localizedWikiTitle(section,zh)}</h1>{section.userEdited?<small className="muted">{zh?"个人编辑内容":"Your edited content"}</small>:null}</header>
    {!editor&&wikiTitleReviewIncomplete(section.wikiTitleReview)?<p className="muted" role="status">{zh?"标题未整理完成，已保留原名和正文。":"Title editing could not finish. The original name and prose are preserved."}</p>:null}
    {!review&&!editor&&chapterStatus?<p className="wiki-chapter-status muted">{stances.length?<button type="button" className="wiki-stance-jump" title={zh?"跳到正文中的这句话":"Go to the sentence in the text"} onClick={jumpToStance}>{chapterStatus}{stances.length>1?` · ${zh?"查看":"show"} ${stanceAt%stances.length+1}/${stances.length}`:""}</button>:chapterStatus}</p>:null}
    {!review&&!editor&&stanceJump&&stances.length?<div className="wiki-stance-actions" role="group" aria-label={zh?"处理这句表态":"Resolve this stance"}><span>{zh?"高亮的表述符合你的意思吗？保留文字不会将建议记录为已采纳。":"Does the wording match your meaning? Keeping text does not record adoption."}</span>{knowledgeActions?<button type="button" className="primary" disabled={stanceSaving} onClick={()=>void keepStance()}>{zh?"表述符合我的意思":"The wording matches my meaning"}</button>:null}{onEdit?<button type="button" onClick={onEdit}>{zh?"改写这句":"Rewrite it"}</button>:null}{stances.length>1?<button type="button" onClick={jumpToStance}>{zh?"下一处":"Next"}</button>:null}<button type="button" className="wiki-stance-dismiss" aria-label={zh?"收起":"Dismiss"} onClick={()=>setStanceJump(undefined)}>×</button></div>:null}
    {issue?<div className="wiki-issue-bar" role="status"><span>{zh?`待处理 ${issue.index+1}/${issue.total}`:`To review ${issue.index+1}/${issue.total}`}</span><strong>{issueLabel(issue.issue,zh)}</strong>
      <span className="wiki-issue-actions"><button type="button" aria-label={zh?"上一处":"Previous"} disabled={!issue.index} onClick={()=>onIssueStep?.(-1)}><ChevronLeft size={15} aria-hidden="true"/></button><button type="button" aria-label={zh?"下一处":"Next"} disabled={issue.index>=issue.total-1} onClick={()=>onIssueStep?.(1)}><ChevronRight size={15} aria-hidden="true"/></button>
        {onEdit?<button type="button" onClick={onEdit}>{zh?"编辑本章":"Edit chapter"}</button>:null}<button type="button" aria-label={zh?"关闭":"Close"} onClick={onIssueClose}><X size={15} aria-hidden="true"/></button></span></div>:null}
    {!review&&!editor?<WikiChapterOverview overview={page.overview} zh={zh} emphasize={!section.userEdited&&section.origin!=="user"} claimMarkers={claimMarkers}/>:null}
    {!editor?<WikiSectionLocator headings={page.headings} contentRef={content} scrollRef={scrollRef} zh={zh}/>:null}
    {section.reviewIssue?<p className="wiki-review-warning" role="status">{zh?"本章为待核验草稿。":"This chapter is a draft awaiting review."}</p>:null}
    {review?<div className="wiki-document-structure">{structure}</div>:null}
    <div ref={content}>{editor??(hasDiagram?<>{read(parts[0])}<WikiDiagram session={session} section={section} zh={zh} onLocate={onLocate}/>{read(parts[1])}</>:read(readingBody))}</div>
    {!editor?<WikiHistoryCard entries={history} markers={historyPoints.markers} zh={zh}/>:null}
    {editor&&!review?<WikiKnowledgeLinks editing session={session} section={section} zh={zh}/>:null}
    {!editor?review?<><WikiEvidence section={section} evidence={session.evidence} session={session} sourceRoles={session.sourceRoles} updatedConversationIds={updatedConversationIds} zh={zh} onLocate={onLocate}/><ProjectChangeHistory changes={changes} zh={zh} onLocate={onLocate}/></>:<><WikiKnowledgeLinks session={session} section={section} zh={zh}/><WikiSources section={section} session={session} zh={zh} onLocate={onLocate}/></>:null}
    {!editor&&reviewSources.length?<details className="wiki-evidence review-original-evidence"><WorkspaceDisclosureTitle label={zh?"原始讨论":"Original discussions"} count={reviewSources.length}/><ul>{reviewSources.map(ref=><li key={ref.id}><button type="button" onClick={()=>onLocate(ref)}><strong>{ref.title}</strong><span>{ref.excerpt}</span><small>{zh?"阅读原文":"Read original"}</small></button></li>)}</ul></details>:null}
    {!editor&&review&&session.wikiSuggestions?.[section.id]?<details className="wiki-update-suggestion"><WorkspaceDisclosureTitle label={zh?"相关讨论更新":"Updated discussions"}/><ReaderGuide content={session.wikiSuggestions[section.id].body} zh={zh} complete hideEvidenceMarkers/><WikiEvidence section={session.wikiSuggestions[section.id]} evidence={session.evidence} zh={zh} onLocate={onLocate}/></details>:null}
    {updatesOpen?<RecordDetailDrawer session={session} title={section.title} label={zh?"变更与相关讨论":"Changes and related discussions"} zh={zh} onClose={()=>setUpdatesOpen(false)}><ProjectChangeHistory changes={changes} preview zh={zh} onLocate={ref=>{setUpdatesOpen(false);onLocate(ref);}}/>{session.wikiSuggestions?.[section.id]?<><h3>{zh?"待采用更新":"Proposed update"}</h3><ReaderGuide content={session.wikiSuggestions[section.id].body} zh={zh} complete hideEvidenceMarkers/><WikiEvidence section={session.wikiSuggestions[section.id]} evidence={session.evidence} zh={zh} onLocate={ref=>{setUpdatesOpen(false);onLocate(ref);}}/></>:null}</RecordDetailDrawer>:null}
  </article></WikiClaimMarkerContext.Provider></WorkspaceEvidenceContext.Provider>;
}
