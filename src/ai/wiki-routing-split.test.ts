import "fake-indexeddb/auto";
import {beforeEach,expect,it} from "vitest";
import {getDatabase} from "../storage/db";
import {contextKnowledge} from "../test/context-fixture";
import {planWikiTopics} from "./wiki-topic-plan";
import type {StructuredAIRequest} from "./provider";

beforeEach(async()=>{await(await getDatabase()).clear("semanticDecisionCache");});
const sections=(n:number)=>Array.from({length:n},(_,i)=>({...contextKnowledge().session.sections[0],id:`original-${i}`,title:`范围${i}`,kind:"finding" as const,body:`机制和条件 ${i}`}));

it("re-plans a batch in halves when its routes list has the wrong length, instead of resending it",async()=>{
 const sizes:number[]=[];
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt),slots=data.routingSlots as string[];sizes.push(slots.length);
  // The full batch always drops one route; each half is answered correctly.
  const routes=slots.map((_,index)=>({chapter:index%2,subtopics:[0]})).slice(0,slots.length>4?-1:undefined);
  return request.validate({pages:[0,1].map(i=>({title:`主体${slots.length}-${i}`,question:`主体${i}的职责是什么？`,group:"",subtopics:[{title:`机制${slots.length}-${i}`,question:`机制${i}的边界是什么？`}]})),routes});
 }};
 const input=sections(8),result=await planWikiTopics(input,"zh-CN",ai,new AbortController().signal);
 expect(sizes).toEqual([8,4,4]);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
});
