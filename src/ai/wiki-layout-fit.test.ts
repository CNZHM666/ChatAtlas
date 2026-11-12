import { describe, expect, it } from "vitest";
import { routeWikiUnits, wikiUnitLane } from "./wiki-unit-routing";
import { answeredTogether } from "./wiki-user-questions";
import { wikiDraftOutOfPlace } from "./wiki-draft-fit";
import type { WikiKnowledgeLedger, WikiKnowledgeOrganization, WikiKnowledgeUnit } from "../shared/wiki-knowledge";

const unit = (id: string, subject: string, statement: string, kind: WikiKnowledgeUnit["kind"] = "decision"): WikiKnowledgeUnit => ({ id, subject, statement, kind, details: [], adoption: { status: "proposal" }, delivery: "unknown",
  evidence: { evidenceId: "e", conversationId: "c", messageId: `m-${id}`, messageIndex: 1, role: "assistant", pasted: false, quote: statement } });
const organization = (subjects: Array<[string, string[]]>, chapters: Array<[string, string, string[]]>): WikiKnowledgeOrganization => ({ version: 1, generatedAt: 0, status: "complete", merged: [], relations: [], report: {},
  subjects: subjects.map(([id, unitIds]) => ({ id, name: id, aliases: [], unitIds })), chapters: chapters.map(([id, title, subjectIds]) => ({ id, title, question: "", group: "", subtopics: [{ title, subjectIds }] })) });

describe("points routed by their role", () => {
  it("reads a screen's structure as the interface's, not the architecture's", () => {
    expect(wikiUnitLane(unit("a", "首页架构", "首页设计为“看板 + 报销列表”的混合模式。"))).toBeUndefined();
    expect(wikiUnitLane(unit("b", "技术架构", "服务端采用队列处理报销单。", "mechanism"))).toBe("technical");
  });

  it("never takes a chapter on how a feature works (审批机制) for the technical chapter", () => {
    const units = new Map([unit("t", "数据模型", "报销单以 claim、line、approval 三张表存储。", "mechanism")].map(item => [item.id, item]));
    const routed = routeWikiUnits(organization([["flow", []], ["arch", []], ["ui", ["t"]]], [["c1", "审批机制", ["flow"]], ["c2", "技术架构", ["arch"]], ["c3", "界面设计", ["ui"]]]), units);
    const chapterOf = (id: string) => routed.chapters.find(chapter => chapter.subtopics.some(topic => topic.subjectIds.some(subject => routed.subjects.find(item => item.id === subject)?.unitIds.includes(id))))?.title;
    expect(chapterOf("t")).toBe("技术架构");
  });
});

it("keeps an answered question's points where they read best when routing moves one of them", () => {
  const points = [unit("u1", "首页", "首页顶部放报销看板，列表放在看板下方。"), unit("u2", "首页", "首页列表按提交时间排序，看板显示本月报销总额。"), unit("u3", "首页", "首页看板显示待审批数量和本月报销总额。"),
    unit("u8", "首页", "首页顶部看板的数字使用大号字体，列表行高保持紧凑。"), unit("u9", "队列", "服务端采用消息队列异步处理报销单的审批通知。", "mechanism")];
  const units = new Map(points.map(item => [item.id, item]));
  const before = organization([["home", ["u1", "u2", "u3", "u8"]], ["queue", ["u9"]]], [["ui", "界面设计", ["home"]], ["tech", "技术架构", ["queue"]]]);
  const after = { ...before, subjects: [{ ...before.subjects[0], unitIds: ["u2", "u3", "u8"] }, { ...before.subjects[1], unitIds: ["u9", "u1"] }] };
  const answers = [{ questionId: "q", unitIds: ["u1", "u2", "u3"], question: "首页先放看板还是列表？", answer: "看板", optionId: "o1", at: 1 }];
  const report: Record<string, number> = {};
  const kept = answeredTogether(before, after, answers, report, {}, units);
  expect(kept.subjects.find(subject => subject.id === "home")!.unitIds).toEqual(["u2", "u3", "u8", "u1"]);
  expect(kept.subjects.find(subject => subject.id === "queue")!.unitIds).toEqual(["u9"]);
  expect(report).toMatchObject({ answered_kept_home: 1 });
  expect(report.answered_moved_together).toBeUndefined();
});

describe("a draft written for another layout", () => {
  const points = [unit("p1", "首页", "首页顶部放报销看板。"), unit("p2", "队列", "服务端采用消息队列异步处理审批通知。", "mechanism")];
  const ledger = (paragraphs: Array<{ chapter: string; unitIds: string[]; text?: string; subtopic?: string }>): WikiKnowledgeLedger => ({ version: 1, generatedAt: 0, status: "complete", materials: 1, batches: [{ sourceIds: [], status: "ok", units: points, rejected: {} }],
    organization: organization([["home", ["p1"]], ["queue", ["p2"]]], [["ui", "界面设计", ["home"]], ["tech", "技术架构", ["queue"]]]),
    draft: { version: 1, generatedAt: 1, status: "complete", report: {}, chapters: [["ui", "界面设计"], ["tech", "技术架构"]].map(([id, title]) => ({ id, title, question: "", group: "", body: "", problems: [],
      paragraphs: paragraphs.filter(item => item.chapter === id).map(item => ({ subtopic: item.subtopic ?? title, text: item.text ?? "正文。", unitIds: item.unitIds })) })) } });

  it("names the chapter telling another chapter's points, and none when each sits at home", () => {
    expect(wikiDraftOutOfPlace(ledger([{ chapter: "ui", unitIds: ["p1"] }, { chapter: "tech", unitIds: ["p2"] }]))).toEqual([]);
    expect(wikiDraftOutOfPlace(ledger([{ chapter: "ui", unitIds: ["p1"] }, { chapter: "tech", unitIds: ["p1"] }, { chapter: "tech", unitIds: ["p2"] }]))).toEqual(["技术架构"]);
  });

  it("leaves a source block beside its claim and earlier versions where the writer puts them", () => {
    const placed = [{ chapter: "ui", unitIds: ["p1"] }, { chapter: "tech", unitIds: ["p2"] }];
    expect(wikiDraftOutOfPlace(ledger([...placed, { chapter: "tech", unitIds: ["p1"], text: "*讨论中的原文代码 · AI 建议，未确认*\n\n```text\nboard\n```" }, { chapter: "tech", unitIds: ["p1"], subtopic: "早先版本", text: "- 此前曾提出……" }]))).toEqual([]);
  });

  it("names a chapter the organization has and the draft lacks", () => {
    const written = ledger([{ chapter: "ui", unitIds: ["p1"] }]);
    expect(wikiDraftOutOfPlace({ ...written, draft: { ...written.draft!, chapters: written.draft!.chapters.filter(chapter => chapter.id === "ui") } })).toEqual(["技术架构"]);
  });
});
