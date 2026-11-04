import {expect,it,vi} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {sourceMessageSignature} from "../shared/source-signature";
import {projectStateSignature} from "../shared/project-state";
import {estimateTokens} from "../shared/atlas/policy.js";
import {buildProjectContext} from "./engine";
import {formatContext} from "./format";
import type {ContextOptions,ProjectKnowledge} from "./types";

const options:ContextOptions={zh:true,task:"",length:"standard",sections:["overview","decisions","progress"]};
function fixture(){const knowledge=contextKnowledge();knowledge.session.projectMaintenance={};knowledge.session.projectState!.decisions=[];knowledge.session.projectState!.constraints=[];knowledge.session.projectState!.actions=[];knowledge.session.sections=[];return knowledge;}
function decision(knowledge:ProjectKnowledge,id:string,text:string,content:string){
 const message={...knowledge.messages[0],id,role:"assistant" as const,content,messageIndex:knowledge.messages.length};
 knowledge.messages.push(message);knowledge.session.evidence.push({id,conversationId:"c",messageId:id,title:"原始讨论",excerpt:content});
 knowledge.session.sourceRoles!.c[id]="assistant";knowledge.session.sourceSignatures!.c[id]=sourceMessageSignature(content);
 knowledge.session.projectState!.decisions.push({id,text,reason:"",status:"documented",quote:content,evidenceIds:[id]});
}
function build(knowledge:ProjectKnowledge,patch:Partial<ContextOptions>={}){knowledge.session.projectState!.signature=projectStateSignature(knowledge.session);return buildProjectContext(knowledge,{...options,...patch});}

it("rejects unrelated diagram, font and inventory windows instead of asserting their generated requirements",()=>{
 const knowledge=fixture();
 decision(knowledge,"canvas","使用 React Flow 构建拖拽画布","┌──────────────────┐\n│ AI Hardware Builder 检查方案 │\n└──────────────────┘");
 decision(knowledge,"font","全站字体 Geist/Inter、正文最小14px、行高1.65、统一中文UI","```css\nfont-family: Geist, Inter, sans-serif;\n```");
 decision(knowledge,"inventory","Catalog, Inventory, and Hardware IR must remain strictly separated.","未来如果用户真的开始 Build，才可能有 reserve / consume。当前不做。\n\nInventoryItem.source 允许 manual / vision。");
 const before=structuredClone(knowledge),fetch=vi.spyOn(globalThis,"fetch");
 try{const bundle=buildProjectContext(knowledge,{...options}),text=formatContext(bundle);expect(bundle.sections.flatMap(section=>section.items).some(item=>["canvas","font","inventory"].includes(item.id))).toBe(false);expect(bundle.omissions?.unsupported).toBe(3);expect(text).not.toContain("14px");expect(knowledge).toEqual(before);expect(fetch).not.toHaveBeenCalled();}finally{fetch.mockRestore();}
});
it("exports the original temporary recommendation, never an inflated formal freeze or a second copy",()=>{
 const knowledge=fixture(),content="看你现在 README，我的判断是：\n\n## AI Core 暂时可以冻结。\n\n你已经有 LocalInterpreter 和 LLMInterpreter。";
 decision(knowledge,"freeze","正式冻结 AI Core",content);
 const bundle=build(knowledge,{mode:"full"}),item=bundle.sections.flatMap(section=>section.items).find(item=>item.id==="freeze")!,text=formatContext(bundle);
 expect(item).toMatchObject({status:"proposal",literal:true});expect(text).toContain("我的判断是");expect(text).toContain("暂时可以冻结");expect(text).not.toContain("正式冻结");expect(text.match(/AI Core 暂时可以冻结/g)).toHaveLength(1);
 expect(item.quotes?.every(quote=>content.includes(quote.text))).toBe(true);
});
it("never exports the unsupported extra clauses of a partially matching summary",()=>{
 const knowledge=fixture();decision(knowledge,"partial","采用 React Flow，必须双 Tab 且字号为14px","我建议使用 React Flow 构建画布。\n\n后续可以讨论其他界面安排。");
 const bundle=build(knowledge,{task:"React Flow",mode:"task"}),text=formatContext(bundle);
 // A conservative matcher can withhold this record, or export only literal originals.
 expect(text).not.toContain("必须双 Tab");expect(text).not.toContain("字号为14px");
 for(const item of bundle.sections.flatMap(section=>section.items).filter(item=>item.id==="partial"))expect(item.text).toBe("我建议使用 React Flow 构建画布。");
});
it("puts the project snapshot first, labels the overview and keeps gaps with sources",()=>{
 const knowledge=fixture();knowledge.session.goal="把全部已选对话整理成一个项目";
 decision(knowledge,"ir","Hardware IR 是统一数据源","建议以 Hardware IR 作为统一数据源。");
 const text=formatContext(build(knowledge));expect(text.indexOf("## 当前项目快照")).toBeLessThan(text.indexOf("## 来源与信息缺口"));expect(text).toContain("生成的项目简介，未逐项核对");expect(text).toContain("现行方案：本稿缺少可确认的选择");expect(text).toContain("不能据历史建议推断当前架构");
});
it.each(["short","standard","detailed"] as const)("caps %s panorama advice, rejects incidental UI detail and explains omissions within budget",length=>{
 const knowledge=fixture();for(let index=0;index<30;index++)decision(knowledge,`proposal-${index}`,`建议模块 feature_${index} 保留稳定输入输出`,`建议模块 feature_${index} 保留稳定输入输出。`);
 decision(knowledge,"font","界面字号建议16px","界面字号建议16px。");
 const bundle=build(knowledge,{length}),items=bundle.sections.flatMap(section=>section.items),text=formatContext(bundle),limit={short:2,standard:4,detailed:8}[length];
 expect(items.filter(item=>item.status==="proposal").length).toBeLessThanOrEqual(limit);expect(items.some(item=>item.id==="font")).toBe(false);expect(bundle.omissions!.relevance).toBeGreaterThan(0);expect(estimateTokens(text)).toBeLessThanOrEqual(bundle.tokenBudget);
 expect(text).toContain("不能据此断定不存在其他决定");expect(text).not.toContain("Token 预算");
 expect(formatContext(build(knowledge,{length,task:"字号",mode:"task"}))).toContain("界面字号建议16px");
});
it("combines identical literal advice while retaining all original message identities and scope",()=>{
 const knowledge=fixture(),content="V0.1 建议采用 LocalInterpreter，复杂请求再调用 LLM。";
 decision(knowledge,"first","V0.1 采用 LocalInterpreter，复杂请求调用 LLM",content);decision(knowledge,"second","V0.1 简单请求采用 LocalInterpreter，复杂请求调用 LLM",content);
 const bundle=build(knowledge,{mode:"full"}),item=bundle.sections.flatMap(section=>section.items).find(item=>item.literal)!;
 expect(bundle.omissions!.duplicate).toBe(1);expect(item.scope).toBe("phase");expect(item.sourceIds).toHaveLength(2);expect(bundle.sources.map(source=>source.messageId)).toEqual(["first","second"]);
 expect(formatContext(bundle)).toContain("原文标识: first");expect(formatContext(bundle)).toContain("对话内第 3 条消息");
});
it("does not fill a panorama with phase boundaries and ordinary historical advice",()=>{
 const knowledge=fixture();
 for(let index=0;index<8;index++)decision(knowledge,`scope-${index}`,`V0.${index} 仅支持模块化元件`,`V0.${index} 仅支持模块化元件。`);
 decision(knowledge,"ir","Hardware IR 是统一数据源","建议以 Hardware IR 作为统一数据源。");
 decision(knowledge,"byok","建议采用 BYOK 接入模式","建议采用 BYOK 接入模式。");
 decision(knowledge,"inventory","Inventory 不绕过兼容性规则","Inventory 不绕过兼容性规则。");
 const ids=build(knowledge).sections.flatMap(section=>section.items).map(item=>item.id);
 expect(ids).not.toContain("scope-0");expect(ids).not.toContain("scope-1");expect(ids).not.toContain("byok");expect(ids).not.toContain("inventory");
});
it("keeps whole related-source paragraphs and never cuts a code fence or single long condition",()=>{
 const knowledge=fixture();knowledge.session.sections=[{id:"personal",title:"记录",body:"个人说明",kind:"finding",transition:"",evidenceIds:["e-ui"]}];
 knowledge.session.evidence[1].excerpt=knowledge.messages[1].content;const text=formatContext(build(knowledge,{sections:["wiki"]}));
 expect(text).toContain("关联原文节选（非逐项证明）");expect(text).not.toContain("> ```ts");expect(text.match(/```/g)?.length??0).toBe(0);
});
it("uses English status and omission explanations without claiming capture dates are original timestamps",()=>{
 const knowledge=fixture();decision(knowledge,"ir","Hardware IR is the single source","I suggest using Hardware IR as the single source.");
 const text=formatContext(build(knowledge,{zh:false,mode:"full"}));expect(text).toContain("Current project snapshot");expect(text).toContain("Information gaps");expect(text).toContain("Original evidence excerpts");expect(text).toContain("Message 3 in conversation");expect(text).not.toContain("1970");
});
it("budgets an empty handoff's scaffold instead of claiming the user's explicit content caused an overrun",()=>{
 for(const tokenBudget of [256,480,800,1000,1200,1400,3600]){
  const bundle=buildProjectContext(contextKnowledge(),{...options,tokenBudget});
  expect(bundle.estimatedTokens).toBeLessThanOrEqual(tokenBudget);
 }
});
it("does not acquire confirmation or a version scope from an unrelated clause or generated summary",()=>{
 const knowledge=fixture(),message={...knowledge.messages[0],id:"two-clauses",messageIndex:3,content:"确认采用 IndexedDB。\n\nOrama 还需要继续讨论。"};
 knowledge.messages.push(message);knowledge.session.evidence.push({id:message.id,conversationId:"c",messageId:message.id,title:"讨论",excerpt:message.content});knowledge.session.sourceRoles!.c[message.id]="user";knowledge.session.sourceSignatures!.c[message.id]=sourceMessageSignature(message.content);
 knowledge.session.projectState!.decisions.push({id:"orama",text:"采用 Orama",reason:"",status:"documented",quote:message.content,evidenceIds:[message.id]});
 decision(knowledge,"no-phase","禁止未经授权上传对话","我建议禁止未经授权上传对话。");
 const proposal=knowledge.session.projectState!.decisions.pop()!;knowledge.session.projectState!.constraints.push({...proposal,text:"V1 禁止未经授权上传对话"});
 const bundle=build(knowledge,{mode:"full"}),items=bundle.sections.flatMap(section=>section.items);
 expect(items.find(item=>item.id==="orama")?.status).not.toBe("confirmed");expect(items.find(item=>item.id==="no-phase")?.scope).toBeUndefined();
});
