import "fake-indexeddb/auto";
import {expect,it} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {planWikiTopics,type WikiPlanReceipt} from "./wiki-topic-plan";
import type {StructuredAIRequest} from "./provider";
import {AIProviderResponseError} from "./provider-errors";

it("repairs five competing owners in every window of 554 materials within the shared token ceiling",async()=>{
 const input=Array.from({length:554},(_,index)=>({...contextKnowledge().session.sections[0],id:`original-${index}`,title:`材料${index}`,body:`必须保留的独特条件${index}`,kind:"finding" as const}));
 const before=structuredClone(input);let localWindows=0,repairs=0,receipt:WikiPlanReceipt|undefined;
 const result=await planWikiTopics(input,"zh-CN",{capabilities:{maxConcurrency:3},generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){
   repairs++;expect(data.slots).toHaveLength(5);
   return request.validate({owners:Object.fromEntries(data.slots.map((slot:{id:string;choices:string[]})=>[slot.id,slot.choices[0]]))});
  }
  const ids=data.sections.map((item:{id:string})=>item.id);
  if(data.editorialGrouping)return request.validate({pages:[{title:"材料机制",subtopics:[{title:"完整条件",sectionIds:ids}]}]});
  localWindows++;
  return request.validate({pages:[{title:"材料机制",subtopics:[{title:"完整条件",sectionIds:ids}]},{title:"边界条件",subtopics:[{title:"边界说明",sectionIds:ids.slice(0,5)}]}]});
 }},new AbortController().signal,value=>{receipt=value;});
 expect(localWindows).toBeGreaterThan(12);expect(repairs).toBe(localWindows);
 expect(receipt).toMatchObject({reconciled:true,repairCount:repairs});expect(receipt!.repairTokens).toBeLessThanOrEqual(24000);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
 expect(input).toEqual(before);
});

it("increases a truncated small ownership reply within the same window and retains completed assignments",async()=>{
 const input=Array.from({length:20},(_,index)=>({...contextKnowledge().session.sections[0],id:`material-${index}`,title:`条件${index}`,body:`完整条件${index}`,kind:"finding" as const}));
 const requests:Array<{ids:string[];limit:number}>=[];let receipt:WikiPlanReceipt|undefined;
 const result=await planWikiTopics(input,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage!=="ownership"){
   const ids=data.sections.map((item:{id:string})=>item.id);
   return request.validate({pages:[{title:"同步机制",subtopics:[{title:"完整条件",sectionIds:ids}]},{title:"访问条件",subtopics:[{title:"访问约束",sectionIds:ids.slice(0,17)}]}]});
  }
  requests.push({ids:data.expectedSlotIds,limit:request.maxOutputTokens!});
  if(requests.length===2)throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED");
  return request.validate({owners:Object.fromEntries(data.slots.map((slot:{id:string;choices:string[]})=>[slot.id,slot.choices[0]]))});
 }},new AbortController().signal,value=>{receipt=value;});
 expect(requests.map(request=>request.limit)).toEqual([1600,800,1600]);
 expect(requests[1].ids).toEqual(["r16"]);expect(requests[2].ids).toEqual(["r16"]);
 expect(receipt).toMatchObject({reconciled:true,repairCount:3,repairTokens:4000});
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
});
