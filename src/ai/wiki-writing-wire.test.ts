import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { createAIProvider } from "./provider";
import { createAtlasAIFromProvider } from "./atlas-ai";
import { synthesizeCoveredFocus } from "./focus-coverage";
import { validateFocusResult } from "./focus-session";
import { transcriptPassages } from "../search/transcript-index";
import { requestMessages, validateProviderOutput } from "./request-policy";
import type { AISettings, Conversation } from "../shared/types";
import type { StructuredAIRequest } from "./provider";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const subject=(index:number)=>index%2?"通知控制":"消息检索";
type Topic={ownerId:string;title:string;opening?:boolean;subtopics?:Array<{title:string;evidenceIds:string[]}>};
type Wire={data?:{coverage?:{final:boolean};presentation?:string;passages:Array<{id:string;title?:string;text:string;wikiOwnerId?:string}>;sections?:Array<{id:string;title:string}>;wikiTopics?:Topic[]};response?:string;expectedShape?:{sections:Array<{wikiOwnerId:string;body:string;kind:string;evidenceIds:string[]}>};wikiTopics?:Topic[];passageOwners?:Array<{id:string;wikiOwnerId:string}>;allowedEvidenceIds?:string[]};

it.each(["omitted", "invalid-kind", "foreign-owner", "owner-split", "owner-resume", "retry-resume"])("uses actual provider HTTP messages and preserves Wiki ownership through %s output", async scenario => {
  const runId=crypto.randomUUID(), sources:Conversation[]=Array.from({length:4},(_,index)=>({id:`${runId}:${index}`,title:subject(index),platform:"chatgpt",url:"",messageCount:1,updatedAt:1}));
  const passages=sources.flatMap((source,index)=>transcriptPassages(source,[{id:source.id,conversationId:source.id,messageIndex:0,role:"user",content:index%2?"通知只有在用户开启后发送，关闭时不发送。":"检索按消息维护索引，失败时保留原始消息。",preview:"",contentHash:"",createdAt:1,updatedAt:1}]));
  let reads=0,plans=0,writes=0,repairs=0,titles=0;
  let failedWrites=0;
  let allowGood = !["retry-resume","owner-resume"].includes(scenario);
  const fetch=vi.fn(async (_url:unknown,init?:RequestInit)=>{
    const request=JSON.parse(String(init?.body)) as {messages:Array<{role:string;content:string}>};
    const parsed=JSON.parse(request.messages.find(message=>message.role==="user")!.content);
    const wire=(parsed.presentation==="wiki_topic_plan"?{data:parsed}:parsed) as Wire;
    let value:unknown;
    if(parsed.presentation==="wiki_title_edit"){
      titles++;value={titles:parsed.titles.map((item:{id:string;title:string})=>({id:item.id,title:item.id==="d:0"?"消息管理工具":item.title,keep:item.id!=="d:0"}))};
    }else if(wire.response){
      repairs++;
      expect(request.messages[0].content).toContain("Preserve the Wiki writing contract");
      expect(wire.wikiTopics).toHaveLength(2);expect(wire.passageOwners).toHaveLength(4);
      expect(wire.data).toBeUndefined();
      expect(wire.expectedShape?.sections.map(section=>section.wikiOwnerId)).toEqual(wire.wikiTopics!.map(topic=>topic.ownerId));
      const previous=JSON.parse(wire.response) as {sections:Array<{wikiOwnerId?:string;kind:string;evidenceIds:string[];body:string}>};
      value=(scenario==="retry-resume"&&!allowGood || ["owner-split","owner-resume"].includes(scenario))?previous:{...previous,sections:previous.sections.map(section=>({...section,kind:"review",wikiOwnerId:wire.passageOwners!.find(passage=>passage.id===section.evidenceIds[0])!.wikiOwnerId}))};
      expect((value as typeof previous).sections.map(section=>section.body)).toEqual(previous.sections.map(section=>section.body));
    }else if(wire.data?.presentation==="wiki_topic_plan"){
      plans++;const groups=new Map<string,string[]>();
      for(const section of wire.data.sections!){groups.set(section.title,[...groups.get(section.title)??[],section.id]);}
      value={scope:[], pages:[...groups].map(([title],index)=>({title,group:"功能",question:`${title}如何工作？`,subtopics:[{key:`t${index}`,title:"具体机制",question:"哪些机制和条件？"}]})),assignments:Object.fromEntries([...groups].flatMap(([,ids],index)=>ids.map(id=>[id,`t${index}`])))};
    }else if(!wire.data?.coverage?.final){
      reads++;const passage=wire.data!.passages[0];
      value={notes:[{title:passage.text.includes("通知")?"通知控制":"消息检索",text:passage.text,start:0,phase:"方案讨论",transition:""}]};
    }else{
      writes++;const data=wire.data;
      expect(data.wikiTopics!.length).toBeGreaterThanOrEqual(1);
      if(data.wikiTopics!.length===1 && !allowGood) expect(request.messages[0].content).toContain("Copy wikiOwnerId exactly");
      expect(data.passages.every(passage=>data.wikiTopics!.some(topic=>topic.ownerId===passage.wikiOwnerId))).toBe(true);
      expect(wire.expectedShape!.sections.every(section=>section.wikiOwnerId&&section.body.includes("## 具体机制")&&section.kind==="review")).toBe(true);
      value={title:"项目知识",sections:[...data.wikiTopics!].reverse().map(topic=>({title:"模型另取的标题",...(topic.opening?{chapterOverview:`本章说明${topic.title}的适用条件，保留未确认的建议和失败时的数据边界。`}:{}),body:`## 具体机制\n\n${topic.title}依据原始讨论保留明确条件，未确认的建议保持待确认。`,transition:"",kind:scenario==="invalid-kind"?"module":"review",evidenceIds:data.passages.filter(passage=>!allowGood || scenario==="owner-split" && data.wikiTopics!.length>1 || passage.wikiOwnerId===topic.ownerId).map(passage=>passage.id),...((scenario==="foreign-owner" || scenario==="retry-resume"&&!allowGood || scenario==="owner-resume"&&!allowGood&&(data.wikiTopics!.length>1||topic.title==="通知控制"))?{wikiOwnerId:"invented-owner"}:{})}))};
    }
    return new Response(JSON.stringify({id:crypto.randomUUID(),choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:100}}),{headers:{"Content-Type":"application/json"}});
  });
  vi.stubGlobal("fetch",fetch);
  const settings:AISettings={id:"ai-settings",provider:"openai-compatible",model:`fixture-${scenario}`,baseUrl:`https://wiki-${scenario}.invalid/v1`,apiKey:"fixture",updatedAt:1};
  const ai=createAtlasAIFromProvider(createAIProvider(settings),settings,undefined,runId);
  const onPartial=vi.fn();
  const run=()=>synthesizeCoveredFocus({goal:"整理项目",mode:"work",locale:"zh-CN",sources,passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult,onPartial});
  if(["retry-resume","owner-resume"].includes(scenario)){
    await expect(run()).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_owner_missing_or_unknown"});
    // Only the outline (key points, never saved) may be shown before writing fails.
    expect(onPartial.mock.calls.every(([partial])=>partial.sections.every((section:{wikiOutline?:boolean})=>section.wikiOutline))).toBe(true);
    expect({reads,plans,repairs}).toEqual({reads:4,plans:1,repairs:1});
    expect(writes).toBeGreaterThan(1);expect(writes).toBeLessThanOrEqual(5);failedWrites=writes;
    allowGood=true;
  }
  const result=await run();
  expect({reads,plans,writes,repairs}).toEqual({reads:4,plans:1,writes:["retry-resume","owner-resume"].includes(scenario)?failedWrites+1:scenario==="owner-split"?3:1,repairs:scenario==="omitted"?0:1});
  if(["owner-split","owner-resume"].includes(scenario)){
    const before=fetch.mock.calls.length;
    const resumed=await run();expect(fetch.mock.calls.length).toBe(before);
    expect(resumed.result.sections).toEqual(result.result.sections);
  }
  expect(titles).toBe(1);expect(result.result.title).toBe("消息管理工具");
  expect(result.topicPlanApplied).toBe(true);expect(result.result.sections).toHaveLength(2);
  expect(result.result.sections.every(section=>section.body.startsWith("本章说明")&&section.body.includes("\n\n## 具体机制"))).toBe(true);
  expect(result.result.sections.every(section=>!("chapterOverview" in section))).toBe(true);
  expect(new Set(result.result.sections.map(section=>section.title))).toEqual(new Set(["消息检索","通知控制"]));
  expect(new Set(result.result.sections.map(section=>section.wikiOwnerId)).size).toBe(2);
  expect(result.result.sections.every(section=>section.evidenceIds.length===2)).toBe(true);
});

it("includes the same owner/citation contract in bounded format repair without copying source bodies",()=>{
  const payload={intent:"整理",mode:"work",strategy:"work",locale:"zh-CN",coverage:{stage:"synthesis",final:true},passages:[{id:"note-private",text:"PRIVATE ORIGINAL SOURCE",wikiOwnerId:"owner-search"}],wikiTopics:[{ownerId:"owner-search",title:"消息检索",subtopics:[{title:"具体机制",evidenceIds:["note-private"]}]}]};
  const request:StructuredAIRequest<unknown>={taskType:"focus_session",system:"Caller requirement",prompt:JSON.stringify(payload),repairContent:JSON.stringify({title:"项目",sections:[{title:"搜索",body:"现有正文。",kind:"module",transition:"",evidenceIds:["e1"]}]}),validate:value=>value};
  const messages=requestMessages(request),wire=JSON.parse(messages[1].content);
  expect(wire.expectedShape.sections[0]).toMatchObject({wikiOwnerId:"owner-search",evidenceIds:["e1"]});
  expect(wire.wikiTopics[0].subtopics[0].evidenceIds).toEqual(["e1"]);
  expect(wire.passageOwners).toEqual([{id:"e1",wikiOwnerId:"owner-search"}]);
  expect(JSON.stringify(messages)).not.toMatch(/PRIVATE ORIGINAL SOURCE|note-private/);
  expect(()=>validateProviderOutput(request,{title:"项目",sections:[{title:"搜索",body:"现有正文。",kind:"module",transition:"",evidenceIds:["e1"]}]})).toThrowError(expect.objectContaining({code:"PROVIDER_SCHEMA_invalid_section_type",fieldPaths:["sections[0].kind"]}));
});

it("repairs generated note language once without retransmitting original passages or altering source quotes",async()=>{
  let calls=0;
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
    calls++;const body=JSON.parse(String(init?.body)),wire=JSON.parse(body.messages[1].content);
    if(calls===2){
      expect(wire.locale).toBe("zh-CN");expect(wire.fields.map((field:{path:string})=>field.path)).toEqual(["notes[0].title","notes[0].text"]);
      expect(wire.data).toBeUndefined();expect(wire.wikiTopics).toBeUndefined();
      expect(JSON.stringify(body.messages)).not.toContain("PRIVATE ORIGINAL PASSAGE");
      expect(body.messages[0].content).toContain("quotation blocks and quoted strings verbatim");
    }
    const value=calls===1?{notes:[{title:"An English source summary",text:"The user discussed message search and keeping original messages after a failed indexing attempt.\n\n> Keep original quotes unchanged.",start:0,phase:"讨论",transition:""}]}:{translations:[{path:"notes[0].title",text:"消息检索"},{path:"notes[0].text",text:"用户讨论按消息检索，索引失败时保留原始消息。\n\n> Keep original quotes unchanged."}]};
    return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:100}}),{headers:{"Content-Type":"application/json"}});
  });
  vi.stubGlobal("fetch",fetch);
  const settings:AISettings={id:"ai-settings",provider:"openai-compatible",model:"fixture-language",baseUrl:"https://wiki-language.invalid/v1",apiKey:"fixture",updatedAt:1};
  const ai=createAtlasAIFromProvider(createAIProvider(settings),settings);
  const result=await ai.synthesize<{sections:Array<{body:string;evidenceIds:string[]}>}>({taskType:"focus_session",system:"Read source notes",prompt:JSON.stringify({intent:"整理",mode:"work",locale:"zh-CN",coverage:{stage:"reading",final:false},passages:[{id:"private-source",text:"PRIVATE ORIGINAL PASSAGE 用户讨论按消息检索，索引失败时保留原始消息。"}]}),validate:value=>value as {sections:Array<{body:string;evidenceIds:string[]}>}});
  expect(calls).toBe(2);expect(result.sections[0].body).toContain("用户讨论按消息检索");expect(result.sections[0].body).toContain("> Keep original quotes unchanged.");expect(result.sections[0].evidenceIds).toEqual(["private-source"]);
});
