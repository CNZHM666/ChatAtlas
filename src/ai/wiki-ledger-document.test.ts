import { expect, it } from "vitest";
import { earlierValuesHold, ledgerDocument } from "./wiki-ledger-document";
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

it("keeps a stage limit no decision states out of the decided claim", () => {
  const wanted = unit(1, "增加直接询问购买清单、提供比价推荐及链接的功能。", "user_decision", "user");
  const units = [{ ...wanted, evidence: { ...wanted.evidence, quote: "我想让小白直接问购买清单，给比价推荐和链接" } }, unit(2, "本阶段不包含比价。")];
  const text = "系统需增加直接询问购买清单、提供比价推荐及链接的功能；本阶段不包含比价。";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "检索", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", subtopics: [{ title: "购买", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", body: text, problems: [],
      paragraphs: [{ subtopic: "购买", text, unitIds: ["unit:1"], claims: [{ text, unitIds: ["unit:1"] }] }] }] } };
  const claims = ledgerDocument(ledger, {}).sections[0].claims ?? [];
  const decided = claims.filter(claim => claim.holder === "decided");
  expect(decided.map(claim => claim.text)).toEqual(["系统需增加直接询问购买清单、提供比价推荐及链接的功能"]);
});

it("marks a table cell earlier only when no current unit it cites gives it", () => {
  const units = [unit(1, "App Background #FAFAFA，Panel #FFFFFF。"), unit(2, "Dark 主背景 #0F0F10，Panel #151516。"), unit(3, "Dark 背景色 #101011，Panel #151516。")];
  const text = "| 区域 | Light | Dark |\n| --- | --- | --- |\n| App Background | #FAFAFA | #0F0F10 |\n| Panel | #FFFFFF | #151516 |";
  const cells = ["App Background", "#FAFAFA", "#0F0F10", "Panel", "#FFFFFF", "#151516"];
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 3, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "检索", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [{ older: "unit:2", newer: "unit:3", kind: "replaces", status: "resolved" }], report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", subtopics: [{ title: "配色", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", body: text, problems: [],
      paragraphs: [{ subtopic: "配色", text, unitIds: ["unit:1", "unit:2", "unit:3"], claims: cells.map(cell => ({ text: cell, unitIds: /#151516|Panel/.test(cell) ? ["unit:1", "unit:2", "unit:3"] : ["unit:1", "unit:2"] })) }] }] } };
  const claims = ledgerDocument(ledger, {}).sections[0].claims ?? [];
  expect(claims.filter(claim => claim.holder === "earlier").map(claim => claim.text)).toEqual(["#0F0F10"]);
});

it("marks an opening sentence as decided only when most of it is the decision", () => {
  const rule = unit(1, "禁止改变“Hardware IR作为唯一事实源”和“V0.1只支持ESP32模块化硬件”这两个核心原则。", "user_decision", "user");
  const units = [{ ...rule, evidence: { ...rule.evidence, quote: "我想保持这两个核心原则不变：Hardware IR 唯一事实源，V0.1 只支持 ESP32 模块化硬件" } }];
  const wide = "系统采用以 Hardware IR 为唯一事实源的架构，通过 Zod 定义可版本化的 JSON Schema，并遵循“AI负责推进，人负责确认”的原则。";
  const close = "核心原则是不改变 Hardware IR 作为唯一事实源，V0.1 只支持 ESP32 模块化硬件。";
  const ledgerOf = (opening: string): WikiKnowledgeLedger => ({ version: 1, generatedAt: 0, status: "complete", materials: 1, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "检索", aliases: [], unitIds: ["unit:1"] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", subtopics: [{ title: "原则", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", body: `${opening}\n\n### 原则\n\n${rule.statement}`, problems: [], openingUnitIds: ["unit:1"],
      paragraphs: [{ subtopic: "原则", text: rule.statement, unitIds: ["unit:1"], claims: [{ text: rule.statement, unitIds: ["unit:1"] }] }] }] } });
  const openingMarks = (opening: string) => (ledgerDocument(ledgerOf(opening), {}).sections[0].claims ?? []).filter(claim => claim.markOnly).map(claim => claim.text);
  expect(openingMarks(wide)).toEqual([]);
  expect(openingMarks(close)).toEqual([close]);
});

it("keeps a sentence listing more than the decision it cites unmarked, and a replaced value earlier by its head noun", () => {
  const decided = { ...unit(1, "Bank syncing and receipt OCR are excluded from v1 scope.", "user_decision", "user"), subject: "Scope" };
  decided.evidence.quote = "Decided: for v1, do not include bank syncing or receipt OCR.";
  const text = "Bank syncing, receipt OCR, AI coaching, native mobile apps, complex reports, and multi-device cloud synchronization are excluded from v1 scope.";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 1, batches: [{ sourceIds: [], status: "ok", units: [decided], rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "Scope", aliases: [], unitIds: [decided.id] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "Scope", question: "?", group: "", subtopics: [{ title: "Exclusions", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "Scope", question: "?", group: "", body: text, problems: [],
      paragraphs: [{ subtopic: "Exclusions", text, unitIds: [decided.id], claims: [{ text, unitIds: [decided.id] }] }] }] } };
  expect(ledgerDocument(ledger, {}).sections[0].claims?.find(claim => claim.text === text)?.holder).not.toBe("decided");
  const earlier = unit(2, "Default card radius is 16px, dialog radius is 24px, border thickness is 1px.");
  const current = unit(3, "Standard UI components use a global corner radius of 8px.", "user_decision", "user");
  expect(earlierValuesHold("16px", [current], [earlier])).toBe(false);
  expect(earlierValuesHold("Panel #151516", [unit(4, "Background #0F0F10, surface #111112.")], [unit(5, "Dark palette: Panel #151516, Background #000000.")])).toBe(true);
});

it("keeps a sentence saying its decision with a few words more decided", () => {
  const decided = { ...unit(1, "The frontend stack is React + Vite + TypeScript.", "user_decision", "user"), subject: "Stack" };
  decided.evidence.quote = "Decided: the stack is React + Vite + TypeScript.";
  const text = "The confirmed frontend stack is React + Vite + TypeScript, operating as a web-only application.";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 1, batches: [{ sourceIds: [], status: "ok", units: [decided], rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "Stack", aliases: [], unitIds: [decided.id] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "Stack", question: "?", group: "", subtopics: [{ title: "Tech Stack", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "Stack", question: "?", group: "", body: text, problems: [],
      paragraphs: [{ subtopic: "Tech Stack", text, unitIds: [decided.id], claims: [{ text, unitIds: [decided.id] }] }] }] } };
  expect(ledgerDocument(ledger, {}).sections[0].claims?.find(claim => claim.text === text)?.holder).toBe("decided");
});

it("marks a current value and the earlier ones it says were replaced apart, reading a list item's label", () => {
  const current = { ...unit(1, "Standard UI components use a global corner radius of 8px.", "user_decision", "user"), subject: "UI" };
  current.evidence.quote = "Confirmed: the global corner radius is 8px.";
  const earlier = { ...unit(2, "Default card radius is 16px, dialog radius is 24px."), subject: "UI" };
  const claim = "Global standard is 8px; earlier proposals of 16px/24px were replaced.", text = `- **Dashboard top bar**: 48px.\n- **Global corner radius**: ${claim}`;
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units: [current, earlier], rejected: {} }],
    decisions: { [earlier.id]: { verdict: "rejected", at: 0 } },
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "UI", aliases: [], unitIds: [current.id, earlier.id] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "UI", question: "?", group: "", subtopics: [{ title: "UI Specification", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "UI", question: "?", group: "", body: text, problems: [],
      paragraphs: [{ subtopic: "UI Specification", text, unitIds: [current.id, earlier.id], claims: [{ text: claim, unitIds: [current.id, earlier.id] }] }] }] } };
  const claims = ledgerDocument(ledger, {}).sections[0].claims ?? [];
  expect(claims.map(item => [item.text, item.holder])).toEqual([["Global standard is 8px", "decided"], ["earlier proposals of 16px/24px were replaced.", "earlier"]]);
  // Told as set aside rather than replaced: one run's answer "earlier specifications … are ignored" read the 8px as earlier.
  const ignored = "Global standard is 8px; earlier specifications for 16px/24px radii are ignored.", told = text.replace(claim, ignored);
  const chapter = ledger.draft!.chapters[0];
  const next = { ...ledger, draft: { ...ledger.draft!, chapters: [{ ...chapter, body: told, paragraphs: [{ ...chapter.paragraphs[0], text: told, claims: [{ text: ignored, unitIds: [current.id, earlier.id] }] }] }] } };
  expect((ledgerDocument(next, {}).sections[0].claims ?? []).map(item => [item.text, item.holder])).toEqual([["Global standard is 8px", "decided"], ["earlier specifications for 16px/24px radii are ignored.", "earlier"]]);
});

it("marks a Chinese decision apart from the earlier plan it names in parentheses", () => {
  const current = { ...unit(1, "默认专注时长改为 50 分钟，休息时长改为 10 分钟。", "user_decision", "user"), subject: "计时" };
  current.evidence.quote = "默认专注时长改为 50 分钟，休息时长改为 10 分钟。";
  const earlier = { ...unit(2, "默认专注时间为 25 分钟，休息时间为 5 分钟。"), subject: "计时" };
  const claim = "默认专注时长改为 50 分钟，休息时长改为 10 分钟（取代早期讨论的 25/5 分钟方案）。";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units: [current, earlier], rejected: {} }],
    decisions: { [earlier.id]: { verdict: "rejected", at: 0 } },
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "计时", aliases: [], unitIds: [current.id, earlier.id] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "计时", question: "?", group: "", subtopics: [{ title: "计时规则", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "计时", question: "?", group: "", body: claim, problems: [],
      paragraphs: [{ subtopic: "计时规则", text: claim, unitIds: [current.id, earlier.id], claims: [{ text: claim, unitIds: [current.id, earlier.id] }] }] }] } };
  const claims = ledgerDocument(ledger, {}).sections[0].claims ?? [];
  expect(claims.map(item => [item.text, item.holder])).toEqual([["默认专注时长改为 50 分钟，休息时长改为 10 分钟", "decided"], ["取代早期讨论的 25/5 分钟方案）。", "earlier"]]);
});

it("marks a value apart from the earlier ones it says it replaces", () => {
  const current = { ...unit(1, "Standard UI components use a global corner radius of 8px.", "user_decision", "user"), subject: "UI" };
  current.evidence.quote = "Confirmed: the global corner radius is 8px.";
  const earlier = { ...unit(2, "Default card radius is 16px, dialog radius is 24px."), subject: "UI" };
  const claim = "Standard UI components use a global corner radius of 8px, replacing earlier suggestions of 16px or 24px.", text = `- ${claim}`;
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units: [current, earlier], rejected: {} }],
    decisions: { [earlier.id]: { verdict: "rejected", at: 0 } },
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "UI", aliases: [], unitIds: [current.id, earlier.id] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "UI", question: "?", group: "", subtopics: [{ title: "UI Specification", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "UI", question: "?", group: "", body: text, problems: [],
      paragraphs: [{ subtopic: "UI Specification", text, unitIds: [current.id, earlier.id], claims: [{ text: claim, unitIds: [current.id, earlier.id] }] }] }] } };
  expect((ledgerDocument(ledger, {}).sections[0].claims ?? []).map(item => [item.text, item.holder])).toEqual([["Standard UI components use a global corner radius of 8px", "decided"], ["replacing earlier suggestions of 16px or 24px.", "earlier"]]);
});

it("keeps a sentence decided when the analysis it also cites only repeats the decision", () => {
  const decided = { ...unit(1, "The frontend stack is React + Vite + TypeScript.", "user_decision", "user"), subject: "Stack" };
  decided.evidence.quote = "Decided: the stack is React + Vite + TypeScript.";
  const analysis = { ...unit(2, "The frontend stack is React + Vite + TypeScript, web-only."), subject: "Stack", kind: "fact" as const };
  const text = "The confirmed frontend stack is React + Vite + TypeScript, operating as a web-only application.";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units: [decided, analysis], rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "Stack", aliases: [], unitIds: [decided.id, analysis.id] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "Stack", question: "?", group: "", subtopics: [{ title: "Tech Stack", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "Stack", question: "?", group: "", body: text, problems: [],
      paragraphs: [{ subtopic: "Tech Stack", text, unitIds: [decided.id, analysis.id], claims: [{ text, unitIds: [decided.id, analysis.id] }] }] }] } };
  expect(ledgerDocument(ledger, {}).sections[0].claims?.find(claim => claim.text === text)?.holder).toBe("decided");
});

it("marks a decision before the long addition the writer gave it, the addition left unmarked", () => {
  const decided = { ...unit(1, "The frontend stack is React + Vite + TypeScript.", "user_decision", "user"), subject: "Stack" };
  decided.evidence.quote = "Decided: the stack is React + Vite + TypeScript.";
  const text = "The frontend stack is React + Vite + TypeScript, designed for a responsive web layout that prioritizes mobile-browser usability while avoiding unnecessary infrastructure until core product validation.";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 1, batches: [{ sourceIds: [], status: "ok", units: [decided], rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "Stack", aliases: [], unitIds: [decided.id] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "Stack", question: "?", group: "", subtopics: [{ title: "Tech Stack", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "Stack", question: "?", group: "", body: text, problems: [],
      paragraphs: [{ subtopic: "Tech Stack", text, unitIds: [decided.id], claims: [{ text, unitIds: [decided.id] }] }] }] } };
  expect((ledgerDocument(ledger, {}).sections[0].claims ?? []).map(claim => [claim.text, claim.holder])).toEqual([["The frontend stack is React + Vite + TypeScript", "decided"]]);
});

it("reads a decision told in the words of a suggestion only restating it as decided", () => {
  const decided = { ...unit(1, "v1 is web only, with no native mobile app.", "user_decision", "user"), subject: "Scope" };
  decided.evidence.quote = "Decided: v1 is web only, no native mobile app.";
  const restating = { ...unit(2, "V1 is Web only; no native iOS or Android apps."), subject: "Scope" };
  const text = "The platform is strictly Web only; there are no native iOS or Android apps.";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units: [decided, restating], rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "Scope", aliases: [], unitIds: [decided.id, restating.id] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "Scope", question: "?", group: "", subtopics: [{ title: "V1 Scope", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "Scope", question: "?", group: "", body: text, problems: [],
      paragraphs: [{ subtopic: "V1 Scope", text, unitIds: [decided.id, restating.id], claims: [{ text, unitIds: [decided.id] }] }] }] } };
  expect(ledgerDocument(ledger, {}).sections[0].claims?.find(claim => claim.text === text)?.holder).toBe("decided");
});

it("marks a learning record's mistakes as corrected and the user's own choice as theirs, with no decision marks", () => {
  const units = [unit(1, "只学 Python 基础。", "user_decision", "user"), unit(2, "注意区分赋值 = 与比较 ==。"), unit(3, "排序按时间。")];
  const text = "只学 Python 基础。注意区分赋值 = 与比较 ==。排序按时间。";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 3, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }], documentType: "learning", learningRoles: { "unit:1": "goal", "unit:2": "mistake", "unit:3": "concept" },
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "检索", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "基础", question: "?", group: "", subtopics: [{ title: "语法", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "基础", question: "?", group: "", body: text, problems: [],
      paragraphs: [{ subtopic: "语法", text, unitIds: units.map(item => item.id), claims: [{ text: "只学 Python 基础。", unitIds: ["unit:1"] }, { text: "注意区分赋值 = 与比较 ==。", unitIds: ["unit:2"] }, { text: "排序按时间。", unitIds: ["unit:3"] }] }] }] } };
  const claims = ledgerDocument(ledger, {}).sections[0].claims ?? [];
  expect(claims.map(claim => [claim.text, claim.holder])).toEqual([["只学 Python 基础。", "user"], ["注意区分赋值 = 与比较 ==。", "corrected"], ["排序按时间。", undefined]]);
});

it("puts no mark after a code block shown under a mistake", () => {
  const units = [unit(1, "注意区分赋值 = 与比较 ==。"), unit(2, "注意区分赋值 = 与比较 ==，代码见下。")];
  const text = "注意区分赋值 = 与比较 ==。", code = "*「语法」的清单*\n\n```text\n今天学会：\nif x == 3\n```";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }], documentType: "learning", learningRoles: { "unit:1": "mistake", "unit:2": "mistake" },
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "检索", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "基础", question: "?", group: "", subtopics: [{ title: "语法", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "基础", question: "?", group: "", body: `${text}\n\n${code}`, problems: [],
      paragraphs: [{ subtopic: "语法", text, unitIds: ["unit:1"], claims: [{ text, unitIds: ["unit:1"] }] }, { subtopic: "语法", text: code, unitIds: ["unit:2"] }] }] } };
  const claims = ledgerDocument(ledger, {}).sections[0].claims ?? [];
  expect(claims.map(claim => [claim.text, claim.holder])).toEqual([[text, "corrected"]]);
});

it("leaves the AI's answer to the learner's question unmarked in a learning record", () => {
  const asked = { ...unit(1, "建议在同一个对话中继续学习。", "user_decision", "user") };
  asked.evidence = { ...asked.evidence, quote: "我是新开个对话还是在这个对话里面继续" };
  const units = [asked, unit(2, "列表索引从 0 开始。")];
  const text = "建议在同一个对话中继续学习。列表索引从 0 开始。";
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }], documentType: "learning", learningRoles: { "unit:1": "method", "unit:2": "concept" },
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "检索", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "基础", question: "?", group: "", subtopics: [{ title: "语法", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "基础", question: "?", group: "", body: text, problems: [],
      paragraphs: [{ subtopic: "语法", text, unitIds: units.map(item => item.id), claims: [{ text: "建议在同一个对话中继续学习。", unitIds: ["unit:1"] }, { text: "列表索引从 0 开始。", unitIds: ["unit:2"] }] }] }] } };
  const claims = ledgerDocument(ledger, {}).sections[0].claims ?? [];
  expect(claims.map(claim => claim.holder)).toEqual([undefined, undefined]);
});
