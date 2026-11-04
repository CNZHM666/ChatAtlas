import { expect, it } from "vitest";
import { ledgerDocument } from "./wiki-ledger-document";
import type { WikiKnowledgeLedger, WikiKnowledgeUnit } from "../shared/wiki-knowledge";

const unit = (index: number, statement: string, adoption: WikiKnowledgeUnit["adoption"]["status"] = "proposal", role: "user" | "assistant" = "assistant"): WikiKnowledgeUnit =>
  ({ id: `unit:${index}`, subject: "检索", statement, kind: adoption === "user_decision" ? "decision" : "mechanism", details: [], evidence: { evidenceId: `e${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role, pasted: false, quote: statement }, adoption: { status: adoption }, delivery: "unknown" });

it("marks the last claim of each holder run in a paragraph, in reading order, from the ledger's statuses", () => {
  const units = [unit(1, "只做 Chrome 版本。", "user_decision", "user"), unit(2, "索引使用 Orama。"), unit(3, "排序按时间。")];
  const text = "已决定只做 Chrome 版本。索引使用 Orama。排序按时间。";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 3, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "检索", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", subtopics: [{ title: "索引", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", body: text, problems: [],
      // Written out of order: the run claims are added after the writer's own.
      paragraphs: [{ subtopic: "索引", text, unitIds: units.map(item => item.id), claims: [{ text: "排序按时间。", unitIds: ["unit:3"] }, { text: "已决定只做 Chrome 版本。", unitIds: ["unit:1"] }, { text: "索引使用 Orama。", unitIds: ["unit:2"] }] }] }] } };
  const claims = ledgerDocument(ledger, {}).sections[0].claims ?? [];
  expect(claims.map(claim => [claim.text, claim.holder, Boolean(claim.holderMark)])).toEqual([["已决定只做 Chrome 版本。", "decided", true], ["索引使用 Orama。", "ai", false], ["排序按时间。", "ai", true]]);
});

it("keeps claims that only place a holder mark out of the facts, key conclusions and status labels", async () => {
  const { projectKnowledgeFacts } = await import("../shared/project-knowledge-facts");
  const { knowledgeFactText } = await import("../shared/project-knowledge-view");
  const units = [unit(1, "只做 Chrome 版本。", "user_decision", "user"), unit(2, "索引使用 Orama。")];
  const text = "已决定只做 Chrome 版本。这一决定让发布更快。索引使用 Orama。";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "检索", aliases: [], unitIds: ["unit:1", "unit:2"] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", subtopics: [{ title: "索引", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", body: text, problems: [],
      paragraphs: [{ subtopic: "索引", text, unitIds: ["unit:1", "unit:2"], claims: [{ text: "已决定只做 Chrome 版本。", unitIds: ["unit:1"] }, { text: "这一决定让发布更快。", unitIds: ["unit:1"], markOnly: true }, { text: "索引使用 Orama。", unitIds: ["unit:2"] }] }] }] } };
  const { sections, evidence } = ledgerDocument(ledger, {});
  expect(sections[0].claims?.find(claim => claim.text === "这一决定让发布更快。")?.markOnly).toBe(true);
  const session = { ...(await import("../test/project-fixture")).projectSession(), sections, evidence, sourceSignatures: undefined };
  const facts = projectKnowledgeFacts(session).facts;
  expect(facts.map(fact => fact.claim.text)).not.toContain("这一决定让发布更快。");
  // The AI's proposal has a mark: no "讨论建议：" goes before it.
  const proposal = facts.find(fact => fact.claim.text === "索引使用 Orama。")!;
  expect(knowledgeFactText(proposal, true)).toBe("索引使用 Orama。");
});

it("quotes and opens first the unit a claim's sentence states, not the first one it cites", () => {
  const units = [unit(1, "首页只保留搜索入口。"), unit(2, "索引使用 Orama 做全文检索。")];
  const text = "索引使用 Orama 做全文检索。";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "检索", aliases: [], unitIds: ["unit:1", "unit:2"] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", subtopics: [{ title: "索引", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", body: text, problems: [],
      paragraphs: [{ subtopic: "索引", text, unitIds: ["unit:1", "unit:2"], claims: [{ text, unitIds: ["unit:1", "unit:2"] }] }] }] } };
  const { sections, evidence } = ledgerDocument(ledger, {});
  const claim = sections[0].claims![0];
  expect(claim.quote).toBe("索引使用 Orama 做全文检索。");
  expect(evidence.find(ref => ref.id === claim.evidenceIds[0])?.messageId).toBe("m2");
});

it("marks a decision stated in the chapter opening, and a sentence saying a decision whatever material adds to it", () => {
  // Their own words choose: "我打算先做……", "我喜欢这种设计".
  const said = (item: WikiKnowledgeUnit, quote: string) => ({ ...item, evidence: { ...item.evidence, quote } });
  const copy = said(unit(1, "优先实现复制上下文功能，待项目知识准确后再逐步加入自动记忆读取。", "user_decision", "user"), "我打算先做复制上下文以后慢慢加");
  const light = said(unit(2, "采用浅色极简风格，包含居中欢迎区和双入口导入卡片。", "user_decision", "user"), "我喜欢这种设计");
  const spec = { ...unit(3, "新手首页包含居中欢迎区和双入口导入卡片，后续不再重新设计整体布局。"), evidence: { ...unit(3, "").evidence, role: "user" as const, pasted: true } };
  const units = [copy, light, spec];
  const opening = "架构复用现有组件。优先实现复制上下文功能，待项目知识准确后再逐步加入自动记忆读取。";
  const text = "新手首页采用浅色极简风格，包含居中欢迎区和双入口导入卡片，后续不再重新设计整体布局。";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 3, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "检索", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", subtopics: [{ title: "首页", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", body: `${opening}\n\n### 首页\n\n${text}`, problems: [], openingUnitIds: [copy.id],
      paragraphs: [{ subtopic: "首页", text, unitIds: [light.id, spec.id], claims: [{ text, unitIds: [light.id, spec.id] }] }] }] } };
  const claims = ledgerDocument(ledger, {}).sections[0].claims ?? [];
  expect(claims.find(claim => claim.text === "优先实现复制上下文功能，待项目知识准确后再逐步加入自动记忆读取。")).toMatchObject({ holder: "decided", holderMark: true, markOnly: true });
  // The pasted spec adds details to the user's choice and one commitment of its own: the choice with its details is
  // the decision; "后续不再重新设计整体布局", said only by the pasted spec, keeps the material's mark.
  expect(claims.find(claim => claim.text === "新手首页采用浅色极简风格，包含居中欢迎区和双入口导入卡片")?.holder).toBe("decided");
  expect(claims.find(claim => claim.text === "后续不再重新设计整体布局。")).toMatchObject({ holder: "material", unitIds: [spec.id] });
});

it("does not mark a short clause sharing a few words with a decision as that decision", () => {
  const copy = { ...unit(1, "优先实现复制上下文功能，待项目知识准确后再逐步加入自动记忆读取。", "user_decision", "user"), evidence: { ...unit(1, "", "user_decision", "user").evidence, quote: "我打算先做复制上下文以后慢慢加" } };
  const plan = unit(2, "P0 精准查找历史消息；P1 可靠的上下文复制；P2 实现自动维护项目记忆。");
  const units = [copy, plan], text = "1. **P2**：实现自动维护项目记忆。";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "路线", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "规划", question: "?", group: "", subtopics: [{ title: "优先级", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "规划", question: "?", group: "", body: `### 优先级\n\n${text}`, problems: [],
      paragraphs: [{ subtopic: "优先级", text, unitIds: [copy.id, plan.id], claims: [{ text: "**P2**：实现自动维护项目记忆。", unitIds: [copy.id, plan.id] }] }] }] } };
  const claim = (ledgerDocument(ledger, {}).sections[0].claims ?? []).find(item => item.text.includes("自动维护项目记忆"));
  expect(claim?.holder).not.toBe("decided");
});

it("gives no decided mark to a sentence that only gives the reason for the decision before it", () => {
  const llm = { ...unit(1, "决定停止优化纯规则生成的 Context Pack，改为接入 LLM 进行语义分析和内容整理，以提升上下文组装的准确性。", "user_decision", "user"), evidence: { ...unit(1, "", "user_decision", "user").evidence, quote: "我决定停止优化规则，改为接入 LLM" } };
  const text = "决定停止优化纯规则生成的 Context Pack，改为接入 LLM 进行语义分析和内容整理。这一转变旨在提升上下文组装的准确性与智能化水平，不再依赖静态规则拼接。";
  const [first, second] = text.split(/(?<=。)/u);
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 1, batches: [{ sourceIds: [], status: "ok", units: [llm], rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "上下文", aliases: [], unitIds: [llm.id] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "上下文", question: "?", group: "", subtopics: [{ title: "构建", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "上下文", question: "?", group: "", body: `### 构建\n\n${text}`, problems: [],
      paragraphs: [{ subtopic: "构建", text, unitIds: [llm.id], claims: [{ text: first, unitIds: [llm.id] }, { text: second, unitIds: [llm.id] }] }] }] } };
  const claims = ledgerDocument(ledger, {}).sections[0].claims ?? [];
  expect(claims.find(claim => claim.text === first)?.holder).toBe("decided");
  expect(claims.find(claim => claim.text === second)?.holder).not.toBe("decided");
});

it("does not mark as earlier a replaced wording that says what the user's decision says", () => {
  const chosen = { ...unit(1, "首页采用浅色极简风格，包含居中欢迎区和双入口导入卡片。", "user_decision", "user"), evidence: { ...unit(1, "", "user_decision", "user").evidence, quote: "我喜欢这种设计" } };
  const first = unit(2, "首页采用浅色极简风格，包含居中欢迎区、双入口导入卡片和底部功能介绍。");
  const dark = unit(3, "保留深色极简设计风格与现有首页布局。");
  const units = [chosen, first, dark], a = "首页采用浅色极简风格，包含居中欢迎区、双入口导入卡片和底部功能介绍。", b = "保留深色极简设计风格与现有首页布局。", text = `${a}${b}`;
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 3, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "首页", aliases: [], unitIds: units.map(item => item.id) }], merged: [], report: {},
      relations: [{ older: first.id, newer: chosen.id, kind: "replaces", status: "resolved" }, { older: dark.id, newer: chosen.id, kind: "replaces", status: "resolved" }],
      chapters: [{ id: "ch", title: "界面", question: "?", group: "", subtopics: [{ title: "首页", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "界面", question: "?", group: "", body: `### 首页\n\n${text}`, problems: [],
      paragraphs: [{ subtopic: "首页", text, unitIds: [first.id, dark.id], claims: [{ text: a, unitIds: [first.id] }, { text: b, unitIds: [dark.id] }] }] }] } };
  const claims = ledgerDocument(ledger, {}).sections[0].claims ?? [];
  expect(claims.find(claim => claim.text === a)?.holder).not.toBe("earlier");
  expect(claims.find(claim => claim.text === b)?.holder).toBe("earlier");
});

it("marks an opening sentence saying two confirmed units once", () => {
  const first = unit(1, "面向大学生和创客的自然语言硬件设计工作台，帮助小白搭建硬件系统。"), second = unit(2, "AI Circuit Studio 是面向大学生和创客的自然语言硬件设计工作台。");
  const opening = "AI Circuit Studio 是面向大学生和创客的自然语言硬件设计工作台，帮助小白搭建硬件系统。", text = "首页只保留输入框。";
  const units = [first, second];
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    decisions: { [first.id]: { verdict: "confirmed", at: 1 }, [second.id]: { verdict: "confirmed", at: 1 } },
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "定位", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "定位", question: "?", group: "", subtopics: [{ title: "核心", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "定位", question: "?", group: "", body: `${opening}\n\n### 核心\n\n${text}`, problems: [], openingUnitIds: [first.id, second.id],
      paragraphs: [{ subtopic: "核心", text, unitIds: [first.id], claims: [] }] }] } };
  const claims = (ledgerDocument(ledger, {}).sections[0].claims ?? []).filter(claim => claim.text === opening);
  expect(claims).toHaveLength(1);
  expect(claims[0].unitIds).toEqual([first.id, second.id]);
});
