import {expect,it} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {expandWikiSlotRouting} from "./wiki-slot-routing";
import {validateWikiPlan} from "./wiki-plan-contract";
import {createWikiTopicPlanner,planWikiTopics} from "./wiki-topic-plan";
import type {StructuredAIRequest} from "./provider";

const sections=(count=3)=>Array.from({length:count},(_,index)=>({...contextKnowledge().session.sections[0],id:`m${index}`,kind:"finding" as const,title:`材料${index}`,body:`保留完整条件 ${index}。`}));
const pages=()=>[{title:"存储机制",subtopics:[{title:"消息保存"},{title:"恢复条件"}]},{title:"访问权限",subtopics:[{title:"授权边界"}]}];

it("binds the application's material roster to selected destinations and derives both inventories",()=>{
 const input=sections(),value={pages:pages(),routes:[{chapter:0,subtopics:[0,1]},{chapter:1,subtopics:[0]},{chapter:0,subtopics:[1]}]},before=structuredClone(value);
 const result=validateWikiPlan(value,input);
 expect(result.map(page=>page.sectionIds)).toEqual([["m0","m2"],["m1"]]);
 expect(result[0].subtopics?.map(topic=>topic.sectionIds)).toEqual([["m0"],["m0","m2"]]);
 expect(validateWikiPlan(result,input)).toEqual(result);expect(value).toEqual(before);
});

it.each([[{chapter:0,subtopics:[0]}],Array.from({length:4},()=>({chapter:0,subtopics:[0]}))])("rejects shifted or extra positional slots instead of assigning the wrong material",routes=>{
 expect(()=>expandWikiSlotRouting({pages:pages(),routes},sections())).toThrowError(expect.objectContaining({code:"PROVIDER_SCHEMA_wiki_directory_routing_count"}));
});

it("rejects competing routing protocols rather than choosing an inventory",()=>{
 expect(()=>expandWikiSlotRouting({pages:[{...pages()[0],sectionIds:["m0"]}],routes:[{chapter:0,subtopics:[0]}]},sections(1))).toThrowError(expect.objectContaining({code:"PROVIDER_SCHEMA_wiki_directory_assignment_conflict"}));
});

it("freezes valid routes and repairs only a material with an invalid destination",async()=>{
 let calls=0;
 const result=await planWikiTopics(sections(),"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){
   expect(data.expectedSlotIds).toEqual(["r0"]);expect(data.slots[0].title).toBe("材料1");
   return request.validate({owners:{r0:"s2"}});
  }
  expect(data.routingProtocol).toBe(1);expect(data.routingSlots).toEqual(["m0","m1","m2"]);
  return request.validate({pages:pages(),routes:[{chapter:0,subtopics:[0]},{chapter:99,subtopics:[0]},{chapter:0,subtopics:[1]}]});
 }},new AbortController().signal);
 expect(calls).toBe(2);expect(result.map(page=>page.sectionIds)).toEqual([["m0","m2"],["m1"]]);
});

it("keeps omitted scope slots in position and never shifts retained materials",async()=>{
 const input=sections();input[1].body="与本项目无关的旅行安排";
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>request.validate({pages:[pages()[0]],routes:[{chapter:0,subtopics:[0]},null,{chapter:0,subtopics:[1]}],scope:[{id:"m1",kind:"other",reason:"独立旅行讨论",quote:"旅行安排"}]})},new AbortController().signal,undefined,{goal:"本地消息存储"});
 planner.append(input);const result=await planner.finish();expect(result[0].subtopics?.map(topic=>topic.sectionIds)).toEqual([["m0"],["m2"]]);expect(planner.scopeReview()?.materials[0].id).toBe("m1");
});

it("repairs a null route for uncertain membership instead of interpreting it as permission to exclude",async()=>{
 const input=sections(2);input[1].body="另一个平台的发布计划，尚未说明是否属于本项目。";let calls=0;
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){expect(data.slots).toHaveLength(1);return request.validate({owners:{r0:data.slots[0].choices[0]}});}
  return request.validate({pages:[pages()[0]],routes:[{chapter:0,subtopics:[0]},null],scope:[{id:"m1",kind:"uncertain",reason:"平台归属未说明",quote:"另一个平台的发布计划"}]});
 }},new AbortController().signal,undefined,{goal:"本地消息存储"});
 planner.append(input);expect((await planner.finish())[0].sectionIds).toEqual(["m0","m1"]);
 expect(planner.scopeReview()?.materials).toMatchObject([{kind:"uncertain",body:input[1].body}]);expect(calls).toBe(2);
});

it("repairs a missing scope receipt once instead of silently retaining unrelated paragraphs",async()=>{
 const input=sections(2);input[1].body="ChatAtlas 的 ProjectEvent 属于另一个产品。";
 let calls=0;
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;const data=JSON.parse(request.prompt);
  expect(request.system).toContain("Scope is a REQUIRED top-level array");
  if(calls===1)return request.validate({pages:[pages()[0]],routes:[{chapter:0,subtopics:[0]},{chapter:0,subtopics:[1]}]});
  expect(data.correction.fields).toEqual(["scope"]);
  expect(data.correction.problems.join(" ")).toContain("required scope array is missing");
  return request.validate({pages:[pages()[0]],routes:[{chapter:0,subtopics:[0]},null],scope:[{id:"m1",kind:"other",reason:"另一项目的功能建议",quote:"另一个产品"}]});
 }},new AbortController().signal,undefined,{goal:"整理硬件平台",project:{name:"AI电路创作平台"}});
 planner.append(input);const result=await planner.finish();
 expect(calls).toBe(2);expect(result[0].sectionIds).toEqual(["m0"]);
 expect(planner.scopeReview()).toMatchObject({status:"complete",materials:[{id:"m1",kind:"other",body:input[1].body}]});
});

it("keeps a valid outline after one scope correction and explicitly queues every unreviewed material",async()=>{
 let calls=0;
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;return request.validate({pages:[pages()[0]],routes:sections(2).map(()=>({chapter:0,subtopics:[0]}))});
 }},new AbortController().signal,undefined,{goal:"整理本地保存"});
 planner.append(sections(2));
 expect(await planner.finish()).toHaveLength(1);
 expect(calls).toBe(2);expect(planner.scopeReview()).toMatchObject({status:"incomplete",materials:[],unreviewed:[{id:"m0",reason:"missing_receipt"},{id:"m1",reason:"missing_receipt"}]});
});

it("keeps legacy leaf responses readable without certifying an absent scope review",async()=>{
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>request.validate({pages:[{title:"保存机制",subtopics:[{title:"保存规则",sectionIds:["m0","m1"]}]}]})},new AbortController().signal,undefined,{goal:"整理本地保存"});
 planner.append(sections(2));expect(await planner.finish()).toHaveLength(1);
 expect(planner.scopeReview()).toMatchObject({status:"incomplete",materials:[]});
});

it("requires scope metadata in fresh legacy-shaped replies as well as canonical routes",async()=>{
 const input=sections(2);input[1].body="另一个项目的 ProjectEvent 讨论。";let calls=0;
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;
  if(calls===1)return request.validate({pages:[{title:"保存机制",subtopics:[{title:"保存规则",sectionIds:["m0","m1"]}]}]});
  expect(JSON.parse(request.prompt).correction.fields).toEqual(["scope"]);
  return request.validate({scope:[{id:"m1",kind:"other",reason:"独立项目",quote:"另一个项目"}],pages:[{title:"保存机制",subtopics:[{title:"保存规则",sectionIds:["m0"]}]}]});
 }},new AbortController().signal,undefined,{goal:"本地存储项目"});
 planner.append(input);expect((await planner.finish())[0].sectionIds).toEqual(["m0"]);expect(calls).toBe(2);
 expect(planner.scopeReview()).toMatchObject({status:"complete",materials:[{id:"m1",kind:"other"}]});
});

it("retains scope proposals while repairing a different canonical route in the same reply",async()=>{
 const input=sections(3);input[1].body="另一项目的旅行计划。";
 let calls=0;
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){expect(data.slots).toHaveLength(1);expect(data.slots[0].title).toBe(input[2].title);return request.validate({owners:{r0:data.slots[0].choices[0]}});}
  return request.validate({pages:[pages()[0]],routes:[{chapter:0,subtopics:[0]},null,{chapter:99,subtopics:[0]}],scope:[{id:"m1",kind:"other",reason:"独立项目",quote:"旅行计划"}]});
 }},new AbortController().signal,undefined,{goal:"整理本地保存"});
 planner.append(input);expect((await planner.finish())[0].sectionIds).toEqual(["m0","m2"]);
 expect(calls).toBe(2);expect(planner.scopeReview()).toMatchObject({status:"complete",materials:[{id:"m1",kind:"other"}]});
});
it("reports an all-excluded scope without regenerating valid exclusions or inventing a chapter",async()=>{
 const input=sections(1);input[0].body="独立旅行讨论不属于本地存储项目";
 const value={pages:[],routes:[null],scope:[{id:"m0",kind:"other",reason:"独立旅行讨论",quote:"独立旅行讨论"}]};
 let calls=0;
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls++;return request.validate(value);}},new AbortController().signal,undefined,{goal:"本地存储"});
 planner.append(input);await expect(planner.finish()).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_scope_empty"});
 expect(calls).toBe(1);
 expect(planner.scopeReview()?.materials).toMatchObject([{id:"m0",body:input[0].body,kind:"other"}]);
 expect(()=>validateWikiPlan({pages:[],routes:[null]},input)).toThrow();
});

it("keeps a mixed material intact and permits different chapters to cite the same original discussion",async()=>{
 const input=sections(2).map((item,index)=>({...item,evidenceIds:["same-original-message"],body:index?"访问授权只控制向模型发送材料，不改变本地保存；用户未确认自动同步。":"原文保存在本地；失败恢复依赖保留消息顺序，未经授权不得发送到模型。"})),before=structuredClone(input);
 const result=await planWikiTopics(input,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>request.validate({pages:pages(),routes:[{chapter:0,subtopics:[0,1]},{chapter:1,subtopics:[0]}]})},new AbortController().signal);
 expect(result.map(page=>page.sectionIds)).toEqual([["m0"],["m1"]]);expect(result[0].subtopics?.map(topic=>topic.sectionIds)).toEqual([["m0"],["m0"]]);expect(input).toEqual(before);
});

it("plans 554 materials with fixed routing slots and restores all original identities",async()=>{
 const input=sections(554).map((item,index)=>({...item,id:`original:${index}`}));
 let calls=0;
 const result=await planWikiTopics(input,"zh-CN",{capabilities:{maxConcurrency:3},generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;const data=JSON.parse(request.prompt);expect(data.routingSlots).toHaveLength(data.sections.length);
  return request.validate({pages:[{title:"消息存储",subtopics:[{title:"完整条件"}]}],routes:data.routingSlots.map(()=>({chapter:0,subtopics:[0]}))});
 }},new AbortController().signal);
 expect(result.flatMap(page=>page.sectionIds)).toEqual(input.map(item=>item.id));expect(calls).toBeLessThan(30);
});
