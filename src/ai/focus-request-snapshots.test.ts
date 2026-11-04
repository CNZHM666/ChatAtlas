import "fake-indexeddb/auto";
import {expect,it} from "vitest";
import {synthesizeCoveredFocus} from "./focus-coverage";
import {validateFocusResult} from "./focus-session";
import {transcriptPassages} from "../search/transcript-index";
import type {Conversation} from "../shared/types";
import type {StructuredAIRequest} from "./provider";

it.each(["direct","full","cross-ai"])("records current request identities: %s",async scenario=>{
 const sources:Conversation[]=Array.from({length:scenario==="direct"?1:2},(_,index)=>({id:`snapshot-${index}`,title:`保存条件 ${index}`,platform:scenario==="cross-ai"&&index?"claude":"chatgpt",url:"",updatedAt:1,sourceCreatedAt:1,messageCount:1}));
 const passages=sources.flatMap(source=>transcriptPassages(source,[{id:`${source.id}-m`,conversationId:source.id,messageIndex:0,role:"user",content:"用户确认后才保存。失败保留原文。",contentHash:"",preview:"",createdAt:1,updatedAt:1}]));
 const requests:Array<{stage:string;system:string;prompt:string}>=[];
 const capture=<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt);requests.push({stage:data.presentation==="wiki_topic_plan"?"directory":data.presentation==="wiki_title_edit"?"titles":data.coverage.final?"writing":"reading",system:request.system,prompt:request.prompt});return data;};
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const data=capture(request);if(data.presentation==="wiki_title_edit")return request.validate({titles:data.titles.map((item:{id:string;title:string})=>({id:item.id,title:item.id==="d:0"?"保存知识工具":item.title,keep:item.id!=="d:0"}))});return request.validate({scope:[], pages:[{title:"保存条件",subtopics:[{title:"授权与失败",sectionIds:data.sections.map((item:{id:string})=>item.id)}]}]});},synthesize:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=capture(request),topic=data.wikiTopics?.[0];
  return request.validate({title:"保存条件",sections:[{title:"保存条件",body:topic?"## 授权与失败\n\n用户确认后才保存。失败保留原文。":"用户确认后才保存。失败保留原文。",kind:"finding",transition:"",evidenceIds:data.passages.map((item:{id:string})=>item.id),...(topic?{wikiOwnerId:topic.ownerId}:{})}]});
 }};
 await synthesizeCoveredFocus({goal:"复习保存条件",mode:"work",locale:"zh-CN",sources,passages,ai,signal:new AbortController().signal,validate:validateFocusResult});
 // Store complete strings so a changed hash never hides which bytes changed.
 expect(requests).toMatchSnapshot();
});
