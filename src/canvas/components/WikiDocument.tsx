import {projectKnowledgeReading,projectKnowledgeReadingContext} from "../../shared/project-knowledge-view";
import {useProjectReadingCache} from "../project-reading-cache";
import { WorkspaceEvidenceContext, needsConfirmation, type WorkspaceEvidenceOptions } from "../workspace-evidence-context";
import { EvidenceReviewButton } from "./EvidenceReviewButton";
import { localizedWikiTitle, wikiReadingLocation } from "../../shared/wiki-navigation";
import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { FocusEvidence, FocusSection, FocusSession } from "../../shared/focus-session";
import { wikiChapterPage } from "../wiki-document";
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
import {wikiTitleReviewIncomplete} from "../../shared/wiki-title-review";
import {WikiChapterOverview} from "./WikiChapterOverview";
import { ChevronLeft, ChevronRight, History, Layers, PencilLine, Quote, Tags, X } from "lucide-react";
import { issueBlockText, issueLabel } from "../document-review";
import { meaningTerms, paintHolderRuns } from "../claim-highlight";
import type { WikiBlockIssue } from "../../shared/wiki-explanations";
import { useHolderMarks } from "../use-holder-marks";
import { wikiApproximatePoints, wikiChapterEvidencePoints, wikiHistoryPoints } from "../wiki-evidence";
import { wikiHistoryEntries } from "../../shared/wiki-history";
import { WikiHistoryCard } from "./WikiHistoryCard";
import { WikiClaimMarkerContext } from "../wiki-claim-marker-context";
import { useEvidencePoints } from "../use-evidence-points";
import { wikiHolderReadingLabel, wikiHolderTitle, type WikiHolder } from "../../shared/wiki-holder";
import type { WikiReadingProjection } from "../wiki-reading-worker";
import { createPortal } from "react-dom";
import { WIKI_EVIDENCE_LINK, availableWikiEvidence, currentWikiEvidence, wikiEvidenceTarget } from "../../shared/wiki-evidence-link";
import { wikiFlowSourceQuote } from "../../shared/wiki-flow-block";
import { wikiStateGraphs } from "../../shared/wiki-state-graph";

const evidenceLinks = `a[href^="${WIKI_EVIDENCE_LINK}"]`;
function structureAt(link: HTMLAnchorElement) {
  const flow = link.closest<HTMLElement>(".wiki-flow");
  const next = link.closest(".wiki-table-heading")?.nextElementSibling;
  return flow ?? (next instanceof HTMLElement ? next.matches("table") ? next : next.querySelector("table") : null);
}

export function WikiDocument({ section, session, zh, structure, editor, onLocate, onCurrent, onFinishEdit, onEdit, updatedConversationIds,headingTarget,scrollRef,issue,onIssueStep,onIssueClose,autoReview,onAutoReviewed,readingProjection,toolsHost,persistSourceMarks,onReviewEvidence }: {
  section: FocusSection; session: FocusSession; zh: boolean; structure: ReactNode; editor?: ReactNode;
  /** A pending problem in this chapter the overview sent the reader to: its paragraph is marked and named. */
  issue?: { issue: WikiBlockIssue; index: number; total: number }; onIssueStep?: (delta: number) => void; onIssueClose?: () => void;
  /** Sent from the overview to check evidence: the review opens on its own, once per value. */
  autoReview?: number;
  /** The request to open the check is used once: coming back to the chapter or switching wikis does not reopen it. */
  onAutoReviewed?: () => void;
  onLocate: (ref: FocusEvidence, options?: WorkspaceEvidenceOptions) => void; onCurrent: () => void;
  onFinishEdit?: () => void;
  /** Opens the editor at this text: the paragraph in view, or the problem being shown. */
  onEdit?: (target?: string) => void; updatedConversationIds?: string[];
  headingTarget?:{title:string;revision:number};
  scrollRef?:RefObject<HTMLElement|null>;
  readingProjection?: WikiReadingProjection;
  toolsHost?: HTMLElement | null;
  persistSourceMarks?: boolean;
  /** Opens the curated reading path in the read-only example. */
  onReviewEvidence?: () => void;
}) {
  const evidencePanel=useContext(WorkspaceEvidenceContext);
  const review=session.mode==="review",[updatesOpen,setUpdatesOpen]=useState(false);
  const sources=useMemo(()=>{
    const ids=new Set([...section.evidenceIds,...(section.claims??[]).flatMap(claim=>claim.evidenceIds)]);
    return session.evidence.filter(ref=>ids.has(ref.id));
  },[session.evidence,section]);
  const sourceTexts=useMemo(()=>{
    const ids=new Set(section.evidenceIds);
    return sources.filter(ref=>ids.has(ref.id)).map(ref=>ref.excerpt);
  },[sources,section.evidenceIds]);
  const flowSources=useMemo(()=>{
    const current=currentWikiEvidence(session);
    const ids=new Set(sources.map(ref=>ref.id));
    const refByQuote=new Map(current.filter(ref=>ids.has(ref.id)).map(ref=>[JSON.stringify([ref.conversationId,ref.messageId,ref.excerpt.trim()]),ref]));
    const saved=session.wikiKnowledge?.batches.flatMap(batch=>batch.units.flatMap(unit=>{
      const {conversationId,messageId,quote,code}=unit.evidence;
      const ref=code&&/[→↓]|->|=>/u.test(code.text)&&refByQuote.get(JSON.stringify([conversationId,messageId,quote.trim()]));
      return ref&&code?[{...ref,excerpt:code.text}]:[];
    }))??[];
    return [...refByQuote.values(),...saved];
  },[session,sources]);
  const location=review?section.origin==="user"?zh?"我的理解":"My understanding":section.kind==="proposal"?zh?"AI 建议":"AI proposal":section.kind==="open_question"?zh?"待确认":"Open question":zh?"复习章节":"Review chapter":wikiReadingLocation(section,zh);
  const readingCache=useProjectReadingCache();
  // Previews can supply an updated chapter before it is in session.sections.
  const readingSession=useMemo(()=>session.sections.includes(section)?session:{...session,sections:session.sections.map(chapter=>chapter.id===section.id?section:chapter)},[session,section]);
  const reading=useMemo(()=>readingCache.get(readingSession,`chapter:${section.id}`,()=>{
   if(section.userEdited||section.origin)return section;
   if(readingProjection?.chapter?.id===section.id)return readingProjection.chapter;
   const context=readingCache.get(readingSession,"chapter-context",()=>readingProjection?.context??projectKnowledgeReadingContext(readingSession));
   return projectKnowledgeReading(context.chapters.find(chapter=>chapter.id===section.id)??section,readingSession,context.view,context.chapters,true);
  }),[readingCache,readingSession,section,readingProjection]);
  const learning=session.wikiKnowledge?.documentType==="learning";
  const [holderMarks,setHolderMarks]=useHolderMarks(persistSourceMarks);
  const compact=Boolean(session.wikiKnowledge?.draft&&!learning&&!review&&session.wikiKnowledge.draft.writingMode!=="audit"&&!holderMarks);
  const body=reading.body;
  const stateGraphs=useMemo(()=>!review&&!learning&&!editor&&!section.userEdited&&!section.origin
    ?wikiStateGraphs(body,reading.claims??[]):[],[review,learning,editor,section.userEdited,section.origin,body,reading.claims]);
  const page=useMemo(()=>readingCache.get(readingSession,`chapter-page:${section.id}`,()=>wikiChapterPage(reading,session.evidence)),[readingCache,readingSession,section.id,reading,session.evidence]);
  const content=useRef<HTMLDivElement>(null);
  // Point-by-point evidence: each claim found in the prose gets a marker; the panel
  // steps through markers in reading order, then through claims with no position.
  const generated=!section.userEdited&&!section.origin;
  // Evolution: structured Product Evolution records first, then real "历史：" notes.
  const history=useMemo(()=>generated?readingCache.get(readingSession,`chapter-history:${section.id}`,()=>wikiHistoryEntries(session,section)):[],[generated,readingCache,readingSession,session,section]);
  const historyPoints=useMemo(()=>wikiHistoryPoints(section,history,session.evidence,zh),[section,history,session.evidence,zh]);
  const points=useMemo(()=>{
   if(!generated||editor)return [];
   // One point per sentence and holder: a chapter saved with two claims on one sentence showed two 已定 marks after it.
   return readingCache.get(readingSession,`chapter-points:${section.id}:${zh}`,()=>{
    const claims=wikiChapterEvidencePoints({...reading,body:page.body},session.evidence,zh);
    // Chapters saved without claim records still get points, matched locally and labelled as approximate.
    const prose=claims.length?claims:wikiApproximatePoints(reading,session.evidence,reading.body,zh);
    return [...prose,...historyPoints.points];
   });
  },[generated,editor,reading,readingCache,readingSession,session,section.id,zh,historyPoints,page.body]);
  const renderKey=useMemo(()=>[page,editor,section.wikiDiagram],[page,editor,section.wikiDiagram]);
  const pendingReview = useMemo(() => session.mode === "work" ? points.filter(point => !point.approximate && needsConfirmation(point)) : undefined, [session.mode, points]);
  const {rootRef:articleRef,claimMarkers,ordered,open:openPoint,markerContext}=useEvidencePoints(points,onLocate,zh,renderKey,pendingReview);
  // Source marks (你, 资料) and the colour each mark tints its text with stay out of the prose until the reader turns
  // them on, checking included: the check highlights only the sentence it is on. 已定, 未定 and 此前 always show.
  const hasHolders=useMemo(()=>ordered.some(point=>point.holder),[ordered]),marksHidden=hasHolders&&!holderMarks;
  const claimContext=useMemo(()=>({...markerContext,learning}),[markerContext,learning]);
  const [structureTarget, setStructureTarget] = useState<{ href: string; index: number; revision: number }>();
  const activeRevision=evidencePanel?.active?.locationRevision;
  useLayoutEffect(()=>{
    if(!structureTarget||activeRevision!==structureTarget.revision)return;
    const matches=[...articleRef.current?.querySelectorAll<HTMLAnchorElement>(evidenceLinks)??[]]
      .filter(link=>link.getAttribute("href")===structureTarget.href);
    const link=matches[structureTarget.index],node=link&&structureAt(link);
    if(!node)return;
    node.setAttribute("data-wiki-structure-active","true");
    return ()=>node.removeAttribute("data-wiki-structure-active");
  },[articleRef,structureTarget,activeRevision,page]);
  const statusGroups=([
    ["decided",false],["open",false],["user",true],["user",false],["material",false],["earlier",false],["ai",false],["corrected",false],
  ] as Array<[WikiHolder,boolean]>).flatMap(([holder,reported])=>{
    const points=ordered.filter(point=>point.holder===holder&&(holder!=="user"||(point.source==="report")===reported));
    return points.length?[{holder,reported,points}]:[];
  });
  const statusId=useId(),statusControl=useRef<HTMLDivElement>(null),statusPanel=useRef<HTMLDivElement>(null);
  const statusCursors = useRef(new Map<string, string>()), locationRevision = useRef(0);
  const showStatuses=!editor&&hasHolders&&holderMarks;
  useLayoutEffect(()=>{
    const control=statusControl.current,panel=statusPanel.current;
    if(toolsHost||!showStatuses||!control||!panel)return;
    const scroller=scrollRef?.current??control.closest<HTMLElement>(".focus-reading-body");
    const place=()=>{
      const anchor=control.getBoundingClientRect(),bounds=scroller?.getBoundingClientRect();
      const edge=(bounds?.left??0)+(scroller?.clientLeft??0);
      const left=Math.max(0,edge),right=Math.min(window.innerWidth,scroller?.clientWidth?edge+scroller.clientWidth:bounds?.right??window.innerWidth);
      const gap=14,inset=8;
      panel.style.setProperty("--wiki-status-width",`${Math.max(0,right-left-2*inset)}px`);
      const width=panel.getBoundingClientRect().width;
      const horizontalRail=control.parentElement&&getComputedStyle(control.parentElement).flexDirection==="row";
      if(!horizontalRail&&right-anchor.right>=width+gap+inset)panel.dataset.placement="right";
      else if(!horizontalRail&&anchor.left-left>=width+gap+inset)panel.dataset.placement="left";
      else {
        panel.dataset.placement="below";
        const offset=Math.max(left+inset,Math.min(anchor.right-width,right-width-inset))-anchor.left;
        panel.style.setProperty("--wiki-status-offset",`${offset}px`);
      }
    };
    place();
    const observer=typeof ResizeObserver==="undefined"?undefined:new ResizeObserver(place);
    if(scroller)observer?.observe(scroller);
    observer?.observe(panel);
    window.addEventListener("resize",place);
    return ()=>{observer?.disconnect();window.removeEventListener("resize",place);};
  },[showStatuses,scrollRef,toolsHost]);
  // Shown holders tint the text each mark covers in the mark's colour; hidden, nothing is painted.
  useEffect(()=>{const root=articleRef.current;const timer=window.setTimeout(()=>paintHolderRuns(root,hasHolders&&!marksHidden),0);return()=>{window.clearTimeout(timer);paintHolderRuns(root,false);};},[articleRef,hasHolders,marksHidden,page,ordered]);
  // Points whose quote is in the original pass on their own; the review steps only through those that need a look.
  const attention=useMemo(()=>ordered.filter(needsConfirmation),[ordered]);
  const reviewEvidence=()=>{
    const first=attention[0];
    if(!first){if(ordered[0])openPoint(ordered[0].key);return;}
    if(evidencePanel)evidencePanel.open(first.reference,{sectionId:section.id,references:first.references,quote:first.quote,claim:first.claim,points:attention,pointIndex:0,mode:"check"});else onLocate(first.reference);
  };
  // Sent here to check evidence: the review opens once the chapter's points are known.
  const reviewed=useRef<number>();
  useEffect(()=>{if(!autoReview||reviewed.current===autoReview||!attention.length)return;reviewed.current=autoReview;reviewEvidence();onAutoReviewed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when sent here, not on every point change.
  },[autoReview,attention.length]);
  // The first paragraph whose text is on screen: editing opens there rather than at the chapter's first line.
  const paragraphInView=()=>{
    const top=scrollRef?.current?.getBoundingClientRect().top??0;
    const block=[...articleRef.current?.querySelectorAll<HTMLElement>("p, li, h2, h3, h4, td")??[]].find(element=>element.getBoundingClientRect().bottom>top+24&&element.textContent?.trim());
    return block?.textContent?.trim().slice(0,80);
  };
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
    const target=[...content.current?.querySelectorAll<HTMLElement>(".chapter-guide :is(h2,h3,h4,h5,h6)")??[]]
      .find(node=>node.textContent?.trim()===headingTarget.title);
    if(target){target.scrollIntoView?.({block:"start",behavior:"auto"});target.tabIndex=-1;target.focus({preventScroll:true});}
  },[headingTarget,editor,page.body]);
  // Wiki reads prose directly. Only an already saved, current, visible diagram
  // belongs here; topic keywords must not inject a generation suggestion card.
  const hasDiagram=!review&&hasChapterDiagram(section,session)&&!section.wikiDiagram?.hidden;
  const readingBody=!review?page.overview?.readingBody??page.body:page.body;
  const parts=useMemo(()=>wikiDiagramParts(readingBody,section.wikiDiagram?.afterHeading??suggestedDiagramHeading(section)),[readingBody,section]);
  const read=(body:string)=>body.trim()?<div className="chapter-guide"><ReaderGuide hideCitationAnnotations content={body} sourceTexts={sourceTexts} flowSources={flowSources} zh={zh} complete hideEvidenceMarkers={!section.userEdited&&section.origin!=="user"} claimMarkers={claimMarkers}/></div>:null;
  const reviewLabel = onReviewEvidence ? (zh ? "核对依据" : "Check evidence") : undefined;
  const tools = !editor ? <nav className="wiki-tool-rail" aria-label={zh?"文档工具":"Document tools"}>
      {onReviewEvidence||ordered.length||attention.length?<button type="button" className={`wiki-tool evidence-review-button${!onReviewEvidence&&attention.length?" has-attention":""}`} aria-label={reviewLabel??(attention.length?zh?`核对依据 · ${attention.length} 条待确认`:`Check evidence · ${attention.length} to confirm`:zh?"来源已定位":"Sources located")} title={reviewLabel??(attention.length?zh?`核对依据：${attention.length} 处需要你确认，逐条带你看`:`Check evidence: ${attention.length} points need your look`:zh?"点开查看来源":"Open sources")} onClick={onReviewEvidence??reviewEvidence}><Quote size={17} aria-hidden="true"/>{!onReviewEvidence&&attention.length?<span className="wiki-tool-badge" aria-hidden="true">{attention.length}</span>:null}</button>:<EvidenceReviewButton iconOnly sources={sources} zh={zh} onLocate={onLocate} historical={Boolean(section.userEdited||section.origin)}/>}
      {hasHolders?<div className="wiki-status-control" ref={statusControl} onKeyDown={event=>{
        if(event.key!=="Escape"||!holderMarks)return;
        event.stopPropagation();
        setHolderMarks(false);
        statusControl.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }}>
        <button type="button" className="wiki-tool holder-marks-toggle" aria-pressed={holderMarks} aria-expanded={holderMarks} aria-controls={statusId} aria-label={holderMarks?zh?"收起出处":"Hide sources":zh?"显示出处":"Show sources"} title={holderMarks?zh?"收起出处":"Hide sources":zh?"显示出处和状态筛选":"Show sources and status filters"} onClick={()=>setHolderMarks(!holderMarks)}><Tags size={17} aria-hidden="true"/></button>
        <div id={statusId} ref={statusPanel} className="wiki-status-panel" role="group" aria-label={zh?"按状态查阅依据":"Find evidence by status"} hidden={!showStatuses}>
          {statusGroups.map(({holder,reported,points})=>{
            const filter = `${holder}:${reported}`, active = evidencePanel?.active;
            const selected = active?.statusFilter === filter;
            const basis = reported ? zh ? "用户报告，代码或测试尚未核验" : "User report, code or tests unverified" : wikiHolderTitle(holder,zh);
            return <button type="button" key={filter} className={`wiki-status-key is-holder-${holder}${reported?" is-report":""}`} aria-pressed={selected}
              title={points.length>1 ? `${basis} · ${zh ? "再次点击定位下一处" : "Click again to find the next occurrence"}` : basis}
              onClick={()=>{
                const last = selected ? active.points?.[active.pointIndex ?? -1]?.key : statusCursors.current.get(filter);
                const pointIndex = (points.findIndex(point=>point.key===last)+1)%points.length;
                const point = points[pointIndex];
                statusCursors.current.set(filter, point.key);
                if(evidencePanel)evidencePanel.open(point.reference,{sectionId:section.id,references:point.references,quote:point.quote,claim:point.claim,points,pointIndex,mode:"view",statusFilter:filter,locationRevision:++locationRevision.current});
                else openPoint(point.key);
              }}>{wikiHolderReadingLabel(holder,zh,reported,learning)} <span>{points.length}</span></button>;
          })}
        </div>
      </div>:null}
      {onEdit?<button type="button" className="wiki-tool" aria-label={zh?"编辑":"Edit"} title={zh?"编辑本章（从你正在读的地方开始）":"Edit this chapter, from where you are reading"} onClick={()=>onEdit(paragraphInView())}><PencilLine size={17} aria-hidden="true"/></button>:null}
      {changes.length?<button type="button" className="wiki-tool" aria-label={zh?"当前方案":"Current plan"} title={zh?"当前方案":"Current plan"} onClick={onCurrent}><Layers size={17} aria-hidden="true"/></button>:null}
      {!review&&(changes.length||session.wikiSuggestions?.[section.id])?<button type="button" className="wiki-tool" aria-label={zh?"相关更新":"Related updates"} title={zh?"相关更新":"Related updates"} onClick={()=>setUpdatesOpen(true)}><History size={17} aria-hidden="true"/></button>:null}
    </nav> : null;
  return <WorkspaceEvidenceContext.Provider value={evidencePanel?{...evidencePanel,open:(ref,options)=>evidencePanel.open(ref,options?.points?options:{...options,sectionId:section.id,references:sources})}:undefined}><WikiClaimMarkerContext.Provider value={claimContext}><article ref={articleRef} className={`wiki-document${marksHidden?" hides-holder-marks":""}`} data-reading-edition={compact?"compact":undefined} aria-label={review?zh?"复习文档":"Review document":zh?"Wiki 文档":"Wiki document"} onClick={event=>{
    const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>(evidenceLinks):null;
    if(!link)return;
    event.preventDefault();
    const target=wikiEvidenceTarget(link.getAttribute("href")??"");
    const ref=target&&sources.find(source=>source.id===target.id&&availableWikiEvidence(session,source));
    if(!target||!ref)return;
    const flow=link.closest<HTMLElement>(".wiki-flow");
    const sourceQuote=flow&&wikiFlowSourceQuote([...flow.querySelectorAll(".wiki-flow-card li")].map(step=>step.textContent??""));
    const quote=sourceQuote&&(sourceQuote(ref.excerpt)||flowSources.filter(source=>source.id===ref.id).map(source=>sourceQuote(source.excerpt)).find(Boolean));
    const block=structureAt(link);
    const revision=performance.now();
    if(block){
      const href=link.getAttribute("href")!;
      const index=[...event.currentTarget.querySelectorAll<HTMLAnchorElement>(evidenceLinks)].filter(candidate=>candidate.getAttribute("href")===href).indexOf(link);
      setStructureTarget({href,index,revision});
    }
    const options={sectionId:section.id,mode:"view" as const,locationRevision:revision, ...(block?{structuredBlock:true}:{}),
      ...(target.table?{tableTarget:target.table,references:[ref]}:{quote:quote||ref.excerpt,references:flow?[ref]:sources})};
    if(evidencePanel)evidencePanel.open(ref,options);
    else onLocate(ref,options);
  }}>
    {toolsHost && tools ? createPortal(tools, toolsHost) : tools}
    <header className="wiki-document-heading"><div className="wiki-document-location"><span>{location}</span>{editor&&onFinishEdit?<div><button type="button" onClick={onFinishEdit}>{zh?"保存并结束编辑":"Save and finish editing"}</button></div>:null}</div><h1 title={section.title}>{localizedWikiTitle(section,zh)}</h1>{section.userEdited?<small className="muted">{zh?"个人编辑内容":"Your edited content"}</small>:null}</header>
    {!editor&&wikiTitleReviewIncomplete(section.wikiTitleReview)?<p className="muted" role="status">{zh?"标题未整理完成，已保留原名和正文。":"Title editing could not finish. The original name and prose are preserved."}</p>:null}
    {issue?<div className="wiki-issue-bar" role="status"><span>{zh?`待处理 ${issue.index+1}/${issue.total}`:`To review ${issue.index+1}/${issue.total}`}</span><strong>{issueLabel(issue.issue,zh)}</strong>
      <span className="wiki-issue-actions"><button type="button" aria-label={zh?"上一处":"Previous"} disabled={!issue.index} onClick={()=>onIssueStep?.(-1)}><ChevronLeft size={15} aria-hidden="true"/></button><button type="button" aria-label={zh?"下一处":"Next"} disabled={issue.index>=issue.total-1} onClick={()=>onIssueStep?.(1)}><ChevronRight size={15} aria-hidden="true"/></button>
        {onEdit?<button type="button" onClick={()=>onEdit(issueText)}>{zh?"编辑本章":"Edit chapter"}</button>:null}<button type="button" aria-label={zh?"关闭":"Close"} onClick={onIssueClose}><X size={15} aria-hidden="true"/></button></span></div>:null}
    {!review&&!editor?<WikiChapterOverview overview={page.overview} zh={zh} emphasize={!section.userEdited&&section.origin!=="user"} claimMarkers={claimMarkers}/>:null}
    {!editor?<WikiSectionLocator headings={page.headings} contentRef={content} scrollRef={scrollRef} zh={zh}/>:null}
    {section.reviewIssue?<p className="wiki-review-warning" role="status">{zh?"本章为待核验草稿。":"This chapter is a draft awaiting review."}</p>:null}
    {review?<div className="wiki-document-structure">{structure}</div>:null}
    <div ref={content} className="wiki-chapter-content">{editor??(hasDiagram?<>{read(parts[0])}<WikiDiagram session={session} section={section} zh={zh} onLocate={onLocate}/>{read(parts[1])}</>:read(readingBody))}
    {stateGraphs.map((edges,index)=><figure key={index} className="wiki-flow">
      <figcaption>{zh?"状态转换":"State transitions"}</figcaption>
      <ul>{edges.map(edge=>{
        const ref=sources.find(item=>edge.claim.evidenceIds.includes(item.id)&&availableWikiEvidence(session,item));
        return <li key={edge.from+"→"+edge.to+edge.condition}>{edge.from} → {edge.to}{edge.condition?"（"+edge.condition+"）":""}
          {ref?<button type="button" className="overview-text-button" onClick={()=>onLocate(ref,{sectionId:section.id,claim:edge.claim.text,quote:edge.claim.quote})}>{zh?"来源":"Source"}</button>:null}</li>;
      })}</ul>
    </figure>)}
    {editor&&!review?<WikiKnowledgeLinks editing session={session} section={section} zh={zh}/>:null}
    {!editor?review?<><WikiHistoryCard entries={history} markers={historyPoints.markers} zh={zh}/><WikiEvidence section={section} evidence={session.evidence} session={session} sourceRoles={session.sourceRoles} updatedConversationIds={updatedConversationIds} zh={zh} onLocate={onLocate}/><ProjectChangeHistory changes={changes} zh={zh} onLocate={onLocate}/></>
      :<section className="wiki-chapter-end">
        <WikiHistoryCard entries={history} markers={historyPoints.markers} zh={zh}/>
        <WikiKnowledgeLinks session={session} section={section} zh={zh}/>
        <WikiSources section={section} session={session} zh={zh} onLocate={onLocate}/>
      </section>:null}
    </div>
    {!editor&&reviewSources.length?<details className="wiki-evidence review-original-evidence"><WorkspaceDisclosureTitle label={zh?"原始讨论":"Original discussions"} count={reviewSources.length}/><ul>{reviewSources.map(ref=><li key={ref.id}><button type="button" onClick={()=>onLocate(ref)}><strong>{ref.title}</strong><span>{ref.excerpt}</span><small>{zh?"阅读原文":"Read original"}</small></button></li>)}</ul></details>:null}
    {!editor&&review&&session.wikiSuggestions?.[section.id]?<details className="wiki-update-suggestion"><WorkspaceDisclosureTitle label={zh?"相关讨论更新":"Updated discussions"}/><ReaderGuide content={session.wikiSuggestions[section.id].body} zh={zh} complete hideEvidenceMarkers/><WikiEvidence section={session.wikiSuggestions[section.id]} evidence={session.evidence} zh={zh} onLocate={onLocate}/></details>:null}
    {updatesOpen?<RecordDetailDrawer session={session} title={section.title} label={zh?"变更与相关讨论":"Changes and related discussions"} zh={zh} onClose={()=>setUpdatesOpen(false)}><ProjectChangeHistory changes={changes} preview zh={zh} onLocate={ref=>{setUpdatesOpen(false);onLocate(ref);}}/>{session.wikiSuggestions?.[section.id]?<><h3>{zh?"待采用更新":"Proposed update"}</h3><ReaderGuide content={session.wikiSuggestions[section.id].body} zh={zh} complete hideEvidenceMarkers/><WikiEvidence section={session.wikiSuggestions[section.id]} evidence={session.evidence} zh={zh} onLocate={ref=>{setUpdatesOpen(false);onLocate(ref);}}/></>:null}</RecordDetailDrawer>:null}
  </article></WikiClaimMarkerContext.Provider></WorkspaceEvidenceContext.Provider>;
}
