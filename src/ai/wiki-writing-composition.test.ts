import "fake-indexeddb/auto";
import {expect,it,vi,afterEach} from "vitest";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {synthesizeCoveredFocus,joinedResults,coalesceWikiOwners} from "./focus-coverage";
import {validateFocusResult} from "./focus-session";
import {transcriptPassages} from "../search/transcript-index";
import {getDatabase} from "../storage/db";
import {AIProviderResponseError,AIProviderValidationError} from "./provider-errors";
import type {Conversation} from "../shared/types";
import type {StructuredAIRequest} from "./provider";

afterEach(()=>vi.restoreAllMocks());

it.each(["claims","long-prose","partial-resume","subtopic-sections"])("retains every validated writing fragment beyond a single response's %s limit and resumes without new requests",async scenario=>{
 const id=crypto.randomUUID(),source:Conversation={id,title:"保存规则",platform:"chatgpt",url:"",updatedAt:1,messageCount:1};
 const original="只有确认后才保存，失败时保留原文。";
 const passages=transcriptPassages(source,[{id,conversationId:id,messageIndex:0,role:"user",content:original,contentHash:"",preview:"",createdAt:1,updatedAt:1}]);
 let reads=0,plans=0,initial=0,supplements=0;
 const raw={id,modelId:"fixture",testConnection:async()=>({ok:true as const,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_topic_plan"){plans++;return request.validate({scope:[], pages:[{title:"保存规则",subtopics:(scenario==="partial-resume"?["授权","失败保护","访问条件"]:["授权","失败保护"]).map(title=>({title,sectionIds:data.sections.map((item:{id:string})=>item.id)}))}]});}
  if(!data.coverage.final){reads++;return request.validate({title:"笔记",sections:[{title:"保存规则",body:original,kind:"finding",transition:"",evidenceIds:data.passages.map((item:{id:string})=>item.id)}]});}
  const completing=request.system.includes("TARGETED COMPLETION");if(completing)supplements++;else initial++;
  if(scenario==="partial-resume"&&supplements===2)throw new AIProviderResponseError("PROVIDER_TIMEOUT");
  const topic=data.wikiTopics[0],prefix=completing?`补充条件-${topic.subtopics[0].title}`:"保存前提",evidenceIds=data.passages.map((item:{id:string})=>item.id);
  if(scenario==="subtopic-sections")return request.validate({title:"保存规则",sections:topic.subtopics.map((child:{title:string},index:number)=>({title:child.title,wikiOwnerId:topic.ownerId,kind:"finding",transition:"",body:`${index?"补充条件":"保存前提"}：${original}`,evidenceIds,claims:Array.from({length:8},(_,n)=>({text:`${child.title}${n}：${original}`,quote:original,evidenceIds}))}))});
  const claims=Array.from({length:scenario==="long-prose"?1:8},(_,index)=>({text:`${prefix}${index}：${original}`,quote:original,evidenceIds}));
  const prose=scenario==="long-prose"?`${prefix}：`+original.repeat(390):claims.map(claim=>claim.text).join("\n\n");
  return request.validate({title:"保存规则",sections:[{title:topic.title,wikiOwnerId:topic.ownerId,kind:"finding",transition:"",body:`## ${topic.subtopics[0].title}\n\n${prose}`,evidenceIds,claims}]});
 }};
 const ai=createAtlasAIFromProvider(raw,{id:"ai-settings",provider:"openai",model:"fixture",baseUrl:"https://fixture.invalid",apiKey:"fixture",updatedAt:1});
 const run=()=>synthesizeCoveredFocus({goal:"复习保存条件",mode:"work",locale:"zh-CN",sources:[source],passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 if(scenario==="partial-resume")await expect(run()).rejects.toMatchObject({code:"PROVIDER_TIMEOUT"});
 const result=await run(),page=result.result.sections[0],expectedSupplements=scenario==="partial-resume"?3:scenario==="subtopic-sections"?0:1;
 expect({reads,plans,initial,supplements}).toEqual({reads:1,plans:1,initial:1,supplements:expectedSupplements});
 expect(page.claims).toHaveLength(scenario==="partial-resume"?24:scenario==="long-prose"?2:16);expect(page.body).toContain("保存前提");expect(page.body).toContain("补充条件");
 if(scenario==="long-prose")expect(page.body.length).toBeGreaterThan(12000);
 // Evict model responses: the completed durable writing ledger is sufficient.
 const db=await getDatabase();for(const row of await db.getAll("semanticDecisionCache"))if(!row.providerId.startsWith("focus-"))await db.delete("semanticDecisionCache",row.id);
 const resumed=await run();expect(resumed.result.sections[0].body).toBe(page.body);
 expect(resumed.result.sections[0].claims).toEqual(page.claims);
 expect({reads,plans,initial,supplements}).toEqual({reads:1,plans:1,initial:1,supplements:expectedSupplements});
});

it.each(["too-many-claims","foreign-source","too-long-body"])("rejects an invalid individual provider response unless it is locally repairable: %s",async scenario=>{
 const id=crypto.randomUUID(),source:Conversation={id,title:"保存规则",platform:"chatgpt",url:"",updatedAt:1,messageCount:1},original="用户确认后才保存。";
 const passages=transcriptPassages(source,[{id,conversationId:id,messageIndex:0,role:"user",content:original,contentHash:"",preview:"",createdAt:1,updatedAt:1}]);
 let writes=0;
 const ai={canReuseProjectKnowledge:true,getAnalysisKey:async()=>id,generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt);return request.validate({scope:[], pages:[{title:"保存规则",subtopics:[{title:"授权",sectionIds:data.sections.map((item:{id:string})=>item.id)}]}]});},
  synthesize:async<T,>(request:StructuredAIRequest<T>)=>{
   const data=JSON.parse(request.prompt),evidenceIds=data.passages.map((item:{id:string})=>item.id);
   if(data.coverage.final){writes++;if(writes>1)expect(request.system).toContain("TARGETED FORMAT CORRECTION");}
   return request.validate({title:"保存规则",sections:[{title:"保存规则",...(data.coverage.final?{wikiOwnerId:data.wikiTopics[0].ownerId,claims:Array.from({length:scenario==="too-many-claims"?13:1},(_,index)=>({text:`条件${index}`,quote:original,evidenceIds:scenario==="foreign-source"?["foreign"]:evidenceIds}))}:{}),body:data.coverage.final&&scenario==="too-long-body"?original.repeat(1800):original,kind:"finding",transition:"",evidenceIds}]});
  }};
 const run=synthesizeCoveredFocus({goal:"复习保存条件",mode:"work",locale:"zh-CN",sources:[source],passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 // Claims are metadata of retained prose: an overlong list is trimmed locally, without another paid write.
 if(scenario==="too-many-claims"){const result=await run;expect(result.result.sections[0].claims).toHaveLength(12);expect(writes).toBe(1);return;}
 await expect(run).rejects.toMatchObject({code:scenario==="too-long-body"?"PROVIDER_SCHEMA_invalid_focus_output":"PROVIDER_SCHEMA_unknown_evidence_id"});
 expect(writes).toBeLessThanOrEqual(2);
});

it("retains separate fact metadata when identical prose has different versioned evidence",()=>{
 const page={id:"one",wikiOwnerId:"owner",title:"保存规则",body:"## 授权\n\n先确认再保存。",kind:"finding" as const,transition:"",evidenceIds:["e1"]};
 const first={...page,claims:[{text:"先确认再保存。",quote:"V1 先确认再保存。",scope:"V1",evidenceIds:["e1"]}]};
 const second={...page,id:"two",claims:[{text:"先确认再保存。",quote:"V2 先确认再保存。",scope:"V2",evidenceIds:["e1"]}]};
 const result=coalesceWikiOwners(joinedResults([{title:"项目",sections:[first]},{title:"项目",sections:[second]}],"zh-CN"));
 expect(result.sections[0].claims?.map(claim=>claim.scope)).toEqual(["V1","V2"]);
 expect(result.sections[0].body.match(/先确认再保存。/gu)).toHaveLength(1);
});

it("reports one originating batch when another writing worker drains after the same failure",async()=>{
 const id=crypto.randomUUID(),paragraph="只有用户明确确认后才能保存资料；失败保留原始消息，不覆盖已有草稿。";
 const sources:Conversation[]=Array.from({length:6},(_,i)=>({id:`${id}:${i}`,title:i<3?"保存授权":"访问限制",platform:"chatgpt",url:"",updatedAt:1,messageCount:1}));
 const passages=sources.flatMap(source=>transcriptPassages(source,[{id:source.id,conversationId:source.id,messageIndex:0,role:"user",content:paragraph.repeat(200),contentHash:"",preview:"",createdAt:1,updatedAt:1}]));
 let secondStarted!:()=>void;const second=new Promise<void>(resolve=>{secondStarted=resolve;});
 let firstOwner:string|undefined;
 const failure=new AIProviderValidationError("wiki_owner_missing_or_unknown"),succeeded:string[]=[];
 const ai={canReuseProjectKnowledge:true,capabilities:{maxConcurrency:2},getAnalysisKey:async()=>id,
  generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt);return request.validate({scope:[], pages:["保存授权","访问限制"].map(title=>({title,subtopics:[{title:"必要条件",sectionIds:data.sections.filter((item:{title:string})=>item.title===title).map((item:{id:string})=>item.id)}]}))});},
  synthesize:async<T,>(request:StructuredAIRequest<T>)=>{
   const data=JSON.parse(request.prompt);
   if(!data.coverage.final)return request.validate({title:"笔记",sections:data.passages.map((item:{id:string;title:string;text:string})=>({title:item.title,body:item.text,kind:"finding",transition:"",evidenceIds:[item.id]}))});
   expect(data.wikiTopics).toHaveLength(1);const topic=data.wikiTopics[0];firstOwner??=topic.ownerId;
   if(topic.ownerId===firstOwner){await second;throw failure;}
   secondStarted();await new Promise(resolve=>setTimeout(resolve,0));succeeded.push(topic.ownerId);
   return request.validate({title:"项目",sections:[{title:topic.title,wikiOwnerId:topic.ownerId,body:"## 必要条件\n\n"+paragraph,kind:"finding",transition:"",evidenceIds:data.passages.map((item:{id:string})=>item.id)}]});
  }};
 const run=synthesizeCoveredFocus({goal:"复习保存条件",mode:"work",locale:"zh-CN",sources,passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 await expect(run).rejects.toBe(failure);
 expect(succeeded.length).toBeGreaterThan(0);expect(failure.message.match(/Wiki 正文批次/gu)).toHaveLength(1);
},10000);
