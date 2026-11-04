import "fake-indexeddb/auto";
import {expect,it,vi} from "vitest";
import {synthesizeCoveredFocus} from "./focus-coverage";
import {validateFocusResult} from "./focus-session";
import {transcriptPassages} from "../search/transcript-index";
import type {StructuredAIRequest} from "./provider";
import type {Conversation} from "../shared/types";
// One-sentence fixtures exercise resume mechanics; the length-based subtopic merge has its own tests.
vi.mock("./wiki-subtopic-budget",async original=>({...await original<typeof import("./wiki-subtopic-budget")>(),mergeThinWikiChapters:(sections:unknown[])=>({sections,merged:0,toName:[]})}));

it("keeps the 48000 cap and resumes only unfinished writing after genuine exhaustion",async()=>{
 const runId=crypto.randomUUID(),paragraph="只有用户确认本次保存后才能更新记录；失败时保留原始消息，不能覆盖已有草稿，用户报告完成不等于代码验证。";
 const sources:Conversation[]=Array.from({length:10},(_,i)=>({id:`${runId}:${i}`,title:"记录保留",platform:"chatgpt",url:"",updatedAt:1,messageCount:1}));
 const passages=sources.flatMap(source=>transcriptPassages(source,[{id:source.id,conversationId:source.id,role:"user",messageIndex:0,content:paragraph.repeat(180),preview:"",contentHash:"",createdAt:1,updatedAt:1}]));
 let reads=0,writes=0;const caps:number[]=[],initialBodies=new Set<string>(),sent:string[]=[];
 const ai={canReuseProjectKnowledge:true,supportsCacheMissGuard:true,getAnalysisKey:async()=>runId,
  synthesize:async<T,>(request:StructuredAIRequest<T>)=>{
   const data=JSON.parse(request.prompt);
   request.beforeRequest?.();
   if(!data.coverage.final){reads++;return request.validate({title:"笔记",sections:data.passages.map((item:{id:string;text:string;title:string})=>({title:item.title,body:item.text,kind:"finding",transition:"",evidenceIds:[item.id]}))});}
   writes++;sent.push(request.system+request.prompt);const completing=request.system.includes("TARGETED COMPLETION"),topic=data.wikiTopics[0];
   if(completing){caps.push(request.maxOutputTokens!);expect(topic.subtopics.map((item:{title:string})=>item.title)).toEqual(["失败保护"]);}
   const unique=`${data.passages[0].id} 的有效说明：${paragraph}`;
   if(!completing)initialBodies.add(unique);
   return request.validate({title:"项目",sections:[{title:topic.title,wikiOwnerId:topic.ownerId,kind:"review",transition:"",body:topic.subtopics.slice(0,completing?undefined:1).map((item:{title:string})=>`## ${item.title}\n\n${completing?paragraph:unique}`).join("\n\n"),evidenceIds:data.passages.map((item:{id:string})=>item.id)}]});
  },
  generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt);return request.validate({scope:[], pages:[{title:"记录保留",subtopics:["保存条件","失败保护"].map(title=>({title,sectionIds:data.sections.map((item:{id:string})=>item.id)}))}]});},
 };
 const run=()=>synthesizeCoveredFocus({goal:"复习记录规则",mode:"work",locale:"zh-CN",sources,passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 await expect(run()).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_writing_recovery_limit"});
 const paid={reads,writes};
 expect(caps.length).toBeGreaterThan(1);expect(caps.reduce((a,b)=>a+b,0)).toBeLessThanOrEqual(48000);
 // Where the cap falls depends on batch sizes; the invariant is that a resumed
 // run re-reads nothing and never re-sends a request that already succeeded.
 const result=await run();expect(reads).toBe(paid.reads);expect(writes).toBeGreaterThan(paid.writes);
 expect(sent.slice(paid.writes).filter(key=>sent.slice(0,paid.writes).includes(key))).toEqual([]);
 for(const body of initialBodies)expect(result.result.sections[0].body).toContain(body);
 expect(result.result.sections[0].body).toContain("## 失败保护");
 const completed={reads,writes};const resumed=await run();expect({reads,writes}).toEqual(completed);expect(resumed.result.sections[0].body).toBe(result.result.sections[0].body);
});
