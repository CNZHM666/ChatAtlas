import {expect,it} from "vitest";
import {trimWikiClaimOverflow} from "./wiki-claim-repair";
import {requestBudget,validateProviderOutput} from "./request-policy";
import {writeWikiRequest,type WritingRecoveryCounters} from "./wiki-writing-request";
import {RECOVERY_POLICY} from "./recovery-policy";
import {WIKI_COMPOSITION_INSTRUCTIONS} from "./wiki-composition-instructions";
import {MAX_WIKI_SECTION_CLAIMS} from "../shared/wiki-claims";
import type {CoverageInput} from "./focus-coverage";
import type {StructuredAIRequest} from "./provider";

const quote="只有用户确认后才保存。";
const claim=(index:number,extra:Record<string,unknown>={})=>({text:`结论 ${index}`,quote,evidenceIds:["e1"],...extra});
const section=(claims:unknown[])=>({title:"保存",body:"ARTICLE_PROSE 必须完整保留。",transition:"",kind:"finding",wikiOwnerId:"owner",evidenceIds:["e1","e2"],claims});

it("keeps well-formed, overview-tagged and new-evidence claims in their original order",()=>{
 const claims=[
  ...Array.from({length:12},(_,index)=>claim(index)),
  claim(12,{overviewRole:"purpose"}),
  claim(13,{evidenceIds:["e2"]}),
  {text:"缺少引文",quote:"",evidenceIds:["e1"]},
 ];
 const value={title:"保存",sections:[section(claims)]};
 const trimmed=trimWikiClaimOverflow(value);
 const kept=trimmed.sections[0].claims as Array<{text:string}>;
 expect(kept).toHaveLength(MAX_WIKI_SECTION_CLAIMS);
 expect(kept.map(item=>item.text)).toEqual([...Array.from({length:10},(_,index)=>`结论 ${index}`),"结论 12","结论 13"]);
 expect(trimmed.sections[0].body).toBe(value.sections[0].body);
 expect(value.sections[0].claims).toHaveLength(15);
});

it("returns values within the limit unchanged and trims a wrapped result",()=>{
 const within={title:"保存",sections:[section(Array.from({length:12},(_,index)=>claim(index)))]};
 expect(trimWikiClaimOverflow(within)).toBe(within);
 const wrapped=trimWikiClaimOverflow({result:{title:"保存",sections:[section(Array.from({length:14},(_,index)=>claim(index)))]}});
 expect(wrapped.result.sections[0].claims).toHaveLength(MAX_WIKI_SECTION_CLAIMS);
});

it("accepts an overlong claim list on the real provider wire instead of rejecting the batch",()=>{
 const request={taskType:"focus_session" as const,system:"Compose",prompt:JSON.stringify({intent:"保存",mode:"work",strategy:"work",locale:"zh-CN",coverage:{final:true,stage:"synthesis"},passages:[{id:"material-long",text:quote,wikiOwnerId:"owner"}],wikiTopics:[{ownerId:"owner",title:"保存"}]}),validate:(value:unknown)=>value};
 const value=validateProviderOutput(request,{title:"保存",sections:[{...section(Array.from({length:20},(_,index)=>claim(index))),evidenceIds:["e1"]}]}) as {sections:Array<{claims:unknown[]}>};
 expect(value.sections[0].claims).toHaveLength(MAX_WIKI_SECTION_CLAIMS);
 expect(JSON.stringify(value)).toContain("material-long");
});

it("states the claim limit in the current writing policy",()=>{
 expect(WIKI_COMPOSITION_INSTRUCTIONS).toContain(`At most ${MAX_WIKI_SECTION_CLAIMS} claims per section`);
});

const writing=(usage:number|undefined,valid=true)=>{
 const prompt=JSON.stringify({passages:[{id:"e1",wikiOwnerId:"owner"}],wikiTopics:[{ownerId:"owner"}]});
 const request:StructuredAIRequest<string>={taskType:"focus_session",system:"Compose",prompt,maxOutputTokens:5000,validate:value=>{if(!valid)throw new Error("invalid");return value as string;}};
 const input={locale:"zh-CN",modelId:"fixture",signal:new AbortController().signal,ai:{supportsCacheMissGuard:true,synthesize:async<T,>(next:StructuredAIRequest<T>)=>{
  next.beforeRequest?.();
  if(usage!==undefined)next.onUsage?.({inputTokens:100,outputTokens:usage});
  return "ok" as T;
 }}} as unknown as CoverageInput;
 return {input,request};
};
const ceiling=Math.min(requestBudget(writing(undefined).request,"fixture").maxOutputTokens,5000);

it("charges writing recovery with the provider-reported output, including failed validations",async()=>{
 const counters:WritingRecoveryCounters={requests:0,tokens:0},allowance={count:0,tokens:0};
 const ok=writing(500);
 await expect(writeWikiRequest(ok.input,4,counters,ok.request,allowance,true,()=>{})).resolves.toBe("ok");
 const failed=writing(700,false);
 await expect(writeWikiRequest(failed.input,4,counters,failed.request,allowance,true,()=>{})).rejects.toThrow("invalid");
 expect(counters).toEqual({requests:2,tokens:1200});
 expect(allowance).toEqual({count:2,tokens:1200});
});

it("keeps the whole ceiling charged when no usage is reported and never charges above it",async()=>{
 const counters:WritingRecoveryCounters={requests:0,tokens:0},allowance={count:0,tokens:0};
 const silent=writing(undefined);
 await writeWikiRequest(silent.input,4,counters,silent.request,allowance,true,()=>{});
 const verbose=writing(ceiling+5000);
 await writeWikiRequest(verbose.input,4,counters,verbose.request,allowance,true,()=>{});
 expect(counters.tokens).toBe(2*ceiling);expect(allowance.tokens).toBe(2*ceiling);
});

it("lets typical recoveries run past the stop that ceiling reservations imposed",async()=>{
 // The reported run used ~35% of each output ceiling and stopped once reserved ceilings filled the stage budget.
 const counters:WritingRecoveryCounters={requests:0,tokens:0},limit=RECOVERY_POLICY.writing.stageRequests(18),used=Math.floor(ceiling*.35);
 for(let index=0;index<limit;index++){
  const next=writing(used);
  await writeWikiRequest(next.input,18,counters,next.request,{count:0,tokens:0},true,()=>{});
 }
 expect(limit).toBeGreaterThan(Math.floor(RECOVERY_POLICY.writing.stageOutputTokens/ceiling));
 expect(counters).toEqual({requests:limit,tokens:limit*used});
});
