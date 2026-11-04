import "fake-indexeddb/auto";
import {beforeEach,expect,it} from "vitest";
import fixture from "../test/fixtures/wiki-directory-identity-replay.json";
import {contextKnowledge} from "../test/context-fixture";
import {getDatabase} from "../storage/db";
import {validateWikiPlan} from "./wiki-plan-contract";
import {prepareWikiOwnershipRepair} from "./wiki-ownership-repair";
import {AIProviderValidationError} from "./provider-errors";
import {createWikiTopicPlanner,planWikiTopics} from "./wiki-topic-plan";
import type {StructuredAIRequest} from "./provider";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {listAIUsage} from "../storage/ai-usage";
import {analyzeOrganizationRuns} from "./usage-analysis";
import type {WikiPlanningProgress} from "../shared/focus-progress";

const sections=(count=4)=>Array.from({length:count},(_,i)=>({...contextKnowledge().session.sections[0],id:`m${i}`,kind:"finding" as const,title:`材料${i}`,body:`原始条件${i}：失败保留原文，未确认的建议不当作完成。`}));
const prepare=(value:unknown,input=sections())=>{try{validateWikiPlan(value,input);throw Error("Expected invalid draft");}catch(error){expect(error).toBeInstanceOf(AIProviderValidationError);return prepareWikiOwnershipRepair(value,input,error as AIProviderValidationError)!;}};
beforeEach(async()=>{await(await getDatabase()).clear("semanticDecisionCache");});
it("replays the CSV's empty-subtopic error with zero missing sources and one unknown ID in a mixed legacy outline",async()=>{
 const input=sections(),value={pages:fixture.pages.map(page=>structuredClone(page)) as Array<Record<string,unknown>>};
 value.pages[0]={title:"本地存储",sectionIds:["m0"]};
 (value.pages[1].subtopics as Array<Record<string,unknown>>).push({title:"未使用的占位",sectionIds:[]});
 // The empty placeholder is pruned first, so the error names the real cause: the unknown ID.
 expect(()=>validateWikiPlan(value,input)).toThrowError(expect.objectContaining({code:"PROVIDER_SCHEMA_wiki_directory_identity",wikiDirectoryDetails:fixture.expected}));
 let calls=0;const progress:WikiPlanningProgress[]=[];
 const planner=createWikiTopicPlanner("zh-CN",{getAnalysisKey:async()=>"mixed-legacy-csv",generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls++;return request.validate(value);}},new AbortController().signal,undefined,undefined,{onProgress:item=>progress.push(item)});
 planner.append(input);const result=await planner.finish();
 expect(calls).toBe(1);expect(result[1].subtopics).toHaveLength(1);expect(result.flatMap(page=>page.sectionIds)).toEqual(input.map(item=>item.id));expect(progress.at(-1)).toMatchObject({quarantinedReferences:1,completedWindows:1});
});
it("repairs the empty second subtopic using only its already-declared parent and leaves all other assignments fixed",async()=>{
 const input=sections(),value={pages:[{title:"本地存储",sectionIds:["m0","m1"],subtopics:[{title:"保存原文",sectionIds:["m0","m1"]}]},{title:"同步恢复",sectionIds:["m2","m3"],subtopics:[{title:"恢复状态",sectionIds:["m2"]},{title:"失败保留",sectionIds:[]}]}]};
 let calls=0;
 const result=await planWikiTopics(input,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;const data=JSON.parse(request.prompt);
  if(data.stage!=="ownership")return request.validate(value);
  expect(data.expectedSlotIds).toEqual(["r0"]);expect(data.slots[0].choices).toEqual(["s1","s2"]);
  expect(data.targets.map((target:{chapter:string})=>target.chapter)).toEqual(["同步恢复","同步恢复"]);
  return request.validate({owners:{r0:"s2"}});
 }},new AbortController().signal);
 expect(calls).toBe(2);expect(result[0].sectionIds).toEqual(["m0","m1"]);expect(result[1].subtopics?.map(topic=>topic.sectionIds)).toEqual([["m2"],["m3"]]);expect(value.pages[1].subtopics[1].sectionIds).toEqual([]);
});
it("removes only a confirmed empty placeholder when all real materials already have owners",async()=>{
 const input=sections(),value={pages:[{title:"本地存储",subtopics:[{title:"保存原文",sectionIds:["m0","m1"]}]},{title:"同步恢复",subtopics:[{title:"恢复状态",sectionIds:["m2","m3"]},{title:"失败保留",sectionIds:[]}]}]};let calls=0;
 const result=await planWikiTopics(input,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls++;return request.validate(value);}},new AbortController().signal);
 expect(calls).toBe(1);expect(result[1].subtopics).toHaveLength(1);expect(result.flatMap(page=>page.sectionIds)).toEqual(input.map(item=>item.id));
});
it.each(["flat","parent-only","leaf-only","assignments"] as const)("recovers an extra unknown reference in %s format without regenerating the valid directory",async format=>{
 const input=sections(),raw={pages:fixture.pages.map(page=>({...structuredClone(page),sectionIds:[...page.subtopics[0].sectionIds]}))};
 let value:unknown;
 if(format==="flat")value={pages:raw.pages.map(({subtopics:_,...page})=>{void _;return page;})};
 else if(format==="assignments")value={pages:raw.pages.map((page,index)=>({title:page.title,subtopics:[{key:`s${index}`,title:page.subtopics[0].title}]})),assignments:{m0:"s0",m1:"s1",m2:"s2",m3:"s3",m99:"s3"}};
 else{if(format==="parent-only")raw.pages[3].subtopics[0].sectionIds=["m3"];else raw.pages[3].sectionIds=["m3"];value=raw;}
 const before=structuredClone(value);let calls=0;
 const result=await planWikiTopics(input,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls++;return request.validate(value);}},new AbortController().signal);
 expect(calls).toBe(1);expect(result.flatMap(page=>page.sectionIds)).toEqual(input.map(item=>item.id));expect(result.map(page=>page.title)).toEqual(raw.pages.map(page=>page.title));expect(value).toEqual(before);
});

it("replays the screenshot's pages[3] failure and removes only a foreign reference without another model call",async()=>{
 const value={pages:fixture.pages},before=structuredClone(value),input=sections();
 expect(()=>validateWikiPlan(value,input)).toThrowError(expect.objectContaining({fieldPaths:["pages[3].sectionIds"],wikiDirectoryDetails:fixture.expected}));
 let calls=0;const progress:WikiPlanningProgress[]=[];
 const ai={getAnalysisKey:async()=>"identity-replay",generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls++;return request.validate(value);}};
 const run=async()=>{const planner=createWikiTopicPlanner("zh-CN",ai,new AbortController().signal,undefined,undefined,{onProgress:item=>progress.push(item)});planner.append(input);return planner.finish();};
 const result=await run();expect(calls).toBe(1);expect(result.map(page=>page.title)).toEqual(fixture.pages.map(page=>page.title));
 expect(result.flatMap(page=>page.sectionIds)).toEqual(input.map(item=>item.id));expect(value).toEqual(before);
 expect(progress.at(-1)).toMatchObject({quarantinedReferences:1,completedWindows:1,pendingAssignments:0});
 expect(await run()).toEqual(result);expect(calls).toBe(1);expect(progress.at(-1)?.reusedWindows).toBe(1);
});

it("distinguishes missing material from an extra reference and freezes every uncontested owner",()=>{
 const value=structuredClone({pages:fixture.pages});value.pages[1].subtopics[0].sectionIds=[];
 const repair=prepare(value);expect(repair.slots.map(slot=>slot.section.id)).toEqual(["m1"]);
 expect(repair.slots[0].choices).toHaveLength(4);
 expect(()=>repair.apply({owners:{r0:"m99"}})).toThrow();
 const result=repair.apply({owners:{r0:"s1"}});
 expect(result.flatMap(page=>page.sectionIds)).toEqual(["m0","m1","m2","m3"]);
 expect(result[3].subtopics?.[0].title).toBe("定位原文");
});

it("resolves an ambiguous real material only between its declared chapters while quarantining foreign IDs",()=>{
 const value=structuredClone({pages:fixture.pages});value.pages[0].subtopics[0].sectionIds.push("m1");
 const repair=prepare(value);expect(repair.slots.map(slot=>[slot.section.id,slot.choices])).toEqual([["m1",["s0","s1"]]]);
 expect(()=>repair.apply({owners:{r0:"s3"}})).toThrow();
 expect(repair.apply({owners:{r0:"s1"}}).flatMap(page=>page.sectionIds)).toEqual(["m0","m1","m2","m3"]);
});

it("resumes repeated invalid slot choices without regenerating the draft or losing valid progress",async()=>{
 let drafts=0,broken=true;const requested:string[][]=[];
 const input=sections(6),draft=structuredClone({pages:fixture.pages});
 const ai={getAnalysisKey:async()=>"stalled-replay",generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage!=="ownership"){drafts++;return request.validate(draft);}
  requested.push(data.expectedSlotIds);
  return request.validate({owners:broken?{r0:"s0",r1:"m99"}:Object.fromEntries(data.expectedSlotIds.map((id:string)=>[id,"s1"]))});
 }};
 const run=()=>planWikiTopics(input,"zh-CN",ai,new AbortController().signal);
 await expect(run()).rejects.toMatchObject({wikiPlanningResume:{completed:1,remaining:1}});
 await expect(run()).rejects.toMatchObject({wikiPlanningResume:{completed:1,remaining:1,reason:"stalled"}});
 broken=false;const result=await run();expect(drafts).toBe(1);
 expect(requested.slice(1).every(ids=>JSON.stringify(ids)==='["r1"]')).toBe(true);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id));
});

it("keeps model namespaces isolated and preserves the previous model's validated directory when switching back",async()=>{
 let calls=0;const input=sections();
 const run=(model:string)=>planWikiTopics(input,"zh-CN",{modelId:model,getAnalysisKey:async()=>model,generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls++;return request.validate({pages:fixture.pages});}},new AbortController().signal);
 const first=await run("model-a");expect(await run("model-b")).toEqual(first);expect(calls).toBe(2);
 expect(await run("model-a")).toEqual(first);expect(calls).toBe(2);
});

it("records full-window corrections as recoveries with safe directory failure counts",async()=>{
 let calls=0;const runId=crypto.randomUUID();
 const ai=createAtlasAIFromProvider({id:"replay-provider",modelId:"fixture",testConnection:async()=>({ok:true,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;return request.validate(calls===1?{pages:[{title:"",subtopics:[{title:"存储",sectionIds:["m0","m99"]}]}]}:{pages:[{title:"存储",subtopics:[{title:"保存",sectionIds:["m0"]}]}]});
 }},{id:"ai-settings",provider:"openai",baseUrl:"https://fixture.invalid",apiKey:"fixture",model:"fixture",updatedAt:1},undefined,runId);
 await planWikiTopics(sections(1),"zh-CN",ai,new AbortController().signal);
 const usage=(await listAIUsage()).filter(item=>item.runId===runId);
 expect(usage.find(item=>item.status==="failed")?.directoryValidation).toEqual({missing:0,duplicate:0,unknown:1,parentMismatch:0});
 expect(usage.find(item=>item.status==="completed")).toMatchObject({recoveryReason:"schema",recoveryDepth:1,parentOperationId:expect.any(String)});
 expect(analyzeOrganizationRuns([],usage,[])[0].recoveryRequests).toBe(1);
});
