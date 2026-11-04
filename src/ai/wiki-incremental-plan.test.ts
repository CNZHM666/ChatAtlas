import {expect,it,vi} from "vitest";
import {createWikiTopicPlanner,planWikiTopics} from "./wiki-topic-plan";
import {synthesizeCoveredFocus} from "./focus-coverage";
import {validateFocusResult} from "./focus-session";
import {contextKnowledge} from "../test/context-fixture";
import {transcriptPassages} from "../search/transcript-index";
import {withWikiOutline} from "../test/wiki-outline-fixture";
import type {Conversation} from "../shared/types";
import type {StructuredAIRequest} from "./provider";

const sections=(count:number)=>Array.from({length:count},(_,i)=>({...contextKnowledge().session.sections[0],id:`source-${i}`,title:`主题${i%4}`,body:`独特机制${i}`,kind:"finding" as const}));
const directory=<T,>(request:StructuredAIRequest<T>)=>{
 const data=JSON.parse(request.prompt),groups=new Map<string,string[]>();
 for(const item of data.sections)groups.set(item.title,[...groups.get(item.title)??[],item.id]);
 return request.validate(withWikiOutline({scope:[], pages:[...groups].map(([title,sectionIds])=>({title,question:title,group:"",sectionIds}))}));
};

it("starts complete windows before the catalogue closes and keeps exact serial cache identities",async()=>{
 const input=sections(90),serial:string[]=[],early:string[]=[],pending:Array<()=>void>=[];
 const signal=new AbortController().signal;
 const expected=await planWikiTopics(input,"zh-CN",{generateStructured:async request=>{serial.push(request.prompt);return directory(request);}},signal);
 const planner=createWikiTopicPlanner("zh-CN",{capabilities:{maxConcurrency:3},generateStructured:async request=>{
  early.push(request.prompt);
  // Only catalogue windows are held; later directory steps run as they come.
  const data=JSON.parse(request.prompt);if(!data.editorialGrouping&&data.presentation!=="wiki_chapter_merge")await new Promise<void>(resolve=>pending.push(resolve));
  return directory(request);
 }},signal);
 planner.append(input.slice(0,37));
 await vi.waitFor(()=>expect(pending).toHaveLength(1));
 planner.append(input.slice(37));
 const result=planner.finish();
 await vi.waitFor(()=>expect(pending).toHaveLength(3));
 pending.reverse().forEach(resolve=>resolve());
 expect(await result).toEqual(expected);
 expect([...early].sort()).toEqual([...serial].sort());
});

it("stops queued early windows and drains started work when reading fails",async()=>{
 let calls=0,release:()=>void=()=>undefined;
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async request=>{
  calls++;await new Promise<void>(resolve=>{release=resolve;});return directory(request);
 }},new AbortController().signal);
 planner.append(sections(110));
 await vi.waitFor(()=>expect(calls).toBe(1));
 const failure=new Error("reading failed");planner.stop(failure);
 let drained=false;const draining=planner.drain().then(()=>{drained=true;});
 await Promise.resolve();expect(drained).toBe(false);
 release();await draining;
 await expect(planner.finish()).rejects.toBe(failure);expect(calls).toBe(1);
});

it("reconciles 163 fragmented candidates within the shared convergence budget and retains every source scope",async()=>{
 const input=sections(163).map((section,i)=>({...section,title:`独特候选${i}`,wikiQuestion:`模块${i%7}的职责：候选${i}`}));
 let globalCalls=0;
 const pages=await planWikiTopics(input,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(!data.editorialGrouping)return request.validate({scope:[], pages:data.sections.map((s:{id:string;title:string;question:string},i:number)=>({title:s.title,question:s.question,group:"",subtopics:[{key:`t${i}`,title:s.title,question:s.question}]})),assignments:Object.fromEntries(data.sections.map((s:{id:string},i:number)=>[s.id,`t${i}`]))});
  globalCalls++;
  expect(data.limits.maxMainCount).toBe(10);expect(data.convergence.targetMainCount).toBeLessThanOrEqual(10);
  expect(request.system).toContain("Regroup the supplied candidate scopes");
  const groups=new Map<string,string[]>();
  for(const s of data.sections){expect(s.subtopics.length).toBeGreaterThan(0);const scope=s.question.split("：")[0];groups.set(scope,[...groups.get(scope)??[],s.id]);}
  return request.validate(withWikiOutline({scope:[], pages:[...groups].map(([question,sectionIds])=>({title:question.replace("的职责",""),question,group:"",sectionIds}))}));
 }},new AbortController().signal);
 expect(pages).toHaveLength(7);expect(globalCalls).toBeLessThanOrEqual(3);
 expect(pages.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(s=>s.id).sort());
 expect(pages.flatMap(page=>page.subtopics!.flatMap(child=>child.sectionIds)).sort()).toEqual(input.map(s=>s.id).sort());
 expect(pages.reduce((count,page)=>count+page.subtopics!.length,0)).toBeLessThan(input.length);
});

it("overlaps directory work with unfinished reading using one concurrency allowance, without starting prose",async()=>{
 const sources:Conversation[]=Array.from({length:4},(_,i)=>({id:`overlap-${i}`,title:`讨论${i}`,platform:"chatgpt",url:"",messageCount:1,updatedAt:1}));
 const passages=sources.flatMap(source=>transcriptPassages(source,[{id:source.id,conversationId:source.id,role:"user",messageIndex:0,content:"完整的模块条件与限制。",preview:"",contentHash:"",createdAt:1,updatedAt:1}]));
 let active=0,maximum=0,readsDone=0,writes=0,earlyPlans=0;
 let releaseRead:()=>void=()=>undefined,releasePlan:()=>void=()=>undefined;
 const task=synthesizeCoveredFocus({goal:"整理项目",mode:"work",locale:"zh-CN",sources,passages,validate:validateFocusResult,signal:new AbortController().signal,
  ai:{capabilities:{maxConcurrency:3},synthesize:async<T,>(request:StructuredAIRequest<T>)=>{
   active++;maximum=Math.max(maximum,active);
   try{
    const data=JSON.parse(request.prompt);
    if(data.coverage.final){writes++;expect(readsDone).toBe(4);return request.validate(withWikiOutline({title:"项目",sections:data.wikiTopics.map((topic:{title:string;ownerId:string})=>({title:topic.title,wikiOwnerId:topic.ownerId,body:"## 具体机制\n\n保留来源中的实际条件。",kind:"finding",transition:"",evidenceIds:data.passages.map((p:{id:string})=>p.id)}))}));}
    if(data.passages[0].conversationId==="overlap-2")await new Promise<void>(resolve=>{releaseRead=resolve;});
    readsDone++;
    return request.validate({title:"笔记",sections:Array.from({length:10},(_,i)=>({title:"系统机制",body:`## 条件${i}

${data.passages[0].conversationId}的独特条件${i}

## 限制${i}

保留不同的边界${i}`,kind:"finding",transition:"",evidenceIds:data.passages.map((p:{id:string})=>p.id)}))});
   }finally{active--;}
  },generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
   active++;maximum=Math.max(maximum,active);
   try{
    if(readsDone<4){earlyPlans++;await new Promise<void>(resolve=>{releasePlan=resolve;});}
    const data=JSON.parse(request.prompt);
    return request.validate(withWikiOutline({scope:[], pages:[{title:"系统机制",question:"系统机制",group:"",sectionIds:data.sections.map((s:{id:string})=>s.id)}]}));
   }finally{active--;}
  }},
 });
 await vi.waitFor(()=>expect(earlyPlans).toBe(1));
 expect(readsDone).toBeLessThan(4);expect(writes).toBe(0);expect(maximum).toBeLessThanOrEqual(3);
 releaseRead();releasePlan();
 const result=await task;
 expect(result.topicPlanApplied).toBe(true);expect(result.result.sections).toHaveLength(1);expect(writes).toBe(1);
 expect(new Set(result.result.sections[0].evidenceIds)).toEqual(new Set(result.evidence.map(e=>e.id)));expect(maximum).toBeLessThanOrEqual(3);
});
