import {useMemo} from "react";
import type {FocusSection} from "../../shared/focus-session";
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

export function WikiChapterOverview({overview,zh,emphasize=false,claimMarkers}:{overview?:Overview;zh:boolean;emphasize?:boolean;claimMarkers?:WikiClaimMarkerPoint[]}){
 if(!overview||overview.kind!=="opening")return null;
 // The opening reads as the chapter's lead paragraph; the label is for assistive technology only.
 return <section className="wiki-chapter-overview" aria-label={zh?"本章概览":"Chapter overview"}>
  <div className="wiki-chapter-overview-content">{overview.blocks.map((block,index)=><ReaderGuide key={index} content={emphasize?aiAdvicePresentation(block.text):block.text} zh={zh} complete hideCitationAnnotations claimMarkers={claimMarkers}/>)}</div>
 </section>;
}

/** Preview uses the same opening as the saved Reader, with no summary request. */
/** statusInHeading: the chapter's status tag shows beside its title (the preview's heading), not above the text. */
export function WikiChapterBody({section,zh,sourceTexts,statusInHeading=false}:{section:FocusSection;zh:boolean;sourceTexts?:string[];statusInHeading?:boolean}){
 const generated=!section.userEdited&&!section.origin;
 const page=useMemo(()=>wikiDocument(generated?wikiReadingFormat(wikiReadingCleanup(wikiStatusProse(section.body,{claims:section.claims}),{claims:section.claims}),{}):section.body,generated,sourceTexts,section.claims?.flatMap(claim=>[claim.text,...claim.formulations??[]])),[section.body,section.claims,generated,sourceTexts]);
 const status=statusInHeading?undefined:wikiChapterStatusTag(section,zh);
 // Preview has no project records; it keeps the chapter's own change notes.
 const history=useMemo<WikiHistoryEntry[]>(()=>generated?extractHistoryNotes(section.body).notes.filter(note=>meaningfulHistoryNote(note.text)).map((note,index)=>({kind:"note",id:`${section.id}:note${index}`,...note})):[],[generated,section.body,section.id]);
 return <>{status?<p className="wiki-chapter-status"><span className="wiki-chapter-status-tag" title={status.detail}>{status.label}</span></p>:null}<WikiChapterOverview overview={page.overview} zh={zh} emphasize={generated}/><ReaderGuide content={page.overview?.readingBody??page.body} zh={zh} sourceTexts={sourceTexts} complete hideEvidenceMarkers={generated} hideCitationAnnotations/><WikiHistoryCard entries={history} zh={zh}/></>;
}
