import "fake-indexeddb/auto";
import {beforeEach,expect,it} from "vitest";
import {getDatabase} from "../storage/db";
import {contextKnowledge} from "../test/context-fixture";
import {createWikiTopicPlanner,type WikiPlanReceipt} from "./wiki-topic-plan";
import type {StructuredAIRequest} from "./provider";

const TITLES=["产品定位","竞品对比","阅读界面","交互界面","检索引擎","发布计划","技术选型","定价与推广"];
const notes=(titles=TITLES)=>titles.map((title,i)=>({...contextKnowledge().session.sections[0],id:`note-${i}`,title,kind:"finding" as const,body:`${title}的机制和条件 ${i}`}));
const page=(title:string,i:number)=>({title,question:`${title}的范围？`,group:"",subtopics:[{key:`t${i}`,title:`${title}细节`,question:`${title}细节是什么？`}]});
beforeEach(async()=>{await(await getDatabase()).clear("semanticDecisionCache");});

function provider(script:{fit?:unknown;audit:unknown;overlap?:string[];paired?:string[];overlapSubtopics?:number;pairedLeaf?:string;placement?:unknown;sharedLeaf?:boolean}){
 const calls:string[]=[],seen:Array<{focus:string;titleCandidates?:string[]}>=[];
 return {calls,seen,ai:{modelId:"fixture",generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_chapter_merge"){calls.push("fit");seen.push({focus:"fit",titleCandidates:[String(data.fit?.targetChapters),...data.chapters.map((chapter:{materials?:number})=>String(chapter.materials))]});return request.validate(script.fit??{groups:[]});}
  if(data.presentation==="wiki_subtopic_placement_audit"){calls.push("placement");return request.validate(script.placement??{moves:[]});}
  if(data.presentation==="wiki_topic_overlap_audit"){calls.push("audit");seen.push({focus:"audit",titleCandidates:data.chapters.map((chapter:{title:string})=>chapter.title)});if(script.audit instanceof Error)throw script.audit;return request.validate(script.audit);}
  const ids=data.sections.map((item:{id:string})=>item.id);
  if(data.convergence?.focus){
   calls.push(data.convergence.focus);seen.push(data.convergence);
   if(data.convergence.focus==="overlap"&&script.overlapSubtopics){
    const n=script.overlapSubtopics;
    return request.validate({pages:[{title:"界面",question:"界面范围？",group:"",subtopics:Array.from({length:n},(_,i)=>({key:`t${i}`,title:`界面细节${i}`,question:`界面细节${i}？`}))}],assignments:Object.fromEntries(ids.map((id:string,i:number)=>[id,`t${i%n}`]))});
   }
   const titles=(data.convergence.focus==="overlap"?script.overlap:script.paired)??["未变化"];
   return request.validate({pages:titles.map(page),assignments:Object.fromEntries(ids.map((id:string,i:number)=>[id,`t${i%titles.length}`]))});
  }
  calls.push("leaf");
  // One two-subtopic paired chapter owning the first two notes, then one chapter per note.
  // Both subtopics of the first chapter cite the same two notes.
  if(script.pairedLeaf&&script.sharedLeaf){
   const rest=data.sections.slice(2).map((item:{title:string},i:number)=>({...page(item.title,i+2),sectionIds:[ids[i+2]],subtopics:[{title:`${item.title}细节`,question:`${item.title}细节是什么？`,sectionIds:[ids[i+2]]}]}));
   return request.validate({pages:[{title:script.pairedLeaf,question:"范围？",group:"",sectionIds:ids.slice(0,2),subtopics:[{title:"质量评估方法",question:"如何评估？",sectionIds:ids.slice(0,2)},{title:"导出结构",question:"如何导出？",sectionIds:ids.slice(0,2)}]},...rest]});
  }
  if(script.pairedLeaf){
   const rest=data.sections.slice(2).map((item:{title:string},i:number)=>page(item.title,i+2));
   return request.validate({pages:[{title:script.pairedLeaf,question:"范围？",group:"",subtopics:[{key:"t0",title:"质量评估方法",question:"如何评估？"},{key:"t1",title:"导出结构",question:"如何导出？"}]},...rest],assignments:Object.fromEntries(ids.map((id:string,i:number)=>[id,`t${i}`]))});
  }
  return request.validate({pages:data.sections.map((item:{title:string},i:number)=>page(item.title,i)),assignments:Object.fromEntries(ids.map((id:string,i:number)=>[id,`t${i}`]))});
 }}};
}
async function plan(script:Parameters<typeof provider>[0],refine=true,titles=TITLES){
 const {ai,calls,seen}=provider(script);let receipt:WikiPlanReceipt|undefined;
 const planner=createWikiTopicPlanner("zh-CN",ai,new AbortController().signal,value=>{receipt=value;},undefined,{refine});
 planner.append(notes(titles));
 const pages=await planner.finish();
 return {pages,calls,seen,receipt:receipt!};
}

it("merges an audited overlap group and resolves a paired title before writing",async()=>{
 const {pages,calls,seen,receipt}=await plan({audit:{groups:[["c2","c3"]]},overlap:["界面设计"],paired:["定价策略","推广渠道"]});
 // Titles are resolved first, so the overlap audit reviews the renamed chapter list.
 expect(seen.find(item=>item.focus==="audit")?.titleCandidates).toContain("定价策略");
 expect(calls.filter(call=>call==="audit")).toHaveLength(1);
 // A one-candidate chapter cannot split; it is renamed by its main subject and keeps all material.
 expect(pages.map(page=>page.title)).toEqual(["产品定位","竞品对比","界面设计","检索引擎","发布计划","技术选型","定价策略"]);
 expect(pages.at(-1)!.sectionIds).toEqual(["note-7"]);
 expect(receipt).toMatchObject({overlapMerges:1,pairedRefined:1});
 // Every material keeps exactly one owner.
 expect(pages.flatMap(page=>page.sectionIds).sort()).toEqual(notes().map(note=>note.id).sort());
},20000);

it("keeps chapters when the audit fails or a split is still paired, and skips refinement when disabled",async()=>{
 const failed=await plan({audit:new Error("down"),paired:["定价与推广方案"]});
 expect(failed.pages.map(page=>page.title)).toEqual(TITLES);expect(failed.receipt).toMatchObject({overlapMerges:0,pairedRefined:0});
 const off=await plan({audit:{groups:[["c2","c3"]]}},false);
 expect(off.calls).toEqual(["leaf"]);expect(off.pages.map(page=>page.title)).toEqual(TITLES);
},20000);

it("gives the paired review single-subject candidates and records why refinements were discarded",async()=>{
 const {seen,receipt}=await plan({audit:{groups:[["c2","c3"]]},overlap:["界面设计"],paired:["定价与推广方案"]});
 expect(seen.find(item=>item.focus==="paired")?.titleCandidates).toEqual(["定价","推广"]);
 expect(receipt.refineReasons).toMatchObject({paired_still_paired:1});
 const many=Array.from({length:10},(_,i)=>`界面方案${i}`);
 const kept=await plan({audit:{groups:[many.map((_,i)=>`c${i}`)]},overlapSubtopics:9},true,many);
 // A merge that only concatenates headings (9 subtopics) keeps the chapters apart.
 expect(kept.pages.map(page=>page.title)).toEqual(many);expect(kept.receipt).toMatchObject({overlapMerges:0,refineReasons:{overlap_too_many_subtopics:1}});
 const renamed=await plan({audit:{groups:[]},paired:["定价策略"]});
 expect(renamed.receipt.refineReasons).toMatchObject({paired_renamed:1});
},20000);

it("discards a paired-title review that picks a bare word",async()=>{
 const {pages,receipt}=await plan({audit:{groups:[]},paired:["推广"]});
 expect(pages.at(-1)!.title).toBe("定价与推广");expect(receipt.refineReasons).toMatchObject({paired_too_short:1});
},20000);

it("keeps a small paired chapter instead of splitting it into one-subtopic chapters",async()=>{
 const {pages,receipt}=await plan({audit:{groups:[]},paired:["上下文质量评估","Context Pack 导出"],pairedLeaf:"上下文质量与导出"});
 expect(pages[0].title).toBe("上下文质量与导出");expect(pages[0].subtopics).toHaveLength(2);
 expect(receipt.refineReasons).toMatchObject({paired_thin_split:1});
},20000);

it("moves a misplaced subtopic with its material, but never empties a chapter or splits shared material",async()=>{
 const moved=await plan({audit:{groups:[]},paired:["上下文质量与导出方案"],pairedLeaf:"上下文质量与导出",placement:{moves:[{subtopicId:"c0.s1",toChapterId:"c3"}]}});
 expect(moved.pages[0].subtopics!.map(topic=>topic.title)).toEqual(["质量评估方法"]);expect(moved.pages[0].sectionIds).toEqual(["note-0"]);
 expect(moved.pages[3].subtopics!.map(topic=>topic.title)).toContain("导出结构");expect(moved.pages[3].sectionIds).toEqual(["note-1","note-4"]);
 expect(moved.receipt).toMatchObject({placementMoves:1,refineReasons:{placement_moved:1}});
 expect(moved.pages.flatMap(page=>page.sectionIds).sort()).toEqual(notes().map(note=>note.id).sort());
 const last=await plan({audit:{groups:[]},placement:{moves:[{subtopicId:"c3.s0",toChapterId:"c4"}]}});
 expect(last.receipt).toMatchObject({placementMoves:0,refineReasons:{placement_last:1}});
 const shared=await plan({audit:{groups:[]},paired:["上下文质量与导出方案"],pairedLeaf:"上下文质量与导出",sharedLeaf:true,placement:{moves:[{subtopicId:"c0.s1",toChapterId:"c3"}]}});
 expect(shared.receipt).toMatchObject({placementMoves:0,refineReasons:{placement_shared:1}});expect(shared.pages[0].subtopics).toHaveLength(2);
},20000);

it("refuses a merge that would turn one chapter into a catch-all",async()=>{
 const {pages,receipt}=await plan({audit:{groups:[["c0","c1","c2","c3"]]},overlap:["产品与界面总览"]});
 // Four of eight chapters (50% of all material) would become one chapter.
 expect(pages).toHaveLength(8);expect(receipt).toMatchObject({overlapMerges:0,refineReasons:{overlap_too_large:1}});
},20000);

it("joins an audited overlap locally under the audit's name when the focused re-plan keeps it apart",async()=>{
 const {pages,receipt,calls}=await plan({audit:{groups:[{chapters:["c2","c3"],title:"界面设计",question:"阅读与交互界面如何设计？"}]},overlap:["阅读界面","交互界面"]});
 // A named group needs no focused re-plan request.
 expect(calls).not.toContain("overlap");
 expect(pages.map(page=>page.title)).toEqual(["产品定位","竞品对比","界面设计","检索引擎","发布计划","技术选型","定价与推广"]);
 expect(pages[2]).toMatchObject({question:"阅读与交互界面如何设计？",sectionIds:["note-2","note-3"]});
 expect(pages[2].subtopics!.map(topic=>topic.title)).toEqual(["阅读界面细节","交互界面细节"]);
 expect(receipt).toMatchObject({overlapMerges:1,refineReasons:{overlap_local_merge:1}});
 // Without a usable name the audit cannot merge on its own; a paired name is not usable.
 const unnamed=await plan({audit:{groups:[{chapters:["c2","c3"],title:"阅读与交互",question:"范围？"}]},overlap:["阅读界面","交互界面"]});
 expect(unnamed.pages).toHaveLength(8);expect(unnamed.receipt.refineReasons).toMatchObject({overlap_kept_apart:1});
},20000);

it("keeps the valid placement moves when the audit also lists unusable ones",async()=>{
 const moved=await plan({audit:{groups:[]},paired:["上下文质量与导出方案"],pairedLeaf:"上下文质量与导出",placement:{moves:[{subtopicId:"c9.s9",toChapterId:"c1"},{subtopicId:"c0.s1",toChapterId:"c0"},{subtopicId:"c0.s1",toChapterId:"c3"}]}});
 expect(moved.receipt).toMatchObject({placementMoves:1,refineReasons:{placement_moved:1}});
 expect(moved.pages[3].subtopics!.map(topic=>topic.title)).toContain("导出结构");
},20000);

it("joins chapters toward the size the material supports, and keeps distinct chapters when the plan declines",async()=>{
 const {pages,seen,receipt}=await plan({audit:{groups:[]},fit:{groups:[{chapters:["c0","c1"],title:"市场定位",question:"产品面向谁、与竞品有何不同？"}]}});
 // Eight materials support four chapters; the plan sees each chapter's material count.
 expect(seen.find(item=>item.focus==="fit")?.titleCandidates).toEqual(["4","1","1","1","1","1","1","1","1"]);
 expect(pages.map(page=>page.title)).toEqual(["市场定位","阅读界面","交互界面","检索引擎","发布计划","技术选型","定价与推广"]);
 expect(receipt).toMatchObject({chapterTarget:4,refineReasons:{fit_merged:1}});
 const declined=await plan({audit:{groups:[]}});
 expect(declined.pages).toHaveLength(8);expect(declined.receipt.refineReasons).toMatchObject({fit_kept:1});
},20000);
