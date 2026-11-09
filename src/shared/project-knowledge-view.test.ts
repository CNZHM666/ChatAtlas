import {expect,it,vi} from "vitest";
import {projectSession} from "../test/project-fixture";
import {prepareManualWikiReview} from "../ai/wiki-manual-review";
import {knowledgeFactText,projectKnowledgeIntroduction,projectKnowledgeSection,projectKnowledgeView,relatedProjectFacts,type ProjectKnowledgeFact} from "./project-knowledge-view";
import {projectSnapshot} from "./project-snapshot";
import {projectOverviewText} from "../canvas/project-overview";
import {sourceMessageSignature} from "./source-signature";
import {validateWikiClaims,type WikiClaim} from "./wiki-claims";
import type {ConversationMessage} from "./types";
import {knowledgeBodyPresentation} from "./wiki-knowledge-prose";

function fixture(){
 const session=projectSession();session.projectState=undefined;
 const texts=["这是面向创客的硬件画布。","当前项目处于M2阶段。","当前项目进入M3阶段。","建议下一步进入M4阶段。"];
 const originals:ConversationMessage[]=texts.map((content,index)=>({id:`m${index}`,conversationId:"source",messageIndex:index,role:index===3?"assistant":"user",content,preview:"",contentHash:"",createdAt:0,updatedAt:0}));
 session.evidence=originals.map((message,index)=>({id:`e${index}`,conversationId:"source",messageId:message.id,title:"开发讨论",excerpt:message.content,sourceSignature:sourceMessageSignature(message.content)}));
 session.sourceRoles={source:Object.fromEntries(originals.map(message=>[message.id,message.role]))};session.sourceSignatures={source:Object.fromEntries(originals.map(message=>[message.id,sourceMessageSignature(message.content)]))};session.sourceMessageOrder={source:originals.map(message=>message.id)};
 session.sections=originals.map((message,index)=>({id:`s${index}`,title:index===0?"产品定位":"开发路径",body:message.content,kind:"finding",transition:"",evidenceIds:[`e${index}`],claims:[{text:message.content,quote:message.content,evidenceIds:[`e${index}`],overviewRole:index===0?"scope":"stage",subject:index===0?"产品定位":"项目阶段",scope:"V0.1",...(index===3?{workStatus:"planned" as const}:{})}]}));
 return {session,originals};
}

it("keeps unresolved versioned alternatives in rewrite navigation without asserting adoption or changing facts",()=>{
 const {session}=fixture(),page=session.sections[0];
 page.claims=[
  {text:"V1 计划仅导入 ChatGPT。",quote:"计划仅导入 ChatGPT。",evidenceIds:["e0"],verification:"uncertain",subject:"导入范围",scope:"V1",workStatus:"planned"},
  {text:"未来考虑导入多个平台。",quote:"考虑导入多个平台。",evidenceIds:["e0"],verification:"uncertain",subject:"导入范围",scope:"未来",workStatus:"proposed"},
 ];
 session.sections=[page];
 const before=structuredClone(session),context=relatedProjectFacts(session,page.id,"导入范围");
 expect(context.facts).toHaveLength(2);
 expect(context.facts.map(fact=>fact.scope)).toEqual(["V1","未来"]);
 expect(context.facts.every(fact=>fact.status==="uncertain"&&fact.adoption!=="accepted"&&fact.implementation!=="reported")).toBe(true);
 expect(context.coverage).toEqual({included:2,omitted:0});expect(session).toEqual(before);
});
it("projects one current stage and the same introduction into saved Brief, overview and context, without model calls",()=>{
 const {session,originals}=fixture();session.brief={summary:"来自第一个写作批次的独立摘要",confirmed:[],turningPoints:[],openQuestions:["旧的悬空问题？"]};
 const network=vi.spyOn(globalThis,"fetch");try{
 const next=prepareManualWikiReview(session,originals),view=projectKnowledgeView(next);
 expect(view.stages.map(fact=>fact.claim.text)).toEqual(["当前项目进入M3阶段。"]);expect(view.facts.find(fact=>fact.sectionId==="s1")?.historical).toBe(true);
 expect(next.brief!.summary).toBe(projectKnowledgeIntroduction(next));expect(projectOverviewText(next)).toBe(next.brief!.summary);expect(next.brief!.summary).not.toContain("独立摘要");expect(next.brief!.openQuestions).toEqual(["旧的悬空问题？"]);
 expect(projectKnowledgeSection(next.sections[1],next).body).toContain("此前的阶段记录");expect(projectSnapshot(next).filter(block=>block.role==="status")[0].text).toContain("M3");expect(network).not.toHaveBeenCalled();expect(session.brief.summary).toContain("独立摘要");
 }finally{network.mockRestore();}
});
it("does not replace stages in another version, from an AI plan or with unknown conversation order",()=>{
 const {session,originals}=fixture();session.sections[2].claims![0].scope="V0.2";let next=prepareManualWikiReview(session,originals);
 expect(projectKnowledgeView(next).stages).toHaveLength(2);expect(projectSnapshot(next).filter(block=>block.role==="status").map(block=>block.text).join(" ")).toMatch(/V0.1.*V0.2/u);expect(projectKnowledgeView(next).conflicts).toHaveLength(0);
 session.sections[2].claims![0].scope="V0.1";originals[2].conversationId="other";session.evidence[2].conversationId="other";session.sourceConversationIds.push("other");session.sourceRoles!.other={m2:"user"};session.sourceSignatures!.other={m2:sourceMessageSignature(originals[2].content)};
 next=prepareManualWikiReview(session,originals);expect(projectKnowledgeView(next).stages).toHaveLength(2);
});
it("recognizes a report beyond the 240-character excerpt, invalidates changed sources and never accepts model-owned receipts",()=>{
 const {session,originals}=fixture(),text="已完成本地检索。";originals[1].content="已有背景。".repeat(100)+"我已经完成本地检索。";
 session.evidence[1].excerpt=originals[1].content.slice(0,240);session.evidence[1].sourceSignature=sourceMessageSignature(originals[1].content);session.sourceSignatures!.source.m1=session.evidence[1].sourceSignature;
 session.sections[1].body=text;session.sections[1].claims=[{text,quote:"我已经完成本地检索。",evidenceIds:["e1"],overviewRole:"progress",workStatus:"reported"}];
 const next=prepareManualWikiReview(session,originals);expect(projectKnowledgeSection(next.sections[1],next).body).toBe("用户报告："+text);
 next.sourceSignatures!.source.m1="changed";next.evidence[1].sourceSignature="changed";expect(projectKnowledgeSection(next.sections[1],next).body).toContain("（未核实）");
 const parsed=validateWikiClaims([{...next.sections[1].claims![0],sourceReading:{status:"reported",reported:true}}],["e1"])![0];expect(parsed.sourceReading).toBeUndefined();
});
it("qualifies unsupported completion, removes subjective maturity scores, and preserves actual code, quotes and metrics",()=>{
 const body="系统建立了E2E BenchKit测试套件。\n\n最终评估UI成熟度达9/10分，建议锁定主框架。\n\n回归测试结果为9/10。\n\n```ts\nconst completed = true;\n```\n\n> 用户原文：我已经完成测试。";
 const result=knowledgeBodyPresentation(body);expect(result).toContain("（未核实）");expect(result).not.toContain("成熟度达9/10");expect(result).toContain("建议锁定主框架");expect(result).toContain("测试结果为9/10");expect(result).toContain("const completed = true;");expect(result).toContain("> 用户原文：我已经完成测试。");expect(knowledgeBodyPresentation(result)).toBe(result);
 const {session}=fixture();const personal={...session.sections[0],body,userEdited:true};expect(projectKnowledgeSection(personal,session)).toBe(personal);
});
it("does not let a clipped supported clause or a future instruction certify adjacent completion",()=>{
 const claim:WikiClaim={text:"目录存在",quote:"目录存在",evidenceIds:["e1"]};
 const result=knowledgeBodyPresentation("目录存在，系统已经完成全部测试，必须继续开发。",[claim],true,()=>({reported:true}));
 expect(result).toContain("（未核实）");
});

it("does not use import timestamps to order unrelated conversations",()=>{
 const {session,originals}=fixture();
 originals[1].createdAt=1700000000000;originals[2].createdAt=1800000000000;originals[2].conversationId="other";
 session.evidence[2].conversationId="other";session.sourceConversationIds.push("other");session.sourceRoles!.other={m2:"user"};session.sourceSignatures!.other={m2:sourceMessageSignature(originals[2].content)};
 const next=prepareManualWikiReview(session,originals);expect(projectKnowledgeView(next).stages).toHaveLength(2);
 originals[1].sourceCreatedAt=1700000000000;originals[2].sourceCreatedAt=1800000000000;
 expect(projectKnowledgeView(prepareManualWikiReview(session,originals)).stages.map(fact=>fact.claim.text)).toEqual(["当前项目进入M3阶段。"]);
});

it("keeps attributed UI advice in the Wiki while projecting a concise qualified purpose, preserving personal overviews",()=>{
 const {session}=fixture(),purpose="这是面向创客的工具，帮助维护长期项目。首版只使用用户确认的来源。";
 const body=purpose+"助手建议新增独立的 Memory 页面。";
 session.sections=[{...session.sections[0],body,claims:[{text:body,quote:body,evidenceIds:["e0"],overviewRole:"purpose",verification:"uncertain"}]}];
 const before=structuredClone(session);
 expect(projectKnowledgeIntroduction(session)).toBe(purpose);expect(session).toEqual(before);
 session.sections[0].claims!.push({...session.sections[0].claims![0],text:purpose+"助手建议使用现有导出按钮。"});expect(projectKnowledgeIntroduction(session)).toBe(purpose);
 session.projectMaintenance={...session.projectMaintenance,overview:body};expect(projectKnowledgeIntroduction(session)).toBe(body);
});

it("does not let prose claim a user confirmation that the sources read as an AI proposal",async()=>{
 const {groundWikiClaims}=await import("./wiki-claims");
 const session=projectSession();session.projectState=undefined;
 const proposal="我建议采用 Orama 作为搜索引擎。",rule="只有用户确认后才保存搜索记录。";
 const originals:ConversationMessage[]=[{id:"m0",conversationId:"source",messageIndex:0,role:"assistant",content:proposal,preview:"",contentHash:"",createdAt:0,updatedAt:0},{id:"m1",conversationId:"source",messageIndex:1,role:"assistant",content:rule,preview:"",contentHash:"",createdAt:0,updatedAt:0}];
 session.evidence=originals.map((message,index)=>({id:`e${index}`,conversationId:"source",messageId:message.id,title:"搜索",excerpt:message.content,sourceSignature:sourceMessageSignature(message.content)}));
 session.sourceRoles={source:{m0:"assistant",m1:"assistant"}};session.sourceSignatures={source:Object.fromEntries(originals.map(message=>[message.id,sourceMessageSignature(message.content)]))};session.sourceMessageOrder={source:["m0","m1"]};
 const claimed="用户已确认采用 Orama 作为搜索引擎。";
 session.sections=groundWikiClaims([{id:"s0",title:"搜索",body:`${claimed}\n\n${rule}`,kind:"finding",transition:"",evidenceIds:["e0","e1"],claims:[{text:claimed,quote:proposal,evidenceIds:["e0"],workStatus:"proposed"},{text:rule,quote:rule,evidenceIds:["e1"]}]}],session.evidence,originals,true);
 expect(session.sections[0].claims?.[0].sourceReading?.status).toBe("proposal");
 const body=projectKnowledgeSection(session.sections[0],session).body;
 expect(body).not.toContain("用户已确认");
 expect(body).toContain("讨论建议（未发现用户确认）：采用 Orama 作为搜索引擎。");
 // A described rule mentioning confirmation is not a claimed decision.
 expect(body).toContain(rule); expect(body).not.toContain(`：${rule}`);
});

it("labels a project's chosen approach and proposal, and leaves a learning record's points as they are",()=>{
 const fact=(adoption:string,status:string,text:string)=>({claim:{text,quote:text,evidenceIds:[]},adoption,status,implementation:"unknown"}) as unknown as ProjectKnowledgeFact;
 expect(knowledgeFactText(fact("accepted","confirmed","能独立完成新建分支并创建 Pull Request。"))).toBe("已选择的方案：能独立完成新建分支并创建 Pull Request。");
 expect(knowledgeFactText(fact("accepted","confirmed","能独立完成新建分支并创建 Pull Request。"),true,undefined,true)).toBe("能独立完成新建分支并创建 Pull Request。");
 expect(knowledgeFactText(fact("unknown","proposal","Git 是本地版本控制工具。"),true,undefined,true)).toBe("Git 是本地版本控制工具。");
});
