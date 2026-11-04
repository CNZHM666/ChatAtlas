import "fake-indexeddb/auto";
import {beforeEach,expect,it} from "vitest";
import {getDatabase} from "../storage/db";
import {contextKnowledge} from "../test/context-fixture";
import {planWikiTopics,type WikiPlanReceipt} from "./wiki-topic-plan";
import type {StructuredAIRequest} from "./provider";
import {AIProviderValidationError} from "./provider-errors";

beforeEach(async()=>{await(await getDatabase()).clear("semanticDecisionCache");});

it("corrects malformed merge IDs once before falling back to a complete regrouping",async()=>{
 let merges=0,converges=0;
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_chapter_merge"){
   if(++merges===1)return request.validate({groups:[{chapters:["c0","c99"],title:"无效主体",question:"范围？"}]});
   expect(data.correction.rejected).toEqual(["groups[0].chapters"]);
   return request.validate({groups:Array.from({length:10},(_,i)=>({chapters:[`c${i*2}`,`c${i*2+1}`],title:`有效主题${i}`,question:`范围${i}？`}))});
  }
  if(data.convergence)converges++;
  return request.validate(leaf(request));
 }};
 const result=await planWikiTopics(sections(20),"zh-CN",ai,new AbortController().signal);
 expect(result).toHaveLength(10);expect(merges).toBe(2);expect(converges).toBe(0);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(sections(20).map(item=>item.id).sort());
});

it("continues short merge plans after a partial reduction without rewriting the entire directory",async()=>{
 let merges=0,converges=0;
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_chapter_merge"){
   merges++;
   const count=merges===1?2:8;
   return request.validate({groups:Array.from({length:count},(_,i)=>({chapters:[`c${i*2}`,`c${i*2+1}`],title:`归并${merges}主题${i}`,question:`机制${i}如何运行？`}))});
  }
  if(data.convergence)converges++;
  return request.validate(leaf(request));
 }};
 const input=sections(20),result=await planWikiTopics(input,"zh-CN",ai,new AbortController().signal);
 expect(merges).toBe(2);expect(converges).toBe(0);expect(result).toHaveLength(10);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
});

it("keeps the best attributed roster when later regrouping fragments it, then resumes with a short merge",async()=>{
 let rounds=0;
 const ai={getAnalysisKey:async()=>"best-roster",generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_chapter_merge")return request.validate({groups:[]});
  if(!data.convergence)return request.validate(leaf(request));
  const count=++rounds===1?15:19;
  return request.validate({pages:Array.from({length:count},(_,i)=>({title:`归并主题${i}`,question:`机制${i}如何运行？`,group:"",subtopics:[{key:`t${i}`,title:`机制${i}`,question:`条件${i}？`}]})),assignments:Object.fromEntries(data.sections.map((item:{id:string},i:number)=>[item.id,`t${i%count}`]))});
 }};
 await expect(planWikiTopics(sections(20),"zh-CN",ai,new AbortController().signal)).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_no_convergence",wikiPlanningResume:{remaining:15}});
 const db=await getDatabase(),saved=(await db.getAll("semanticDecisionCache")).find(entry=>entry.id.includes("convergence-editorial"))!;
 expect((saved.result as {pages:unknown[]}).pages).toHaveLength(15);
 // Migrate a ledger produced by the earlier strategy: mergeTried referred to
 // an older roster and must not permanently disable the short merge path.
 await db.put("semanticDecisionCache",{...saved,result:{...(saved.result as object),mergeTried:true,mergeVersion:undefined}});
 let mergeCalls=0;
 const resumed={getAnalysisKey:ai.getAnalysisKey,generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation!=="wiki_chapter_merge")throw new AIProviderValidationError("unexpected_full_replan");
  mergeCalls++;expect(data.chapters).toHaveLength(15);
  return request.validate({groups:Array.from({length:5},(_,i)=>({chapters:[`c${i*2}`,`c${i*2+1}`],title:`恢复主题${i}`,question:`机制${i}如何运行？`}))});
 }};
 const result=await planWikiTopics(sections(20),"zh-CN",resumed,new AbortController().signal);
 expect(result).toHaveLength(10);expect(mergeCalls).toBe(1);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(sections(20).map(item=>item.id).sort());
});
const sections=(n:number)=>Array.from({length:n},(_,i)=>({...contextKnowledge().session.sections[0],id:`original-${i}`,title:`范围${i}`,kind:"finding" as const,body:`机制和条件 ${i}`}));
// One planning window returns twenty single-subtopic chapters, one per material.
const leaf=(request:Pick<StructuredAIRequest<unknown>,"prompt">)=>{
 const data=JSON.parse(request.prompt),count=data.sections.length;
 return {pages:Array.from({length:count},(_,i)=>({title:`主体${i}`,question:`主体${i}的职责是什么？`,group:"",subtopics:[{key:`t${i}`,title:`机制${i}`,question:`机制${i}的边界是什么？`}]})),assignments:Object.fromEntries(data.sections.map((item:{id:string},i:number)=>[item.id,`t${i}`]))};
};

it("merges chapters from one short merge plan, keeping every material and subtopic, without regrouping rounds",async()=>{
 const presentations:string[]=[];let receipt:WikiPlanReceipt|undefined;
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);presentations.push(data.convergence?"converge":data.presentation);
  if(data.presentation==="wiki_chapter_merge"){
   expect(data.chapters).toHaveLength(20);expect(data.chapters[0]).toMatchObject({id:"c0",title:"主体0",subtopics:["机制0"]});
   // Ten pairs merge: twenty chapters become ten.
   return request.validate({groups:[0,2,4,6,8,10,12,14,16,18].map(i=>({chapters:[`c${i}`,`c${i+1}`],title:`合并${i}`,question:`合并${i}负责什么？`,group:"核心"}))});
  }
  return request.validate(leaf(request));
 }};
 const input=sections(20),result=await planWikiTopics(input,"zh-CN",ai,new AbortController().signal,value=>{receipt=value;});
 expect(presentations.filter(item=>item==="converge")).toHaveLength(0);expect(presentations.filter(item=>item==="wiki_chapter_merge")).toHaveLength(1);
 expect(result).toHaveLength(10);expect(receipt).toMatchObject({mergedGroups:10});
 expect(result[0]).toMatchObject({title:"合并0",question:"合并0负责什么？",group:"核心"});expect(result[0].subtopics?.map(topic=>topic.title)).toEqual(["机制0","机制1"]);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
});

it("refuses a catch-all merge and falls back to regrouping rounds when the plan is invalid",async()=>{
 let receipt:WikiPlanReceipt|undefined,converge=0;
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  // Eight of twenty chapters in one group swallow 40% of the materials.
  if(data.presentation==="wiki_chapter_merge"){fits.push(data.fit?.targetChapters);return request.validate(data.fit?{groups:[]}:{groups:[{chapters:Array.from({length:8},(_,i)=>`c${i}`),title:"综合",question:"项目的一切？"},{chapters:["c10","c11"],title:"合并",question:"合并负责什么？"}]});}
  if(data.convergence){converge++;return request.validate(leaf(request));}
  return request.validate(leaf(request));
 }};
 const fits:unknown[]=[];
 const result=await planWikiTopics(sections(15),"zh-CN",ai,new AbortController().signal,value=>{receipt=value;});
 // Only the small merge applies. Fourteen chapters are above the ceiling, so
 // they get a fit merge toward the target before publishing; it declines here.
 expect(fits).toEqual([undefined,4]);
 expect(result).toHaveLength(14);expect(result.some(page=>page.title==="综合")).toBe(false);expect(receipt).toMatchObject({mergedGroups:1,refineReasons:{fit_kept:1,over_ceiling_kept:1}});expect(converge).toBe(0);
 const invalid={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_chapter_merge")return request.validate({groups:[{chapters:["c0","c99"],title:"合并",question:"？"}]});
  if(data.convergence)converge++;
  return request.validate(leaf(request));
 }};
 await planWikiTopics(sections(20),"zh-CN",invalid,new AbortController().signal).catch(()=>undefined);
 expect(converge).toBeGreaterThan(0);
});

it("still runs the merge plan on a retry that resumes saved merge progress",async()=>{
 const controller=new AbortController(),first:string[]=[];
 const cancelling={getAnalysisKey:async()=>"merge-resume",generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);first.push(data.convergence?"converge":data.presentation);
  // The first run is cancelled while its merge plan is in flight.
  if(data.presentation==="wiki_chapter_merge"){controller.abort();throw new DOMException("Aborted","AbortError");}
  return request.validate(leaf(request));
 }};
 await expect(planWikiTopics(sections(20),"zh-CN",cancelling,controller.signal)).rejects.toThrow();
 expect(first).toContain("wiki_chapter_merge");
 const second:string[]=[];
 const resumed={getAnalysisKey:async()=>"merge-resume",generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);second.push(data.convergence?"converge":data.presentation);
  if(data.presentation==="wiki_chapter_merge")return request.validate({groups:[0,2,4,6,8,10,12,14,16,18].map(i=>({chapters:[`c${i}`,`c${i+1}`],title:`合并${i}`,question:`合并${i}负责什么？`}))});
  return request.validate(leaf(request));
 }};
 const result=await planWikiTopics(sections(20),"zh-CN",resumed,new AbortController().signal);
 expect(second.filter(item=>item==="wiki_chapter_merge")).toHaveLength(1);expect(second).not.toContain("converge");expect(result).toHaveLength(10);
});

it("drops only the unusable groups of a merge plan and applies the rest",async()=>{
 let receipt:WikiPlanReceipt|undefined;
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_chapter_merge")return request.validate(data.fit?{groups:[]}:{groups:[
   // An unknown ID and a chapter already used by an earlier group.
   {chapters:["c0","c99"],title:"未知",question:"？"},
   ...[0,2,4,6,8,10].map(i=>({chapters:[`c${i}`,`c${i+1}`],title:`合并${i}`,question:`合并${i}负责什么？`})),
   {chapters:["c1","c12"],title:"重复",question:"重复负责什么？"}]});
  return request.validate(leaf(request));
 }};
 const input=sections(20),result=await planWikiTopics(input,"zh-CN",ai,new AbortController().signal,value=>{receipt=value;});
 expect(result).toHaveLength(14);expect(result.some(page=>page.title==="未知"||page.title==="重复")).toBe(false);
 expect(receipt).toMatchObject({mergedGroups:6,refineReasons:{merge_group_dropped:2}});
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
});

it("retries a failed fit merge once with the rejected fields before publishing",async()=>{
 const fits:Array<{rejected?:string[]}>=[];let receipt:WikiPlanReceipt|undefined;
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_chapter_merge"){
   if(!data.fit)return request.validate({groups:[0,2,4,6,8,10].map(i=>({chapters:[`c${i}`,`c${i+1}`],title:`合并${i}`,question:`合并${i}负责什么？`}))});
   fits.push({rejected:data.correction?.rejected});
   // The first fit plan only names an unknown chapter; the retry is valid.
   return request.validate(fits.length===1?{groups:[{chapters:["c0","c99"],title:"未知",question:"？"}]}:{groups:[{chapters:["c0","c1"],title:"总合并",question:"总合并负责什么？"}]});
  }
  return request.validate(leaf(request));
 }};
 const result=await planWikiTopics(sections(20),"zh-CN",ai,new AbortController().signal,value=>{receipt=value;});
 // Twenty chapters merge to fourteen, above the ceiling; the fit retry joins one more pair before publishing.
 expect(fits).toEqual([{rejected:undefined},{rejected:["groups[0].chapters"]}]);
 expect(result).toHaveLength(13);expect(result[0].title).toBe("总合并");
 expect(receipt).toMatchObject({refineReasons:{merge_request_failed:1,fit_merged:1}});
});
