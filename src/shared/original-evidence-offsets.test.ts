import {expect,it} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {evidenceQuoteRange,evidenceRoleWarnings,originalEvidenceHighlights} from "./original-evidence-highlights";
import {sourceMessageSignature} from "./source-signature";

it("retains offsets at the repeated quotation nearest the saved excerpt",()=>{
 const content="早先：可以。\n\n最终方案：可以。保留本地数据。";
 const range=evidenceQuoteRange(content,"可以。","最终方案：可以。保留本地数据。");
 expect(range?.start).toBe(content.lastIndexOf("可以。"));
 expect(evidenceQuoteRange(content,"可以。","")?.start).toBe(content.indexOf("可以。"));
});
it("labels only exact claim quotes as strong highlights and lexical suggestions as related",()=>{
 const {session,messages}=contextKnowledge(),message=messages[1],ref=session.evidence[1];
 session.projectState=undefined;message.content="背景。Hardware IR 定义模块连接。";ref.sourceSignature=sourceMessageSignature(message.content);ref.excerpt=message.content;
 session.sections=[{...session.sections[0],evidenceIds:[ref.id],claims:[{text:"模块连接",quote:"Hardware IR 定义模块连接。",evidenceIds:[ref.id]}]}];
 const marks=originalEvidenceHighlights(session,ref,message,undefined,{sectionId:session.sections[0].id});
 expect(marks.filter(mark=>mark.kind==="quote").map(mark=>message.content.slice(mark.start,mark.end))).toEqual(["Hardware IR 定义模块连接。"]);
 expect(marks[0].claimIndex).toBe(0);
 session.sections[0].claims=[];
 expect(originalEvidenceHighlights(session,ref,message,undefined,{focus:"Hardware IR 模块连接"}).every(mark=>mark.kind==="related")).toBe(true);
});
it("keeps short quote context separate and refuses a missing explicit quote",()=>{
 const {session,messages}=contextKnowledge(),message=messages[1],ref=session.evidence[1];
 message.content="最终确认：可以。其他说明。";ref.sourceSignature=sourceMessageSignature(message.content);ref.excerpt=message.content;
 const marks=originalEvidenceHighlights(session,ref,message,"可以。");
 expect(marks.find(mark=>mark.kind==="quote")).toMatchObject({start:5,end:8});expect(marks.some(mark=>mark.kind==="context")).toBe(true);
 expect(originalEvidenceHighlights(session,ref,message,"不存在")).toEqual([]);
});
it("R1 warns only when a decision has exclusively assistant quotation sources",()=>{
 const {messages,session}=contextKnowledge(),ref=session.evidence[1],message=messages[1];
 const claim={text:"用户已确认选择本地存储",quote:message.content,evidenceIds:[ref.id]};
 expect(evidenceRoleWarnings(claim,[message],[ref])).toContain("assistant-decision");
 expect(evidenceRoleWarnings(claim,[{...message,role:"user"}],[ref])).not.toContain("assistant-decision");
 expect(evidenceRoleWarnings({...claim,text:"可选方案"},[message],[ref])).not.toContain("assistant-decision");
 expect(evidenceRoleWarnings({...claim,text:"可选方案"},[message],[ref],true)).toContain("assistant-decision");
});
it("R2 detects earlier pasted AI prose but never original user prose or a later reply",()=>{
 const {messages,session}=contextKnowledge(),ref=session.evidence[0],message=messages[0],quote="采用本地存储可以保留原始讨论并方便以后恢复阅读上下文。";
 const user={...message,content:quote,messageIndex:2},earlier={...message,id:"earlier",role:"assistant" as const,content:quote,messageIndex:1};
 const claim={text:"用户确认",quote,evidenceIds:[ref.id]};
 expect(evidenceRoleWarnings(claim,[earlier,user],[ref])).toContain("pasted-ai");
 expect(evidenceRoleWarnings(claim,[user],[ref])).not.toContain("pasted-ai");
 expect(evidenceRoleWarnings(claim,[user,{...earlier,messageIndex:3}],[ref])).not.toContain("pasted-ai");
});
it("R3 flags completed claims grounded only in advice, with negative and user-report controls",()=>{
 const {messages,session}=contextKnowledge(),ref=session.evidence[1],message=messages[1];
 const claim={text:"已完成本地存储",quote:message.content,evidenceIds:[ref.id]};
 expect(evidenceRoleWarnings(claim,[message],[ref])).toContain("unproven-completion");
 expect(evidenceRoleWarnings(claim,[{...message,role:"user"}],[ref])).not.toContain("unproven-completion");
 expect(evidenceRoleWarnings({...claim,text:"尚未完成本地存储"},[message],[ref])).not.toContain("unproven-completion");
 const plan={...message,role:"user" as const,content:"计划先接入本地存储"};expect(evidenceRoleWarnings({...claim,quote:plan.content},[plan],[ref])).toContain("unproven-completion");
});
