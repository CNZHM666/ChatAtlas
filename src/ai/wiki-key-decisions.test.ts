import { expect, it } from "vitest";
import { ledgerDecisionsPending, wikiDecisionCandidates, wikiSameQuestions, wikiVersionQuestions, withDecision, withVersionAnswer } from "./wiki-key-decisions";
import { wikiUnitStatuses } from "./wiki-knowledge-write";
import { wikiLedgerUnits, withUserRelations } from "../shared/wiki-knowledge";
import type { WikiKnowledgeLedger, WikiKnowledgeUnit } from "../shared/wiki-knowledge";

const unit = (index: number, statement: string, extra: Partial<WikiKnowledgeUnit> = {}): WikiKnowledgeUnit => ({ id: `u${index}`, subject: "定位", statement, kind: "decision", details: [], evidence: { evidenceId: `e${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown", ...extra } as WikiKnowledgeUnit);
const ledgerOf = (units: WikiKnowledgeUnit[]): WikiKnowledgeLedger => ({ version: 1, generatedAt: 1, status: "complete", materials: units.length, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
  organization: { version: 1, generatedAt: 1, status: "complete", subjects: [{ id: "s", name: "定位", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], chapters: [{ id: "a", title: "产品定位", question: "?", group: "", subtopics: [{ title: "定位", subjectIds: ["s"] }] }], report: {} },
  draft: { version: 1, generatedAt: 5, status: "complete", report: {}, chapters: [] } } as unknown as WikiKnowledgeLedger);

it("lists a point restated several times once, ranked by mentions, with the latest wording", () => {
  const units = [
    unit(1, "ChatAtlas 定位为开源、本地优先且支持 BYOK 的 AI 对话知识管理工具。"),
    unit(2, "ChatAtlas 定位为本地优先、BYOK 的开源 AI 对话知识管理工具。"),
    unit(3, "第一版使用 MIT 许可证开源。"),
    unit(4, "我决定首页只保留搜索入口。", { evidence: { evidenceId: "e4", conversationId: "c", messageId: "m4", messageIndex: 4, role: "user", pasted: false, quote: "" }, adoption: { status: "user_decision" } }),
  ];
  const candidates = wikiDecisionCandidates(ledgerOf(units));
  // The user's own decision is not a candidate; the positioning, said twice, comes first in its latest wording.
  expect(candidates.map(item => item.unitIds)).toEqual([["u2", "u1"], ["u3"]]);
  expect(candidates[0]).toMatchObject({ statement: units[1].statement, chapter: "产品定位", status: "proposal" });
});

it("applies a verdict to every unit of the point, marks the draft out of date, and can be undone", () => {
  const ledger = ledgerOf([unit(1, "第一版使用 MIT 许可证开源。")]);
  const decided = withDecision(ledger, ["u1"], "confirmed");
  expect(ledgerDecisionsPending(decided)).toBe(true);
  expect(wikiDecisionCandidates(decided)[0]).toMatchObject({ verdict: "confirmed", status: "confirmed" });
  const undone = withDecision(decided, ["u1"], undefined);
  expect(undone.decisions).toEqual({});
  expect(wikiDecisionCandidates(undone)[0].verdict).toBeUndefined();
});

it("asks which roadmap holds now and which of two versions the AI changed, then writes the answers as verdicts", () => {
  const inMessage = (item: WikiKnowledgeUnit, messageId: string, messageIndex: number) => ({ ...item, kind: "plan" as const, evidence: { ...item.evidence, messageId, messageIndex } });
  const units = [
    inMessage(unit(1, "M1 全文检索，M2 混合检索。"), "old", 1), inMessage(unit(2, "M3 LLM 重排，M4 Agent 多轮查找。"), "old", 1),
    inMessage(unit(3, "M1 消息定位，M2 项目重建。"), "new", 9),
    unit(4, "索引放在内存里。", { kind: "mechanism" }), unit(5, "索引改放 IndexedDB。", { kind: "mechanism" }),
  ];
  const base = ledgerOf(units);
  const ledger = { ...base, organization: { ...base.organization!, relations: [{ older: "u4", newer: "u5", kind: "replaces" as const, status: "unresolved" as const }] } };
  const [roadmap, versions] = wikiVersionQuestions(ledger, true);
  expect(roadmap).toMatchObject({ kind: "roadmap", question: "开发路线现在按哪一套推进？" });
  // Newest first; each plan once, by its fullest step.
  expect(roadmap.options.map(option => option.unitIds)).toEqual([["u3"], ["u1", "u2"]]);
  expect(versions).toMatchObject({ kind: "versions", question: "「定位」先后有两种说法，现在用哪个？", pair: "u4>u5" });
  // The older roadmap chosen: confirmed, the newer one set aside; the question reads its answer back.
  const older = withVersionAnswer(ledger, roadmap, roadmap.options[1].id);
  const statuses = wikiUnitStatuses(wikiLedgerUnits(older), older.organization!, older.decisions);
  expect([statuses.get("u1"), statuses.get("u2"), statuses.get("u3")]).toEqual(["confirmed", "confirmed", "history"]);
  expect(wikiVersionQuestions(older, true)[0].answer).toBe(roadmap.options[1].id);
  expect(ledgerDecisionsPending(older)).toBe(true);
  // Both hold: both confirmed, and the writer sees them side by side rather than as a change.
  const both = withVersionAnswer(ledger, versions, "both");
  expect(wikiVersionQuestions(both, true)[1].answer).toBe("both");
  expect(withUserRelations(both).organization!.relations[0]).toMatchObject({ kind: "coexists", status: "resolved" });
  // Not settled: written as still open. No answer withdraws every verdict of the question.
  const open = withVersionAnswer(ledger, versions, "open");
  expect(wikiUnitStatuses(wikiLedgerUnits(open), open.organization!, open.decisions).get("u5")).toBe("open");
  const undone = withVersionAnswer(both, versions, undefined);
  expect(undone.decisions).toEqual({});expect(undone.coexisting).toBeUndefined();
});

it("does not ask which roadmap holds when the plans count different steps or none", () => {
  const plan = (n: number, text: string, messageId: string, messageIndex: number) => { const item = unit(n, text); return { ...item, kind: "plan" as const, evidence: { ...item.evidence, messageId, messageIndex } }; };
  // Versions beside weeks say two things side by side; the weekly plan ending in "v0.1 Beta" still counts weeks.
  const sideBySide = ledgerOf([plan(1, "v0.1 全文索引，v0.2 混合检索，v0.3 检索 Agent。", "old", 1), plan(2, "第1周打通导入，第2周补文档，第3周收集反馈，第4周公开 v0.1 Beta。", "new", 9)]);
  expect(wikiVersionQuestions(sideBySide, true)).toEqual([]);
  // Two milestone plans disagree on what M1 is: that is asked.
  const rival = ledgerOf([plan(1, "M1 全文检索，M2 混合检索。", "old", 1), plan(2, "M1 对话管理基础，M2 项目重建。", "new", 9)]);
  expect(wikiVersionQuestions(rival, true)).toMatchObject([{ kind: "roadmap" }]);
});

it("asks whether a point spread over chapters is one only when most of what was said resembles it", () => {
  const units = [unit(1, "原始消息是唯一事实来源，索引可重建。"), unit(2, "原始消息是事实来源，搜索索引是衍生数据。"),
    unit(3, "严格区分产品演变与正式版本。"), unit(4, "区分用户报告完成与代码验证完成。"), unit(5, "区分计划指标与已验证指标。")];
  const base = ledgerOf(units), organization = base.organization!;
  const member = (id: string) => ({ unitId: id, support: "", adds: [], role: "restates" as const });
  const ledger = { ...base, organization: { ...organization,
    subjects: [{ id: "s", name: "定位", aliases: [], unitIds: ["u1", "u3"] }, { id: "t", name: "状态", aliases: [], unitIds: ["u2", "u4", "u5"] }],
    chapters: [{ id: "a", title: "产品定位", question: "?", group: "", subtopics: [{ title: "定位", subjectIds: ["s"] }] }, { id: "b", title: "状态管理", question: "?", group: "", subtopics: [{ title: "状态", subjectIds: ["t"] }] }],
    groups: [{ id: "g1", core: "原始消息是事实来源，索引可重建。", homeSubjectId: "s", anchorUnitId: "u1", signature: "", members: [member("u1"), member("u2")] },
      // A summary of three different distinctions: none of them says it, so it is not put to the user.
      { id: "g2", core: "当前方案与旧方案明确区分。", homeSubjectId: "s", anchorUnitId: "u3", signature: "", members: [member("u3"), member("u4"), member("u5")] }] } } as unknown as WikiKnowledgeLedger;
  expect(wikiSameQuestions(ledger, true).map(question => question.groupId)).toEqual(["g1"]);
});
