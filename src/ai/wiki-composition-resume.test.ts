import "fake-indexeddb/auto";
import {beforeEach,expect,it,vi} from "vitest";
import {getDatabase} from "../storage/db";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {synthesizeCoveredFocus} from "./focus-coverage";
import {validateFocusResult} from "./focus-session";
import {transcriptPassages} from "../search/transcript-index";
import {AIProviderResponseError} from "./provider-errors";
import type {StructuredAIRequest} from "./provider";
import type {Conversation} from "../shared/types";
import type {FocusAnalysisProgress} from "../shared/focus-progress";
// One-sentence fixtures exercise resume mechanics; the length-based subtopic merge has its own tests.
vi.mock("./wiki-subtopic-budget",async original=>({...await original<typeof import("./wiki-subtopic-budget")>(),mergeThinWikiChapters:(sections:unknown[])=>({sections,merged:0,toName:[]})}));

const settings={id:"ai-settings" as const,provider:"openai" as const,model:"fixture",baseUrl:"https://fixture.invalid",apiKey:"fixture",updatedAt:1};
const sources:Conversation[]=[{id:"shared-source",title:"同步机制",platform:"chatgpt",url:"",updatedAt:1,messageCount:1}];
const passages=transcriptPassages(sources[0],[{id:"m0",conversationId:sources[0].id,messageIndex:0,role:"user",content:"同步失败时保留原始记录。通知可以关闭。原文访问受权限限制。",contentHash:"",preview:"",createdAt:1,updatedAt:1}]);
type Topic={ownerId:string;title:string;subtopics:Array<{title:string}>};
const prose=(data:{wikiTopics:Topic[];passages:Array<{id:string;wikiOwnerId:string}>},omit=false)=>({title:"同步项目",sections:data.wikiTopics.map(topic=>({title:topic.title,wikiOwnerId:topic.ownerId,kind:"finding",transition:"",evidenceIds:data.passages.filter(item=>item.wikiOwnerId===topic.ownerId).map(item=>item.id),body:topic.subtopics.slice(0,omit?1:undefined).map(child=>`## ${child.title}\n\n同步失败时保留原始记录。`).join("\n\n")}))});
beforeEach(async()=>{await(await getDatabase()).clear("semanticDecisionCache");});

it("retains a validated partial article with shared source support and resumes only missing children after timeout",async()=>{
 let reads=0,plans=0,writes=0,shouldTimeout=true;const targets:string[][]=[];
 const raw={id:crypto.randomUUID(),modelId:"fixture",testConnection:async()=>({ok:true as const,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_topic_plan"){
   plans++;const ids=data.sections.map((item:{id:string})=>item.id);
   return request.validate({scope:[], pages:[{title:"同步机制",subtopics:["保存规则","通知控制","访问限制"].map(title=>({title,sectionIds:ids}))}]});
  }
  if(!data.coverage.final){reads++;return request.validate({title:"笔记",sections:[{title:"同步机制",kind:"finding",transition:"",body:"同步失败时保留原始记录。通知可以关闭。原文访问受权限限制。",evidenceIds:data.passages.map((item:{id:string})=>item.id)}]});}
  writes++;
  const completing=request.system.includes("TARGETED COMPLETION");
  if(completing){
   targets.push(data.wikiTopics.flatMap((topic:Topic)=>topic.subtopics.map(child=>child.title)));
   expect(request.system).toContain("earlier verified prose is retained locally");
   if(shouldTimeout){shouldTimeout=false;throw new AIProviderResponseError("PROVIDER_TIMEOUT");}
  }
  return request.validate(prose(data,!completing));
 }};
 const progress:FocusAnalysisProgress[]=[];
 const run=()=>synthesizeCoveredFocus({goal:"整理同步项目",mode:"work",locale:"zh-CN",sources,passages,ai:createAtlasAIFromProvider(raw,settings),collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult,onProgress:(_done,_total,_stage,detail)=>{if(detail)progress.push(detail);}});
 await expect(run()).rejects.toMatchObject({code:"PROVIDER_TIMEOUT"});
 expect({reads,plans,writes}).toEqual({reads:1,plans:1,writes:2});
 // Evict ordinary model results, preserving only durable task records.
 const db=await getDatabase();for(const row of await db.getAll("semanticDecisionCache"))if(!row.providerId.startsWith("focus-"))await db.delete("semanticDecisionCache",row.id);
 progress.length=0;
 const result=await run();expect({reads,plans,writes}).toEqual({reads:1,plans:1,writes:3});
 expect(targets).toEqual([["通知控制","访问限制"],["通知控制","访问限制"]]);
 expect(progress.every(detail=>detail.final&&detail.resumed&&detail.stage==="synthesis")).toBe(true);
 for(const title of ["保存规则","通知控制","访问限制"])expect(result.result.sections[0].body.split(`## ${title}`).length).toBe(2);
 expect(result.result.sections[0].evidenceIds).toEqual(result.evidence.map(item=>item.id));
 expect(result.result.brief).toBeUndefined(); // Overview remains locally derived, never another model request.
});

it("does not reuse completed writing when the source text changes",async()=>{
 let reads=0;
 const raw={id:crypto.randomUUID(),modelId:"fixture",testConnection:async()=>({ok:true as const,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_topic_plan")return request.validate({scope:[], pages:[{title:"同步机制",subtopics:[{title:"保存规则",sectionIds:data.sections.map((item:{id:string})=>item.id)}]}]});
  if(!data.coverage.final){reads++;return request.validate({title:"笔记",sections:[{title:"同步机制",kind:"finding",transition:"",body:data.passages[0].text,evidenceIds:data.passages.map((item:{id:string})=>item.id)}]});}
  return request.validate(prose(data));
 }};
 const run=(input=passages)=>synthesizeCoveredFocus({goal:"整理同步项目",mode:"work",locale:"zh-CN",sources,passages:input,ai:createAtlasAIFromProvider(raw,settings),collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 await run();await run();expect(reads).toBe(1);
 const changed=transcriptPassages(sources[0],[{id:"m0",conversationId:sources[0].id,messageIndex:0,role:"user",content:"更正：同步只在用户确认后执行。",contentHash:"",preview:"",createdAt:1,updatedAt:2}]);
 await run(changed);expect(reads).toBe(2);
});

it("preserves cancelled composition without returning it as a complete preview",async()=>{
 const abort=new AbortController(),partial=vi.fn();let reads=0,writes=0,cancel=true;
 const raw={id:crypto.randomUUID(),modelId:"fixture",testConnection:async()=>({ok:true as const,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_topic_plan")return request.validate({scope:[], pages:[{title:"同步机制",subtopics:[{title:"保存规则",sectionIds:data.sections.map((item:{id:string})=>item.id)}]}]});
  if(!data.coverage.final){reads++;return request.validate({title:"笔记",sections:[{title:"同步机制",body:"同步失败时保留原始记录。",kind:"finding",transition:"",evidenceIds:data.passages.map((item:{id:string})=>item.id)}]});}
  writes++;const result=request.validate(prose(data));if(cancel){cancel=false;abort.abort();}return result;
 }};
 const run=(signal:AbortSignal)=>synthesizeCoveredFocus({goal:"整理同步项目",mode:"work",locale:"zh-CN",sources,passages,ai:createAtlasAIFromProvider(raw,settings),collectProjectKnowledge:true,signal,validate:validateFocusResult,onPartial:partial});
 await expect(run(abort.signal)).rejects.toMatchObject({name:"AbortError"});expect(partial.mock.calls.every(([preview])=>preview.sections.every((section:{wikiOutline?:boolean})=>section.wikiOutline))).toBe(true);
 await run(new AbortController().signal);expect({reads,writes}).toEqual({reads:1,writes:2});
});

it("resumes a late timeout in a 554-passage pipeline without reading, planning or regenerating any successful writing request",async()=>{
 const source={...sources[0],id:"long-source",messageCount:554};
 const original=Array.from({length:554},(_,index)=>({id:`message-${index}`,conversationId:source.id,messageIndex:index,role:"user" as const,content:`独特条件${index}：同步失败时保留原始记录，不覆盖已有材料。`,contentHash:"",preview:"",createdAt:1,updatedAt:1}));
 const all=transcriptPassages(source,original);let reads=0,plans=0,blocked=true;
 const successes=new Set<string>(),regenerated:string[]=[];let initialSuccessfulWrites=0;
 const raw={id:crypto.randomUUID(),modelId:"fixture",testConnection:async()=>({ok:true as const,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_topic_plan"){
   plans++;const ids=data.sections.map((item:{id:string})=>item.id);
   return request.validate({scope:[], pages:[{title:"同步机制",subtopics:[{title:"保存规则",sectionIds:ids}]}]});
  }
  if(!data.coverage.final){
   reads++;const size=Math.ceil(data.passages.length/12),sections=[];
   for(let at=0;at<data.passages.length;at+=size){const items=data.passages.slice(at,at+size);sections.push({title:"同步机制",kind:"finding",transition:"",body:items.map((item:{text:string})=>item.text+"同步失败时保留原始记录。".repeat(30)).join("\n\n"),evidenceIds:items.map((item:{id:string})=>item.id)});}
   return request.validate({title:"笔记",sections});
  }
  if(blocked&&data.passages.some((item:{text:string})=>item.text.includes("独特条件500：")))throw new AIProviderResponseError("PROVIDER_TIMEOUT");
  if(successes.has(request.prompt))regenerated.push(request.prompt);
  const result=request.validate(prose(data));successes.add(request.prompt);return result;
 }};
 const progress:FocusAnalysisProgress[]=[];
 const run=()=>synthesizeCoveredFocus({goal:"整理同步项目",mode:"work",locale:"zh-CN",sources:[source],passages:all,ai:createAtlasAIFromProvider(raw,settings),collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult,onProgress:(_done,_total,_stage,detail)=>{if(detail)progress.push(detail);}});
 await expect(run()).rejects.toMatchObject({code:"PROVIDER_TIMEOUT"});
 initialSuccessfulWrites=successes.size;expect(initialSuccessfulWrites).toBeGreaterThan(2);
 const before={reads,plans};blocked=false;
 const db=await getDatabase();for(const row of await db.getAll("semanticDecisionCache"))if(!row.providerId.startsWith("focus-"))await db.delete("semanticDecisionCache",row.id);
 progress.length=0;
 const result=await run();
 expect({reads,plans}).toEqual(before);expect(regenerated).toEqual([]);
 expect(progress.every(detail=>detail.resumed&&detail.final&&detail.processedSegments===554)).toBe(true);
 expect(result.segmentCount).toBe(554);expect(result.result.sections.flatMap(section=>section.evidenceIds)).toHaveLength(554);
},30000);

it("passes checkpoint identity through the real reading/directory queue wrapper",async()=>{
 const source={...sources[0],id:"directory-source",messageCount:18};
 const all=transcriptPassages(source,Array.from({length:18},(_,index)=>({id:`message-${index}`,conversationId:source.id,messageIndex:index,role:"user" as const,content:`规则${index}：保留原始记录。`,contentHash:"",preview:"",createdAt:1,updatedAt:1})));
 let plans=0;
 const raw={id:crypto.randomUUID(),modelId:"fixture",testConnection:async()=>({ok:true as const,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.stage==="ownership"){const slot=data.slots[0];return request.validate({owners:{[slot.id]:slot.choices[0]}});}
  if(data.presentation==="wiki_topic_plan"){
   plans++;const ids=data.sections.map((item:{id:string})=>item.id);
   return request.validate({scope:[], pages:[{title:"同步机制",subtopics:[{title:"保存规则",sectionIds:ids}]},{title:"访问限制",subtopics:[{title:"访问约束",sectionIds:ids.slice(0,17)}]}]});
  }
  return request.validate({title:"笔记",sections:data.passages.map((item:{id:string;text:string})=>({title:"同步机制",body:item.text,kind:"finding",transition:"",evidenceIds:[item.id]}))});
 }};
 const run=()=>synthesizeCoveredFocus({goal:"整理同步项目",mode:"work",locale:"zh-CN",sources:[source],passages:all,ai:createAtlasAIFromProvider(raw,settings),collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 // One run continues by itself twice (4 → 8 → 12) before reporting, reusing the read and plan.
 await expect(run()).rejects.toMatchObject({wikiPlanningResume:{completed:12,remaining:5}});
 expect(plans).toBe(1);
 // A later run resumes from the retained owners, finishes planning and moves on.
 const second=await run().then(()=>undefined,(error:{wikiPlanningResume?:unknown})=>error);
 expect(second?.wikiPlanningResume).toBeUndefined();expect(plans).toBe(1);
});

it("continues a shared-support article past its local recovery allowance without rewriting confirmed prose",async()=>{
 let reads=0,plans=0,initialWrites=0,completions=0;
 const raw={id:crypto.randomUUID(),modelId:"fixture",testConnection:async()=>({ok:true as const,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_topic_plan"){
   plans++;const ids=data.sections.map((item:{id:string})=>item.id);
   return request.validate({scope:[], pages:[{title:"同步机制",subtopics:Array.from({length:7},(_,index)=>({title:`边界条件${index}`,sectionIds:ids}))}]});
  }
  if(!data.coverage.final){reads++;return request.validate({title:"笔记",sections:[{title:"同步机制",kind:"finding",transition:"",body:"同步失败时保留原始记录。",evidenceIds:data.passages.map((item:{id:string})=>item.id)}]});}
  const completing=request.system.includes("TARGETED COMPLETION");
  if(completing)completions++;else initialWrites++;
  // Even a grouped completion may return only its first requested child.
  // Retain that validated progress, then pause at the unchanged call limit.
  return request.validate(prose(data,true));
 }};
 const run=()=>synthesizeCoveredFocus({goal:"整理同步项目",mode:"work",locale:"zh-CN",sources,passages,ai:createAtlasAIFromProvider(raw,settings),collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 await expect(run()).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_writing_recovery_limit",message:expect.stringContaining("单批恢复 4/4")});
 expect(completions).toBe(4);
 const result=await run();expect({reads,plans,initialWrites,completions}).toEqual({reads:1,plans:1,initialWrites:1,completions:6});
 expect(result.result.sections[0].body.match(/^## /gmu)).toHaveLength(7);
});

it("stops continuing planning once a continuation makes no progress",async()=>{
 const source={...sources[0],id:"stalled-source",messageCount:18};
 const all=transcriptPassages(source,Array.from({length:18},(_,index)=>({id:`stall-${index}`,conversationId:source.id,messageIndex:index,role:"user" as const,content:`规则${index}：保留原始记录。`,contentHash:"",preview:"",createdAt:1,updatedAt:1})));
 let ownership=0;
 const raw={id:crypto.randomUUID(),modelId:"fixture",testConnection:async()=>({ok:true as const,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  // Every ownership answer is unusable, so no continuation can make progress.
  if(data.stage==="ownership"){ownership++;return request.validate({owners:{}});}
  if(data.presentation==="wiki_topic_plan"){const ids=data.sections.map((item:{id:string})=>item.id);return request.validate({scope:[], pages:[{title:"同步机制",subtopics:[{title:"保存规则",sectionIds:ids}]},{title:"访问限制",subtopics:[{title:"访问约束",sectionIds:ids.slice(0,17)}]}]});}
  return request.validate({title:"笔记",sections:data.passages.map((item:{id:string;text:string})=>({title:"同步机制",body:item.text,kind:"finding",transition:"",evidenceIds:[item.id]}))});
 }};
 const run=()=>synthesizeCoveredFocus({goal:"整理停滞项目",mode:"work",locale:"zh-CN",sources:[source],passages:all,ai:createAtlasAIFromProvider(raw,settings),collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 await expect(run()).rejects.toThrow();
 const first=ownership;
 // At most one extra attempt beyond the initial one: the stalled key repeats and stops it.
 expect(first).toBeGreaterThan(0);
 await expect(run()).rejects.toThrow();
 expect(ownership-first).toBeLessThanOrEqual(first);
},20000);
