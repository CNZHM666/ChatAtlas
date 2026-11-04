import "fake-indexeddb/auto";
import {expect,it,vi} from "vitest";
import {synthesizeCoveredFocus} from "./focus-coverage";
import {validateFocusResult} from "./focus-session";
import {autoOrganizeWiki,requireOrganizedWiki} from "./wiki-auto-organize";
import {wikiTitleEdits} from "./wiki-title-pass";
import {createAtlasAIFromProvider} from "./atlas-ai";
import type {StructuredAIRequest} from "./provider";
import {transcriptPassages} from "../search/transcript-index";
import {contextKnowledge} from "../test/context-fixture";
import {requestBudget} from "./request-policy";

// Regression tests through the actual generation and provider facade boundaries.
it("short project generation reviews scope and passes through the shared title editor before publication",async()=>{
 const {session,messages,conversations}=contextKnowledge(),source={...conversations[0],id:crypto.randomUUID()};
 const passages=transcriptPassages(source,[{...messages[0],conversationId:source.id,content:"用户确认本地保存消息，同时讨论市场上的竞品。"}]);
 const generateStructured=vi.fn(async<T>(request:StructuredAIRequest<T>):Promise<T>=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_topic_plan")return request.validate({pages:[{title:"项目定位",subtopics:[{title:"产品目标"}]}],routes:data.sections.map((section:{id:string})=>({slot:section.id,chapter:0,subtopics:[0]})),scope:[]});
  return request.validate({titles:data.titles.map((item:{id:string;title:string})=>({id:item.id,title:item.id==="d:0"?"知识整理工具":item.title}))});
 });
 const result=await synthesizeCoveredFocus({goal:"整理项目",mode:"work",locale:"zh-CN",sources:[source],passages,signal:new AbortController().signal,validate:validateFocusResult,ai:{
  generateStructured:<T>(request:StructuredAIRequest<T>)=>generateStructured(request as StructuredAIRequest<unknown>) as Promise<T>,
  synthesize:async<T>(request:StructuredAIRequest<T>)=>{const data=JSON.parse(request.prompt),topic=data.wikiTopics?.[0];return request.validate({title:"产品定位与竞品",sections:[{title:topic?.title??"产品定位与竞品",...(topic?{wikiOwnerId:topic.ownerId}:{}),body:(topic?"## 产品目标\n\n":"")+"用户确认本地保存消息，同时讨论市场上的竞品。",kind:"finding",transition:"",evidenceIds:data.passages.map((item:{id:string})=>item.id)}]});}
 }});
 const organized=requireOrganizedWiki(await autoOrganizeWiki({...session,...result.result,evidence:result.evidence}, {generateStructured:<T>(request:StructuredAIRequest<T>)=>generateStructured(request as StructuredAIRequest<unknown>) as Promise<T>},new AbortController().signal,false,"new"));
 expect(result.topicPlanApplied).toBe(true);expect(result.wikiScopeReview?.status).toBe("complete");
 expect(generateStructured.mock.calls.map(([request])=>JSON.parse(request.prompt).presentation)).toEqual(["wiki_topic_plan","wiki_title_edit","wiki_title_edit"]);
 expect(organized.title).toBe("知识整理工具");expect(organized.sections[0].title).toBe("项目定位");expect(organized.wikiOrganization?.status).toBe("protected");
});

it("rejects unusable title cache entries and reuses the next valid proposal",async()=>{
 const fixture=crypto.randomUUID();
 let attempts=0;
 const generateStructured=vi.fn(async<T>(request:StructuredAIRequest<T>)=>request.validate({titles:[{id:"c:0",title:++attempts===1?"产品定位与竞品":"项目定位"}]}));
 const provider={id:`title-audit-${fixture}`,modelId:"fixture",testConnection:vi.fn(),generateStructured:<T>(request:StructuredAIRequest<T>)=>generateStructured(request as StructuredAIRequest<unknown>) as Promise<T>};
 const settings={id:"ai-settings" as const,provider:"deepseek" as const,baseUrl:"https://api.deepseek.com/v1",apiKey:"test",model:"fixture",updatedAt:1};
 const plan=[{title:"产品定位与竞品",group:"产品",question:fixture,sectionIds:["s"]}];
 const first=createAtlasAIFromProvider(provider,settings,undefined,"title-run-a"),second=createAtlasAIFromProvider(provider,settings,undefined,"title-run-b");
 // The still-paired answer is refused and never cached; the same run's second
 // attempt, told why, returns a usable name.
 expect((await wikiTitleEdits(plan,"zh-CN",first,new AbortController().signal))?.chapters.get(0)).toBe("项目定位");
 expect(generateStructured).toHaveBeenCalledTimes(2);
 expect(JSON.parse(generateStructured.mock.calls[1][0].prompt).titles[0].rejectedAnswer).toEqual({title:"产品定位与竞品",problem:expect.stringContaining("returned the original")});
 expect((await wikiTitleEdits(plan,"zh-CN",second,new AbortController().signal))?.chapters.get(0)).toBe("项目定位");
 expect((await wikiTitleEdits(plan,"zh-CN",second,new AbortController().signal))?.chapters.get(0)).toBe("项目定位");
 expect(generateStructured).toHaveBeenCalledTimes(3);
});

it("the real facade preserves the ten-title editorial allowance",async()=>{
 const fixture=crypto.randomUUID();let requested=0,delivered=0,policyLimit=0;
 const provider={id:`title-budget-${fixture}`,modelId:"fixture",testConnection:vi.fn(),generateStructured:async<T>(request:StructuredAIRequest<T>)=>{
  delivered=request.maxOutputTokens!;const data=JSON.parse(request.prompt);
  return request.validate({titles:data.titles.map((item:{id:string},index:number)=>({id:item.id,title:`主题${index}`}))});
 }};
 const settings={id:"ai-settings" as const,provider:"deepseek" as const,baseUrl:"https://api.deepseek.com/v1",apiKey:"test",model:"fixture",updatedAt:1};
 const ai=createAtlasAIFromProvider(provider,settings),plan=Array.from({length:10},(_,index)=>({title:`材料${index}与方案`,group:"产品",question:fixture,sectionIds:[`s${index}`]}));
 await wikiTitleEdits(plan,"zh-CN",{generateStructured:<T>(request:StructuredAIRequest<T>)=>{requested=request.maxOutputTokens!;policyLimit=requestBudget(request,"fixture",settings.baseUrl).maxOutputTokens;return ai.generateStructured(request);}},new AbortController().signal);
 expect(requested).toBe(900);expect(delivered).toBe(policyLimit);expect(delivered).toBe(900);
});

it("challenges a kept paired title once, then accepts a second keep with its reason",async()=>{
 const plan=[{title:"定价与推广",group:"产品",question:crypto.randomUUID(),sectionIds:["s"]}];
 const keep={id:"c:0",title:"定价与推广",keep:true,keepReason:"两者共同决定上线收入"};
 const prompts:string[]=[];
 const answers=(second:unknown)=>({generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{prompts.push(request.system);return request.validate({titles:[prompts.length===1?keep:second]});}});
 expect((await wikiTitleEdits(plan,"zh-CN",answers({id:"c:0",title:"商业化策略"}),new AbortController().signal))?.chapters.get(0)).toBe("商业化策略");
 expect(prompts[1]).toContain("SECOND ATTEMPT");
 prompts.length=0;
 // Kept again on the second attempt: the planned title stands, with no further request.
 expect(await wikiTitleEdits(plan,"zh-CN",answers(keep),new AbortController().signal)).toBeUndefined();
 expect(prompts).toHaveLength(2);
});

it("accepts a justified paired subtopic after the bounded challenge, preserving independent responsibilities",async()=>{
 const plan=[{title:"系统架构",group:"产品",question:crypto.randomUUID(),sectionIds:["s"],subtopics:[{title:"技术栈与数据流",question:"用什么技术，数据怎么走？",sectionIds:["s"]}]}];
 const keep={id:"s:0:0",title:"技术栈与数据流",keep:true,keepReason:"技术选择决定了数据流"};
 let calls=0;
 const answers=(second:unknown)=>({generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls++;return request.validate({titles:[calls===1?keep:second]});}});
 // Kept again with a reason: editorial review succeeds, without a destructive rename.
 let report:import("../shared/focus-session").WikiTitleReview|undefined;
 expect(await wikiTitleEdits(plan,"zh-CN",answers(keep),new AbortController().signal,{onReport:value=>{report=value;}})).toBeUndefined();
 expect(calls).toBe(2);expect(report).toMatchObject({status:"ready",accepted:1,rejected:[]});
 calls=0;
 expect((await wikiTitleEdits(plan,"zh-CN",answers({id:"s:0:0",title:"数据流设计"}),new AbortController().signal))?.subtopics.get("0:0")).toBe("数据流设计");
});
