import type {CoverageInput} from "./focus-coverage";
import type {StructuredAIRequest} from "./provider";
import {writingPreflightIssue,WikiPreflightError,type WritingPayload} from "./writing-preflight";
import {recordAISkippedStep} from "./pipeline-timing";
import {requestBudget} from "./request-policy";
import {RECOVERY_POLICY} from "./recovery-policy";
import {AIProviderValidationError} from "./provider-errors";

export type WritingAllowance={count:number;tokens:number;transport?:boolean;claims?:boolean};
export interface WritingRecoveryCounters {requests:number;tokens:number}

/** Preflight and all paid recovery reservations share the same bounded ledger. */
export async function writeWikiRequest<T>(input:CoverageInput,batchCount:number,counters:WritingRecoveryCounters,request:StructuredAIRequest<T>,allowance:WritingAllowance,extra:boolean,onCacheHit:()=>void):Promise<T> {
 // A request that cannot produce a valid section is stopped before any paid call.
 const preflight=writingPreflightIssue(JSON.parse(request.prompt) as WritingPayload);
 if(preflight){if(input.runId)await recordAISkippedStep(input.runId,"wiki","wiki:preflight",preflight);const error=new WikiPreflightError(preflight,input.locale==="zh-CN");await input.ai.recordLocalFailure?.(request,error.code);throw error;}
 let reserved=false,cached=false,held=0,used:number|undefined;
 const tokens=Math.min(requestBudget(request,input.modelId).maxOutputTokens,request.maxOutputTokens??Infinity);
 // A request holds its output ceiling while it runs. Once the provider reports
 // usage only the actual output stays charged, failed validations included.
 const hold=(amount:number)=>{allowance.tokens+=amount-held;counters.tokens+=amount-held;held=amount;};
 const reserve=()=>{
   if(!extra)return;
   if(allowance.count>=RECOVERY_POLICY.writing.batchAttempts||allowance.tokens+tokens>RECOVERY_POLICY.writing.batchOutputTokens||counters.requests>=RECOVERY_POLICY.writing.stageRequests(batchCount)||counters.tokens+tokens>RECOVERY_POLICY.writing.stageOutputTokens){
     const error=new AIProviderValidationError("wiki_writing_recovery_limit");
     error.message=input.locale==="zh-CN"?`本轮正文自动恢复已达上限：已恢复 ${counters.requests} 次，已计入 ${counters.tokens}/${RECOVERY_POLICY.writing.stageOutputTokens} 输出 Token（按实际输出结算）；单批恢复 ${allowance.count}/${RECOVERY_POLICY.writing.batchAttempts} 次。本次请求需预留 ${tokens} Token，全轮剩余 ${RECOVERY_POLICY.writing.stageOutputTokens-counters.tokens}，单批剩余 ${RECOVERY_POLICY.writing.batchOutputTokens-allowance.tokens}。此为自动恢复预算，不是账户余额。已完成批次已保留，重试将继续未完成正文。`:`Automatic writing recovery paused after ${counters.requests} requests (${counters.tokens}/${RECOVERY_POLICY.writing.stageOutputTokens} output tokens charged at actual usage; this batch ${allowance.count}/${RECOVERY_POLICY.writing.batchAttempts}). This request needs ${tokens}, with ${RECOVERY_POLICY.writing.stageOutputTokens-counters.tokens} remaining for the stage and ${RECOVERY_POLICY.writing.batchOutputTokens-allowance.tokens} for this batch. This is a recovery budget, not account balance. Completed batches are retained; retry unfinished writing.`;
     throw error;
   }
   allowance.count++;counters.requests++;hold(tokens);reserved=true;
 };
 if(!input.ai.supportsCacheMissGuard)reserve();
 let valid:T;
 try{
   const value=await input.ai.synthesize({...request,signal:input.signal,maxAttempts:extra?1:undefined,beforeRequest:input.ai.supportsCacheMissGuard?reserve:undefined,onCacheHit:()=>{cached=true;onCacheHit();},onUsage:usage=>{used=(used??0)+usage.outputTokens;request.onUsage?.(usage);}});
   input.signal.throwIfAborted();
   valid=request.validate(value);
 }finally{
   // Without a usage report the whole ceiling stays charged.
   if(reserved&&used!==undefined)hold(Math.min(tokens,Math.max(0,used)));
 }
 if(cached&&reserved){allowance.count--;counters.requests--;hold(0);}
 return valid;
}
