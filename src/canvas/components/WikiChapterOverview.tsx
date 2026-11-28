import {useMemo,type RefObject} from "react";
import type {FocusEvidence,FocusSection} from "../../shared/focus-session";
import {wikiDocument,type WikiChapterOverview as Overview} from "../wiki-document";
import {ReaderGuide} from "./ReaderGuide";
import {aiAdvicePresentation} from "../../shared/ai-advice-presentation";
import {wikiStatusProse} from "../../shared/wiki-status-prose";
import {wikiReadingCleanup} from "../../shared/wiki-reading-cleanup";
import {wikiReadingFormat} from "../../shared/wiki-reading-format";
import {wikiChapterStatusTag} from "../../shared/wiki-chapter-status";
import {extractHistoryNotes,meaningfulHistoryNote,type WikiHistoryEntry} from "../../shared/wiki-history";
import {WikiHistoryCard} from "./WikiHistoryCard";
import type {WikiClaimMarkerPoint} from "../../shared/wiki-claim-markers";
import {withoutWikiVersionCards} from "../../shared/wiki-editorial-cleanup";
import {wikiApproximatePoints,wikiChapterEvidencePoints} from "../wiki-evidence";
import {WikiClaimMarkerContext} from "../wiki-claim-marker-context";
import type {EvidencePoint} from "../workspace-evidence-context";
import {WikiSourceCards} from "./WikiSourceCards";

export function WikiChapterOverview({overview,zh,emphasize=false,claimMarkers}:{overview?:Overview;zh:boolean;emphasize?:boolean;claimMarkers?:WikiClaimMarkerPoint[]}){
 if(!overview||overview.kind!=="opening")return null;
 // The opening reads as the chapter's lead paragraph; the label is for assistive technology only.
 return <section className="wiki-chapter-overview" aria-label={zh?"本章概览":"Chapter overview"}>
  <div className="wiki-chapter-overview-content">{overview.blocks.map((block,index)=><ReaderGuide key={index} content={emphasize?aiAdvicePresentation(block.text):block.text} zh={zh} complete hideCitationAnnotations claimMarkers={claimMarkers}/>)}</div>
 </section>;
}

/** Preview uses the same opening as the saved Reader, with no summary request. */
/** statusInHeading: the chapter's status tag shows beside its title (the preview's heading), not above the text. */
export function WikiChapterBody({section,zh,sourceTexts,statusInHeading=false,hideProposalStatus=false,hideVersionCards=false,sourceMarks,onSelectSource,activeSourceKey,sourceControls,sourceNavigation,activeOriginalId,sourceBody,onOriginal}:{
 section:FocusSection;zh:boolean;sourceTexts?:string[];statusInHeading?:boolean;hideProposalStatus?:boolean;hideVersionCards?:boolean;
 sourceMarks?:FocusEvidence[];onSelectSource?:(point:EvidencePoint,navigate?:boolean)=>void;activeSourceKey?:string;
 sourceControls?:HTMLElement|null;sourceNavigation?:HTMLElement|null;activeOriginalId?:string;sourceBody?:RefObject<HTMLElement>;onOriginal?:(ref:FocusEvidence)=>void;
}){
 const generated=!section.userEdited&&!section.origin;
 const page=useMemo(()=>{
  const body=generated&&hideVersionCards?withoutWikiVersionCards(section.body):section.body;
  return wikiDocument(generated?wikiReadingFormat(wikiReadingCleanup(wikiStatusProse(body,{claims:section.claims}),{claims:section.claims}),{}):body,generated,sourceTexts,section.claims?.flatMap(claim=>[claim.text,...claim.formulations??[]]));
 },[section.body,section.claims,generated,sourceTexts,hideVersionCards]);
 const points=useMemo(()=>{
  if(!sourceMarks?.length)return [];
  const anchored=wikiChapterEvidencePoints({...section,body:page.body,userEdited:undefined,origin:undefined},sourceMarks,zh);
  if(!anchored.length)return wikiApproximatePoints(section,sourceMarks,page.body,zh);
  return anchored.map(point=>{
   if(point.holder)return point;
   const holder=point.source==="decision"?"decided":point.source==="report"||point.source==="preference"||point.source==="plan"?"user":point.source==="aiProposal"?"ai":undefined;
   return {...point,holder,holderMark:Boolean(holder)} as typeof point;
  });
 },[page.body,section,sourceMarks,zh]);
 const claimMarkers=useMemo(()=>points.map(({key,phrases,approximate})=>({key,phrases,approximate})),[points]);
 const markerContext=onSelectSource?{points,activeKey:activeSourceKey,zh,open:(key:string)=>{
  const point=points.find(item=>item.key===key);
  if(point)onSelectSource(point);
 }}:undefined;
 const tag=statusInHeading?undefined:wikiChapterStatusTag(section,zh);
 const status=hideProposalStatus&&tag?.label===(zh?"多为 AI 建议":"Mostly AI proposals")?undefined:tag;
 // Preview has no project records; it keeps the chapter's own change notes.
 const history=useMemo<WikiHistoryEntry[]>(()=>generated?extractHistoryNotes(section.body).notes.filter(note=>meaningfulHistoryNote(note.text)).map((note,index)=>({kind:"note",id:`${section.id}:note${index}`,...note})):[],[generated,section.body,section.id]);
 return <WikiClaimMarkerContext.Provider value={markerContext}>
  {status?<p className="wiki-chapter-status"><span className="wiki-chapter-status-tag" title={status.detail}>{status.label}</span></p>:null}
  <WikiChapterOverview overview={page.overview} zh={zh} emphasize={generated} claimMarkers={claimMarkers}/>
  <ReaderGuide content={page.overview?.readingBody??page.body} zh={zh} sourceTexts={sourceTexts} complete hideEvidenceMarkers={generated} hideCitationAnnotations claimMarkers={claimMarkers} flowSources={sourceMarks}/>
  <WikiHistoryCard entries={history} zh={zh}/>
  {sourceControls&&sourceBody&&sourceMarks&&onSelectSource&&onOriginal&&<WikiSourceCards host={sourceControls} navigation={sourceNavigation}
    body={sourceBody} points={points} references={sourceMarks} zh={zh} activeKey={activeSourceKey} activeOriginalId={activeOriginalId}
    onSelect={onSelectSource} onOriginal={onOriginal}/>}
 </WikiClaimMarkerContext.Provider>;
}
