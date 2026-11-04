import { expect, it } from "vitest";
import { evolutionKnowledge } from "../test/evolution-fixture";
import { effectiveProjectEvolution } from "./project-evolution";
import { validateProjectState } from "./project-state";
import { projectHistorySignature } from "./project-history";
import { buildProjectContext } from "../context/engine";
import { formatContext } from "../context/format";
import { sourceMessageSignature } from "./source-signature";
import { productReleaseEvents } from "./product-releases";

function releaseKnowledge() {
  const knowledge = evolutionKnowledge(), analysis = knowledge.session.projectHistoryAnalysis!;
  analysis.version = 5; analysis.kind = "releases";
  for (const [index, message] of knowledge.messages.entries()) {
    message.content = `v0.1：${message.content}`;
    const signature = sourceMessageSignature(message.content);
    knowledge.session.sourceSignatures!.c[message.id] = signature;
    knowledge.session.evidence[index].sourceSignature = signature;
    knowledge.session.evidence[index].excerpt = message.content;
    analysis.evidence[index] = { ...knowledge.session.evidence[index] };
    analysis.sources[index].signature = signature;
    analysis.events[index].quote = message.content;
    analysis.events[index].version = "v0.1";
  }
  analysis.signature = projectHistorySignature(knowledge.session);
  return knowledge;
}
it("keeps source approval after renaming only and carries incomplete coverage into every context length",()=>{
 const knowledge=releaseKnowledge();knowledge.session.projectMaintenance={productReleases:{"v0.1":{updatedAt:1,editedFields:["version"],edited:{...productReleaseEvents(knowledge.session)[0].original,version:"首版"}}}};
 expect(effectiveProjectEvolution(knowledge.session,knowledge.messages)).toHaveLength(4);
 knowledge.session.projectHistoryAnalysis!.pendingBatches=2;
 for(const length of ["short","standard","detailed"] as const){const text=formatContext(buildProjectContext(knowledge,{zh:true,task:"数据库",sections:["decisions"],length}));expect(text).toContain("版本分析尚有 2 批材料待补齐");expect(text).toContain("未处理的后续讨论可能改变当前方案");}
});

it("traces SQLite to IndexedDB, preserves cumulative Orama and persistence decisions, and records abandonment", () => {
  const knowledge = evolutionKnowledge(), snapshot = structuredClone(knowledge);
  const effective = effectiveProjectEvolution(knowledge.session, knowledge.messages);
  expect(effective.map(item => item.event.after)).toEqual(["数据库使用 IndexedDB", "使用 Orama 进行消息全文检索", "搜索索引支持持久化与中断恢复", "放弃服务器定时同步方案"]);
  expect(effective[0].previous[0].after).toBe("数据库使用 SQLite");
  const bundle = buildProjectContext(knowledge, { zh: true, task: "", sections: ["overview", "decisions"], length: "standard" });
  expect(formatContext(bundle)).toContain("数据库使用 IndexedDB"); expect(formatContext(bundle).split("## 来源")[0]).not.toContain("数据库使用 SQLite"); expect(formatContext(bundle)).toContain("明确放弃"); expect(knowledge).toEqual(snapshot);
  expect(formatContext(bundle)).toContain("记录的原因：浏览器本地存储更合适");
});
it("keeps a later assistant proposal from replacing explicit user choices", () => {
  const knowledge = evolutionKnowledge(), event = knowledge.session.projectHistoryAnalysis!.events[1];
  event.status = "proposal"; event.decisionStatus = "proposed";
  expect(effectiveProjectEvolution(knowledge.session, knowledge.messages)[0].event.after).toBe("数据库使用 SQLite");
});
it.each(["delete", "edit", "reorder", "role", "before", "scope"])("does not revive an older current state when a later source has %s", change => {
  const knowledge = evolutionKnowledge();
  if (change === "delete") knowledge.messages.splice(1, 1);
  if (change === "edit") knowledge.messages[1].content += " 后续修正。";
  if (change === "reorder") knowledge.messages[1].messageIndex = 100;
  if (change === "role") knowledge.messages[1].role = "assistant";
  if (change === "before") knowledge.messages[0].content = "初始方案已修改";
  if (change === "scope") knowledge.session.scope = { kind: "goal", blocks: [] };
  expect(effectiveProjectEvolution(knowledge.session, knowledge.messages).some(item => item.event.area === "数据库选型")).toBe(false);
});
it("keeps ambiguous or unmatched replacements out of current context", () => {
  const knowledge = evolutionKnowledge(); knowledge.session.projectHistoryAnalysis!.events[1].before = "未知旧方案";
  expect(effectiveProjectEvolution(knowledge.session, knowledge.messages).some(item => item.event.area === "数据库选型")).toBe(false);
  knowledge.session.projectHistoryAnalysis!.events[1].status = "uncertain";
  expect(effectiveProjectEvolution(knowledge.session, knowledge.messages).some(item => item.event.area === "数据库选型")).toBe(false);
  const bundle = buildProjectContext(knowledge, { zh: true, task: "", sections: ["decisions"], length: "standard" });
  expect(bundle.sections[0].items.find(item => item.text.startsWith("数据库使用 SQLite"))?.status).toBe("uncertain");
});
it("does not promote legacy discussion records to confirmed final knowledge", () => {
  const knowledge = evolutionKnowledge(); knowledge.session.projectHistoryAnalysis!.version = 3;
  expect(effectiveProjectEvolution(knowledge.session, knowledge.messages)).toEqual([]);
  knowledge.session.projectHistoryAnalysis!.version = 4; knowledge.session.goal = "改变范围";
  expect(knowledge.session.projectHistoryAnalysis!.signature).not.toBe(projectHistorySignature(knowledge.session));
  expect(effectiveProjectEvolution(knowledge.session, knowledge.messages)).toEqual([]);
});
it("rejects assistant-reported approval even when its quotation is literal", () => {
  const knowledge = evolutionKnowledge(), event = knowledge.session.projectHistoryAnalysis!.events[0];
  const sources = knowledge.messages.map((message, index) => ({ id: knowledge.session.evidence[index].id, text: message.content, role: "assistant" }));
  expect(() => validateProjectState({ summary: "已有讨论", modules: [], relations: [], decisions: [], constraints: [], actions: [], history: [event] }, sources, knowledge.session)).toThrow("original user decision");
});

it("uses v5 product releases in context and removes explicitly replaced older decisions", () => {
  const knowledge = releaseKnowledge();
  const text = formatContext(buildProjectContext(knowledge, { zh: true, task: "", sections: ["decisions"], length: "standard" }));
  expect(text).toContain("数据库使用 IndexedDB"); expect(text.split("## 来源")[0]).not.toContain("数据库使用 SQLite");
  expect(text).toContain("使用 Orama");
});

function approveRelease() {
  const knowledge = releaseKnowledge(), analysis = knowledge.session.projectHistoryAnalysis!, event = analysis.events[1];
  const proposed = knowledge.messages[1]; proposed.role = "assistant";
  knowledge.session.sourceRoles!.c[proposed.id] = "assistant"; analysis.sources[1].role = "assistant";
  const approval = { ...proposed, id: "release-approval", role: "user" as const, messageIndex: 5, content: "确认 v0.1 数据库改用 IndexedDB。" };
  knowledge.messages.push(approval);
  const signature = sourceMessageSignature(approval.content), ref = { id: "release-approval-ref", conversationId: "c", messageId: approval.id, title: "版本确认", excerpt: approval.content, sourceSignature: signature };
  analysis.evidence.push(ref);
  analysis.sources.push({ id: ref.id, conversationId: "c", messageId: approval.id, role: "user", messageIndex: 5, signature, discussedAt: approval.createdAt });
  knowledge.session.sourceSignatures!.c[approval.id] = signature; knowledge.session.sourceRoles!.c[approval.id] = "user";
  knowledge.session.sourceMessageOrder!.c.splice(2, 0, approval.id);
  event.confirmationQuote = approval.content; event.confirmationEvidenceIds = [ref.id];
  analysis.signature = projectHistorySignature(knowledge.session);
  return knowledge;
}

it("accepts a later original user approval and exports its proposal, approval and reason sources", () => {
  const knowledge = approveRelease();
  const active = effectiveProjectEvolution(knowledge.session, knowledge.messages).find(item => item.event.area === "数据库选型")!;
  expect(active.event.after).toBe("数据库使用 IndexedDB");
  expect(active.evidence.some(ref => ref.id === "release-approval-ref")).toBe(true);
  const bundle = buildProjectContext(knowledge, { zh: true, task: "数据库", sections: ["decisions"], length: "standard" });
  expect(bundle.sources.some(source => source.messageId === "release-approval")).toBe(true);
});

it.each(["delete", "change", "earlier", "role"])("does not confirm a release after its approval is %s", change => {
  const knowledge = approveRelease(), approval = knowledge.messages.at(-1)!;
  if (change === "delete") knowledge.messages.pop();
  if (change === "change") approval.content += " 先不要采用。";
  if (change === "earlier") approval.messageIndex = 0;
  if (change === "role") approval.role = "assistant";
  expect(effectiveProjectEvolution(knowledge.session, knowledge.messages).some(item => item.event.area === "数据库选型")).toBe(false);
});

it.each(["hidden", "edited"])("does not export an original release as confirmed after it is %s", kind => {
  const knowledge = releaseKnowledge();
  knowledge.session.projectMaintenance!.productReleases = { "v0.1": { updatedAt: 1, ...(kind === "hidden" ? { hidden: true } : { edited: { version: "v0.1", summary: "个人调整", additions: [], modifications: [], reason: "" } }) } };
  expect(effectiveProjectEvolution(knowledge.session, knowledge.messages)).toEqual([]);
  const bundle = buildProjectContext(knowledge, { zh: true, task: "", sections: ["decisions"], length: "standard" });
  expect(bundle.sections.flatMap(section => section.items).some(item => item.id.startsWith("current:"))).toBe(false);
});
