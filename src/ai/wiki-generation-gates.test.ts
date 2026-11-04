import "fake-indexeddb/auto";
import {expect,it,vi} from "vitest";
import {planWikiTopics,type WikiPlanReceipt} from "./wiki-topic-plan";
import {contextKnowledge} from "../test/context-fixture";
import {createAIProvider,type StructuredAIRequest} from "./provider";
import {validateFocusResult} from "./focus-session";
import {createAtlasAIFromProvider} from "./atlas-ai";
import type {AISettings} from "../shared/types";

const sections=(count:number)=>Array.from({length:count},(_,index)=>({...contextKnowledge().session.sections[0],id:`private-${index}`,title:`模块${index}`,body:`模块条件 ${index} 保留完整来源。`,kind:"finding" as const}));
const page=(title:string,ids:string[])=>({title,subtopics:[{title:"完整机制",sectionIds:ids}]});

it("writes a valid Wiki in one real transport response despite an unsolicited malformed brief",async()=>{
 const settings:AISettings={id:"ai-settings",provider:"qwen",baseUrl:"https://fixture.invalid/v1",model:"fixture",apiKey:"fixture",streaming:false,updatedAt:1};
 const data={intent:"Project Wiki",mode:"work",strategy:"work",overviewFromWiki:true,locale:"en",coverage:{stage:"synthesis",final:true},passages:[{id:"private-note",text:"Keep a local search index.",wikiOwnerId:"search"}],wikiTopics:[{ownerId:"search",title:"Search",subtopics:[{title:"Indexing",evidenceIds:["private-note"]}]}]};
 const fetch=vi.spyOn(globalThis,"fetch").mockImplementation(async(_url,options)=>{
  const wire=JSON.parse(String(options?.body)),contract=JSON.parse(wire.messages.find((message:{role:string})=>message.role==="user").content);
  expect(contract.expectedShape).not.toHaveProperty("brief");
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({title:"Project",brief:{confirmed:["Unsupported string"]},sections:[{title:"Search",wikiOwnerId:"search",body:"## Indexing\n\nKeep a local search index.",kind:"finding",transition:"",evidenceIds:["e1"]}]})},finish_reason:"stop"}],usage:{prompt_tokens:100,completion_tokens:50}}),{status:200,headers:{"content-type":"application/json"}});
 });
 try{
  const ai=createAtlasAIFromProvider(createAIProvider(settings),settings,undefined,crypto.randomUUID());
  const result=await ai.synthesize({taskType:"focus_session",system:"Write a project Wiki.",prompt:JSON.stringify(data),validate:value=>validateFocusResult(value,[{id:"private-note",conversationId:"chat",messageId:"message",title:"Search",excerpt:"Keep a local search index."}])});
  expect(fetch).toHaveBeenCalledTimes(1);expect(result.brief).toBeUndefined();expect(result.sections[0].evidenceIds).toEqual(["private-note"]);
 }finally{fetch.mockRestore();}
});

it("repairs four cross-parent conflicts after a separate metadata correction, without restarting analysis",async()=>{
 let calls=0;const inputs=sections(8);let receipt:WikiPlanReceipt|undefined;
 const result=await planWikiTopics(inputs,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);calls++;
  if(data.stage==="ownership"){expect(data.expectedCount).toBe(4);return request.validate({owners:Object.fromEntries(data.slots.map((slot:{id:string;choices:string[]})=>[slot.id,slot.choices.at(-1)]))});}
  if(!data.correction)return request.validate({pages:[page("",data.sections.map((section:{id:string})=>section.id))]});
  return request.validate({pages:[page("消息同步",["m0","m1","m2","m3","m4"]),page("本地检索",["m0","m1","m2","m3","m5","m6","m7"])]});
 }},new AbortController().signal,value=>{receipt=value;});
 expect(calls).toBe(3);expect(receipt).toMatchObject({repairCount:2,reconciled:true});expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(inputs.map(item=>item.id).sort());
});

it("cached partial repair progress does not consume the next run's paid repair allowance",async()=>{
 const settings:AISettings={id:"ai-settings",provider:"openai",baseUrl:"https://fixture.invalid",model:"fixture",apiKey:"fixture",updatedAt:1};
 let providerRepairs=0,allowRemaining=false;const inputs=sections(7),cacheId=crypto.randomUUID();
 const ai=createAtlasAIFromProvider({id:cacheId,modelId:"fixture",testConnection:async()=>({ok:true,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage!=="ownership")return request.validate({pages:[page("消息同步",data.sections.slice(0,-1).map((item:{id:string})=>item.id)),page("消息检索",data.sections.map((item:{id:string})=>item.id))]});
  providerRepairs++;
  const chosen=allowRemaining?data.slots:[data.slots[0]];
  return request.validate({owners:Object.fromEntries(chosen.map((slot:{id:string;choices:string[]})=>[slot.id,slot.choices.at(-1)]))});
 }},settings);
 let receipt:WikiPlanReceipt|undefined;
 const run=()=>planWikiTopics(inputs,"zh-CN",ai,new AbortController().signal,value=>{receipt=value;});
 await expect(run()).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_ownership_incomplete"});expect(providerRepairs).toBe(4);
 allowRemaining=true;const result=await run();expect(providerRepairs).toBe(5);expect(receipt).toMatchObject({reconciled:true,repairCount:1});expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(inputs.map(item=>item.id).sort());
});

it("repairs more than four dense catalogue windows and reuses validated metadata corrections on retry",async()=>{
 const inputs=sections(54).map(item=>({...item,body:"索引更新时保留原文和失败条件。".repeat(14),claims:Array.from({length:8},()=>({text:"保存、检索与访问权限的独立条件。".repeat(2),quote:"保存条件",evidenceIds:item.evidenceIds}))}));
 const before=structuredClone(inputs);let metadataCalls=0,globals=0,receipt:WikiPlanReceipt|undefined;
 const settings:AISettings={id:"ai-settings",provider:"qwen",baseUrl:"https://fixture.invalid",model:"qwen3.7-flash",apiKey:"fixture",updatedAt:1};
 const ai=createAtlasAIFromProvider({id:crypto.randomUUID(),modelId:"qwen3.7-flash",testConnection:async()=>({ok:true,model:"qwen3.7-flash"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt),ids=data.sections.map((item:{id:string})=>item.id);
  if(data.editorialGrouping){globals++;return request.validate({pages:[page("全局目录",ids)]});}
  if(data.correction){metadataCalls++;return request.validate({pages:[page("数据保存",ids)]});}
  return request.validate({pages:[page("",ids)]});
 }},settings);
 const run=()=>planWikiTopics(inputs,"zh-CN",ai,new AbortController().signal,value=>{receipt=value;});
 const result=await run(),paidCorrections=metadataCalls;
 expect(paidCorrections).toBeGreaterThan(4);expect(receipt).toMatchObject({repairCount:paidCorrections,reconciled:true});expect(receipt!.repairTokens).toBeLessThanOrEqual(24000);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(inputs.map(item=>item.id).sort());
 expect(await run()).toEqual(result);expect(metadataCalls).toBe(paidCorrections);expect(globals).toBe(1);expect(receipt).toMatchObject({repairCount:0,repairTokens:0,reconciled:true});expect(inputs).toEqual(before);
});
