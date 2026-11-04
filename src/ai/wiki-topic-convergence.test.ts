import "fake-indexeddb/auto";
import {beforeEach,expect,it,vi} from "vitest";
import {getDatabase} from "../storage/db";
import {contextKnowledge} from "../test/context-fixture";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {createWikiTopicPlanner,planWikiTopics,type WikiPlanReceipt} from "./wiki-topic-plan";
import {validateWikiPlan} from "./wiki-plan-contract";
import {assertWikiOutline,MAX_WIKI_MAIN_CHAPTERS,WIKI_CHAPTER_ACCEPT_LIMIT} from "./wiki-outline-policy";
import {wikiCandidateSection,expandWikiCandidates,wikiConvergenceCandidates} from "./wiki-topic-convergence";
import {AIProviderResponseError} from "./provider-errors";
import {requestBudget} from "./request-policy";
import type {StructuredAIRequest} from "./provider";
import type {DirectoryPage} from "./wiki-directory";

const sections=(n:number)=>Array.from({length:n},(_,i)=>({...contextKnowledge().session.sections[0],id:`original-${i}`,title:`范围${i}`,kind:"finding" as const,body:`机制和条件 ${i}`}));
const plan=(request:Pick<StructuredAIRequest<unknown>,"prompt">,count:number)=>{
 const data=JSON.parse(request.prompt),size=Math.min(count,data.sections.length);
 return {pages:Array.from({length:size},(_,i)=>({title:`主体${i}`,question:`主体${i}的职责是什么？`,group:"",subtopics:[{key:`t${i}`,title:`机制${i}`,question:`机制${i}的边界是什么？`}]})),assignments:Object.fromEntries(data.sections.map((item:{id:string},i:number)=>[item.id,`t${i%size}`]))};
};
beforeEach(async()=>{await(await getDatabase()).clear("semanticDecisionCache");});

it("retains complete oversized candidates only inside planning while publication and ownership remain strict",()=>{
 const items=sections(24).map((item,i)=>({...item,id:`m${i}`}));const request={prompt:JSON.stringify({sections:items})},value=plan(request,24);
 expect(validateWikiPlan(value,items,{candidate:true})).toHaveLength(24);
 expect(()=>validateWikiPlan(value,items)).toThrowError(expect.objectContaining({code:"PROVIDER_SCHEMA_wiki_directory_chapter_count",wikiDirectoryCounts:{mainCount:24,maxMainCount:14,subtopicCount:24}}));
 delete value.assignments.m23;expect(()=>validateWikiPlan(value,items,{candidate:true})).toThrowError(expect.objectContaining({code:"PROVIDER_SCHEMA_wiki_directory_coverage"}));
});

it("assigns 151 notes to global parents immediately and reuses every successful model request",async()=>{
 const input=sections(151),before=structuredClone(input);let leaves=0,globals=0,convergences=0,receipt:WikiPlanReceipt|undefined;
 const provider={id:"151-convergence",modelId:"fixture",testConnection:async()=>({ok:true as const,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);let count:number;
  if(data.convergence){convergences++;expect(data.convergence.targetMainCount).toBeLessThanOrEqual(10);count=6;}
  else if(data.sections.some((item:{subtopics?:unknown[]})=>item.subtopics?.length)){globals++;count=12;}
  else{leaves++;count=6;}
  return request.validate(plan(request,count));
 }};
 const ai=createAtlasAIFromProvider(provider,{id:"ai-settings",provider:"openai",model:"fixture",baseUrl:"https://fixture.invalid",apiKey:"fixture",updatedAt:1}),fetch=vi.spyOn(globalThis,"fetch");
 try{
  const run=()=>planWikiTopics(input,"zh-CN",ai,new AbortController().signal,value=>{receipt=value;});const result=await run();
  expect(leaves).toBeGreaterThan(1);expect(globals).toBe(0);expect(convergences).toBe(1);expect(result).toHaveLength(6);expect(()=>assertWikiOutline(result)).not.toThrow();
  expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());expect(result.flatMap(page=>page.subtopics!.flatMap(child=>child.sectionIds)).sort()).toEqual(input.map(item=>item.id).sort());
  const calls=[leaves,globals,convergences];await run();expect([leaves,globals,convergences]).toEqual(calls);expect(receipt!.repairCount).toBe(0);expect(receipt!.convergenceCount).toBeLessThanOrEqual(4);expect(input).toEqual(before);expect(fetch).not.toHaveBeenCalled();
 }finally{fetch.mockRestore();}
});

it("uses explicit progress targets for 24 to 18 to 10 rather than treating eighteen candidates as invalid JSON",async()=>{
 let calls=0;const targets:number[]=[];let receipt:WikiPlanReceipt|undefined;
 // The merge plan proposes no merges, so the regrouping rounds are the fallback under test.
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt);if(data.presentation==="wiki_chapter_merge")return request.validate({groups:[]});calls++;if(data.convergence)targets.push(data.convergence.previousMainCount);return request.validate(plan(request,calls===1?24:calls===2?18:10));}};
 const result=await planWikiTopics(sections(24),"zh-CN",ai,new AbortController().signal,value=>{receipt=value;});expect(result).toHaveLength(10);expect(targets).toEqual([24,18]);expect(receipt).toMatchObject({requests:5,convergenceCount:2,repairCount:0,candidateCount:10,mergedGroups:0});
});

it("stops a stubborn catalogue and permits one fresh feedback-guided attempt on explicit retry",async()=>{
 let calls=0;const provider={id:"stubborn-convergence",modelId:"fixture",testConnection:async()=>({ok:true as const,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{if(JSON.parse(request.prompt).presentation==="wiki_chapter_merge")return request.validate({groups:[]});calls++;return request.validate(plan(request,JSON.parse(request.prompt).sections.length));}};
 const ai=createAtlasAIFromProvider(provider,{id:"ai-settings",provider:"openai",model:"fixture",baseUrl:"https://fixture.invalid",apiKey:"fixture",updatedAt:1});const run=()=>planWikiTopics(sections(24),"zh-CN",ai,new AbortController().signal);
 await expect(run()).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_no_convergence",wikiDirectoryCounts:{mainCount:24,maxMainCount:10},wikiPlanningResume:{reason:"stalled"},message:expect.stringContaining("24 个候选章节")});expect(calls).toBe(3);
 await expect(run()).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_no_convergence",wikiPlanningResume:{reason:"stalled"}});expect(calls).toBe(4);
});

it("bounds slow convergence across all requests rather than restarting the allowance per round",async()=>{
 let calls=0,receipt:WikiPlanReceipt|undefined;
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt);if(data.presentation==="wiki_chapter_merge")return request.validate({groups:[]});calls++;return request.validate(plan(request,data.sections.length-(data.convergence?1:0)));}};
 await expect(planWikiTopics(sections(30),"zh-CN",ai,new AbortController().signal,value=>{receipt=value;})).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_no_convergence",wikiDirectoryCounts:{mainCount:26,maxMainCount:10}});
 expect(calls).toBe(5);expect(receipt).toMatchObject({convergenceCount:4,repairCount:0,reconciled:false});expect(receipt!.convergenceTokens).toBeLessThanOrEqual(24000);
});

it("keeps output recovery and convergence targets together when a reduction response is truncated",async()=>{
 let calls=0;const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls++;if(calls===2)throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED","converging",{outputTokenLimit:request.maxOutputTokens!,receivedCharacters:900});if(calls>1)expect(JSON.parse(request.prompt).convergence).toMatchObject({previousMainCount:24});return request.validate(plan(request,calls===1?24:9));}};
 const result=await planWikiTopics(sections(24),"zh-CN",ai,new AbortController().signal);expect(result).toHaveLength(9);expect(calls).toBe(3);expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(sections(24).map(item=>item.id).sort());
});

it("retains every existing child beyond the compact preview, disambiguating labels without changing evidence",()=>{
 const originals:DirectoryPage[]=Array.from({length:2},(_,parent)=>({title:`原主题${parent}`,group:"",question:`原范围${parent}`,sectionIds:Array.from({length:15},(_,child)=>`p${parent}-${child}`),subtopics:Array.from({length:15},(_,child)=>({title:`机制${child}`,question:`父主题${parent}内的限定${child}`,sectionIds:[`p${parent}-${child}`]}))}));
 const before=structuredClone(originals),items=originals.map(wikiCandidateSection);expect(items[0].wikiSubtopics).toHaveLength(15);expect(items[0].body).toContain("限定14");
 const result=expandWikiCandidates([{title:"共同主体",group:"",question:"共同范围",sectionIds:items.map(item=>item.id),subtopics:[]}],items,originals);
 expect(result[0].subtopics).toHaveLength(30);expect(new Set(result[0].subtopics!.map(child=>child.title)).size).toBe(30);expect(result[0].subtopics!.some(child=>child.question.includes("限定14"))).toBe(true);expect(result[0].sectionIds).toHaveLength(30);expect(originals).toEqual(before);
 const emoji=originals.map((page,index)=>({...page,title:"🧩".repeat(15),subtopics:[{title:"🧩".repeat(40),question:`不同范围${index}`,sectionIds:page.sectionIds}]}));const emojiItems=emoji.map(wikiCandidateSection),emojiResult=expandWikiCandidates([{...result[0],sectionIds:emojiItems.map(item=>item.id),subtopics:[]}],emojiItems,emoji);
 expect(emojiResult[0].subtopics!.every(child=>child.title.length<=100&&!/[\uD800-\uDBFF]$/u.test(child.title))).toBe(true);
 const signed=originals.map((page,index)=>({...page,subtopics:[{title:"电压边界",question:index?"5V":"-5V",sectionIds:page.sectionIds}]})),signedItems=signed.map(wikiCandidateSection);
 expect(expandWikiCandidates([{...result[0],sectionIds:signedItems.map(item=>item.id),subtopics:[]}],signedItems,signed)[0].subtopics!.map(child=>child.question)).toEqual(["-5V","5V"]);
});

it("regroups a verbose child roster even when it already fits the main-chapter limit, retaining every original",async()=>{
 const input=sections(12),before=structuredClone(input);let calls=0;
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;const data=JSON.parse(request.prompt),ids=data.sections.map((item:{id:string})=>item.id);
  if(data.editorialGrouping){
   expect(data.parentAssignmentOnly).toBeUndefined();expect(request.system).toContain("not the old headings");
   return request.validate({pages:[{title:"同步机制",subtopics:Array.from({length:3},(_,i)=>({title:`机制${i}`,sectionIds:ids.filter((_:string,index:number)=>index%3===i)}))}]});
  }
  return request.validate({pages:[{title:"同步机制",subtopics:ids.map((id:string,index:number)=>({title:`局部片段${index}`,sectionIds:[id]}))}]});
 }};
 const result=await planWikiTopics(input,"zh-CN",ai,new AbortController().signal);
 expect(calls).toBe(2);expect(result).toHaveLength(1);expect(result[0].subtopics).toHaveLength(3);
 expect(result[0].sectionIds).toEqual(input.map(item=>item.id));expect(result[0].subtopics!.flatMap(child=>child.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());expect(input).toEqual(before);
});

it("keeps connected shared-support scopes together during editorial regrouping",()=>{
 const pages:DirectoryPage[]=[{title:"电源",question:"模式",group:"",sectionIds:["a","b","c","d"],subtopics:[{title:"负压",question:"-5V",sectionIds:["a","b"]},{title:"保护",question:"故障时断电",sectionIds:["b","c"]},{title:"正压",question:"5V",sectionIds:["d"]}]}];
 const candidates=wikiConvergenceCandidates(pages);
 expect(candidates).toHaveLength(2);expect(candidates[0].sectionIds).toEqual(["a","b","c"]);expect(candidates[0].subtopics!.map(child=>child.question)).toEqual(["-5V","故障时断电"]);
 const items=candidates.map(wikiCandidateSection),plan=[{title:"电源",question:"如何供电",group:"",sectionIds:items.map(item=>item.id),subtopics:[{title:"运行模式",question:"保留各模式条件",sectionIds:items.map(item=>item.id)}]}];
 expect(expandWikiCandidates(plan,items,candidates)[0].subtopics).toEqual([{title:"运行模式",question:"保留各模式条件",sectionIds:["a","b","c","d"]}]);
});

it("honors cancellation before starting any global convergence",async()=>{
 const controller=new AbortController();let calls=0;const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls++;controller.abort();return request.validate(plan(request,12));}};
 await expect(planWikiTopics(sections(12),"zh-CN",ai,controller.signal)).rejects.toThrow();expect(calls).toBe(1);
});

it("publishes an acceptable directory when windowed convergence spends its budget, with refinement still running",async()=>{
 // Every round keeps each subtopic, so the candidates stay too large for one
 // request; the budget ends mid-round with a fully attributed directory.
 const rounds=new Map<number,number>(),presentations:string[]=[];let uid=0;
 const topic=()=>{uid++;return {key:`t${uid}`,title:`子主题${uid}`+"说明".repeat(40),question:`问题${uid}`+"条件边界".repeat(50)};};
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt),convergence=data.convergence;presentations.push(data.presentation);
  if(data.presentation==="wiki_chapter_merge")return request.validate({groups:[]});
  if(data.presentation==="wiki_topic_overlap_audit")return request.validate({groups:[]});
  if(data.presentation==="wiki_subtopic_placement_audit")return request.validate({moves:[]});
  const index=convergence?rounds.get(convergence.round)??0:0;if(convergence)rounds.set(convergence.round,index+1);
  const size=Math.min(data.sections.length,convergence?(index<3-convergence.round?3:2):4),topics=data.sections.map(topic);
  const pages=Array.from({length:size},(_,i)=>({title:i===0&&index===0?`检索${uid}与同步`:`主体${uid}-${i}`,question:`主体${uid}-${i}的职责是什么？`,group:"",subtopics:topics.filter((_:unknown,j:number)=>j%size===i)}));
  return request.validate({pages,assignments:Object.fromEntries(data.sections.map((item:{id:string},i:number)=>[item.id,topics[i].key]))});
 }};
 const planner=createWikiTopicPlanner("zh-CN",ai,new AbortController().signal,undefined,undefined,{refine:true});
 planner.append(sections(104));
 const result=await planner.finish();
 expect(result.length).toBeGreaterThan(MAX_WIKI_MAIN_CHAPTERS);expect(result.length).toBeLessThanOrEqual(WIKI_CHAPTER_ACCEPT_LIMIT);expect(presentations).toContain("wiki_topic_overlap_audit");
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(sections(104).map(item=>item.id).sort());
});

it("drops subtopic questions so the placement audit of a large directory still fits its budget",async()=>{
 let uid=0,placement:StructuredAIRequest<unknown>|undefined;
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_topic_overlap_audit")return request.validate({groups:[]});
  if(data.presentation==="wiki_subtopic_placement_audit"){placement=request as StructuredAIRequest<unknown>;return request.validate({moves:[]});}
  // Up to seven chapters per window; every subtopic has a full-length question.
  const topics=data.sections.map(()=>{uid++;return {key:`t${uid}`,title:`子主题${uid}`,question:`子主题${uid}`+"需要说明的条件与边界".repeat(22)};});
  const size=Math.min(7,Math.ceil(data.sections.length/3)),pages=Array.from({length:size},(_,i)=>({title:`主体${uid}-${i}`,question:`主体${uid}-${i}的职责是什么？`,group:"",subtopics:topics.filter((_:unknown,j:number)=>j%size===i)}));
  return request.validate({pages,assignments:Object.fromEntries(data.sections.map((item:{id:string},i:number)=>[item.id,topics[i].key]))});
 }};
 const planner=createWikiTopicPlanner("zh-CN",ai,new AbortController().signal,undefined,undefined,{refine:true});
 planner.append(sections(42));
 expect((await planner.finish()).length).toBeGreaterThanOrEqual(6);
 const budget=requestBudget(placement!),chapters=JSON.parse(placement!.prompt).chapters as Array<{subtopics:Array<{question?:string}>}>;
 expect(budget.inputTokens).toBeLessThanOrEqual(budget.maxInputTokens);
 expect(chapters.flatMap(chapter=>chapter.subtopics)).toHaveLength(42);
});
