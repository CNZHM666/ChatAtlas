import {getDatabase} from "../storage/db";
import {sourceMessageSignature} from "../shared/source-signature";
import type {DirectoryPage} from "./wiki-directory";

export interface WikiWindowCheckpoint {
 draft?:unknown;
 owners?:Record<string,string>;
 batchSize?:number;
 outputFloor?:number;
 correction?:{reason:"count"|"target"|"slot"};
 result?:unknown;
}
/** accepted: published above the chapter target; a rerun reuses it unchanged. */
export interface WikiConvergenceCheckpoint {pages:DirectoryPage[];stalled:number;revision:number;accepted?:true;/** The merge plan already ran on this exact roster. */mergeTried?:true;mergeVersion?:number}
const providerId="focus-wiki-planning";
async function digest(value:unknown){
 const text=JSON.stringify(value);
 if(globalThis.crypto?.subtle)return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
 return `${text.length}:${sourceMessageSignature(text)}:${sourceMessageSignature([...text].reverse().join(""))}`;
}

/** A resumable task ledger, separate from evictable provider responses. Keys
 * include the provider/policy namespace and exact source/scope inputs.
 * Stored drafts are provisional; callers must revalidate every restored value. */
export function createWikiPlanningCheckpoints(namespace:()=>Promise<string>,signal:AbortSignal){
 let identity:Promise<string>|undefined;
 const key=async(kind:string,input:unknown)=>`wiki-planning-v1:${kind}:${await digest([await(identity??=namespace()),input])}`;
 const read=async<T>(id:string):Promise<T|undefined>=>{
  signal.throwIfAborted();if(!globalThis.indexedDB)return;
  try{const entry=await(await getDatabase()).get("semanticDecisionCache",id);signal.throwIfAborted();return entry?.providerId===providerId?entry.result as T:undefined;}catch(error){signal.throwIfAborted();void error;}
 };
 const write=async<T>(id:string,value:T,merge?:(current:T|undefined,next:T)=>T):Promise<T|undefined>=>{
  signal.throwIfAborted();if(!globalThis.indexedDB)return;
  try{
   const tx=(await getDatabase()).transaction("semanticDecisionCache","readwrite");
   const previous=await tx.store.get(id),current=previous?.providerId===providerId?previous.result as T:undefined;
   const result=merge?merge(current,value):value;
   await tx.store.put({id,taskType:"decision",inputHash:id,analysisVersion:1,providerId,modelId:"",result,createdAt:Date.now()});await tx.done;
   signal.throwIfAborted();return result;
  }catch(error){signal.throwIfAborted();void error;}
 };
 const remove=async(id:string,expected:unknown)=>{
  signal.throwIfAborted();if(!globalThis.indexedDB)return;
  try{
   const tx=(await getDatabase()).transaction("semanticDecisionCache","readwrite"),current=await tx.store.get(id);
   if(current?.providerId===providerId&&JSON.stringify(current.result)===JSON.stringify(expected))await tx.store.delete(id);
   await tx.done;
  }catch(error){signal.throwIfAborted();void error;}
 };
 return {key,read,write,remove,
  saveWindow:(id:string,value:WikiWindowCheckpoint)=>write(id,value,(current,next)=>{
   if(next.result!==undefined)return next;
   if(current?.result!==undefined)return current;
   // Freeze the first repairable draft even if two generation runs overlap.
   if(current?.draft!==undefined&&JSON.stringify(current.draft)!==JSON.stringify(next.draft))return current;
   return {...next,owners:{...next.owners,...current?.owners}};
  }),
 };
}
