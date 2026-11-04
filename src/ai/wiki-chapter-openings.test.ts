import {expect,it} from "vitest";
import {refreshWikiChapterOpenings} from "./wiki-chapter-openings";
import {wikiChapterStatus,wikiChapterStatusTag} from "../shared/wiki-chapter-status";
import type {FocusSection} from "../shared/focus-session";
import type {StructuredAIRequest} from "./provider";
import {requestBudget} from "./request-policy";

const detail=(topic:string)=>`${topic}需要保留原始消息位置、前后文和发言角色，便于之后逐条核对来源。`.repeat(14);
const large=(opening:string)=>`${opening}\n\n## 检索\n\n${detail("检索")}\n\n## 组装\n\n${detail("组装")}`;
const section=(body:string,extra:Partial<FocusSection>={}):FocusSection=>({id:"s",title:"上下文引擎",body,kind:"finding",transition:"",evidenceIds:["e1"],wikiQuestion:"怎样把已有知识按任务交给新 AI",claims:[{text:"上下文按任务从已保存知识中选取",quote:"按任务选取",evidenceIds:["e1"],workStatus:"proposed"}],...extra});
const signal=new AbortController().signal;
function ai(overview:unknown){
 const calls:StructuredAIRequest<unknown>[]=[];
 return {calls,ai:{id:"openai",generateStructured:async<T,>(request:StructuredAIRequest<T>):Promise<T>=>{calls.push(request as StructuredAIRequest<unknown>);return request.validate(overview);}}};
}
const meta="本章说明上下文引擎如何工作。这些方案多为 AI建议，材料未显示用户已确认采用。";

it("replaces a meta opening with a conclusion-first summary written after the chapter",async()=>{
 const {ai:model,calls}=ai({overview:"上下文建议按任务从已保存知识中选取，再在本地组装，不重新阅读全部历史。",claimIds:["c0"]});
 const {sections,report}=await refreshWikiChapterOpenings([section(large(meta))],model,signal,"zh-CN");
 expect(sections[0].body.startsWith("上下文建议按任务从已保存知识中选取")).toBe(true);expect(sections[0].body).toContain(detail("组装"));
 expect(report).toEqual({requested:1,accepted:1,dropped:0,stripped:0,rejected:{}});
 const data=JSON.parse(calls[0].prompt);expect(data.presentation).toBe("wiki_chapter_opening");expect(data.chapter.headings).toEqual(["检索","组装"]);expect(data.claims[0]).toMatchObject({id:"c0",status:"proposal"});
});

it("passes speaker, milestone scope and membership qualifications through the final opening rewrite",async()=>{
 const {ai:model,calls}=ai({overview:"AI 曾判断达到 M5，用户仅报告 M2 完成；两者均不是代码核验结果。",claimIds:["c0","c1"]});
 const chapter=section(large(meta),{claims:[{text:"AI 曾判断达到 M5",quote:"达到 M5",evidenceIds:["a"],overviewRole:"stage",subject:"项目进度",scope:"Alpha"},{text:"用户报告 M2 完成",quote:"M2 完成",evidenceIds:["u"],workStatus:"reported",overviewRole:"progress"}]});
 chapter.body+="\n\n来源讨论含 M5 与 M2，阶段未核实。";
 const context={sources:(claim:NonNullable<FocusSection["claims"]>[number])=>[{role:claim.evidenceIds[0]==="a"?"assistant":"user",conversationId:"chat",messageIndex:claim.evidenceIds[0]==="a"?0:1}],routing:()=>[{kind:"uncertain" as const,materialId:"ambiguous",title:"",reason:"",quote:"",passageIds:["u"]}]};
 await refreshWikiChapterOpenings([chapter],model,signal,"zh-CN",4,context);
 const data=JSON.parse(calls[0].prompt);
 expect(data.claims[0]).toMatchObject({quote:"达到 M5",subject:"项目进度",scope:"Alpha",sources:[{role:"assistant",messageIndex:0}]});
 expect(data.claims[1]).toMatchObject({workStatus:"reported",sources:[{role:"user",messageIndex:1}]});
 expect(data.sourceRouting[0]).toMatchObject({kind:"uncertain"});
});

it("shortens quotes, sources and scope routing for a large chapter instead of refusing it locally",async()=>{
 const {ai:model,calls}=ai({overview:"上下文建议按任务从已保存知识中选取，再在本地组装，不重新阅读全部历史。",claimIds:["c0"]});
 const claims=Array.from({length:14},(_,index)=>({text:`上下文第 ${index} 条结论按任务从已保存知识中选取`,quote:`原文第 ${index} 段：${"保留原始消息位置、前后文和发言角色，便于之后逐条核对来源。".repeat(12)}`,evidenceIds:[`e${index}`],workStatus:"proposed" as const}));
 const routing=Array.from({length:40},(_,index)=>({kind:"reference" as const,materialId:`m${index}`,title:`参考材料 ${index}`,reason:"不属于本项目，仅作背景参考，写作时不得提升为项目要求。",quote:"其他项目的讨论内容，与当前章节的主题相近但不属于本项目。".repeat(4),passageIds:Array.from({length:6},(_,item)=>`note:${index}:${item}:long-identifier`)}));
 const context={sources:()=>Array.from({length:4},(_,index)=>({role:"assistant",conversationId:"6ac6fc4d-24d0-83ec-a717-51865785a3ce",messageIndex:index})),routing:()=>routing};
 const {report}=await refreshWikiChapterOpenings([section(large(meta),{claims})],model,signal,"zh-CN",4,context);
 expect(report.accepted).toBe(1);
 const sent=calls[0],data=JSON.parse(sent.prompt),budget=requestBudget(sent);
 expect(budget.inputTokens).toBeLessThanOrEqual(budget.maxInputTokens);
 // Every claim and its ID stay; only quotes, source lists and routing detail shrink.
 expect(data.claims.map((claim:{id:string})=>claim.id)).toEqual(claims.map((_,index)=>`c${index}`));
 expect(data.sourceRouting).toHaveLength(40);expect(data.sourceRouting[0]).not.toHaveProperty("passageIds");
 expect((data.claims[0].quote??"").length).toBeLessThan(claims[0].quote.length);
});

it.each([
 [{overview:"本章说明上下文引擎如何按任务选取已保存的知识内容。",claimIds:["c0"]}],
 [{overview:"这些方案均为 AI建议，按任务选取已保存的知识内容。",claimIds:["c0"]}],
 [{overview:"上下文按任务从 3 类已保存知识中选取并组装。",claimIds:["c0"]}],
 [{overview:"上下文按任务从已保存知识中选取并在本地组装。",claimIds:["missing"]}],
])("keeps the written opening, minus disclaimers, when the summary is invalid",async value=>{
 const {ai:model}=ai(value);
 const {sections,report}=await refreshWikiChapterOpenings([section(large(meta))],model,signal,"zh-CN");
 // The written opening only described the chapter, so nothing of it remains.
 expect(sections[0].body.startsWith("## 检索")).toBe(true);
 expect(report).toMatchObject({requested:1,accepted:0,stripped:1});
});

it("drops a small chapter's opening that only repeats its body, and never sends a request",async()=>{
 const {ai:model,calls}=ai({});
 const body=`检索需要保留原始消息位置、前后文和发言角色。\n\n## 检索\n\n${detail("检索").slice(0,120)}`;
 const {sections,report}=await refreshWikiChapterOpenings([section(body)],model,signal,"zh-CN");
 expect(sections[0].body.startsWith("## 检索")).toBe(true);expect(report.dropped).toBe(1);expect(calls).toHaveLength(0);
});

it("protects claims written only in the opening, personal chapters and the demo service",async()=>{
 const {ai:model,calls}=ai({overview:"上下文按任务从已保存知识中选取并在本地组装。",claimIds:["c0"]});
 const owned=section(large("上下文按任务从已保存知识中选取。"));
 const personal=section(large(meta),{id:"p",userEdited:true});
 const {sections}=await refreshWikiChapterOpenings([owned,personal],model,signal,"zh-CN");
 expect(sections[0]).toBe(owned);expect(sections[1]).toBe(personal);expect(calls).toHaveLength(0);
 const demo=await refreshWikiChapterOpenings([section(large(meta))],{...model,id:"atlas-demo"},signal,"zh-CN");
 expect(calls).toHaveLength(0);expect(demo.sections[0].body.startsWith("## 检索")).toBe(true);
});

it("removes sentences that only describe the chapter, but keeps claims and content said nowhere else",async()=>{
 const {ai:model}=ai({});
 const described=await refreshWikiChapterOpenings([section(large("本章汇总了上下文引擎的设计方案。核心思路是先检索再组装。"))],{...model,id:"atlas-demo"},signal,"zh-CN");
 expect(described.sections[0].body.startsWith("核心思路是先检索再组装。\n\n## 检索")).toBe(true);
 const substantive="本章分析检索方案，识别出当前缺少一个按发言角色过滤原始消息的入口。";
 const kept=await refreshWikiChapterOpenings([section(large(substantive))],{...model,id:"atlas-demo"},signal,"zh-CN");
 expect(kept.sections[0].body.startsWith(substantive)).toBe(true);
 const claimed=section(large("本章说明上下文按任务从已保存知识中选取。"),{claims:[{text:"上下文按任务从已保存知识中选取",quote:"按任务选取",evidenceIds:["e1"],workStatus:"proposed"}]});
 expect((await refreshWikiChapterOpenings([claimed],{...model,id:"atlas-demo"},signal,"zh-CN")).sections[0]).toBe(claimed);
});

it("summarizes chapter status from locally read claims instead of repeated disclaimers",()=>{
 const claim={text:"a",quote:"a",evidenceIds:["e1"]};
 expect(wikiChapterStatus(section("",{claims:[{...claim,workStatus:"proposed"},{...claim,workStatus:"proposed"},{...claim}]}),true)).toBe("多为 AI 建议，相关原文里没有看到你的确认");
 const reading=(status:"confirmed"|"reported")=>({signature:"",status,reported:status==="reported",currentStage:false,sources:[]});
 expect(wikiChapterStatus(section("",{claims:[{...claim,workStatus:"proposed"},{...claim,sourceReading:reading("confirmed")},{...claim,sourceReading:reading("reported")}]}),true)).toBe("包含你的决定 1 条、你报告的进展 1 条（实现未核对）、未确认的建议 1 条");
 expect(wikiChapterStatus(section("",{userEdited:true}),true)).toBeUndefined();
 expect(wikiChapterStatus(section("",{claims:[]}),true)).toBeUndefined();
});

it("writes an opening for a large chapter that starts at its first heading",async()=>{
 const {ai:model}=ai({overview:"上下文建议按任务从已保存知识中选取，再在本地组装。",claimIds:["c0"]});
 const body=large("").trimStart();
 const {sections}=await refreshWikiChapterOpenings([section(body)],model,signal,"zh-CN");
 expect(sections[0].body.startsWith("上下文建议按任务从已保存知识中选取，再在本地组装。\n\n## 检索")).toBe(true);
});

it("records why a summary was rejected and accepts numbers already in the chapter",async()=>{
 const meta=await refreshWikiChapterOpenings([section(large("本章说明上下文引擎如何工作。"))],ai({overview:"本章说明上下文引擎如何按任务选取已保存知识。",claimIds:["c0"]}).ai,signal,"zh-CN");
 expect(meta.report.rejected).toEqual({meta:1});
 const withNumber=section(large("本章说明上下文引擎。").replace("## 组装","## 组装\n\n优先级 P0 是历史消息查找。"));
 const accepted=await refreshWikiChapterOpenings([withNumber],ai({overview:"上下文按任务选取已保存知识，P0 是历史消息查找。",claimIds:["c0"]}).ai,signal,"zh-CN");
 expect(accepted.report).toMatchObject({accepted:1,rejected:{}});
});

it("replaces or cleans only the first paragraph and keeps further leading paragraphs as written",async()=>{
 const extra="Atlas 的功能规划围绕导入、选择、生成、确认与导出的闭环展开。\n\n侧边栏被定义为快速准备上下文的入口，点击后先预览。";
 const body=large(`${meta}\n\n${extra}`);
 const replaced=await refreshWikiChapterOpenings([section(body)],ai({overview:"上下文建议按任务从已保存知识中选取，再在本地组装，不重新阅读全部历史。",claimIds:["c0"]}).ai,signal,"zh-CN");
 expect(replaced.sections[0].body.startsWith(`上下文建议按任务从已保存知识中选取，再在本地组装，不重新阅读全部历史。\n\n${extra}\n\n## 检索`)).toBe(true);
 const stripped=await refreshWikiChapterOpenings([section(body)],ai({overview:"本章说明上下文引擎如何按任务选取已保存知识。",claimIds:["c0"]}).ai,signal,"zh-CN");
 // Paragraph breaks survive: no wall of joined text.
 expect(stripped.sections[0].body.startsWith(`${extra}\n\n## 检索`)).toBe(true);
});

it("merges one short second introduction into the new opening, citing the claims only it states",async()=>{
 const summary="上下文建议按任务从已保存知识中选取，再在本地组装，不重新阅读全部历史。";
 const second="上下文引擎负责把已经整理好的知识交给新的 AI，帮助它理解项目当前的状态。";
 const body=`${meta}\n\n${second}\n\n## 检索\n\n${detail("检索")}\n\n## 组装\n\n${detail("组装")}`;
 const merged=ai({overview:summary,claimIds:["c0"]});
 const {sections,report}=await refreshWikiChapterOpenings([section(body)],merged.ai,signal,"zh-CN");
 expect(JSON.parse(merged.calls[0].prompt)).toMatchObject({followingParagraph:second,requiredClaimIds:[]});
 expect(sections[0].body.startsWith(`${summary}\n\n## 检索`)).toBe(true);expect(report).toMatchObject({accepted:1,replacedLead:1});
 // A claim found only in that introduction must be cited, or both paragraphs stay.
 const owned=section(body,{claims:[{text:"帮助它理解项目当前的状态",quote:"理解项目当前的状态",evidenceIds:["e1"],workStatus:"proposed"}]});
 const uncited=ai({overview:summary,claimIds:["missing"]});
 const kept=await refreshWikiChapterOpenings([owned],uncited.ai,signal,"zh-CN");
 expect(JSON.parse(uncited.calls[0].prompt).requiredClaimIds).toEqual(["c0"]);
 expect(kept.sections[0].body).toContain(`${second}\n\n## 检索`);expect(kept.report.replacedLead).toBeUndefined();
 const cited=await refreshWikiChapterOpenings([owned],ai({overview:summary,claimIds:["c0"]}).ai,signal,"zh-CN");
 expect(cited.sections[0].body.startsWith(`${summary}\n\n## 检索`)).toBe(true);
});

it("cleans the opening of a chapter written as continuous prose, without subheadings",async()=>{
 const {ai:model,calls}=ai({});
 const body=`本章聚焦于为初学者设计的完整体验路径。\n\n${detail("体验")}\n\n${detail("首页")}`;
 const {sections,report}=await refreshWikiChapterOpenings([section(body)],model,signal,"zh-CN");
 expect(sections[0].body.startsWith(detail("体验"))).toBe(true);expect(report.dropped+report.stripped).toBe(1);expect(calls).toHaveLength(0);
 // A substantive opening stays as written.
 const kept=section(`首页只保留输入框和示例，降低进入门槛。\n\n${detail("首页")}`);
 expect((await refreshWikiChapterOpenings([kept],model,signal,"zh-CN")).sections[0]).toBe(kept);
});

it("tags a chapter by its source in two words and keeps the counts as detail",()=>{
 const claim={text:"a",quote:"a",evidenceIds:["e1"]};
 const proposals=section("",{claims:[{...claim,workStatus:"proposed"},{...claim,workStatus:"proposed"}]});
 expect(wikiChapterStatusTag(proposals,true)).toEqual({label:"多为 AI 建议",detail:"多为 AI 建议，相关原文里没有看到你的确认"});
 const reading={signature:"",status:"confirmed" as const,reported:false,currentStage:false,sources:[]};
 expect(wikiChapterStatusTag(section("",{claims:[{...claim,workStatus:"proposed"},{...claim,sourceReading:reading}]}),true)?.label).toBe("含用户决定");
 // Nothing worth a tag: no label at all.
 expect(wikiChapterStatusTag(section("",{claims:[{...claim}]}),true)).toBeUndefined();
});

it("drops a link word left dangling by a removed description, and retries a refused opening once",async()=>{
 const {ai:model}=ai({});
 const described=await refreshWikiChapterOpenings([section(large("本章说明知识管理的问题。为此，AI建议把文档分为三层。"))],{...model,id:"atlas-demo"},signal,"zh-CN");
 expect(described.sections[0].body.startsWith("AI建议把文档分为三层。\n\n## 检索")).toBe(true);
 const calls:StructuredAIRequest<unknown>[]=[];
 const answers=[{overview:"短。",claimIds:["c0"]},{overview:"上下文建议按任务从已保存知识中选取，再在本地组装。",claimIds:["c0"]}];
 const retrying={id:"openai",generateStructured:async<T,>(request:StructuredAIRequest<T>):Promise<T>=>{calls.push(request as StructuredAIRequest<unknown>);return request.validate(answers[calls.length-1]);}};
 const {sections,report}=await refreshWikiChapterOpenings([section(large(meta))],retrying,signal,"zh-CN");
 expect(sections[0].body.startsWith("上下文建议按任务从已保存知识中选取")).toBe(true);
 expect(report).toMatchObject({requested:1,accepted:1,retried:1});expect(calls[1].system).toContain("SECOND ATTEMPT");
});
