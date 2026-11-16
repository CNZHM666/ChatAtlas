import { expect, it } from "vitest";
import type { WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { wikiTemporalClaim } from "./wiki-claim-temporality";
import { wikiClaimStanding, wikiOpeningStanding } from "./wiki-claim-standing";
import { lostNegation, recheckWikiTableNegation } from "./wiki-negation-review";
import { retainCapabilityReports } from "./wiki-capability-state";
import { exclusiveWikiVersions, wikiReplacementSupported } from "./wiki-version-conflict";

const point = (id: string, statement: string, quote = statement): WikiKnowledgeUnit => ({
  id, statement, subject: "处理方式", kind: "constraint", details: [], delivery: "unknown", adoption: { status: "proposal" },
  evidence: { evidenceId: id, conversationId: "c", messageId: id, messageIndex: 1, role: "assistant", pasted: false, quote },
});

it("keeps an existing control when the source adds an independent confirmation step", () => {
  const before = point("before", "每次提交都要通过完整性校验。");
  const after = point("after", "常规修改直接提交，批量修改先预览再提交，每次提交都要通过完整性校验。", "完整性校验继续保留。另增加预览步骤。");
  const text = "此前每次提交都要通过完整性校验，现简化为两级策略。";
  expect(exclusiveWikiVersions(before, after)).toBe(false);
  expect(wikiReplacementSupported(text, [after], [{ older: before.id, newer: after.id, kind: "supplements", status: "resolved" }])).toBe(false);
  expect(wikiTemporalClaim(text, [after], [], true)).toEqual({ text: `讨论中的建议：${after.statement}`, restoredProposal: true });
});

it("requires the comparison row with the negation to cover the same scope and cite the same source", () => {
  const source = point("details", "摘要模式下不显示具体 SKU 信息，详细 SKU 信息仅在明细模式中显示。");
  const negative = "不显示具体 SKU 信息", positive = "详细 SKU 信息仅在此模式显示";
  const table = `| 模式 | 内容 |\n| --- | --- |\n| 摘要模式 | ${negative} |\n| 明细模式 | ${positive} |`;
  const warning = `"${positive}…" drops the negation of "摘要模式下不显示具体 SKU 信息…"`;
  const bindings = [negative, positive].map(text => ({ text, unitIds: [source.id] }));
  const units = new Map([[source.id, source]]);
  expect(recheckWikiTableNegation(warning, table, bindings, units)).toBe(true);
  expect(recheckWikiTableNegation(warning, table.replace("摘要模式", "搜索模式"), bindings, units)).toBe(false);
  expect(recheckWikiTableNegation(warning, table, bindings.slice(1), units)).toBe(false);
  expect(recheckWikiTableNegation(warning, table.replace(negative, "显示具体 SKU 信息"), bindings, units)).toBe(false);
});

it("distinguishes a point-in-time limitation from a later implementation proposal", () => {
  const source = point("state", "导出暂未包含完整审计记录。");
  const result = wikiTemporalClaim("导出目前不包含审计记录；计划增加审计下载。", [source], [], true);
  expect(result?.text).toBe("讨论当时的状态描述：导出 不包含审计记录。后续建议：增加审计下载。");
});

it("retains an omitted implementation boundary beside its plan and cites the historical report", () => {
  const state = point("state", "Checker 不检查账户重复或权限越界。");
  state.evidence = { ...state.evidence, role: "user", pasted: true };
  const plan = point("plan", "每次保存后运行 Checker，检查账户重复和权限越界。");
  const paragraphs = [{ subtopic: "验证规则", text: plan.statement, unitIds: [plan.id], claims: [{ text: plan.statement, unitIds: [plan.id] }] }];
  const chapters = [{ id: "c", title: "设置", question: "", group: "", body: plan.statement, problems: [], paragraphs }];
  const statuses = new Map([[state.id, "relayed" as const], [plan.id, "proposal" as const]]);
  expect(retainCapabilityReports(chapters, [state, plan], statuses)).toBe(2);
  expect(chapters[0].body).toContain("计划检查账户重复和权限越界");
  expect(paragraphs[1]).toMatchObject({ unitIds: [state.id], text: "项目发起人提供的资料记录了当时的实现边界，Checker 不检查账户重复或权限越界。" });
  expect(retainCapabilityReports(chapters, [state, plan], statuses)).toBe(0);
});

it("accepts a preventive wording and still rejects allowing the prohibited action", () => {
  const source = point("rule", "禁止加入 Inventory。");
  const prevented = "阻止加入 Inventory", allowed = "不会阻止加入 Inventory";
  expect(lostNegation(prevented, [source.statement])).toBeUndefined();
  expect(lostNegation(allowed, [source.statement])).toBeDefined();
  const notice = `"${prevented}…" drops the negation of "禁止加入 Inventory…"`;
  const table = `| 事项 | 要求 |\n| --- | --- |\n| 禁止项 | ${prevented} |`;
  expect(recheckWikiTableNegation(notice, table, [{ text: prevented, unitIds: [source.id] }], new Map([[source.id, source]]))).toBe(true);
});

it("keeps decision wording when confirmed and qualifies an assistant-only adoption claim", () => {
  const unit = { ...point("a", "应用采用 SQLite、Lit 和 Playwright。"), kind: "decision" as const };
  const claim = "技术栈确定为 SQLite、Lit 和 Playwright。";
  expect(wikiClaimStanding(claim, [unit], new Map([["a", "confirmed"]]), true)).toBeUndefined();
  expect(wikiOpeningStanding("数据存储在设备上，" + claim, [unit], new Map([["a", "proposal"]]), true))
    .toBe("数据存储在设备上。技术栈建议采用 SQLite、Lit 和 Playwright。");
  const condition = "如果离线回归通过";
  const conditional = { ...unit, conditions: [condition], evidence: { ...unit.evidence, quote: condition + "，" + unit.statement } };
  expect(wikiClaimStanding(claim, [conditional], new Map([["a", "proposal"]]), true)).toBeUndefined();
});

it("splits count goals into independently cited proposals and never adds an implementation report", () => {
  const first = { ...point("first", "第一版导入 12-18 个模板。"), kind: "plan" as const };
  const next = { ...point("next", "暂不扩充至 18 个模板，先验证现有 4 个模板，再逐步扩展至约 8 个模板。"), kind: "plan" as const };
  const statuses = new Map< string, import("../shared/wiki-knowledge").WikiUnitStatus>([["first", "proposal"], ["next", "proposal"]]);
  const result = wikiClaimStanding("第一版计划导入 12-18 个模板，但建议先验证 4 个模板，再扩展至 8 个模板。", [first, next], statuses, true);
  expect(result?.map(piece => piece.units.map(unit => unit.id))).toEqual([["first"], ["next"]]);
  expect(result?.[1].text).toContain("暂不扩充至 18 个模板");
  expect(wikiClaimStanding("V2 内置约 9 个模板。", [point("other", "V2 内置约 9 个模板。")], new Map([["other", "reported"]]), true)).toBeUndefined();
});
