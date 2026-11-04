import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { createAIProvider } from "./provider";
import { createAtlasAIFromProvider } from "./atlas-ai";
import { synthesizeCoveredFocus } from "./focus-coverage";
import { validateFocusResult } from "./focus-session";
import { transcriptPassages } from "../search/transcript-index";
import { getDatabase } from "../storage/db";
import type { AISettings, Conversation } from "../shared/types";
import { aiRetryTiming } from "./atlas-ai";
// These cases drive many provider retries; their pauses need not pass in real time.
beforeAll(() => { aiRetryTiming.scale = 0; });
afterAll(() => { aiRetryTiming.scale = 1; });
// One-sentence fixtures exercise resume mechanics; the length-based subtopic merge has its own tests.
vi.mock("./wiki-subtopic-budget",async original=>({...await original<typeof import("./wiki-subtopic-budget")>(),mergeThinWikiChapters:(sections:unknown[])=>({sections,merged:0,toName:[]})}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("completes shared-source subtopics through the real Qwen wire decoder without extending task data contracts",async()=>{
 const source:Conversation={id:crypto.randomUUID(),title:"同步机制",platform:"chatgpt",url:"",messageCount:1,updatedAt:1};
 const passages=transcriptPassages(source,[{id:source.id,conversationId:source.id,role:"user",messageIndex:0,content:"同步失败保留记录。用户可以关闭通知，访问原文需要权限。",preview:"",contentHash:"",createdAt:1,updatedAt:1}]);
 let reads=0,plans=0,writes=0;const completionTitles:string[][]=[];
 vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{
  const sent=JSON.parse(String(init?.body)),wire=JSON.parse(sent.messages[1].content),data=wire.data??wire;
  expect(data.writingRepair).toBeUndefined();expect(data.writingCorrection).toBeUndefined();
  let value:unknown;
  if(data.presentation==="wiki_topic_plan"){
   plans++;value={scope:[], pages:[{title:"同步机制",subtopics:["保存规则","通知控制","访问限制"].map(title=>({title,sectionIds:data.sections.map((item:{id:string})=>item.id)}))}]};
  }else if(!data.coverage.final){reads++;value={notes:[{title:"同步机制",text:"同步失败保留记录。用户可以关闭通知，访问原文需要权限。",start:0,transition:""}]};}
  else{
   writes++;const completing=sent.messages[0].content.includes("TARGETED COMPLETION");
   if(completing)completionTitles.push(data.wikiTopics.flatMap((topic:{subtopics:Array<{title:string}>})=>topic.subtopics.map(item=>item.title)));
   value={title:"同步项目",sections:data.wikiTopics.map((topic:{ownerId:string;title:string;subtopics:Array<{title:string}>})=>({title:topic.title,wikiOwnerId:topic.ownerId,kind:"finding",transition:"",body:topic.subtopics.slice(0,completing?undefined:1).map(item=>`## ${item.title}\n\n同步失败保留记录。`).join("\n\n"),evidenceIds:data.passages.map((item:{id:string})=>item.id)}))};
  }
  return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:50}});
 }));
 const settings:AISettings={id:"ai-settings",provider:"qwen",model:"fixture",baseUrl:"https://qwen-fixture.invalid/v1",apiKey:"synthetic",updatedAt:1};
 const result=await synthesizeCoveredFocus({goal:"整理同步项目",mode:"work",locale:"zh-CN",sources:[source],passages,ai:createAtlasAIFromProvider(createAIProvider(settings),settings),collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 expect({reads,plans,writes}).toEqual({reads:1,plans:1,writes:2});expect(completionTitles).toEqual([["通知控制","访问限制"]]);
 expect(result.result.sections[0].body.match(/^## /gmu)).toHaveLength(3);
 expect(result.result.sections[0].evidenceIds).toEqual(result.evidence.map(item=>item.id));
});

it.each(["missing-owner", "missing-evidence", "unknown-evidence", "invalid-claim", "repair-claim", "timeout", "interrupted-stream", "persistent-invalid", "persistent-stream", "persistent-timeout"])("recovers bounded final Wiki work through real provider messages: %s", async scenario => {
  const runId=crypto.randomUUID();
  const sources:Conversation[]=Array.from({length:4},(_,index)=>({id:`${runId}:${index}`,title:index%2?"通知控制":"消息检索",platform:"chatgpt",url:"",messageCount:1,updatedAt:1}));
  const passages=sources.flatMap(source=>transcriptPassages(source,[{id:source.id,conversationId:source.id,role:"user",messageIndex:0,content:`${source.title}失败时保留原始消息，不覆盖已有材料。`,preview:"",contentHash:"",createdAt:1,updatedAt:1}]));
  let reads=0,plans=0,writes=0,repairs=0;
  const fetch=vi.fn(async (_url:unknown,init?:RequestInit)=>{
    const sent=JSON.parse(String(init?.body)),wire=JSON.parse(sent.messages[1].content),data=wire.data??wire;
    let value:unknown;
    if(data.presentation==="wiki_claim_repair"){
      repairs++;expect(sent.messages[1].content).not.toContain("## 具体机制");
      // An invented repair must fall back to the existing bounded write path.
      value={claims:data.fields.map((field:{path:string;allowedEvidenceIds:string[]})=>({path:field.path,quote:scenario==="invalid-claim"?"不在来源里的引句":"失败时保留原始消息，不覆盖已有材料。",evidenceIds:field.allowedEvidenceIds}))};
    }else if(data.presentation==="wiki_topic_plan"){
      plans++;const groups=new Map<string,string[]>();
      for(const section of data.sections)groups.set(section.title,[...groups.get(section.title)??[],section.id]);
      value={scope:[], pages:[...groups].map(([title],index)=>({title,group:"功能",question:title,subtopics:[{key:`t${index}`,title:"具体机制",question:"如何保留数据？"}]})),assignments:Object.fromEntries([...groups].flatMap(([,ids],index)=>ids.map(id=>[id,`t${index}`])))};
    } else if(!data.coverage.final){
      reads++;value={notes:[{title:data.passages[0].title,text:"失败时保留原始消息，不覆盖已有材料。",start:0,phase:"讨论",transition:""}]};
    } else {
      writes++;
      if((scenario==="timeout"&&writes===1)||scenario==="persistent-timeout")throw new (await import("./provider-errors")).AIProviderResponseError("PROVIDER_TIMEOUT");
      if((scenario==="interrupted-stream"&&writes===1)||scenario==="persistent-stream")return new Response(`data: ${JSON.stringify({choices:[{delta:{content:'{"title":'}}]})}\n\n`,{headers:{"Content-Type":"text/event-stream"}});
      const sections=data.wikiTopics.map((topic:{ownerId:string;title:string})=>({title:topic.title,wikiOwnerId:topic.ownerId,body:"## 具体机制\n\n失败时保留原始消息，不覆盖已有材料。",transition:"",kind:"finding",evidenceIds:data.passages.filter((passage:{wikiOwnerId:string})=>passage.wikiOwnerId===topic.ownerId).map((passage:{id:string})=>passage.id)}));
      if(writes===1&&scenario==="missing-owner")sections.pop();
      if(writes===1&&scenario==="missing-evidence")delete (sections[0] as Partial<typeof sections[number]>).evidenceIds;
      if((writes===1&&scenario==="unknown-evidence")||scenario==="persistent-invalid")sections[0].evidenceIds=["e999"];
      if(writes===1&&scenario==="invalid-claim")sections[0].claims=[{text:"遗漏引用的结论"}];
      if(writes===1&&scenario==="repair-claim")sections[0].claims=[{text:"失败时保留原始消息",quote:"",evidenceIds:sections[0].evidenceIds}];
      value={title:"项目",sections};
    }
    return Response.json({id:crypto.randomUUID(),choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:100}});
  });
  vi.stubGlobal("fetch",fetch);
  const settings:AISettings={id:"ai-settings",provider:"openai-compatible",model:`recovery-${runId}`,baseUrl:"https://recovery.invalid/v1",apiKey:"synthetic",updatedAt:1};
  const ai=createAtlasAIFromProvider(createAIProvider(settings),settings,undefined,runId),onPartial=vi.fn(),progress=vi.fn();
  const run=()=>synthesizeCoveredFocus({goal:"整理项目",mode:"work",locale:"zh-CN",sources,passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult,onPartial,onProgress:progress});
  if(scenario.startsWith("persistent")){
    await expect(run()).rejects.toMatchObject({code:scenario==="persistent-stream"?"PROVIDER_STREAM_INCOMPLETE":scenario==="persistent-timeout"?"PROVIDER_TIMEOUT":"PROVIDER_SCHEMA_unknown_evidence_id"});
    expect(writes).toBeLessThanOrEqual(scenario==="persistent-stream"?2:7);expect(onPartial.mock.calls.every(([partial])=>partial.sections.every((section:{wikiOutline?:boolean})=>section.wikiOutline))).toBe(true);return;
  }
  const result=await run();
  expect(result.result.sections).toHaveLength(2);
  expect(result.result.sections.every(section=>section.evidenceIds.length===2)).toBe(true);
  expect(progress.mock.calls.some(call=>call[3]?.phase==="directory"&&call[3].processedSegments===4)).toBe(true);
  expect({reads,plans,writes}).toEqual({reads:4,plans:1,writes:scenario==="repair-claim"?1:scenario==="interrupted-stream"?2:3});
  expect(repairs).toBe(["invalid-claim","repair-claim"].includes(scenario)?1:0);
  const paid={reads,plans,writes,repairs};await run();expect({reads,plans,writes,repairs}).toEqual(paid);
  const events=(await(await getDatabase()).getAll("aiUsageEvents")).filter(event=>event.runId===runId);
  expect(events.some(event=>event.parentOperationId&&event.recoveryReason===(scenario==="interrupted-stream"||scenario==="timeout"?"transport":"schema"))).toBe(true);
  expect(events.filter(event=>event.operation==="wiki:reading"&&event.status!=="cached")).toHaveLength(4);
});
