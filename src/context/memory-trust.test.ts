import {expect,it,vi} from "vitest";
import {memoryQualityFixture,memoryQualityOptions} from "../test/memory-quality-fixture";
import {evolutionKnowledge} from "../test/evolution-fixture";
import {sourceMessageSignature} from "../shared/source-signature";
import {projectStateSignature,projectQuestionKey} from "../shared/project-state";
import {projectHistorySignature} from "../shared/project-history";
import {retainedProjectKnowledge} from "../shared/retained-project-knowledge";
import {buildProjectContext} from "./engine";
import {formatContext} from "./format";
import {contextProjectSignature} from "./knowledge";

it("exports preferences, actual choices and work reports with their complete original qualifications",()=>{
 const knowledge=memoryQualityFixture(),before=structuredClone(knowledge),bundle=buildProjectContext(knowledge,memoryQualityOptions),text=formatContext(bundle),items=bundle.sections.flatMap(section=>section.items);
 expect(text).toContain("用户偏好（不代表定案）");expect(text).not.toContain("团队确认了卡片式首页作为正式设计基准");expect(text).not.toContain("最终确定 Transformers.js");
 expect(items.find(item=>item.id==="choice:storage")?.status).toBe("confirmed");
 expect(items.find(item=>item.id==="choice:search")?.status).toBe("confirmed");expect(text).not.toContain("方案一：只做 Orama 全文检索。");expect(text).toContain("方案二：保留 Orama 全文检索，增加可选语义召回。");expect(text).toContain("就按第二种。");
 expect(bundle.sections.find(section=>section.kind==="progress")?.items.some(item=>item.status==="reported")).toBe(true);expect(text).toContain("索引更新仍未开发，测试尚未执行");expect(text).not.toContain("未找到可用的当前进度记录");expect(knowledge).toEqual(before);
});
it("never upgrades assistant-only advice or a prompt request into adoption",()=>{
 const knowledge=memoryQualityFixture();knowledge.messages=knowledge.messages.filter(message=>message.id!=="approval");
 const bundle=buildProjectContext(knowledge,memoryQualityOptions);
 expect(bundle.sections.flatMap(section=>section.items).find(item=>item.id==="choice:search")?.status).toBe("proposal");
 expect(bundle.sections.flatMap(section=>section.items).find(item=>item.id==="choice:layout")?.status).toBe("preference");
});
it("does not accept a short approval after its original antecedent changed",()=>{
 const knowledge=memoryQualityFixture();knowledge.messages.find(message=>message.id==="options")!.content="只有另一个无关的提议。";
 const text=formatContext(buildProjectContext(knowledge,memoryQualityOptions));expect(text).not.toContain("保留 Orama 全文检索，增加可选语义召回");
});
it("retains the full conditions of user reports instead of exporting an inflated Wiki completion claim",()=>{
 const knowledge=memoryQualityFixture(),claim=knowledge.session.sections[2].claims![0];
 claim.text="整个系统代码已验证，全部测试已通过，正式发布。";knowledge.session.sections[2].body=claim.text;
 const text=formatContext(buildProjectContext(knowledge,memoryQualityOptions));expect(text).not.toContain(claim.text);expect(text).toContain("索引更新仍未开发，测试尚未执行");
});
it("reads existing Brief progress without interpreting the field name confirmed as user approval",()=>{
 const knowledge=memoryQualityFixture();knowledge.session.sections=[];knowledge.session.brief!.confirmed=[{text:"搜索 UI 已完成",evidenceIds:["e:report"]},{text:"最终确定 Transformers.js",evidenceIds:["e:ai-model"]}];
 const bundle=buildProjectContext(knowledge,memoryQualityOptions);expect(bundle.sections.find(section=>section.kind==="progress")?.items.some(item=>item.id==="brief-source:0"&&item.status==="reported")).toBe(true);expect(formatContext(bundle)).not.toContain("最终确定 Transformers.js");
});
it("preserves personal Wiki and explicitly maintained choices without treating them as code validation",()=>{
 const knowledge=memoryQualityFixture(),page=knowledge.session.sections[1];page.userEdited=true;const before=structuredClone(page);
 knowledge.session.projectMaintenance={decisions:{"choice:storage":{text:knowledge.session.projectState!.decisions[1].text,confirmed:true}}};knowledge.session.projectState!.signature=projectStateSignature(knowledge.session);
 const bundle=buildProjectContext(knowledge,memoryQualityOptions);expect(bundle.sections.find(section=>section.kind==="wiki")?.items.some(item=>item.status==="personal"&&item.text.includes(page.body))).toBe(true);expect(formatContext(bundle)).toContain("用户在 ChatAtlas 中维护的选择");expect(page).toEqual(before);
});
it("keeps retired choices in history, not current decisions, across conversations and platforms",()=>{
 const knowledge=evolutionKnowledge(),later=knowledge.messages[1];later.conversationId="later";knowledge.session.sourceConversationIds.push("later");knowledge.conversations.push({...knowledge.conversations[0],id:"later",platform:"claude"});
 knowledge.session.evidence[1].conversationId="later";knowledge.session.projectHistoryAnalysis!.evidence[1].conversationId="later";knowledge.session.projectHistoryAnalysis!.sources[1].conversationId="later";
 knowledge.session.sourceSignatures!.later={[later.id]:sourceMessageSignature(later.content)};knowledge.session.sourceRoles!.later={[later.id]:later.role};knowledge.session.projectHistoryAnalysis!.signature=projectHistorySignature(knowledge.session);knowledge.session.projectState!.signature=projectStateSignature(knowledge.session);
 const text=formatContext(buildProjectContext(knowledge,memoryQualityOptions));expect(text).toContain("数据库使用 IndexedDB");expect(text).toContain("旧方案：数据库使用 SQLite");
 expect(buildProjectContext(knowledge,memoryQualityOptions).sections.find(section=>section.kind==="decisions")?.items.some(item=>item.text.includes("数据库使用 SQLite"))).toBe(false);
});
it("omits resolved questions and preserves no-task overview semantics",()=>{
 const knowledge=memoryQualityFixture(),text="索引是否需要重建？",id=projectQuestionKey(text);knowledge.session.brief!.openQuestions=[text];knowledge.session.projectMaintenance={questions:{[id]:{text,originalText:text,resolved:true,resolution:"采用按需重建",matterStatus:"resolved"}}};
 const pack=formatContext(buildProjectContext(knowledge,memoryQualityOptions));expect(pack).not.toContain("历史问题（当前是否仍待解决未知）："+text);expect(pack).not.toContain("## 当前任务");
});
function withStoredFacts(){
 const knowledge=memoryQualityFixture(),session=knowledge.session;
 session.projectKnowledge={version:1,signature:"retained",batches:[{sourceIds:session.evidence.map(ref=>ref.id),scopeSignature:sourceMessageSignature(JSON.stringify([session.goal,{kind:"all"}])),sources:session.evidence.map(ref=>{const raw=knowledge.messages.find(message=>message.id===ref.messageId)!;return {id:ref.id,conversationId:raw.conversationId,messageId:raw.id,role:raw.role,signature:sourceMessageSignature(raw.content),messageIndex:raw.messageIndex,discussedAt:raw.createdAt};}),facts:structuredClone(session.projectState!)}]};
 session.projectState=undefined;session.projectEvolutionAnalysis=undefined;session.sections=[];return knowledge;
}
it("reuses first-reading structured facts locally with no new model, network or database writes",()=>{
 const knowledge=withStoredFacts(),before=structuredClone(knowledge),fetch=vi.spyOn(globalThis,"fetch");
 try{expect(retainedProjectKnowledge(knowledge.session,knowledge.messages).decisions).toHaveLength(3);const bundle=buildProjectContext(knowledge,memoryQualityOptions);expect(bundle.sections.flatMap(section=>section.items).some(item=>item.id==="choice:storage"&&item.status==="confirmed")).toBe(true);expect(fetch).not.toHaveBeenCalled();expect(knowledge).toEqual(before);}finally{fetch.mockRestore();}
});
it.each(["role","text","scope","metadata"])("rejects stale or legacy retained extraction after %s without guessing current state",change=>{
 const knowledge=withStoredFacts();if(change==="role")knowledge.messages[0].role="assistant";if(change==="text")knowledge.messages[0].content+="更改正文";if(change==="scope")knowledge.session.goal="另一个项目目标";if(change==="metadata")delete knowledge.session.projectKnowledge!.batches[0].sources;
 expect(retainedProjectKnowledge(knowledge.session,knowledge.messages).decisions).toEqual([]);
});
it("includes retained knowledge in export freshness signatures",()=>{
 const knowledge=withStoredFacts(),before=contextProjectSignature(knowledge.session);knowledge.session.projectKnowledge!.batches[0].facts!.decisions[0].text="新内容";expect(contextProjectSignature(knowledge.session)).not.toBe(before);
});
