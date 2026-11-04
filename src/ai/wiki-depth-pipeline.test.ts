import {withWikiOutline} from "../test/wiki-outline-fixture";
import {expect,it} from "vitest";
import {coalesceWikiOwners,synthesizeCoveredFocus} from "./focus-coverage";
import {projectSession} from "../test/project-fixture";
import {validateFocusResult} from "./focus-session";
import {transcriptPassages} from "../search/transcript-index";
import type {Conversation} from "../shared/types";
import type {StructuredAIRequest} from "./provider";

it("never writes or publishes a flat 47-material Wiki when planning fails",async()=>{
 const sources:Conversation[]=Array.from({length:47},(_,i)=>({id:`source${i}`,title:`讨论${i}`,platform:"chatgpt",url:"",messageCount:1,updatedAt:1}));
 const passages=sources.flatMap((source,i)=>transcriptPassages(source,[{id:`m${i}`,conversationId:source.id,role:"user",messageIndex:0,content:`功能${i}有独特的约束。`,preview:"",contentHash:"",createdAt:1,updatedAt:1}]));
 let reads=0,writes=0,plans=0,previews=0;
 const ai={canReuseProjectKnowledge:true,usesContentTokenEstimates:true,
  synthesize:async<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt);if(data.coverage.final)writes++;else reads++;return request.validate({title:"笔记",sections:data.passages.map((p:{id:string;title:string;text:string})=>({title:p.title,body:p.text,kind:"finding",transition:"",evidenceIds:[p.id]}))});},
  generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt);if(data.presentation==="wiki_title_edit")return request.validate({titles:data.titles.map((item:{id:string;title:string})=>({id:item.id,title:item.id==="d:0"?"项目知识工具":item.title,keep:item.id!=="d:0"}))});plans++;return request.validate({scope:[], pages:data.sections.map((s:{id:string;title:string})=>({title:s.title,question:s.title,group:"",sectionIds:[s.id]}))});},
 };
 await expect(synthesizeCoveredFocus({goal:"整理",mode:"work",locale:"zh-CN",sources,passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult,onPartial:()=>{previews++;}})).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_no_convergence",wikiDirectoryCounts:{mainCount:47,maxMainCount:10}});
 expect(reads).toBeGreaterThan(0);expect(plans).toBeGreaterThan(2);expect(plans).toBeLessThanOrEqual(8);expect(writes).toBe(0);expect(previews).toBe(0);
});

it("batches multiple owners together and rejects a different owner's returned identity",async()=>{
 const sources:Conversation[]=Array.from({length:4},(_,index)=>({id:`${index%2?"notifications":"search"}:${index}`,title:"同一项目",platform:"chatgpt",url:"",messageCount:1,updatedAt:1}));
 const passages=sources.flatMap(source=>transcriptPassages(source,[{id:source.id,conversationId:source.id,role:"user",messageIndex:0,content:source.id.startsWith("search")?"检索按消息定位。":"通知仅在用户开启后显示。",preview:"",contentHash:"",createdAt:1,updatedAt:1}]));
 const compositions:Array<{wikiTopics:Array<{ownerId:string;title:string}>;passages:Array<{title:string}>}>=[];let foreign=false,cached=false;
 const ai={canReuseProjectKnowledge:true,
  synthesize:async<T,>(request:StructuredAIRequest<T>)=>{
   const data=JSON.parse(request.prompt),title=data.coverage.final?data.wikiTopics[0].title:data.passages[0].conversationId.startsWith("search")?"消息检索":"通知控制";
   if(data.coverage.final)compositions.push(data);
   const topics=data.coverage.final?data.wikiTopics:[{title}];
   const value=withWikiOutline({title:"项目",sections:topics.map((topic:{title:string;ownerId?:string})=>({title:topic.title,body:"## 具体机制\n\n仅保留本主题讨论。",kind:"finding",transition:"",evidenceIds:data.passages.filter((passage:{title:string})=>!data.coverage.final||passage.title===topic.title).map((passage:{id:string})=>passage.id),...(data.coverage.final?{wikiOwnerId:foreign?"foreign":topic.ownerId}:{})}))});
   if(cached&&data.coverage.final){request.onCacheHit?.();return value as T;}
   return request.validate(value);
  },generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt);return request.validate(withWikiOutline({scope:[], pages:["消息检索","通知控制"].map(title=>({title,group:"功能",question:title,sectionIds:data.sections.filter((section:{title:string;lead?:string})=>section.title===title||(section.title.includes("Source detail")&&section.lead?.includes(title==="通知控制"?"通知":"索引"))).map((section:{id:string})=>section.id)}))}));},
 };
 const run=()=>synthesizeCoveredFocus({goal:"整理",mode:"work",locale:"zh-CN",sources,passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 const result=await run();expect(compositions).toHaveLength(1);expect(result.result.sections.map(section=>section.title)).toEqual(["消息检索","通知控制"]);
 for(const data of compositions){expect(data.wikiTopics).toHaveLength(2);expect(data.passages).toHaveLength(4);}
 foreign=true;await expect(run()).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_owner_missing_or_unknown",fieldPaths:["sections[0].wikiOwnerId"]});
 cached=true;await expect(run()).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_owner_missing_or_unknown",fieldPaths:["sections[0].wikiOwnerId"]});
});

it("48 extracted facts retain four notes and four unassigned proof groups without a material per fact",async()=>{
 const sources:Conversation[]=Array.from({length:4},(_,index)=>({id:`source${index}`,title:"长期项目",platform:"chatgpt",url:"",messageCount:1,updatedAt:1}));
 const passages=sources.flatMap((source,index)=>transcriptPassages(source,[{id:`m${index}`,conversationId:source.id,role:"assistant",messageIndex:0,content:index%2?"建议在用户开启后发送通知，关闭时不发送。":"建议按消息建立检索索引，失败时保留原始消息。",preview:"",contentHash:"",createdAt:1,updatedAt:1}]));
 let reads=0,writes=0,plans=0,catalogueEntries=0;
 const ai={canReuseProjectKnowledge:true,usesContentTokenEstimates:true,
  synthesize:async<T,>(request:StructuredAIRequest<T>)=>{
   const data=JSON.parse(request.prompt);
   if(!data.coverage.final){reads++;const passage=data.passages[0],title=Number(passage.conversationId.slice(-1))%2?"通知控制":"消息检索";return request.validate(withWikiOutline({title:"笔记",sections:[{title,body:`${title}包含具体边界条件。`,kind:"finding",transition:"",evidenceIds:[passage.id]}],projectFacts:{summary:"历史建议",modules:Array.from({length:12},(_,index)=>({id:`module${index}`,title:`${title}参数${index}`,layer:"模块",purpose:`处理条件${index}`,inputs:[`输入${index}`],outputs:[`结果${index}`],status:"proposal",quote:passage.text.replace(/^assistant: /u,""),evidenceIds:[passage.id]})),relations:[],decisions:[],constraints:[],questions:[],history:[]}}));}
   writes++;expect(data.passages).toHaveLength(8);expect(data.wikiTopics).toHaveLength(2);
   return request.validate(withWikiOutline({title:"知识",sections:data.wikiTopics.map((topic:{ownerId:string;title:string})=>({title:topic.title,wikiOwnerId:topic.ownerId,body:`## 具体机制\n\n${topic.title}仍为历史建议，边界见相关原始依据。`,kind:"finding",transition:"",evidenceIds:data.passages.filter((passage:{title:string})=>passage.title===topic.title).map((passage:{id:string})=>passage.id)}))}));
  },
  generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt);if(data.presentation==="wiki_title_edit")return request.validate({titles:data.titles.map((item:{id:string;title:string})=>({id:item.id,title:item.id==="d:0"?"项目知识工具":item.title,keep:item.id!=="d:0"}))});plans++;if(!data.editorialGrouping)catalogueEntries+=data.sections.length;return request.validate(withWikiOutline({scope:[], pages:["消息检索","通知控制"].map(title=>({title,group:"功能",question:`${title}如何工作？`,sectionIds:data.sections.filter((section:{title:string;lead?:string})=>section.title===title||(section.title.includes("Source detail")&&section.lead?.includes(title==="通知控制"?"通知":"索引"))).map((section:{id:string})=>section.id)}))}));},
 };
 const result=await synthesizeCoveredFocus({goal:"整理",mode:"work",locale:"zh-CN",sources,passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 expect({reads,writes,catalogueEntries}).toEqual({reads:4,writes:1,catalogueEntries:8});expect(plans).toBeLessThanOrEqual(5);expect(result.result.sections).toHaveLength(2);expect(result.knowledgeBatches?.flatMap(batch=>batch.facts?.modules??[])).toHaveLength(48);expect(result.topicPlanApplied).toBe(true);
 expect(result.result.sections.every(section=>!section.body.includes("AI 讨论原句"))).toBe(true);
});

it("coalesces only validated owner fragments, preserving phase conditions and personal prose",()=>{
 const base=projectSession().sections[0],sections=[{...base,id:"a",title:"消息检索",body:"共享结论。\n\n保留条件甲。",wikiOwnerId:"search",evidenceIds:["e1"]},{...base,id:"b",title:"消息检索",body:"共享结论。\n\n保留条件乙。",wikiOwnerId:"search",evidenceIds:["e2"]},{...base,id:"old",wikiOwnerId:"search",phase:"旧版",body:"旧版有不同边界。"},{...base,id:"personal",wikiOwnerId:"search",userEdited:true,body:"我的说明。"}];
 const before=structuredClone(sections),result=coalesceWikiOwners({title:"项目",sections});
 expect(result.sections).toHaveLength(2);expect(result.sections[0].body).toContain("旧版有不同边界。");expect(result.sections[0].body.match(/共享结论/gu)).toHaveLength(1);expect(result.sections[0].body).toContain("保留条件乙。");expect(result.sections[0].evidenceIds).toEqual(["e1","e2"]);expect(result.sections[1]).toEqual(sections[3]);expect(sections).toEqual(before);
});

it("reuses initial facts as writing evidence without dumping omitted originals into articles",async()=>{
 for(const subject of ["消息检索","传感器采集"]){
  const sources:Conversation[]=Array.from({length:4},(_,index)=>({id:`${subject}:${index}`,title:"多轮讨论",platform:"chatgpt",url:"",messageCount:1,updatedAt:1}));
  const originals=sources.map((source,index)=>({id:`message:${index}`,conversationId:source.id,role:"assistant" as const,messageIndex:0,content:`建议${subject}使用 adapter${index}；超时 3 秒返回错误，不覆盖已有记录。`,preview:"",contentHash:"",createdAt:1,updatedAt:1}));
  const compositions:Array<Record<string,unknown>>=[];let reads=0,plans=0;
  const ai={canReuseProjectKnowledge:true,usesContentTokenEstimates:true,
   synthesize:async<T,>(request:StructuredAIRequest<T>)=>{
    const data=JSON.parse(request.prompt);
    if(!data.coverage.final){reads++;const passage=data.passages[0];return request.validate(withWikiOutline({title:"初读",sections:[{title:subject,body:"讨论了实现方式。",kind:"finding",transition:"",evidenceIds:[passage.id]}],projectFacts:{summary:"方案讨论",modules:[{id:"module:subject",title:subject,layer:"模块",purpose:"保留实际实现步骤",inputs:["输入记录"],outputs:["返回结果"],status:"proposal",quote:passage.text.replace(/^assistant: /u,""),evidenceIds:[passage.id]}],relations:[],decisions:[],constraints:[],history:[]}}));}
    compositions.push(data);return request.validate(withWikiOutline({title:"结果",sections:[{title:"技术架构与优化方案",body:"## 具体机制\n\n该模块有助于提升效率。",kind:"finding",transition:"",evidenceIds:data.passages.map((passage:{id:string})=>passage.id)}]}));
   },generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt);if(data.presentation==="wiki_title_edit")return request.validate({titles:data.titles.map((item:{id:string;title:string})=>({id:item.id,title:item.id==="d:0"?"项目知识工具":item.title,keep:item.id!=="d:0"}))});plans++;expect(data.sections.every((section:{title:string})=>section.title===subject||section.title.includes("Source detail"))).toBe(true);return request.validate(withWikiOutline({scope:[], pages:[{title:subject,group:"技术架构",question:`${subject}如何运行？`,sectionIds:data.sections.map((section:{id:string})=>section.id)}]}));},
  };
  const result=await synthesizeCoveredFocus({goal:"整理项目",mode:"work",locale:"zh-CN",sources,passages:sources.flatMap((source,index)=>transcriptPassages(source,[originals[index]])),collectProjectKnowledge:true,ai,signal:new AbortController().signal,validate:validateFocusResult});
  expect(reads).toBe(4);expect(plans).toBe(1);expect(compositions).toHaveLength(1);expect(JSON.stringify(compositions[0])).toContain("SOURCE DETAIL INVENTORY");
  expect(result.result.sections[0].title).toBe(subject);expect(result.result.sections[0].wikiOwnerId).toBeTruthy();expect(result.knowledgeBatches).toHaveLength(4);
  for(let index=0;index<4;index++)expect(JSON.stringify(compositions[0])).toContain(`adapter${index}；超时 3 秒返回错误，不覆盖已有记录。`);
  expect((compositions[0].passages as unknown[])).toHaveLength(8);
  expect(result.result.sections[0].body).toBe("## 具体机制\n\n该模块有助于提升效率。");
  expect(result.result.sections[0].body).not.toContain("原文中的具体说明");
  expect(result.result.sections[0].body).not.toContain("用户已确认");
 }
});

it("passes explicit retired proofs to composition and refuses them as current claim evidence",async()=>{
 const sources:Conversation[]=Array.from({length:4},(_,index)=>({id:`phase${index}`,title:"方案讨论",platform:"chatgpt",url:"",messageCount:1,updatedAt:1}));
 const passages=sources.flatMap((source,index)=>transcriptPassages(source,[{id:`msg${index}`,conversationId:source.id,role:"user",messageIndex:0,content:index<2?"我决定取消A。":"我决定采用B。",preview:"",contentHash:"",createdAt:1,updatedAt:1}]));
 let invalid=false,missingOutline=false;
 const ai={canReuseProjectKnowledge:true,
  synthesize:async<T,>(request:StructuredAIRequest<T>)=>{
   const data=JSON.parse(request.prompt);
   if(!data.coverage.final){const passage=data.passages[0],old=passage.text.includes("取消A");return request.validate(withWikiOutline({title:"初读",sections:[{title:"系统方案",body:"讨论方案状态。",kind:"finding",transition:"",evidenceIds:[passage.id]}],projectFacts:{summary:"方案讨论",modules:[{id:old?"old":"current",title:old?"旧模块":"当前模块",layer:"模块",purpose:old?"A":"B",inputs:[],outputs:[],status:old?"superseded":"documented",quote:passage.text.replace(/^user: /u,""),evidenceIds:[passage.id]}],relations:[],decisions:[],constraints:[],questions:[],history:[]}}));}
   expect(data.wikiExcludedProofs).toHaveLength(2);expect(request.system).toContain("CURRENT WIKI EDITION");
   const item=data.passages.find((item:{text:string})=>item.text.includes(invalid?"旧模块":"当前模块"))??data.passages[0];
   return request.validate(withWikiOutline({title:"当前方案",sections:[{title:"系统方案",wikiOwnerId:data.wikiTopics[0].ownerId,body:missingOutline?"当前采用B。":invalid?"## 有效设计\n\n当前采用A。":"## 有效设计\n\n当前采用B。",kind:"finding",transition:"",evidenceIds:[item.id],claims:[{text:invalid?"当前采用A":"当前采用B",quote:invalid?"我决定取消A。":"我决定采用B。",evidenceIds:[item.id]}]}]}));
  },generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt);return request.validate(withWikiOutline({scope:[], pages:[{title:"系统方案",group:"系统",question:"当前用什么？",sectionIds:data.sections.map((item:{id:string})=>item.id),subtopics:[{title:"有效设计",question:"如何工作？",sectionIds:data.sections.map((item:{id:string})=>item.id)}]}]}));},
 };
 const run=()=>synthesizeCoveredFocus({goal:"整理",mode:"work",locale:"zh-CN",sources,passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 const result=await run();expect(result.result.sections[0].body).toBe("## 有效设计\n\n当前采用B。");expect(result.knowledgeBatches?.[0].facts?.modules[0].status).toBe("superseded");
 invalid=true;await expect(run()).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_retired_proof_used_as_current"});
 invalid=false;missingOutline=true;const normalized=await run();expect(normalized.result.sections[0].body).toContain("## 有效设计\n\n当前采用B。");
});
