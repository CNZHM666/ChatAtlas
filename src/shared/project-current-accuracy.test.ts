import { expect, it, vi } from "vitest";
import { projectSession } from "../test/project-fixture";
import { prepareManualWikiReview } from "../ai/wiki-manual-review";
import { projectIntroduction, projectKnowledgeView, projectKnowledgeSection } from "./project-knowledge-view";
import { projectSnapshot } from "./project-snapshot";
import { knowledgeBodyPresentation } from "./wiki-knowledge-prose";
import { sourceMessageSignature } from "./source-signature";
import type { WikiClaim } from "./wiki-claims";
import type { ConversationMessage } from "./types";

function scenario(rows:Array<{text:string;role?:"user"|"assistant";subject?:string;scope?:string;kind?:WikiClaim["overviewRole"];body?:string;conversation?:string}>){
 const session=projectSession();session.projectState=undefined;session.sections=[];session.evidence=[];session.sourceRoles={};session.sourceSignatures={};session.sourceMessageOrder={};
 const messages:ConversationMessage[]=rows.map((row,index)=>({id:`m${index}`,conversationId:row.conversation??"source",messageIndex:index,role:row.role??"user",content:row.text,createdAt:0,updatedAt:0,preview:"",contentHash:""}));
 session.sourceConversationIds=[...new Set(messages.map(message=>message.conversationId))];
 for(const [index,message] of messages.entries()){
  session.evidence.push({id:`e${index}`,conversationId:message.conversationId,messageId:message.id,title:"项目讨论",excerpt:message.content,sourceSignature:sourceMessageSignature(message.content)});
  (session.sourceRoles[message.conversationId]??={})[message.id]=message.role;
  (session.sourceSignatures[message.conversationId]??={})[message.id]=sourceMessageSignature(message.content);
  (session.sourceMessageOrder[message.conversationId]??=[]).push(message.id);
  session.sections.push({id:`s${index}`,title:rows[index].kind==="purpose"?"产品定位":"项目设计",body:rows[index].body??message.content,transition:"",kind:"finding",evidenceIds:[`e${index}`],claims:[{text:message.content,quote:message.content,evidenceIds:[`e${index}`],overviewRole:rows[index].kind,subject:rows[index].subject,scope:rows[index].scope}]});
 }
 return {session,messages};
}

it("separates accepted design from delivered work and excludes assistant completion claims",()=>{
 const {session,messages}=scenario([{text:"我决定采用本地索引方案。",kind:"decision",subject:"检索方案",scope:"V1"},{text:"我已经完成本地索引。",kind:"progress",subject:"检索实现",scope:"V1"},{text:"Milestone 2 的完成标志着架构稳定。",kind:"progress",role:"assistant",subject:"检索实现",scope:"V1"}]);
 const next=prepareManualWikiReview(session,messages),view=projectKnowledgeView(next);
 expect(view.facts[0]).toMatchObject({adoption:"accepted",implementation:"unknown"});expect(view.facts[1]).toMatchObject({implementation:"reported"});expect(view.facts[2]).toMatchObject({adoption:"proposed",implementation:"unknown"});
 expect(projectSnapshot(next).filter(block=>block.role==="status").map(block=>block.text).join(" ")).not.toContain("架构稳定");
 expect(projectKnowledgeSection(next.sections[2],next).body).toContain("（未核实）");
});

it("normalizes stage-axis aliases without treating a roadmap or module phase as overall progress",()=>{
 const {session,messages}=scenario([{text:"当前项目处于 M2 阶段。",kind:"stage",subject:"项目阶段",scope:"V0.1"},{text:"当前项目进入 M3 阶段。",kind:"stage",subject:"当前项目阶段",scope:"v0.1"},{text:"建议下一步进入 M4 阶段。",kind:"stage",role:"assistant",subject:"项目阶段",scope:"V0.1"},{text:"目前视觉识别处于 M1 阶段。",kind:"stage",subject:"视觉识别阶段",scope:"V0.1"}]);
 const view=projectKnowledgeView(prepareManualWikiReview(session,messages));
 expect(view.stages.map(fact=>fact.claim.text)).toEqual([messages[1].content,messages[3].content]);expect(view.conflicts).toHaveLength(0);
});

it("requires an explicit scoped replacement, and preserves complementary decisions for reconciliation",()=>{
 const {session,messages}=scenario([{text:"我决定采用 React 渲染界面。",kind:"decision",subject:"界面框架",scope:"V1"},{text:"我最终决定改用 Svelte 渲染界面。",kind:"decision",subject:"界面框架",scope:"V1"}]);
 let view=projectKnowledgeView(prepareManualWikiReview(session,messages));expect(view.facts[0].historical).toBe(true);expect(view.current.map(fact=>fact.claim.text)).toEqual([messages[1].content]);
 const other=scenario([{text:"我决定禁止市电模块。",kind:"constraint",subject:"安全要求",scope:"V1"},{text:"我决定禁止锂电池充放电。",kind:"constraint",subject:"安全要求",scope:"V1"}]);
 view=projectKnowledgeView(prepareManualWikiReview(other.session,other.messages));expect(view.facts.every(fact=>!fact.historical)).toBe(true);expect(view.conflicts).toHaveLength(1);
});

it("keeps platform credentials, BYOK, distinct scopes and unordered conversations separate",()=>{
 const {session,messages}=scenario([{text:"我决定平台 API Key 仅放服务端环境变量。",kind:"decision",subject:"密钥存储",scope:"V1"},{text:"我最终决定用户 BYOK API Key 仅存运行时内存。",kind:"decision",subject:"密钥存储",scope:"V1"},{text:"我决定采用模块化方案。",kind:"decision",subject:"架构",scope:"V1",conversation:"a"},{text:"我最终决定改用分层方案。",kind:"decision",subject:"架构",scope:"V1",conversation:"b"}]);
 const view=projectKnowledgeView(prepareManualWikiReview(session,messages));expect(view.facts.every(fact=>!fact.historical)).toBe(true);expect(view.conflicts).toHaveLength(1);expect(view.conflicts[0].facts.map(fact=>fact.sectionId)).toEqual(["s2","s3"]);
});

it("does not accept pasted approvals or a source change as verified delivery",()=>{
 const {session,messages}=scenario([{text:"以下是参考提示词：\n我已经完成全部测试。",kind:"progress",subject:"测试进度",scope:"V1"},{text:"我已经完成索引测试。",kind:"progress",subject:"索引测试",scope:"V1"}]);
 const next=prepareManualWikiReview(session,messages);expect(projectKnowledgeView(next).facts[0].implementation).toBe("unknown");
 next.sourceSignatures!.source.m1="changed";expect(projectKnowledgeView(next).facts[1]).toMatchObject({sourceChanged:true,status:"uncertain"});expect(projectSnapshot(next).some(block=>block.text.includes("索引测试"))).toBe(false);
});

it("uses a retained adjacent approval without turning the request into an implementation report",()=>{
 const {session,messages}=scenario([{text:"建议使用 IndexedDB 保存消息。",role:"assistant",kind:"decision",subject:"消息存储",scope:"V1"},{text:"可以帮我实现这个方案了。"}]);
 const next=prepareManualWikiReview(session,messages),fact=projectKnowledgeView(next).facts[0];
 expect(fact).toMatchObject({adoption:"accepted",implementation:"unknown"});expect(next.sections[0].claims![0].sourceReading!.sources.map(source=>source.id)).toEqual(["e0","e1"]);
 next.sourceSignatures!.source.m1="changed";expect(projectKnowledgeView(next).facts[0].adoption).toBe("unknown");
});

it("builds complete complementary introductions with provenance and never chooses a dangling competitor sentence",()=>{
 const {session,messages}=scenario([{text:"这是面向初学者的硬件设计工具，通过自然语言生成可理解的模块连接方案。",kind:"purpose"},{text:"用户可以从已有零件出发，确认缺件，再查看画布和接线要求。",kind:"purpose"}]);
 const network=vi.spyOn(globalThis,"fetch");try{
 const next=prepareManualWikiReview(session,messages),intro=projectIntroduction(next);expect(intro.text).toContain(messages[0].content);expect(intro.text).toContain(messages[1].content);expect(intro.evidenceIds).toEqual(["e0","e1"]);expect(next.brief!.summary).toBe(intro.text);expect(network).not.toHaveBeenCalled();
 next.sections.forEach(section=>section.claims=[]);next.sections[0].body="竞品流程很重，本项目的差异化在于：\n\n**硬件画布**面向初学者，通过自然语言生成模块连接方案，帮助用户理解硬件。";
 const fallback=projectIntroduction(next);expect(fallback.text).toContain("硬件画布");expect(fallback.text).not.toContain("差异化在于");
 next.projectMaintenance={overview:"用户亲自维护的说明："};expect(projectIntroduction(next).text).toBe("用户亲自维护的说明：");
 }finally{network.mockRestore();}
});

it("cleans the observed rating variants and qualifies table states without changing source quotes, code or real test counts",()=>{
 const input="当前版本成熟度评估达9/10，主要提升在于界面。\n\n目前视觉优化已基本完成，评分约为9/10。\n\nMilestone 2 的完成标志着底层架构稳定。\n\n| 模块 | 完成度估计 | 状态 |\n|---|---|---|\n| Canvas | ~90% | 冻结 |\n| Validator | N/A | 开发中 |\n\n回归测试结果为9/10，共177项测试。\n\n> 助手评价：成熟度9/10。\n\n```ts\nconst completed = true;\n```";
 const output=knowledgeBodyPresentation(input);expect(output).not.toContain("评分约为9/10");expect(output).not.toContain("成熟度评估达9/10");expect(output).not.toContain("~90%");expect(output).toContain("曾建议冻结");expect(output).toContain("（未核实）");expect(output).toContain("回归测试结果为9/10，共177项测试。");expect(output).toContain("> 助手评价：成熟度9/10。");expect(output).toContain("const completed = true;");expect(knowledgeBodyPresentation(output)).toBe(output);
});

it("preserves all unresolved decisions across local refresh, including missing originals, rather than closing them from omission",()=>{
 const {session,messages}=scenario([{text:"这是面向学生的项目知识工具，帮助复习与继续开发。",kind:"purpose"}]);
 const questions=Array.from({length:7},(_,index)=>`是否采用第${index+1}种存储策略？`);
 session.brief={summary:"旧的项目简介。",turningPoints:[],confirmed:[],openQuestions:questions};
 const next=prepareManualWikiReview(session,messages);
 expect(next.brief!.openQuestions).toEqual(questions);expect(projectKnowledgeView(next).questions).toHaveLength(7);expect(projectSnapshot(next).filter(block=>block.role==="questions")).toHaveLength(3);
});

it("does not let a future plan in the next sentence erase an explicit current-stage report",()=>{
 const {session,messages}=scenario([{text:"当前项目处于 M2 阶段。建议下一步进入 M3 阶段。",kind:"stage",subject:"项目阶段",scope:"V1"}]);
 session.sections[0].claims![0].text="当前项目处于 M2 阶段。";session.sections[0].claims![0].quote="当前项目处于 M2 阶段。";
 const next=prepareManualWikiReview(session,messages);expect(projectKnowledgeView(next).stages.map(fact=>fact.claim.text)).toEqual(["当前项目处于 M2 阶段。"]);
});

it("does not retain a generated resolved status after its settlement basis changes",()=>{
 const session=projectSession();session.projectState!.questions=[{id:"decision",text:"首版是否接入视觉识别？",reason:"",status:"superseded",quote:"首版是否接入视觉识别？",evidenceIds:["e1"],sourceBasisSignature:"old-source",matter:{state:"settled",subject:"首版视觉识别",settlement:{text:"先不接入",quote:"我决定先不接入",evidenceIds:["e1"]}}}];
 expect(projectKnowledgeView(session).questions.map(question=>question.text)).toContain("首版是否接入视觉识别？");
});

it("recovers an omitted current-stage tag from a literal user report, without changing the saved claim",()=>{
 const {session,messages}=scenario([{text:"当前项目处于 M2 阶段。",scope:"V1"},{text:"当前项目进入 M3 阶段。",scope:"V1"}]);
 const next=prepareManualWikiReview(session,messages),view=projectKnowledgeView(next);
 expect(view.stages.map(fact=>fact.claim.text)).toEqual([messages[1].content]);expect(next.sections[0].claims![0].overviewRole).toBeUndefined();
});

it("does not use a model scope label that contradicts the version in the original statement",()=>{
 const {session,messages}=scenario([{text:"当前项目 V0.2 处于 M3 阶段。",kind:"stage",subject:"项目阶段",scope:"V0.1"}]);
 const next=prepareManualWikiReview(session,messages);expect(projectKnowledgeView(next).stages).toHaveLength(0);expect(projectKnowledgeSection(next.sections[0],next).body).toContain("版本范围尚待核对");
});
