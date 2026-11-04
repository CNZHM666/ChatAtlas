import { getDatabase } from "./db";
import type { ProjectHistoryAnalysis } from "../shared/project-history";

export interface ProjectHistoryTask {
  usage?: {rounds:number;newRequests:number;reusedRequests:number;estimatedInputTokens:number;totalRequests:number;totalEstimatedInputTokens:number};
  reviewDraft?: {updatedAt:number;selection:Record<string,boolean>;edits:Record<string,import("../shared/project-state").ProjectEvolutionEdit>};
  kind?:"releases"|"evolution";
  id: string;
  signature: string;
  cacheNamespace?: string;
  scopeSignature: string;
  status: "pending" | "ready" | "failed";
  results: Record<string, unknown>;
  splitRequests?: string[];
  /** Handled validation failures are checkpoints too; replay them without another provider call. */
  rejectedRequests?: Record<string, string>;
  /** Only rejected extraction/consolidation requests bypass the provider cache on retry. */
  retryRequests?: string[];
  retryFeedback?: Record<string, string>;
  progress?: { done: number; total: number; phase?: string };
  analysis?: ProjectHistoryAnalysis;
  reviewedAnalysisAt?: number;
  updatedAt: number;
}
/** Saved plan revisions retain the same unfinished release work. Replays still validate request/scope identity. */
export const projectHistoryTaskId=(sessionId:string,kind?:"releases"|"evolution")=>`${kind==="evolution"?"evolution":"history"}:${sessionId}`;
export async function readProjectHistoryTask(sessionId:string,previousSessionId?:string,kind?:"releases"|"evolution") {
 const db=await getDatabase(),own=await db.get("projectHistoryTasks",projectHistoryTaskId(sessionId,kind));
 if(own)return own;
 const seen=new Set([sessionId]);let parent=previousSessionId;
 while(parent&&!seen.has(parent)){
  seen.add(parent);const task=await db.get("projectHistoryTasks",projectHistoryTaskId(parent,kind));
  if(task?.kind===(kind??"releases"))return {...task,id:projectHistoryTaskId(sessionId,kind)};
  parent=(await db.get("focusSessions",parent))?.previousSessionId;
 }
}
export const saveProjectHistoryTask = async (task: ProjectHistoryTask) => {
 const db=await getDatabase(),tx=db.transaction("projectHistoryTasks","readwrite"),current=await tx.store.get(task.id);
 const review=current?.reviewDraft&&(!task.reviewDraft||current.reviewDraft.updatedAt>task.reviewDraft.updatedAt)?current.reviewDraft:task.reviewDraft;
 await tx.store.put({...task,...(review?{reviewDraft:review}:{})});await tx.done;
};
/** Patch review state atomically so model checkpoints never erase manual edits. */
export async function saveHistoryReviewDraft(sessionId:string,reviewDraft:NonNullable<ProjectHistoryTask["reviewDraft"]>){
 const db=await getDatabase(),tx=db.transaction("projectHistoryTasks","readwrite"),id=projectHistoryTaskId(sessionId,"evolution"),task=await tx.store.get(id);
 if(task&&(!task.reviewDraft||task.reviewDraft.updatedAt<=reviewDraft.updatedAt))await tx.store.put({...task,reviewDraft});await tx.done;
}
export async function markProjectHistoryReviewed(sessionId:string, generatedAt:number,previousSessionId?:string,kind?:"releases"|"evolution") {
  const inherited=await readProjectHistoryTask(sessionId,previousSessionId,kind);
  const db=await getDatabase(),tx=db.transaction("projectHistoryTasks","readwrite"),task=await tx.store.get(projectHistoryTaskId(sessionId,kind))??inherited;
  if(task?.analysis?.generatedAt===generatedAt) await tx.store.put({...task,reviewedAnalysisAt:generatedAt});
  await tx.done;
}
