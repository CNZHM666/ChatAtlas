import type {FocusSession} from "../shared/focus-session";
import type {WikiClaim} from "../shared/wiki-claims";
import {groundWikiClaims} from "../shared/wiki-claims";
import type {ConversationMessage} from "../shared/types";
import {sourceMessageSignature} from "../shared/source-signature";
import {projectKnowledgeView,projectKnowledgeSection} from "../shared/project-knowledge-view";
import {validateMatterAssessment} from "../shared/project-matter-assessment";
import type {ProjectLocalCheck} from "./project-local-checks";

/** Fictional cross-domain cases run through the production rules. They exercise
 * local consistency, not model quality, and never create projects or requests. */
export function knowledgeCheckScenario(rows:Array<{text:string;role?:"user"|"assistant";subject?:string;scope?:string;kind?:WikiClaim["overviewRole"];relation?:WikiClaim["relation"];body?:string;formulations?:string[]}>){
 const messages:ConversationMessage[]=rows.map((row,index)=>({id:`m${index}`,conversationId:"knowledge-check",messageIndex:index,role:row.role??"user",content:row.text,createdAt:0,updatedAt:0,preview:"",contentHash:""}));
 const session:FocusSession={id:"isolated-knowledge-check",title:"内存样例",mode:"work",goal:"检查本地知识规则",locale:"zh-CN",knowledgeViewVersion:1,sourceConversationIds:["knowledge-check"],sourceRoles:{"knowledge-check":Object.fromEntries(messages.map(message=>[message.id,message.role]))},sourceSignatures:{"knowledge-check":Object.fromEntries(messages.map(message=>[message.id,sourceMessageSignature(message.content)]))},sourceMessageOrder:{"knowledge-check":messages.map(message=>message.id)},evidence:messages.map((message,index)=>({id:`e${index}`,conversationId:message.conversationId,messageId:message.id,title:"虚构样例",excerpt:message.content,sourceSignature:sourceMessageSignature(message.content)})),sections:rows.map((row,index)=>({id:`s${index}`,title:row.subject??"项目知识",body:row.body??row.text,kind:"finding",transition:"",evidenceIds:[`e${index}`],claims:[{text:row.text,quote:row.text,evidenceIds:[`e${index}`],subject:row.subject,scope:row.scope,overviewRole:row.kind,relation:row.relation,formulations:row.formulations}]})),activeSectionId:"s0",completedSectionIds:[],notes:"",createdAt:1,updatedAt:1};
 session.sections=groundWikiClaims(session.sections,session.evidence,messages,true);
 return {session,messages};
}
export function runKnowledgeLocalChecks(zh=true):ProjectLocalCheck[]{
 const l=(cn:string,en:string)=>zh?cn:en;
 const cases:Array<[string,string,()=>boolean]>=[
  ["K01",l("学习工具：批准计划不等于完成","Learning tool: approval is not delivery"),()=>{
   const {session}=knowledgeCheckScenario([{text:"我决定采用间隔复习。",subject:"复习策略",scope:"V1",kind:"decision"},{text:"间隔复习已经全部实现。",role:"assistant",subject:"复习策略",scope:"V1",kind:"progress"}]);const facts=projectKnowledgeView(session).facts;
   return facts[0].adoption==="accepted"&&facts.every(fact=>fact.implementation!=="reported");
  }],
  ["K02",l("笔记工具：补充导出格式不作废原格式","Notes tool: an added format preserves the original"),()=>{
   const first="我决定支持 JSON 导出笔记。";const {session}=knowledgeCheckScenario([{text:first,kind:"decision",subject:"导出格式",scope:"V1"},{text:"另外我决定支持 Markdown 导出笔记。",kind:"decision",subject:"笔记导出",scope:"V1",relation:{kind:"supplements",targetQuote:first}}]);const view=projectKnowledgeView(session);
   return view.relations.length===1&&view.facts.every(fact=>!fact.historical&&!fact.contested);
  }],
  ["K03",l("应用架构：明确替代可关联不同表述","Application: explicit replacement links aliases"),()=>{
   const first="我决定使用 React 渲染界面。";const {session}=knowledgeCheckScenario([{text:first,kind:"decision",subject:"界面框架",scope:"V1"},{text:"我最终决定改用 Svelte 渲染界面。",kind:"decision",subject:"UI渲染方案",scope:"V1",relation:{kind:"replaces",targetQuote:first}}]);
   return projectKnowledgeView(session).facts[0].historical;
  }],
  ["K04",l("密钥设计：平台凭据与用户 BYOK 分开","Credentials: platform keys and BYOK remain distinct"),()=>{
   const {session}=knowledgeCheckScenario([{text:"我决定平台 API Key 仅放服务端。",kind:"decision",subject:"密钥存储",scope:"V1"},{text:"我最终决定用户 BYOK API Key 仅存运行时。",kind:"decision",subject:"密钥存储",scope:"V1"}]);return projectKnowledgeView(session).facts.every(fact=>!fact.historical&&!fact.contested);
  }],
  ["K05",l("项目事项：无关完成报告不能关闭存储决策","Matters: an unrelated report cannot close a storage decision"),()=>{
   const {session,messages}=knowledgeCheckScenario([{text:"V1 采用本地存储还是云数据库？"},{text:"我已经完成欢迎页面。"}]);
   const result=validateMatterAssessment({state:"settled",subject:"存储方案",scope:"V1",settlement:{text:messages[1].content,quote:messages[1].content,evidenceIds:["e1"]}},{quote:messages[0].content,evidenceIds:["e0"]},messages.map((message,index)=>({id:`e${index}`,text:message.content,role:message.role,conversationId:message.conversationId,messageId:message.id,messageIndex:message.messageIndex})),session);
   return result?.state==="open";
  }],
  ["K06",l("正文一致性：保留细节并标明旧方案","Prose: preserve detail while qualifying an old choice"),()=>{
   const first="我决定使用 React 渲染界面。",prose="界面采用 React，组件按页面组织。";
   const {session}=knowledgeCheckScenario([{text:first,kind:"decision",subject:"界面框架",scope:"V1",body:prose,formulations:[prose]},{text:"我最终决定改用 Svelte 渲染界面。",kind:"decision",subject:"界面框架",scope:"V1"}]);
   return projectKnowledgeSection(session.sections[0],session).body.includes("此前记录："+prose);
  }],
 ];
 return cases.map(([id,title,run])=>{const started=performance.now();try{if(!run())throw Error(l("预期未满足，请核对对应的来源与状态规则。","Expectation failed; review the corresponding source/state rule."));return {id,title,passed:true,durationMs:performance.now()-started,detail:l("本地规则通过；真实模型输出需另行核对。","Local rule passed; actual model output needs separate review.")};}catch(error){return {id,title,passed:false,durationMs:performance.now()-started,detail:error instanceof Error?error.message:String(error)};}});
}
