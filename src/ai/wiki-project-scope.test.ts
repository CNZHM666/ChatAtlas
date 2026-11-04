import "fake-indexeddb/auto";
import {expect,it,vi} from "vitest";
import {createWikiTopicPlanner,type WikiPlanReceipt} from "./wiki-topic-plan";
import {readWikiScope,emptyWikiScopeStats,wikiMaterialKey,scopeWikiFacts,wikiScopeOmitted,wikiScopeWritingRouting,makeWikiScopeReview} from "./wiki-project-scope";
import type {StructuredAIRequest} from "./provider";
import type {FocusSection} from "../shared/focus-session";
import {projectSession} from "../test/project-fixture";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {synthesizeCoveredFocus} from "./focus-coverage";
import {validateFocusResult} from "./focus-session";
import {transcriptPassages} from "../search/transcript-index";
import type {AISettings,Conversation} from "../shared/types";

const note=(id:string,title:string,body:string):FocusSection=>({id,title,body,kind:"finding",transition:"",evidenceIds:[`e-${id}`]});
const sections=[note("server","平台 AI","平台自带 AI 的密钥保存在服务器端。"),note("byok","用户 AI","同时支持 BYOK，用户提供自己的密钥。"),note("other","旅行计划","另外讨论下周旅行的酒店安排。"),note("uncertain","归属不明","另一个产品的发布计划，归属尚未说明。"),note("ref","竞品参考","以外部产品的导出设计为参考，当前项目也需要离线阅读。")];
const leaf=(ids:string[])=>({title:"模型接入",subtopics:[{title:"使用条件",sectionIds:ids}]});
const scope=(id:string,kind="other",quote=sections[2].body)=>({id,kind,reason:"这是另一项讨论，与本项目目标无关。",quote});

it("keeps parallel AI modes and an attributed reference while accounting for every excluded material",async()=>{
 const original=structuredClone(sections),requests:unknown[]=[];
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);requests.push(data);expect(data.projectBoundary.organizingIntent).toBe("整理本项目的模型接入");expect(data.version).toBe(18);
  expect(request.system).toContain("BYOK modes are NOT conflicting projects");
  return request.validate({pages:[leaf(["m0","m1","m3","m4"])],scope:[scope("m2"),scope("m3","uncertain",sections[3].body),scope("m4","reference",sections[4].body)]});
 }},new AbortController().signal,undefined,{goal:"整理本项目的模型接入"});
 planner.append(sections);const pages=await planner.finish(),review=planner.scopeReview()!;
 expect(pages[0].sectionIds).toEqual(["server","byok","uncertain","ref"]);expect(review.materials.map(item=>item.kind)).toEqual(["other","uncertain","reference"]);
 expect(review.materials[0]).toMatchObject({body:sections[2].body,evidenceIds:sections[2].evidenceIds,key:wikiMaterialKey(sections[2])});expect(requests).toHaveLength(1);expect(sections).toEqual(original);
});

it("retains ambiguous membership and conflicting proposals instead of guessing an exclusion",()=>{
 const items=sections.map((section,index)=>({...section,id:`m${index}`}));
 const decisions=readWikiScope({scope:[scope("m2"),scope("m3","uncertain",sections[3].body),scope("m4"),scope("m4","reference",sections[4].body)]},items);
 expect([...wikiScopeOmitted(decisions)]).toEqual(["m2"]);
 expect(decisions.find(item=>item.id==="m4")?.kind).toBe("uncertain");
});

it("binds scope warnings to split passages without promoting shared evidence or forgetting manual inclusion",()=>{
 const review=makeWikiScopeReview(sections,[{id:"other",kind:"other",reason:"独立产品",quote:sections[2].body},{id:"uncertain",kind:"uncertain",reason:"未说明产品",quote:sections[3].body}],{goal:"模型接入"},"incomplete",[{...sections[0],key:wikiMaterialKey(sections[0]),reason:"context_omitted"}]);
 const batch=[{id:"uncertain:1",rawEvidenceIds:["e-uncertain"]},{id:"server",rawEvidenceIds:["e-server","e-other"]}];
 const routing=wikiScopeWritingRouting(review,batch);
 expect(routing).toEqual(expect.arrayContaining([
  expect.objectContaining({materialId:"uncertain",kind:"uncertain",passageIds:["uncertain:1"]}),
  expect.objectContaining({materialId:"other",kind:"other",passageIds:[],contextPassageIds:["server"]}),
  expect.objectContaining({materialId:"server",kind:"unreviewed",passageIds:["server"]}),
 ]));
 expect(routing).toHaveLength(3);
 expect(wikiScopeWritingRouting({...review,includeKeys:[wikiMaterialKey(sections[3])]},batch).some(row=>row.kind==="uncertain")).toBe(false);
 expect(wikiScopeWritingRouting(undefined,batch).map(row=>row.kind)).toEqual(["unreviewed","unreviewed"]);
 expect(wikiScopeWritingRouting(review,[{id:"unrelated-batch",rawEvidenceIds:["different-message"]}])).toEqual([]);
});

it.each([[scope("m99")],[scope("m2","foreign")],[scope("m1")]].map(rows=>({rows})))("does not use a row naming no supplied material or one the user included: %j",({rows})=>{
 const stats=emptyWikiScopeStats();
 expect(readWikiScope({scope:rows},sections.map((section,index)=>({...section,id:`m${index}`})),["m1"],stats)).toEqual([]);
 expect(stats.unknown+stats.userIncluded).toBe(1);
});

it("still routes a flagged material with an inexact quote, a missing reason or two rows to the user's review",()=>{
 const items=sections.map((section,index)=>({...section,id:`m${index}`})),stats=emptyWikiScopeStats();
 // Punctuation and spacing differences still ground the quote.
 expect(readWikiScope({scope:[scope("m2","other","另外讨论下周旅行的酒店安排")]},items)).toEqual([expect.objectContaining({id:"m2",quote:"另外讨论下周旅行的酒店安排"})]);
 expect(readWikiScope({scope:[scope("m2","other","invented quotation"),{...scope("m3","uncertain",sections[3].body),reason:""},scope("m4"),scope("m4","reference",sections[4].body)]},items,[],stats)).toEqual([
  {id:"m2",kind:"other",reason:"这是另一项讨论，与本项目目标无关。",quote:""},
  {id:"m3",kind:"uncertain",reason:"",quote:sections[3].body},
  // Named twice with different kinds: ownership is ambiguous, so the user decides.
  expect.objectContaining({id:"m4",kind:"uncertain"})]);
 expect(stats).toMatchObject({rows:3,other:1,uncertain:2,looseQuotes:1,duplicates:1});
});

it("leaves out a material the reply both assigns and excludes, and counts it in the receipt",async()=>{
 let calls=0,receipt:WikiPlanReceipt|undefined;
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;return request.validate({pages:[leaf(["m0","m1","m2"])],scope:[scope("m2")]});
 }},new AbortController().signal,value=>{receipt=value;},{goal:"模型接入"});
 planner.append(sections.slice(0,3));
 const result=await planner.finish();
 expect(calls).toBe(1);expect(result.flatMap(page=>page.sectionIds)).toEqual(sections.slice(0,2).map(section=>section.id));
 expect(planner.scopeReview()?.materials.map(item=>[item.id,item.kind])).toEqual([["other","other"]]);
 expect(receipt?.scope).toMatchObject({rows:1,other:1,assigned:1});
});

it("requires a complete disjoint ledger and retains the existing bounded ownership repair",async()=>{
 let repairs=0;
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){repairs++;expect(data.slots).toHaveLength(1);return request.validate({owners:{r0:data.slots[0].choices[0]}});}
  return request.validate({pages:[leaf(["m0"])],scope:[scope("m2")]});
 }},new AbortController().signal,undefined,{goal:"模型接入"});
 planner.append(sections.slice(0,3));const result=await planner.finish();
 expect(result[0].sectionIds).toEqual(["server","byok"]);expect(repairs).toBe(1);expect(planner.scopeReview()?.materials[0].id).toBe("other");
});

it("uses an audited empty-scope error without generating an unrelated chapter",async()=>{
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>request.validate({pages:[],scope:[scope("m0")]})},new AbortController().signal,undefined,{goal:"模型接入"});
 planner.append([sections[2]]);await expect(planner.finish()).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_scope_empty",message:expect.stringContaining("原文和分析缓存已保留")});
});

it("converges only retained candidates even when a whole early catalogue window is unrelated",async()=>{
 const materials=Array.from({length:100},(_,index)=>note(`original-${index}`,index<36?"其他讨论":"模型接入",index<36?`独立的旅行安排 ${index}。`:`本项目模型调用条件 ${index}。`));
 let calls=0,global=0;
 const planner=createWikiTopicPlanner("zh-CN",{capabilities:{maxConcurrency:3},generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;const data=JSON.parse(request.prompt);
  if(data.editorialGrouping){global++;expect(data.projectBoundary.organizingIntent).toBe("整理模型接入");return request.validate({scope:[], pages:[leaf(data.sections.map((item:{id:string})=>item.id))]});}
  const excluded=data.sections.filter((item:{title:string})=>item.title==="其他讨论");
  const active=data.sections.filter((item:{title:string})=>item.title!=="其他讨论");
  return request.validate({pages:active.length?[leaf(active.map((item:{id:string})=>item.id))]:[],scope:excluded.map((item:{id:string;lead:string})=>scope(item.id,"other",item.lead))});
 }},new AbortController().signal,undefined,{goal:"整理模型接入"});
 planner.append(materials);const result=await planner.finish();
 expect(result.flatMap(page=>page.sectionIds)).toEqual(materials.slice(36).map(item=>item.id));expect(planner.scopeReview()?.materials).toHaveLength(36);expect(global).toBe(1);expect(calls).toBeLessThanOrEqual(5);
});

it("does not publish partial scope decisions after cancellation",async()=>{
 const controller=new AbortController();
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const result=request.validate({pages:[leaf(["m0","m1"])],scope:[scope("m2")]});controller.abort();return result;}},controller.signal,undefined,{goal:"模型接入"});
 planner.append(sections.slice(0,3));await expect(planner.finish()).rejects.toThrow();expect(planner.scopeReview()?.materials).toHaveLength(0);
});

it("reuses real facade caches, changes only the directory identity for manual inclusion, and binds choices to content",async()=>{
 let calls=0;
 const settings:AISettings={id:"ai-settings",provider:"openai",model:"scope-fixture",baseUrl:"https://fixture.invalid",apiKey:"fixture",updatedAt:1};
 const ai=createAtlasAIFromProvider({id:`scope-${crypto.randomUUID()}`,modelId:settings.model,testConnection:async()=>({ok:true,model:settings.model}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;const data=JSON.parse(request.prompt),included=data.includedMaterialIds.includes("m2");
  return request.validate({pages:[leaf(included?["m0","m1","m2"]:["m0","m1"])],scope:included?[]:[scope("m2")]});
 }},settings);
 const run=async(includeKeys:string[]=[])=>{const planner=createWikiTopicPlanner("zh-CN",ai,new AbortController().signal,undefined,{goal:"模型接入",includeKeys});planner.append(sections.slice(0,3));return {scope:[], pages:await planner.finish(),review:planner.scopeReview()!};};
 const first=await run();await run();expect(calls).toBe(1);
 const restored=await run([first.review.materials[0].key]);expect(calls).toBe(2);expect(restored.pages[0].sectionIds).toContain("other");expect(restored.review.materials).toHaveLength(0);
 expect(wikiMaterialKey({...sections[2],body:"不同的来源内容"})).not.toBe(first.review.materials[0].key);
 // The user's inclusion wins: a model row excluding that material is not accepted.
 expect(readWikiScope({scope:[scope("m2")]},sections.slice(0,3).map((item,index)=>({...item,id:`m${index}`})),["m2"])).toEqual([]);
});

it("retains raw source coverage and reading caches while omitting foreign notes from all writing requests",async()=>{
 const prefix=crypto.randomUUID(),sources:Conversation[]=Array.from({length:3},(_,i)=>({id:`${prefix}-${i}`,title:i===2?"旅行计划":"模型接入",platform:"chatgpt",url:"",messageCount:1,updatedAt:1}));
 const passages=sources.flatMap((source,index)=>transcriptPassages(source,[{id:source.id,conversationId:source.id,role:"user",messageIndex:0,content:sections[index].body,preview:"",contentHash:"",createdAt:1,updatedAt:1}]));
 let reads=0,writes=0;
 const settings:AISettings={id:"ai-settings",provider:"openai",model:"scope-flow",baseUrl:"https://fixture.invalid",apiKey:"fixture",updatedAt:1};
 const fetch=vi.spyOn(globalThis,"fetch");
 const ai=createAtlasAIFromProvider({id:prefix,modelId:settings.model,testConnection:async()=>({ok:true,model:settings.model}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_topic_plan"){
   const other=data.sections.find((section:{lead:string})=>section.lead.includes("酒店安排"));
   const include=other&&data.includedMaterialIds.includes(other.id);
   return request.validate({pages:[leaf(data.sections.filter((section:{id:string})=>include||section.id!==other?.id).map((section:{id:string})=>section.id))],scope:other&&!include?[scope(other.id)]:[]});
  }
  if(!data.coverage.final){reads++;return request.validate({title:"初读",sections:[{title:data.passages[0].title,body:data.passages[0].text,kind:"finding",transition:"",evidenceIds:data.passages.map((p:{id:string})=>p.id)}]});}
  writes++;if(!data.passages.some((p:{text:string})=>p.text.includes("酒店安排")))expect(request.system).not.toContain("酒店安排");
  return request.validate({title:"项目",sections:data.wikiTopics.map((topic:{title:string;ownerId:string})=>({title:topic.title,wikiOwnerId:topic.ownerId,body:"## 使用条件\n\n平台模式使用服务器密钥，BYOK 使用用户自己的密钥。",kind:"finding",transition:"",evidenceIds:data.passages.map((p:{id:string})=>p.id)}))});
 }},settings);
 const run=(includeKeys?:string[])=>synthesizeCoveredFocus({goal:"模型接入",mode:"work",locale:"zh-CN",sources,passages,collectProjectKnowledge:true,ai,signal:new AbortController().signal,validate:validateFocusResult,wikiScopeIncludeKeys:includeKeys});
 try{const first=await run();expect(first.segmentCount).toBe(3);expect(first.sourceOutlines).toHaveLength(3);expect(first.wikiScopeReview?.materials).toHaveLength(1);expect(first.result.sections.map(item=>item.body).join("")).not.toContain("酒店安排");const completed=reads;const second=await run([first.wikiScopeReview!.materials[0].key]);expect(reads).toBe(completed);expect(second.wikiScopeReview?.materials).toHaveLength(0);expect(writes).toBeGreaterThan(0);expect(fetch).not.toHaveBeenCalled();}finally{fetch.mockRestore();}
});

it("keeps the raw fact ledger but removes foreign facts from a mixed-batch writing projection",()=>{
 const facts=projectSession().projectState!,proof={quote:"外部项目使用独立知识图谱。",evidenceIds:["same-message"]};
 const raw={...facts,modules:[],relations:[],decisions:[{id:"foreign",text:"外部知识图谱",reason:"",status:"documented" as const,...proof}],constraints:[{id:"project",text:"用户管理密钥",reason:"",status:"documented" as const,quote:"BYOK 使用用户自己的密钥。",evidenceIds:["same-message"]}],history:[]};
 const before=structuredClone(raw),project=scopeWikiFacts(raw,"BYOK 使用用户自己的密钥。",true)!;
 expect(project.decisions).toHaveLength(0);expect(project.constraints).toHaveLength(1);expect(raw).toEqual(before);expect(scopeWikiFacts(raw,"",false)).toBe(raw);
});
