import { expect,it } from "vitest";
import { classifyAIRequest,usageFeature } from "./ai-diagnostics";
import { analyzeAILifecycle,aiRequestExport,aiDiagnosticExport } from "./lifecycle-analysis";
import { runAIChainLocalChecks } from "../canvas/ai-chain-local-checks";
import type { AIUsageEvent } from "../shared/types";
import type { OrganizationRun } from "../shared/types";
const event=(id:string,extra:Partial<AIUsageEvent>):AIUsageEvent=>({id,createdAt:5000,taskType:"other",providerId:"fixture",modelId:"fixture",conversationIds:["PRIVATE"],inputTokens:4,outputTokens:2,tokenSource:"provider",attempt:1,status:"completed",...extra});
it("exports directory defect counts without foreign IDs or response text",()=>{
 const directoryValidation={missing:0,duplicate:0,unknown:1,parentMismatch:0,source:"PRIVATE"};
 const output=aiRequestExport([event("directory",{directoryValidation})]);
 expect(output[0].directoryValidation).toEqual({missing:0,duplicate:0,unknown:1,parentMismatch:0});expect(JSON.stringify(output)).not.toContain("PRIVATE");
 expect(aiRequestExport([event("invalid",{directoryValidation:{...directoryValidation,unknown:NaN}})])[0]).not.toHaveProperty("directoryValidation");
});
it("exports safe directory validation paths without private response content",()=>{
 const output=aiRequestExport([event("directory",{errorCode:"PROVIDER_SCHEMA_wiki_directory_identity",validationPaths:["pages[1].sectionIds","PRIVATE SOURCE TEXT","https://private.example"]})]);
 expect(output[0]).toMatchObject({validationPaths:["pages[1].sectionIds"]});expect(JSON.stringify(output)).not.toContain("PRIVATE");
});
it("exports bounded ownership counts without copying response prose or extra metadata",()=>{
 const ownershipValidation={expectedSlots:17,receivedSlots:2,reason:"count" as const,privateResponse:"PRIVATE RESPONSE"};
 const output=aiRequestExport([event("repair",{ownershipValidation})]);
 expect(output[0]).toMatchObject({ownershipValidation:{expectedSlots:17,receivedSlots:2,reason:"count"}});expect(JSON.stringify(output)).not.toContain("PRIVATE");
 expect(aiRequestExport([event("invalid",{ownershipValidation:{...ownershipValidation,receivedSlots:NaN}})])[0]).not.toHaveProperty("ownershipValidation");
});
it("classifies shared other calls by functionality without changing their model routing",()=>{
 expect(classifyAIRequest("other",JSON.stringify({presentation:"product_history",stage:"extract"}))).toEqual({feature:"evolution",operation:"product_history:extract"});
 expect(classifyAIRequest("other",JSON.stringify({presentation:"product_history",analysisKind:"releases"})).feature).toBe("releases");
 expect(classifyAIRequest("focus_session",JSON.stringify({presentation:"project_query"})).feature).toBe("project_query");
 expect(classifyAIRequest("other","PRIVATE_PROMPT",{feature:"knowledge",operation:"knowledge:intent"})).toEqual({feature:"knowledge",operation:"knowledge:intent"});
 expect(usageFeature({taskType:"other",stage:"wiki_topic_plan"})).toBe("wiki");
 expect(usageFeature({taskType:"other",stage:"evolution:subject-recall:v1"})).toBe("evolution");
 expect(classifyAIRequest("other",JSON.stringify({presentation:"knowledge_lint"})).feature).toBe("knowledge");
 expect(usageFeature({taskType:"other",stage:"sidecar_context"})).toBe("context");
});
it("keeps unknown stages unknown and never copies source text into diagnostic classification",()=>{
 expect(classifyAIRequest("other",JSON.stringify({presentation:"PRIVATE MESSAGE",stage:"PRIVATE CONTENT"}))).toEqual({feature:"unclassified",operation:"other"});
});
it("separates concurrent wall time, retries and free cache reuse",()=>{
 const rows=[event("a",{requestStartedAt:1000,durationMs:2000,feature:"evolution",operation:"extract",timing:{queueMs:200,responseMs:1700,validationMs:100}}),event("b",{requestStartedAt:1500,durationMs:2000,feature:"wiki",operation:"write",attempt:2,timing:{backoffMs:500}}),event("reuse",{status:"cached",cacheLayer:"field",inputTokens:0,outputTokens:0,durationMs:0})];
 const data=analyzeAILifecycle(rows);expect(data.requestWallMs).toBe(2500);expect(data.activeMs).toBe(2500);expect(data.durationMs).toBe(4000);expect(data.queueMs).toBe(200);expect(data.backoffMs).toBe(500);expect(data.findings).toContain("retry");
 expect(data.stages.reduce((sum,row)=>sum+row.requests,0)).toBe(2);expect(data.stages.reduce((sum,row)=>sum+row.cached,0)).toBe(1);
});
it("exports only allowed metadata and all builtin diagnostic checks pass without providers",()=>{
 const row={...event("privacy",{}),prompt:"PRIVATE PROMPT",system:"PRIVATE SYSTEM",apiKey:"PRIVATE KEY",title:"PRIVATE TITLE",note:"PRIVATE NOTE"};
 expect(JSON.stringify(aiRequestExport([row]))).not.toContain("PRIVATE");
 expect(runAIChainLocalChecks().filter(check=>!check.passed)).toEqual([]);
});
it("exports local phases with request timings while excluding project content and private annotations",()=>{
 const run={id:"run",title:"PRIVATE TITLE",targetIds:["PRIVATE SOURCE"],notes:"PRIVATE NOTE",startedAt:1,updatedAt:2,pipelineSpans:[{id:"span",feature:"wiki",phase:"source:load",startedAt:1,durationMs:12,status:"completed",result:"PRIVATE CONTENT"}]} as unknown as OrganizationRun;
 const output=aiDiagnosticExport([event("request",{runId:"run"})],[run]);
 expect(output.version).toBe(2);expect(output.runs[0].localPhases?.[0].durationMs).toBe(12);
 expect(JSON.stringify(output)).not.toContain("PRIVATE");
});

it("exports split-recovery ancestry and scheduling time separately from transport queueing",()=>{
 const output=aiRequestExport([event("child",{operationId:"child",parentOperationId:"parent",recoveryDepth:1,recoveryReason:"output_truncation",schedulingMs:15000,queueMs:0})])[0];
 expect(output).toMatchObject({parentOperationId:"parent",recoveryReason:"output_truncation",recoveryDepth:1,schedulingMs:15000,queueMs:0});
});
