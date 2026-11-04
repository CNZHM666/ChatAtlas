import "fake-indexeddb/auto";
import {expect,it} from "vitest";
import {failureOrigin} from "./failure-origin";
import {AIProviderHttpError,AIProviderResponseError,AIProviderValidationError} from "./provider-errors";
import {WikiPreflightError} from "./writing-preflight";
import {aiRetryTiming,createAtlasAIFromProvider} from "./atlas-ai";
import {listAIUsage} from "../storage/ai-usage";
import {analyzeOrganizationRuns,organizationAnalysisCsv} from "./usage-analysis";
import {summarizeAnalysisCsv} from "./organization-benchmark.mjs";
import {writeWikiRequest} from "./wiki-writing-request";
import {vi} from "vitest";

it("distinguishes all four origins and retains unknown/cancellation without guessing",()=>{
 expect(failureOrigin(new WikiPreflightError("empty_roster",true))).toBe("local");
 expect(failureOrigin(new AIProviderValidationError("invalid_json"))).toBe("model");
 expect(failureOrigin(new AIProviderHttpError(429,""))).toBe("provider");
 expect(failureOrigin(new AIProviderResponseError("PROVIDER_RESPONSE_REJECTED"))).toBe("provider");
 expect(failureOrigin(new AIProviderResponseError("PROVIDER_TIMEOUT"))).toBe("network");
 expect(failureOrigin(new AIProviderResponseError("PROVIDER_STREAM_INCOMPLETE"))).toBe("network");
 expect(failureOrigin(new TypeError("fetch failed"))).toBe("network");
 expect(failureOrigin(new Error("unknown"))).toBeUndefined();
 expect(failureOrigin(new DOMException("Cancelled","AbortError"))).toBeUndefined();
 const error=new AIProviderValidationError("wiki_owner_missing_or_unknown");
 expect(failureOrigin(error,JSON.stringify({wikiTopics:[]}))).toBe("local");
 expect(failureOrigin(error,JSON.stringify({wikiTopics:[{ownerId:"a"}]}))).toBe("model");
});

it.each([
 [new AIProviderValidationError("invalid_json"),"model"],
 [new AIProviderHttpError(400,""),"provider"],
 [new AIProviderResponseError("PROVIDER_TIMEOUT"),"network"],
] as const)("persists origin for a real atlas-ai failure: %s",async(error,origin)=>{
 const runId=crypto.randomUUID();
 const ai=createAtlasAIFromProvider({id:"fixture",modelId:"fixture",testConnection:async()=>({ok:true,model:"fixture"}),generateStructured:async()=>{throw error;}},{id:"ai-settings",provider:"openai",model:"fixture",apiKey:"fixture",baseUrl:"https://fixture.invalid",updatedAt:1},undefined,runId);
 await expect(ai.synthesize({taskType:"question_snapshot",system:"Read sources",prompt:'{"id":"'+runId+'"}',validate:value=>value,maxAttempts:1})).rejects.toThrow();
 expect((await listAIUsage()).find(event=>event.runId===runId)).toMatchObject({status:"failed",failureOrigin:origin});
});

it("logs a pre-send rejection once and never calls synthesis",async()=>{
 const synthesize=vi.fn(),recordLocalFailure=vi.fn(async()=>undefined);
 const input={ai:{synthesize,recordLocalFailure},locale:"en",signal:new AbortController().signal} as unknown as Parameters<typeof writeWikiRequest>[0];
 const request={taskType:"focus_session" as const,system:"unchanged",prompt:'{"passages":[]}',validate:()=>({title:"",sections:[]})};
 await expect(writeWikiRequest(input,1,{requests:0,tokens:0},request,{count:0,tokens:0},false,()=>undefined)).rejects.toBeInstanceOf(WikiPreflightError);
 expect(synthesize).not.toHaveBeenCalled();expect(recordLocalFailure).toHaveBeenCalledExactlyOnceWith(request,"WIKI_PREFLIGHT_EMPTY_BATCH");
});

it("records a zero-cost local stop without a provider call or paid request count",async()=>{
 let calls=0;
 const runId=crypto.randomUUID();
 const ai=createAtlasAIFromProvider({id:"fixture",modelId:"fixture",testConnection:async()=>({ok:true,model:"fixture"}),generateStructured:async<T,>()=>{calls++;return {} as T;}},{id:"ai-settings",provider:"openai",model:"fixture",apiKey:"fixture",baseUrl:"https://fixture.invalid",updatedAt:1},undefined,runId);
 await ai.recordLocalFailure!({taskType:"focus_session",prompt:JSON.stringify({coverage:{final:true}})},"WIKI_PREFLIGHT_EMPTY_ROSTER");
 const events=(await listAIUsage()).filter(event=>event.runId===runId);
 expect(calls).toBe(0);expect(events).toHaveLength(1);
 expect(events[0]).toMatchObject({failureOrigin:"local",requestSent:false,costCny:0,inputTokens:0,outputTokens:0});
 const rows=analyzeOrganizationRuns([],events,[]);
 expect(rows[0]).toMatchObject({requests:0,unpricedRequests:0,failuresByOrigin:{local:1,model:0,provider:0,network:0,unknown:0}});
 const summary=summarizeAnalysisCsv(organizationAnalysisCsv(rows));
 expect(summary.requests).toBe(0);expect(summary.failuresByOrigin.local).toBe(1);
});

it("resends once after a connection that failed before any response, but not after a reply started",async()=>{
 const settings={id:"ai-settings" as const,provider:"openai" as const,model:"fixture",apiKey:"fixture",baseUrl:"https://fixture.invalid",updatedAt:1};
 const run=async(failures:number,headers?:number)=>{
  let calls=0;
  const ai=createAtlasAIFromProvider({id:"fixture",modelId:"fixture",testConnection:async()=>({ok:true,model:"fixture"}),generateStructured:async<T,>(request:{onDiagnostics?:(value:{queueMs?:number;responseHeadersMs?:number})=>void})=>{
   // The transport always reports its queue time; headers only once the provider answered.
   calls++;if(calls<=failures){request.onDiagnostics?.({queueMs:0,...(headers===undefined?{}:{responseHeadersMs:headers})});throw new TypeError("Failed to fetch");}return {ok:true} as T;
  }},settings,undefined,crypto.randomUUID());
  const result=ai.synthesize({taskType:"other",system:"Plan",prompt:JSON.stringify({id:crypto.randomUUID()}),validate:value=>value,maxAttempts:1});
  return {result,calls:()=>calls};
 };
 const once=await run(1);
 await expect(once.result).resolves.toEqual({ok:true});expect(once.calls()).toBe(2);
 // Only one quiet resend: a second dropped connection still fails the request.
 const twice=await run(2);await expect(twice.result).rejects.toBeInstanceOf(TypeError);expect(twice.calls()).toBe(2);
 // Headers arrived, so the provider may have started work: no automatic resend.
 const started=await run(1,800);await expect(started.result).rejects.toBeInstanceOf(TypeError);expect(started.calls()).toBe(1);
},15000);

it("resends a no-response connection failure up to the connect timeout, never one with headers or no transport report",async()=>{
 const {networkResendable}=await import("./atlas-ai");
 // Windows ends a connection that never opens at about 21 s.
 expect(networkResendable(new TypeError("Failed to fetch"),{queueMs:0},20_700)).toBe(true);
 expect(networkResendable(new TypeError("Failed to fetch"),{queueMs:0},45_000)).toBe(false);
 expect(networkResendable(new TypeError("Failed to fetch"),{queueMs:0,responseHeadersMs:900},2_000)).toBe(false);
 expect(networkResendable(new TypeError("Failed to fetch"),{},2_000)).toBe(false);
 expect(networkResendable(new Error("Failed to fetch"),{queueMs:0},2_000)).toBe(false);
});

it("resends a request that asks for it up to three times when nothing was produced: no connection, or a busy provider",async()=>{
 aiRetryTiming.scale=0;
 const settings={id:"ai-settings" as const,provider:"openai" as const,model:"fixture",apiKey:"fixture",baseUrl:"https://fixture.invalid",updatedAt:1};
 const run=async(failures:number,error:()=>Error,resendUnsent=true)=>{
  let calls=0;
  const ai=createAtlasAIFromProvider({id:"fixture",modelId:"fixture",testConnection:async()=>({ok:true,model:"fixture"}),generateStructured:async<T,>(request:{onDiagnostics?:(value:{queueMs?:number})=>void})=>{
   calls++;if(calls<=failures){request.onDiagnostics?.({queueMs:0});throw error();}return {ok:true} as T;
  }},settings,undefined,crypto.randomUUID());
  const result=ai.generateStructured({taskType:"other",system:"Plan",prompt:JSON.stringify({id:crypto.randomUUID()}),validate:value=>value,maxAttempts:1,resendUnsent});
  return {result:await result.then(value=>value,(failure:unknown)=>failure),calls};
 };
 const dropped=()=>new TypeError("Failed to fetch"),busy=()=>new AIProviderHttpError(503,"busy");
 expect(await run(3,dropped)).toEqual({result:{ok:true},calls:4});
 const down=await run(4,dropped);expect(down.result).toBeInstanceOf(TypeError);expect(down.calls).toBe(4);
 expect(await run(2,busy)).toEqual({result:{ok:true},calls:3});
 // Without the flag: one resend after a dropped connection, none when busy.
 const plain=await run(2,dropped,false);expect(plain.result).toBeInstanceOf(TypeError);expect(plain.calls).toBe(2);
 const plainBusy=await run(1,busy,false);expect(plainBusy.result).toBeInstanceOf(AIProviderHttpError);expect(plainBusy.calls).toBe(1);
 aiRetryTiming.scale=1;
});
