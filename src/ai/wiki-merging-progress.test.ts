import "fake-indexeddb/auto";
import {beforeEach,expect,it} from "vitest";
import {getDatabase} from "../storage/db";
import {contextKnowledge} from "../test/context-fixture";
import {createWikiTopicPlanner} from "./wiki-topic-plan";
import type {StructuredAIRequest} from "./provider";
import type {WikiPlanningProgress} from "../shared/focus-progress";

beforeEach(async()=>{await(await getDatabase()).clear("semanticDecisionCache");});
const sections=(n:number)=>Array.from({length:n},(_,i)=>({...contextKnowledge().session.sections[0],id:`original-${i}`,title:`范围${i}`,kind:"finding" as const,body:`机制和条件 ${i}`}));
const plan=(request:Pick<StructuredAIRequest<unknown>,"prompt">,count:number)=>{
 const data=JSON.parse(request.prompt),size=Math.min(count,data.sections.length);
 return {pages:Array.from({length:size},(_,i)=>({title:`主体${i}`,question:`主体${i}的职责是什么？`,group:"",subtopics:[{key:`t${i}`,title:`机制${i}`,question:`机制${i}的边界是什么？`}]})),assignments:Object.fromEntries(data.sections.map((item:{id:string},i:number)=>[item.id,`t${i%size}`]))};
};

it("reports each chapter-merging round with the current chapter count, so a long merge does not look stuck",async()=>{
 let calls=0;const progress:WikiPlanningProgress[]=[];
 // The merge plan proposes no merges here, so regrouping rounds follow it.
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{if(JSON.parse(request.prompt).presentation==="wiki_chapter_merge")return request.validate({groups:[]});calls++;return request.validate(plan(request,calls===1?24:calls===2?18:10));}};
 const planner=createWikiTopicPlanner("zh-CN",ai,new AbortController().signal,undefined,undefined,{onProgress:item=>progress.push(item)});
 planner.append(sections(24));expect(await planner.finish()).toHaveLength(10);
 expect(progress.flatMap(item=>item.merging?[item.merging]:[])).toEqual([{round:1,chapters:24,target:10},{round:2,chapters:24,target:10},{round:3,chapters:18,target:10},{round:4,chapters:18,target:10}]);
});
