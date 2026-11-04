import "fake-indexeddb/auto";
import {expect,it} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {planWikiTopics,type WikiPlanReceipt} from "./wiki-topic-plan";
import {validateWikiPlan,wikiPlanFailureMessage} from "./wiki-plan-contract";
import {prepareWikiOwnershipRepair} from "./wiki-ownership-repair";
import {AIProviderValidationError} from "./provider-errors";
import type {StructuredAIRequest} from "./provider";

const sections=(size:number)=>Array.from({length:size},(_,index)=>({...contextKnowledge().session.sections[0],id:`private-${index}`,title:`索引材料${index}`,body:`更新和失败处理的完整条件${index}。`,kind:"finding" as const}));

it("replays 51 directory notes with 15 shared child references and two omissions, repairing only the omissions",async()=>{
 const input=sections(51),before=structuredClone(input);let broken=false;const repairedIds:string[][]=[];
 const result=await planWikiTopics(input,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){
   expect(data.expectedCount).toBe(data.slots.length);repairedIds.push(data.expectedSlotIds);
   expect(data.slots.length).toBeLessThanOrEqual(2);
   const last=data.slots.at(-1);return request.validate({owners:{[last.id]:last.choices[0]}});
  }
  const ids=data.sections.map((section:{id:string})=>section.id);
  if(!broken&&!data.editorialGrouping){broken=true;expect(ids).toHaveLength(36);return request.validate({pages:[{title:"索引机制",subtopics:[{title:"更新流程",sectionIds:ids.slice(0,-2)},{title:"失败处理",sectionIds:ids.slice(0,15)}]}]});}
  return request.validate({pages:[{title:"索引机制",subtopics:[{title:data.editorialGrouping?"归并":"更新流程",sectionIds:ids}]}]});
 }},new AbortController().signal);
 expect(repairedIds).toEqual([["r0","r1"],["r0"]]);expect(result).toHaveLength(1);
 expect(result[0].sectionIds).toEqual(input.map(section=>section.id));
 expect(result[0].subtopics).toHaveLength(1);
 expect(result[0].subtopics?.find(topic=>topic.title==="归并")?.sectionIds).toEqual(input.map(section=>section.id));
 expect(input).toEqual(before);
});

it("retains valid partial explicit assignments and resumes only remaining IDs under the original shared ceiling",async()=>{
 const input=sections(36),requests:Array<{count:number;ids:string[]}>=[];let receipt:WikiPlanReceipt|undefined;
 const result=await planWikiTopics(input,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){
   requests.push({count:data.expectedCount,ids:data.expectedSlotIds});expect(data.slots).toHaveLength(data.expectedCount);
   const chosen=requests.length===1?data.slots.slice(0,8):data.slots;
   return request.validate({owners:Object.fromEntries(chosen.map((slot:{id:string;choices:string[]})=>[slot.id,slot.choices.at(-1)]))});
  }
  const ids=data.sections.map((section:{id:string})=>section.id);
  return request.validate({pages:[{title:"索引机制",subtopics:[{title:"更新",sectionIds:ids.slice(0,-2)}]},{title:"访问管理",subtopics:[{title:"访问条件",sectionIds:ids.slice(0,15)}]}]});
 }},new AbortController().signal,value=>{receipt=value;});
 expect(requests.map(request=>request.count)).toEqual([16,9]);expect(requests[1].ids).toEqual(Array.from({length:9},(_,index)=>`r${index+8}`));
 expect(receipt).toMatchObject({repairCount:2,reconciled:true});expect(receipt!.repairTokens).toBeLessThanOrEqual(24000);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(section=>section.id).sort());
});

it("reports incomplete repair counts rather than the original fifteen-duplicate error",()=>{
 const input=sections(36).map((section,index)=>({...section,id:`m${index}`}));
 const value={pages:[{title:"索引机制",subtopics:[{title:"更新",sectionIds:input.slice(0,-2).map(section=>section.id)}]},{title:"访问管理",subtopics:[{title:"条件",sectionIds:input.slice(0,15).map(section=>section.id)}]}]};
 let failure:AIProviderValidationError|undefined;try{validateWikiPlan(value,input);}catch(error){failure=error as AIProviderValidationError;}
 expect(failure?.wikiDirectoryDetails).toMatchObject({missingIds:["m34","m35"],duplicateIds:input.slice(0,15).map(section=>section.id)});
 const repair=prepareWikiOwnershipRepair(value,input,failure!)!;
 try{repair.apply({owners:["s0","s1"]});throw new Error("missing assignments accepted");}catch(error){
  expect(error).toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_ownership_incomplete",wikiOwnershipDetails:{expectedSlots:17,receivedSlots:2,reason:"count"}});
  expect(wikiPlanFailureMessage(error as AIProviderValidationError,"zh-CN")).toContain("需要 17 项有效分配，模型返回 2 项");
 }
});

it("preserves all shared child support in the explicitly selected winning parent",()=>{
 const input=sections(4).map((section,index)=>({...section,id:`m${index}`}));
 const value={pages:[{title:"索引机制",subtopics:[{title:"更新流程",sectionIds:["m0","m1"]},{title:"失败处理",sectionIds:["m1","m2"]}]},{title:"访问管理",subtopics:[{title:"访问条件",sectionIds:["m1","m3"]}]}]};
 let failure:AIProviderValidationError|undefined;try{validateWikiPlan(value,input);}catch(error){failure=error as AIProviderValidationError;}
 const result=prepareWikiOwnershipRepair(value,input,failure!)!.apply({owners:{r0:"s0"}});
 expect(result[0].subtopics?.map(topic=>topic.sectionIds)).toEqual([["m0","m1"],["m1","m2"]]);expect(result[1].sectionIds).toEqual(["m3"]);
});

it("rejects unexpected slot IDs, partial positional arrays and invalid targets without guessing their meaning",()=>{
 const input=sections(4).map((section,index)=>({...section,id:`m${index}`}));
 const value={pages:[{title:"索引机制",subtopics:[{title:"更新",sectionIds:["m0","m1"]}]},{title:"访问管理",subtopics:[{title:"权限",sectionIds:["m0","m1","m2","m3"]}]}]};
 let failure:AIProviderValidationError|undefined;try{validateWikiPlan(value,input);}catch(error){failure=error as AIProviderValidationError;}
 const repair=prepareWikiOwnershipRepair(value,input,failure!)!;
 for(const response of [{owners:{r99:"s0"}},{owners:["s0"]},{owners:{r0:"s99"}},{owners:{r0:["s0","s1"]}}])expect(()=>repair.readPartial(response,[0,1])).toThrow();
 expect(repair.readPartial({owners:{r1:"s1"}},[0,1])).toEqual({owners:{r1:"s1"}});
});

it("stops partial ownership continuation at the existing shared ceiling with accurate retained counts",async()=>{
 let repairs=0,receipt:WikiPlanReceipt|undefined;
 await expect(planWikiTopics(sections(36),"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){repairs++;return request.validate({owners:{[data.slots[0].id]:data.slots[0].choices[0]}});}
  const ids=data.sections.map((section:{id:string})=>section.id);
  return request.validate({pages:[{title:"索引机制",subtopics:[{title:"更新",sectionIds:ids.slice(0,-2)}]},{title:"访问管理",subtopics:[{title:"权限",sectionIds:ids.slice(0,15)}]}]});
 }},new AbortController().signal,value=>{receipt=value;})).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_ownership_incomplete",wikiOwnershipDetails:{expectedSlots:17,receivedSlots:4,reason:"count"}});
 expect(repairs).toBe(4);expect(receipt).toMatchObject({repairCount:4,reconciled:false});
});
