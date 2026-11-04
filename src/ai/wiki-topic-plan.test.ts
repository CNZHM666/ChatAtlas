import {withWikiOutline} from "../test/wiki-outline-fixture";
import {expect,it,vi} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {planWikiTopics,topicPlanInstructions} from "./wiki-topic-plan";
import type {StructuredAIRequest, AtlasAIProvider} from "./provider";
it("runs independent catalogue windows concurrently with identical requests and ordered ownership",async()=>{
 const sections=Array.from({length:80},(_,index)=>({...contextKnowledge().session.sections[0],id:`parallel-${index}`,kind:"finding" as const,title:`主题${index%4}`,body:`独特说明${index}`}));
 const generate=async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt),groups=new Map<string,string[]>();
  for(const section of data.sections)groups.set(section.title,[...groups.get(section.title)??[],section.id]);
  return request.validate(withWikiOutline({pages:[...groups].map(([title,sectionIds])=>({title,group:"技术",question:title,sectionIds}))}));
 };
 const serial:string[]=[],parallel:string[]=[],pending:Array<()=>void>=[];let active=0,maximum=0;
 const signal=new AbortController().signal;
 const expected=await planWikiTopics(sections,"zh-CN",{generateStructured:async request=>{serial.push(request.prompt);return generate(request);}},signal);
 const task=planWikiTopics(sections,"zh-CN",{capabilities:{maxConcurrency:3},generateStructured:async request=>{
  parallel.push(request.prompt);active++;maximum=Math.max(maximum,active);
  if(parallel.length<=3)await new Promise<void>(resolve=>pending.push(resolve));
  try{return await generate(request);}finally{active--;}
 }},signal);
 await vi.waitFor(()=>expect(pending).toHaveLength(3));
 pending.reverse().forEach(resolve=>resolve());
 expect(await task).toEqual(expected);expect(maximum).toBe(3);
 expect([...parallel].sort()).toEqual([...serial].sort());
});
it("plans one bounded global topic roster without retransmitting original history",async()=>{
 const sections=contextKnowledge().session.sections.map(section=>({...section,kind:"finding" as const}));
 const calls=vi.fn();const ai:Pick<AtlasAIProvider,"generateStructured">={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls(request);const data=JSON.parse(request.prompt);return request.validate(withWikiOutline({pages:[{title:"核心架构",group:"技术",question:"如何保存消息并预览？",sectionIds:data.sections.map((section:{id:string})=>section.id).reverse()}]}));}};
 const pages=await planWikiTopics(sections,"zh-CN",ai,new AbortController().signal);
 expect(pages).toHaveLength(1);expect(pages[0].sectionIds).toEqual(["database","sidebar"]);expect(calls).toHaveBeenCalledOnce();
 expect(topicPlanInstructions(pages)).toContain("GLOBAL WIKI TOPIC OWNERSHIP");
 expect(JSON.parse(calls.mock.calls[0][0].prompt).sections[0].lead.length).toBeLessThanOrEqual(420);
});
it("partitions a large catalogue, reconciles batch boundaries and preserves every ID",async()=>{
 const sections=Array.from({length:80},(_,index)=>({...contextKnowledge().session.sections[0],id:`page-${index}`,kind:"finding" as const,title:`主题${index%4}`,wikiQuestion:undefined,body:`独特说明${index}`}));
 const calls=vi.fn();
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls(request);const data=JSON.parse(request.prompt);const owners=new Map<string,string[]>();
  for(const section of data.sections){const key=section.title;owners.set(key,[...owners.get(key)??[],section.id]);}
  return request.validate(withWikiOutline({pages:[...owners].map(([title,sectionIds])=>({title,group:"技术",question:title,sectionIds}))}));
 }};
 const pages=await planWikiTopics(sections,"zh-CN",ai,new AbortController().signal);
 expect(pages).toHaveLength(4);expect(new Set(pages.flatMap(page=>page.sectionIds))).toEqual(new Set(sections.map(section=>section.id)));expect(calls.mock.calls.length).toBeGreaterThan(1);
 const controller=new AbortController();controller.abort();const before=calls.mock.calls.length;
 await expect(planWikiTopics(sections, "zh-CN",ai,controller.signal)).rejects.toThrow();expect(calls).toHaveBeenCalledTimes(before);
});

it("retains subtopic ownership when reconciling catalogue batches",async()=>{
 const sections=Array.from({length:42},(_,index)=>({...contextKnowledge().session.sections[0],id:`fragment${index}`,kind:"finding" as const,title:`主体${index%2}`,body:`机制${index}`}));
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt),groups=new Map<string,string[]>();for(const item of data.sections)groups.set(item.title,[...groups.get(item.title)??[],item.id]);return request.validate(withWikiOutline({pages:[...groups].map(([title,sectionIds])=>({title,group:"系统",question:`${title}如何运行？`,sectionIds,subtopics:[{title:"机制",question:"哪些条件？",sectionIds}]}))}));}};
 const pages=await planWikiTopics(sections,"zh-CN",ai,new AbortController().signal);expect(pages).toHaveLength(2);expect(pages.flatMap(page=>page.subtopics?.flatMap(topic=>topic.sectionIds)??[]).sort()).toEqual(sections.map(section=>section.id).sort());expect(topicPlanInstructions(pages)).toContain("data.passages[].wikiOwnerId");
});
it("anchors an update to the previous directory and accepts a plan only within the subtopic limit and without unowned chapters",async()=>{
 const sections=Array.from({length:80},(_,index)=>({...contextKnowledge().session.sections[0],id:`anchor-${index}`,kind:"finding" as const,title:index<60?`主题${index%3}`:"Atlas 项目知识工作区",wikiQuestion:undefined,body:`独特说明${index}`}));
 const prompts:Array<{system:string;prompt:string}>=[];
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  prompts.push({system:request.system,prompt:request.prompt});const data=JSON.parse(request.prompt);const owners=new Map<string,string[]>();
  for(const section of data.sections){const key=section.title;owners.set(key,[...owners.get(key)??[],section.id]);}
  // One heading per fragment: the planner's acceptance has to bound it.
  return request.validate({scope:[],pages:[...owners].map(([title,sectionIds])=>({title,group:"技术",question:title,sectionIds,subtopics:sectionIds.map((id:string,at:number)=>({title:`${title} 细节 ${at}`,question:"",sectionIds:[id]}))}))});
 }};
 const previousDirectory=[{title:"主题0",question:"主题0",subtopics:["细节"]}];
 const pages=await planWikiTopics(sections,"zh-CN",ai,new AbortController().signal,undefined,{conversations:1,documentNames:["Atlas 项目知识工作区"],previousDirectory});
 const global=prompts.filter(item=>JSON.parse(item.prompt).editorialGrouping);
 expect(global.length).toBeGreaterThan(0);
 for(const item of global){
  expect(JSON.parse(item.prompt)).toMatchObject({limits:{targetMainCount:6,maxSubtopicsPerChapter:10},previousDirectory});
  expect(item.system).toContain("PREVIOUS DIRECTORY");
 }
 expect(pages.map(page=>page.title)).not.toContain("Atlas 项目知识工作区");
 // Acceptance follows the chapters actually kept: at most 12 each and 60 in all.
 expect(Math.max(...pages.map(page=>page.subtopics?.length??0))).toBeLessThanOrEqual(12);
 expect(pages.reduce((sum,page)=>sum+(page.subtopics?.length??0),0)).toBeLessThanOrEqual(60);
 expect(new Set(pages.flatMap(page=>page.sectionIds))).toEqual(new Set(sections.map(section=>section.id)));
});
