import "fake-indexeddb/auto";
import {beforeEach,expect,it,vi} from "vitest";
import {getDatabase} from "../storage/db";
import {repairWikiDirectoryNames} from "./wiki-directory-names";
import {createWikiPlanningCheckpoints} from "./wiki-planning-checkpoint";
import {planWikiTopics,type WikiPlanReceipt} from "./wiki-topic-plan";
import {assertWikiOutline} from "./wiki-outline-policy";
import {validateWikiPlan} from "./wiki-plan-contract";
import {createAtlasAIFromProvider} from "./atlas-ai";
import type {DirectoryPage} from "./wiki-directory";
import type {FocusSection} from "../shared/focus-session";
import type {StructuredAIRequest} from "./provider";

const signal=()=>new AbortController().signal;
const pages=():DirectoryPage[]=>[
 {title:"运行机制",question:"离线模式如何运行？",group:"技术",sectionIds:["a"],subtopics:[{title:"本地保存",question:"失败时保留原文",sectionIds:["a"]}]},
 {title:"运行机制",question:"联网模式如何运行？",group:"技术",sectionIds:["b"],subtopics:[{title:"联网查询",question:"用户确认后发送",sectionIds:["b"]}]},
 {title:"导出",question:"如何导出？",group:"使用",sectionIds:["c"],subtopics:[{title:"导出文件",question:"保存格式",sectionIds:["c"]}]},
];
beforeEach(async()=>{await(await getDatabase()).clear("semanticDecisionCache");});

it("repairs only duplicate chapter names, preserving all source scopes and reserved sibling names",async()=>{
 const input=pages(),before=structuredClone(input),generateStructured=async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);expect(data.reserved).toEqual(["导出"]);expect(data.titles.map((item:{id:string})=>item.id)).toEqual(["p0","p1"]);
  expect(data.titles.map((item:{question:string})=>item.question)).toEqual(input.slice(0,2).map(page=>page.question));
  return request.validate({titles:[{id:"p0",title:"离线运行"},{id:"p1",title:"联网运行"}]});
 };
 const result=await repairWikiDirectoryNames(input,"zh-CN",{generateStructured},signal());
 expect(result.map(page=>page.title)).toEqual(["离线运行","联网运行","导出"]);
 expect(result.map((page,index)=>({...page,title:input[index].title}))).toEqual(input);expect(input).toEqual(before);
 expect(()=>assertWikiOutline(result)).not.toThrow();expect(()=>assertWikiOutline(input)).toThrow();
});

it.each([
 {titles:[{id:"p0",title:"离线运行"}]},
 {titles:[{id:"p0",title:"离线运行"},{id:"p0",title:"联网运行"}]},
 {titles:[{id:"p0",title:"离线运行"},{id:"invented",title:"联网运行"}]},
 {titles:[{id:"p0",title:" 导出 "},{id:"p1",title:"联网运行"}]},
 {titles:[{id:"p0",title:" 运行机制 "},{id:"p1",title:"运行 机制"}]},
 {titles:[{id:"p0",title:"字".repeat(33)},{id:"p1",title:"联网运行"}]},
])("rejects incomplete, colliding or fabricated name repairs before publication",async value=>{
 const input=pages(),before=structuredClone(input);
 await expect(repairWikiDirectoryNames(input,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>request.validate(value)},signal())).rejects.toThrow();
 expect(input).toEqual(before);
});

it("does not request names for a valid directory and propagates cancellation without caching a candidate",async()=>{
 const generateStructured=vi.fn(),valid=pages().map((page,i)=>({...page,title:`主题${i}`}));
 expect(await repairWikiDirectoryNames(valid,"zh-CN",{generateStructured},signal())).toBe(valid);expect(generateStructured).not.toHaveBeenCalled();
 const controller=new AbortController();
 await expect(repairWikiDirectoryNames(pages(),"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{controller.abort();return request.validate({titles:[{id:"p0",title:"离线运行"},{id:"p1",title:"联网运行"}]});}},controller.signal)).rejects.toThrow();
});

it("fixes joined-window name collisions before publishing, without a second ownership plan",async()=>{
 const input:FocusSection[]=Array.from({length:75},(_,i)=>({id:`m${i}`,title:`范围${i}`,body:`独特条件${i}`,kind:"finding",transition:"",evidenceIds:[`e${i}`]}));
 let local=0,global=0,names=0;let receipt:WikiPlanReceipt|undefined;
 const result=await planWikiTopics(input,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_directory_names"){
   names++;return request.validate({titles:data.titles.map((item:{id:string},i:number)=>({id:item.id,title:`运行范围${i}`}))});
  }
  if(data.editorialGrouping){
   global++;return request.validate({pages:[0,1].map(i=>({title:"运行机制",question:`运行模式${i}`,group:"技术",subtopics:[{title:"运行条件",sectionIds:data.sections.filter((_:unknown,j:number)=>j%2===i).map((item:{id:string})=>item.id)}]}))});
  }else local++;
  return request.validate({pages:[{title:"运行机制",question:`范围${data.sections[0].question??data.sections[0].title}`,group:"技术",subtopics:[{title:"运行条件",sectionIds:data.sections.map((item:{id:string})=>item.id)}]}]});
 }},signal(),value=>{receipt=value;});
 expect(local).toBeGreaterThan(1);expect(global).toBe(1);expect(names).toBe(1);
 expect(new Set(result.map(page=>page.title)).size).toBe(result.length);expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(section=>section.id).sort());
 expect(receipt).toMatchObject({reconciled:true,nameRepairCount:1});
});

it("resumes the retained 213-material, 10-chapter candidate at name repair after failure, keeping every material within the subtopic limit",async()=>{
 const namespace=crypto.randomUUID(),input:FocusSection[]=Array.from({length:213},(_,i)=>({id:`material${i}`,title:`片段${i}`,body:`独有条件${i}`,kind:"finding",transition:"",evidenceIds:[`proof${i}`]}));
 const candidate:DirectoryPage[]=Array.from({length:10},(_,i)=>{
  const ids=input.filter((_,j)=>j%10===i).map(item=>item.id),children=i<1?7:6;
  return {title:i===9?"主题0":`主题${i}`,question:`模块${i}的适用范围`,group:"技术",sectionIds:ids,subtopics:Array.from({length:children},(_,j)=>({title:`条件${j}`,question:`模块${i}条件${j}`,sectionIds:ids.filter((_,k)=>k%children===j)}))};
 });
 const ledger=createWikiPlanningCheckpoints(async()=>namespace,signal()),key=await ledger.key("convergence-editorial-v4",["zh-CN",input,undefined,null,null]);
 await ledger.write(key,{pages:candidate,stalled:0,revision:0});
 let plans=0,names=0,allowValid=false;
 const ai={getAnalysisKey:async()=>namespace,generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_directory_names"){
   names++;return request.validate({titles:data.titles.map((item:{id:string;title:string})=>({id:item.id,title:allowValid&&item.id==="p9"?"模块九":item.title}))});
  }
  plans++;expect(data.editorialGrouping).toBeUndefined();
  return request.validate({pages:[{title:`窗口${plans}`,subtopics:[{title:"具体条件",sectionIds:data.sections.map((item:{id:string})=>item.id)}]}]});
 }};
 const run=()=>planWikiTopics(input,"zh-CN",ai,signal());
 await expect(run()).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_duplicate_title"});
 const initialPlans=plans;allowValid=true;const result=await run();
 expect(result).toHaveLength(10);expect(plans).toBe(initialPlans);expect(names).toBe(2);expect(result[9].title).toBe("模块九");
 // 61 planned subtopics exceed the 60-subtopic acceptance limit; their materials all stay.
 expect(result.reduce((n,page)=>n+page.subtopics!.length,0)).toBe(60);expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(input.map(item=>item.id).sort());
 const next=await run();expect(next).toEqual(result);expect(plans).toBe(initialPlans);expect(names).toBe(2);
});

it("allows provisional duplicate names only in planner candidates while public directory validation stays strict",()=>{
 const input:FocusSection[]=pages().map(page=>({id:page.sectionIds[0],title:page.title,body:page.question,kind:"finding",transition:"",evidenceIds:[]}));
 expect(()=>validateWikiPlan({pages:pages()},input)).toThrow();
 expect(validateWikiPlan({pages:pages()},input,{candidate:true})).toHaveLength(3);
});

it("uses the main-model facade budget and never caches an invalid rename response",async()=>{
 let attempts=0,delivered=0;
 const provider={id:crypto.randomUUID(),modelId:"fixture",testConnection:vi.fn(),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  delivered=request.maxOutputTokens!;attempts++;
  return request.validate({titles:[{id:"p0",title:"离线运行"},{id:"p1",title:attempts===1?"离线运行":"联网运行"}]});
 }};
 const ai=createAtlasAIFromProvider(provider,{id:"ai-settings",provider:"openai",baseUrl:"https://fixture.invalid",apiKey:"fixture",model:"fixture",updatedAt:1});
 await expect(repairWikiDirectoryNames(pages(),"zh-CN",ai,signal())).rejects.toThrow();
 const result=await repairWikiDirectoryNames(pages(),"zh-CN",ai,signal());
 expect(result[1].title).toBe("联网运行");expect(delivered).toBe(540);expect(attempts).toBe(2);
 await repairWikiDirectoryNames(pages(),"zh-CN",ai,signal());expect(attempts).toBe(2);
});
