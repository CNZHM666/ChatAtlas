import "fake-indexeddb/auto";
import {afterEach,expect,it,vi} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {createAIProvider} from "./provider";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {planWikiTopics} from "./wiki-topic-plan";
import {listAIUsage} from "../storage/ai-usage";
import type {AISettings} from "../shared/types";

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it("recovers invalid ownership IDs through the real Qwen parser and caches only the valid subset",async()=>{
 const settings:AISettings={id:"ai-settings",provider:"qwen",model:"qwen3.7-flash",baseUrl:"https://fixture.invalid/v1",apiKey:"fixture",streaming:false,updatedAt:1};
 const input=Array.from({length:36},(_,index)=>({...contextKnowledge().session.sections[0],id:`private-${index}`,title:`同步条件${index}`,body:`保留独特条件${index}`,kind:"finding" as const}));
 const sizes:number[]=[];
 const fetch=vi.fn(async(_url:unknown,options?:RequestInit)=>{
  const wire=JSON.parse(String(options?.body)),data=JSON.parse(wire.messages.find((message:{role:string})=>message.role==="user").content);
  let output:unknown;
  if(data.stage==="ownership"){
   sizes.push(data.slots.length);
   const pairs=Object.fromEntries(data.slots.map((slot:{id:string;choices:string[]})=>[slot.id,slot.choices.at(-1)]));
   if(data.slots.length===16)output={owners:{...Object.fromEntries(Object.entries(pairs).slice(0,7)),[data.slots[7].id]:"s999",r999:"s0"}};
   else if(data.slots.length===10)output={owners:{[data.slots[0].id]:"s999"}};
   else output={owners:pairs};
  }else{
   const ids=data.sections.map((section:{id:string})=>section.id);
   output={pages:[{title:"同步机制",subtopics:[{title:"保存规则",sectionIds:ids.slice(0,33)}]},{title:"访问权限",subtopics:[{title:"权限条件",sectionIds:[...ids.slice(0,15),ids[33]]}]}]};
  }
  return new Response(JSON.stringify({model:settings.model,choices:[{message:{content:JSON.stringify(output)},finish_reason:"stop"}],usage:{prompt_tokens:100,completion_tokens:20}}),{status:200,headers:{"content-type":"application/json"}});
 });vi.stubGlobal("fetch",fetch);
 const ai=createAtlasAIFromProvider(createAIProvider(settings),settings,undefined,crypto.randomUUID());
 const run=()=>planWikiTopics(input,"zh-CN",ai,new AbortController().signal);
 const first=await run();expect(first.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(section=>section.id).sort());expect(sizes).toEqual([16,10,5,5]);expect(fetch).toHaveBeenCalledTimes(5);
 expect(await run()).toEqual(first);
 // The completed window is checkpointed, including its locally repaired result.
 // Neither rejected drafts nor invalid repair replies are generated again.
 expect(sizes).toEqual([16,10,5,5]);expect(fetch).toHaveBeenCalledTimes(5);
});

it("runs the Qwen JSON transport, parser, partial ownership validation and cache without a paid service",async()=>{
 const settings:AISettings={id:"ai-settings",provider:"qwen",model:"qwen3.7-flash",baseUrl:"https://fixture.invalid/v1",apiKey:"fixture",streaming:false,updatedAt:1};
 const input=Array.from({length:36},(_,index)=>({...contextKnowledge().session.sections[0],id:`source-private-${index}`,title:`索引条件${index}`,body:`保存规则和失败恢复${index}`,kind:"finding" as const}));
 const sent:Array<{stage?:string;expectedSlotIds?:string[];expectedCount?:number}>=[];
 const fetch=vi.fn(async(_url:unknown,options?:RequestInit)=>{
  const wire=JSON.parse(String(options?.body)),messages=wire.messages as Array<{role:string;content:string}>;
  const data=JSON.parse(messages.find(message=>message.role==="user")!.content);sent.push(data);
  let output:unknown;
  if(data.stage==="ownership"){
   expect(messages[0].content).toContain("expectedSlotIds is the COMPLETE list");
   expect(data.expectedCount).toBe(data.slots.length);
   const slot=data.slots.at(-1);output={owners:{[slot.id]:slot.choices.at(-1)}};
  }else{
   expect(data.version).toBe(13);const ids=data.sections.map((section:{id:string})=>section.id);
   output={pages:[{title:"索引机制",subtopics:[{title:"保存流程",sectionIds:ids.slice(0,-2)},{title:"失败恢复",sectionIds:ids.slice(0,15)}]}]};
  }
  return new Response(JSON.stringify({id:`fixture-${sent.length}`,model:settings.model,choices:[{message:{content:JSON.stringify(output)},finish_reason:"stop"}],usage:{prompt_tokens:100,completion_tokens:20}}),{status:200,headers:{"content-type":"application/json"}});
 });vi.stubGlobal("fetch",fetch);
 const runId=crypto.randomUUID(),ai=createAtlasAIFromProvider(createAIProvider(settings),settings,undefined,runId);
 const run=()=>planWikiTopics(input,"zh-CN",ai,new AbortController().signal);
 const first=await run();expect(first[0].sectionIds).toEqual(input.map(section=>section.id));
 expect(sent.filter(data=>data.stage==="ownership").map(data=>data.expectedSlotIds)).toEqual([["r0","r1"],["r0"]]);
 const usage=(await listAIUsage()).filter(event=>event.runId===runId);
 expect(usage.filter(event=>event.status==="failed")).toHaveLength(1);expect(usage.some(event=>event.errorCode==="PROVIDER_SCHEMA_wiki_directory_coverage")).toBe(true);
 expect(await run()).toEqual(first);
 // The validated repaired directory is restored without any transport request.
 expect(fetch).toHaveBeenCalledTimes(3);
});
