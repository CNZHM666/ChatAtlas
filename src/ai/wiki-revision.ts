import type {FocusSection,FocusSession,WikiRevisionReceipt} from "../shared/focus-session";
import type {ConversationMessage} from "../shared/types";
import type {AtlasAIProvider} from "./provider";
import {executeBatches} from "./batch-executor";
import {WikiRewriteBudgetError,prepareWikiRewrite,type WikiRewriteContentPlan} from "./wiki-section-rewrite";
import {refreshWikiBrief} from "./wiki-manual-review";
import {prepareWikiContentPlan,applyWikiContentPlan} from "./wiki-content-plan";
import {editableWikiTopic} from "../shared/wiki-directory";
import {remapWikiSectionReferences} from "../shared/wiki-topic-merge";
import {editWikiSessionTitles} from "./wiki-title-editor";
import {prepareWikiRevisionBatches,type RevisionPart,type WikiRevisionProgress} from "./wiki-revision-batches";
import {routeWikiRevisionSources} from "./wiki-revision-sources";
import {wikiRevisionCache} from "./wiki-revision-cache";
import {wikiRevisionInstruction} from "../shared/wiki-revision-intent";
import {measureAILocalStep} from "./pipeline-timing";

/** Selected chapters reuse existing evidence and request caches. Never mutate the
 * accepted result, re-read the entire project, or silently rewrite personal text. */
export async function reviseWikiChapters(session:FocusSession,sectionIds:string[],originals:ConversationMessage[],instruction:string,ai:AtlasAIProvider,signal:AbortSignal,onProgress?:(done:number,total:number,detail?:WikiRevisionProgress)=>void,runId?:string):Promise<FocusSession>{
 // One diagnostics span per AI adjustment: its failure code, batches and what was kept whole.
 const stats:Record<string,number>={chapters:new Set(sectionIds).size};
 const work=async()=>{const result=await reviseChapters(session,sectionIds,originals,instruction,ai,signal,onProgress);const receipt=result.wikiRevisionReceipt;if(receipt)Object.assign(stats,{batches:receipt.batches,cached_batches:receipt.cachedBatches,kept_draft_units:receipt.keptDraftUnits??0,source_references:receipt.references.length});return result;};
 return runId?measureAILocalStep(runId,"wiki","wiki:revision",work,()=>stats):work();
}

async function reviseChapters(session:FocusSession,sectionIds:string[],originals:ConversationMessage[],instruction:string,ai:AtlasAIProvider,signal:AbortSignal,onProgress?:(done:number,total:number,detail?:WikiRevisionProgress)=>void):Promise<FocusSession>{
 const ids=[...new Set(sectionIds)],zh=session.locale!=="en";
 instruction=wikiRevisionInstruction(instruction,zh);
 if(!ids.length||ids.some(id=>!session.sections.some(section=>section.id===id)))throw new Error(zh?"请选择可调整的 Wiki 章节。":"Select available Wiki chapters.");
 const selected=session.sections.filter(section=>ids.includes(section.id));
 const cache=wikiRevisionCache(ai,signal);
 const prepare=(section:FocusSection,plan?:WikiRewriteContentPlan)=>{
  try{return {section,direct:prepareWikiRewrite(session,section,originals,instruction,ai,signal,plan)};}
  catch(error){if(!(error instanceof WikiRewriteBudgetError))throw error;return {section,contentPlan:plan,batched:prepareWikiRevisionBatches(session,section,originals,instruction,ai,signal,plan)};}
 };
 onProgress?.(0,selected.length,{stage:"preparing"});
 // Build complete coverage before any paid request. Large chapters get bounded
 // jobs instead of rejecting every other selected chapter at a fixed 8k cap.
 let jobs=selected.map(section=>prepare(section));
 signal.throwIfAborted();
 const regroup=selected.filter(section=>editableWikiTopic(section)&&!session.wikiSuggestions?.[section.id]);
 const aliases=new Map<string,string>();
 const moves:NonNullable<FocusSession["wikiContentReview"]>["moves"]=[];
 if(regroup.length>1){
  const preparation=prepareWikiContentPlan(session,regroup,signal,ai,instruction);
  onProgress?.(0,selected.length,{stage:"planning"});
  const plan=await cache.run(preparation.request,preparation.request.validate);signal.throwIfAborted();
  const planned=applyWikiContentPlan(regroup,preparation.topics,plan);
  for(const page of plan.chapters)for(const row of page.topics)for(const id of row.topicIds){const topic=preparation.topics.find(topic=>topic.id===id)!;if(topic.sectionId!==page.id)moves.push({fromId:topic.sectionId,topicTitle:topic.title,toId:page.id});}
  for(const section of regroup.filter(section=>!planned.some(page=>page.id===section.id))){const destination=plan.chapters.find(page=>page.topics.some(row=>row.topicIds.some(id=>preparation.topics.find(topic=>topic.id===id)?.sectionId===section.id)))!;aliases.set(section.id,destination.id);}
  const owners=plan.chapters.map(page=>({id:page.id,title:planned.find(section=>section.id===page.id)!.title,topics:page.topics.map(topic=>topic.title)}));
  jobs=selected.flatMap(original=>{if(aliases.has(original.id))return [];const section=planned.find(page=>page.id===original.id);return [section?prepare(section,{topicIds:plan.chapters.find(page=>page.id===section.id)!.topics.flatMap(topic=>topic.topicIds),outline:section.wikiSubtopics!.map(topic=>topic.title),owners}):prepare(original)];});
 }
 const large=jobs.filter(job=>job.batched);
 if(large.length>1){
  onProgress?.(0,large.length,{stage:"planning"});
  const assignments=await routeWikiRevisionSources(large.map(job=>({section:job.section,sources:job.batched!.sources})),instruction,session.locale??"zh-CN",ai,signal,cache);
  jobs=jobs.map(job=>job.batched?{...job,batched:prepareWikiRevisionBatches(session,job.section,originals,instruction,ai,signal,job.contentPlan,assignments.get(job.section.id))}:job);
 }
 const prepared=jobs.map(job=>({...job,parts:[] as RevisionPart[],cached:0,result:undefined as FocusSection|undefined,references:[] as WikiRevisionReceipt["references"]}));
 const tasks=prepared.flatMap(job=>job.batched?job.batched.batches.map((batch,index)=>async()=>{job.parts[index]=await cache.run(batch.request,batch.request.validate,()=>{job.cached++;});}):[async()=>{job.result=await cache.run(job.direct!,undefined,()=>{job.cached++;});}]);
 let done=0;const batched=prepared.some(job=>job.batched);
 const report=()=>{const detail:WikiRevisionProgress={stage:"writing",cached:prepared.reduce((sum,job)=>sum+job.cached,0)};if(batched)onProgress?.(done,tasks.length,detail);else onProgress?.(done,tasks.length);};report();
 await executeBatches(tasks,{capabilities:{...ai.capabilities,textGeneration:true,structuredOutput:"json",embeddings:false,get maxConcurrency(){return ai.capabilities?.maxConcurrency??1;}}},async work=>{
  signal.throwIfAborted();await work();signal.throwIfAborted();done++;report();
 },signal);
 signal.throwIfAborted();
 if(batched)onProgress?.(done,tasks.length,{stage:"checking",cached:prepared.reduce((sum,job)=>sum+job.cached,0)});
 const patches=prepared.map(job=>{
  if(!job.batched)return {...job.result!,wikiRevisionReceipt:undefined};
  const result=job.batched.assemble(job.parts);job.references=result.references;
  const receipt:WikiRevisionReceipt={version:1,basisSessionId:session.id,batches:job.parts.length,cachedBatches:job.cached,draftUnits:job.batched.draftUnits,sourceUnits:job.batched.sourceUnits,...(job.batched.keptDraftUnits?{keptDraftUnits:job.batched.keptDraftUnits}:{}),references:result.references};
  return {...result.section,wikiRevisionReceipt:receipt};
 });
 const receipt:WikiRevisionReceipt|undefined=batched?{version:1,basisSessionId:session.id,batches:tasks.length,cachedBatches:prepared.reduce((sum,job)=>sum+job.cached,0),draftUnits:prepared.reduce((sum,job)=>sum+(job.batched?.draftUnits??0),0),sourceUnits:prepared.reduce((sum,job)=>sum+(job.batched?.sourceUnits??0),0),...(prepared.some(job=>job.batched?.keptDraftUnits)?{keptDraftUnits:prepared.reduce((sum,job)=>sum+(job.batched?.keptDraftUnits??0),0)}:{}),references:prepared.flatMap(job=>job.references)}:undefined;
 const sections=session.sections.flatMap(section=>aliases.has(section.id)?[]:[patches.find(patch=>patch.id===section.id)??section]);
 const base=aliases.size?remapWikiSectionReferences(session,sections,aliases):{...session,sections};
 const titled=await editWikiSessionTitles({...base,wikiRevisionReceipt:receipt,wikiContentReview:{version:1,basisSessionId:session.id,moves},semanticOverview:undefined,updatedAt:Date.now()},ai,signal,undefined,ids);
 return refreshWikiBrief(titled);
}
