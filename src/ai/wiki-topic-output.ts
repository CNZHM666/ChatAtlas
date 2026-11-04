import type {FocusSection} from "../shared/focus-session";
import {estimateTokens} from "../shared/atlas/policy.js";
import {sourceMessageSignature} from "../shared/source-signature";
import {getDatabase} from "../storage/db";
import {MAX_WIKI_MAIN_CHAPTERS} from "./wiki-outline-policy";

export const MAX_WIKI_DIRECTORY_OUTPUT=6000;
export interface WikiOutputHint {limit:number;split?:boolean}

/** Leaf budgets remain stable. Global routing groups candidate scopes;
 * full source inventories are restored locally rather than regenerated. */
export function wikiTopicOutputBudget(items:FocusSection[],compact:boolean,modelId?:string,target=MAX_WIKI_MAIN_CHAPTERS):number {
 // Global requests name a few substantial children per parent. Budget for the
 // requested parents, their regrouped children (up to eight each, never more
 // than the candidates' own subtopics) and every candidate ID once.
 if(compact){
  const parents=Math.min(target,items.length),children=Math.min(items.reduce((sum,item)=>sum+Math.max(1,item.wikiSubtopics?.length??0),0),parents*8);
  // Titles, questions and ownership routes all consume output. The former
  // 35-token child estimate repeatedly clipped valid 4k+ directory responses.
  return Math.min(MAX_WIKI_DIRECTORY_OUTPUT,Math.max(3200,Math.ceil((1000+items.length*16+parents*100+children*100)/100)*100));
 }
 const legacy=Math.min(MAX_WIKI_DIRECTORY_OUTPUT,Math.max(1600,items.length*150));
 if(!compact&&!items.some(item=>item.wikiSubtopics?.length))return legacy;
 const children=items.reduce((sum,item)=>sum+Math.max(1,item.wikiSubtopics?.length??0),0);
 const metadata=items.map(item=>({title:item.title,question:item.wikiQuestion,subtopics:item.wikiSubtopics}));
 const estimate=1200+items.length*50+children*120+Math.min(1600,estimateTokens(metadata,modelId)*.35);
 return Math.min(MAX_WIKI_DIRECTORY_OUTPUT,Math.max(legacy,3200,Math.ceil(estimate/100)*100));
}

async function hintKey(prompt:string,modelId:string){
 const digest=globalThis.crypto?.subtle?[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(prompt)))].map(byte=>byte.toString(16).padStart(2,"0")).join(""):sourceMessageSignature(prompt)+sourceMessageSignature([...prompt].reverse().join(""));
 return `wiki-output-hint-v1:${modelId}:${digest}`;
}
export async function readWikiOutputHint(prompt:string,modelId=""):Promise<WikiOutputHint|undefined>{
 if(!globalThis.indexedDB)return;
 try{
  const entry=await(await getDatabase()).get("semanticDecisionCache",await hintKey(prompt,modelId)),hint=entry?.result as Partial<WikiOutputHint>|undefined;
  if(hint&&Number.isInteger(hint.limit)&&hint.limit!>=1600&&hint.limit!<=MAX_WIKI_DIRECTORY_OUTPUT)return {limit:hint.limit!,...(hint.split===true?{split:true}:{})};
 }catch{/* Local hints are optional, never a reason to repeat a paid request. */}
}
/** Store only a bounded recovery strategy, never a truncated directory or raw prompt. */
export async function rememberWikiOutputHint(prompt:string,modelId:string|undefined,hint:WikiOutputHint):Promise<void>{
 if(!globalThis.indexedDB)return;
 try{
  const id=await hintKey(prompt,modelId??""),db=await getDatabase(),tx=db.transaction("semanticDecisionCache","readwrite");
  const previous=(await tx.store.get(id))?.result as Partial<WikiOutputHint>|undefined;
  const limit=Math.min(MAX_WIKI_DIRECTORY_OUTPUT,Math.max(1600,hint.limit,Number.isInteger(previous?.limit)?previous!.limit!:0));
  await tx.store.put({id,taskType:"synthesis",inputHash:id,analysisVersion:1,providerId:"wiki-output-recovery",modelId:modelId??"",result:{limit,...(hint.split||previous?.split?{split:true}:{})},createdAt:Date.now()});await tx.done;
 }catch{/* Continue with the in-memory bound if local storage is unavailable. */}
}
