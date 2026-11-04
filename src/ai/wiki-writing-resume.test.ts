import "fake-indexeddb/auto";
import {expect,it,vi} from "vitest";
import {synthesizeCoveredFocus} from "./focus-coverage";
import {validateFocusResult} from "./focus-session";
import {transcriptPassages} from "../search/transcript-index";
import type {StructuredAIRequest} from "./provider";
import type {Conversation} from "../shared/types";
// One-sentence fixtures exercise resume mechanics; the length-based subtopic merge has its own tests.
vi.mock("./wiki-subtopic-budget",async original=>({...await original<typeof import("./wiki-subtopic-budget")>(),mergeThinWikiChapters:(sections:unknown[])=>({sections,merged:0,toName:[]})}));

it("recovers only a failed multi-topic write, then reuses the exact successful partitions on retry",async()=>{
 const sources:Conversation[]=Array.from({length:4},(_,i)=>({id:`writing-resume-${i}`,title:`机制${i}`,platform:"chatgpt",url:"",updatedAt:1,messageCount:1}));
 const passages=sources.flatMap((source,i)=>transcriptPassages(source,[{id:`message${i}`,conversationId:source.id,role:"user",messageIndex:0,content:`机制${i}失败时保留记录，不能覆盖已有材料。`,contentHash:"",preview:"",createdAt:1,updatedAt:1}]));
 const cache=new Map<string,unknown>();let paidReads=0,paidWrites=0,cacheHits=0;
 const ai={canReuseProjectKnowledge:true,getAnalysisKey:async()=>"writing-resume",hasCachedSynthesis:async<T,>(request:StructuredAIRequest<T>)=>cache.has(request.prompt),
  synthesize:async<T,>(request:StructuredAIRequest<T>)=>{
   if(cache.has(request.prompt)){cacheHits++;request.onCacheHit?.();return request.validate(structuredClone(cache.get(request.prompt)));}
   const data=JSON.parse(request.prompt);
   if(data.coverage.final)paidWrites++;else paidReads++;
   const value=data.coverage.final?{title:"项目",sections:data.wikiTopics.map((topic:{ownerId:string;title:string;subtopics:Array<{title:string;evidenceIds:string[]}>})=>({title:topic.title,wikiOwnerId:topic.ownerId,body:topic.subtopics.slice(0,topic.subtopics.length>2?1:undefined).map(sub=>`## ${sub.title}\n\n失败时保留记录，不覆盖已有材料。`).join("\n\n"),kind:"finding",transition:"",evidenceIds:data.passages.filter((item:{wikiOwnerId:string})=>item.wikiOwnerId===topic.ownerId).map((item:{id:string})=>item.id)}))}:{title:"笔记",sections:[{title:data.passages[0].title,body:data.passages[0].text,kind:"finding",transition:"",evidenceIds:data.passages.map((item:{id:string})=>item.id)}]};
   const result=request.validate(value);cache.set(request.prompt,structuredClone(result));return result;
  },generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt);return request.validate({scope:[], pages:[{title:"系统机制",question:"失败如何处理？",sectionIds:data.sections.map((item:{id:string})=>item.id),subtopics:data.sections.map((item:{id:string;title:string})=>({title:item.title,question:"失败边界？",sectionIds:[item.id]}))}]});},
 };
 const run=()=>synthesizeCoveredFocus({goal:"整理项目",mode:"work",locale:"zh-CN",sources,passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 const first=await run();expect(first.result.sections).toHaveLength(1);expect(first.result.sections[0].body.match(/^## /gmu)).toHaveLength(4);expect(paidReads).toBe(4);expect(paidWrites).toBe(3);
 const second=await run();expect(second.result.sections[0].body).toBe(first.result.sections[0].body);expect({paidReads,paidWrites}).toEqual({paidReads:4,paidWrites:3});expect(cacheHits).toBe(0); // Task checkpoints skip the reading/cache replay entirely.
});
