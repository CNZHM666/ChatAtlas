import "fake-indexeddb/auto";
import {expect,it} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import type {StructuredAIRequest} from "./provider";
import {AIProviderValidationError} from "./provider-errors";
import {prepareWikiOwnershipRepair} from "./wiki-ownership-repair";
import {validateWikiPlan} from "./wiki-plan-contract";
import {planWikiTopics,type WikiPlanReceipt} from "./wiki-topic-plan";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {synthesizeCoveredFocus} from "./focus-coverage";
import {validateFocusResult} from "./focus-session";
import {transcriptPassages} from "../search/transcript-index";
import type {Conversation} from "../shared/types";

const sections=(size:number)=>Array.from({length:size},(_,index)=>({...contextKnowledge().session.sections[0],id:`m${index}`,title:`材料${index}`,body:`完整原文${index}，-5V 与 5V 条件不同。`,kind:"finding" as const}));
const draft=()=>({scope:[], pages:[
 {title:"同步机制",question:"如何同步？",subtopics:[{title:"增量保存",question:"失败保留哪些条件？",sectionIds:["m0","m1"]},{title:"并发处理",sectionIds:["m2","m1"]}]},
 {title:"权限管理",subtopics:[{title:"原文访问",sectionIds:["m3","m1"]}]},
]});
const prepare=(value:unknown,input=sections(4))=>{
 let failure:unknown;try{validateWikiPlan(value,input);}catch(error){failure=error;}
 expect(failure).toBeInstanceOf(AIProviderValidationError);
 return prepareWikiOwnershipRepair(value,input,failure as AIProviderValidationError);
};

it("locks every unambiguous owner and preserves the original draft while resolving a three-way conflict",()=>{
 const value=draft(),before=structuredClone(value),input=sections(4),repair=prepare(value,input)!;
 expect(repair.slots.map(slot=>[slot.section.id,slot.choices])).toEqual([["m1",["s0","s1","s2"]]]);
 const result=repair.apply({owners:["s2"]});
 expect(result[0].subtopics?.map(topic=>topic.sectionIds)).toEqual([["m0"],["m2"]]);
 expect(result[1].sectionIds).toEqual(["m1","m3"]);
 expect(result[0].subtopics?.[0]).toMatchObject({title:"增量保存",question:"失败保留哪些条件？"});
 expect(value).toEqual(before);expect(repair.apply(["s2"])).toEqual(result);
 expect(result.flatMap(page=>page.subtopics!.flatMap(topic=>topic.sectionIds)).sort()).toEqual(input.map(section=>section.id));
});

it.each([null,{},[],["s0","s1"],{owners:[]},{owners:["s99"]},{owners:[["s0","s1"]]},{owners:[null]},{owners:[{id:"s0"}]}])("rejects malformed, missing, multi-target and invented destinations without choosing a winner: %j",value=>{
 expect(()=>prepare(draft())!.apply(value)).toThrowError(expect.objectContaining({code:expect.stringMatching(/^PROVIDER_SCHEMA_wiki_directory_ownership_/u),fieldPaths:["owners"]}));
});

it("restricts duplicates to their actual competing owners while omitted slots can consider all valid scopes",()=>{
 const value=draft();value.pages[0].subtopics[1].sectionIds=["m2"];
 const repair=prepare(value,sections(5))!;
 expect(repair.slots.map(slot=>[slot.section.id,slot.choices])).toEqual([["m1",["s0","s2"]],["m4",["s0","s1","s2"]]]);
 expect(()=>repair.apply({owners:["s1","s2"]})).toThrow();
 const result=repair.apply({owners:["s2","s1"]});
 expect(result[0].subtopics?.[1].sectionIds).toEqual(["m2","m4"]);
 expect(result[1].sectionIds).toEqual(["m1","m3"]);
});

it("does not repair invalid editorial metadata and treats conflicting parent inventories as explicit choices",()=>{
 for(const change of [
  (value:ReturnType<typeof draft>)=>{value.pages[0].title="";},
  (value:ReturnType<typeof draft>)=>{value.pages[0].subtopics[0]={...value.pages[0].subtopics[0],question:"x".repeat(241)};},
 ]){const value=draft();change(value);expect(prepare(value)).toBeUndefined();}
 const repair=prepare({scope:[], pages:draft().pages.map(page=>({...page,sectionIds:["m0"]}))})!;
 expect(repair.slots.map(slot=>slot.section.id)).toEqual(["m0","m1"]);
 expect(()=>repair.apply({owners:["invented","s0"]})).toThrow();
 expect(repair.apply({owners:["s0","s2"]}).flatMap(page=>page.sectionIds).sort()).toEqual(["m0","m1","m2","m3"]);
});

it("retains shared original citations while enforcing unique writing-unit ownership",()=>{
 const input=sections(4).map(section=>({...section,evidenceIds:["shared-original-message"]})),before=structuredClone(input);
 expect(prepare(draft(),input)!.apply({owners:["s2"]}).flatMap(page=>page.sectionIds).sort()).toEqual(input.map(section=>section.id));
 expect(input).toEqual(before);
});

it("conserves all materials and locks uncontested owners across 120 conflicting directory variants",()=>{
 for(let seed=1;seed<=120;seed++){
  const input=sections(8+seed%25),count=2+seed%5;
  const pages=Array.from({length:count},(_,index)=>({title:`领域${index}`,subtopics:[{title:`机制${index}`,sectionIds:input.filter((_,position)=>position%count===index).map(section=>section.id)}]}));
  for(let index=0;index<Math.min(6,input.length);index++)pages[(index+1)%count].subtopics[0].sectionIds.push(input[index].id);
  if(seed%2===0)for(const page of pages)page.subtopics[0].sectionIds=page.subtopics[0].sectionIds.filter(id=>id!==input.at(-1)!.id);
  const value={scope:[], pages},before=structuredClone(value),repair=prepare(value,input)!;
  const result=repair.apply({owners:repair.slots.map(slot=>slot.choices.at(-1))});
  expect(result.flatMap(page=>page.subtopics!.flatMap(topic=>topic.sectionIds)).sort()).toEqual(input.map(section=>section.id).sort());
  const conflicts=new Set(repair.slots.map(slot=>slot.section.id));
  for(const [index,page] of pages.entries())for(const id of page.subtopics[0].sectionIds)if(!conflicts.has(id))expect(result.find(item=>item.title===`领域${index}`)?.sectionIds).toContain(id);
  expect(value).toEqual(before);expect(validateWikiPlan(result,input)).toEqual(result);
 }
});

it("replays the screenshot signature at 554 materials, resolving four duplicates at both local and global stages",async()=>{
 const input=sections(554).map((item,index)=>({...item,id:`private:${index}`})),before=structuredClone(input);
 let localConflict=false,globalConflict=false,receipt:WikiPlanReceipt|undefined;const repairSizes:number[]=[];
 const ai={capabilities:{maxConcurrency:3},generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){
   repairSizes.push(data.slots.length);expect(data.slots).toHaveLength(4);expect(data.sections).toBeUndefined();
   expect(request.prompt).not.toContain("private:");expect(request.trace).toMatchObject({operation:"wiki:directory:ownership",recoveryReason:"schema"});
   return request.validate({owners:data.slots.map((slot:{choices:string[]})=>slot.choices.at(-1))});
  }
  const count=data.editorialGrouping?7:4;
  const pages=Array.from({length:Math.min(count,data.sections.length)},(_,index)=>({title:`领域${index}`,question:`领域${index}的具体职责`,subtopics:[{title:`机制${index}`,sectionIds:data.sections.filter((_:unknown,position:number)=>position%count===index).map((item:{id:string})=>item.id)}]}));
  if(!data.editorialGrouping&&!localConflict&&data.sections.length>=8||data.editorialGrouping&&!globalConflict){
   if(data.editorialGrouping)globalConflict=true;else localConflict=true;
   const duplicateIds=data.sections.filter((item:{id:string})=>!pages.at(-1)!.subtopics[0].sectionIds.includes(item.id)).slice(0,4).map((item:{id:string})=>item.id);
   pages.at(-1)!.subtopics[0].sectionIds.push(...duplicateIds);
   expect(()=>validateWikiPlan({scope:[], pages},data.sections)).toThrowError(expect.objectContaining({wikiDirectoryDetails:{missingIds:[],duplicateIds,unknownIds:[],parentMismatchIds:[]}}));
  }
  return request.validate({scope:[], pages});
 }};
 const result=await planWikiTopics(input,"zh-CN",ai,new AbortController().signal,value=>{receipt=value;});
 expect(result.length).toBeLessThan(8);expect(repairSizes).toEqual([4,4]);expect(receipt).toMatchObject({repairCount:2,reconciled:true,inputCount:554});
 expect(receipt!.repairTokens).toBeLessThanOrEqual(24000);expect(receipt!.convergenceTokens).toBeLessThanOrEqual(24000);
 expect(result.flatMap(page=>page.subtopics!.flatMap(topic=>topic.sectionIds)).sort()).toEqual(input.map(section=>section.id).sort());expect(input).toEqual(before);
});

it("revalidates already cached repair vectors before binding any source",async()=>{
 let calls=0;
 await expect(planWikiTopics(sections(4),"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;return calls===1?request.validate(draft()):["s999"] as T;
 }},new AbortController().signal)).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_ownership_target"});
 expect(calls).toBe(5);
});

it("does not publish a targeted repair after cancellation",async()=>{
 const controller=new AbortController();let calls=0;
 await expect(planWikiTopics(sections(4),"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;if(calls===1)return request.validate(draft());controller.abort();return request.validate({owners:["s0"]});
 }},controller.signal)).rejects.toMatchObject({name:"AbortError"});expect(calls).toBe(2);
});

it.each([1,3])("repairs every conflicting window and a final omission without starving reconciliation (concurrency %i)",async maxConcurrency=>{
 const input=sections(190),before=structuredClone(input);let repairs=0,windows=0,globalRepairs=0,receipt:WikiPlanReceipt|undefined;
 const result=await planWikiTopics(input,"zh-CN",{capabilities:{maxConcurrency},generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){repairs++;if(data.slots[0].kind==="review")globalRepairs++;return request.validate({owners:data.slots.map((slot:{choices:string[]})=>slot.choices.at(-1))});}
  const ids=data.sections.map((item:{id:string})=>item.id);
  if(data.editorialGrouping)return request.validate({scope:[], pages:[{title:"全局目录",subtopics:[{title:"路由",sectionIds:ids.slice(0,-1)}]}]});
  windows++;
  return request.validate({scope:[], pages:[{title:"保存机制",subtopics:[{title:"增量",sectionIds:ids.slice(0,-1)}]},{title:"访问权限",subtopics:[{title:"来源",sectionIds:[ids[0],ids.at(-1)]}]}]});
 }},new AbortController().signal,value=>{receipt=value;});
 expect(windows).toBeGreaterThan(4);expect(globalRepairs).toBe(1);expect(repairs).toBe(windows+1);
 expect(receipt).toMatchObject({repairCount:repairs,reconciled:true,convergenceCount:2});
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(section=>section.id).sort());expect(input).toEqual(before);
 expect(receipt!.repairTokens).toBeLessThanOrEqual(48000);expect(receipt!.convergenceTokens).toBeLessThanOrEqual(24000);
});

it("continues through reading, targeted ownership and writing using real local caching",async()=>{
 const identity=crypto.randomUUID();let reads=0,repairs=0,writes=0;
 const sources:Conversation[]=Array.from({length:4},(_,index)=>({id:`${identity}:${index}`,title:`模块${index}`,platform:"chatgpt",url:"",messageCount:1,updatedAt:1}));
 const passages=sources.flatMap(source=>transcriptPassages(source,[{id:source.id,conversationId:source.id,role:"user",messageIndex:0,content:"按消息保存检索索引，失败保留原文。",preview:"",contentHash:"",createdAt:1,updatedAt:1}]));
 const ai=createAtlasAIFromProvider({id:`ownership-fixture:${identity}`,modelId:"fixture",testConnection:async()=>({ok:true,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){repairs++;return request.validate({owners:data.slots.map(()=>"s0")});}
  if(data.presentation==="wiki_topic_plan"){
   const ids=data.sections.map((item:{id:string})=>item.id);
   return request.validate({scope:[], pages:[{title:"消息检索",subtopics:[{title:"存储机制",sectionIds:ids},{title:"失败处理",sectionIds:[ids[0]]}]},{title:"访问权限",subtopics:[{title:"原文访问",sectionIds:[ids[0]]}]}]});
  }
  if(!data.coverage.final){reads++;return request.validate({title:"初读",sections:data.passages.map((passage:{id:string},index:number)=>({title:`索引${index}`,body:"按消息维护检索索引，失败保留原文。",kind:"finding",transition:"",evidenceIds:[passage.id]}))});}
  writes++;expect(new Set(data.passages.map((passage:{id:string})=>passage.id)).size).toBe(data.passages.length);
  return request.validate({title:"消息检索",sections:data.wikiTopics.map((topic:{ownerId:string;title:string})=>({title:topic.title,wikiOwnerId:topic.ownerId,body:"## 存储机制\n\n按消息保存检索索引。\n\n## 失败处理\n\n失败时保留原文。",kind:"finding",transition:"",evidenceIds:data.passages.map((passage:{id:string})=>passage.id)}))});
 }},{id:"ai-settings",provider:"openai",model:"fixture",baseUrl:"https://fixture.invalid",apiKey:"fixture",updatedAt:1});
 const run=()=>synthesizeCoveredFocus({goal:"整理检索",mode:"work",locale:"zh-CN",sources,passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 const first=await run(),completedReads=reads,completedWrites=writes;
 expect(first.topicPlanApplied).toBe(true);expect(first.result.sections).toHaveLength(1);expect(repairs).toBe(1);
 const second=await run();expect(second.result.sections).toEqual(first.result.sections);expect(reads).toBe(completedReads);expect(writes).toBe(completedWrites);expect(repairs).toBe(1);
});
