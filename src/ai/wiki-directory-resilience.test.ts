import "fake-indexeddb/auto";
import {expect,it,vi} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {createWikiTopicPlanner,planWikiTopics,type WikiPlanReceipt} from "./wiki-topic-plan";
import {validateWikiPlan} from "./wiki-plan-contract";
import {validateWikiDirectory} from "./wiki-directory";
import type {StructuredAIRequest} from "./provider";
import {RECOVERY_POLICY} from "./recovery-policy";

const sections=(size:number)=>Array.from({length:size},(_,index)=>({...contextKnowledge().session.sections[0],id:`source-${index}`,title:`候选${index}`,wikiQuestion:`模块${index%7}`,body:`完整条件 ${index}，失败保留原文。`,kind:"finding" as const}));
const one=(request:Pick<StructuredAIRequest<unknown>,"prompt">)=>({pages:[{title:"数据保存",subtopics:[{title:"完整机制",sectionIds:JSON.parse(request.prompt).sections.map((item:{id:string})=>item.id)}]}]});

it.each([null,{},[]])("ignores empty obsolete assignment metadata only when explicit leaf inventories exist: %j",assignments=>{
 const input=sections(2).map((section,index)=>({...section,id:`m${index}`}));
 const value={pages:[{title:"数据保存",subtopics:[{title:"持久化",sectionIds:["m0","m1"]}]}],assignments},before=structuredClone(value);
 expect(validateWikiPlan(value,input)[0].sectionIds).toEqual(["m0","m1"]);expect(value).toEqual(before);
 expect(()=>validateWikiPlan({...value,pages:[{...value.pages[0],subtopics:[{title:"持久化",sectionIds:["m0"]}]}]},input)).toThrow();
});

it("normalizes surrounding metadata whitespace without truncating actual text or identifiers",()=>{
 const input=sections(1).map(section=>({...section,id:"m0"}));
 const value={pages:[{title:"  数据保存  ",group:" ".repeat(100),question:" ".repeat(100),subtopics:[{title:" ".repeat(100)+"持久化"+" ".repeat(100),sectionIds:["m0"]}]}]};
 expect(validateWikiPlan(value,input)[0]).toMatchObject({title:"数据保存",group:"",question:"数据保存",subtopics:[{title:"持久化"}]});
 expect(()=>validateWikiPlan({...value,pages:[{...value.pages[0],subtopics:[{title:"持久化",sectionIds:[" m0 "]}]}]},input)).toThrow();
});

it("preserves signed conditions and leaves cached source inventories unchanged when identical parents coalesce",()=>{
 const input=sections(2),value={pages:input.map((section,index)=>({title:"电压配置",question:"电压范围是什么？",group:"",sectionIds:[section.id],subtopics:[{title:"供电边界",question:index?"5V":"-5V",sectionIds:[section.id]}]}))},before=structuredClone(value);
 const result=validateWikiDirectory(value,input,true);
 expect(result).toHaveLength(1);expect(result[0].subtopics?.map(topic=>topic.question)).toEqual(["-5V","5V"]);expect(new Set(result[0].subtopics?.map(topic=>topic.title)).size).toBe(2);expect(value).toEqual(before);expect(validateWikiDirectory({pages:result},input,true)).toEqual(result);
});

it("keeps unrelated subjects separate when the model repeats a generic question",()=>{
 const input=sections(2),result=validateWikiPlan({pages:input.map((section,index)=>({title:index?"采购方案":"元件识别",question:"如何实现？",subtopics:[{title:"实施机制",sectionIds:[section.id]}]}))},input);
 expect(result.map(page=>page.title)).toEqual(["元件识别","采购方案"]);
});

it("takes immutable input snapshots and makes repeated append and finish calls idempotent",async()=>{
 const input=sections(3),calls=vi.fn();
 async function generateStructured<T>(request:StructuredAIRequest<T>){calls();expect(JSON.parse(request.prompt).sections[0].title).toBe("候选0");return request.validate(one(request));}
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured},new AbortController().signal);
 planner.append(input);planner.append(structuredClone(input));input[0].title="外部后续修改";
 const first=planner.finish(),second=planner.finish();expect(second).toBe(first);const result=await first;expect(await planner.finish()).toEqual(result);expect(calls).toHaveBeenCalledOnce();expect(result[0].sectionIds).toHaveLength(3);
});

it("rejects changed identities and personal inputs before requesting a directory",async()=>{
 const generateStructured=vi.fn();
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured},new AbortController().signal),input=sections(1);planner.append(input);planner.append([{...input[0],body:"同一身份的新材料"}]);
 await expect(planner.finish()).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_input_changed"});
 await expect(planWikiTopics([{...input[0],userEdited:true}],"zh-CN",{generateStructured},new AbortController().signal)).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_personal"});expect(generateStructured).not.toHaveBeenCalled();
});

it("repairs different failed catalogue windows independently within the shared ceiling",async()=>{
 let receipt:WikiPlanReceipt|undefined;const calls:unknown[]=[];
 const result=await planWikiTopics(sections(108),"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);calls.push(data);
  return request.validate(!data.editorialGrouping&&!data.correction?{pages:[]}:one(request));
 }},new AbortController().signal,value=>{receipt=value;});
 expect(receipt).toMatchObject({repairCount:3,reconciled:true});expect(receipt!.repairTokens).toBeLessThanOrEqual(24000);expect(calls).toHaveLength(7);expect(result[0].sectionIds).toHaveLength(108);
});

it("does not restart paid repair loops for a persistently invalid window",async()=>{
 let calls=0,receipt:WikiPlanReceipt|undefined;
 await expect(planWikiTopics(sections(90),"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls++;return request.validate({pages:[]});}},new AbortController().signal,value=>{receipt=value;})).rejects.toThrow();
 // The identical repeated reply gets one split attempt; its halves stay inside the bounded repair allowance.
 expect(calls).toBe(4);expect(receipt?.repairCount).toBeLessThanOrEqual(2);
});

it("stops a pending window without paying for a subsequent format repair",async()=>{
 let release!:()=>void;let calls=0;
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls++;await new Promise<void>(resolve=>{release=resolve;});return request.validate({pages:[]});}},new AbortController().signal);
 planner.append(sections(40));await vi.waitFor(()=>expect(calls).toBe(1));const failure=new Error("source reading stopped");planner.stop(failure);const result=planner.finish();release();await expect(result).rejects.toBe(failure);expect(calls).toBe(1);
});

it("recovers one non-converging global response with explicit feedback instead of replaying it forever",async()=>{
 let calls=0;
 // No merge proposal: the regrouping rounds' stall recovery is under test.
 const result=await planWikiTopics(sections(24),"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  if(JSON.parse(request.prompt).presentation==="wiki_chapter_merge")return request.validate({groups:[]});
  const data=JSON.parse(request.prompt);calls++;
  if(calls<3)return request.validate({pages:data.sections.map((item:{id:string;title:string;question:string})=>({title:item.title,question:item.question,subtopics:[{title:"机制",sectionIds:[item.id]}]}))});
  expect(data.convergence.stalled).toBe(true);expect(request.system).toContain("previous response made no reduction");return request.validate(one(request));
 }},new AbortController().signal);
 expect(calls).toBe(3);expect(result[0].sectionIds).toHaveLength(24);
});

it("converges 554 fragmented candidates within the bounded windowed output allowance",async()=>{
 const input=sections(554);let globals=0,windows=0,receipt:WikiPlanReceipt|undefined;
 const result=await planWikiTopics(input,"zh-CN",{capabilities:{maxConcurrency:3},generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(!data.editorialGrouping)return request.validate({pages:data.sections.map((item:{id:string;title:string;question:string})=>({title:item.title,question:item.question,subtopics:[{title:item.title,question:`${item.title}的独特条件`,sectionIds:[item.id]}]}))});
  globals++;if(data.convergence.round===1)windows++;const groups=new Map<string,string[]>();for(const item of data.sections)groups.set(item.question,[...groups.get(item.question)??[],item.id]);
  return request.validate({pages:[...groups].map(([title,sectionIds])=>({title,question:title,subtopics:[{title:"路由",sectionIds}]}))});
 }},new AbortController().signal,value=>{receipt=value;});
 expect(result).toHaveLength(7);expect(globals).toBeGreaterThan(4);expect(globals).toBeLessThanOrEqual(7);expect(receipt!.convergenceTokens).toBeLessThanOrEqual(RECOVERY_POLICY.directory.windowedConvergenceOutputTokens(windows));
 expect(result.flatMap(page=>page.subtopics!.flatMap(topic=>topic.sectionIds)).sort()).toEqual(input.map(item=>item.id).sort());expect(result.reduce((sum,page)=>sum+page.subtopics!.length,0)).toBeLessThanOrEqual(42);
});

it("preserves exact coverage, input immutability and validation idempotence across 300 generated variants",()=>{
 for(let seed=1;seed<=300;seed++){
  const size=3+seed%28,input=sections(size).map((item,index)=>({...item,id:`m${index}`})),count=1+seed%Math.min(7,size);
  const pages=Array.from({length:count},(_,index)=>({title:`主题${index}`,question:`主题${index}范围`,subtopics:[{title:"具体机制",sectionIds:input.filter((_,position)=>position%count===index).map(item=>item.id).reverse()}]}));
  if(seed%3===0)pages[0].subtopics[0].sectionIds.push(pages[0].subtopics[0].sectionIds[0]);
  if(seed%5===0)pages[0].subtopics.push({title:"未使用模板",sectionIds:[]});
  const value={pages,...(seed%2?{assignments:{}}:{})},before=structuredClone(value),result=validateWikiPlan(value,input);
  expect(result.flatMap(page=>page.subtopics!.flatMap(topic=>topic.sectionIds)).sort()).toEqual(input.map(item=>item.id).sort());expect(value).toEqual(before);expect(validateWikiPlan(result,input)).toEqual(result);
 }
});
