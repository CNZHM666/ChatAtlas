import { classifyAIRequest } from "../ai/ai-diagnostics";
import { analyzeAILifecycle,aiRequestExport,intervalUnion } from "../ai/lifecycle-analysis";
import type { AIUsageEvent,AITaskType } from "../shared/types";
import type { ProjectLocalCheck } from "./project-local-checks";

export function runAIChainLocalChecks():ProjectLocalCheck[] {
  const cases:Array<[string,string,()=>boolean]>=[];
  const features:Array<[string,string,AITaskType]>=[
    ["sidecar_context","context","other"],["knowledge_lint","knowledge","other"],
    ["product_history","evolution","other"],["wiki_topic_plan","wiki","other"],["project_state","project_state","other"],
    ["project_query","project_query","focus_session"],["home_task_plan","history_search","other"],["semantic_structure","project_state","other"],
    ["wiki_claim_verification","wiki","other"],["","embedding","embedding"],["","conversation","question_snapshot"],
    ["","knowledge","relation_judge"],["","source_retrieval","source_retrieval"]
  ];
  for(const [presentation,feature,task] of features)cases.push([`AI:classify:${feature}:${presentation||task}`,`${feature} 功能链路分类`,()=>classifyAIRequest(task,JSON.stringify({presentation})).feature===feature]);
  const event=(id:string,extra:Partial<AIUsageEvent>):AIUsageEvent=>({id,createdAt:2000,runId:"isolated",taskType:"other",feature:"evolution",operation:"history:extract",providerId:"fixture",modelId:"fixture",conversationIds:[],inputTokens:10,outputTokens:5,tokenSource:"provider",status:"completed",attempt:1,requestStartedAt:1000,durationMs:1000,...extra});
  cases.push(["AI:parallel","并发墙钟不累加",()=>intervalUnion([[1000,2000],[1500,2500]])===1500]);
  cases.push(["AI:unknown","旧日志未知耗时不伪造",()=>analyzeAILifecycle([event("old",{durationMs:undefined,timing:undefined})]).findings.includes("missing_timing")]);
  cases.push(["AI:cache","缓存不会成为新请求或新 Token",()=>{const row=analyzeAILifecycle([event("cached",{status:"cached",inputTokens:0,outputTokens:0,durationMs:0,cacheLayer:"checkpoint"})]).stages[0];return row.requests===0&&row.cached===1&&row.input===0;}]);
  cases.push(["AI:privacy","导出不包含原文和凭据",()=>{const row={...event("privacy",{}),prompt:"PRIVATE_PROMPT",apiKey:"PRIVATE_KEY",title:"PRIVATE_TITLE",conversationIds:["PRIVATE_CONVERSATION"]};const text=JSON.stringify(aiRequestExport([row]));return !text.includes("PRIVATE_");}]);
  cases.push(["AI:bottleneck","排队瓶颈与输出截断可诊断",()=>{const row=analyzeAILifecycle([event("queue",{timing:{queueMs:5000},durationMs:6000,finishReason:"length"})]);return row.findings.includes("queue")&&row.findings.includes("output_limit");}]);
  cases.push(["AI:recovery","恢复请求保留父操作与拆分原因",()=>{const row=aiRequestExport([event("child",{operationId:"child",parentOperationId:"parent",recoveryDepth:1,recoveryReason:"output_truncation"})])[0];return row.parentOperationId==="parent"&&row.recoveryReason==="output_truncation"&&row.recoveryDepth===1;}]);
  cases.push(["AI:scheduling","批次调度与服务排队分别记录",()=>{const row=aiRequestExport([event("later",{schedulingMs:12000,queueMs:0})])[0];return row.schedulingMs===12000&&row.queueMs===0;}]);
  return cases.map(([id,title,run])=>{const start=performance.now();try{if(!run())throw Error("本地契约不成立");return {id,title,passed:true,durationMs:performance.now()-start,detail:"仅本地分类、计时与导出检查；未调用模型"};}catch(error){return {id,title,passed:false,durationMs:performance.now()-start,detail:error instanceof Error?error.message:String(error)};}});
}
