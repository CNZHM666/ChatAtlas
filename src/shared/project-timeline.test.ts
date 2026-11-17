import { expect, it } from "vitest";
import { contextKnowledge } from "../test/context-fixture";
import { projectTimeline } from "./project-timeline";
import type { WikiKnowledgeUnit } from "./wiki-knowledge";

function timelineFixture() {
  const { session } = contextKnowledge();
  session.sections = [];
  session.evidence = [];
  const units: WikiKnowledgeUnit[] = [];
  session.wikiKnowledge = { version: 1, generatedAt: 1, status: "complete", documentType: "project", materials: 2,
    batches: [{ sourceIds: [], status: "ok", rejected: {}, units }] };
  session.sourceConversationIds = ["c", "other"];
  const add = (text: string, options: { conversation?: string; index?: number; report?: boolean; assistant?: boolean; excerpt?: string } = {}) => {
    const id = `u-${units.length}`, conversationId = options.conversation ?? "c", messageIndex = options.index ?? units.length;
    const messageId = `m-${messageIndex}`;
    units.push({ id, subject: "", statement: text, kind: options.report ? "report" : "decision", details: [],
      delivery: options.report ? "user_reported" : "unknown",
      adoption: { status: options.assistant ? "proposal" : options.report ? "unknown" : "user_decision" },
      evidence: { evidenceId: id, role: options.assistant ? "assistant" : "user", conversationId, messageId, messageIndex, pasted: false, quote: text } });
    session.evidence.push({ id, conversationId, messageId, title: "Project", excerpt: options.excerpt ?? text });
    return id;
  };
  return { session, add };
}

it("picks strategic choices ahead of releases and retains distinct changes announced together", () => {
  const { session, add } = timelineFixture();
  const purpose = add("我们决定把产品用来解决跨团队交接时信息容易丢失的问题。", { index: 0 });
  session.wikiKnowledge!.batches[0].units[0].subject = "主要用途";
  const scope = add("我们决定第一版只做全文搜索，其他能力延后。", { index: 0 });
  const look = add("我们决定第一版改为蓝色按钮配色。");
  for (let n = 1; n <= 10; n++) add(`我们已经发布连接器 ${n}。`, { report: true });
  const items = projectTimeline(session);
  expect(items).toHaveLength(8);
  expect(items.map(item => item.id).slice(0, 2)).toEqual([purpose, scope]);
  expect(items.some(item => item.id === look)).toBe(false);
});

it("coalesces repeated decisions across conversations, keeps their sources, and excludes unconfirmed plans", () => {
  const { session, add } = timelineFixture();
  const text = "我们决定第一版仅做静态导出，MCP 延后。";
  const first = add(text, { excerpt: `发布安排\n${text}` }), second = add(text, { conversation: "other" });
  const proposal = add("我们决定第一版增加语义搜索。", { assistant: true });
  const progress = add("我们已经跑通核心链路，从导入到定位原文。", { report: true });
  const unproven = add("我们还没跑通核心链路。", { report: true });
  const items = projectTimeline(session);
  expect(items).toHaveLength(2);
  expect(items.find(item => item.id === first)?.relatedSources?.map(ref => ref.id)).toEqual([second]);
  expect(items.find(item => item.id === progress)?.status).toBe("reported");
  expect(items.some(item => [proposal, unproven].includes(item.id))).toBe(false);
});

it("shows a replaced confirmed choice in its original place while leaving an abandoned suggestion out", () => {
  const { session, add } = timelineFixture();
  const old = add("我们决定第一版只做全文搜索。");
  const proposal = add("第一版改用语义搜索。", { assistant: true });
  const current = add("我们决定第一版改为混合检索。");
  session.wikiKnowledge!.organization = { version: 1, generatedAt: 1, status: "complete", subjects: [],
    merged: [], report: {}, chapters: [], relations: [old, proposal].map(older =>
      ({ older, newer: current, kind: "replaces", status: "resolved", evidence: current })) };
  expect(projectTimeline(session).map(({ id, status }) => [id, status]))
    .toEqual([[old, "earlier"], [current, "decision"]]);
});
