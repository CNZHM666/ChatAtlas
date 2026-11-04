import type { FocusSession } from "../shared/focus-session";
import { editableWikiTopic, type DirectoryPage } from "../shared/wiki-directory";
import { mergeWikiTopics } from "../shared/wiki-topic-merge";
import { sourceMessageSignature } from "../shared/source-signature";
import { planWikiTopics, type WikiPlanReceipt, type WikiPreviousChapter } from "./wiki-topic-plan";
import type { AtlasAIProvider } from "./provider";
import {assertWikiOutline,wikiOutlineError} from "./wiki-outline-policy";
import {normalizeWikiDirectory} from "./wiki-directory";
import {measureAILocalStep,recordAISkippedStep} from "./pipeline-timing";
import {editWikiSessionTitles} from "./wiki-title-editor";

/** Receipt of an organized directory; a later local edit carries it forward. */
export const wikiOrganizationStamp=(value:FocusSession)=>sourceMessageSignature(JSON.stringify([6,value.locale,value.sections,value.wikiSuggestions]));
const normalized=(text:string)=>text.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu,"");

/** One bounded catalogue pass over the final draft, including direct and update paths.
 * Only editorial ownership changes: all original prose, claims and evidence survive.
 * No raw-history reread, recursive summarization or automatic confirmation. */
export async function autoOrganizeWiki(session:FocusSession,ai:Pick<AtlasAIProvider,"generateStructured"|"modelId">,signal:AbortSignal,topicPlanApplied=false,project?:"new"|"suggest",previousDirectory?:WikiPreviousChapter[]):Promise<FocusSession> {
  signal.throwIfAborted();
  if(session.mode!=="work")return session;
  const eligible=session.sections.filter(section=>editableWikiTopic(section)&&!session.wikiSuggestions?.[section.id]);
  const stamp=wikiOrganizationStamp;
  const signature=stamp(session);
  if(session.wikiOrganization?.version===6&&session.wikiOrganization.signature===signature&&["organized","unchanged","protected"].includes(session.wikiOrganization.status)){
    const retry=session.wikiTitleReview?.status==="partial"||session.wikiTitleReview?.status==="failed";
    if(!topicPlanApplied&&(retry||project&&session.wikiTitleReview?.policyVersion!==3)){
      const edited=await editWikiSessionTitles(session,ai,signal,project);
      return {...edited,wikiOrganization:{...session.wikiOrganization,signature:stamp(edited)}};
    }
    return session;
  }
  if(eligible.length<2){if(session.runId)await recordAISkippedStep(session.runId,"wiki","wiki:directory","no_mergeable_generated_chapters");const edited=topicPlanApplied?session:await editWikiSessionTitles(session,ai,signal,project);return {...edited,wikiDirectoryReview:{status:"ready"},wikiOrganization:{version:6,status:"protected",signature:stamp(edited),mergedSections:0,reason:"no_mergeable_generated_chapters"}};}
  const local=new Map<string,DirectoryPage>();
  for(const section of eligible){
    const key=section.wikiOwnerId?section.wikiOwnerId:JSON.stringify([section.kind,section.phase??"",normalized(section.wikiQuestion||section.title)]);
    const prior=local.get(key);
    if(prior)prior.sectionIds.push(section.id);
    else local.set(key,{title:section.title,group:section.wikiGroup??"",question:section.wikiQuestion||section.title,ownerId:section.wikiOwnerId,sectionIds:[section.id]});
  }
  let pages=[...local.values()],status:"organized"|"deferred"|"unchanged"="organized",reason:string|undefined;
  try{
    // Reuse only a plan from THIS generation, never infer validity from old IDs.
    if(topicPlanApplied&&eligible.every(section=>section.wikiOwnerId&&section.wikiQuestion)){
      assertWikiOutline(pages,false);
      if(session.runId)await recordAISkippedStep(session.runId,"wiki","wiki:directory","generation_topic_plan_reused");
    }else{
      if(typeof ai.generateStructured!=="function")throw Error("Directory planning unavailable");
      let receipt:WikiPlanReceipt|undefined;
      const plan=()=>planWikiTopics(eligible,session.locale??"zh-CN",ai,signal,value=>{receipt=value;},{conversations:session.sourceConversationIds.length,documentNames:[session.title],...(previousDirectory?.length?{previousDirectory}:{})});
      pages=session.runId?await measureAILocalStep(session.runId,"wiki","wiki:directory",plan,()=>({inputCount:eligible.length,protectedCount:session.sections.length-eligible.length,...(receipt?.mainCount===undefined?{}:{mainCount:receipt.mainCount}),requests:receipt?.requests??0,repairCount:receipt?.repairCount??0,nameRepairCount:receipt?.nameRepairCount??0,outputRecoveryCount:receipt?.outputRecoveryCount??0,outputRecoveryTokens:receipt?.outputRecoveryTokens??0,convergenceCount:receipt?.convergenceCount??0,convergenceTokens:receipt?.convergenceTokens??0,candidateCount:receipt?.candidateCount??0,maxMainCount:receipt?.maxMainCount??7,subtopicCount:receipt?.subtopicCount??0})):await plan();
    }
  }catch(error){
    signal.throwIfAborted();status="deferred";reason=error&&typeof error==="object"&&"code" in error?String(error.code):"directory_analysis_failed";
  }
  signal.throwIfAborted();
  const groups=pages.filter(page=>page.sectionIds.length>1);
  // The directory has already established semantic ownership. Joining its
  // immutable fragments locally needs no per-chapter paid block sorting call.
  let merged=groups.length?mergeWikiTopics(session,groups):session;
  let renamed=false;
  if(status!=="deferred")merged={...merged,sections:merged.sections.map(section=>{
    const page=pages.find(page=>page.sectionIds.length===1&&page.sectionIds[0]===section.id);if(!page)return section;
    renamed ||= section.title!==page.title||section.wikiQuestion!==page.question||section.wikiGroup!==page.group;
    return {...section,title:page.title,wikiQuestion:page.question,wikiGroup:page.group||undefined,wikiOwnerId:page.ownerId??section.wikiOwnerId??section.id,...(page.subtopics?{wikiSubtopics:page.subtopics.map(({title,question})=>({title,question}))}:{})};
  })};
  merged=normalizeWikiDirectory(merged);
  if(status!=="deferred"&&!topicPlanApplied)merged=await editWikiSessionTitles(merged,ai,signal,project);
  if(status==="organized"&&!groups.length&&!renamed){status="unchanged";reason="no_merge_proposed";}
  return {...merged,wikiDirectoryReview:{status:status==="deferred"?"pending":"ready",...(status==="deferred"?{reason:reason?.includes("budget")?"budget" as const:"analysis" as const}:{})},wikiOrganization:{version:6,status,signature:stamp(merged),mergedSections:session.sections.length-merged.sections.length,reason,inputSections:session.sections.length,protectedSections:session.sections.length-eligible.length,plannedChapters:pages.length,finalSections:merged.sections.length}};
}

/** A draft may be retained for recovery; it must never be published as organized. */
export function requireOrganizedWiki(session:FocusSession):FocusSession {
 if(session.mode!=="work")return session;
 if(session.wikiOrganization?.status==="deferred"||session.wikiDirectoryReview?.status==="pending")throw wikiOutlineError("incomplete");
 const generated=session.sections.filter(section=>editableWikiTopic(section)&&!session.wikiSuggestions?.[section.id]);
 if(generated.length)assertWikiOutline(generated.map(section=>({title:section.title,group:section.wikiGroup??"",question:section.wikiQuestion??section.title,sectionIds:[section.id]})),false);
 return {...session,wikiEdition:"current-v2"};
}
