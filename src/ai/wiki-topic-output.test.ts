import "fake-indexeddb/auto";
import {beforeEach,expect,it,vi} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {getDatabase} from "../storage/db";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {AIProviderResponseError} from "./provider-errors";
import type {StructuredAIRequest} from "./provider";
import {planWikiTopics,type WikiPlanReceipt} from "./wiki-topic-plan";
import {wikiTopicOutputBudget,readWikiOutputHint} from "./wiki-topic-output";
import {RECOVERY_POLICY} from "./recovery-policy";

const sections=(count:number)=>Array.from({length:count},(_,index)=>({...contextKnowledge().session.sections[0],id:`original-${index}`,title:`主题${index%6}`,body:`机制与条件${index}`,kind:"finding" as const}));
const response=(request:Pick<StructuredAIRequest<unknown>,"prompt">,groups=1)=>{
 const data=JSON.parse(request.prompt),count=Math.min(groups,data.sections.length);
 return {pages:Array.from({length:count},(_,index)=>({title:`主体${index}`,group:"",question:`主体${index}如何运行？`,subtopics:[{key:`t${index}`,title:"具体机制",question:"哪些条件？"}]})),assignments:Object.fromEntries(data.sections.map((item:{id:string},index:number)=>[item.id,`t${index%count}`]))};
};
beforeEach(async()=>{await(await getDatabase()).clear("semanticDecisionCache");});

it("budgets nested directory reconciliation separately while preserving successful leaf cache parameters",()=>{
 const input=sections(12);expect(wikiTopicOutputBudget(input,false,"qwen")).toBe(1800);
 expect(wikiTopicOutputBudget(input,true,"qwen")).toBeGreaterThanOrEqual(3200);
 const nested=input.map(item=>({...item,wikiSubtopics:Array.from({length:4},(_,index)=>({title:`参数${index}`,question:"包含哪些条件和限定？"}))}));
 // Regrouped children count, bounded by eight per requested parent.
 expect(wikiTopicOutputBudget(nested,true,"qwen")).toBeGreaterThan(wikiTopicOutputBudget(input,true,"qwen"));expect(wikiTopicOutputBudget(nested,true,"qwen")).toBeLessThanOrEqual(6000);
 const many=input.map(item=>({...item,wikiSubtopics:Array.from({length:40},(_,index)=>({title:`参数${index}`,question:"条件"}))}));
 expect(wikiTopicOutputBudget(many,true,"qwen",3)).toBe(wikiTopicOutputBudget(many.map(item=>({...item,wikiSubtopics:item.wikiSubtopics.slice(0,2)})),true,"qwen",3));
});

it("allocates enough output for the logged 119-child convergence instead of repeating 3200-token truncations",()=>{
 const input=sections(119).map(item=>({...item,wikiSubtopics:[{title:"章节机制",question:"条件和边界是什么？"}]}));
 expect(wikiTopicOutputBudget(input,true,"qwen")).toBe(6000);
 expect(wikiTopicOutputBudget(input.slice(0,40),true,"qwen",3)).toBeGreaterThanOrEqual(4200);
});

it("increases only a truncated request once and remembers the raised limit for manual retry",async()=>{
 const input=sections(3),prompts:string[]=[],limits:number[]=[],traces:StructuredAIRequest<unknown>["trace"][]=[];let receipt:WikiPlanReceipt|undefined;
 const ai={modelId:"raised-fixture",generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{prompts.push(request.prompt);limits.push(request.maxOutputTokens!);traces.push(request.trace);if(limits.length===1)throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED","limit-1",{outputTokenLimit:1600,receivedCharacters:2000});return request.validate(response(request));}};
 const pages=await planWikiTopics(input,"zh-CN",ai,new AbortController().signal,value=>{receipt=value;});
 expect(limits).toEqual([1600,3200]);expect(prompts[0]).toBe(prompts[1]);expect(traces[1]).toMatchObject({parentOperationId:traces[0]!.operationId,recoveryReason:"output_truncation",recoveryDepth:1});expect(pages[0].sectionIds).toEqual(input.map(item=>item.id));expect(receipt).toMatchObject({requests:2,repairCount:0,outputRecoveryCount:1,outputRecoveryTokens:3200});
 await planWikiTopics(input,"zh-CN",ai,new AbortController().signal);expect(limits).toEqual([1600,3200,3200]);expect(await readWikiOutputHint(prompts[0],"another-model")).toBeUndefined();
});

it("replays 45 notes into 12 directory representatives, recovers the merge, and reuses completed requests on retry",async()=>{
 const input=sections(45),before=structuredClone(input);let leafCalls=0,mergeFailures=0,smallMerges=0;const mergeLimits:number[]=[];
 const provider={id:"directory-logged-shape",modelId:"fixture",testConnection:async()=>({ok:true as const,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt),merge=data.sections.some((item:{subtopics?:unknown[]})=>item.subtopics?.length);
  if(!merge){leafCalls++;return request.validate(response(request,6));}
  if(data.sections.length===12){mergeLimits.push(request.maxOutputTokens!);mergeFailures++;throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED",`merge-${mergeFailures}`,{outputTokenLimit:request.maxOutputTokens!,receivedCharacters:4837});}
  smallMerges++;return request.validate(response(request,2));
 }};
 const ai=createAtlasAIFromProvider(provider,{id:"ai-settings",provider:"openai",model:"fixture",baseUrl:"https://fixture.invalid",apiKey:"fixture",updatedAt:1});const fetch=vi.spyOn(globalThis,"fetch");
 try{
  const run=()=>planWikiTopics(input,"zh-CN",ai,new AbortController().signal);
  const pages=await run();expect(leafCalls).toBe(2);expect(mergeFailures).toBe(2);expect(mergeLimits[0]).toBeGreaterThanOrEqual(3200);expect(mergeLimits[1]).toBeGreaterThan(mergeLimits[0]);expect(smallMerges).toBe(2);
  expect(pages.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());expect(pages.flatMap(page=>page.subtopics!.flatMap(topic=>topic.sectionIds)).sort()).toEqual(input.map(item=>item.id).sort());
  await run();expect(leafCalls).toBe(2);expect(mergeFailures).toBe(2);expect(smallMerges).toBe(2);expect(input).toEqual(before);expect(fetch).not.toHaveBeenCalled();
 }finally{fetch.mockRestore();}
});

it("bounds persistent truncation across all split branches and retains the last real diagnostics",async()=>{
 let calls=0,receipt:WikiPlanReceipt|undefined;
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>):Promise<T>=>{calls++;throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED",`failed-${calls}`,{outputTokenLimit:request.maxOutputTokens!,receivedCharacters:900});}};
 const {truncationAttempts,truncationOutputTokens}=RECOVERY_POLICY.directory;
 const failure=await planWikiTopics(sections(12),"zh-CN",ai,new AbortController().signal,value=>{receipt=value;}).catch(error=>error);
 // The last real request's diagnostics are kept.
 expect(failure).toMatchObject({code:"PROVIDER_OUTPUT_TRUNCATED",requestId:`failed-${calls}`,message:expect.stringContaining("目录规划输出被截断"),outputDiagnostics:{receivedCharacters:900}});
 expect(calls).toBeLessThanOrEqual(truncationAttempts+1);expect(receipt).toMatchObject({reconciled:false,repairCount:0,failureCode:"PROVIDER_OUTPUT_TRUNCATED"});expect(receipt!.outputRecoveryCount).toBeLessThanOrEqual(truncationAttempts);expect(receipt!.outputRecoveryTokens).toBeLessThanOrEqual(truncationOutputTokens);
});

it("never turns missing source ownership into success: only a reply that owns every material is accepted",async()=>{
 let calls=0;const input=sections(3);
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls++;if(calls===1)throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED");const result=response(request);delete result.assignments.m2;return request.validate(result);}};
 // The reply drops m2 twice in a row, so the batch is planned in halves; each half's reply owns all of its materials.
 const result=await planWikiTopics(input,"zh-CN",ai,new AbortController().signal);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());expect(calls).toBeGreaterThan(3);
});

it("honors cancellation immediately after truncation without another request",async()=>{
 let calls=0;const controller=new AbortController();
 const ai={generateStructured:async<T,>():Promise<T>=>{calls++;controller.abort();throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED");}};
 await expect(planWikiTopics(sections(3),"en",ai,controller.signal)).rejects.toThrow();expect(calls).toBe(1);
});

it.each(["PROVIDER_TIMEOUT","PROVIDER_STREAM_INCOMPLETE","PROVIDER_EMPTY_RESPONSE"] as const)("does not use output recovery for %s",async code=>{
 let calls=0;const ai={generateStructured:async<T,>():Promise<T>=>{calls++;throw new AIProviderResponseError(code);}};
 await expect(planWikiTopics(sections(3),"en",ai,new AbortController().signal)).rejects.toMatchObject({code});expect(calls).toBe(1);
});

it("does not pay for splitting a reasoning-only response without text",async()=>{
 let calls=0;const ai={generateStructured:async<T,>():Promise<T>=>{calls++;throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED","thinking-only",{outputTokenLimit:1600,receivedCharacters:0,reasoningTokens:1600});}};
 await expect(planWikiTopics(sections(3),"zh-CN",ai,new AbortController().signal)).rejects.toMatchObject({requestId:"thinking-only",message:expect.stringContaining("思考耗尽")});expect(calls).toBe(1);
});
