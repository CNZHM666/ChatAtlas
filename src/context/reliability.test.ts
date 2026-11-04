import {expect,it,vi} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {sourceMessageSignature} from "../shared/source-signature";
import {projectStateSignature} from "../shared/project-state";
import {buildProjectContext} from "./engine";
import {formatContext} from "./format";
import type {ContextOptions} from "./types";

const options:ContextOptions={zh:true,task:"",length:"detailed",mode:"full",sections:["overview","decisions","progress","next","wiki","history"]};
function withPlan(){
 const knowledge=contextKnowledge(),text="计划开发视觉识别，先从旧元件拍照辨识开始。",message={...knowledge.messages[0],id:"vision",messageIndex:3,content:text};
 knowledge.messages.push(message);knowledge.session.sourceSignatures!.c.vision=sourceMessageSignature(text);
 knowledge.session.sourceRoles!.c.vision="user";
 knowledge.session.evidence.push({id:"vision",conversationId:"c",messageId:"vision",title:"视觉识别",excerpt:text});
 knowledge.session.sections.push({id:"vision",title:"视觉识别",body:text,transition:"",kind:"finding",evidenceIds:["vision"],claims:[{text,quote:text,evidenceIds:["vision"],verification:"supported",overviewRole:"progress",workStatus:"planned"}]});
 knowledge.session.projectState!.constraints.push({id:"raw-boundary",text:"不能覆盖原始聊天",reason:"",quote:knowledge.messages[0].content,evidenceIds:["e-db"],status:"documented"});
 knowledge.session.projectState!.signature=projectStateSignature(knowledge.session);return knowledge;
}
it("uses the same bilingual subject recall for task context and preserves constraints without a model",()=>{
 const knowledge=withPlan(),before=structuredClone(knowledge),fetch=vi.spyOn(globalThis,"fetch");
 const bundle=buildProjectContext(knowledge,{...options,mode:"task",task:"Continue photo recognition"}),text=formatContext(bundle);
 expect(text).toContain("计划开发视觉识别");expect(text).not.toContain("const action");expect(text).toContain("不能覆盖原始聊天");
 expect(bundle.sections.find(section=>section.kind==="progress")!.items[0].status).toBe("planned");
 expect(bundle.taskEvidenceMatched).toBe(true);expect(knowledge).toEqual(before);expect(fetch).not.toHaveBeenCalled();fetch.mockRestore();
});
it("retains sourced fact states while separately disclosing unreviewed later discussions",()=>{
 const knowledge=withPlan();knowledge.sourcesStale=true;
 const bundle=buildProjectContext(knowledge,options),items=bundle.sections.flatMap(section=>section.items),text=formatContext(bundle);
 expect(items.find(item=>item.id==="db")).toMatchObject({status:"confirmed",currency:"unreviewed"});
 expect(items.find(item=>item.id==="wiki-brief:vision:0")).toMatchObject({status:"planned",currency:"unreviewed"});
 expect(text).toContain("不保证已覆盖最新现状");expect(text).toContain("本稿未纳入经用户确认的当前方案");
 expect(text).toContain("原记录：开发计划（不代表完成） · 后续讨论待整理");
});
it("does not let a historical approval resurrect modified or missing original evidence",()=>{
 const knowledge=withPlan();knowledge.sourcesStale=true;knowledge.messages[0].content="取消原来的数据库方案，之后再讨论。";
 const bundle=buildProjectContext(knowledge,options);
 expect(bundle.sections.flatMap(section=>section.items).some(item=>item.id==="db")).toBe(false);
 expect(bundle.invalidSources).toBeGreaterThan(0);
});
it("keeps user-maintained resolutions without making them uncertain because unrelated sources changed",()=>{
 const knowledge=withPlan();knowledge.sourcesStale=true;
 knowledge.session.projectMaintenance!.decisions!.db={text:"数据库使用 IndexedDB",confirmed:true,matterStatus:"resolved",resolution:"用户决定只保留本地导出"};
 const bundle=buildProjectContext(knowledge,options),item=bundle.sections.flatMap(section=>section.items).find(item=>item.id==="db")!;
 expect(item.text).toContain("用户决定只保留本地导出");expect(item.status).toBe("confirmed");expect(item.currency).toBeUndefined();
});
