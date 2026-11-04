import "fake-indexeddb/auto";
import {beforeEach,expect,it} from "vitest";
import {getDatabase} from "../storage/db";
import {contextKnowledge} from "../test/context-fixture";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {planWikiTopics,createWikiTopicPlanner,type WikiPlanReceipt} from "./wiki-topic-plan";
import type {AtlasAIProvider,StructuredAIRequest} from "./provider";

const sections=(size:number)=>Array.from({length:size},(_,index)=>({...contextKnowledge().session.sections[0],id:`original-${index}`,title:`材料${index}`,body:`独特条件${index}，失败时保留原文。`,kind:"finding" as const}));
const settings={id:"ai-settings" as const,provider:"openai" as const,model:"fixture",baseUrl:"https://fixture.invalid",apiKey:"fixture",updatedAt:1};
const provider=(generateStructured:AtlasAIProvider["generateStructured"]):AtlasAIProvider=>({id:crypto.randomUUID(),modelId:"fixture",testConnection:async()=>({ok:true,model:"fixture"}),generateStructured});
const removeResponseCache=async()=>{const db=await getDatabase();for(const row of await db.getAll("semanticDecisionCache"))if(row.providerId!=="focus-wiki-planning")await db.delete("semanticDecisionCache",row.id);};
beforeEach(async()=>{await(await getDatabase()).clear("semanticDecisionCache");});

it("freezes a drifting draft and finishes partial assignments across recreated clients even after response-cache eviction",async()=>{
 let drafts=0,repairs=0;const requested:string[][]=[],confirmed:number[]=[];
 const raw=provider(async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){
   repairs++;requested.push(data.expectedSlotIds);const slot=data.slots[0];return request.validate({owners:{[slot.id]:slot.choices[0]}});
  }
  drafts++;const ids=data.sections.map((item:{id:string})=>item.id);
  return request.validate({scope:[],pages:[{title:"同步机制",question:`每次生成变化的范围说明${drafts}`,subtopics:[{title:"完整条件",sectionIds:ids}]},{title:"访问管理",subtopics:[{title:"访问约束",sectionIds:ids.slice(0,17)}]}]});
 });
 const input=sections(36);let result:Awaited<ReturnType<typeof planWikiTopics>>|undefined;
 for(let attempt=0;attempt<5;attempt++){
  const ai=createAtlasAIFromProvider(raw,settings);
  try{result=await planWikiTopics(input,"zh-CN",ai,new AbortController().signal);}catch(error){
   expect(error).toMatchObject({wikiPlanningResume:{phase:"ownership",reason:"budget"},message:expect.stringContaining("从这里继续")});
   confirmed.push((error as {wikiOwnershipDetails:{receivedSlots:number}}).wikiOwnershipDetails.receivedSlots);
  }
  await removeResponseCache();
 }
 expect(confirmed).toEqual([4,8,12,16]);expect(drafts).toBe(1);expect(repairs).toBe(17);
 expect(requested.map(ids=>ids[0])).toEqual(Array.from({length:17},(_,index)=>`r${index}`));
 expect(result!.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
 const again=await planWikiTopics(input,"zh-CN",createAtlasAIFromProvider(raw,settings),new AbortController().signal);
 expect(again).toEqual(result);expect(drafts).toBe(1);expect(repairs).toBe(17);
});

it("continues convergence from 18 candidates on the next run and keeps the accepted directory without new requests",async()=>{
 let reads=0;const starts:number[]=[],receipts:WikiPlanReceipt[]=[];
 const raw=provider(async<T,>(request:StructuredAIRequest<T>)=>{
  // No merge proposal: resuming the regrouping rounds is under test.
  if(JSON.parse(request.prompt).presentation==="wiki_chapter_merge")return request.validate({groups:[]});
  const data=JSON.parse(request.prompt);if(data.convergence)starts.push(data.sections.length);else reads++;
  const count=data.sections.length-(data.convergence?1:0);
  return request.validate({scope:[],pages:Array.from({length:count},(_,index)=>({title:`主题${index}`,subtopics:[{title:"独特条件",sectionIds:data.sections.filter((_:unknown,position:number)=>position%count===index).map((item:{id:string})=>item.id)}]}))});
 });
 const input=sections(22);let result:Awaited<ReturnType<typeof planWikiTopics>>|undefined;
 for(let attempt=0;attempt<4;attempt++){
  try{result=await planWikiTopics(input,"zh-CN",createAtlasAIFromProvider(raw,settings),new AbortController().signal,receipt=>receipts.push(receipt));}catch(error){expect(attempt).toBe(0);expect(error).toMatchObject({wikiPlanningResume:{phase:"convergence",reason:"budget",remaining:18}});}
  await removeResponseCache();
 }
 // 18 is above the accept limit and fails; the next run reaches 14 and publishes it.
 expect(starts).toEqual(Array.from({length:8},(_,index)=>22-index));expect(reads).toBe(1);
 expect(receipts.map(receipt=>receipt.convergenceCount)).toEqual([4,4,0,0]);
 expect(receipts.every(receipt=>receipt.convergenceTokens!<=24000)).toBe(true);
 expect(result).toHaveLength(14);expect(result!.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
});

it("continues 554 materials past the shared repair ceiling without regenerating completed or unresolved drafts",async()=>{
 const input=sections(554);let drafts=0;const receipts:WikiPlanReceipt[]=[];
 const raw=provider(async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership")return request.validate({owners:Object.fromEntries(data.slots.map((slot:{id:string;choices:string[]})=>[slot.id,slot.choices[0]]))});
  const ids=data.sections.map((item:{id:string})=>item.id);
  if(data.editorialGrouping)return request.validate({scope:[],pages:[{title:"材料机制",subtopics:[{title:"完整条件",sectionIds:ids}]}]});
  drafts++;
  return request.validate({scope:[],pages:[{title:"材料机制",subtopics:[{title:"完整条件",sectionIds:ids}]},{title:"访问条件",subtopics:[{title:"访问约束",sectionIds:ids.slice(0,17)}]}]});
 });
 const run=()=>planWikiTopics(input,"zh-CN",createAtlasAIFromProvider(raw,settings),new AbortController().signal,receipt=>receipts.push(receipt));
 await expect(run()).rejects.toMatchObject({wikiPlanningResume:{phase:"ownership",reason:"budget"}});
 await removeResponseCache();
 const result=await run();
 expect(drafts).toBe(16);expect(receipts.every(receipt=>receipt.repairTokens!<=24000&&receipt.repairCount<=30)).toBe(true);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
});

it("invalidates provisional ownership for changed sources, user scope, locale or provider namespace",async()=>{
 let drafts=0;
 const raw=provider(async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){const slot=data.slots[0];return request.validate({owners:{[slot.id]:slot.choices[0]}});}
  drafts++;const ids=data.sections.map((item:{id:string})=>item.id);
  return request.validate({scope:[],pages:[{title:"同步机制",subtopics:[{title:"完整条件",sectionIds:ids}]},{title:"访问条件",subtopics:[{title:"访问约束",sectionIds:ids.slice(0,17)}]}]});
 });
 const input=sections(36);
 const run=async(items=input,locale="zh-CN",goal="整理同步",endpoint=settings.baseUrl)=>{
  const planner=createWikiTopicPlanner(locale,createAtlasAIFromProvider(raw,{...settings,baseUrl:endpoint}),new AbortController().signal,undefined,{goal});planner.append(items);
  await expect(planner.finish()).rejects.toMatchObject({wikiPlanningResume:{phase:"ownership"}});
 };
 await run();await run();expect(drafts).toBe(1);
 await run(input.map((item,index)=>index?item:{...item,body:item.body+"新条件"}));expect(drafts).toBe(2);
 await run(input,"en");expect(drafts).toBe(3);
 await run(input,"zh-CN","整理访问控制");expect(drafts).toBe(4);
 await run(input,"zh-CN","整理同步","https://another.invalid");expect(drafts).toBe(5);
});

it("checks provider cache before reserving a paid request and blocks a real miss when no allowance remains",async()=>{
 let calls=0,reservations=0;
 const ai=createAtlasAIFromProvider(provider(async<T,>(request:StructuredAIRequest<T>)=>{calls++;return request.validate({value:"retained"});}),settings);
 const request={taskType:"other" as const,system:"Return a value",prompt:JSON.stringify({test:crypto.randomUUID()}),maxAttempts:1 as const,validate:(value:unknown)=>value};
 const first=await ai.generateStructured({...request,beforeRequest:()=>{reservations++;}});
 expect(await ai.generateStructured({...request,beforeRequest:()=>{throw new Error("no new allowance");}})).toEqual(first);
 await removeResponseCache();
 await expect(ai.generateStructured({...request,beforeRequest:()=>{throw new Error("no new allowance");}})).rejects.toThrow("no new allowance");
 expect(calls).toBe(1);expect(reservations).toBe(1);
});

it("retains confirmed assignments on cancellation without accepting the cancelled response",async()=>{
 const controller=new AbortController(),requested:string[][]=[];let drafts=0,shouldCancel=true;
 const raw=provider(async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){
   requested.push(data.expectedSlotIds);
   const slots=shouldCancel?data.slots.slice(0,1):data.slots;
   const result=request.validate({owners:Object.fromEntries(slots.map((slot:{id:string;choices:string[]})=>[slot.id,slot.choices[0]]))});
   if(shouldCancel&&requested.length===2){shouldCancel=false;controller.abort();}
   return result;
  }
  drafts++;const ids=data.sections.map((item:{id:string})=>item.id);
  return request.validate({scope:[],pages:[{title:"同步机制",subtopics:[{title:"完整条件",sectionIds:ids}]},{title:"访问条件",subtopics:[{title:"访问约束",sectionIds:ids.slice(0,3)}]}]});
 });
 const input=sections(10);
 await expect(planWikiTopics(input,"zh-CN",createAtlasAIFromProvider(raw,settings),controller.signal)).rejects.toMatchObject({name:"AbortError"});
 const result=await planWikiTopics(input,"zh-CN",createAtlasAIFromProvider(raw,settings),new AbortController().signal);
 expect(drafts).toBe(1);expect(requested).toEqual([["r0","r1","r2"],["r1","r2"],["r1","r2"]]);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
});

it("rejects corrupt completed checkpoint identities and restores a validated result instead",async()=>{
 let calls=0;
 const raw=provider(async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;const data=JSON.parse(request.prompt);
  return request.validate({scope:[],pages:[{title:"同步机制",subtopics:[{title:"完整条件",sectionIds:data.sections.map((item:{id:string})=>item.id)}]}]});
 });
 const input=sections(3),run=()=>planWikiTopics(input,"zh-CN",createAtlasAIFromProvider(raw,settings),new AbortController().signal);
 const first=await run(),db=await getDatabase();
 const checkpoint=(await db.getAll("semanticDecisionCache")).find(row=>row.providerId==="focus-wiki-planning"&&row.id.includes(":window:"))!;
 await db.put("semanticDecisionCache",{...checkpoint,result:{result:{pages:[{title:"错误结果",subtopics:[{title:"错误归属",sectionIds:["m999"]}]}]}}});
 expect(await run()).toEqual(first);expect(calls).toBe(1);
 expect((await db.get("semanticDecisionCache",checkpoint.id))?.result).not.toEqual({result:{pages:[{title:"错误结果",subtopics:[{title:"错误归属",sectionIds:["m999"]}]}]}});
});

it("reconsiders a stalled candidate set on explicit retry and can finish without replaying the old stall",async()=>{
 const requests:Array<{size:number;revision?:number;stalled?:boolean}>=[];
 const raw=provider(async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.convergence)requests.push({size:data.sections.length,revision:data.convergence.revision,stalled:data.convergence.stalled});
  const count=data.convergence?.revision?10:data.sections.length;
  return request.validate({scope:[],pages:Array.from({length:count},(_,index)=>({title:`主题${index}`,subtopics:[{title:"独特条件",sectionIds:data.sections.filter((_:unknown,position:number)=>position%count===index).map((item:{id:string})=>item.id)}]}))});
 });
 const input=sections(24),run=()=>planWikiTopics(input,"zh-CN",createAtlasAIFromProvider(raw,settings),new AbortController().signal);
 await expect(run()).rejects.toMatchObject({wikiPlanningResume:{phase:"convergence",reason:"stalled"}});
 const result=await run();expect(result).toHaveLength(10);
 expect(requests).toEqual([{size:24,revision:undefined,stalled:undefined},{size:24,revision:undefined,stalled:true},{size:24,revision:1,stalled:true}]);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
});

it("reports repeated invalid ownership as no progress rather than suggesting that a budget retry will necessarily fix it",async()=>{
 let calls=0;
 const raw=provider(async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){calls++;return request.validate({owners:{[data.expectedSlotIds[0]]:"s999"}});}
  const ids=data.sections.map((item:{id:string})=>item.id);
  return request.validate({scope:[],pages:[{title:"同步机制",subtopics:[{title:"完整条件",sectionIds:ids}]},{title:"访问条件",subtopics:[{title:"访问约束",sectionIds:ids.slice(0,17)}]}]});
 });
 await expect(planWikiTopics(sections(36),"zh-CN",createAtlasAIFromProvider(raw,settings),new AbortController().signal)).rejects.toMatchObject({wikiPlanningResume:{phase:"ownership",reason:"stalled",completed:0,remaining:17},message:expect.stringContaining("未收到新的有效分配")});
 expect(calls).toBe(4);
});
