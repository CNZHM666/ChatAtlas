import type { AIFeature } from "./ai-diagnostics";
import { aiFeatureLabel } from "./ai-diagnostics";
import { getDatabase } from "../storage/db";

export async function startAIRun(runId:string,feature:AIFeature,targetIds:string[]):Promise<void>{
  try{const db=await getDatabase(),tx=db.transaction("organizationRuns","readwrite"),existing=await tx.store.get(runId),now=Date.now();
    await tx.store.put(existing?{...existing,executionStartedAt:existing.executionStartedAt??now,targetIds:existing.targetIds.length?existing.targetIds:targetIds}:{id:runId,title:aiFeatureLabel(feature,true),diagnosticOnly:true,targetType:"conversation",targetIds,startedAt:now,executionStartedAt:now,updatedAt:now,status:"running",stage:"preparing",progress:0,events:[]});await tx.done;
  }catch{/* Diagnostic only. */}
}

export async function markAIFirstReadable(runId:string):Promise<void>{
  try{const db=await getDatabase(),tx=db.transaction("organizationRuns","readwrite"),run=await tx.store.get(runId);if(run)await tx.store.put({...run,executionStartedAt:run.executionStartedAt??run.startedAt,firstReadableAt:run.firstReadableAt??Date.now()});await tx.done;}catch{/* Diagnostic only. */}
}

export async function recordAISkippedStep(runId:string,feature:AIFeature,phase:string,reason:string):Promise<void>{
  try{const db=await getDatabase(),tx=db.transaction("organizationRuns","readwrite"),run=await tx.store.get(runId);if(run)await tx.store.put({...run,pipelineSpans:[...run.pipelineSpans??[],{id:crypto.randomUUID(),feature,phase,startedAt:Date.now(),durationMs:0,status:"skipped",reason}]});await tx.done;}catch{/* Diagnostic only. */}
}

/** Existing run store, metadata only. Instrumentation failures never retry the work. */
export async function measureAILocalStep<T>(runId:string,feature:AIFeature,phase:string,work:()=>T|Promise<T>,counts?:()=>Record<string,number>,since?:{monotonic:number;startedAt:number}):Promise<T> {
  const start=since?.monotonic??performance.now(),startedAt=since?.startedAt??Date.now();let status:"completed"|"failed"="failed";
  let reason:string|undefined;
  try{const result=await work();status="completed";return result;}
  catch(error){if(error&&typeof error==="object"&&"code" in error&&typeof error.code==="string"&&/^[A-Z_a-z0-9]{1,100}$/u.test(error.code))reason=error.code;throw error;}
  finally{
    try{const span={id:crypto.randomUUID(),feature,phase,startedAt,durationMs:Math.max(0,Math.round(performance.now()-start)),status,reason,...(counts?{counts:counts()}:{})};
    const db=await getDatabase(),tx=db.transaction("organizationRuns","readwrite"),existing=await tx.store.get(runId);
      const run=existing??{id:runId,title:`${aiFeatureLabel(feature,true)} / ${aiFeatureLabel(feature,false)}`,diagnosticOnly:true,targetType:"conversation" as const,targetIds:[],startedAt,updatedAt:Date.now(),status:"completed" as const,stage:"proposal_ready" as const,progress:100,events:[]};
      await tx.store.put({...run,pipelineSpans:[...(run.pipelineSpans??[]),span],updatedAt:Date.now()});await tx.done;
    }catch{/* No paid work or business result may depend on diagnostics storage. */}
  }
}
