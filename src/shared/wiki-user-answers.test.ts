import { expect, it } from "vitest";
import { withUserAnswers, type WikiKnowledgeLedger, type WikiKnowledgeUnit } from "./wiki-knowledge";

const unit = (index: number, about?: string): WikiKnowledgeUnit => ({ id: `u${index}`, subject: "s", statement: `第 ${index} 条`, kind: "decision", details: [], evidence: { evidenceId: `e${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role: "assistant", pasted: false, quote: "" }, adoption: { status: "proposal" }, delivery: "unknown", ...(about ? { about: { name: about, role: "other_project" as const } } : {}) });
const ledger = (answers: Partial<WikiKnowledgeLedger>): WikiKnowledgeLedger => ({ version: 1, generatedAt: 1, status: "complete", materials: 6, batches: [{ sourceIds: [], status: "ok", units: [unit(1, "AI Circuit Studio"), unit(2, "AI Circuit Studio"), unit(3), unit(4), unit(5), unit(6, "Side Project")], rejected: {} }],
  organization: { version: 1, generatedAt: 1, status: "complete", merged: [], relations: [], report: {},
    subjects: [{ id: "hw", name: "硬件画布", aliases: [], unitIds: ["u1", "u2"] }, { id: "store", name: "存储", aliases: [], unitIds: ["u3", "u6"] }, { id: "ctx", name: "上下文", aliases: [], unitIds: ["u4", "u5"] }],
    groups: [{ id: "g1", core: "原始消息是事实来源。", homeSubjectId: "store", anchorUnitId: "u3", signature: "", members: [{ unitId: "u3", support: "", adds: [], role: "restates" }, { unitId: "u4", support: "", adds: [], role: "restates" }] }],
    chapters: [{ id: "a", title: "竞品分析", question: "", group: "", subtopics: [{ title: "直接竞品", subjectIds: ["hw"] }] }, { id: "b", title: "技术架构", question: "", group: "", subtopics: [{ title: "存储", subjectIds: ["store"] }, { title: "上下文", subjectIds: ["ctx"] }] }] },
  ...answers });

it("applies scope and same-point answers to the directory written from, leaving the stored one as planned", () => {
  const asked = ledger({ scopeAnswers: { aicircuitstudio: "related", sideproject: "exclude" }, sameGroups: ["g1"] });
  const answered = withUserAnswers(asked).organization!;
  // The other project leaves the competitor chapter (now empty, so gone) for a chapter of its own.
  expect(answered.chapters.map(chapter => chapter.title)).toEqual(["技术架构", "相关项目：AI Circuit Studio"]);
  expect(answered.chapters[1].subtopics).toEqual([{ title: "AI Circuit Studio", subjectIds: ["hw"] }]);
  // The excluded project's unit is gone; the point told twice gathers in its home subject.
  expect(answered.subjects.find(subject => subject.id === "store")!.unitIds).toEqual(["u3", "u4"]);
  expect(answered.subjects.find(subject => subject.id === "ctx")!.unitIds).toEqual(["u5"]);
  expect(asked.organization!.chapters.map(chapter => chapter.title)).toEqual(["竞品分析", "技术架构"]);
  // No answers, nothing changes.
  const plain = ledger({});
  expect(withUserAnswers(plain)).toBe(plain);
});

it("leaves out a chapter named for an excluded project and a subject mostly about it, untagged points and all", () => {
  const base = ledger({ scopeAnswers: { aicircuitstudio: "exclude" } }), organization = base.organization!;
  const named = withUserAnswers({ ...base, organization: { ...organization, chapters: [{ ...organization.chapters[0], title: "相关项目：AI Circuit Studio", subtopics: [{ title: "画布", subjectIds: ["hw", "ctx"] }] }, organization.chapters[1]] } }).organization!;
  // u4 and u5 are untagged: their subject sat in the excluded project's chapter, so it goes with it.
  expect(named.chapters.map(chapter => chapter.title)).toEqual(["技术架构"]);
  expect(named.chapters[0].subtopics.map(topic => topic.title)).toEqual(["存储"]);
  // A subject two thirds about the excluded project goes whole.
  const units = { ...base, batches: [{ ...base.batches[0], units: [...base.batches[0].units, { ...base.batches[0].units[0], id: "u7" }] }] };
  const mostly = withUserAnswers({ ...units, organization: { ...organization, subjects: organization.subjects.map(subject => subject.id === "ctx" ? { ...subject, unitIds: ["u1", "u7", "u5"] } : subject.id === "hw" ? { ...subject, unitIds: ["u2"] } : subject) } }).organization!;
  expect(mostly.subjects.map(subject => subject.id)).toEqual(["store"]);
});
