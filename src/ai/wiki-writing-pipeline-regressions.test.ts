import { expect, it } from "vitest";
import type { WikiDraftChapter, WikiKnowledgeLedger, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { trimWikiEditorialRepeats } from "./wiki-editorial-repetitions";
import { keepsWikiWritingDetail, restoreWikiWritingStatus, unsupportedWikiNumbers } from "./wiki-number-diagnostics";
import { readWikiWritingBlocks } from "./wiki-writing-layout";
import { renumberedLists } from "./wiki-markdown-tidy";
import { wikiProjectPersonalAside } from "./wiki-knowledge-select";
import { checkedTopic } from "./wiki-topic-chains";
import { wikiUnitLane } from "./wiki-unit-routing";

function unit(id: string, statement: string, section?: string): WikiKnowledgeUnit {
  return { id, subject: id, statement, kind: "plan", adoption: { status: "proposal" }, delivery: "planned", details: [],
    evidence: { evidenceId: id, messageId: id, conversationId: "c", messageIndex: 1, role: "assistant", pasted: false, quote: statement, section } };
}

function ledger(units: WikiKnowledgeUnit[]): WikiKnowledgeLedger {
  return { version: 1, generatedAt: 1, status: "complete", materials: 1,
    batches: [{ sourceIds: [], status: "ok", units, rejected: {} }] };
}

function chapter(text: string, claims: NonNullable<WikiDraftChapter["paragraphs"][number]["claims"]>): WikiDraftChapter {
  return { id: "chapter", title: "Project", question: "", group: "", body: text, problems: [],
    paragraphs: [{ text, claims, unitIds: [...new Set(claims.flatMap(claim => claim.unitIds))], subtopic: "技术规则" }] };
}

it("folds the split clauses of a legacy confirmation and keeps independent preferences", () => {
  const storage = unit("storage", "默认仅保存在运行时内存，刷新即消失；可选“本次浏览器会话记住”使用 sessionStorage，禁止长期保存。");
  const settings = unit("settings", "Provider ID 可保存到 localStorage。");
  const memory = "在存储机制上，API Key 默认仅保存在运行时内存中，页面刷新后即消失。";
  const optional = "用户可选择“本次浏览器会话记住”，此时使用 **sessionStorage**。";
  const input = chapter(memory + optional + settings.statement, [
    { text: memory, unitIds: [storage.id] }, { text: optional, unitIds: [storage.id] },
    { text: settings.statement, unitIds: [settings.id] },
  ]);
  const saved = ledger([storage, settings]);
  saved.decisions = { storage: { verdict: "confirmed", at: 2 } };
  saved.userAnswers = [{ questionId: "q", question: "API Key 允许写入 sessionStorage 吗？", answer: "可选",
    optionId: "yes", unitIds: [storage.id], at: 2 }];
  const units = new Map([[storage.id, storage], [settings.id, settings]]);
  trimWikiEditorialRepeats([input], saved, units);
  expect(input.body).toBe(storage.statement + "\n\n" + settings.statement);
  expect(input.paragraphs.flatMap(p => p.claims?.map(claim => claim.unitIds))).toEqual([[storage.id], [settings.id]]);
  trimWikiEditorialRepeats([input], saved, units);
  expect(input.body).toBe(storage.statement + "\n\n" + settings.statement);
});

it("separates a planned sequence and a different phase restriction without changing the original table", () => {
  const flow = unit("plan", "按 Canvas -> BOM -> Wokwi 集成的顺序开发。");
  const limit = unit("limit", "本阶段禁止开发 Wokwi、商城。");
  const combined = flow.statement + "禁止开发 Wokwi、商城。";
  const table = "| 原阶段 | 适用范围 | 安排 |\n| --- | --- | --- |\n| 本阶段 | 核心链路 | " + combined + " |";
  const saved = ledger([flow, limit]), units = new Map([[flow.id, flow], [limit.id, limit]]);
  const claims = [{ text: combined, unitIds: [flow.id, limit.id] }];
  const input = chapter(table, claims);
  trimWikiEditorialRepeats([input], saved, units);
  expect(input.body).toContain("| 本阶段 | 核心链路 | 禁止开发 Wokwi、商城。 |");
  expect(input.body).toContain("| 讨论顺序（适用阶段待确认） | 核心链路 | " + flow.statement);
  expect(input.paragraphs[0].claims).toEqual([
    { text: "禁止开发 Wokwi、商城。", unitIds: [limit.id] }, { text: flow.statement, unitIds: [flow.id] },
  ]);
  flow.evidence.code = { language: "table", text: table };
  const original = chapter(table, claims);
  trimWikiEditorialRepeats([original], saved, units);
  expect(original.body).toBe(table);
});

it("keeps personal learning in the ledger and preserves project constraints with the same technology words", () => {
  const personal = unit("发展", "暂时避开 FPGA 加速与 ASIC 芯片方向。", "你的最终学习路线");
  const requirement = unit("首版范围", "首版不支持 FPGA。");
  const input = chapter(personal.statement, [{ text: personal.statement, unitIds: [personal.id] }]);
  input.body = "### 个人技术方向\n\n" + input.body;
  const saved = ledger([personal, requirement]);
  trimWikiEditorialRepeats([input], saved, new Map([[personal.id, personal], [requirement.id, requirement]]));
  expect(input.body.trim()).toBe("");
  expect(saved.batches[0].units).toHaveLength(2);
  expect(wikiProjectPersonalAside(requirement)).toBe(false);
});

it("validates counts, ranges, real status identifiers and presentation numbers separately", () => {
  expect(renumberedLists("1. **9. 验证**\n2. **10. 仿真**")).toBe("1. **验证**\n2. **仿真**");
  expect(unsupportedWikiNumbers("**12. 制作**：设为 32 元。", "", new Set()).numbers).toEqual(["32"]);
  expect(keepsWikiWritingDetail("显示三个可点击示例。", "3条", "显示3条可点击示例。")).toBe(true);
  expect(keepsWikiWritingDetail("显示三个可点击示例。", "3条", "显示2～3条可点击示例。")).toBe(false);
  expect(keepsWikiWritingDetail("提供三种备选方案。", "3条", "显示3条可点击示例。")).toBe(false);
  const state = unit("clarification", "NEEDS_CLARIFICATION\n→ 单问题展示");
  expect(restoreWikiWritingStatus("测试 Clarification 单问题展示", [state])).toBe("测试 NEEDS_CLARIFICATION 单问题展示");
  expect(restoreWikiWritingStatus("测试 Clarification 单问题展示", [])).toBe("测试 Clarification 单问题展示");
});

it("allows a bound prose alias and renders a short bound flow as an ordered list", () => {
  const known = new Set(["k1", "k2"]);
  expect(readWikiWritingBlocks({ type: "text", text: "Display the selection.", unitIds: ["k1"] }, known)[0].unitIds).toEqual(["k1"]);
  const items = [{ text: "Select an item", unitIds: ["k1"] }, { text: "Confirm the selection", unitIds: ["k2"] }];
  expect(readWikiWritingBlocks({ type: "flow", items }, known)[0].text).toBe("1. Select an item\n2. Confirm the selection");
  expect(() => readWikiWritingBlocks({ type: "text", text: "Unbound", unitIds: ["unknown"] }, known)).toThrow("invalid_writing_paragraph");
});

it("keeps UI display rules in the interface and preserves a complete decision title", () => {
  const display = unit("BOM 折叠栏", "BOM 折叠栏默认收起，展开后在右侧显示元件列表。");
  const implementation = unit("数据模型", "BOM 列表从 Hardware IR 计算，保持单一事实来源。");
  expect(wikiUnitLane(display)).toBe("interface");
  expect(wikiUnitLane(implementation)).toBe("technical");
  const name = "Inventory 与 Planner 的集成方式";
  expect(checkedTopic({ name, current: ["k1"], earlier: ["k2"] },
    new Map([["k1", display], ["k2", implementation]]), {}, "topic")?.name).toBe(name);
});
