import {expect,it} from "vitest";
import {projectSession} from "../test/project-fixture";
import {generateWikiOverview} from "./wiki-overview";
import {requestBudget} from "./request-policy";
import {projectOverviewContent} from "../shared/project-overview";
import {introductionPriority} from "../shared/project-introduction-text";
import type {StructuredAIRequest} from "./provider";
import type {FocusSession} from "../shared/focus-session";

const purpose="Atlas 帮助重度用户找回过去的 AI 对话。";
function session():FocusSession{
 const value=projectSession();value.mode="work";value.locale="zh-CN";
 value.sections[0].body=`${purpose}\n\n${value.sections[0].body}`;
 value.sections[0].claims=[...value.sections[0].claims??[],{text:purpose,quote:"需求采集提取目标与约束",evidenceIds:["e1"],overviewRole:"purpose"}];
 return value;
}
function ai(overview:unknown,id="openai"){
 const calls:StructuredAIRequest<unknown>[]=[];
 return {calls,ai:{id,generateStructured:async<T,>(request:StructuredAIRequest<T>):Promise<T>=>{calls.push(request as StructuredAIRequest<unknown>);return request.validate(overview);}}};
}
const signal=new AbortController().signal;
const good={overview:"Atlas 是帮助经常使用多个 AI 的用户重新找回旧讨论的工具。它建议先在本地检索历史消息，再把散落的讨论整理成可以核对来源的项目知识，并按任务挑选需要交给新 AI 的内容。各部分方案都以原始消息为依据，读者可以随时回到原文核对每一条结论。",factIds:["f0"]};

it("writes a paraphrased overview once and uses it while the chapters are unchanged",async()=>{
 const {ai:model,calls}=ai(good),before=session();
 const result=await generateWikiOverview(before,model,signal);
 expect(calls).toHaveLength(1);const data=JSON.parse(calls[0].prompt);
 expect(data.presentation).toBe("wiki_project_overview");expect(data.facts[0]).toMatchObject({id:"f0",kind:"positioning"});
 expect(result.wikiOverview?.text).toBe(good.overview);expect(projectOverviewContent(result).text).toBe(good.overview);
 // Any chapter change makes it stale; the local projection returns.
 const edited={...result,sections:result.sections.map(section=>({...section,body:section.body+"\n\n补充。"}))};
 expect(projectOverviewContent(edited).text).not.toBe(good.overview);
});

it.each([
 [{overview:`${purpose}它把历史对话整理成可以核对来源的项目知识。`,factIds:["f0"]},"repeats a chapter sentence"],
 [{overview:"本文档介绍 Atlas 的定位。它帮助用户整理历史对话。",factIds:["f0"]},"describes the document"],
 [{overview:"Atlas 帮助用户找回 3 个平台的旧讨论。它整理历史对话。",factIds:["f0"]},"adds a number"],
 [{overview:"Atlas 帮助用户找回旧讨论。这些均为 AI建议，材料未显示用户已确认采用。",factIds:["f0"]},"adds a disclaimer"],
 [{overview:good.overview,factIds:[]},"cites nothing"],
 [{overview:"Atlas 是帮助经常使用多个 AI 的用户重新找回旧讨论的工具。建议优先阅读第一章，以明确第一版禁止云同步、不含团队协作的范围约束。",factIds:["f0"]},"lists exclusions in its reading advice"],
])("keeps the local projection when the overview %#",async(value)=>{
 const {ai:model}=ai(value),before=session();
 const result=await generateWikiOverview(before,model,signal);
 expect(result.wikiOverview?.text).toContain(before.sections[0].title);
 expect(result.wikiOverview?.text).not.toContain(purpose);expect(result.wikiOverview?.evidenceIds).toEqual([]);
});

it("sends no AI suggestion as current state",async()=>{
 const value=session(),proposal="建议下一步接入自动同步。";
 value.sections[0].body+=`\n\n${proposal}`;value.sections[0].claims!.push({text:proposal,quote:"下一步完成规则校验测试",evidenceIds:["e1"],workStatus:"proposed",overviewRole:"next"});
 const {ai:model,calls}=ai(good);await generateWikiOverview(value,model,signal);
 const facts=JSON.parse(calls[0].prompt).facts as Array<{kind:string;text:string}>;
 expect(facts.every(fact=>["positioning","user_confirmed","user_report"].includes(fact.kind))).toBe(true);
 expect(facts.some(fact=>fact.text.includes("自动同步"))).toBe(false);
});

it("never runs for personal overviews or the shared demo service",async()=>{
 const {ai:model,calls}=ai(good);
 await generateWikiOverview({...session(),briefUserEdited:true},model,signal);
 await generateWikiOverview(session(),{...model,id:"atlas-demo"},signal);
 expect(calls).toHaveLength(0);
});

it("ranks a relationship to another product below what the project itself is",()=>{
 expect(introductionPriority("与 Notion 的关系是分工而非替代，Atlas 定位为智能基础层。")).toBeLessThan(introductionPriority("Atlas 定位为帮助重度用户找回 AI 对话的工具。"));
});

it("rejects a one-line tagline and records why a rejected overview was kept local",async()=>{
 const one={overview:"Atlas 是帮助经常使用多个 AI 的用户重新找回旧讨论的工具。",factIds:["f0"]};
 const tagline:Record<string,number>={};
 expect((await generateWikiOverview(session(),ai(one).ai,signal,tagline)).wikiOverview?.text).toContain("可先读");
 expect(tagline).toEqual({requested:1,retried_length:1,rejected_length:1});
 const report:Record<string,number>={};
 await generateWikiOverview(session(),ai({overview:"本文档介绍 Atlas 的定位与目标用户。它帮助经常使用多个 AI 的用户整理历史对话。它建议先在本地检索历史消息，再把散落的讨论整理成可以核对来源的项目知识，并按任务挑选需要交给新 AI 的内容。",factIds:["f0"]}).ai,signal,report);
 expect(report).toEqual({requested:1,retried_repeat:1,rejected_repeat:1});
});

it("rejects an overview that describes the organizing request instead of the product",async()=>{
 const report:Record<string,number>={},value=session();
 const {ai:model,calls}=ai({overview:"ChatAtlas 旨在把全部已选对话整理成一个项目，帮助用户恢复完整的项目上下文。它建议先在本地检索历史消息，再把散落的讨论整理成可以核对来源的项目知识，并按任务挑选需要交给新 AI 的内容。各部分方案都以原始消息为依据，读者可以随时回到原文核对每一条结论。",factIds:["f0"]});
 expect((await generateWikiOverview(value,model,signal,report)).wikiOverview?.text).toContain("可先读");
 expect(report).toEqual({requested:1,retried_task:1,rejected_task:1});
 // The second attempt is told which rule the first broke.
 expect(calls).toHaveLength(2);expect(calls[1].system).toContain("SECOND ATTEMPT");expect(calls[1].system).toContain("organizing request");
 expect(JSON.parse(calls[0].prompt).project).toEqual({title:value.title});
});

it("shortens chapter openings so a 16-chapter project still fits the overview budget",async()=>{
 const value=session(),template=value.sections[0];
 // Sixteen chapters whose openings each run to the 320-character cap.
 value.sections=Array.from({length:16},(_,index)=>index?{...template,id:`chapter-${index}`,title:`章节${index}`,body:`${"本章说明检索、整理与复用的条件和边界。".repeat(18)}\n\n## 小节\n\n正文。`}:template);
 const {ai:model,calls}=ai(good);
 await generateWikiOverview(value,model,signal);
 const budget=requestBudget(calls[0],undefined),chapters=JSON.parse(calls[0].prompt).chapters as Array<{title:string;opening?:string}>;
 expect(budget.inputTokens).toBeLessThanOrEqual(budget.maxInputTokens);
 expect(chapters.map(chapter=>chapter.title)).toEqual(value.sections.map(section=>section.title));
 expect(Math.max(...chapters.map(chapter=>chapter.opening?.length??0))).toBeLessThan(320);
});

it("compacts scope routing so a project with many reference materials still gets an overview",async()=>{
 const value=session(),evidence=value.sections.flatMap(section=>section.evidenceIds);
 // Like the Atlas run: dozens of reference materials sharing originals with the chapters.
 value.wikiScopeReview={version:1,status:"complete",goal:"Atlas",includeKeys:[],materials:Array.from({length:33},(_,index)=>({id:`m${index}`,key:`k${index}`,title:`参考材料 ${index}`,body:"",evidenceIds:[evidence[index%evidence.length]],kind:"reference" as const,reason:"不属于本项目，仅作背景参考，写作时不得提升为项目要求。",quote:"其他项目的讨论内容，与当前章节的主题相近但不属于本项目。".repeat(5)}))};
 const {ai:model,calls}=ai(good);
 const result=await generateWikiOverview(value,model,signal);
 expect(result.wikiOverview?.text).toBe(good.overview);
 const budget=requestBudget(calls[0],undefined),routing=JSON.parse(calls[0].prompt).sourceRouting as Array<Record<string,unknown>>;
 expect(budget.inputTokens).toBeLessThanOrEqual(budget.maxInputTokens);
 // Every qualified material is still named; only its passage IDs and long quote are left out.
 expect(routing).toHaveLength(33);expect(routing[0]).not.toHaveProperty("passageIds");
});

it("falls back to the actual reading route after provider failure, without copying introductions or inventing progress",async()=>{
 const before=session(),report:Record<string,number>={};
 const result=await generateWikiOverview(before,{generateStructured:async()=>{throw new Error("offline");}},signal,report);
 expect(result.wikiOverview?.text).toContain(before.sections[0].title);
 expect(result.wikiOverview?.text).not.toContain(purpose);
 expect(result.wikiOverview?.text).not.toMatch(/完成|Milestone|M5|已实现/u);
 expect(result.wikiOverview?.evidenceIds).toEqual([]);
 expect(report).toEqual({requested:1,rejected_request:1});expect(projectOverviewContent(result).text).toBe(result.wikiOverview?.text);
 expect(before.wikiOverview).toBeUndefined();
});

it("rejects an overview that opens with the document instead of the project",async()=>{
 const report:Record<string,number>={};
 const opening={...good,overview:`本文档围绕 Atlas 如何帮助多 AI 用户整理和找回旧讨论这一主题展开。${good.overview.slice(good.overview.indexOf("。")+1)}`};
 const result=await generateWikiOverview(session(),ai(opening).ai,signal,report);
 expect(report).toEqual({requested:1,retried_opening:1,rejected_opening:1});
 expect(result.wikiOverview?.text).not.toContain("本文档围绕");
 expect((await generateWikiOverview(session(),ai(good).ai,signal)).wikiOverview?.text).toBe(good.overview);
});


it("keeps what the discussion said about a competitor out of the overview's positioning and refuses its feature names",async()=>{
 const value=session(),competitor="主要面向技术用户，通过 CLI/TUI 操作，Chrome 扩展同步需启动本地 hstry-api。";
 value.sections[0].body+=`\n\n${competitor}`;
 value.sections[0].claims!.push({text:competitor,quote:"需求采集提取目标与约束",evidenceIds:["e1"],overviewRole:"purpose",unitIds:["u-hstry"]});
 const unit={id:"u-hstry",subject:"hstry",statement:competitor,kind:"constraint",details:[],about:{name:"hstry",role:"competitor"},evidence:{evidenceId:"e1",conversationId:"c",messageId:"m",messageIndex:1,role:"assistant",pasted:false,quote:competitor},adoption:{status:"unknown"},delivery:"unknown"};
 value.wikiKnowledge={version:1,generatedAt:1,status:"complete",materials:1,batches:[{sourceIds:[],status:"ok",units:[unit],rejected:{}}]} as unknown as FocusSession["wikiKnowledge"];
 const {ai:model,calls}=ai({...good,overview:good.overview.replace("工具。","工具，通过 CLI 和 Chrome 扩展使用。")});
 const result=await generateWikiOverview(value,model,signal);
 // The competitor's row is no positioning fact; an overview naming its CLI is refused, asked again, and refused.
 expect(JSON.parse(calls[0].prompt).facts.map((fact:{text:string})=>fact.text).join("")).not.toContain("CLI");
 expect(calls).toHaveLength(2);expect(calls[1].system).toContain("competitor");
 expect(result.wikiOverview?.text).not.toContain("CLI");
});

it("ranks what the product is above a module's positioning among the overview's facts",async()=>{
 const value=session(),module="对话库应定位为原始对话资产管理模块，类似 AI 对话的文件管理器。",product="任务规划工具定位为帮助团队把需求整理成可执行计划的本地工具。";
 value.sections[0].body+=`\n\n${module}\n\n${product}`;
 value.sections[0].claims!.push({text:module,quote:"需求采集提取目标与约束",evidenceIds:["e1"],overviewRole:"purpose"},{text:product,quote:"需求采集提取目标与约束",evidenceIds:["e1"],overviewRole:"purpose"});
 const {ai:model,calls}=ai(good);
 await generateWikiOverview(value,model,signal);
 const texts=JSON.parse(calls[0].prompt).facts.map((fact:{text:string})=>fact.text);
 expect(texts.findIndex((text:string)=>text.includes("任务规划工具定位为"))).toBeLessThan(Math.max(0,texts.findIndex((text:string)=>text.includes("对话库应定位为")))||Infinity);
});

it("does not promote a phase-excluded direction to the overview's current core feature",async()=>{
 const current=session();
 const make=(id:string,statement:string,index:number)=>({id,statement,subject:"同步",kind:"plan" as const,details:[],adoption:{status:"proposal" as const},delivery:"unknown" as const,evidence:{evidenceId:id,conversationId:"c",messageId:id,messageIndex:index,role:"assistant" as const,pasted:false,quote:statement}});
 const wish=make("wish","提供云端同步。",1),scope=make("scope","第一版暂不提供云端同步，仅保留本地存储。",2);
 current.wikiKnowledge={version:1,generatedAt:0,status:"complete",materials:2,batches:[{sourceIds:[],status:"ok",units:[wish,scope],rejected:{}}],organization:{version:1,generatedAt:0,status:"complete",subjects:[{id:"s",name:"同步",aliases:[],unitIds:[wish.id,scope.id]}],merged:[],chapters:[],report:{},relations:[{older:wish.id,newer:scope.id,kind:"narrows",status:"resolved"}]}};
 const report:Record<string,number>={},bad={overview:"Atlas 是帮助经常使用多个 AI 的用户找回旧讨论的工具，以云端同步为核心功能。建议先阅读产品定位章节，理解目标用户和阅读方式，再按需要查看后续章节。",factIds:["f0"]};
 const model=ai(bad),result=await generateWikiOverview(current,model.ai,signal,report);
 expect(report.retried_scope).toBe(1);expect(report.rejected_scope).toBe(1);
 expect(JSON.parse(model.calls[0].prompt).scopeConditions[0].scope).toBe(scope.statement);
 expect(result.wikiOverview?.text).not.toContain("以云端同步为核心");
});

it("keeps a source-backed product introduction when the model overview is refused",async()=>{
 const current=session(),source=current.evidence[0],statement="项目定位为面向研究者的本地知识工作台。";
 source.excerpt=statement;
 const position={id:"position",subject:"产品定位",statement,kind:"fact" as const,details:[],adoption:{status:"proposal" as const},delivery:"unknown" as const,evidence:{evidenceId:source.id,conversationId:source.conversationId,messageId:source.messageId,messageIndex:1,role:"assistant" as const,pasted:false,quote:statement}};
 current.sections[0].claims!.push({text:statement,quote:statement,evidenceIds:[source.id],unitIds:[position.id],overviewRole:"purpose"});
 current.wikiKnowledge={version:1,generatedAt:0,status:"complete",materials:1,batches:[{sourceIds:[],status:"ok",units:[position],rejected:{}}],organization:{version:1,generatedAt:0,status:"complete",subjects:[{id:"s",name:"产品定位",aliases:[],unitIds:[position.id]}],chapters:[{id:"c",title:"产品定位",question:"",group:"",subtopics:[{title:"产品定位",subjectIds:["s"]}]}],merged:[],relations:[],report:{}}};
 const model=ai({overview:"格式错误",factIds:[]});
 const result=await generateWikiOverview(current,model.ai,signal);
 expect(result.wikiOverview?.text).toContain(statement);
 expect(result.wikiOverview?.evidenceIds).toContain(source.id);
});

it("introduces the project by what the chapters say it is, though that sentence carries no claim", async()=>{
 const current=projectSession();current.mode="work";current.locale="zh-CN";
 const source=current.evidence[0],statement="AI Circuit Studio 定位为面向大学生和硬件初学者的 AI 硬件设计工作台，帮助用户理解并搭建硬件系统。",bench="建立 BenchKit 基准测试集，包含 50 个 ESP32 项目任务，用于评估 AI 生成方案的准确性。";
 for(const section of current.sections)section.claims=(section.claims??[]).map(claim=>{const copy={...claim};delete copy.overviewRole;return copy;});
 current.sections[0].body+=`\n\n${statement}\n\n${bench}`;
 current.sections[0].claims!.push({text:bench,quote:bench,evidenceIds:[source.id],unitIds:["bench"]});
 const make=(id:string,text:string)=>({id,subject:"产品定位",statement:text,kind:"fact" as const,details:[],adoption:{status:"proposal" as const},delivery:"unknown" as const,evidence:{evidenceId:source.id,conversationId:source.conversationId,messageId:source.messageId,messageIndex:1,role:"assistant" as const,pasted:false,quote:text}});
 const position=make("position",statement),plan=make("bench",bench);
 current.wikiKnowledge={version:1,generatedAt:0,status:"complete",materials:1,batches:[{sourceIds:[],status:"ok",units:[position,plan],rejected:{}}],
  organization:{version:1,generatedAt:0,status:"complete",projectName:"Circuit Studio",subjects:[{id:"s",name:"产品定位",aliases:[],unitIds:[position.id,plan.id]}],chapters:[{id:"c",title:"产品定位",question:"",group:"",subtopics:[{title:"产品定位",subjectIds:["s"]}]}],merged:[],relations:[],report:{}},
  draft:{version:1,generatedAt:0,status:"complete",report:{},chapters:[{id:"c",title:"产品定位",question:"",group:"",problems:[],body:`${statement}\n\n${bench}`,paragraphs:[{subtopic:"产品定位",text:statement,unitIds:[position.id]},{subtopic:"产品定位",text:bench,unitIds:[plan.id],claims:[{text:bench,unitIds:[plan.id]}]}]}]}};
 const {ai:model,calls}=ai(good);
 await generateWikiOverview(current,model,signal);
 const positioning=JSON.parse(calls[0].prompt).facts.filter((fact:{kind:string})=>fact.kind==="positioning").map((fact:{text:string})=>fact.text);
 expect(positioning).toEqual([statement]);
});
