import { expect, it } from "vitest";
import { localRestatements, moveTechnicalSubjects, opposesSwitch, placeUnitsByKind, gatherAcrossStages, fillThinChapters, gatherTwins, explicitSwitches, organizeLedger, organizeWikiKnowledge, rebalanceChapters, splitByRelatedness, standApart } from "./wiki-knowledge-organize";
import type { StructuredAIRequest } from "./provider";
import { AIProviderResponseError } from "./provider-errors";
import { statementsConflict, type WikiKnowledgeLedger, type WikiKnowledgeUnit, type WikiSubject } from "../shared/wiki-knowledge";
import type { DirectoryPage } from "../shared/wiki-directory";

const signal = new AbortController().signal;
let next = 0;
const unit = (subject: string, statement: string, extra: { role?: "user" | "assistant"; index?: number; adoption?: WikiKnowledgeUnit["adoption"]["status"]; details?: string[]; pasted?: boolean } = {}): WikiKnowledgeUnit => {
  const index = extra.index ?? next++;
  return { id: `unit:${index}`, subject, statement, kind: "decision", details: extra.details ?? [], evidence: { evidenceId: `e:${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role: extra.role ?? "assistant", pasted: extra.pasted ?? false, quote: statement }, adoption: { status: extra.adoption ?? "proposal" }, delivery: "unknown" };
};
const ledger = (units: WikiKnowledgeUnit[]): WikiKnowledgeLedger => ({ version: 1, generatedAt: 0, status: "complete", materials: units.length, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }] });
/** The request payload as the fake model reads it. */
interface Payload { presentation: string; system?: string; names: Array<{ id: string; name: string }>; subjects: Array<{ id: string; name: string; units?: Array<{ id: string }> }>; anchors: Array<{ id: string; name: string }>; subtopics: Array<{ id: string; chapter: string; subtopic: string }> }
type Handler = (data: Payload) => unknown;
function model(handlers: Record<string, Handler>) {
  const calls: Payload[] = [];
  return { calls, ai: { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    const data = JSON.parse(request.prompt); calls.push({ ...data, system: request.system });
    const handler = handlers[data.presentation];
    if (!handler) throw new Error(`unexpected ${data.presentation}`);
    return request.validate(handler(data));
  } } };
}
// Names map to themselves unless listed; merges and relations default to none.
const subjects = (map: Record<string, string> = {}): Handler => data => ({ subjects: data.names.map((entry: { id: string; name: string }) => ({ name: map[entry.name] ?? entry.name, names: [entry.id] })) });
const noMerges: Handler = () => ({ duplicates: [], relations: [] });
const oneChapterPerSubject: Handler = data => ({ chapters: data.subjects.map((subject: { id: string; name: string }) => ({ title: subject.name, question: `${subject.name}是什么？`, group: "", subtopics: [{ title: subject.name, subjectIds: [subject.id] }] })) });
const run = (units: WikiKnowledgeUnit[], handlers: Record<string, Handler>, names: string[] = ["Atlas"]) => { const { ai, calls } = model(handlers); return organizeWikiKnowledge({ ledger: ledger(units), ai, locale: "zh-CN", signal, names, conversations: 1 }).then(result => ({ result, calls })); };

it("gives synonymous subject names one subject, across languages, and keeps the other spellings as aliases", async () => {
  const units = [unit("Context Engine", "按任务组装上下文。"), unit("上下文引擎", "上下文受 Token 预算约束。"), unit("Orama", "全文索引使用 Orama。")];
  const { result, calls } = await run(units, { wiki_subject_merge: subjects({ "Context Engine": "上下文引擎" }), wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject });
  expect(result.subjects.map(subject => [subject.name, subject.unitIds.length])).toEqual([["上下文引擎", 2], ["Orama", 1]]);
  expect(result.subjects[0].aliases).toEqual(["Context Engine"]);
  // Only subjects with two or more units are checked for duplicates.
  expect(calls.filter(call => call.presentation === "wiki_unit_merge")).toHaveLength(1);
  expect(result.status).toBe("complete");
});

it("never folds a learner's exercise into another, however alike their cues", async () => {
  const exercise = (index: number, code: string) => { const own = unit("条件判断", "第一题", { index }); return { ...own, evidence: { ...own.evidence, learnerCode: true as const, code: { language: "python", text: code } } }; };
  const units = [exercise(44, "age = 20\nif age >= 18:\n    print(\"Adult\")"), exercise(47, "if age >= 18 and has_ticket:\n    print(\"Enter\")")];
  const { result } = await run(units, { wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_merge: () => ({ duplicates: [["u1", "u2"]], relations: [] }) });
  expect(result.merged).toEqual([]);
  expect(result.subjects[0].unitIds).toHaveLength(2);
});

it("folds duplicates into the best-supported unit and resolves a replacement only from the user's own later words", async () => {
  const units = [
    unit("检索", "第一版用 SQLite FTS 做全文索引。", { index: 1 }),
    unit("检索", "全文索引用 SQLite FTS。", { index: 2, adoption: "user_adopted", details: ["SQLite FTS"] }),
    unit("检索", "改用 Orama 做全文索引。", { index: 5, role: "user" }),
    unit("检索", "改用 Elasticsearch。", { index: 7 }),
  ];
  const { result } = await run(units, {
    wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject,
    wiki_unit_merge: () => ({ duplicates: [["u1", "u2"]], relations: [{ older: "u1", newer: "u3", kind: "replaces" }, { older: "u3", newer: "u4", kind: "replaces" }, { older: "u4", newer: "u1", kind: "replaces" }] }),
  });
  // The adopted unit is kept and carries both units' details.
  expect(result.merged).toEqual([{ id: "unit:2", from: ["unit:1"], details: ["SQLite FTS"] }]);
  expect(result.subjects[0].unitIds).toEqual(["unit:2", "unit:5", "unit:7"]);
  // The merged-away older unit points at the kept one; an AI-only change stays open; a backwards relation is dropped.
  expect(result.relations).toEqual([{ older: "unit:2", newer: "unit:5", kind: "replaces", status: "resolved", evidence: "改用 Orama 做全文索引。" }, { older: "unit:5", newer: "unit:7", kind: "replaces", status: "unresolved" }]);
});

it("asks a cut-off duplicate check again in halves, once, with progress counted in units", async () => {
  const units = [1, 2, 3, 4, 5, 6].map(index => unit("检索", `检索要点 ${index}：全文索引第 ${index} 项。`, { index: 100 + index }));
  let merges = 0;
  const steps: Array<[number, number]> = [];
  const { ai } = model({ wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject,
    wiki_unit_merge: data => { merges++; const count = data.subjects.reduce((n, subject) => n + subject.units!.length, 0); if (count > 3) throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED"); return { duplicates: [], relations: [] }; } });
  const result = await organizeWikiKnowledge({ ledger: ledger(units), ai, locale: "zh-CN", signal, names: ["Atlas"], conversations: 1, progress: step => { if (step.stage === "merge") steps.push([step.done, step.total]); } });
  expect(merges).toBe(3);expect(result.report).toMatchObject({ merge_halved: 1 });
  expect(result.report.merge_failed).toBeUndefined();expect(result.status).toBe("complete");
  expect(steps).toEqual([[0, 6], [3, 6], [6, 6]]);
});

it("gives up a half that is cut off again", async () => {
  const units = [1, 2, 3, 4].map(index => unit("检索", `检索要点 ${index}：全文索引第 ${index} 项。`, { index: 200 + index }));
  let merges = 0;
  const { result } = await run(units, { wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_merge: () => { merges++; throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED"); } });
  expect(merges).toBe(3);expect(result.report).toMatchObject({ merge_halved: 1, merge_failed: 2 });
  expect(result.status).toBe("partial");
});

it("refuses a model duplicate that would lose a different point or a number, and keeps the more detailed statement", async () => {
  const units = [
    unit("上下文引擎", "上下文引擎按任务选择最相关的 Wiki 与决策。"),
    unit("上下文引擎", "上下文组装必须考虑 Token 预算。"),
    unit("阅读宽度", "正文宽度控制在 720–850px。"),
    unit("阅读宽度", "正文宽度控制在 720–850px，字号 15–16px。"),
    unit("侧边栏", "侧边栏是当前 AI 对话与知识库之间的桥梁。"),
    unit("侧边栏", "侧边栏定义为当前 AI 对话与知识库的桥梁，提供上下文复用。"),
  ];
  const { result } = await run(units, { wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_merge: data => ({ duplicates: data.subjects.map(subject => subject.units!.map(item => item.id)), relations: [] }) });
  // Only the two bridge statements are one point; the longer one is kept.
  expect(result.merged.map(row => [row.id, row.from])).toEqual([[units[5].id, [units[4].id]]]);
  expect(result.report.duplicates_rejected).toBe(2);
  // Two different points the model called one are not written together either.
  expect(result.restated ?? []).not.toContainEqual(expect.arrayContaining([units[0].id, units[1].id]));
});

it("writes a refused duplicate that only adds a name together with the kept unit, but never a conflicting one", async () => {
  const units = [
    unit("检索架构", "检索采用 IndexedDB + Orama 的本地架构，避免引入新的大型数据库。"),
    unit("检索架构", "检索采用 IndexedDB、Search Index Manager 与 Orama 的本地分层架构。"),
    unit("同步", "全文索引每 30 秒同步一次。"),
    unit("同步", "全文索引每 60 秒同步一次。"),
  ];
  const { result } = await run(units, { wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_merge: data => ({ duplicates: data.subjects.map(subject => subject.units!.map(item => item.id)), relations: [] }) });
  // Neither pair merges: one adds a name, the other gives another number.
  expect(result.merged).toEqual([]);
  // The added name is told with the kept statement; 30 秒 against 60 秒 is never one point.
  expect(result.restated?.map(ids => [...ids].sort())).toEqual([[units[0].id, units[1].id].sort()]);
  expect(result.report.restated_together).toBe(2);
});

it("asks once more when the directory names the project or leaves subjects out, then places what is still missing", async () => {
  const units = [unit("检索", "全文索引使用 Orama。"), unit("上下文引擎", "按任务组装上下文。"), unit("上下文预算", "上下文受 Token 预算约束。"), unit("侧边栏", "侧边栏只放搜索入口。")];
  const plans = [
    // First draft: a project-named chapter and a missing subject.
    (data: Payload) => ({ chapters: [{ title: "Atlas", question: "项目是什么？", group: "", subtopics: [{ title: "全部", subjectIds: [data.subjects[0].id, data.subjects[1].id] }] }, { title: "上下文", question: "如何组装上下文？", group: "", subtopics: [{ title: "上下文预算", subjectIds: [data.subjects[2].id] }] }] }),
    // Second draft fixes the title but still omits 侧边栏.
    (data: Payload) => ({ chapters: [{ title: "检索", question: "如何检索？", group: "", subtopics: [{ title: "全文索引", subjectIds: [data.subjects[0].id] }] }, { title: "上下文", question: "如何组装上下文？", group: "", subtopics: [{ title: "上下文引擎", subjectIds: [data.subjects[1].id] }, { title: "上下文预算", subjectIds: [data.subjects[2].id] }] }] }),
  ];
  let attempt = 0;
  const { result, calls } = await run(units, { wiki_subject_merge: subjects(), wiki_unit_merge: noMerges, wiki_subject_plan: data => plans[attempt++](data) });
  const planCalls = calls.filter(call => call.presentation === "wiki_subject_plan");
  expect(planCalls).toHaveLength(2);
  expect(planCalls[1].system).toContain("SECOND ATTEMPT");expect(planCalls[1].system).toContain("names the project");
  expect(result.chapters.map(chapter => chapter.title)).toEqual(["检索", "上下文"]);
  // Every subject has exactly one home; with placement unavailable, the omitted one joins a chapter locally.
  const placed = result.chapters.flatMap(chapter => chapter.subtopics.flatMap(topic => topic.subjectIds));
  expect(placed.sort()).toEqual(result.subjects.map(subject => subject.id).sort());
  expect(result.report).toMatchObject({ plan_requests: 2, plan_retried: 1, plan_missing: 1, place_failed: 1, plan_missing_model: 0, plan_missing_local: 1 });
});

it("lets the model place a subject the directory left out into an existing subtopic", async () => {
  const units = [unit("检索", "全文索引使用 Orama。"), unit("侧边栏", "侧边栏只放搜索入口。"), unit("上下文引擎", "按任务组装上下文。")];
  const { result, calls } = await run(units, {
    wiki_subject_merge: subjects(), wiki_unit_merge: noMerges,
    // 侧边栏 is never listed, in either attempt.
    wiki_subject_plan: data => ({ chapters: [{ title: "检索与界面", question: "如何找回历史？", group: "", subtopics: [{ title: "全文索引", subjectIds: [data.subjects[0].id] }, { title: "入口", subjectIds: [data.subjects[2].id] }] }] }),
    wiki_subject_place: data => ({ place: [{ id: data.subjects[0].id, subtopic: data.subtopics.find(slot => slot.subtopic === "入口")!.id }] }),
  });
  const entry = result.chapters[0].subtopics.find(topic => topic.title === "入口")!;
  expect(entry.subjectIds).toEqual([result.subjects[2].id, result.subjects[1].id]);
  expect(calls.filter(call => call.presentation === "wiki_subject_place")).toHaveLength(1);
  expect(result.report).toMatchObject({ plan_missing: 1, plan_missing_model: 1 });
  expect(result.report.plan_missing_local).toBeUndefined();
});

it("attaches small subjects to larger ones when there are too many for one directory", async () => {
  // Five anchors of three units, then 160 one-unit subjects: 165 names, above the 150 a directory reads well.
  const anchors = ["检索引擎", "上下文引擎", "侧边栏", "开发优先级", "产品定位"];
  const units = [...anchors.flatMap(name => [1, 2, 3].map(index => unit(name, `${name}的第 ${index} 条结论。`))), ...Array.from({ length: 160 }, (_, index) => unit(`细节主题 ${index}`, `第 ${index} 条细节。`))];
  const { result, calls } = await run(units, {
    wiki_subject_merge: subjects(), wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject,
    // Even-numbered details belong under the first anchor; odd ones are left as they are. One window answers with a
    // row per anchor and subject numbers, the other with the earlier row per subject: both are read.
    wiki_subject_attach: data => { const even = data.subjects.filter(subject => Number(subject.name.split(" ")[1]) % 2 === 0);
      return data.subjects[0].name.endsWith(" 0") ? { attach: [{ anchor: data.anchors[0].id, subjects: even.map(subject => Number(subject.id.slice(1))) }] } : { attach: even.map(subject => ({ id: subject.id, anchor: data.anchors[0].id })) }; },
  });
  const attach = calls.filter(call => call.presentation === "wiki_subject_attach");
  expect(attach).toHaveLength(2);
  expect(attach[0].anchors.map(anchor => anchor.name)).toEqual(anchors);
  expect(result.report.attached_subjects).toBe(80);
  expect(result.subjects).toHaveLength(5 + 80);
  expect(result.subjects.find(subject => subject.name === "检索引擎")!.unitIds).toHaveLength(3 + 80);
});

it("shows the directory only the largest subjects and places the rest into it", async () => {
  const units = [...["检索引擎", "上下文引擎"].flatMap(name => [1, 2, 3].map(index => unit(name, `${name}的第 ${index} 条结论。`))), ...Array.from({ length: 160 }, (_, index) => unit(`细节主题 ${index}`, `第 ${index} 条细节。`))];
  const { result, calls } = await run(units, {
    wiki_subject_merge: subjects(), wiki_unit_merge: noMerges, wiki_subject_attach: () => ({ attach: [] }),
    wiki_subject_plan: data => ({ chapters: [{ title: "检索", question: "如何检索？", group: "", subtopics: [{ title: "全部", subjectIds: data.subjects.map(subject => subject.id) }] }] }),
    wiki_subject_place: data => ({ place: data.subjects.map(subject => ({ id: subject.id, subtopic: data.subtopics[0].id })) }),
  });
  const plan = calls.find(call => call.presentation === "wiki_subject_plan")!;
  expect(plan.subjects).toHaveLength(150);expect(plan.subjects.slice(0, 2).map(subject => subject.name)).toEqual(["检索引擎", "上下文引擎"]);
  expect(result.report).toMatchObject({ plan_deferred: 12, plan_missing: 12, plan_missing_model: 12 });
  // Every subject is placed; a subtopic that would show too many points is split by subject.
  expect(result.chapters[0].subtopics.flatMap(topic => topic.subjectIds)).toHaveLength(162);
  expect(result.chapters[0].subtopics[0].title).toBe("全部");
  expect(result.chapters[0].subtopics.length).toBeGreaterThan(1);
  expect(result.report.plan_split).toBe(result.chapters[0].subtopics.length - 1);
});

it("keeps subjects and merges when the directory request fails, and marks the organization partial", async () => {
  const units = [unit("检索", "全文索引使用 Orama。"), unit("检索", "索引增量更新。")];
  const { result } = await run(units, { wiki_subject_merge: subjects(), wiki_unit_merge: noMerges, wiki_subject_plan: () => { throw new Error("provider down"); } });
  expect(result.status).toBe("partial");
  expect(result.subjects).toHaveLength(1);expect(result.chapters).toEqual([]);
  expect(result.report).toMatchObject({ plan_requests: 2, plan_failed: 2 });
});

it("names a unit by its own subject when the naming request leaves it out", async () => {
  const units = [unit("检索", "全文索引使用 Orama。"), unit("侧边栏", "侧边栏只放搜索入口。")];
  const { result } = await run(units, { wiki_subject_merge: data => ({ subjects: [{ name: "检索", names: [data.names[0].id] }] }), wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject });
  expect(result.subjects.map(subject => subject.name)).toEqual(["检索", "侧边栏"]);
  expect(result.report.subject_unassigned).toBe(1);
});

it("updates an organization without renaming known units, merging untouched subjects or planning again", async () => {
  const known = [unit("检索", "全文索引使用 Orama。", { index: 1 }), unit("检索", "索引每 30 秒更新。", { index: 2 }), unit("侧边栏", "侧栏默认收起。", { index: 3 }), unit("侧边栏", "侧栏只放搜索入口。", { index: 4 })];
  const first = await run(known, { wiki_subject_merge: subjects(), wiki_unit_merge: noMerges, wiki_subject_plan: data => ({ chapters: [{ title: "检索与入口", question: "如何找回？", group: "", subtopics: [{ title: "检索", subjectIds: [data.subjects[0].id] }, { title: "侧边栏", subjectIds: [data.subjects[1].id] }] }] }) });
  // One reply adds a unit to 检索 and a new subject 导出.
  const added = [unit("全文检索", "索引改为增量合并。", { index: 5 }), unit("导出", "导出提供 Markdown。", { index: 6 })];
  const { ai, calls } = model({
    wiki_subject_merge: data => ({ subjects: data.names.map(entry => ({ name: entry.name === "全文检索" ? "检索" : entry.name, names: [entry.id] })) }),
    wiki_unit_merge: noMerges,
    wiki_subject_place: data => ({ place: data.subjects.map(subject => ({ id: subject.id, subtopic: data.subtopics.find(slot => slot.subtopic === "检索")!.id })) }),
  });
  const result = await organizeWikiKnowledge({ ledger: ledger([...known, ...added]), ai, locale: "zh-CN", signal, names: ["Atlas"], conversations: 1, previous: first.result });
  // Only the two new units are named, with the existing subjects offered first.
  const naming = calls.filter(call => call.presentation === "wiki_subject_merge");
  expect(naming).toHaveLength(1);expect(naming[0].names.map(entry => entry.name)).toEqual(["全文检索", "导出"]);
  // Only 检索 gained a unit, so only it is checked for duplicates; the directory is not planned again.
  expect(calls.filter(call => call.presentation === "wiki_unit_merge").map(call => call.subjects.map(subject => subject.name))).toEqual([["检索"]]);
  expect(calls.some(call => call.presentation === "wiki_subject_plan")).toBe(false);
  expect(result.chapters).toHaveLength(1);expect(result.chapters[0].id).toBe(first.result.chapters[0].id);
  expect(result.chapters[0].subtopics.map(topic => topic.title)).toEqual(["检索", "侧边栏"]);
  const exportSubject = result.subjects.find(subject => subject.name === "导出")!;
  expect(result.chapters[0].subtopics[0].subjectIds).toContain(exportSubject.id);
  expect(result.report).toMatchObject({ incremental: 1, new_units: 2, affected_subjects: 2, new_subjects: 1 });
});

it("settles a change only on the user's changing words, keeps one without them unverified, and never mixes what units are about", async () => {
  // The user restating a point ("等于 Atlas 是自动整理这一层？") only adds to the older one.
  const notion = [unit("定位", "Atlas 不复制 Notion 的编辑功能。", { index: 1 }), unit("定位", "Atlas 是自动整理对话这一层。", { index: 2, role: "user" })];
  const restated = await run(notion, { wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_merge: () => ({ duplicates: [], relations: [{ older: "u1", newer: "u2", kind: "replaces" }] }) });
  // Missing change wording is not evidence of a supplement: the replacement stays unverified.
  expect(restated.result.relations).toEqual([{ older: "unit:1", newer: "unit:2", kind: "replaces", status: "unresolved" }]);
  expect(restated.result.report.relations_unverified).toBe(1);
  // Another project's units keep their own subject, even when the model names them after this project.
  const hardware = { ...unit("硬件架构", "以 Hardware IR 为统一数据来源。", { index: 3 }), about: { name: "AI Circuit Studio", role: "other_project" as const } };
  const own = unit("ChatAtlas", "全文索引使用 Orama。", { index: 4 });
  const mixed = await run([hardware, own], { wiki_subject_merge: data => ({ subjects: [{ name: "ChatAtlas", names: data.names.map(entry => entry.id) }] }), wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject }, ["ChatAtlas"]);
  expect(mixed.result.subjects.map(subject => subject.name).sort()).toEqual(["AI Circuit Studio 硬件架构", "ChatAtlas 概述"]);
});

it("splits a broad subject into coherent parts from its units' original topics, and keeps it when the answer is unusable", async () => {
  // 45 units the naming step put under one broad name: storage, ranking and success metrics.
  const areas = ["存储持久化", "检索排序", "成功指标"];
  const units = Array.from({ length: 45 }, (_, index) => unit(`${areas[index % 3]}${index}`, `${areas[index % 3]}的第 ${index} 条结论。`, { index }));
  const broad: Handler = data => ({ subjects: [{ name: "检索技术要求", names: data.names.map(entry => entry.id) }] });
  const split: Handler = data => { const entries = (data as unknown as { entries: Array<{ id: string; name: string }> }).entries; return { parts: areas.map(area => ({ name: area, names: entries.filter(entry => entry.name.startsWith(area)).map(entry => entry.id) })) }; };
  const { result, calls } = await run(units, { wiki_subject_merge: broad, wiki_subject_split: split, wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject });
  expect(result.subjects.map(subject => [subject.name, subject.unitIds.length])).toEqual([["存储持久化", 15], ["检索排序", 15], ["成功指标", 15]]);
  expect(result.report).toMatchObject({ split_requests: 1, split_subjects: 1 });
  expect(calls.find(call => call.presentation === "wiki_subject_split")!.system).toContain("never the project's name");
  // One part, or only the project's name, is no split.
  const kept = await run(units, { wiki_subject_merge: broad, wiki_subject_split: () => ({ parts: [{ name: "Atlas", names: ["n1"] }, { name: "全部", names: ["n2"] }] }), wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject });
  expect(kept.result.subjects.map(subject => subject.name)).toEqual(["检索技术要求"]);
  expect(kept.result.report.split_failed).toBe(1);
});

it("splits a large subject in windows: later windows reuse the parts, and a failed later window keeps the split", async () => {
  const areas = ["存储持久化", "检索排序"];
  const units = Array.from({ length: 60 }, (_, index) => unit(`${areas[index % 2]}${index}`, `${areas[index % 2]}的第 ${index} 条结论。`, { index }));
  const broad: Handler = data => ({ subjects: [{ name: "系统架构", names: data.names.map(entry => entry.id) }] });
  const byArea: Handler = data => { const entries = (data as unknown as { entries: Array<{ id: string; name: string }> }).entries; return { parts: areas.map(area => ({ name: area, names: entries.filter(entry => entry.name.startsWith(area)).map(entry => entry.id) })) }; };
  const { result, calls } = await run(units, { wiki_subject_merge: broad, wiki_subject_split: byArea, wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject });
  const windows = calls.filter(call => call.presentation === "wiki_subject_split") as unknown as Array<{ count: number; parts?: string[] }>;
  expect(windows.map(call => [call.count, call.parts])).toEqual([[50, undefined], [10, ["存储持久化", "检索排序"]]]);
  expect(result.subjects.map(subject => [subject.name, subject.unitIds.length])).toEqual([["存储持久化", 30], ["检索排序", 30]]);
  // The second window fails: its entries join the largest part, and the split stands.
  let seen = 0;
  const flaky: Handler = data => { if (seen++) throw new Error("truncated"); return byArea(data); };
  const partial = await run(units, { wiki_subject_merge: broad, wiki_subject_split: flaky, wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject });
  expect(partial.result.subjects.map(subject => subject.unitIds.length).reduce((sum, count) => sum + count, 0)).toBe(60);
  expect(partial.result.subjects).toHaveLength(2);expect(partial.result.report).toMatchObject({ split_subjects: 1, split_windows_failed: 1 });
});

it("merges synonymous subjects before planning, never across what units are about or into one too large", async () => {
  const units = [unit("上下文引擎", "按任务组装上下文。", { index: 1 }), unit("Context Engine 核心架构", "上下文受 Token 预算约束。", { index: 2 }),
    { ...unit("Mem0 上下文引擎", "Mem0 保存事实条目。", { index: 3 }), about: { name: "Mem0", role: "reference" as const } }, unit("侧边栏", "侧栏默认收起。", { index: 4 })];
  const same: Handler = data => { const subjects = data.subjects as Array<{ id: string; name: string }>; return { same: [subjects.filter(subject => /上下文引擎|Context Engine/u.test(subject.name)).map(subject => subject.id)] }; };
  const { result } = await run(units, { wiki_subject_merge: subjects(), wiki_subject_same: same, wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject });
  // The two names of this project's engine join; Mem0's subject stays its own.
  expect(result.subjects.map(subject => [subject.name, subject.unitIds.length])).toEqual([["上下文引擎", 2], ["Mem0 上下文引擎", 1], ["侧边栏", 1]]);
  expect(result.report).toMatchObject({ same_requests: 1, same_merged: 1, same_refused: 1 });
});

it("asks a failed synonym window again in halves", async () => {
  const units = Array.from({ length: 90 }, (_, index) => unit(`主题${index}`, `第 ${index} 条结论。`, { index }));
  let calls = 0;
  const same: Handler = data => { calls++; const subjects = data.subjects as Array<{ id: string; name: string }>; if (subjects.length > 50) throw new Error("truncated"); const pair = subjects.filter(subject => subject.name === "主题1" || subject.name === "主题2"); return { same: pair.length === 2 ? [pair.map(subject => subject.id)] : [] }; };
  const { result } = await run(units, { wiki_subject_merge: subjects(), wiki_subject_attach: () => ({ attach: [] }), wiki_subject_same: same, wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject });
  expect(calls).toBe(3);expect(result.report).toMatchObject({ same_halved: 1, same_merged: 1 });
  expect(result.subjects.find(subject => subject.name === "主题1")!.unitIds).toHaveLength(2);
});

it("never lets a question and its answer replace each other", async () => {
  const asked = { ...unit("检索", "采用哪种检索技术？", { index: 1, role: "user" }), kind: "question" as const }, answer = unit("检索", "建议采用混合检索。", { index: 2 });
  const { result } = await run([asked, answer], { wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_merge: () => ({ duplicates: [], relations: [{ older: "u1", newer: "u2", kind: "replaces" }] }) });
  expect(result.relations).toEqual([{ older: asked.id, newer: answer.id, kind: "supplements", status: "resolved" }]);
  expect(result.report.relations_question).toBe(1);
});

it("never merges as duplicates statements that differ in obligation or numbers", async () => {
  const units = [unit("检索", "全文搜索必须在本地调用生成模型。", { index: 1 }), unit("检索", "全文搜索禁止在本地调用生成模型。", { index: 2 }), unit("检索", "索引每 30 秒更新一次。", { index: 3 }), unit("检索", "索引每 60 秒更新一次。", { index: 4 })];
  const { result } = await run(units, { wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_merge: () => ({ duplicates: [["u1", "u2"], ["u3", "u4"]], relations: [] }) });
  expect(result.merged).toEqual([]);
  expect(result.subjects[0].unitIds).toHaveLength(4);
  expect(result.report.duplicates_rejected).toBe(2);
});


it("splits a catch-all left after the first split once more, and never asks again for one the model declined", async () => {
  const units = Array.from({ length: 100 }, (_, index) => unit(`原题${index}`, `第${index}项知识点内容各不相同，编号${index}。`, { index: 500 + index }));
  const splits: Array<{ subject: string; first: boolean }> = [];
  const halves = (data: Payload & { subject?: string; parts?: string[]; entries?: Array<{ id: string }> }, a: string, b: string) => ({ parts: [{ name: a, names: data.entries!.slice(0, Math.ceil(data.entries!.length / 2)).map(item => item.id) }, { name: b, names: data.entries!.slice(Math.ceil(data.entries!.length / 2)).map(item => item.id) }] });
  const { result } = await run(units, {
    wiki_subject_merge: data => ({ subjects: [{ name: "大杂烩", names: data.names.map(entry => entry.id) }] }),
    wiki_subject_same: () => ({ same: [] }), wiki_unit_merge: noMerges, wiki_unit_groups: () => ({ groups: [] }), wiki_subject_plan: oneChapterPerSubject,
    wiki_subject_split: raw => {
      const data = raw as Payload & { subject?: string; parts?: string[]; entries?: Array<{ id: string }> };
      splits.push({ subject: data.subject!, first: !data.parts });
      // The first split leaves nearly everything in one part; that part is split again on the second round.
      if (data.subject === "大杂烩") return data.parts ? { parts: [{ name: "检索架构", names: data.entries!.map(item => item.id) }] } : { parts: [{ name: "检索架构", names: data.entries!.slice(0, 45).map(item => item.id) }, { name: "侧边栏", names: data.entries!.slice(45).map(item => item.id) }] };
      return data.parts ? { parts: [{ name: data.parts[0], names: data.entries!.map(item => item.id) }] } : halves(data, "索引", "存储");
    },
  });
  expect(splits.filter(item => item.first).map(item => item.subject)).toEqual(["大杂烩", "检索架构"]);
  expect(result.subjects.map(subject => [subject.name, subject.unitIds.length]).sort()).toEqual([["侧边栏", 5], ["存储", 25], ["索引", 70]].sort());
  expect(result.report).toMatchObject({ split_subjects: 2, split_second_round: 1 });
});

it("tells the planner what each subject covers, not only one sample", async () => {
  const units = [unit("索引更新", "索引每 30 秒增量更新。"), unit("存储结构", "消息按条单独存储。"), unit("存储结构", "会话表保存标题。")];
  const { calls } = await run(units, { wiki_subject_merge: subjects({ 索引更新: "技术架构与数据模型", 存储结构: "技术架构与数据模型" }), wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject });
  const plan = calls.find(call => call.presentation === "wiki_subject_plan")! as unknown as { system: string; subjects: Array<{ name: string; covers?: string[] }> };
  expect(plan.subjects[0].covers).toEqual(["存储结构", "索引更新"]);
  expect(plan.system).toContain("belongs with the techniques");
});

it("moves a technical subject the planner put under a workflow chapter to the technical chapter's closest subtopic", () => {
  const subject = (id: string, name: string, aliases: string[] = []): [string, WikiSubject] => [id, { id, name, aliases, unitIds: [`${id}:u`] }];
  const subjects = new Map([
    subject("s1", "上下文组装与交付机制", ["Atlas Context Engine", "Context Engine 核心逻辑", "Context Retriever", "Context Composer"]),
    subject("s2", "上下文导出机制", ["导出与复用架构", "导出文件结构"]),
    subject("s3", "检索架构与模块设计"), subject("s4", "分层架构与模块设计", ["Context Engine 模块"]), subject("s5", "竞品技术路线与架构"),
  ]);
  const page = (title: string, subtopics: Array<[string, string[]]>): DirectoryPage => ({ title, group: "", question: "", sectionIds: [], subtopics: subtopics.map(([name, ids]) => ({ title: name, question: "", sectionIds: ids })) });
  const pages = [page("核心工作流", [["上下文导出与复用", ["s2", "s1"]]]), page("技术架构与数据设计", [["检索与索引", ["s3"]], ["整体架构", ["s4"]]]), page("市场与竞争分析", [["竞品", ["s5"]]])];
  const report: Record<string, number> = {};
  moveTechnicalSubjects(pages, subjects, report);
  // The engine leaves the workflow for the subtopic sharing its terms; one architecture alias keeps the export
  // where it is, and a technical subject outside a workflow chapter stays.
  expect(pages[0].subtopics![0].sectionIds).toEqual(["s2"]);
  expect(pages[1].subtopics![1].sectionIds).toEqual(["s4", "s1"]);
  expect(pages[2].subtopics![0].sectionIds).toEqual(["s5"]);
  expect(report.plan_moved_technical).toBe(1);
});

it("keeps the earlier organization when a new directory comes back with no chapter, and marks the failure", async () => {
  const units = [unit("检索", "全文索引使用 Orama。"), unit("侧边栏", "侧边栏只放搜索入口。")];
  const good = await organizeLedger(ledger(units), { ...model({ wiki_subject_merge: subjects(), wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject }), locale: "zh-CN", signal, names: ["Atlas"], conversations: 1 });
  expect(good.organization?.chapters).toHaveLength(2);expect(good.lastFailure).toBeUndefined();
  // Every directory request fails: no chapter, so the earlier directory stays.
  const failing = model({ wiki_subject_merge: subjects(), wiki_unit_merge: noMerges, wiki_subject_plan: () => { throw new TypeError("Failed to fetch"); }, wiki_subject_place: () => { throw new TypeError("Failed to fetch"); } });
  const kept = await organizeLedger(good, { fresh: true, ai: failing.ai, locale: "zh-CN", signal, names: ["Atlas"], conversations: 1 });
  expect(kept.organization).toBe(good.organization);expect(kept.lastFailure?.step).toBe("organize");
  // The next success clears the mark.
  const again = await organizeLedger(kept, { ...model({ wiki_subject_merge: subjects(), wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject }), locale: "zh-CN", signal, names: ["Atlas"], conversations: 1 });
  expect(again.lastFailure).toBeUndefined();expect(again.organization?.chapters).toHaveLength(2);
});

it("names the first window alone, then the rest in parallel with its names, applied in window order", async () => {
  // 300 distinct subject names: four windows of up to 80.
  const units = Array.from({ length: 300 }, (_, index) => unit(`话题${index}`, `第 ${index} 个话题的结论。`, { index: 10_000 + index }));
  const seen: Array<{ first: string; existing: string[] }> = [];
  let running = 0, peak = 0;
  const { ai } = model({
    wiki_subject_merge: data => { const payload = data as unknown as { existing: string[]; names: Array<{ id: string; name: string }> }; seen.push({ first: payload.names[0].name, existing: payload.existing });
      // The first window names its topics 主题A; later windows reuse what they are given or keep their own names.
      return { subjects: payload.names.map(entry => ({ name: payload.existing.length ? entry.name : "主题A", names: [entry.id] })) }; },
    wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject, wiki_subject_attach: () => ({ attach: [] }), wiki_subject_split: () => ({ parts: [] }), wiki_subject_same: () => ({ same: [] }), wiki_subject_place: () => ({ placements: [] }),
  });
  const slow = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => { running++; peak = Math.max(peak, running); await new Promise(resolve => setTimeout(resolve, 5)); try { return await ai.generateStructured(request); } finally { running--; } } };
  const result = await organizeWikiKnowledge({ ledger: ledger(units), ai: slow, locale: "zh-CN", signal, names: ["Atlas"], conversations: 1 });
  const naming = seen.filter(call => call.first.startsWith("话题"));
  expect(naming).toHaveLength(4);
  // Window 1 sees no names; the later windows all see exactly the names window 1 chose.
  expect(naming[0].existing).toEqual([]);expect(naming.slice(1).map(call => call.existing)).toEqual([["主题A"], ["主题A"], ["主题A"]]);
  expect(peak).toBeGreaterThanOrEqual(2);
  expect(result.report.subject_parallel_windows).toBe(3);
});

it("keeps the earlier directory on a reorganization while its subjects still fall into it, and plans again when they do not", async () => {
  const units = [unit("检索", "全文索引使用 Orama。"), unit("检索", "索引在后台增量更新。"), unit("侧边栏", "侧边栏只放搜索入口。"), unit("侧边栏", "侧边栏默认收起。")];
  const named = (title: string): Handler => data => ({ chapters: [{ title, question: `${title}？`, group: "", subtopics: data.subjects.map((subject: { id: string; name: string }) => ({ title: subject.name, subjectIds: [subject.id] })) }] });
  const handlers = (plan: Handler) => ({ wiki_subject_merge: subjects(), wiki_unit_merge: noMerges, wiki_subject_plan: plan });
  const first = await organizeWikiKnowledge({ ledger: ledger(units), ...model(handlers(named("功能与检索"))), locale: "zh-CN", signal, names: ["Atlas"], conversations: 1 });
  // A second planner would title the chapter differently; the earlier one stays, with no planning request.
  const again = model(handlers(named("另一个目录")));
  const kept = await organizeWikiKnowledge({ ledger: ledger(units), ai: again.ai, locale: "zh-CN", signal, names: ["Atlas"], conversations: 1, directory: first });
  expect(kept.chapters.map(chapter => chapter.title)).toEqual(["功能与检索"]);
  expect(kept.chapters).toEqual(first.chapters);
  expect(again.calls.some(call => call.presentation === "wiki_subject_plan")).toBe(false);
  expect(kept.report).toMatchObject({ plan_kept: 1, plan_kept_share: 100 });
  // New units mostly elsewhere: too few fall where they were, so the directory is planned again.
  const other = [...units, ...["导出提供 Markdown。", "导出附带来源。", "导出按章节拆分。", "导出支持 JSON。", "导出保留引用。"].map(text => unit("导出", text))];
  const replanned = await organizeWikiKnowledge({ ledger: ledger(other), ...model(handlers(named("另一个目录"))), locale: "zh-CN", signal, names: ["Atlas"], conversations: 1, directory: first });
  expect(replanned.chapters.map(chapter => chapter.title)).toEqual(["另一个目录"]);
  expect(replanned.report.plan_kept).toBeUndefined();expect(replanned.report.plan_kept_refused).toBe(44);
});

it("reads the compact subject answer: names once, one index per supplied name", async () => {
  const units = [unit("上下文引擎", "上下文引擎负责组装上下文。"), unit("Context Engine", "Context Engine 读取项目知识。"), unit("全文索引", "全文索引使用 Orama。")];
  const compact: Handler = data => { const names = [...new Set(data.names.map((entry: { name: string }) => entry.name === "Context Engine" ? "上下文引擎" : entry.name))] as string[]; return { subjects: names, assign: data.names.map((entry: { name: string }) => names.indexOf(entry.name === "Context Engine" ? "上下文引擎" : entry.name)) }; };
  const { result } = await run(units, { wiki_subject_merge: compact, wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject });
  expect(result.subjects.map(subject => [subject.name, subject.unitIds.length]).sort()).toEqual([["上下文引擎", 2], ["全文索引", 1]]);
});

it("reads the compact attach answer: one anchor position per small subject, -1 to leave it", async () => {
  const anchors = ["检索引擎", "上下文引擎", "侧边栏", "开发优先级", "产品定位"];
  const units = [...anchors.flatMap(name => [1, 2, 3].map(index => unit(name, `${name}的第 ${index} 条结论。`))), ...Array.from({ length: 160 }, (_, index) => unit(`细节主题 ${index}`, `第 ${index} 条细节。`))];
  const { result } = await run(units, {
    wiki_subject_merge: subjects(), wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject,
    wiki_subject_attach: data => ({ place: data.subjects.map((subject: { name: string }) => Number(subject.name.split(" ")[1]) % 2 === 0 ? 1 : -1) }),
  });
  expect(result.report.attached_subjects).toBe(80);
  expect(result.subjects.find(subject => subject.name === "上下文引擎")!.unitIds).toHaveLength(3 + 80);
});

it("moves a positioning subject the planner put under the technical chapter back to the positioning chapter", () => {
  const subject = (id: string, name: string): [string, WikiSubject] => [id, { id, name, aliases: [], unitIds: [`${id}:u`] }];
  const subjects = new Map([subject("p1", "产品定位与核心价值"), subject("p2", "核心痛点"), subject("t1", "存储与索引架构"), subject("t2", "产品定位与架构约束")]);
  const page = (title: string, subtopics: Array<[string, string[]]>): DirectoryPage => ({ title, group: "", question: "", sectionIds: [], subtopics: subtopics.map(([name, ids]) => ({ title: name, question: "", sectionIds: ids })) });
  const pages = [page("产品愿景与用户价值", [["核心功能与定位", ["p1"]]]), page("技术架构与数据模型", [["产品核心功能与架构", ["p2", "t1", "t2"]]])];
  const report: Record<string, number> = {};
  moveTechnicalSubjects(pages, subjects, report);
  // The pain point goes home; a subject whose name is also technical (架构) stays with the technical chapter.
  expect(pages[0].subtopics![0].sectionIds).toEqual(["p1", "p2"]);
  expect(pages[1].subtopics![0].sectionIds).toEqual(["t1", "t2"]);
  expect(report.plan_moved_positioning).toBe(1);
});

it("compares units of different subjects once more, so one point told under two subjects is merged", async () => {
  const units = [
    unit("检索", "检索层继续使用 IndexedDB 与 Orama，不引入新的向量数据库或 GraphRAG。", { index: 1 }),
    unit("检索", "搜索结果按消息聚合到所属对话。", { index: 2 }),
    unit("存储", "存储层继续使用 IndexedDB 与 Orama，不引入新的向量数据库或 GraphRAG 框架。", { index: 3 }),
    unit("存储", "消息按 conversationId 关联到对话表。", { index: 4 }),
  ];
  const { result, calls } = await run(units, {
    wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_groups: () => ({ groups: [] }), wiki_subject_same: () => ({ same: [] }),
    // Within one subject nothing repeats; the group spanning both subjects holds the same constraint twice.
    wiki_unit_merge: data => data.subjects.some(subject => subject.name.includes(" / ")) ? { duplicates: [data.subjects[0].units!.map(item => item.id)], relations: [] } : { duplicates: [], relations: [] },
  });
  const cross = calls.filter(call => call.presentation === "wiki_unit_merge" && call.subjects.some(subject => subject.name.includes(" / ")));
  expect(cross).toHaveLength(1);
  expect(cross[0].subjects[0].units).toHaveLength(2);
  // The longer statement stays, in its own subject; the other subject keeps only its own point.
  expect(result.merged).toEqual([{ id: "unit:3", from: ["unit:1"], details: [] }]);
  expect(result.subjects.find(subject => subject.name === "检索")?.unitIds).toEqual(["unit:2"]);
  expect(result.report?.cross_clusters).toBe(1);
});

it("merges a restatement naming one option fewer into the fuller unit, and still refuses another option or a lifted prohibition", async () => {
  const units = [
    unit("检索", "继续复用 IndexedDB 与 Orama，不引入 GraphRAG 或新的数据库。", { index: 1 }),
    unit("检索", "继续复用 IndexedDB 与 Orama，不引入 GraphRAG、Agent 框架或新的数据库系统。", { index: 2 }),
    unit("索引", "全文索引使用 Orama 在浏览器本地完成。", { index: 3 }),
    unit("索引", "全文索引使用 SQLite 在浏览器本地完成。", { index: 4 }),
    unit("导入", "导入时不自动发送任何对话到第三方模型。", { index: 5 }),
    unit("导入", "导入时自动发送对话到第三方模型做摘要。", { index: 6 }),
  ];
  const { result } = await run(units, { wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_merge: data => ({ duplicates: data.subjects.map(subject => subject.units!.map(item => item.id)), relations: [] }) });
  expect(result.merged.map(row => [row.id, row.from])).toEqual([[units[1].id, [units[0].id]]]);
  expect(result.report.duplicates_rejected).toBe(2);
});

it("moves parts split off a far longer chapter to the chapter sharing their words, never a planned subtopic", () => {
  const subject = (id: string, name: string): [string, WikiSubject] => [id, { id, name, aliases: [], unitIds: [] }];
  const alias = new Map([subject("s1", "检索引擎"), subject("s2", "索引分块"), subject("s3", "产品定位与目标用户"), subject("s4", "首页布局"), subject("s5", "产品定位口号"), subject("s6", "向量检索")]);
  const topic = (title: string, ids: string[]) => ({ title, question: "", sectionIds: ids });
  const planned = topic("检索引擎", ["s1"]), positioning = topic("产品定位与目标用户", ["s3"]), vectors = topic("向量检索", ["s6"]);
  const pages: DirectoryPage[] = [
    { title: "技术架构", group: "", question: "", sectionIds: ["s1", "s2", "s3", "s6"], subtopics: [planned, topic("索引分块", ["s2"]), positioning, vectors] },
    { title: "产品愿景", group: "", question: "", sectionIds: ["s5"], subtopics: [topic("产品定位口号", ["s5"])] },
    { title: "界面设计", group: "", question: "", sectionIds: ["s4"], subtopics: [topic("首页布局", ["s4"])] },
  ];
  const report: Record<string, number> = {};
  rebalanceChapters(pages, new Set([positioning, vectors]), alias, () => 10, 8, report);
  // The positioning part joins the vision chapter; the technical chapter is then within the ceiling, so the vector part stays.
  expect(pages[0].subtopics!.map(item => item.title)).toEqual(["检索引擎", "索引分块", "向量检索"]);
  expect(pages[1].subtopics!.map(item => item.title)).toEqual(["产品定位口号", "产品定位与目标用户"]);
  expect(pages[1].sectionIds).toContain("s3");
  expect(report.plan_rebalanced).toBe(1);
});

it("merges a rewording that shares few words when the statement vectors are close, and still refuses a different number or a prohibition", async () => {
  const units = [
    unit("产品定位", "ChatAtlas 定位为独立于任何 AI 平台、持续更新且用户可验证的项目知识工作区。", { index: 1 }),
    unit("目标用户", "ChatAtlas 是帮助长期 AI 项目跨平台延续工作的工具。", { index: 2 }),
    unit("检索", "已预热的本地全文搜索 P95 在 500ms 以内。", { index: 3 }),
    unit("检索", "已预热的本地混合搜索 P95 在 2 秒以内。", { index: 4 }),
    unit("插入", "确认后插入当前 AI 输入框，不自动发送。", { index: 5 }),
    unit("插入", "确认后插入当前 AI 输入框并自动发送。", { index: 6 }),
  ];
  // Close vectors for each pair; only the first pair is one point.
  const table: Record<string, number[]> = { [units[0].statement]: [1, 0, 0, 0], [units[1].statement]: [.96, .28, 0, 0], [units[2].statement]: [0, 1, 0, 0], [units[3].statement]: [0, .97, .24, 0], [units[4].statement]: [0, 0, 0, 1], [units[5].statement]: [0, 0, .25, .97] };
  const embeddings = { modelKey: "fake", embedText: async (text: string) => table[text], embedBatch: async (texts: string[]) => texts.map(text => table[text]) };
  const { ai, calls } = model({ wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_groups: () => ({ groups: [] }), wiki_subject_same: () => ({ same: [] }),
    // The model calls every recalled group one point; the local guard decides.
    wiki_unit_merge: data => ({ duplicates: data.subjects.map(subject => subject.units!.map(item => item.id)).filter(ids => ids.length > 1), relations: [] }) });
  const result = await organizeWikiKnowledge({ ledger: ledger(units), ai, embeddings, locale: "zh-CN", signal, names: ["Atlas"], conversations: 1 });
  expect(result.merged.map(row => [row.id, row.from])).toEqual([[units[0].id, [units[1].id]]]);
  expect(result.report).toMatchObject({ semantic_units: 6, cross_semantic: 1 });
  expect(calls.some(call => call.presentation === "wiki_unit_merge" && call.subjects.some(subject => subject.name.includes("产品定位") && subject.name.includes("目标用户")))).toBe(true);
});

it("asks the merge model for one point told in other words, not only for replaceable copies", async () => {
  const units = [unit("产品定位", "ChatAtlas 定位为独立于 AI 平台的项目知识工作区。", { index: 1 }), unit("产品定位", "ChatAtlas 是帮助长期 AI 项目跨平台延续工作的工具。", { index: 2 })];
  const { calls } = await run(units, { wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_merge: noMerges });
  const merge = calls.find(call => call.presentation === "wiki_unit_merge")!;
  // A restated positioning is a duplicate the guard then checks; it is no longer filed as a supplement.
  expect(merge.system).toContain("the same positioning restated across messages is one point");
  expect(merge.system).toContain("Restating the same goal or positioning in other words is a duplicate");
  expect(merge.system).not.toContain("any one could replace the others");
});

it("tells a conflict between two statements by clause: a negated clause against the same clause, or another number", () => {
  expect(statementsConflict("发送前确认，不自动发送。", "自动发送到对话框。")).toBe(true);
  expect(statementsConflict("全文索引每 30 秒同步一次。", "全文索引每 60 秒同步一次。")).toBe(true);
  // A prohibition on something the other does not state is no conflict.
  expect(statementsConflict("检索采用 IndexedDB + Orama，避免引入新的大型数据库。", "检索采用 IndexedDB、Search Index Manager 与 Orama 的分层架构。")).toBe(false);
});

it("moves a unit written together with one under another subject to that subject, so one chapter writes both", async () => {
  const units = [
    unit("检索", "检索采用 IndexedDB + Orama 的本地架构，避免引入新的大型数据库。"),
    unit("检索", "搜索结果按时间排序展示。"),
    unit("架构", "检索采用 IndexedDB、Search Index Manager 与 Orama 的本地分层架构。"),
    unit("架构", "导出面板提供三档预算。"),
  ];
  const architecture = (data: Payload) => ({ duplicates: data.subjects.map(subject => (subject.units ?? []).filter(item => (item as { statement?: string }).statement?.includes("Orama")).map(item => item.id)).filter(ids => ids.length > 1), relations: [] });
  const { result } = await run(units, { wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_merge: architecture });
  expect(result.merged).toEqual([]);
  expect(result.restated?.map(ids => [...ids].sort())).toEqual([[units[0].id, units[2].id].sort()]);
  // The shorter statement moves to the kept (fuller) one's subject, in discussion order; each subject keeps a unit of its own.
  expect(result.subjects.map(subject => [subject.name, subject.unitIds])).toEqual([["检索", [units[1].id]], ["架构", [units[0].id, units[2].id, units[3].id]]]);
  expect(result.report.restated_moved).toBe(1);
});

it("settles the user's choice among the assistant's proposals without words of change", async () => {
  const dark = unit("首页", "保留现有的深色极简首页布局。", { index: 900 }), light = unit("首页", "采用浅色极简风格，包含居中欢迎区。", { index: 901, role: "user", adoption: "user_decision" });
  const { result } = await run([dark, light], { wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_merge: () => ({ duplicates: [], relations: [{ older: "u1", newer: "u2", kind: "replaces" }] }) });
  expect(result.relations).toEqual([expect.objectContaining({ older: dark.id, newer: light.id, kind: "replaces", status: "resolved" })]);
  expect(result.report.relations_choice).toBe(1);
});

it("finds the same point told again under other subjects locally, by holder, never across a conflict", () => {
  const units = [
    unit("技术架构", "Service Worker 可能终止，不能依赖全局变量长期保存状态，需持久化索引。"),
    unit("搜索架构", "Chrome MV3 Service Worker 可能终止，不能依赖全局变量长期保存状态，需持久化索引。"),
    unit("用户看法", "Service Worker 可能终止，不能依赖全局变量长期保存状态，需持久化索引。", { role: "user" }),
    unit("同步", "全文索引每 30 秒同步一次，失败后重试三次并记录日志。"),
    unit("同步", "全文索引每 60 秒同步一次，失败后重试三次并记录日志。"),
  ];
  // The user's own words are another holder; 30 秒 against 60 秒 is a conflict.
  expect(localRestatements(units)).toEqual([[units[0].id, units[1].id]]);
});

it("asks once which statements conflict with the user's decisions, and lets the decision settle the assistant's", async () => {
  const decision = unit("上下文引擎", "停止优化纯规则生成的 Context Pack，改为接入 LLM 进行语义分析。", { index: 950, role: "user", adoption: "user_decision" });
  const rule = unit("基础功能", "基础功能使用确定性规则生成 Context Pack，LLM 总结仅作为后续增强。", { index: 951 });
  const other = unit("首页", "首页保持极简。", { index: 952 });
  let asked: Payload | undefined;
  const { result } = await run([decision, rule, other], { wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_merge: noMerges,
    wiki_decision_conflicts: data => { asked = data; return { conflicts: [{ decision: "d1", candidates: ["c1"] }] }; } });
  // Only statements sharing the decision's terms are candidates.
  expect((asked as unknown as { decisions: Array<{ candidates: Array<{ statement: string }> }> }).decisions[0].candidates.map(item => item.statement)).toEqual([rule.statement]);
  expect(result.relations).toContainEqual(expect.objectContaining({ older: rule.id, newer: decision.id, kind: "replaces", status: "resolved" }));
  expect(result.report.decision_conflicts).toBe(1);
});

it("splits a long subtopic into parts of related subjects, not in list order", () => {
  const subject = (id: string, name: string, size: number): [string, WikiSubject] => [id, { id, name, aliases: [], unitIds: Array.from({ length: size }, (_, index) => `${id}${index}`) }];
  const alias = new Map([subject("a", "数据采集", 30), subject("b", "隐私合规", 30), subject("c", "数据迁移", 5), subject("d", "隐私授权", 5), subject("e", "采集容错", 2)]);
  const parts = splitByRelatedness(["a", "b", "c", "d", "e"], "数据采集与导入", alias, id => alias.get(id)!.unitIds.length);
  // The part sharing the planned title's words keeps it and comes first; 隐私授权 joins 隐私合规 though listed after 数据迁移.
  expect(parts).toEqual([["a", "c", "e"], ["b", "d"]]);
});

it("gives a large subject sharing nothing with its subtopic a subtopic of its own", () => {
  const subject = (id: string, name: string, size: number): [string, WikiSubject] => [id, { id, name, aliases: [], unitIds: Array.from({ length: size }, (_, index) => `${id}${index}`) }];
  const alias = new Map([subject("a", "数据模型设计", 15), subject("b", "Token Budget", 12), subject("c", "索引更新", 11), subject("d", "命名", 3)]);
  const pages: DirectoryPage[] = [{ title: "技术架构", group: "", question: "", sectionIds: ["a", "b", "c", "d"], subtopics: [{ title: "数据存储与索引", question: "", sectionIds: ["a", "b", "c", "d"] }] }];
  const report: Record<string, number> = {};
  standApart(pages, alias, 8, report);
  // 索引更新 shares 索引 with the heading and the small 命名 is left: only Token Budget stands apart, right after.
  expect(pages[0].subtopics!.map(topic => [topic.title, topic.sectionIds])).toEqual([["数据存储与索引", ["a", "c", "d"]], ["Token Budget", ["b"]]]);
  expect(report.plan_stood_apart).toBe(1);
  // A chapter at its subtopic limit keeps the subject where it was.
  const full: DirectoryPage[] = [{ title: "技术架构", group: "", question: "", sectionIds: ["a", "b"], subtopics: [{ title: "数据存储与索引", question: "", sectionIds: ["a", "b"] }] }];
  standApart(full, alias, 1, {});
  expect(full[0].subtopics!).toHaveLength(1);
});

it("asks a naming window cut off at the output limit again as two halves", async () => {
  const units = Array.from({ length: 60 }, (_, index) => unit(`话题${index}`, `第 ${index} 个话题的结论。`, { index: 20_000 + index }));
  const sizes: number[] = [];
  const { ai } = model({
    wiki_subject_merge: data => { const payload = data as unknown as { names: Array<{ id: string; name: string }> }; sizes.push(payload.names.length);
      if (payload.names.length === 60) throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED");
      return { subjects: ["主题B"], assign: payload.names.map(() => 0) }; },
    wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject, wiki_subject_attach: () => ({ attach: [] }), wiki_subject_split: () => ({ parts: [] }), wiki_subject_same: () => ({ same: [] }), wiki_subject_place: () => ({ placements: [] }),
  });
  const result = await organizeWikiKnowledge({ ledger: ledger(units), ai, locale: "zh-CN", signal, names: ["Atlas"], conversations: 1 });
  expect(sizes.slice(0, 3)).toEqual([60, 30, 30]);
  expect(result.report).toMatchObject({ subject_halved: 1 });
  expect(result.report.subject_unassigned).toBeUndefined();
});

it("asks an attach window cut off at the output limit again as two halves, with a cap that grows with the window", async () => {
  const anchors = ["检索引擎", "上下文引擎", "侧边栏", "开发优先级", "产品定位"];
  const units = [...anchors.flatMap(name => [1, 2, 3].map(index => unit(name, `${name}的第 ${index} 条结论。`))), ...Array.from({ length: 160 }, (_, index) => unit(`细节主题 ${index}`, `第 ${index} 条细节。`))];
  const sizes: number[] = [];
  const { result, calls } = await run(units, {
    wiki_subject_merge: subjects(), wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject,
    wiki_subject_attach: data => { sizes.push(data.subjects.length); if (data.subjects.length === 80 && data.subjects[0].name.endsWith(" 0")) throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED");
      return { attach: data.subjects.map(subject => ({ id: subject.id, anchor: data.anchors[0].id })) }; },
  });
  expect(sizes.filter(size => size === 40)).toHaveLength(2);
  expect(result.report).toMatchObject({ attach_halved: 1, attached_subjects: 160 });
  expect(result.report.attach_failed).toBeUndefined();
  expect(calls.length).toBeGreaterThan(0);
});

it("asks a naming window that broke off for another reason again in halves, twice at most", async () => {
  const units = Array.from({ length: 60 }, (_, index) => unit(`话题${index}`, `第 ${index} 个话题的结论。`, { index: 30_000 + index }));
  const sizes: number[] = [];
  const { ai } = model({
    wiki_subject_merge: data => { const payload = data as unknown as { names: Array<{ id: string; name: string }> }; sizes.push(payload.names.length);
      if (payload.names[0].name === "话题0") throw new AIProviderResponseError("PROVIDER_STREAM_INCOMPLETE");
      return { subjects: ["主题C"], assign: payload.names.map(() => 0) }; },
    wiki_unit_merge: noMerges, wiki_subject_plan: oneChapterPerSubject, wiki_subject_attach: () => ({ attach: [] }), wiki_subject_split: () => ({ parts: [] }), wiki_subject_same: () => ({ same: [] }), wiki_subject_place: () => ({ placements: [] }),
  });
  const result = await organizeWikiKnowledge({ ledger: ledger(units), ai, locale: "zh-CN", signal, names: ["Atlas"], conversations: 1 });
  // The whole window, then its halves, then the failing half's halves; the quarter breaking off again is not split further.
  expect(sizes.slice(0, 3)).toEqual([60, 30, 30]);
  expect(sizes).toContain(15);
  expect(result.report).toMatchObject({ subject_halved: 2, subject_failed: 1, subject_unassigned: 15 });
});

it("reads a statement saying not to use what a decision switches to as the approach it left", () => {
  const decision = "决定停止优化纯规则生成的 Context Pack，改为接入 LLM 进行语义分析和内容整理。";
  expect(opposesSwitch(decision, "ChatAtlas 的上下文功能默认直接打包 Project Brief 和选中的 Wiki 章节，不重新调用 LLM。")).toBe(true);
  // Using it, or not using something else, is no opposite.
  expect(opposesSwitch(decision, "LLM 仅用于分析候选结果以兼顾速度与成本。")).toBe(false);
  expect(opposesSwitch(decision, "基础搜索不依赖 API Key。")).toBe(false);
  expect(opposesSwitch("改用 IndexedDB 保存索引。", "索引无需使用 IndexedDB，放在内存即可。")).toBe(true);
});

it("puts a statement saying not to use what a decision switches to first among its conflict candidates", async () => {
  const decision = unit("上下文引擎", "停止优化纯规则生成的 Context Pack，改为接入 LLM 进行语义分析。", { index: 960, role: "user", adoption: "user_decision" });
  const packed = unit("上下文", "上下文功能默认直接打包 Project Brief 和选中的 Wiki 章节，不重新调用 LLM。", { index: 961 });
  const other = unit("首页", "首页保持极简。", { index: 962 });
  let asked: Payload | undefined;
  const { result } = await run([decision, packed, other], { wiki_subject_merge: subjects(), wiki_subject_plan: oneChapterPerSubject, wiki_unit_merge: noMerges,
    wiki_decision_conflicts: data => { asked = data; return { conflicts: [{ decision: "d1", candidates: ["c1"] }] }; } });
  expect((asked as unknown as { decisions: Array<{ candidates: Array<{ statement: string }> }> }).decisions[0].candidates.map(item => item.statement)).toEqual([packed.statement]);
  expect(result.relations).toContainEqual(expect.objectContaining({ older: packed.id, newer: decision.id, kind: "replaces" }));
});

it("joins the most alike subtopics of a chapter that would read more than six", async () => {
  const names = ["检索引擎", "索引分块", "数据存储", "上下文引擎", "知识图谱", "隐私安全", "外部集成"];
  const units = names.flatMap(name => [1, 2].map(index => unit(name, `${name}的第 ${index} 条结论。`)));
  const { result } = await run(units, { wiki_subject_merge: subjects(), wiki_unit_merge: noMerges,
    wiki_subject_plan: data => ({ chapters: [{ title: "技术架构", question: "?", group: "", subtopics: data.subjects.map(subject => ({ title: subject.name, subjectIds: [subject.id] })) }] }) });
  expect(result.chapters[0].subtopics).toHaveLength(6);
  expect(result.chapters[0].subtopics.flatMap(topic => topic.subjectIds)).toHaveLength(7);
  expect(result.report.plan_joined).toBe(1);
});

it("puts a chapter about another project after this project's own chapters", async () => {
  const units = [unit("检索引擎", "全文索引使用 Orama。"), unit("硬件画布", "AI Circuit Studio 采用 Hardware IR。"), unit("开发规划", "第一版先做导入。")];
  const { result } = await run(units, { wiki_subject_merge: subjects(), wiki_unit_merge: noMerges,
    wiki_subject_plan: data => ({ chapters: data.subjects.map(subject => ({ title: subject.name === "硬件画布" ? "相关项目：AI Circuit Studio" : subject.name, question: "?", group: "", subtopics: [{ title: subject.name, subjectIds: [subject.id] }] })) }) });
  expect(result.chapters.map(chapter => chapter.title)).toEqual(["检索引擎", "开发规划", "相关项目：AI Circuit Studio"]);
});

it("names a chapter mostly about another project for it and puts it last", async () => {
  const atlas = (text: string) => ({ ...unit("个人方向", text), about: { name: "ChatAtlas", role: "other_project" as const } });
  const units = [atlas("ChatAtlas 恢复过去的理解。"), unit("检索引擎", "全文索引使用 Orama。"), atlas("ChatAtlas 区分已定与建议。"), unit("个人方向", "知识管理需要区分状态。"), atlas("ChatAtlas 导出 Markdown。")];
  const { result } = await run(units, { wiki_subject_merge: subjects(), wiki_unit_merge: noMerges,
    wiki_subject_plan: data => ({ chapters: [{ title: "个人方向与学习路线", question: "?", group: "", subtopics: data.subjects.filter(subject => subject.name !== "检索引擎").map(subject => ({ title: subject.name, subjectIds: [subject.id] })) }, { title: "检索", question: "?", group: "", subtopics: data.subjects.filter(subject => subject.name === "检索引擎").map(subject => ({ title: subject.name, subjectIds: [subject.id] })) }] }) });
  expect(result.chapters.map(chapter => chapter.title)).toEqual(["检索", "相关项目：ChatAtlas"]);
  expect(result.report.plan_related_named).toBe(1);
});

it("moves this project's own mechanisms out of a comparison chapter, keeping what is about other products", () => {
  const subject = (id: string, name: string): [string, WikiSubject] => [id, { id, name, aliases: [], unitIds: [`${id}:u`] }];
  const subjects = new Map([subject("s1", "性能优化"), subject("s2", "增量更新与缓存机制"), subject("s3", "竞品分析"), subject("s4", "Mem0 技术选型与依赖引入策略"), subject("s5", "检索与索引引擎")]);
  const page = (title: string, subtopics: Array<[string, string[]]>): DirectoryPage => ({ title, group: "", question: "", sectionIds: [], subtopics: subtopics.map(([name, ids]) => ({ title: name, question: "", sectionIds: ids })) });
  const pages = [page("竞品分析与参考项目", [["直接竞品", ["s3"]], ["开源参考", ["s4"]], ["性能优化", ["s1", "s2"]]]), page("技术架构与数据处理", [["检索与索引", ["s5"]]])];
  const report: Record<string, number> = {};
  moveTechnicalSubjects(pages, subjects, report, id => id === "s4");
  expect(pages[0].subtopics!.map(topic => topic.title)).toEqual(["直接竞品", "开源参考"]);
  expect(pages[1].subtopics![0].sectionIds).toEqual(["s5", "s1", "s2"]);
  // Without knowing what is about other products, nothing leaves the comparison chapter.
  const kept = [page("竞品分析", [["性能优化", ["s1"]]]), page("技术架构", [["检索", ["s5"]]])];
  moveTechnicalSubjects(kept, subjects, {});
  expect(kept[0].subtopics).toHaveLength(1);
});

it("writes a sizes-and-colours rule from the technical chapter in the interface chapter, and an electrical check the other way", () => {
  const units = new Map([
    unit("AI 核心", "Executor 输出 candidateProject 和 changes。"), unit("AI 核心", "正文最小字号为14px，行高设为1.65。"),
    unit("首页", "首页以输入框为视觉中心，大量留白。"), unit("首页", "Validator 检查电压兼容、GPIO 重复和 I²C 地址冲突。"),
    unit("首页", "架构图与接线图彻底分开，接线模式展示 GPIO21->SDA 引脚。"),
    unit("电气校验", "检测 I²C 总线上的地址冲突。"),
  ].map(item => [item.id, item]));
  const ids = [...units.keys()];
  const organization = { version: 1, generatedAt: 0, status: "complete", merged: [], relations: [], report: {},
    subjects: [{ id: "core", name: "AI 核心", aliases: [], unitIds: ids.slice(0, 2) }, { id: "home", name: "首页", aliases: [], unitIds: ids.slice(2, 5) }, { id: "check", name: "电气校验", aliases: [], unitIds: [ids[5]] }],
    chapters: [{ id: "a", title: "界面设计与视觉规范", question: "?", group: "", subtopics: [{ title: "首页", subjectIds: ["home"] }] }, { id: "b", title: "技术架构与核心引擎", question: "?", group: "", subtopics: [{ title: "核心", subjectIds: ["core", "check"] }] }] } as unknown as Parameters<typeof placeUnitsByKind>[0];
  const report: Record<string, number> = {};
  const placed = placeUnitsByKind(organization, units, report);
  const home = (name: string) => placed.subjects.find(subject => subject.unitIds.includes(ids.find(id => units.get(id)!.statement.startsWith(name))!))?.id;
  expect(home("正文最小字号")).toBe("home");
  expect(home("Validator 检查电压")).toBe("check");
  // What the user is shown stays with the interface, however electrical.
  expect(home("架构图与接线图")).toBe("home");
  expect(report.units_placed_by_kind).toBe(2);
});

it("moves what the project is to the positioning chapter and page sizes from any chapter to the interface", () => {
  const units = new Map([
    unit("用户", "目标用户是大学生和创客。"), unit("首页", "首页以输入框为视觉中心。"),
    unit("路线", "项目定位为面向硬件初学者的自然语言设计工作台。"), unit("路线", "第一阶段先做 Mock AI。"),
    unit("文档", "Welcome 页面 max-width 为 760~800px，Solution Draft 页面为 880px。"), unit("文档", "README 先写产品定义。"),
  ].map(item => [item.id, item]));
  const ids = [...units.keys()];
  const organization = { version: 1, generatedAt: 0, status: "complete", merged: [], relations: [], report: {},
    subjects: [{ id: "users", name: "用户", aliases: [], unitIds: [ids[0]] }, { id: "home", name: "首页", aliases: [], unitIds: [ids[1]] }, { id: "road", name: "路线", aliases: [], unitIds: ids.slice(2, 4) }, { id: "docs", name: "文档", aliases: [], unitIds: ids.slice(4) }],
    chapters: [{ id: "p", title: "产品定位与用户价值", question: "?", group: "", subtopics: [{ title: "用户", subjectIds: ["users"] }] }, { id: "a", title: "界面设计与交互体验", question: "?", group: "", subtopics: [{ title: "首页", subjectIds: ["home"] }] },
      { id: "d", title: "开发规划与外部参考", question: "?", group: "", subtopics: [{ title: "路线", subjectIds: ["road"] }, { title: "文档", subjectIds: ["docs"] }] }] } as unknown as Parameters<typeof placeUnitsByKind>[0];
  const report: Record<string, number> = {};
  const placed = placeUnitsByKind(organization, units, report);
  const home = (name: string) => placed.subjects.find(subject => subject.unitIds.includes(ids.find(id => units.get(id)!.statement.startsWith(name))!))?.id;
  expect(home("项目定位为")).toBe("users");
  expect(home("Welcome 页面")).toBe("home");
  expect(home("第一阶段")).toBe("road");expect(home("README")).toBe("docs");
  expect(report.units_placed_by_kind).toBe(2);
});

it("gathers each stage's component count, and a limit of now beside the check it lacks, under one subject", () => {
  const units = new Map([
    unit("技术栈", "在 6 个元件的链路稳定前，严禁扩展元件库。"), unit("元件库", "第一版元件数据库仅收录约 20-30 种高频使用元件。"),
    unit("路线", "V1 版本支持 ESP32 及 50-100 个常用模块。"), unit("路线", "第一阶段只用 5 个测试元件。"),
    unit("AI", "当前画布仅为架构预览，Validator 不检查电压/GPIO 冲突/电源安全。"), unit("校验", "实现 validateProject 函数检查电压兼容、GPIO 重复与地址冲突。"),
    unit("安全", "API Key 默认仅保存在当前浏览器会话中，不保存到服务器。"),
  ].map(item => [item.id, item]));
  const ids = [...units.keys()];
  const organization = { version: 1, generatedAt: 0, status: "complete", merged: [], relations: [], report: {},
    subjects: [{ id: "stack", name: "技术栈", aliases: [], unitIds: [ids[0]] }, { id: "parts", name: "元件库", aliases: [], unitIds: [ids[1]] }, { id: "road", name: "路线", aliases: [], unitIds: ids.slice(2, 4) }, { id: "ai", name: "AI", aliases: [], unitIds: [ids[4]] }, { id: "check", name: "校验", aliases: [], unitIds: [ids[5]] }, { id: "safe", name: "安全", aliases: [], unitIds: [ids[6]] }],
    chapters: [{ id: "t", title: "技术架构", question: "?", group: "", subtopics: [{ title: "栈", subjectIds: ["stack", "parts", "ai", "check", "safe"] }] }, { id: "d", title: "开发规划", question: "?", group: "", subtopics: [{ title: "路线", subjectIds: ["road"] }] }] } as unknown as Parameters<typeof gatherAcrossStages>[0];
  const report: Record<string, number> = {};
  const gathered = gatherAcrossStages(organization, units, report);
  const home = (start: string) => gathered.subjects.find(subject => subject.unitIds.includes(ids.find(id => units.get(id)!.statement.startsWith(start))!))?.id;
  expect([home("在 6 个"), home("第一版元件"), home("V1 版本")]).toEqual(["road", "road", "road"]);
  expect(home("当前画布")).toBe("check");
  // A rule about now is no limit.
  expect(home("API Key")).toBe("safe");
  expect(report).toEqual({ stage_counts_gathered: 2, current_limits_gathered: 1 });
});

it("reads a statement doing what a decision says it is instead of as the approach it left", () => {
  const decision = "实施 BYOK 模式，由用户提供 API 密钥而非使用服务端环境变量。";
  expect(opposesSwitch(decision, "利用 Next.js API Routes 处理 LLM 请求，API Key 存储于服务器环境变量。")).toBe(true);
  // A statement refusing it too, or about something else, is no opposite.
  expect(opposesSwitch(decision, "API Key 严禁写入 localStorage。")).toBe(false);
  expect(opposesSwitch(decision, "首页以输入框为视觉中心。")).toBe(false);
});

it("fills a thin positioning chapter from other chapters and joins another thin chapter to its nearest", () => {
  const names = ["成功标准", "首页布局", "视觉规范", "技术栈", "数据模型", "开发路线", "行业背景与竞品", "文档维护", "产品定位", "开发文档导出"];
  const alias = new Map(names.map((name, index) => [`s${index}`, { id: `s${index}`, name, aliases: [], unitIds: Array.from({ length: index === 0 || index === 9 ? 1 : 20 }, (_, unit) => `u${index}:${unit}`) }]));
  const pages = [
    { title: "产品定位与用户价值", subtopics: [{ title: "成功标准", sectionIds: ["s0"] }] },
    { title: "界面设计", subtopics: [{ title: "首页", sectionIds: ["s1"] }, { title: "视觉", sectionIds: ["s2"] }] },
    { title: "技术架构", subtopics: [{ title: "技术栈", sectionIds: ["s3"] }, { title: "数据模型", sectionIds: ["s4"] }] },
    { title: "开发规划", subtopics: [{ title: "路线", sectionIds: ["s5"] }, { title: "行业背景与竞品分析", sectionIds: ["s6"] }, { title: "文档", sectionIds: ["s7", "s8"] }] },
    { title: "开发文档导出", subtopics: [{ title: "导出", sectionIds: ["s9"] }] },
  ];
  const report: Record<string, number> = {};
  const kept = fillThinChapters(pages.map(page => ({ ...page, group: "", question: "", sectionIds: [], subtopics: page.subtopics.map(topic => ({ ...topic, question: "" })) })), alias, id => alias.get(id)!.unitIds.length, 6, report);
  expect(kept.map(page => page.title)).toEqual(["产品定位与用户价值", "界面设计", "技术架构", "开发规划"]);
  expect(kept[0].subtopics!.map(topic => topic.title)).toEqual(["成功标准", "行业背景与竞品分析", "产品定位"]);
  expect(kept[3].subtopics!.map(topic => topic.title)).toEqual(["路线", "文档", "导出"]);
  expect(report).toEqual({ thin_filled: 2, thin_merged: 1 });
});

it("gathers one rule said in two subjects where both read best, never into the positioning chapter", () => {
  const units = new Map([
    unit("视觉识别", "Vision Model 不是事实源，识别结果必须经 Catalog Match 和用户确认后才能写入 Inventory。"), unit("视觉识别", "识别结果展示最多 3 个候选项。"),
    unit("元件库", "Vision Model 不是事实源，识别结果必须经过 Catalog Match 和用户确认才能写入 Inventory。"), unit("元件库", "Catalog 描述元件事实，Inventory 描述用户拥有的元件。"), unit("元件库", "Inventory 与 Hardware IR 分开存储。"),
    unit("价值", "Orama 内存索引不自动永久保存，需负责序列化、持久化和崩溃恢复。"), unit("性能", "Orama 内存索引不会自动永久保存，项目需负责序列化、持久化和崩溃恢复。"),
  ].map(item => [item.id, item]));
  const ids = [...units.keys()];
  const organization = { version: 1, generatedAt: 0, status: "complete", merged: [], relations: [], report: {},
    subjects: [{ id: "vision", name: "视觉识别", aliases: [], unitIds: ids.slice(0, 2) }, { id: "parts", name: "元件库", aliases: [], unitIds: ids.slice(2, 5) }, { id: "value", name: "价值", aliases: [], unitIds: [ids[5]] }, { id: "speed", name: "性能", aliases: [], unitIds: [ids[6]] }],
    chapters: [{ id: "p", title: "产品定位与核心价值", question: "?", group: "", subtopics: [{ title: "价值", subjectIds: ["value"] }] }, { id: "t", title: "技术架构", question: "?", group: "", subtopics: [{ title: "识别", subjectIds: ["vision"] }, { title: "元件", subjectIds: ["parts"] }, { title: "性能", subjectIds: ["speed"] }] }] } as unknown as Parameters<typeof gatherTwins>[0];
  const report: Record<string, number> = {};
  const gathered = gatherTwins(organization, units, report);
  const home = (id: string) => gathered.subjects.find(subject => subject.unitIds.includes(id))?.id;
  // Its candidates and confirmation are told under 视觉识别: the twins meet there.
  expect([home(ids[0]), home(ids[2])]).toEqual(["vision", "vision"]);
  expect([home(ids[5]), home(ids[6])]).toEqual(["speed", "speed"]);
  expect(report.twins_gathered).toBe(2);
});

it("reads an approach a later choice says it is chosen instead of as replaced, and a contrast as nothing", () => {
  const units = new Map([
    { ...unit("后端", "初期利用 Next.js API Routes 处理 LLM 请求，API Key 仅存于服务器环境变量。"), evidence: { ...unit("后端", "").evidence, messageIndex: 19 } },
    { ...unit("密钥", "确定采用 BYOK 模式，由用户提供 API 密钥，而非仅使用服务端环境变量。"), evidence: { ...unit("密钥", "").evidence, messageIndex: 106 } },
    { ...unit("定位", "核心目标用户是长期使用多个 AI 的开发者，而非所有多 AI 用户。"), evidence: { ...unit("定位", "").evidence, messageIndex: 107 } },
    { ...unit("定位", "面向所有 AI 用户的对话管家。"), evidence: { ...unit("定位", "").evidence, messageIndex: 5 } },
  ].map(item => [item.id, item]));
  const ids = [...units.keys()];
  const organization = { version: 1, generatedAt: 0, status: "complete", merged: [], relations: [], report: {}, subjects: [{ id: "s", name: "架构", aliases: [], unitIds: ids }], chapters: [{ id: "c", title: "技术架构", question: "?", group: "", subtopics: [{ title: "架构", subjectIds: ["s"] }] }] } as unknown as Parameters<typeof explicitSwitches>[0];
  const report: Record<string, number> = {};
  expect(explicitSwitches(organization, units, report).relations).toEqual([{ older: ids[0], newer: ids[1], kind: "replaces", status: "resolved" }]);
  expect(report.switches_explicit).toBe(1);
});

it("reuses a complete unchanged organization and preserves explicit replan behavior",async()=>{
 const units=[unit("检索","全文索引使用 Orama。"),unit("侧边栏","侧边栏只放搜索入口。")];
 const fake=model({wiki_subject_merge:subjects(),wiki_unit_merge:noMerges,wiki_subject_plan:oneChapterPerSubject});
 const options={ai:fake.ai,locale:"zh-CN",signal,names:["Atlas"],conversations:1};
 const first=await organizeLedger(ledger(units),options);fake.calls.length=0;
 const reused=await organizeLedger(first,options);
 expect(fake.calls).toHaveLength(0);expect(reused.organization?.report.reused_organization).toBe(1);
 expect(reused.organization?.chapters).toEqual(first.organization?.chapters);
 const receiver={calls:0,async generateStructured<T>(request:StructuredAIRequest<T>):Promise<T>{this.calls++;expect(request.bypassCache).toBe(true);return fake.ai.generateStructured(request);}};
 await organizeLedger(first,{...options,ai:receiver,fresh:true});expect(fake.calls.length).toBeGreaterThan(0);expect(receiver.calls).toBeGreaterThan(0);
});

it("does not reuse a snapshot after source changes or overwrite an edited directory",async()=>{
 const units=[unit("检索","全文索引使用 Orama。"),unit("侧边栏","侧边栏只放搜索入口。")];
 const fake=model({wiki_subject_merge:subjects(),wiki_unit_merge:noMerges,wiki_subject_plan:oneChapterPerSubject});
 const options={ai:fake.ai,locale:"zh-CN",signal,names:["Atlas"],conversations:1};
 const first=await organizeLedger(ledger(units),options);fake.calls.length=0;
 const edited=structuredClone(first.organization!);edited.chapters[0].title="我维护的检索章节";
 const maintained=await organizeLedger({...first,organization:edited},{...options,previous:edited});
 expect(maintained.organization!.chapters[0].title).toBe("我维护的检索章节");
 expect(maintained.organization!.layoutContext).toBe(true);
 const again=await organizeLedger(maintained,{...options,previous:maintained.organization});
 expect(again.organization!.chapters[0].title).toBe("我维护的检索章节");
 const changed=ledger([{...units[0],statement:"全文索引使用 SQLite。"},units[1]]);
 fake.calls.length=0;
 const updated=await organizeLedger(changed,{...options,previous:first.organization});
 expect(updated.organization!.report.reused_organization).toBeUndefined();
 expect(updated.organization!.report.new_units).toBe(1);
 expect(fake.calls.length).toBeGreaterThan(0);
});
