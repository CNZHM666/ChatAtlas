import "fake-indexeddb/auto";
import {expect,it} from "vitest";
import {synthesizeCoveredFocus} from "./focus-coverage";
import {validateFocusResult} from "./focus-session";
import {transcriptPassages} from "../search/transcript-index";
import type {StructuredAIRequest} from "./provider";
import type {Conversation} from "../shared/types";

it("shares bounded prior prose across long chapter chunks and resumes the exact successful requests",async()=>{
 const runId=crypto.randomUUID(),paragraph="只有用户确认本次保存后才能更新记录；失败时保留原始消息，不能覆盖已有草稿，用户报告完成不等于代码验证。";
 const sources:Conversation[]=Array.from({length:6},(_,i)=>({id:`${runId}:${i}`,title:"记录保留",platform:"chatgpt",url:"",updatedAt:1,messageCount:1}));
 // Keep the fixture clear of an exact batch-packing boundary: a full request
 // legitimately drops optional prior-prose context, which this test is not about.
 const passages=sources.flatMap(source=>transcriptPassages(source,[{id:source.id,conversationId:source.id,role:"user",messageIndex:0,content:paragraph.repeat(78),preview:"",contentHash:"",createdAt:1,updatedAt:1}]));
 let writes=0,withContext=0,active=0,maximum=0;
 const ai={canReuseProjectKnowledge:true,capabilities:{maxConcurrency:3},getAnalysisKey:async()=>runId,
  synthesize:async<T,>(request:StructuredAIRequest<T>)=>{
   const data=JSON.parse(request.prompt);
   if(!data.coverage.final)return request.validate({title:"笔记",sections:data.passages.map((item:{id:string;text:string;title:string})=>({title:item.title,body:item.text,kind:"finding",transition:"",evidenceIds:[item.id]}))});
   writes++;active++;maximum=Math.max(maximum,active);
   await new Promise(resolve=>setTimeout(resolve,0));
   const topic=data.wikiTopics[0];
   expect(data.wikiTopics).toHaveLength(1);
   if(writes>1){
    expect(topic.opening).toBe(false);
    expect(topic.existingExplanations.some((item:{text:string})=>item.text===paragraph),JSON.stringify(topic.existingExplanations)).toBe(true);
    expect(topic.existingExplanations.reduce((sum:number,item:{text:string})=>sum+item.text.length,0)).toBeLessThanOrEqual(1800);
    withContext++;
   }
   const result=request.validate({title:"项目",sections:[{title:topic.title,wikiOwnerId:topic.ownerId,kind:"review",transition:"",...(topic.opening?{chapterOverview:"本章说明记录更新的确认条件，以及失败时保护原文和草稿的边界。"}:{}),body:`## 记录保留\n\n${paragraph}`,evidenceIds:data.passages.map((item:{id:string})=>item.id)}]});
   active--;return result;
  },
  generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt);return request.validate({scope:[], pages:[{title:"记录保留",subtopics:[{title:"记录保留",sectionIds:data.sections.map((item:{id:string})=>item.id)}]}]});},
 };
 const run=()=>synthesizeCoveredFocus({goal:"复习记录规则",mode:"work",locale:"zh-CN",sources,passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 const first=await run(),paid=writes;
 expect(writes).toBeGreaterThan(1);expect(withContext).toBe(writes-1);expect(maximum).toBe(1);
 expect(first.result.sections[0].body.split(paragraph)).toHaveLength(2);
 expect(first.result.sections[0].body).toMatch(/^本章说明[\s\S]*\n\n## 记录保留/u);
 const resumed=await run();expect(writes).toBe(paid);expect(resumed.result.sections[0].body).toBe(first.result.sections[0].body);
});
