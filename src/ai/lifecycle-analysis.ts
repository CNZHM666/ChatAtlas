import {isSentUsage} from "./failure-origin";
import type { AIUsageEvent, OrganizationRun } from "../shared/types";
import { usageFeature } from "./ai-diagnostics";

export function intervalUnion(intervals:Array<[number,number]>) {
  let total=0,end=-Infinity;
  for(const [start,stop] of intervals.filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>=a).sort((a,b)=>a[0]-b[0])){total+=Math.max(0,stop-Math.max(start,end));end=Math.max(end,stop);}
  return total;
}
export function analyzeAILifecycle(events:AIUsageEvent[]) {
  const ordered=[...events].sort((a,b)=>(a.requestStartedAt??a.createdAt)-(b.requestStartedAt??b.createdAt));
  const paid=ordered.filter(isSentUsage),timed=paid.filter(event=>event.requestStartedAt!==undefined&&event.durationMs!==undefined);
  const sum=(read:(event:AIUsageEvent)=>number|undefined)=>paid.reduce((total,event)=>total+(read(event)??0),0);
  const stages=new Map<string,{feature:ReturnType<typeof usageFeature>;stage:string;requests:number;cached:number;failed:number;durationMs:number;queueMs:number;responseMs:number;validationMs:number;timed:number;queueTimed:number;validationTimed:number;input:number;output:number;firstTokenMs:number[]}>();
  for(const event of ordered){const feature=usageFeature(event),name=event.operation??event.stage??event.taskType,key=`${feature}:${name}`,row=stages.get(key)??{feature,stage:name,requests:0,cached:0,failed:0,durationMs:0,queueMs:0,responseMs:0,validationMs:0,timed:0,queueTimed:0,validationTimed:0,input:0,output:0,firstTokenMs:[]};
    if(event.status==="cached")row.cached++;else{row.requests+=Number(isSentUsage(event));row.failed+=Number(event.status==="failed");row.durationMs+=event.durationMs??0;row.queueMs+=event.timing?.queueMs??event.queueMs??0;row.responseMs+=event.timing?.responseMs??event.responseMs??0;row.validationMs+=event.timing?.validationMs??0;row.timed+=Number(event.durationMs!==undefined);row.queueTimed+=Number((event.timing?.queueMs??event.queueMs)!==undefined);row.validationTimed+=Number(event.timing?.validationMs!==undefined);row.input+=event.inputTokens;row.output+=event.outputTokens;if(event.firstTokenMs!==undefined)row.firstTokenMs.push(event.firstTokenMs);}stages.set(key,row);
  }
  const first=timed.length?Math.min(...timed.map(event=>event.requestStartedAt!)):undefined;
  const last=timed.length?Math.max(...timed.map(event=>event.requestStartedAt!+event.durationMs!)):undefined;
  const durationMs=sum(event=>event.durationMs),queueMs=sum(event=>event.timing?.queueMs??event.queueMs),responseMs=sum(event=>event.timing?.responseMs??event.responseMs),validationMs=sum(event=>event.timing?.validationMs),backoffMs=sum(event=>event.timing?.backoffMs);
  const findings:Array<"queue"|"first_token"|"validation"|"retry"|"output_limit"|"input"|"missing_timing"|"unclassified">=[];
  if(queueMs>1000&&queueMs>durationMs*.25)findings.push("queue");
  if(paid.some(event=>(event.firstTokenMs??0)>10000))findings.push("first_token");
  if(validationMs>100&&validationMs>durationMs*.1)findings.push("validation");
  if(paid.some(event=>event.attempt>1))findings.push("retry");
  if(paid.some(event=>event.finishReason==="length"))findings.push("output_limit");
  if(paid.some(event=>(event.estimatedInputTokens??event.inputTokens)>8000))findings.push("input");
  if(paid.some(event=>event.durationMs===undefined||!event.timing))findings.push("missing_timing");
  if(ordered.some(event=>usageFeature(event)==="unclassified"))findings.push("unclassified");
  const measurements={queue:paid.filter(event=>(event.timing?.queueMs??event.queueMs)!==undefined).length,response:paid.filter(event=>(event.timing?.responseMs??event.responseMs)!==undefined).length,validation:paid.filter(event=>event.timing?.validationMs!==undefined).length,backoff:paid.filter(event=>event.timing?.backoffMs!==undefined).length};
  return {events:ordered,stages:[...stages.values()].sort((a,b)=>b.durationMs-a.durationMs),durationMs,queueMs,responseMs,validationMs,backoffMs,measurements,
    requestWallMs:first===undefined||last===undefined?undefined:Math.max(0,last-first),activeMs:intervalUnion(timed.map(event=>[event.requestStartedAt!,event.requestStartedAt!+event.durationMs!])),timedRequests:timed.length,findings};
}

/** Safe explicit fields only: never export prompts, API URLs, titles or conversation text. */
function requestTransportExport(events:AIUsageEvent[]) {
  return events.map(event=>({id:event.id,runId:event.runId,feature:usageFeature(event),operation:event.operation??event.stage??event.taskType,operationId:event.operationId,parentOperationId:event.parentOperationId,recoveryReason:event.recoveryReason,recoveryDepth:event.recoveryDepth,schedulingMs:event.schedulingMs,stage:event.stage,taskType:event.taskType,providerId:event.providerId,modelId:event.modelId,createdAt:event.createdAt,requestStartedAt:event.requestStartedAt,durationMs:event.durationMs,timing:event.timing,queueMs:event.queueMs,responseMs:event.responseMs,responseHeadersMs:event.responseHeadersMs,firstTokenMs:event.firstTokenMs,inputTokens:event.inputTokens,outputTokens:event.outputTokens,embeddingTokens:event.embeddingTokens,estimatedInputTokens:event.estimatedInputTokens,tokenSource:event.tokenSource,status:event.status,failureOrigin:event.failureOrigin,requestSent:event.requestSent,attempt:event.attempt,cacheLayer:event.cacheLayer,requestId:event.requestId,errorCode:event.errorCode,finishReason:event.finishReason,timeoutStage:event.timeoutStage,receivedCharacters:event.receivedCharacters,reasoningTokens:event.reasoningTokens,outputTokenLimit:event.outputTokenLimit,costCny:event.costCny}));
}

export function aiRequestExport(events:AIUsageEvent[]) {
 return requestTransportExport(events).map((row,index)=>{
  const paths=events[index].validationPaths?.filter(path=>path.length<=120&&/^[a-zA-Z0-9_.[\]-]+$/u.test(path)).slice(0,24);
  const details=events[index].ownershipValidation;
  const directory=events[index].directoryValidation;
  const directoryValidation=directory&&[directory.missing,directory.duplicate,directory.unknown,directory.parentMismatch].every(count=>Number.isSafeInteger(count)&&count>=0&&count<=100000)?{missing:directory.missing,duplicate:directory.duplicate,unknown:directory.unknown,parentMismatch:directory.parentMismatch}:undefined;
  const safe=details&&[details.expectedSlots,details.receivedSlots].every(value=>Number.isSafeInteger(value)&&value>=0&&value<=100000)&&["count","target","slot"].includes(details.reason)
   ?{expectedSlots:details.expectedSlots,receivedSlots:details.receivedSlots,reason:details.reason}:undefined;
  const claims=events[index].claimValidation?.filter(issue=>/^[a-zA-Z0-9_.[\]-]{1,120}$/u.test(issue.path)&&["array_required","too_many_claims","object_required","required_text","text_too_long","evidence_required","unknown_evidence"].includes(issue.reason)).slice(0,48).map(({path,reason})=>({path,reason}));
  return {...row,...(directoryValidation?{directoryValidation}:{}),...(claims?.length?{claimValidation:claims}:{}),...(paths?.length?{validationPaths:paths}:{}),...(safe?{ownershipValidation:safe}:{})};
 });
}

/** Keep local phase timings alongside requests without exporting project identifiers or content. */
export function aiDiagnosticExport(events:AIUsageEvent[],runs:OrganizationRun[]) {
  return {version:2,exportedAt:new Date().toISOString(),requests:aiRequestExport(events),runs:runs.map(run=>({
    id:run.id,startedAt:run.startedAt,executionStartedAt:run.executionStartedAt,firstReadableAt:run.firstReadableAt,readyAt:run.readyAt,updatedAt:run.updatedAt,diagnosticOnly:run.diagnosticOnly,
    localPhases:run.pipelineSpans?.map(span=>({id:span.id,feature:span.feature,phase:span.phase,startedAt:span.startedAt,durationMs:span.durationMs,status:span.status,reason:span.reason,counts:span.counts?Object.fromEntries(Object.entries(span.counts).filter(([key,value])=>["inputCount","mainCount","requests","repairCount","protectedCount","finalCount"].includes(key)&&Number.isFinite(value))):undefined})),
    projectPhases:run.projectAnalysis?.phases.map(phase=>({phase:phase.phase,startedAt:phase.startedAt,finishedAt:phase.finishedAt,completed:phase.completed,total:phase.total})),
  }))};
}
