import "fake-indexeddb/auto";
import {expect,it} from "vitest";
import {orderBySubject,wikiSubjectGroups} from "./wiki-subject-similarity";
import {contextKnowledge} from "../test/context-fixture";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {planWikiTopics} from "./wiki-topic-plan";
import type {StructuredAIRequest} from "./provider";

// Calibration pairs from a real 14-chapter export.
const chapter=(title:string,question:string,subtopics:string[])=>({title,wikiQuestion:question,wikiSubtopics:subtopics.map(title=>({title}))});
const positioning=chapter("产品定位与竞品","ChatAtlas 解决什么问题、面向谁，与竞品和原生工具有何差异，如何验证需求并推进？",["项目重建与对话管家定位","竞品格局与差异化"]);
const validation=chapter("产品定位与验证","ChatAtlas 面向谁、解决什么问题，MVP 范围、竞品与用户验证结论如何？",["定位与目标用户","竞品与用户验证"]);
const release=chapter("技术实现与发布","采用什么技术栈与架构模式，第一版如何发布？",["技术栈","发布渠道"]);
const brand=chapter("品牌命名与营销素材","与项目主体无关或仅作参考的材料。",["命名候选","上架材料"]);

it("groups subjects that later proved to be one chapter, and leaves distinct ones apart",()=>{
 expect(wikiSubjectGroups([positioning,release,validation,brand])).toEqual([[0,2]]);
 expect(wikiSubjectGroups([release,brand])).toEqual([]);
});

it("keeps likely-same subjects adjacent in a stable order",()=>{
 expect(orderBySubject([positioning,release,validation,brand]).map(item=>item.title)).toEqual(["产品定位与竞品","产品定位与验证","技术实现与发布","品牌命名与营销素材"]);
 expect(orderBySubject([release,brand]).map(item=>item.title)).toEqual(["技术实现与发布","品牌命名与营销素材"]);
});

it("gives each convergence request local likely-same-subject groups as data",async()=>{
 const input=Array.from({length:151},(_,i)=>({...contextKnowledge().session.sections[0],id:`original-${i}`,title:`范围${i}`,kind:"finding" as const,body:`机制和条件 ${i}`}));
 const hints:string[][][]=[];
 const plan=(request:Pick<StructuredAIRequest<unknown>,"prompt">,count:number)=>{
  const data=JSON.parse(request.prompt),size=Math.min(count,data.sections.length);
  return {pages:Array.from({length:size},(_,i)=>({title:`主体${i}`,question:`主体${i}的职责是什么？`,group:"",subtopics:[{key:`t${i}`,title:`机制${i}`,question:`机制${i}的边界是什么？`}]})),assignments:Object.fromEntries(data.sections.map((item:{id:string},i:number)=>[item.id,`t${i%size}`]))};
 };
 const provider={id:"subject-hints",modelId:"fixture",testConnection:async()=>({ok:true as const,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.convergence){hints.push(data.likelySameSubject??[]);expect(request.system).toContain("likelySameSubject");}
  return request.validate(plan(request,6));
 }};
 const ai=createAtlasAIFromProvider(provider,{id:"ai-settings",provider:"openai",model:"fixture",baseUrl:"https://subject-hints.invalid",apiKey:"fixture",updatedAt:1});
 await planWikiTopics(input,"zh-CN",ai,new AbortController().signal);
 expect(hints.length).toBeGreaterThan(0);
 // Same-named candidates from different reading windows arrive as one hinted group.
 const groups=hints[0];expect(groups.length).toBeGreaterThan(0);
 for(const group of groups){expect(group.length).toBeGreaterThan(1);expect(group.length).toBeLessThanOrEqual(6);for(const id of group)expect(id).toMatch(/^m\d+$/u);}
},20000);

it("does not treat shared question templates as the same subject",()=>{
 expect(wikiSubjectGroups([chapter("首页","首页如何设计？",["欢迎页","导入入口"]),chapter("侧边栏","侧边栏如何设计？",["分屏","快速复用"])])).toEqual([]);
});
