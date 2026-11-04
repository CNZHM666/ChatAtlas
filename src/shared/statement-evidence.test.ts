import {expect,it} from "vitest";
import {statementEvidence,confirmsProposal,implementationRequest} from "./statement-evidence";
import {readProjectAssertion} from "./project-assertion";
import type {ConversationMessage} from "./types";
const original=(content:string,role:ConversationMessage["role"]="user",messageIndex=1):ConversationMessage=>({id:`m${messageIndex}`,conversationId:"c",content,role,messageIndex,createdAt:1,updatedAt:1,contentHash:"",preview:""});
it.each([
 ["用户确认采用浅色极简首页。","用户确认采用浅色极简首页。"],
 ["以下是粘贴的上下文材料，仅供参考：\n我确认采用分屏方案。","我确认采用分屏方案。"],
 ["以下是 AI 的建议：\n用户已经确认采用分屏方案。","用户已经确认采用分屏方案。"],
 ["> 我确认采用 SQLite。","我确认采用 SQLite。"],
 ["“我确认采用 SQLite。”","我确认采用 SQLite。"],
 ["这份材料写道：“我确认采用 SQLite。”","我确认采用 SQLite。"],
 ["用户已明确确认采用 SQLite。","确认采用 SQLite。"],
])("does not promote reference material to user approval: %s",(content,quote)=>{
 expect(statementEvidence(content,quote).explicitDecision).toBe(false);
 expect(readProjectAssertion([{message:original(content),quote}]).status).not.toBe("confirmed");
});
it("keeps an authored decision outside a quotation and after an explicit reference boundary",()=>{
 for(const content of ["> 用户确认采用旧方案。\n\n我决定采用 SQLite。","以下是上下文材料：\n用户确认采用旧方案。\n引用结束。\n我的决定：我确认采用 SQLite。"]){expect(readProjectAssertion([{message:original(content),quote:"我确认采用 SQLite。".replace("确认",content.includes("我决定")?"决定":"确认")}]).status).toBe("confirmed");}
 const content="“先用旧方案”只是引用，我决定采用 SQLite。";expect(statementEvidence(content,"我决定采用 SQLite。").explicitDecision).toBe(true);
 const correction="用户确认采用旧方案。我决定采用 SQLite。";expect(statementEvidence(correction,"我决定采用 SQLite。").explicitDecision).toBe(true);
});
it("does not attribute a quoted preference to the user",()=>{expect(statementEvidence("> 我喜欢卡片式首页。","我喜欢卡片式首页。").preference).toBe(false);});
it("retains partial user work reports and does not borrow the following sentence",()=>{
 const text="我已经完成电气校验界面，GPIO 冲突规则尚未实现。";
 expect(statementEvidence(text,text).report).toBe(true);expect(statementEvidence(text,text).plan).toBe(true);
 expect(statementEvidence("界面已完成。下一步计划开发规则。","界面已完成。").report).toBe(true);
 expect(statementEvidence("我已经完成界面，但其实尚未完成。","我已经完成界面，但其实尚未完成。").report).toBe(false);
 expect(statementEvidence("如果我已经完成界面，GPIO 规则尚未实现。","如果我已经完成界面，GPIO 规则尚未实现。").report).toBe(false);
});

it.each(["我喜欢使用卡片式首页这种设计，但还没有正式定案。","我更倾向使用侧边栏。","I prefer using a split panel."])("keeps preference distinct from approval: %s",text=>{
 expect(statementEvidence(text,text).preference).toBe(true);expect(statementEvidence(text,text).decision).toBe(false);expect(readProjectAssertion([{message:original(text),quote:text}]).status).toBe("preference");
});
it.each(["给我按照这一套设计一个提示词。","请使用推开式分屏方案写一个 prompt。","如果采用 SQLite，迁移会更容易吗？","你之前建议采用 SQLite。","就按第二种。"])("does not use an artifact request, attribution or unresolved deixis as a direct choice: %s",text=>{
 expect(statementEvidence(text,text).decision).toBe(false);
});
it("does not discard a real choice merely because the user also expresses preference",()=>{
 const text="我喜欢简洁界面，最终决定采用分屏方案。";expect(statementEvidence(text,text).explicitDecision).toBe(true);expect(readProjectAssertion([{message:original(text),quote:text}]).status).toBe("confirmed");
});
it("resolves a numbered option against the full real antecedent, not its clipped quote",()=>{
 const proposal=original("建议选择：\n方案一：只做全文检索。\n方案二：全文检索加可选向量召回。","assistant",0),approval=original("就按第二种。");
 expect(confirmsProposal(approval,approval.content,proposal,"全文检索加可选向量召回。")).toBe(true);
 expect(confirmsProposal(approval,approval.content,proposal,"只做全文检索。")).toBe(false);
 expect(confirmsProposal({...approval,content:"可以"},"可以",proposal,"只做全文检索。")).toBe(false);
 expect(confirmsProposal(approval,approval.content,{...proposal,content:"全文检索加可选向量召回。"})).toBe(false);
 expect(confirmsProposal({...approval,conversationId:"other"},approval.content,proposal,"全文检索加可选向量召回。")).toBe(false);
 expect(readProjectAssertion([{message:proposal,quote:"全文检索加可选向量召回。"}],[approval]).status).toBe("confirmed");
});
it("uses an explicit reply link across intervening messages but not unrelated nearby replies",()=>{
 const proposal=original("建议采用 IndexedDB。","assistant",0),approval={...original("可以", "user",4),replyToMessageId:proposal.id};
 expect(confirmsProposal(approval,"可以",proposal)).toBe(true);expect(confirmsProposal({...approval,replyToMessageId:"different"},"可以",proposal)).toBe(false);
});
it.each(["尚未完成 UI。","UI 已完成了吗？","你说 UI 已完成。","如果 UI 已完成，就发布。"])("rejects misleading clipped reports in their original sentence: %s",text=>{
 expect(statementEvidence(text,text.includes("已完成")?"已完成":text).report).toBe(false);
});

it.each(["帮我执行P0-P1优化", "可以帮我进行优化了", "请直接实现这个方案", "开始执行P0和P1", "Please implement this plan"])("links an explicit execution request to its exact adjacent plan: %s", content => {
 const proposal=original("建议按这个优化方案实施：\n1. P0 修复确认来源。\n2. P1 优化架构召回。", "assistant",0), approval=original(content);
 expect(implementationRequest(content)).toBe(true);
 expect(confirmsProposal(approval, content, proposal)).toBe(true);
 expect(statementEvidence(content,content).report).toBe(false);
 expect(confirmsProposal({...approval,messageIndex:4},content,proposal)).toBe(false);
 expect(confirmsProposal(approval,content,{...proposal,partial:true})).toBe(false);
});
it("accepts one numbered implementation plan but preserves phase and alternative boundaries",()=>{
 const proposal=original("建议按计划实施：\n1. P0 修复确认来源。\n2. P1 优化架构召回。\n3. P2 重构编辑器。","assistant",0),approval=original("帮我执行P0-P1优化");
 expect(confirmsProposal(approval,approval.content,proposal,"P0 修复确认来源。")).toBe(true);
 expect(confirmsProposal(approval,approval.content,proposal,"P1 优化架构召回。")).toBe(true);
 expect(confirmsProposal(approval,approval.content,proposal,"P2 重构编辑器。")).toBe(false);
 expect(confirmsProposal(approval,approval.content,proposal)).toBe(false);
 expect(confirmsProposal({...approval,content:"帮我执行另一个项目的P0-P1优化"},"帮我执行另一个项目的P0-P1优化",proposal,"P0 修复确认来源。")).toBe(false);
 const options={...proposal,content:"建议二选一：\n1. 使用 SQLite。\n2. 使用 IndexedDB。"};
 expect(confirmsProposal({...approval,content:"可以帮我进行优化了"},"可以帮我进行优化了",options,"使用 SQLite。")).toBe(false);
 expect(confirmsProposal({...approval,content:"可以"},"可以",{...proposal,content:"建议按计划实施：\n1. 修复确认来源。\n2. 优化架构召回。"})).toBe(true);
 expect(confirmsProposal({...approval,content:"可以"},"可以",{...proposal,content:"建议：\n1. 使用 SQLite。\n2. 使用 IndexedDB。"},"使用 SQLite。")).toBe(false);
});
it.each(["继续", "先别动代码，给我优化方案", "帮我优化一下提示词", "请实现这个方案可以吗？", "以下是AI建议：\n帮我执行P0-P1优化", "帮我执行P0-P1优化，但不要修改代码。"])("does not confuse quoted, generic or analysis-only instructions with implementation approval: %s",content=>{
 expect(implementationRequest(content)).toBe(false);
 const proposal=original("建议执行 P0-P1 优化。","assistant",0);
 expect(confirmsProposal(original(content),content,proposal)).toBe(false);
});
