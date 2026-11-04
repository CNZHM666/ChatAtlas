import "fake-indexeddb/auto";
import {expect,it,vi} from "vitest";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {synthesizeCoveredFocus} from "./focus-coverage";
import {validateFocusResult} from "./focus-session";
import {transcriptPassages} from "../search/transcript-index";
import type {StructuredAIRequest} from "./provider";
import type {AISettings,Conversation} from "../shared/types";

it.each(["balanced","deep"] as const)("separates mixed-project paragraphs in a %s single-message Wiki, restores references and reuses neutral reading",async analysisMode=>{
 const id=crypto.randomUUID(),server="平台自带 AI 使用服务器凭据。",byok="BYOK 模式使用用户自己的密钥；两种模式并行。",foreign="ChatAtlas 是另一个项目，建议增加 ProjectEvent 和 Wiki 演进。",uncertain="另一个平台的版本路线，尚未说明归属。";
 const text=[server,byok,foreign,uncertain].join("\n\n"),source:Conversation={id,title:"AI Hardware Builder 开发讨论",platform:"chatgpt",url:"",messageCount:1,updatedAt:1};
 const passages=transcriptPassages(source,[{id:"message",conversationId:id,role:"user",messageIndex:0,content:text,preview:"",contentHash:"",createdAt:1,updatedAt:1}]);
 const project={name:"AI Hardware Builder",purpose:"面向初学者的模块级硬件创作平台。"},settings:AISettings={id:"ai-settings",provider:"openai",model:"mainline-fixture",baseUrl:"https://fixture.invalid",apiKey:"fixture",updatedAt:1};
 let reading=0,directories=0,writing=0;const boundaryInputs:unknown[]=[];
 const ai=createAtlasAIFromProvider({id,modelId:settings.model,testConnection:async()=>({ok:true,model:settings.model}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_topic_plan"){
   directories++;boundaryInputs.push(data.projectBoundary);expect(data.projectBoundary.project).toEqual(project);
   const other=data.sections.find((section:{lead:string})=>section.lead.includes(foreign));expect(other).toBeDefined();
   expect(data.sections.filter((section:{lead:string})=>section.lead.includes(server)||section.lead.includes(byok))).toHaveLength(2);
   const restored=data.includedMaterialIds.includes(other.id),ambiguous=data.sections.find((section:{lead:string})=>section.lead.includes(uncertain));expect(ambiguous).toBeDefined();
   return request.validate({pages:[{title:"AI 接入",subtopics:[{title:"接入模式",sectionIds:data.sections.filter((section:{id:string})=>restored||section.id!==other.id).map((section:{id:string})=>section.id)}]}],scope:[{id:other.id,kind:restored?"reference":"other",reason:"ChatAtlas 是独立产品；硬件平台不自动采用其功能。",quote:foreign},{id:ambiguous.id,kind:"uncertain",reason:"未说明该平台是否为本项目",quote:uncertain}]});
  }
  if(!data.coverage.final){reading++;expect(data).not.toHaveProperty("projectBoundary");return request.validate({title:"初读",sections:[{title:"讨论阶段",body:text,kind:"finding",transition:"",evidenceIds:data.passages.map((p:{id:string})=>p.id)}],projectFacts:{summary:"讨论记录",modules:[server,byok,foreign,uncertain].map((quote,index)=>({id:`module${index}`,title:index===3?"归属未定":index===2?"ChatAtlas ProjectEvent":index===1?"用户 BYOK":"平台 AI",layer:"模式",purpose:quote,inputs:[],outputs:[],status:index>=2?"proposal":"documented",quote,evidenceIds:[data.passages[0].id]})),relations:[],decisions:[],constraints:[],questions:[],history:[]}});}
  writing++;boundaryInputs.push(data.projectBoundary);expect(data.projectBoundary.project).toEqual(project);expect(request.system).toContain("PROJECT IDENTITY v3");
  const restored=data.passages.some((p:{text:string})=>p.text.includes(foreign));
  expect(data.passages.some((passage:{text:string})=>passage.text.includes(uncertain))).toBe(true);
  expect(data.passages.some((passage:{text:string})=>passage.text.includes(uncertain)&&passage.text.includes("SOURCE DETAIL INVENTORY"))).toBe(true);
  expect(data.sourceRouting).toEqual(expect.arrayContaining([expect.objectContaining({kind:"uncertain",quote:uncertain})]));
  expect(request.system).not.toContain('"title":"归属未定"');
  if(!restored){expect(JSON.stringify(data.passages)).not.toContain("ProjectEvent");expect(request.system).not.toContain("ChatAtlas ProjectEvent");expect(data.sourceRouting).toEqual(expect.arrayContaining([expect.objectContaining({kind:"other",quote:foreign})]));}
  return request.validate({title:"AI Hardware Builder",sections:data.wikiTopics.map((topic:{title:string;ownerId:string})=>({title:topic.title,wikiOwnerId:topic.ownerId,body:`平台 AI 与 BYOK 可并行。\n\n## 接入模式\n\n${server}\n\n${byok}\n\n归属未确认的讨论：${uncertain}${restored?"\n\nChatAtlas 仅作为外部参考。":""}`,kind:"finding",transition:"",evidenceIds:data.passages.map((p:{id:string})=>p.id)}))});
 }},settings);
 const previews:Array<{review:unknown;sourceIds:string[]}>=[];
 const run=(includeKeys?:string[])=>synthesizeCoveredFocus({goal:"整理全部资料并生成开发任务",scopeKind:"all",mode:"work",locale:"zh-CN",analysisMode,collectProjectKnowledge:true,wikiProjectBoundary:project,wikiScopeIncludeKeys:includeKeys,sources:[source],passages,ai,signal:new AbortController().signal,validate:validateFocusResult,onPartial:(_result,evidence,review)=>{previews.push({review,sourceIds:evidence.map(ref=>ref.id)});}});
 const fetch=vi.spyOn(globalThis,"fetch");
 try{
  const first=await run();expect(first.segmentCount).toBe(1);expect(first.sourceOutlines[0].chapters[0].summary).toContain(foreign);expect(first.result.sections).toHaveLength(1);expect(first.knowledgeBatches?.flatMap(batch=>batch.facts?.modules??[]).map(module=>module.title)).toEqual(["平台 AI","用户 BYOK"]);
  expect(first.result.sections[0].body).toContain(server);expect(first.result.sections[0].body).toContain(byok);expect(first.result.sections[0].body).not.toContain("ChatAtlas");
  expect(first.wikiScopeReview?.materials).toHaveLength(2);expect(first.wikiScopeReview?.materials[0].body).toContain(foreign);
  expect(first.result.sections[0].body).toContain("归属未确认的讨论");expect(first.result.sections[0].body).toContain(uncertain);
  expect(first.wikiScopeReview?.status).toBe("complete");
  expect(previews.length).toBeGreaterThan(0);
  for(const preview of previews){expect(preview.review).toMatchObject({status:"complete",materials:[{kind:"other",body:expect.stringContaining(foreign)},{kind:"uncertain",body:expect.stringContaining(uncertain)}]});expect(preview.sourceIds).toEqual(expect.arrayContaining(first.wikiScopeReview!.materials[0].evidenceIds));}
  const restored=await run([first.wikiScopeReview!.materials[0].key]);expect(restored.wikiScopeReview?.materials[0].kind).toBe("reference");expect(restored.result.sections[0].body).toContain("仅作为外部参考");
  expect(reading).toBe(1);expect(directories).toBe(2);expect(writing).toBe(2);expect(boundaryInputs).toHaveLength(4);expect(fetch).not.toHaveBeenCalled();expect(passages.map(p=>p.text).join("")).toBe(text);
 }finally{fetch.mockRestore();}
});
