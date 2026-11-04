import "fake-indexeddb/auto";
import {beforeEach,expect,it} from "vitest";
import {getDatabase} from "../storage/db";
import {contextKnowledge} from "../test/context-fixture";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {planWikiTopics} from "./wiki-topic-plan";
import {MAX_WIKI_MAIN_CHAPTERS,MAX_WIKI_PARTS,MAX_WIKI_WINDOW_CANDIDATES,WIKI_CHAPTER_ACCEPT_LIMIT,wikiWindowTarget} from "./wiki-outline-policy";
import {wikiParts} from "../shared/wiki-navigation";
import type {StructuredAIRequest} from "./provider";

const sections=(n:number)=>Array.from({length:n},(_,i)=>({...contextKnowledge().session.sections[0],id:`original-${i}`,title:`范围${i}`,kind:"finding" as const,body:`机制和条件 ${i}`}));
const settings={id:"ai-settings" as const,provider:"openai" as const,model:"fixture",baseUrl:"https://fixture.invalid",apiKey:"fixture",updatedAt:1};
beforeEach(async()=>{await(await getDatabase()).clear("semanticDecisionCache");});

it("publishes a stalled directory within the accept limit and reuses it on a rerun without new requests",async()=>{
 let calls=0;const systems:string[]=[];
 const provider={id:"accept-stalled",modelId:"fixture",testConnection:async()=>({ok:true as const,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  // No merge proposal: the stalled regrouping rounds and their acceptance are under test.
  if(JSON.parse(request.prompt).presentation==="wiki_chapter_merge")return request.validate({groups:[]});
  calls++;systems.push(request.system);const data=JSON.parse(request.prompt);
  return request.validate({pages:data.sections.map((item:{id:string},i:number)=>({title:`主体${i}`,question:`主体${i}的职责是什么？`,group:i%2?"技术":"产品",subtopics:[{title:`机制${i}`,sectionIds:[item.id]}]}))});
 }};
 const input=sections(12),run=()=>planWikiTopics(input,"zh-CN",createAtlasAIFromProvider(provider,settings),new AbortController().signal);
 expect(12).toBeGreaterThan(MAX_WIKI_MAIN_CHAPTERS);expect(12).toBeLessThanOrEqual(WIKI_CHAPTER_ACCEPT_LIMIT);
 const result=await run();
 expect(result).toHaveLength(12);expect(calls).toBe(3);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
 expect(await run()).toEqual(result);expect(calls).toBe(3);
 expect(systems.at(-1)).toContain(`at most ${MAX_WIKI_MAIN_CHAPTERS} main chapters`);
});

it("asks a local window for a few broad single-subject candidates grouped into parts",async()=>{
 const systems:string[]=[];
 await planWikiTopics(sections(2),"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  systems.push(request.system);const data=JSON.parse(request.prompt);
  return request.validate({pages:[{title:"数据保存",group:"技术",question:"如何保存消息",subtopics:[{title:"本地保存",sectionIds:data.sections.map((item:{id:string})=>item.id)}]}]});
 }},new AbortController().signal);
 expect(systems[0]).toContain(`at most ${MAX_WIKI_WINDOW_CANDIDATES} broad main chapters`);
 expect(systems[0]).toContain(`at most ${MAX_WIKI_PARTS} parts in reading order`);
});

it("groups consecutive chapters into parts only when the Wiki has more than one",()=>{
 const page=(id:string,wikiGroup?:string)=>({id,wikiGroup});
 expect(wikiParts([page("a","技术"),page("b","技术")])).toEqual([]);
 expect(wikiParts([page("a"),page("b","未分类")])).toEqual([]);
 expect(wikiParts([page("a","产品"),page("b","产品"),page("c","技术"),page("d")]).map(part=>[part.name,part.pages.map(item=>item.id)])).toEqual([["产品",["a","b"]],["技术",["c"]],["",["d"]]]);
});

it("splits the chapter target across convergence windows so one round sums to about the target",()=>{
 expect([16,15,15].map(size=>wikiWindowTarget(size,46))).toEqual([3,3,3]);
 expect([16,15,15].map(size=>wikiWindowTarget(size,46)).reduce((sum,value)=>sum+value,0)).toBeLessThanOrEqual(MAX_WIKI_MAIN_CHAPTERS);
 expect(wikiWindowTarget(3,46)).toBe(2);expect(wikiWindowTarget(1,46)).toBe(1);expect(wikiWindowTarget(2,2)).toBe(2);
});

it("converges a windowed catalogue in one windowed round plus one global pass, even with more windows than the base request cap",async()=>{
 const windows:Array<{size:number;target:number;limit:number}>=[],globals:number[]=[];let leaves=0;
 const long=(text:string)=>`${text}：${"保留原始条件、版本、限定和反例，便于之后复习。".repeat(6)}`.slice(0,230);
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership")return request.validate({owners:Object.fromEntries(data.slots.map((slot:{id:string;choices:string[]})=>[slot.id,slot.choices[0]]))});
  const ids:string[]=data.sections.map((item:{id:string})=>item.id);
  if(!data.convergence){
   leaves++;expect(request.system).toContain(`at most ${MAX_WIKI_WINDOW_CANDIDATES} broad main chapters`);
   // Seven broad candidates per window, each with disjoint children: many convergence candidates.
   return request.validate({pages:Array.from({length:7},(_,p)=>({title:`窗口${leaves}主题${p}`,question:long(`主题${p}`),group:"",subtopics:Array.from({length:3},(_,c)=>({title:`窗口${leaves}主题${p}机制${c}`,question:long(`机制${c}`),sectionIds:ids.filter((_,i)=>i%21===p*3+c)}))})).filter(page=>page.subtopics.every(child=>child.sectionIds.length))});
  }
  const target=data.convergence.targetMainCount;
  if(ids.length===data.convergence.previousMainCount&&target<data.convergence.maxMainCount)windows.push({size:ids.length,target,limit:request.maxOutputTokens!});else globals.push(target);
  return request.validate({pages:Array.from({length:target},(_,p)=>({title:`主体${p}`,question:`主体${p}的范围`,group:p%2?"技术":"产品",subtopics:[{title:`机制${p}`,sectionIds:ids.filter((_,i)=>i%target===p)}]}))});
 }};
 const input=sections(168).map((item,i)=>({...item,body:long(`材料${i}`)}));
 const result=await planWikiTopics(input,"zh-CN",ai,new AbortController().signal);
 expect(windows.length).toBeGreaterThan(1);
 // Shares (at least two each) add up to about the target; one global pass merges the rest.
 expect(windows.reduce((sum,window)=>sum+window.target,0)).toBeLessThanOrEqual(windows.length*2+MAX_WIKI_MAIN_CHAPTERS);
 expect(globals.length).toBeLessThanOrEqual(1);
 expect(result.length).toBeLessThanOrEqual(MAX_WIKI_MAIN_CHAPTERS);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
});
