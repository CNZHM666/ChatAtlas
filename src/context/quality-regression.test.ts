import { expect, it, vi } from "vitest";
import { contextKnowledge } from "../test/context-fixture";
import { evolutionKnowledge } from "../test/evolution-fixture";
import { projectStateSignature, projectQuestionKey } from "../shared/project-state";
import { projectHistorySignature } from "../shared/project-history";
import { sourceMessageSignature } from "../shared/source-signature";
import { effectiveProjectEvolution } from "../shared/project-evolution";
import { confirmsProposal, statementEvidence } from "../shared/statement-evidence";
import { equivalentContextText } from "./content-equivalence";
import { buildProjectContext } from "./engine";
import { formatContext } from "./format";
import type { ContextOptions, ProjectKnowledge } from "./types";

const options:ContextOptions={zh:true,task:"",mode:"full",length:"detailed",sections:["overview","decisions","progress","next","wiki","history"]};
const items=(knowledge:ProjectKnowledge)=>buildProjectContext(knowledge,options).sections.flatMap(section=>section.items);
function original(knowledge:ProjectKnowledge,id:string,role:"user"|"assistant",content:string){
 const message={...knowledge.messages[0],id,role,content,messageIndex:knowledge.messages.length};knowledge.messages.push(message);
 knowledge.session.evidence.push({id,conversationId:"c",messageId:id,title:"相同项目标题",excerpt:content});
 knowledge.session.sourceSignatures!.c[id]=sourceMessageSignature(content);knowledge.session.sourceRoles!.c[id]=role;
 return message;
}
it.each(["ChatAtlas","Beacon 园艺记录"])("never turns %s assistant advice or a rewritten approval claim into a user decision",title=>{
 const knowledge=contextKnowledge();knowledge.session.title=title;knowledge.session.projectMaintenance={};
 const message=original(knowledge,"suggestion","assistant","我建议使用独立派生索引和增量更新机制。");
 knowledge.session.projectState!.decisions=[{id:"index",text:"用户已确认采用独立派生索引。",status:"documented",reason:"",quote:message.content,evidenceIds:["suggestion"]}];knowledge.session.projectState!.signature=projectStateSignature(knowledge.session);
 const bundle=buildProjectContext(knowledge,options),item=bundle.sections.flatMap(section=>section.items).find(item=>item.id==="index")!;
 expect(item.status).toBe("proposal");expect(item.quotes?.[0].text).toBe(message.content);
 expect(formatContext(bundle)).not.toContain("用户已确认采用独立派生索引");expect(item.sourceIds).toEqual([JSON.stringify(["c","suggestion"])]);
});
it("retains sourced explicit confirmation and replaces A with B while keeping A in history",()=>{
 const knowledge=evolutionKnowledge(),bundle=buildProjectContext(knowledge,options),decisions=bundle.sections.find(section=>section.kind==="decisions")!;
 expect(decisions.items.some(item=>item.status==="confirmed"&&item.text.includes("数据库使用 IndexedDB"))).toBe(true);
 expect(decisions.items.some(item=>item.text.includes("数据库使用 SQLite"))).toBe(false);
 expect(bundle.sections.find(section=>section.kind==="history")?.items.some(item=>item.text.includes("SQLite"))).toBe(true);
 expect(knowledge.session.projectHistoryAnalysis!.events).toHaveLength(5);
});
it("accepts short assent only with one adjacent unambiguous proposal",()=>{
 const proposal={content:"建议采用独立索引。",conversationId:"c",messageIndex:1};
 expect(confirmsProposal({content:"可以",conversationId:"c",messageIndex:2},"可以",proposal)).toBe(true);
 expect(confirmsProposal({content:"可以",conversationId:"c",messageIndex:4},"可以",proposal)).toBe(false);
 expect(confirmsProposal({content:"可以",conversationId:"c",messageIndex:2},"可以",{...proposal,content:"建议采用 A 或者 B？"})).toBe(false);
 expect(confirmsProposal({content:"确认采用 B。",conversationId:"c",messageIndex:2},"确认采用 B。",{...proposal,content:"建议使用 A。"})).toBe(false);
 expect(confirmsProposal({content:"确认采用 Firebase。",conversationId:"c",messageIndex:2},"确认采用 Firebase。",{...proposal,content:"建议使用 IndexedDB。"})).toBe(false);
 expect(confirmsProposal({content:"之前你建议采用索引吗？",conversationId:"c",messageIndex:2},"采用索引",proposal)).toBe(false);
});
it("uses a real short approval in the shared evolution projection, not just its message role",()=>{
 const knowledge=evolutionKnowledge(),analysis=knowledge.session.projectHistoryAnalysis!,message=knowledge.messages[0];
 message.role="assistant";message.content="建议数据库使用 SQLite。";analysis.events=analysis.events.slice(0,1);analysis.events[0].quote=message.content;
 knowledge.session.evidence[0].excerpt=message.content;knowledge.session.evidence[0].sourceSignature=sourceMessageSignature(message.content);analysis.evidence[0]={...knowledge.session.evidence[0]};analysis.sources[0]={...analysis.sources[0],role:"assistant",signature:sourceMessageSignature(message.content)};
 const approval=original(knowledge,"approval","user","可以");approval.messageIndex=1;approval.createdAt=message.createdAt!+1;
 analysis.evidence.push(knowledge.session.evidence.at(-1)!);analysis.events[0].confirmationQuote="可以";analysis.events[0].confirmationEvidenceIds=["approval"];analysis.signature=projectHistorySignature(knowledge.session);
 expect(effectiveProjectEvolution(knowledge.session,knowledge.messages)).toHaveLength(1);
 approval.messageIndex=3;expect(effectiveProjectEvolution(knowledge.session,knowledge.messages)).toHaveLength(0);
});
it.each(["M2 已完成了吗？","你建议 M2 已完成后再实现识别。","如果 M2 已完成，就可以发布。","M2 尚未完成。"]) ("does not infer completed work from the clipped user statement: %s",content=>{
 const knowledge=contextKnowledge();original(knowledge,"report","user",content);
 knowledge.session.sections.push({id:"work",title:"M2 进度",body:"M2 已完成",kind:"finding",transition:"",evidenceIds:["report"],claims:[{text:"M2 已完成",quote:content.includes("已完成")?"已完成":content,evidenceIds:["report"],verification:"supported",overviewRole:"progress",workStatus:"reported"}]});
 const item=items(knowledge).find(item=>item.id==="wiki-brief:work:0")!;expect(item.status).not.toBe("reported");expect(item.status).not.toBe("confirmed");
});
it("uses the actual user completion report without asserting repository or test verification",()=>{
 const knowledge=contextKnowledge();const message=original(knowledge,"report","user","我已经完成 M2 的 Demo，代码和测试尚未核验。");
 knowledge.session.sections.push({id:"work",title:"M2",body:message.content,kind:"finding",transition:"",evidenceIds:["report"],claims:[{text:"用户报告 M2 Demo 完成",quote:message.content,evidenceIds:["report"],verification:"supported",overviewRole:"progress",workStatus:"reported"}]});
 const item=items(knowledge).find(item=>item.id==="wiki-brief:work:0")!;expect(item.status).toBe("reported");expect(item.quotes?.[0].text).toBe(message.content);expect(formatContext(buildProjectContext(knowledge,options))).not.toContain("测试已通过");
});
it("deduplicates fact-equivalent Wiki introductions without collapsing changed numbers, constraints or personal prose",()=>{
 const knowledge=contextKnowledge(),body="这款工具面向学生，帮助用户找回历史 AI 讨论，并在新的 AI 对话中继续项目工作。";
 knowledge.session.sections=[{...knowledge.session.sections[0],id:"position",title:"核心定位",body},{...knowledge.session.sections[0],id:"value",title:"产品定位与价值",body:body.replace("这款工具","这个工具")},{...knowledge.session.sections[0],id:"constraint",title:"范围",body:body+"必须保留全部原始消息。"},{...knowledge.session.sections[0],id:"personal",title:"个人编辑",body,origin:"user"}];
 const bundle=buildProjectContext(knowledge,{...options,sections:["wiki"]});expect(bundle.sections[0].items).toHaveLength(3);
 expect(bundle.sections[0].items.some(item=>item.text.includes("必须保留全部原始消息"))).toBe(true);expect(knowledge.session.sections).toHaveLength(4);
});
it("does not describe resolved questions or every historical question as current blockers",()=>{
 const knowledge=contextKnowledge(),text="数据库是否需要备份？",key=projectQuestionKey(text);
 knowledge.session.projectMaintenance!.questions={[key]:{text,originalText:text,resolved:true,matterStatus:"resolved",resolution:"保留本地备份导出"}};
 const textPack=formatContext(buildProjectContext(knowledge,options));expect(textPack).not.toContain("开放问题：数据库是否需要备份");expect(textPack).not.toContain("历史问题（当前是否仍待解决未知）：数据库是否需要备份");
 knowledge.session.projectMaintenance!.questions={};expect(formatContext(buildProjectContext(knowledge,options))).toContain("历史问题（当前是否仍待解决未知）");
});
it("creates an overview without inventing a task and local task handoff uses the same originals",()=>{
 const knowledge=contextKnowledge(),copy=structuredClone(knowledge),fetch=vi.spyOn(globalThis,"fetch");
 const panorama=buildProjectContext(knowledge,options);expect(panorama.purpose).toBe("overview");expect(formatContext(panorama)).not.toContain("## 当前任务");
 const task=buildProjectContext(knowledge,{...options,mode:"task",task:"调整侧边栏按钮"});expect(task.purpose).toBe("task");expect(formatContext(task)).toContain("## 当前任务");expect(task.sources.some(source=>source.messageId==="m-db")).toBe(false);
 expect(knowledge).toEqual(copy);expect(fetch).not.toHaveBeenCalled();fetch.mockRestore();
});
it("preserves literal roles, IDs and bounded quotations; mismatched record quotations are rejected",()=>{
 const knowledge=contextKnowledge();knowledge.session.projectState!.decisions[0].quote="另一条消息中的内容";
 const bundle=buildProjectContext(knowledge,options);expect(bundle.sections.flatMap(section=>section.items).some(item=>item.id==="db")).toBe(false);
 for(const source of bundle.sources){const original=knowledge.messages.find(message=>message.id===source.messageId)!;expect(source.role).toBe(original.role);expect(source.conversationId).toBe(original.conversationId);for(const excerpt of source.excerpts??[])expect(original.content).toContain(excerpt);}
 const block="确实存在的原文。".repeat(40);original(knowledge,"long","user",block);knowledge.session.sections.push({...knowledge.session.sections[0],id:"long",body:block,evidenceIds:["long"]});
 const text=formatContext(buildProjectContext(knowledge,{...options,sections:["wiki"]}));expect(text).toContain("完整消息保留在 ChatAtlas");expect(text).not.toContain(block.slice(0,180)+"\n\n（以上");
});
it("rejects quotation clipping, attribution and code examples locally",()=>{
 expect(statementEvidence("之前你建议使用 IndexedDB 吗？","使用 IndexedDB").decision).toBe(false);
 expect(statementEvidence("```txt\nM2 已完成\n```","M2 已完成").report).toBe(false);
 expect(statementEvidence("确认改用 IndexedDB。","改用 IndexedDB").decision).toBe(true);
});

it("does not let an uncertain Wiki retelling downgrade a maintained decision",()=>{
 const knowledge=contextKnowledge();knowledge.session.sections[0].body="数据库使用 IndexedDB";knowledge.session.sections[0].claims=[{text:"数据库使用 IndexedDB",quote:knowledge.messages[0].content,evidenceIds:["e-db"],overviewRole:"decision",verification:"supported"}];
 knowledge.session.projectState!.signature=projectStateSignature(knowledge.session);
 const bundle=buildProjectContext(knowledge,options),decision=bundle.sections.find(section=>section.kind==="decisions")!.items.find(item=>item.id==="db")!;expect(decision.status).toBe("confirmed");expect(decision.confirmationBasis).toBe("atlas");
});

it("never merges opposite negation or reversed execution order merely because most words overlap",()=>{
 const prefix="该工具管理跨平台讨论、项目知识与任务上下文，并保留原始证据。".repeat(4);
 expect(equivalentContextText(prefix+"支持自动同步。",prefix+"不支持自动同步。")).toBe(false);
 expect(equivalentContextText(prefix+"消息读取索引。",prefix+"索引读取消息。")).toBe(false);
});
