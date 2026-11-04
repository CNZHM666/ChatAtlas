import "fake-indexeddb/auto";
import {expect,it} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {planWikiTopics,type WikiPlanReceipt} from "./wiki-topic-plan";
import {prepareWikiOwnershipRepair} from "./wiki-ownership-repair";
import {validateWikiPlan} from "./wiki-plan-contract";
import {AIProviderValidationError} from "./provider-errors";
import type {StructuredAIRequest} from "./provider";

const sections=()=>Array.from({length:36},(_,index)=>({...contextKnowledge().session.sections[0],id:`m${index}`,title:`同步条件${index}`,body:`失败后保留原文的完整规则${index}。`,kind:"finding" as const}));
const draft=()=>({pages:[{title:"同步机制",subtopics:[{title:"保存规则",sectionIds:Array.from({length:33},(_,i)=>`m${i}`)}]},{title:"访问权限",subtopics:[{title:"权限条件",sectionIds:[...Array.from({length:15},(_,i)=>`m${i}`),"m33"]}]}]});
type Slot={id:string;choices:string[]};
const owners=(slots:Slot[])=>({owners:Object.fromEntries(slots.map(slot=>[slot.id,slot.choices.at(-1)]))});

it.each(["target","slot"])("recovers a wholly invalid %s reply by narrowing the unresolved request within the same ceiling",async reason=>{
 const sizes:number[]=[],corrections:unknown[]=[];let receipt:WikiPlanReceipt|undefined;
 const result=await planWikiTopics(sections(),"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage!=="ownership")return request.validate(draft());
  sizes.push(data.slots.length);corrections.push(data.correction);
  if(sizes.length===1)return request.validate(reason==="target"?{owners:{[data.slots[0].id]:"s999"}}:{owners:{r999:data.slots[0].choices[0]}});
  return request.validate(owners(data.slots));
 }},new AbortController().signal,value=>{receipt=value;});
 expect(sizes).toEqual([16,8,8,1]);expect(corrections[1]).toEqual({reason});expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(sections().map(section=>section.id).sort());expect(receipt).toMatchObject({repairCount:4,reconciled:true});expect(receipt!.repairTokens).toBeLessThanOrEqual(24000);
});

it("retains valid explicit pairs from a mixed reply and reasks only the unresolved materials",async()=>{
 const requested:string[][]=[];
 const result=await planWikiTopics(sections(),"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);if(data.stage!=="ownership")return request.validate(draft());
  requested.push(data.expectedSlotIds);
  return request.validate(requested.length===1?{owners:{...owners(data.slots.slice(0,8)).owners,[data.slots[8].id]:"s999",r999:"s0"}}:owners(data.slots));
 }},new AbortController().signal);
 expect(requested.map(ids=>ids.length)).toEqual([16,9]);expect(requested[1]).toEqual(Array.from({length:9},(_,i)=>`r${i+8}`));expect(result.flatMap(page=>page.sectionIds)).toHaveLength(36);
});

it("keeps strict final validation and never guesses positional, textual or multi-target aliases",()=>{
 const input=sections();let error:AIProviderValidationError|undefined;try{validateWikiPlan(draft(),input);}catch(cause){error=cause as AIProviderValidationError;}
 const repair=prepareWikiOwnershipRepair(draft(),input,error!)!;
 expect(repair.readRecoverable({owners:{r0:"s0",r1:"s999",r999:"s0"}},[0,1])).toEqual({owners:{r0:"s0"}});
 expect(()=>repair.apply({owners:{r0:"s0"}})).toThrow();
 for(const value of [{owners:["s0"]},{owners:{r0:0}},{owners:{r0:"同步机制"}},{owners:{m0:"s0"}},{owners:{r0:["s0","s1"]}}])expect(()=>repair.readRecoverable(value,[0,1])).toThrow();
});

it("stops repeated invalid IDs after four attempts with the repair failure, never the old duplicate error",async()=>{
 let repairs=0,receipt:WikiPlanReceipt|undefined;
 await expect(planWikiTopics(sections(),"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);if(data.stage!=="ownership")return request.validate(draft());
  repairs++;return request.validate({owners:{[data.slots[0].id]:"s999"}});
 }},new AbortController().signal,value=>{receipt=value;})).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_ownership_target",wikiOwnershipDetails:{expectedSlots:17,receivedSlots:0,reason:"target"}});
 expect(repairs).toBe(4);expect(receipt).toMatchObject({reconciled:false,repairCount:4});
});

it("does not retry cancellation as a repairable ID error",async()=>{
 const controller=new AbortController();let repairs=0;
 await expect(planWikiTopics(sections(),"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);if(data.stage!=="ownership")return request.validate(draft());
  repairs++;controller.abort();return request.validate({owners:{r0:"s999"}});
 }},controller.signal)).rejects.toMatchObject({name:"AbortError"});expect(repairs).toBe(1);
});
