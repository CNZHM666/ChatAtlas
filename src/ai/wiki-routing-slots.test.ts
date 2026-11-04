import "fake-indexeddb/auto";
import {beforeEach,expect,it} from "vitest";
import {getDatabase} from "../storage/db";
import {contextKnowledge} from "../test/context-fixture";
import {planWikiTopics} from "./wiki-topic-plan";
import {expandWikiSlotRouting} from "./wiki-slot-routing";
import type {StructuredAIRequest} from "./provider";

beforeEach(async()=>{await(await getDatabase()).clear("semanticDecisionCache");});
const sections=(n:number)=>Array.from({length:n},(_,i)=>({...contextKnowledge().session.sections[0],id:`m${i}`,title:`范围${i}`,kind:"finding" as const,body:`机制和条件 ${i}`}));
const outline=[0,1].map(i=>({title:`主体${i}`,question:`主体${i}的职责是什么？`,group:"",subtopics:[{title:`机制${i}`,question:`机制${i}的边界是什么？`}]}));
const owners=(value:unknown)=>(value as {pages:Array<{subtopics:Array<{sectionIds:string[]}>}>}).pages.map(page=>page.subtopics.flatMap(topic=>topic.sectionIds));

it("matches named routes by slot, in any order, and leaves a missing or doubly named slot unresolved",()=>{
 const items=sections(4);
 expect(owners(expandWikiSlotRouting({pages:outline,routes:[{slot:"m3",chapter:1,subtopics:[0]},{slot:"m0",chapter:0,subtopics:[0]},{slot:"m1",chapter:0,subtopics:[0]},{slot:"m2",chapter:1,subtopics:[0]}]},items))).toEqual([["m0","m1"],["m2","m3"]]);
 // m2 is missing and m1 is named twice: only those two stay unresolved; nothing shifts.
 expect(owners(expandWikiSlotRouting({pages:outline,routes:[{slot:"m0",chapter:0,subtopics:[0]},{slot:"m1",chapter:0,subtopics:[0]},{slot:"m1",chapter:1,subtopics:[0]},{slot:"m3",chapter:1,subtopics:[0]},{slot:"m9",chapter:1,subtopics:[0]}]},items))).toEqual([["m0"],["m3"]]);
 // Unnamed routes still depend on position, so a wrong count is still refused.
 expect(()=>expandWikiSlotRouting({pages:outline,routes:[{chapter:0,subtopics:[0]}]},items)).toThrowError(expect.objectContaining({code:"PROVIDER_SCHEMA_wiki_directory_routing_count"}));
});

it("asks the model only about the material a named routes list skipped",async()=>{
 const calls:Array<{stage?:string;slots?:number}>=[];
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);calls.push({stage:data.stage,slots:data.routingSlots?.length});
  if(data.stage==="ownership")return request.validate({owners:Object.fromEntries((data.expectedSlotIds as string[]).map(id=>[id,data.slots.find((slot:{id:string})=>slot.id===id).choices[0]]))});
  const slots=data.routingSlots as string[];
  // The list skips its third entry: the rest keep their own slots.
  return request.validate({pages:outline,routes:slots.filter((_,index)=>index!==2).map((slot,index)=>({slot,chapter:index%2,subtopics:[0]}))});
 }};
 const input=sections(8),result=await planWikiTopics(input,"zh-CN",ai,new AbortController().signal);
 expect(calls.map(call=>call.stage??"plan")).toEqual(["plan","ownership"]);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
});
