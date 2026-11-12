import { expect, it } from "vitest";
import { citedFigures, countedEcho, isCommentary, qualifyVerification, withoutRepeatedClauses, refusalReason, toldEarlier, lostNegation, restatesSentence, rewriteReason, sameSentence, wikiUnitStatuses, writeLedgerDraft, writeWikiDraft, parallelAsList, withoutRepeatedItems, clausesOutsideBrackets, currentBaseline, scopedWishes, laterTakenUp, pastStageWords, sharedFigures, addedGuarantees, rehomedSubtopics, withoutRepeatedSegments, coveringRun, versionSources, namedListItems, bareLabels, restoreProhibitions, repeatedValues, labelledSteps, restoredCodes, misplacedCodes, chapterRepeatedClauses, sideLabels, reusedChapterProblems, removedLiftedLimits, openingRepeatsTrimmed, correctedSideLabels } from "./wiki-knowledge-write";
import { curateWikiUnits } from "./wiki-knowledge-select";
import { planRequiredWikiSourceBlocks, reconcileRequiredWikiSourceBlocks } from "./wiki-source-coverage";
import { selectWikiUnits, wikiSubjectQuota } from "./wiki-knowledge-select";
import { exportChapters } from "../test/wiki-eval";
import type { StructuredAIRequest } from "./provider";
import { AIProviderResponseError } from "./provider-errors";
import { chatMarkers, protectedDifference, similarStatements, wikiDraftMarkdown, wikiGroupMetrics, type WikiExplanationGroup, type WikiDraftChapter, type WikiKnowledgeLedger, type WikiKnowledgeOrganization, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";

const signal = new AbortController().signal;
const unit = (index: number, statement: string, extra: Partial<Pick<WikiKnowledgeUnit, "kind" | "details" | "delivery">> & { adoption?: WikiKnowledgeUnit["adoption"]["status"]; role?: "user" | "assistant" } = {}): WikiKnowledgeUnit =>
  ({ id: `unit:${index}`, subject: "检索", statement, kind: extra.kind ?? (extra.adoption === "user_adopted" || extra.adoption === "user_decision" ? "decision" : "mechanism"), details: extra.details ?? [], evidence: { evidenceId: `e${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role: extra.role ?? "assistant", pasted: false, quote: statement }, adoption: { status: extra.adoption ?? "proposal", ...(extra.adoption === "user_adopted" ? { approval: { evidenceId: `reply-e${index}`, messageId: `reply-m${index}`, quote: "好，就这样。" } } : {}) }, delivery: extra.delivery ?? "unknown" });
function ledger(units: WikiKnowledgeUnit[], organization: Partial<WikiKnowledgeOrganization> = {}): WikiKnowledgeLedger {
  const subjects = organization.subjects ?? [{ id: "s:search", name: "检索", aliases: [], unitIds: units.map(item => item.id) }];
  return { version: 1, generatedAt: 0, status: "complete", materials: units.length, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects, merged: [], relations: [], report: {}, chapters: [{ id: "chapter:search", title: "检索", question: "如何找回历史？", group: "", subtopics: [{ title: "全文索引", subjectIds: subjects.map(subject => subject.id) }] }], ...organization } };
}
interface Payload { presentation: string; decided?: string[]; part: { index: number; total: number; written?: Array<{ title: string }> }; elsewhere: Array<{ subject: string; chapter: string }>; subtopics: Array<{ title: string; units: Array<{ id: string; status: string; important?: true; statement: string }> }> }
// A model following the claims format: each sentence of a paragraph that gives none claims the units whose
// statement it contains, or all the paragraph's units when it contains none.
let byAlias = new Map<string, string>();
const claimed = (value: unknown) => { const data = value as { subtopics?: Array<{ paragraphs?: Array<{ text: string; unitIds: string[]; claims?: unknown }> }> }; for (const topic of data?.subtopics ?? []) for (const paragraph of topic.paragraphs ?? []) if (!paragraph.claims && typeof paragraph.text === "string") paragraph.claims = paragraph.text.split(/(?<=[。！？])/u).filter(Boolean).map(text => { const own = paragraph.unitIds.filter(id => byAlias.has(id) && text.includes(byAlias.get(id)!.replace(/[。！？]$/u, ""))); return { text, unitIds: own.length ? own : paragraph.unitIds }; }); return value; };
function model(answer: (data: Payload, system: string) => unknown, same: (data: Payload) => unknown = () => ({ same: [] })) {
  const calls: Array<{ data: Payload; system: string }> = [], propositions: Payload[] = [];
  // The proposition merge before each part answers "no groups" unless a test gives one; it is not a writing call.
  return { calls, propositions, ai: { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => { const data = JSON.parse(request.prompt) as Payload; if (data.presentation === "wiki_unit_propositions") { propositions.push(data); return request.validate(same(data)); } calls.push({ data, system: request.system }); byAlias = new Map((data.subtopics ?? []).flatMap(topic => topic.units.map(item => [item.id, item.statement] as const))); return request.validate(claimed(answer(data, request.system))); } } };
}
// Cites every unit of each subtopic in one paragraph built from their statements; decisions lead the opening.
const faithful = (data: Payload) => ({ opening: "全文检索在本地完成。", openingUnitIds: data.decided ?? [], subtopics: data.subtopics.map(topic => ({ title: topic.title, paragraphs: [{ text: topic.units.map(item => (item.status === "confirmed" ? "已决定" : "") + item.statement).join(""), unitIds: topic.units.map(item => item.id) }] })) });

it("states a user's view as stated, relays pasted reports and keeps requests to the assistant out", () => {
  const view = unit(1, "原生 Compaction 对用户是黑箱。", { adoption: "user_decision", kind: "fact", role: "user" });
  const relayed = { ...unit(2, "竞品 v0.0.7 支持无限滚动。", { delivery: "user_reported", role: "user" }), evidence: { ...unit(2, "").evidence, role: "user" as const, pasted: true } };
  const request = unit(3, "用户要求基于上述讨论为 Codex 生成一个提示词。", { adoption: "user_decision", role: "user" });
  const statuses = wikiUnitStatuses([view, relayed, request], ledger([view, relayed, request]).organization!);
  expect([statuses.get(view.id), statuses.get(relayed.id)]).toEqual(["stated", "relayed"]);
  expect(selectWikiUnits(ledger([view, relayed, request]), statuses).has(request.id)).toBe(false);
});

it("lets an opening state proposals plainly, its mark saying whose they are, and ranks relayed notes by kind only", async () => {
  const units = [unit(1, "建议早期开源并小范围 Alpha 测试。", { kind: "plan" })];
  const { ai, calls } = model((data, system) => ({ opening: system.includes("SECOND ATTEMPT") ? "发布按阶段推进，先让少量用户试用。" : "项目采用早期开源加小范围 Alpha 测试的策略。", subtopics: [{ title: "全文索引", paragraphs: [{ text: "建议早期开源并小范围 Alpha 测试。", unitIds: [data.subtopics[0].units[0].id] }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  // The AI mark tells the reader the opening holds a proposal: no rewrite is asked for it.
  expect(calls).toHaveLength(1);expect(draft.chapters[0].problems).toEqual([]);
  // Five pasted competitor notes do not push this project's constraint out of a quota of four.
  const notes = Array.from({ length: 5 }, (_, index) => ({ ...unit(index + 10, `竞品第 ${index} 项更新。`, { delivery: "user_reported", role: "user", kind: "fact" }), evidence: { ...unit(index + 10, "").evidence, role: "user" as const, pasted: true }, about: { name: "Threadback", role: "competitor" as const } }));
  const constraint = unit(20, "不自动发送消息，不覆盖用户输入。", { kind: "constraint" });
  const crowded = ledger([...notes, constraint]);
  expect(selectWikiUnits(crowded, wikiUnitStatuses([...notes, constraint], crowded.organization!)).has(constraint.id)).toBe(true);
});

it("publishes the complete bound mapping once and invalidates chapter reuse when its source rows change", async () => {
  const point = unit(1, "仓库采用分区补货，缺货量对应各区的处理级别。", { kind: "mechanism" });
  const table = "0–9：常规补货\n10–19：优先补货\n20–29：立即补货";
  point.evidence.code = { language: "text", text: table };
  const modelOutput = (data: Payload) => ({ opening: "仓库按缺货量决定补货顺序。", subtopics: data.subtopics.map(topic => ({ title: topic.title, paragraphs: [
    { text: point.statement, unitIds: [topic.units[0].id] },
    { text: "- **常规补货**：0～9：常规补货\n- **优先补货**：10～19：优先补货", unitIds: [topic.units[0].id] },
  ] })) });
  const first = await writeWikiDraft({ ledger: ledger([point]), ai: model(modelOutput).ai, locale: "zh-CN", signal });
  expect(first.chapters[0].body).toContain(table);
  expect(first.chapters[0].body).not.toContain("**常规补货**");
  expect(first.quality?.critical).toBe(0);
  const same = model(modelOutput);
  await writeWikiDraft({ ledger: ledger([point]), ai: same.ai, locale: "zh-CN", signal, previous: first });
  expect(same.calls.some(call => call.data.presentation === "wiki_chapter_write")).toBe(false);
  const changed = structuredClone(point);
  changed.evidence.code!.text = table.replace("20–29", "20–39");
  const next = model(modelOutput);
  const second = await writeWikiDraft({ ledger: ledger([changed]), ai: next.ai, locale: "zh-CN", signal, previous: first });
  expect(next.calls.some(call => call.data.presentation === "wiki_chapter_write")).toBe(true);
  expect(second.chapters[0].body).toContain("20–39：立即补货");
  expect(second.chapters[0].body).not.toContain("20–29：立即补货");
});

it("recovers an interface and a version scope table even when the writer cites neither", async () => {
  const anchor = unit(1, "检索支持按创建时间排序。");
  const contract = unit(2, "检索接口的返回结构规定了标识符和状态。");
  contract.evidence.code = { language: "ts", text: "interface SearchResult {\n  id: string;\n  state: string;\n}" };
  const scope = unit(3, "检索功能分版本限制可用范围。", { kind: "constraint" });
  scope.evidence.code = { language: "table", text: "| Version | Scope |\n| --- | --- |\n| V1 | Local only |\n| V2 | Shared workspaces |" };
  const book = ledger([anchor, contract, scope]);
  const { ai, calls } = model(data => ({ opening: anchor.statement, subtopics: data.subtopics.map(topic => ({
    title: topic.title, paragraphs: topic.units.filter(item => item.statement === anchor.statement).map(item => ({ text: item.statement, unitIds: [item.id] })),
  })) }));
  const draft = await writeWikiDraft({ ledger: book, ai, locale: "zh-CN", signal });
  expect(calls.flatMap(call => call.data.subtopics.flatMap(topic => topic.units.map(item => item.statement)))).toEqual(expect.arrayContaining([contract.statement, scope.statement]));
  expect(draft.report.source_blocks_restored).toBe(2);
  expect(draft.quality?.critical).toBe(0);
  for (const item of [contract, scope]) {
    expect(draft.chapters[0].body.split(item.evidence.code!.text)).toHaveLength(2);
    expect(draft.chapters[0].paragraphs.find(part => part.text.includes(item.evidence.code!.text))?.unitIds).toEqual([item.id]);
  }
  const reuse = model(faithful);
  const cached = await writeWikiDraft({ ledger: book, ai: reuse.ai, locale: "zh-CN", signal, previous: draft });
  expect(reuse.calls.some(call => call.data.presentation === "wiki_chapter_write")).toBe(false);
  expect(cached.chapters[0].body).toBe(draft.chapters[0].body);
});

it("re-exports a legacy project with a missing rule and its source, respecting manual edits and changed sources", async () => {
  const anchor = unit(1, "检索支持按创建时间排序。");
  const scope = unit(2, "检索功能分版本限制可用范围。", { kind: "constraint" });
  const table = "| Version | Scope |\n| --- | --- |\n| V1 | Local only |\n| V2 | Shared workspaces |";
  scope.evidence.code = { language: "table", text: table };
  const example = { ...unit(3, "可参考以下示例。"), subject: "接口示例" };
  example.evidence.code = { language: "ts", text: "interface Demo {\n  id: string;\n}" };
  const book = ledger([anchor, scope, example]);
  const draft = await writeWikiDraft({ ledger: ledger([anchor]), ai: model(faithful).ai, locale: "zh-CN", signal });
  const { ledgerDocument } = await import("./wiki-ledger-document");
  const { projectSession } = await import("../test/project-fixture");
  const { projectDocument } = await import("../export/project-document");
  const saved = ledgerDocument({ ...book, draft }, { c: "查找讨论" });
  const session = { ...projectSession(), ...saved, sourceConversationIds: ["c"], projectState: undefined, wikiKnowledge: { ...book, draft } };
  const selection = { overview: false, wikiIds: saved.sections.map(section => section.id), matters: false, history: false, sources: false };
  const exported = projectDocument(session, selection, "md").text;
  expect(exported.split(table)).toHaveLength(2);
  expect(exported).toMatch(/\| V2 \| Shared workspaces \|\n\n原文来源 \[S-/u);
  expect(exported).not.toContain(example.evidence.code.text);
  expect(saved.sections[0].body).not.toContain(table);

  const edited = { ...session, sections: session.sections.map(section => ({ ...section, userEdited: true })) };
  expect(projectDocument(edited, selection, "md").text).not.toContain(table);
  const stale = { ...session, sourceSignatures: { c: { m1: "v1" } } };
  const flagged = projectDocument(stale, selection, "md").text;
  expect(flagged).not.toContain(table);
  expect(flagged).toContain("缺少应保留的原文规则块");
});

it("keeps one complete source block when the same rule is carried by different subjects", () => {
  const rule = "0–9：普通\n10–19：优先";
  const a = unit(1, "按数量选择优先级。"), b = unit(2, "派发前读取对应优先级。");
  a.evidence.code = b.evidence.code = { language: "text", text: rule };
  const book = ledger([a, b], {
    subjects: [{ id: "a", name: "评级", aliases: [], unitIds: [a.id] }, { id: "b", name: "派发", aliases: [], unitIds: [b.id] }],
    chapters: ["a", "b"].map(id => ({ id, title: id, question: "", group: "", subtopics: [{ title: id, subjectIds: [id] }] })),
  });
  const markdown = `\`\`\`text\n${rule}\n\`\`\``;
  const planned = planRequiredWikiSourceBlocks(book, [a, b], new Map([[a.id, "proposal"], [b.id, "proposal"]]));
  const covered = reconcileRequiredWikiSourceBlocks([
    { id: "a", body: a.statement, paragraphs: [] },
    { id: "b", body: markdown, paragraphs: [{ text: markdown, subtopic: "b", unitIds: [b.id] }] },
  ], planned, true);
  expect(covered.restored).toBe(0);
  expect(covered.issues.size).toBe(0);
  expect(covered.bindings.get("b")).toEqual([{ unit: b, markdown }]);
});

it("rewrites a recommendation that lost its source condition", async () => {
  const proposal = unit(1, "第一版使用本地索引。", { kind: "plan" });
  const condition = "如果本地性能验证通过";
  const quote = `${condition}，${proposal.statement}`;
  const scoped = { ...proposal, conditions: [condition], evidence: { ...proposal.evidence, quote } };
  const { ai, calls } = model((data, system) => {
    const point = data.subtopics[0].units[0];
    return { opening: "本章讨论检索实现。", subtopics: [{ title: "全文索引", paragraphs: [
      { text: system.includes("SECOND ATTEMPT") ? quote : point.statement, unitIds: [point.id] },
    ] }] };
  });
  const draft = await writeWikiDraft({ ledger: ledger([scoped]), ai, locale: "zh-CN", signal });
  expect(calls[0].data.subtopics[0].units[0]).toMatchObject({ conditions: [condition] });
  expect(calls[1].system).toContain("drops a source condition");
  expect(draft.chapters[0].body).toContain(quote);
  expect(draft.chapters[0].problems.join(" ")).not.toContain("drops a source condition");
});

it("states each unit from its own adoption and the checked relations", () => {
  const units = [unit(1, "用 SQLite FTS。"), unit(2, "改用 Orama。", { role: "user" }), unit(3, "全文索引用 Orama。", { adoption: "user_adopted" }), unit(4, "已接入 Orama。", { delivery: "user_reported", role: "user" }), unit(5, "建议加向量检索。"), unit(6, "改用 Elasticsearch。", { role: "user" })];
  const statuses = wikiUnitStatuses(units, ledger(units, { relations: [{ older: "unit:1", newer: "unit:2", kind: "replaces", status: "resolved" }, { older: "unit:5", newer: "unit:6", kind: "replaces", status: "unresolved" }] }).organization!);
  expect([...statuses.values()]).toEqual(["history", "stated", "confirmed", "reported", "open", "open"]);
});

it("writes a chapter once from its units and keeps which units each paragraph states", async () => {
  const units = [unit(1, "全文索引使用 Orama。", { adoption: "user_adopted", kind: "decision" }), unit(2, "索引每 30 秒增量更新。", { details: ["30 秒"] })];
  const { ai, calls } = model(faithful);
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(calls).toHaveLength(1);
  expect(calls[0].data.subtopics[0].units.map(item => [item.status, item.important ?? false])).toEqual([["confirmed", true], ["proposal", true]]);
  expect(draft.chapters[0]).toMatchObject({ title: "检索", problems: [], paragraphs: [{ subtopic: "全文索引", unitIds: ["unit:1", "unit:2"] }] });
  // The supported decision remains explicit in the prose.
  // The writer led with 已决定; status has one expression, the mark, so the word goes.
  expect(draft.chapters[0].body).toBe("全文检索在本地完成。\n\n### 全文索引\n\n全文索引使用 Orama。索引每 30 秒增量更新。");
  expect(draft.report).toMatchObject({ chapters: 1, units: 2, cited_units: 2, problems: 0 });
  // The export is checkable on its own: each paragraph cites its originals, listed in a source index the evaluation skips.
  const markdown = wikiDraftMarkdown({ ...ledger(units), draft }, "Atlas");
  // The opening states the decision and carries its own footnote; each paragraph carries one.
  expect(markdown).toContain("全文检索在本地完成。[^1]\n");
  expect(markdown).toContain("[^1]: AI · c · #2 · “全文索引使用 Orama。”");
  expect(markdown).toContain("全文索引使用 Orama。索引每 30 秒增量更新。[^2]\n");
  expect(markdown).not.toContain("[^3]");
  expect(markdown).toContain("[^2]: 2 条来源\n    - AI · c · #2 · “全文索引使用 Orama。”\n    - AI · c · #3 · “索引每 30 秒增量更新。”");
  expect(markdown).toContain("> 本稿整理自所选的 1 段对话");
  expect(wikiDraftMarkdown({ ...ledger(units), draft }, "Atlas", "zh-CN", { c: "硬件项目" })).toContain("    - AI · 硬件项目 · #2");
  expect(exportChapters(markdown)).toHaveLength(1);
  expect(exportChapters(markdown)[0]).toMatchObject({ title: "检索", subtopics: ["全文索引"] });
});

it("removes leaked unit ids and records a repeated point without a rewrite", async () => {
  const units = [unit(1, "发布分三阶段：Alpha、Beta、公开发布。"), unit(2, "建议首屏 README 突出聊天记录难找的问题。")];
  const { ai, calls } = model((data, system) => {
    const [stages, readme] = data.subtopics[0].units;
    return system.includes("SECOND ATTEMPT")
      ? { opening: "发布按阶段推进。", subtopics: [{ title: "全文索引", paragraphs: [{ text: "方案：发布分为 Alpha、Beta 和公开发布三个阶段（k1）。", unitIds: [stages.id] }, { text: "建议首屏 README 突出聊天记录难找的问题。", unitIds: [readme.id] }] }] }
      : { opening: "发布分为 Alpha、Beta 和公开发布三个阶段，首屏突出聊天记录难找。", subtopics: [{ title: "全文索引", paragraphs: [
        { text: "发布分为 Alpha、Beta 和公开发布三个阶段，首屏突出聊天记录难找。", unitIds: [stages.id] },
        { text: "首屏 README 采用突出聊天记录难找问题的写法，但尚未确定。", unitIds: [readme.id] },
      ] }] };
  });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  // A repeat costs no rewrite: it is recorded, and the leaked id is removed locally.
  expect(calls).toHaveLength(1);
  expect(draft.chapters[0].problems).toEqual([expect.stringContaining("states the same point twice")]);
  expect(draft.chapters[0].body).toContain("发布分为 Alpha、Beta 和公开发布三个阶段");
  expect(draft.chapters[0].body).not.toMatch(/k\d/u);
});

it("rewrites once a chapter that drops an important unit or invents a number", async () => {
  const units = [unit(1, "全文索引使用 Orama。", { adoption: "user_adopted", kind: "decision" }), unit(2, "建议索引增量更新。")];
  const { ai, calls } = model((data, system) => system.includes("SECOND ATTEMPT") ? faithful(data)
    : { opening: "本章介绍检索。", subtopics: [{ title: "全文索引", paragraphs: [{ text: "索引已确定每 5 秒增量更新。", unitIds: [data.subtopics[0].units[1].id] }] }] });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(calls).toHaveLength(2);
  const correction = calls[1].system;
  for (const problem of ["本章", "important units k1", "numbers its units do not state: 5"]) expect(correction).toContain(problem);
  expect(draft.chapters[0].problems).toEqual([]);expect(draft.report).toMatchObject({ write_requests: 2, write_retried: 1 });
  // The report counts the checks that cost the rewrite.
  expect(draft.report).toMatchObject({ "write_retry:has numbers its units do not state": 1 });
  expect(Object.keys(draft.report).filter(key => key.startsWith("write_retry:")).length).toBeGreaterThan(0);
});

it("requires the exact details a statement states and keeps them in its paragraph, but not a quote's other code", async () => {
  const hashed = { ...unit(1, "消息按 contentHash 内容签名去重。"), evidence: { ...unit(1, "").evidence, quote: "每条消息保存 `contentHash`，测试里用 `np.allclose` 比较。" } };
  const units = [hashed, unit(2, "首轮邀请 10 个真实用户试用。")];
  const { ai, calls } = model((data, system) => {
    const [hash, users] = data.subtopics[0].units;
    return system.includes("SECOND ATTEMPT")
      ? { opening: "导入会去重。", subtopics: [{ title: "全文索引", paragraphs: [{ text: "建议每条消息保存 contentHash 做内容签名去重，首轮邀请 10 个真实用户试用。", unitIds: [hash.id, users.id] }] }] }
      : { opening: "导入会去重。", subtopics: [{ title: "全文索引", paragraphs: [{ text: "建议按内容签名去重，并先邀请少量真实用户试用。", unitIds: [hash.id, users.id] }] }] };
  });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  // np.allclose belongs to another point in the quote: it is neither required nor offered.
  expect(calls[0].data.subtopics[0].units).toMatchObject([{ details: ["contentHash"], important: true }, { details: ["10 个"], important: true }]);
  expect(JSON.stringify(calls[0].data)).not.toContain("np.allclose");
  expect(calls[1].system).toContain("drops the exact details contentHash, 10 个");
  expect(draft.chapters[0].problems).toEqual([]);
});

it("keeps phrase details as context: only numbers, Latin names and code must appear verbatim", async () => {
  const units = [unit(1, "看板按三类组织内容。", { details: ["产品设计", "开发记录"] }), unit(2, "首轮在 Alpha 阶段邀请 10 个真实用户试用。", { details: ["10 个", "Alpha"] })];
  const { ai, calls } = model(data => {
    const [board, users] = data.subtopics[0].units;
    return { opening: "看板与试用。", subtopics: [{ title: "全文索引", paragraphs: [{ text: "建议看板按设计与记录分类，首轮在 Alpha 阶段邀请 10 个真实用户试用。", unitIds: [board.id, users.id] }] }] };
  });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(calls[0].data.subtopics[0].units).toMatchObject([{ details: ["产品设计", "开发记录"] }, { exact: ["10 个", "Alpha"], important: true }]);
  expect((calls[0].data.subtopics[0].units[0] as { important?: true }).important).toBeUndefined();
  expect(calls).toHaveLength(1);expect(draft.chapters[0].problems).toEqual([]);
});

it("writes a large chapter in order, telling later parts what is already written, under one heading", async () => {
  // The user's own words are always selected, so all 100 are written.
  const units = Array.from({ length: 100 }, (_, index) => unit(index, `检索第 ${index} 条机制。`, { role: "user" }));
  const { ai, calls } = model(faithful);
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(calls.map(call => [call.data.part.index, call.data.part.total, call.data.subtopics[0].units.length])).toEqual([[1, 2, 70], [2, 2, 30]]);
  expect(calls[1].data.part.written?.map(item => item.title)).toEqual(["全文索引"]);
  expect(draft.chapters[0].body.match(/^### /gmu)).toHaveLength(1);
  expect(draft.chapters[0].paragraphs.flatMap(paragraph => paragraph.unitIds)).toHaveLength(100);
});

it("writes the curated view: must-show units and each subject's best within its quota, the rest counted", async () => {
  // 30 proposals: quota 8. One confirmed unit is always written; decisions with exact details rank first.
  // Distinct statements (five characters each from a pool) so no two count as the same point.
  const pool = "天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜金生丽水玉出昆冈剑号巨阙珠称夜光果珍李柰菜重芥姜海咸河淡鳞潜羽翔龙师火帝鸟官人皇始制文字乃服衣裳推位让国有虞陶唐吊民伐罪周发殷汤坐朝问道垂拱平章爱育黎首臣伏戎羌遐迩";
  const units = [unit(0, "全文索引使用 Orama。", { adoption: "user_adopted" }), ...Array.from({ length: 29 }, (_, index) => unit(index + 1, `${pool.slice(index * 5, index * 5 + 5)}${index < 5 ? `保留 ${index + 1} 个版本` : ""}。`, { kind: index < 5 ? "decision" : "fact" }))];
  const { ai, calls } = model(faithful);
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  const sent = calls.flatMap(call => call.data.subtopics.flatMap(topic => topic.units.map(item => item.statement)));
  expect(sent).toHaveLength(1 + wikiSubjectQuota(30));
  expect(sent.slice(0, 6)).toEqual(["全文索引使用 Orama。", ...[0, 1, 2, 3, 4].map(index => `${pool.slice(index * 5, index * 5 + 5)}保留 ${index + 1} 个版本。`)]);
  expect(draft.chapters[0].body).toContain("> 相关讨论 21 条");
  expect(draft.report).toMatchObject({ units: 30, selected_units: 9 });
  expect([1, 4, 5, 20, 100, 157].map(units => wikiSubjectQuota(units))).toEqual([1, 4, 4, 7, 14, 14]);
  // A competitor's or reference's subject gets half, with no floor.
  expect([1, 5, 100].map(units => wikiSubjectQuota(units, true))).toEqual([1, 2, 7]);
});

it("gives the quota to distinct points: a near-repeat of a picked unit is skipped and grouped for writing", async () => {
  const units = [
    unit(1, "首页只保留搜索入口和最近项目，隐藏示例项目。", { kind: "decision" }),
    unit(2, "首页仅保留搜索入口与最近项目，示例项目隐藏。", { kind: "decision" }),
    ...Array.from({ length: 6 }, (_, index) => unit(index + 3, ["侧栏默认收起", "导入支持 ZIP 文件", "导出提供 Markdown", "阅读器显示消息顺序", "设置页分为三组", "搜索结果按时间排序"][index] + "。", { kind: "plan" })),
  ];
  const statuses = wikiUnitStatuses(units, ledger(units).organization!), picked = selectWikiUnits(ledger(units), statuses);
  // Quota 4 of 8: the near-repeat (unit 2) gives its slot to a distinct point.
  expect(picked.has("unit:1") && !picked.has("unit:2")).toBe(true);expect(picked.size).toBe(4);
  // Written together, near-repeats share a same number.
  const twins = [unit(1, units[0].statement, { role: "user", kind: "decision" }), unit(2, units[1].statement, { role: "user", kind: "decision" })];
  const { ai, calls } = model(faithful);
  await writeWikiDraft({ ledger: ledger(twins), ai, locale: "zh-CN", signal });
  expect(calls[0].data.subtopics[0].units.map(item => (item as { same?: number }).same)).toEqual([1, 1]);
});

it("sends units the merge kept apart for a name of their own under one same number", async () => {
  const units = [unit(1, "检索采用 IndexedDB + Orama 的本地架构。"), unit(2, "检索采用 IndexedDB、Search Index Manager 与 Orama 的本地分层架构。"), unit(3, "导出提供 Markdown。")];
  const { ai, calls } = model(faithful);
  const draft = await writeWikiDraft({ ledger: ledger(units, { restated: [["unit:1", "unit:2"]] }), ai, locale: "zh-CN", signal });
  expect(calls[0].data.subtopics[0].units.map(item => (item as { same?: number }).same)).toEqual([1, 1, undefined]);
  expect(draft.report.write_restated_together).toBe(2);
});

it("writes units told together in one subtopic of one part, even when organized under two subtopics", async () => {
  const units = [unit(1, "检索采用 IndexedDB + Orama 的本地架构。"), unit(2, "导出提供 Markdown。"), unit(3, "检索采用 IndexedDB、Search Index Manager 与 Orama 的本地分层架构。")];
  const subjects = [{ id: "s:a", name: "检索", aliases: [], unitIds: ["unit:1", "unit:2"] }, { id: "s:b", name: "架构", aliases: [], unitIds: ["unit:3"] }];
  const chapters = [{ id: "chapter:search", title: "检索", question: "?", group: "", subtopics: [{ title: "检索", subjectIds: ["s:a"] }, { title: "架构", subjectIds: ["s:b"] }] }];
  const { ai, calls } = model(faithful);
  await writeWikiDraft({ ledger: ledger(units, { subjects, chapters, restated: [["unit:1", "unit:3"]] }), ai, locale: "zh-CN", signal });
  const first = calls[0].data.subtopics[0].units as unknown as Array<{ statement: string; same?: number }>;
  expect(first.map(item => [item.statement, item.same])).toEqual([[units[0].statement, 1], [units[2].statement, 1], [units[1].statement, undefined]]);
});

it("states an assistant's facts as analysis and an announced 最终决定 as a proposal", async () => {
  const units = [unit(1, "Personal AI Memory 逐条计算语义相似度。", { kind: "fact" }), unit(2, "所以最终决定：四个 Tab 保留，布局基本不动。", { kind: "decision" })];
  const statuses = wikiUnitStatuses(units, ledger(units).organization!);
  expect([statuses.get("unit:1"), statuses.get("unit:2")]).toEqual(["analysis", "proposal"]);
});
it("asks for a holder said once per paragraph and never a change told in prose", async () => {
  const units = [unit(1, "首页只保留搜索入口。", { kind: "plan" }), unit(2, "侧栏默认收起。", { kind: "plan" }), unit(3, "导出提供 Markdown。", { kind: "plan" })];
  const { ai, calls } = model((data, system) => ({ opening: "首页和侧栏都以简洁为主。", subtopics: [{ title: "全文索引", paragraphs: [{ text: system.includes("SECOND ATTEMPT")
    ? "AI 的建议是首页只保留搜索入口，侧栏默认收起，导出提供 Markdown。"
    : "AI 建议首页只保留搜索入口。AI 建议侧栏默认收起。AI 建议导出提供 Markdown。后续讨论改为首页应成为日常搜索的唯一入口，但尚未确定。", unitIds: data.subtopics[0].units.map(item => item.id) }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(calls).toHaveLength(1);
  // Every leading AI 建议 is removed locally: the mark says whose the sentences are.
  expect(draft.chapters[0].paragraphs[0].text).not.toMatch(/AI\s?建议/u);
});

it("points to the chapter that explains a subject instead of explaining it again", async () => {
  const units = [unit(1, "全文索引使用 Orama。"), { ...unit(2, "上下文按任务组装。"), subject: "上下文引擎" }];
  const organization: Partial<WikiKnowledgeOrganization> = { subjects: [{ id: "s:search", name: "检索", aliases: [], unitIds: ["unit:1"] }, { id: "s:context", name: "上下文引擎", aliases: [], unitIds: ["unit:2"] }],
    chapters: [{ id: "a", title: "检索", question: "?", group: "", subtopics: [{ title: "全文索引", subjectIds: ["s:search"] }] }, { id: "b", title: "上下文", question: "?", group: "", subtopics: [{ title: "组装", subjectIds: ["s:context"] }] }] };
  const { ai, calls } = model(faithful);
  await writeWikiDraft({ ledger: ledger(units, organization), ai, locale: "zh-CN", signal });
  expect(calls.find(call => call.data.subtopics[0].title === "全文索引")!.data.elsewhere).toEqual([{ subject: "上下文引擎", chapter: "上下文" }]);
});

it("keeps chapters whose inputs are unchanged and rewrites the ones that changed", async () => {
  const units = [unit(1, "全文索引使用 Orama。"), { ...unit(2, "上下文按任务组装。", {kind:"plan"}), subject: "上下文引擎" }];
  const organization: Partial<WikiKnowledgeOrganization> = { subjects: [{ id: "s:search", name: "检索", aliases: [], unitIds: ["unit:1"] }, { id: "s:context", name: "上下文引擎", aliases: [], unitIds: ["unit:2"] }],
    chapters: [{ id: "a", title: "检索", question: "?", group: "", subtopics: [{ title: "全文索引", subjectIds: ["s:search"] }] }, { id: "b", title: "上下文", question: "?", group: "", subtopics: [{ title: "组装", subjectIds: ["s:context"] }] }] };
  const first = model(faithful);
  const draft = await writeWikiDraft({ ledger: ledger(units, organization), ai: first.ai, locale: "zh-CN", signal });
  expect(first.calls).toHaveLength(2);
  // A new unit joins 上下文 only: 检索 is kept as written.
  const grown = [...units, { ...unit(3, "上下文受 Token 预算约束。"), subject: "上下文引擎" }];
  const second = model(faithful);
  const updated = await writeWikiDraft({ ledger: ledger(grown, { ...organization, subjects: [organization.subjects![0], { ...organization.subjects![1], unitIds: ["unit:2", "unit:3"] }] }), ai: second.ai, locale: "zh-CN", signal, previous: draft });
  expect(second.calls.map(call => call.data.subtopics[0].title)).toEqual(["组装"]);
  expect(updated.chapters[0]).toEqual(draft.chapters[0]);
  expect(updated.report).toMatchObject({ reused_chapters: 1, written_chapters: 1 });
  // Changing the prerequisite of an existing point invalidates that chapter alone.
  const condition="如果消息来自本地存档", changed={...units[1],conditions:[condition],evidence:{...units[1].evidence,quote:`${condition}，${units[1].statement}`}};
  const scoped=model(data=>({opening:"本章说明处理方式。",subtopics:data.subtopics.map(topic=>({title:topic.title,paragraphs:topic.units.map(point=>({text:point.statement===changed.statement?`${condition}，${point.statement}`:point.statement,unitIds:[point.id]}))}))}));
  const withCondition=await writeWikiDraft({ledger:ledger([units[0],changed],organization),ai:scoped.ai,locale:"zh-CN",signal,previous:draft});
  expect(scoped.calls.map(call=>call.data.subtopics[0].title)).toEqual(["组装"]);
  expect(withCondition.chapters[0]).toEqual(draft.chapters[0]);
  expect(withCondition.chapters[1].body).toContain(condition);
  // A draft from different writing rules is never reused.
  const third = model(faithful);
  await writeWikiDraft({ ledger: ledger(units, organization), ai: third.ai, locale: "zh-CN", signal, previous: { ...draft, chapters: draft.chapters.map(chapter => ({ ...chapter, signature: "older-rules" })) } });
  expect(third.calls).toHaveLength(2);
});

it("quotes footnotes from the full original message around the stored quote", () => {
  const units = [unit(1, "核心流程定义为找回、阅读、复习。")];
  const stored = { ...units[0], evidence: { ...units[0].evidence, quote: "核心流程定义为：" } };
  const draft = { version: 1 as const, generatedAt: 0, status: "complete" as const, report: {}, chapters: [{ id: "a", title: "定位", question: "?", group: "", body: "已决定核心流程。", paragraphs: [{ subtopic: "流程", text: "已决定核心流程。", unitIds: ["unit:1"] }], problems: [] }] };
  const full = "先说背景。我们把核心流程定义为：\n- 找回过去的对话；\n- 在 Reader 中阅读；\n- 定期复习。其他内容另说。";
  const markdown = wikiDraftMarkdown({ ...ledger([stored]), draft }, "Atlas", "zh-CN", {}, { m1: full });
  expect(markdown).toContain("“我们把核心流程定义为： 找回过去的对话； 在 Reader 中阅读； 定期复习。”");
  // Without the full text the stored quote still serves.
  expect(wikiDraftMarkdown({ ...ledger([stored]), draft }, "Atlas")).toContain("“核心流程定义为：”");
});

it("reads tables as rows and skips code in footnotes", () => {
  const units = [{ ...unit(1, "导入与搜索列为 P0。"), evidence: { ...unit(1, "").evidence, quote: "| 导入与搜索 | P0 |" } }];
  const draft = { version: 1 as const, generatedAt: 0, status: "complete" as const, report: {}, chapters: [{ id: "a", title: "优先级", question: "?", group: "", body: "AI 建议导入与搜索列为 P0。", paragraphs: [{ subtopic: "P0", text: "AI 建议导入与搜索列为 P0。", unitIds: ["unit:1"] }], problems: [] }] };
  const full = "{#if tab===\"search\"} GenUI.issue(\"x\"); {/if}\n| 功能 | 建议 |\n|---|---|\n| 导入与搜索 | P0 |\n| Reader | P1 |";
  const markdown = wikiDraftMarkdown({ ...ledger(units), draft }, "Atlas", "zh-CN", {}, { m1: full });
  expect(markdown).toContain("“导入与搜索：P0；”");
  expect(markdown).not.toContain("GenUI");expect(markdown).not.toContain("|---");
});

it("keeps another project out, names competitors and keeps separate roadmaps apart", async () => {
  const hardware = { ...unit(1, "以 Hardware IR 为统一数据来源。"), about: { name: "AI Circuit Studio", role: "other_project" as const } };
  const competitor = { ...unit(2, "最后 Release 为 v0.0.5。", { kind: "fact" }), about: { name: "Personal AI Memory", role: "competitor" as const } };
  const decided = { ...unit(3, "只做 Chrome 版本。", { adoption: "user_decision", role: "user" }), about: { name: "Notion", role: "reference" as const } };
  const statuses = wikiUnitStatuses([hardware, competitor, decided], ledger([hardware, competitor, decided]).organization!);
  expect(statuses.get(decided.id)).toBe("stated");
  expect(selectWikiUnits(ledger([hardware, competitor, decided]), statuses).has(hardware.id)).toBe(false);
  // Two assistant roadmaps from different messages: only the newest is sent; the earlier one stays in the ledger.
  const plans = [unit(4, "M1 完成导入和全文搜索。", { kind: "plan" }), unit(5, "M1 手动选择并复制 Markdown。", { kind: "plan" })];
  const { ai, calls } = model((data, system) => ({ opening: "AI 曾建议过两条路线。", subtopics: [{ title: "全文索引", paragraphs: system.includes("SECOND ATTEMPT")
    ? data.subtopics[0].units.map(item => ({ text: `AI 曾建议的一条路线：${item.statement}`, unitIds: [item.id] }))
    : [{ text: "AI 建议 M1 完成导入和全文搜索，同时手动选择并复制 Markdown。", unitIds: data.subtopics[0].units.map(item => item.id) }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger(plans), ai, locale: "zh-CN", signal });
  expect((calls[0].data.subtopics[0].units as Array<{ statement: string }>).map(item => item.statement)).toEqual([plans[1].statement]);
  expect(calls).toHaveLength(1);expect(draft.report.earlier_plans_left_out).toBe(1);
});

it("gives each paragraph one footnote: the user's words first, three quoted, the rest by message number", () => {
  const units = [unit(1, "索引使用 Orama。"), unit(2, "索引每 30 秒更新。"), unit(3, "索引放在 IndexedDB。"), unit(4, "第一版只做 Chrome。", { role: "user" }), unit(5, "索引支持中文分词。")];
  const draft = { version: 1 as const, generatedAt: 0, status: "complete" as const, report: {}, chapters: [{ id: "a", title: "检索", question: "?", group: "", body: "检索在本地完成。", paragraphs: [{ subtopic: "索引", text: "检索在本地完成。", unitIds: units.map(item => item.id) }], problems: [] }] };
  const markdown = wikiDraftMarkdown({ ...ledger(units), draft }, "Atlas");
  expect(markdown).toContain("检索在本地完成。[^1]\n");
  expect(markdown).toContain("[^1]: 5 条来源\n    - 用户 · c · #5 · “第一版只做 Chrome。”\n    - AI · c · #2");
  expect(markdown).toContain("    另见 #4、#6");
});

it("states pasted material about this project as relayed and ranks it above an assistant's suggestion", () => {
  const pasted = (index: number, statement: string, kind: WikiKnowledgeUnit["kind"]) => ({ ...unit(index, statement, { kind, role: "user" }), evidence: { ...unit(index, statement).evidence, role: "user" as const, pasted: true } });
  const review = pasted(1, "原始消息是事实来源，搜索索引是可重建的衍生数据。", "constraint");
  const suggestions = ["索引放在 IndexedDB。", "侧栏默认收起。", "导出提供 Markdown。", "模型请求统一限流。", "设置页分成三栏。"].map((text, index) => unit(index + 2, text, { kind: "constraint" }));
  const competitor = { ...pasted(7, "竞品支持无限滚动。", "constraint"), about: { name: "Threadback", role: "competitor" as const } };
  const units = [...suggestions, review, competitor], statuses = wikiUnitStatuses(units, ledger(units).organization!);
  expect([statuses.get(review.id), statuses.get(competitor.id)]).toEqual(["relayed", "relayed"]);
  // A quota of four: this project's pasted review is picked, the competitor's pasted note gets no bonus.
  const selected = selectWikiUnits(ledger(units), statuses);
  expect(selected.has(review.id)).toBe(true);expect(selected.has(competitor.id)).toBe(false);
});

it("removes a sentence repeating the opening's decision from a paragraph that says more", async () => {
  const units = [unit(1, "停止优化纯规则生成的 Context Pack，改为接入 LLM 做语义整理。", { adoption: "user_decision", role: "user" })];
  const quoted = { ...units[0], evidence: { ...units[0].evidence, quote: "我决定停止优化纯规则生成的 Context Pack，改为接入 LLM" } };
  const { ai } = model(data => ({ opening: "已决定停止优化纯规则生成的 Context Pack，改为接入 LLM 进行语义整理和生成。", openingUnitIds: data.decided, subtopics: [{ title: "全文索引", paragraphs: [{ text: "已决定停止优化纯规则生成的 Context Pack，改为接入 LLM 进行语义整理和生成。这一决定的原因是规则生成的上下文质量很难再提高。", unitIds: [data.subtopics[0].units[0].id] }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger([quoted]), ai, locale: "zh-CN", signal });
  expect(draft.chapters[0].paragraphs[0].text).toBe("这一决定的原因是规则生成的上下文质量很难再提高。");
  expect(draft.report.opening_repeats_removed).toBe(1);
});

it("lists a message once in a footnote and skips code in its excerpt", () => {
  const first = unit(1, "收藏保存的是可复用的上下文。"), second = { ...unit(2, "收藏包含原始消息和前后文。"), evidence: { ...unit(2, "").evidence, evidenceId: "e1b", messageId: "m1", messageIndex: 1, quote: "收藏包含原始消息和前后文。" } };
  const draft = { version: 1 as const, generatedAt: 0, status: "complete" as const, report: {}, chapters: [{ id: "a", title: "收藏", question: "?", group: "", body: "收藏保存可复用的上下文。", paragraphs: [{ subtopic: "收藏", text: "收藏保存可复用的上下文。", unitIds: [first.id, second.id] }], problems: [] }] };
  const full = "收藏保存的是可复用的上下文。GenUI.issueNewTurn(\"设计收藏\")。收藏包含原始消息和前后文。";
  const markdown = wikiDraftMarkdown({ ...ledger([first, second]), draft }, "Atlas", "zh-CN", {}, { m1: full });
  expect(markdown).toContain("[^1]: AI · c · #2 · “");
  expect(markdown).not.toContain("GenUI");expect(markdown).not.toContain("条来源");
});

it("keeps the whole selection within the budget, must-show units included, each subject keeping a point", () => {
  const words = ["索引", "分词", "排序", "缓存", "预热", "持久化", "向量", "重排", "去重", "过滤", "高亮", "分页", "同步", "备份", "加密", "压缩", "导出", "导入", "回滚", "限流", "日志", "统计", "提示", "快捷键", "主题", "布局", "翻译", "引用", "标签", "收藏"];
  const many = words.map((word, index) => unit(index + 1, `${word}。`, { kind: "mechanism" }));
  const decided = unit(40, "全文索引使用 Orama。", { adoption: "user_adopted" });
  const organization = { subjects: [{ id: "s:a", name: "检索", aliases: [], unitIds: many.slice(0, 20).map(item => item.id) }, { id: "s:b", name: "导出", aliases: [], unitIds: [...many.slice(20).map(item => item.id), decided.id] }] };
  const book = ledger([...many, decided], organization), statuses = wikiUnitStatuses([...many, decided], book.organization!);
  const full = selectWikiUnits(book, statuses), tight = selectWikiUnits(book, statuses, 6);
  expect(full.size).toBeGreaterThan(6);
  expect(tight.has(decided.id)).toBe(true);expect(tight.size).toBeLessThanOrEqual(7);
  expect(many.slice(0, 20).some(item => tight.has(item.id))).toBe(true);expect(many.slice(20).some(item => tight.has(item.id))).toBe(true);
});

it("refuses crediting the user with an assistant's words and removes remarks that a number is exact", async () => {
  const units = [unit(1, "上下文导出存在事实状态不准的问题。", { kind: "fact" }), unit(2, "邀请 5-10 人参加 Alpha 测试。", { kind: "plan", details: ["5-10 人"] })];
  const { ai, calls } = model((data, system) => ({ opening: "导出与测试仍需打磨。", subtopics: [{ title: "全文索引", paragraphs: [
    { text: system.includes("SECOND ATTEMPT") ? "AI 分析认为上下文导出存在事实状态不准的问题。" : "用户报告上下文导出存在事实状态不准的问题。", unitIds: [data.subtopics[0].units[0].id] },
    { text: "AI 建议邀请 5-10 人参加 Alpha 测试，其中 10 人是明确数量。", unitIds: [data.subtopics[0].units[1].id] }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(calls[1].system).toContain("credits the user");
  expect(draft.chapters[0].problems).toEqual([]);
  // The holder is the mark's to say: the saved sentence states the point alone.
  expect(draft.chapters[0].paragraphs[1].text).toBe("邀请 5-10 人参加 Alpha 测试。");
});

it("writes an explanation group's core once with its status, each condition with its own, and no sentence for a restatement", async () => {
  // The user decided on bookmarks with notes; the assistant restated it, and also suggested generating notes.
  const decided = unit(1, "我要加书签，支持手动备注。", { adoption: "user_decision", role: "user", kind: "decision" }), restated = unit(2, "书签支持用户手动备注。"), suggested = unit(3, "书签支持手动备注，并可自动生成备注。");
  const group: WikiExplanationGroup = { id: "g:1", core: "书签支持手动备注。", homeSubjectId: "s:search", anchorUnitId: decided.id, signature: "g", members: [
    { unitId: decided.id, support: "支持手动备注", adds: [], role: "restates" }, { unitId: restated.id, support: "书签支持用户手动备注", adds: [], role: "restates" }, { unitId: suggested.id, support: "书签支持手动备注", adds: ["并可自动生成备注"], role: "adds" }] };
  const book = ledger([decided, restated, suggested], { groups: [group] });
  // First a text explaining the core twice and leaving the suggestion out; then one that follows the group.
  const { ai, calls, propositions } = model((data, system) => { const [k1, k2, k3] = data.subtopics[0].units.map(item => item.id); return system.includes("SECOND ATTEMPT")
    ? { opening: "已决定增加书签。", openingUnitIds: [k1], subtopics: [{ title: "全文索引", paragraphs: [{ text: "已决定增加书签，书签支持手动备注。AI 还建议可自动生成备注，未见用户采纳。", unitIds: [k1, k2, k3], claims: [{ text: "已决定增加书签，书签支持手动备注。", unitIds: [k1] }] }] }] }
    : { opening: "已决定增加书签。", openingUnitIds: [k1], subtopics: [{ title: "全文索引", paragraphs: [{ text: "已决定增加书签，书签支持手动备注。", unitIds: [k1, k3], claims: [{ text: "已决定增加书签，书签支持手动备注。", unitIds: [k1] }] }, { text: "此外，书签支持用户手动备注，方便以后查找。", unitIds: [k2] }] }] }; });
  const draft = await writeWikiDraft({ ledger: book, ai, locale: "zh-CN", signal });
  // No proposition request: the group from organizing replaces it.
  expect(propositions).toHaveLength(0);
  const sent = calls[0].data as unknown as { groups: Array<{ group: number; core: string; status: string; conditions: Array<{ unit: string; status: string; text: string }> }>; subtopics: Array<{ units: Array<{ id: string; group?: number; restates?: true }> }> };
  expect(sent.subtopics[0].units.map(item => [item.group, item.restates ?? false])).toEqual([[1, true], [1, true], [1, false]]);
  expect(sent.groups).toEqual([{ group: 1, core: "书签支持手动备注。", status: "confirmed", conditions: [{ unit: sent.subtopics[0].units[2].id, status: "proposal", text: "并可自动生成备注" }] }]);
  expect(calls[1].system).toContain("explains the core of one explanation group again");expect(calls[1].system).toContain("drops the condition \"并可自动生成备注\"");
  expect(draft.chapters[0].problems).toEqual([]);
  expect(draft.report).toMatchObject({ write_groups: 1, select_group_points: 1 });
});

it("labels priority plans from separate messages, pasted ones included, and marks the most recent one", async () => {
  const pasted = { ...unit(2, "Reader 列为 P0。", { kind: "plan", role: "user" }), evidence: { ...unit(2, "").evidence, role: "user" as const, pasted: true } };
  const units = [unit(1, "Dashboard 和 Reader 列为 P1。", { kind: "plan" }), pasted];
  const { calls } = await (async () => { const fake = model(faithful); await writeWikiDraft({ ledger: ledger(units), ai: fake.ai, locale: "zh-CN", signal }); return fake; })();
  // The most recent plan, pasted or not, is the one sent and written; the earlier ranking is left to History.
  expect((calls[0].data.subtopics[0].units as Array<{ statement: string }>).map(item => item.statement)).toEqual([pasted.statement]);
  expect(calls[0].system).not.toContain("早先曾列为");
});

it("quotes a footnote from the stored quote's own sentences before better-matching ones elsewhere", () => {
  const stored = { ...unit(1, "Atlas 定位为独立于平台的项目知识层。"), evidence: { ...unit(1, "").evidence, quote: "上下文导出样本存在事实状态不准。" } };
  const draft = { version: 1 as const, generatedAt: 0, status: "complete" as const, report: {}, chapters: [{ id: "a", title: "定位", question: "?", group: "", body: "导出仍需打磨。", paragraphs: [{ subtopic: "导出", text: "导出仍需打磨。", unitIds: [stored.id] }], problems: [] }] };
  const full = "Atlas 定位为独立于平台的项目知识层。另外，上下文导出样本存在事实状态不准。";
  expect(wikiDraftMarkdown({ ...ledger([stored]), draft }, "Atlas", "zh-CN", {}, { m1: full })).toContain("“另外，上下文导出样本存在事实状态不准。”");
});

it("refuses 已决定 backed only by pasted material, and a range joined from two separate numbers", async () => {
  const pasted = { ...unit(1, "收藏必须是完整的上下文片段。", { kind: "decision", role: "user" }), evidence: { ...unit(1, "").evidence, role: "user" as const, pasted: true } };
  const budget = unit(2, "快速续聊约 1,000–2,000 Token，增量分析约 5,000 Token，最多 10 条。", { kind: "mechanism" });
  const { ai, calls } = model((data, system) => ({ opening: "收藏与预算各有约定。", subtopics: [{ title: "全文索引", paragraphs: system.includes("SECOND ATTEMPT")
    ? [{ text: "据用户提供的材料，收藏必须是完整的上下文片段。", unitIds: [data.subtopics[0].units[0].id] }, { text: "AI 分析认为快速续聊约 1,000-2,000 Token，增量分析约 5,000 Token，最多 10 条。", unitIds: [data.subtopics[0].units[1].id] }]
    : [{ text: "据用户提供的材料，已决定收藏必须是完整的上下文片段。", unitIds: [data.subtopics[0].units[0].id] }, { text: "AI 分析认为任务相关模式约 5,000–10 Token。", unitIds: [data.subtopics[0].units[1].id] }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger([pasted, budget]), ai, locale: "zh-CN", signal });
  // 已决定 on pasted material is repaired locally; only the joined range costs the rewrite.
  expect(calls[1].system).not.toContain("says 已决定 but cites no decision");expect(calls[1].system).toContain("states the range 5000-10");
  expect(draft.chapters[0].problems).toEqual([]);
});

it("tells the writer each plan's scope", async () => {
  const units = [unit(1, "侧栏改造 P0 包括原生 Side Panel。", { kind: "plan" }), unit(2, "Wiki 阅读 P0 包括章节导航。", { kind: "plan" })];
  const organization = { subjects: [{ id: "s:side", name: "侧栏改造", aliases: [], unitIds: ["unit:1"] }, { id: "s:wiki", name: "Wiki 阅读", aliases: [], unitIds: ["unit:2"] }] };
  const fake = model(faithful);
  await writeWikiDraft({ ledger: ledger(units, organization), ai: fake.ai, locale: "zh-CN", signal });
  expect((fake.calls[0].data.subtopics[0].units as Array<{ planScope?: string }>).map(item => item.planScope)).toEqual(["侧栏改造", "Wiki 阅读"]);
  expect(fake.calls[0].system).toContain("不代表全项目路线");
});

it("says in the export that the draft records the selected discussions, not the current direction", () => {
  const units = [unit(1, "全文索引使用 Orama。")];
  const draft = { version: 1 as const, generatedAt: 0, status: "complete" as const, report: {}, chapters: [{ id: "a", title: "检索", question: "?", group: "", body: "全文索引使用 Orama。", paragraphs: [{ subtopic: "索引", text: "全文索引使用 Orama。", unitIds: ["unit:1"] }], problems: [] }] };
  expect(wikiDraftMarkdown({ ...ledger(units), draft }, "Atlas")).toContain("记录的是这些讨论的历史，现行产品方向以项目最新的文档为准");
});

it("strips decision words from a decided sentence and its neighbour alike, without a rewrite", async () => {
  const bookmark = { ...unit(1, "增加书签。", { adoption: "user_decision", role: "user" }), evidence: { ...unit(1, "", { role: "user" }).evidence, quote: "我打算加书签" } };
  const bundle = { ...unit(2, "所有收藏必须保存完整上下文包。", { kind: "decision", role: "user" }), evidence: { ...unit(2, "").evidence, role: "user" as const, pasted: true } };
  const { ai, calls } = model((data, system) => { const [first, second] = data.subtopics[0].units.map(item => item.id); return { opening: "已决定增加书签。", openingUnitIds: [first], subtopics: [{ title: "全文索引", paragraphs: [system.includes("SECOND ATTEMPT")
    ? { text: "已决定增加书签。据用户提供的材料，所有收藏必须保存完整上下文包，未见用户确认。", unitIds: [first, second], claims: [{ text: "已决定增加书签。", unitIds: [first] }] }
    : { text: "已决定增加书签。已决定所有收藏必须保存完整上下文包。", unitIds: [first, second], claims: [{ text: "已决定增加书签。", unitIds: [first] }, { text: "已决定所有收藏必须保存完整上下文包。", unitIds: [second] }] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger([bookmark, bundle]), ai, locale: "zh-CN", signal });
  // Both leading 已决定 go locally, the decided one too: whose decision it is, the mark says. No rewrite.
  expect(calls).toHaveLength(1);
  expect(draft.chapters[0].problems).toEqual([]);
  expect(draft.chapters[0].paragraphs[0].text).toBe("增加书签。所有收藏必须保存完整上下文包。");
  expect(draft.chapters[0].paragraphs[0].claims?.[0]).toEqual({ text: "增加书签。", unitIds: [bookmark.id] });
  expect(draft.chapters[0].openingUnitIds).toEqual([bookmark.id]);
});

it("asks for a claim on every decided, done, figure or change sentence", async () => {
  const units = [unit(1, "首次导入约 150,000 Token。", { kind: "fact" })];
  const { ai, calls } = model((data, system) => ({ opening: "导入有成本。", subtopics: [{ title: "全文索引", paragraphs: [{ text: "首次导入约 150,000 Token。", unitIds: [data.subtopics[0].units[0].id], claims: system.includes("SECOND ATTEMPT") ? [{ text: "首次导入约 150,000 Token。", unitIds: [data.subtopics[0].units[0].id] }] : [] }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  // The sentence gives a number its unit states: the claim the writer left out is bound locally, no rewrite.
  expect(calls).toHaveLength(1);expect(draft.chapters[0].problems).toEqual([]);expect(draft.report.claims_bound_locally).toBe(1);
  expect(draft.chapters[0].paragraphs[0].claims).toEqual([{ text: "首次导入约 150,000 Token。", unitIds: [units[0].id] }]);
  // A number no unit states binds nothing: the writer is asked for the claim, and the rewrite is checked on it.
  const other = model((data, system) => ({ opening: "导入有成本。", subtopics: [{ title: "全文索引", paragraphs: [{ text: system.includes("SECOND ATTEMPT") ? "首次导入约 150,000 Token。" : "首次导入约 200,000 Token。", unitIds: [data.subtopics[0].units[0].id], claims: [] }] }] }));
  const asked = await writeWikiDraft({ ledger: ledger(units), ai: other.ai, locale: "zh-CN", signal });
  expect(other.calls[1].system).toContain("has no claim");expect(asked.chapters[0].problems).toEqual([]);
});

it("states two confirmed but conflicting choices as contested, not both decided", () => {
  const orama = { ...unit(1, "数据库使用 Orama。", { adoption: "user_decision", role: "user" }), evidence: { ...unit(1, "", { role: "user" }).evidence, quote: "我决定用 Orama" } };
  const sqlite = { ...unit(2, "以后数据库统一 SQLite。", { adoption: "user_decision", role: "user" }), evidence: { ...unit(2, "", { role: "user" }).evidence, quote: "以后数据库统一用 SQLite" } };
  const book = ledger([orama, sqlite], { relations: [{ older: orama.id, newer: sqlite.id, kind: "replaces", status: "unresolved" }] });
  expect([...wikiUnitStatuses([orama, sqlite], book.organization!).values()]).toEqual(["contested", "contested"]);
});

it("keeps each claim's own excerpt when two claims come from one message", () => {
  const users = { ...unit(1, "目标用户是独立开发者。"), evidence: { ...unit(1, "").evidence, quote: "目标用户是独立开发者。" } };
  const survey = { ...unit(2, "约 80% 的开发者使用 AI 工具。"), evidence: { ...unit(1, "").evidence, evidenceId: "e1", quote: "调查显示约 80% 的开发者使用 AI 工具。" } };
  const draft = { version: 1 as const, generatedAt: 0, status: "complete" as const, report: {}, chapters: [{ id: "a", title: "用户", question: "?", group: "", body: "目标用户与市场。", paragraphs: [{ subtopic: "用户", text: "目标用户与市场。", unitIds: [users.id, survey.id] }], problems: [] }] };
  const markdown = wikiDraftMarkdown({ ...ledger([users, survey]), draft }, "Atlas", "zh-CN", {}, { m1: "目标用户是独立开发者。另外，调查显示约 80% 的开发者使用 AI 工具。" });
  expect(markdown).toContain("“目标用户是独立开发者。” / “另外，调查显示约 80% 的开发者使用 AI 工具。”");
});

it("keeps execution and quality apart: missing sources or key problems mean the draft has not passed", async () => {
  const units = [unit(1, "全文索引使用 Orama。")];
  const book = { ...ledger(units), status: "partial" as const, batches: [...ledger(units).batches, { sourceIds: ["x"], status: "failed" as const, units: [], rejected: {} }] };
  const draft = await writeWikiDraft({ ledger: book, ai: model(faithful).ai, locale: "zh-CN", signal });
  expect(draft.status).toBe("complete");
  expect(draft.quality).toMatchObject({ sources: "partial", failedBatches: 1, passed: false });
  expect(wikiDraftMarkdown({ ...book, draft }, "Atlas")).toContain("质量提示：1 批原文未能读取");
  // A complete run with no key problem passes, and the export carries no warning.
  const clean = await writeWikiDraft({ ledger: ledger(units), ai: model(faithful).ai, locale: "zh-CN", signal });
  expect(clean.quality?.passed).toBe(true);expect(wikiDraftMarkdown({ ...ledger(units), draft: clean }, "Atlas")).not.toContain("质量提示");
});

it("puts the writing rules into every writing request, so a cached answer from older checks is not reused", async () => {
  const fake = model(faithful);
  await writeWikiDraft({ ledger: ledger([unit(1, "全文索引使用 Orama。")]), ai: fake.ai, locale: "zh-CN", signal });
  expect((fake.calls[0].data as unknown as { rules?: number }).rules).toBeGreaterThan(0);
});

it("does not read the idea of a decision, a future choice, hypothetical users or a year as claims", async () => {
  const units = [unit(1, "导出应区分用户决定与 AI 建议。"), unit(2, "更新时展示差异，供用户决定是否合并。"), unit(3, "如果大量用户认为原生记忆足够，需要重新评估。", { kind: "fact" }), unit(4, "2026 年 4 月已有同类开源项目。", { kind: "fact" })];
  const { ai, calls } = model(data => ({ opening: "导出与更新各有规则。", subtopics: [{ title: "全文索引", paragraphs: [
    { text: "AI 建议导出应区分用户决定与 AI 建议，状态分为构想、已决定（用户明确选择）和开发中。", unitIds: [data.subtopics[0].units[0].id], claims: [] },
    { text: "AI 建议更新时展示差异，供用户决定是否合并，也可以让用户决定是否开启自动采集。", unitIds: [data.subtopics[0].units[1].id], claims: [] },
    { text: "AI 分析认为，如果大量用户认为原生记忆足够，需要重新评估方向。据资料，2026 年 4 月已有同类开源项目。", unitIds: [data.subtopics[0].units[2].id, data.subtopics[0].units[3].id], claims: [] }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(calls).toHaveLength(1);expect(draft.chapters[0].problems).toEqual([]);
});

it("drops a decision word the user never gave, in paragraphs and in the opening", async () => {
  const pasted = (index: number, statement: string) => ({ ...unit(index, statement, { kind: "decision", role: "user" }), evidence: { ...unit(index, "").evidence, role: "user" as const, pasted: true } });
  const local = pasted(1, "保持 Local-first 和 BYOK 产品方向。"), home = pasted(2, "采用浅色极简新手首页。");
  const { ai, calls } = model(data => { const [first, second] = data.subtopics[0].units.map(item => item.id); return { opening: "用户已决定采用浅色极简新手首页。", openingUnitIds: [second], subtopics: [{ title: "全文索引", paragraphs: [{ text: "用户决定保持 Local-first 和 BYOK 产品方向。", unitIds: [first], claims: [{ text: "用户决定保持 Local-first 和 BYOK 产品方向。", unitIds: [first] }] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger([local, home]), ai, locale: "zh-CN", signal });
  // The wording is repaired locally in the first answer and checked again: no rewrite is asked for.
  expect(calls).toHaveLength(1);
  expect(draft.chapters[0].body.startsWith("采用浅色极简新手首页。")).toBe(true);
  expect(draft.chapters[0].paragraphs[0].text).toBe("保持 Local-first 和 BYOK 产品方向。");
  expect(draft.chapters[0].paragraphs[0].claims?.[0].text).toBe("保持 Local-first 和 BYOK 产品方向。");
  expect(draft.chapters[0].problems.filter(problem => /已决定/u.test(problem))).toEqual([]);
  expect(draft.report.decisions_repaired_early).toBe(2);
});

it("gives a cited decision, and the user's own word on the project, a sentence of their own when the prose folded them in", async () => {
  const github = unit(1, "项目完全开源并托管于 GitHub。", { role: "user", kind: "decision", adoption: "user_decision" });
  const light = unit(2, "采用浅色极简风格，包含居中欢迎区。", { role: "user", kind: "decision", adoption: "user_decision" });
  const units = [github, { ...light, evidence: { ...light.evidence, quote: "我喜欢这种设计" } }, unit(3, "ChatAtlas 是本地优先的知识管理工具。")];
  const { ai } = model(data => { const ids = data.subtopics[0].units.map(item => item.id); return { opening: "定位。", subtopics: [{ title: "全文索引", paragraphs: [
    { text: "ChatAtlas 是开源、本地优先的知识管理工具。", unitIds: [ids[0], ids[2]], claims: [] },
    { text: "首页采用浅色极简风格，并包含居中欢迎区。", unitIds: [ids[1]], claims: [] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  const [folded, said] = draft.chapters[0].paragraphs;
  // "托管于 GitHub" was lost in a wider sentence: the statement comes back with its own claim.
  expect(folded.text).toBe("ChatAtlas 是开源、本地优先的知识管理工具。项目完全开源并托管于 GitHub。");
  expect(folded.claims).toContainEqual({ text: "项目完全开源并托管于 GitHub。", unitIds: [github.id] });
  // "我喜欢这种设计" chooses the design: the sentence saying it is bound to the decision, not repeated.
  expect(said.text).toBe("首页采用浅色极简风格，并包含居中欢迎区。");
  expect(said.claims).toContainEqual({ text: "首页采用浅色极简风格，并包含居中欢迎区。", unitIds: [light.id] });
  expect(draft.report.decisions_restored).toBe(1);
});

it("binds a decision another paragraph already says to that sentence, and drops empty citation marks", async () => {
  const edges = unit(1, "连接线默认中性灰，选中为强调色，Error为红色。", { role: "user", kind: "decision", adoption: "user_decision" });
  const units = [edges, unit(2, "节点保持中性色，禁止彩色分类卡。"), unit(3, "迭代只调整排版与布局。")];
  const { ai } = model(data => { const ids = data.subtopics[0].units.map(item => item.id); return { opening: "规范。", subtopics: [{ title: "视觉", paragraphs: [
    { text: "连接线默认中性灰，选中为强调色，Error 为红色<sup></sup>。节点保持中性色，禁止彩色分类卡<sup></sup>。", unitIds: [ids[1]], claims: [] },
    { text: "迭代只调整排版与布局。", unitIds: [ids[2], ids[0]], claims: [] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  const [first, second] = draft.chapters[0].paragraphs;
  expect(first.text).toBe("连接线默认中性灰，选中为强调色，Error 为红色。节点保持中性色，禁止彩色分类卡。");
  expect(first.claims).toContainEqual({ text: "连接线默认中性灰，选中为强调色，Error 为红色。", unitIds: [edges.id] });
  expect(second.text).toBe("迭代只调整排版与布局。");
  expect(draft.report.decisions_restored).toBeUndefined();
});

it("drops a fence the writer copied from a block's summary, keeping the sentence after it", async () => {
  const units = [unit(1, "仓库首页列出最近的构建。"), unit(2, "点击一行查看日志。")];
  const { ai } = model(data => { const ids = data.subtopics[0].units.map(item => item.id); return { opening: "构建列表。", subtopics: [{ title: "界面", paragraphs: [
    { text: "仓库首页列出最近的构建。", unitIds: [ids[0]], claims: [] },
    { text: "```text, 2 lines\n```\n点击一行查看日志。", unitIds: [ids[1]], claims: [] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(draft.chapters[0].body).not.toContain("```");
  expect(draft.chapters[0].paragraphs.map(paragraph => paragraph.text)).toContain("点击一行查看日志。");
});

it("drops settling words the marks say instead (正式确立的, 最终方案确定为), keeping what was settled and quotations", async () => {
  const units = [unit(1, "三大核心模块包括 Workspace、Sidebar 和 Context Engine。"), unit(2, "方案为原生推开式分屏。")];
  const { ai } = model(data => { const [first, second] = data.subtopics[0].units.map(item => item.id); return { opening: "模块与方案。", subtopics: [{ title: "全文索引", paragraphs: [
    { text: "正式确立的三大核心模块包括 Workspace、Sidebar 和 Context Engine。", unitIds: [first], claims: [] },
    { text: "当时最终方案确定为原生推开式分屏，用户原话是「最终方案确定为分屏」。", unitIds: [second], claims: [] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(draft.chapters[0].paragraphs.map(paragraph => paragraph.text)).toEqual(["三大核心模块包括 Workspace、Sidebar 和 Context Engine。", "当时方案为原生推开式分屏，用户原话是「最终方案确定为分屏」。"]);
});

it("ends a paragraph on the user's decision, so the suggestions after it are not read as decided", async () => {
  const decision = { ...unit(1, "增加书签功能，允许用户手动标注对话内容。", { role: "user", kind: "decision", adoption: "user_decision" }) };
  const units = [{ ...decision, evidence: { ...decision.evidence, quote: "我打算加个书签功能" } }, unit(2, "采用带注释的智能书签，增加独立的 bookmarks 表。")];
  const text = "增加书签功能，允许用户手动标注对话内容。采用带注释的智能书签，增加独立的 bookmarks 表。";
  const { ai } = model(data => { const ids = data.subtopics[0].units.map(item => item.id); return { opening: "书签。", subtopics: [{ title: "全文索引", paragraphs: [{ text, unitIds: ids, claims: [{ text: "增加书签功能，允许用户手动标注对话内容。", unitIds: [ids[0]] }] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(draft.chapters[0].paragraphs[0].text).toBe("增加书签功能，允许用户手动标注对话内容。\n\n采用带注释的智能书签，增加独立的 bookmarks 表。");
  expect(draft.report.decisions_set_apart).toBe(1);
});

it("removes a list item telling an earlier one again and keeps the list a list; drops 用户确认采用", async () => {
  const units = [unit(1, "第一版关注 10 名测试者与 70% 完成率。"), unit(2, "设定为 10 个真实测试者。"), unit(3, "首页采用浅色极简设计基准。")];
  const list = "- 第一版不追求 Star 数量，而是关注：10名有真实历史记录的测试者、≥70%的首次体验完成率、5+条具体反馈、以及3+名用户在7天内主动复用。\n- 设定为 10 个真实测试者、70% 首次体验完成率及 5+ 具体反馈，强调让有历史对话的用户感到省事，而非追求 Star 数量。\n- 演示视频控制在 60-90 秒，并展示从搜索到复用的完整流程。";
  const { ai } = model(data => { const ids = data.subtopics[0].units.map(item => item.id); return { opening: "目标。", subtopics: [{ title: "全文索引", paragraphs: [
    { text: list, unitIds: ids.slice(0, 2), claims: [] }, { text: "**用户确认采用浅色极简新手首页设计基准**，并认可推开式分屏。", unitIds: [ids[2]], claims: [] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  const [kept, home] = draft.chapters[0].paragraphs.map(paragraph => paragraph.text);
  expect(kept.split("\n")).toEqual(["- 第一版不追求 Star 数量，而是关注：10名有真实历史记录的测试者、≥70%的首次体验完成率、5+条具体反馈、以及3+名用户在7天内主动复用。", "- 演示视频控制在 60-90 秒，并展示从搜索到复用的完整流程。"]);
  expect(home).toBe("**采用浅色极简新手首页设计基准**，并认可推开式分屏。");
});

it("asks to settle an item a part leaves out of the first version and also lists as P0", async () => {
  const units = [unit(1, "Wiki、知识图谱、自动同步等所有功能第一版不做。"), unit(2, "保留消息级搜索和项目 Wiki 为 P0。")];
  const { ai, calls } = model(data => { const ids = data.subtopics[0].units.map(item => item.id); return { opening: "范围。", subtopics: [{ title: "全文索引", paragraphs: [
    { text: "| 事项 | 第一版 |\n| --- | --- |\n| Wiki、知识图谱、自动同步等所有功能 | 不做 |\n| 消息级搜索 | 做 |", unitIds: [ids[0]], claims: [] },
    { text: "保留消息级搜索和项目 Wiki 为 P0。", unitIds: [ids[1]], claims: [] }] }] }; });
  await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  // The conflict costs one rewrite, naming the item.
  expect(calls).toHaveLength(2);expect(calls[1].system).toContain("\"Wiki\" is both left out of the first version");
});

it("removes a sentence a paragraph says twice, even when the repeat names the project", async () => {
  const units = [unit(1, "首次使用体验必须极简快速，用户导入部分对话后应能迅速看到可用结果。"), unit(2, "基础搜索不需要 API Key。")];
  const twice = "首次使用体验必须极简快速，用户导入部分对话后应能迅速看到可用结果，而非先完成整套知识库配置。Atlas 必须将首次使用体验做得非常短，用户导入部分对话后应迅速看到可用结果，而不是先完成整套知识库配置。";
  const { ai } = model(data => { const [first, second] = data.subtopics[0].units.map(item => item.id); return { opening: "首次体验。", subtopics: [{ title: "全文索引", paragraphs: [
    { text: twice, unitIds: [first], claims: [] }, { text: "基础搜索不需要 API Key。", unitIds: [second], claims: [] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(draft.chapters[0].paragraphs[0].text).toBe("首次使用体验必须极简快速，用户导入部分对话后应能迅速看到可用结果，而非先完成整套知识库配置。");
});

it("removes unit ids written in square brackets with their brackets, leaving no empty [] or [, ]", async () => {
  const units = [unit(1, "上下文分为三层。"), unit(2, "Context Bundle 是派生数据。")];
  const { ai } = model(data => { const [first, second] = data.subtopics[0].units.map(item => item.id); return { opening: "上下文。", subtopics: [{ title: "全文索引", paragraphs: [
    { text: `上下文分为三层 [${first}, ${second}]。`, unitIds: [first], claims: [] },
    { text: "Context Bundle 是派生数据 [, ]。", unitIds: [second], claims: [] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(draft.chapters[0].paragraphs.map(paragraph => paragraph.text)).toEqual(["上下文分为三层。", "Context Bundle 是派生数据。"]);
});

it("drops status words inside a phrase and the lead of an instruction to a coding tool, keeping what it asks for", async () => {
  const units = [unit(1, "首页采用浅色极简风格。"), unit(2, "保留现有的 IndexedDB + Orama 架构。"), unit(3, "要求 Codex 的 AGENTS.md 仅写入简短稳定的项目指令。")];
  const { ai } = model(data => { const [first, second, third] = data.subtopics[0].units.map(item => item.id); return { opening: "首页与架构。", subtopics: [{ title: "全文索引", paragraphs: [
    { text: "首页采用已决定的浅色极简风格。", unitIds: [first], claims: [] },
    { text: "向 Codex 发出指令，要求保留现有的 IndexedDB + Orama 架构。", unitIds: [second], claims: [] },
    { text: "要求 Codex 的 AGENTS.md 仅写入简短稳定的项目指令。", unitIds: [third], claims: [] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  // "Codex 的 AGENTS.md" names the tool's file, not an instruction to it: cutting the lead left "的 AGENTS.md……".
  expect(draft.chapters[0].paragraphs.map(paragraph => paragraph.text)).toEqual(["首页采用浅色极简风格。", "保留现有的 IndexedDB + Orama 架构。", "要求 Codex 的 AGENTS.md 仅写入简短稳定的项目指令。"]);
});

it("flags a recap paragraph whose units were all explained above, but never deletes it locally", async () => {
  const units = [unit(1, "第一版聚焦一句话找回历史。"), unit(2, "存储使用 IndexedDB。"), unit(3, "平台差异封装在 Provider Adapter。")];
  const { ai, calls } = model(data => { const ids = data.subtopics[0].units.map(item => item.id); return { opening: "Atlas 的基础能力。", subtopics: [{ title: "全文索引", paragraphs: [
    { text: "AI 建议第一版聚焦一句话找回历史。", unitIds: [ids[0]] }, { text: "AI 建议存储使用 IndexedDB，平台差异封装在 Provider Adapter。", unitIds: [ids[1], ids[2]] },
    { text: "总之，AI 建议聚焦找回历史，用 IndexedDB 存储，用 Provider Adapter 适配平台。", unitIds: ids }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  // A recap alone is not worth a second whole request.
  expect(calls).toHaveLength(1);expect(draft.report.write_rewrites_spared).toBe(1);
  // A cited unit may still hold conditions no paragraph wrote, so the paragraph stays; the warning is not critical.
  expect(draft.chapters[0].paragraphs).toHaveLength(3);
  expect(draft.chapters[0].problems.some(problem => problem.includes("is a recap"))).toBe(true);
  expect(draft.quality?.critical).toBe(0);
});

it("does not read a field list or a modifier as an announced decision", async () => {
  const units = [unit(1, "点击完成时打开面板填写结论。"), unit(2, "保留现有产品结构。")];
  const { ai, calls } = model(data => ({ opening: "事项与结构的约定。", subtopics: [{ title: "全文索引", paragraphs: [{ text: "AI 建议点击完成时打开面板，要求用户填写解决结论（最终决定、原因、关联讨论）。另外应保留已确定的产品结构。", unitIds: data.subtopics[0].units.map(item => item.id) }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(calls).toHaveLength(1);expect(draft.chapters[0].problems).toEqual([]);
});

it("keeps statements apart that differ in obligation, numbers, names or versions, at every stage", async () => {
  const pairs: Array<[string, string]> = [
    ["全文搜索必须在本地调用生成模型处理原始消息。", "全文搜索禁止在本地调用生成模型处理原始消息。"],
    ["索引每 30 秒更新一次，保持检索结果新鲜。", "索引每 60 秒更新一次，保持检索结果新鲜。"],
    ["模型调用使用 BYOK 方式，由用户提供自己的密钥。", "模型调用使用平台内置方式，由用户提供自己的密钥。"],
    ["第一版发布 v0.1 时提供全文检索和消息定位。", "第一版发布 v0.2 时提供全文检索和消息定位。"],
  ];
  for (const [first, second] of pairs) {
    expect(protectedDifference(first, second)).toBe(true);
    expect([similarStatements(first, second), sameSentence(first, second)]).toEqual([false, false]);
  }
  // Wording alone still finds a restatement.
  expect(similarStatements("Context Engine 根据当前任务选择相关知识。", "Context Engine 会根据当前任务选择相关的知识。")).toBe(true);
  // Selection keeps both sides of a difference instead of skipping the second as a near-repeat.
  const units = pairs.flat().map((statement, index) => unit(index + 1, statement));
  // One subject per pair, so the quota is not what keeps the second out.
  const book = ledger(units, { subjects: pairs.map((_, index) => ({ id: `s:${index}`, name: `主题${index}`, aliases: [], unitIds: [units[index * 2].id, units[index * 2 + 1].id] })) }), selected = selectWikiUnits(book, wikiUnitStatuses(units, book.organization!), 1e9);
  expect(units.every(item => selected.has(item.id))).toBe(true);
  // Near-repeat numbering never joins them either, so the writer gets no shared number for a pair.
  const { ai, calls } = model(faithful);
  await writeWikiDraft({ ledger: ledger(units.slice(0, 4)), ai, locale: "zh-CN", signal });
  expect((calls[0].data.subtopics[0].units as Array<{ same?: number }>).every(item => item.same === undefined)).toBe(true);
});


it("tells numbers apart by the object they belong to, not only as a set", () => {
  const swapped: Array<[string, string]> = [
    ["全文索引每 30 秒更新，向量索引每 60 秒更新。", "全文索引每 60 秒更新，向量索引每 30 秒更新。"],
    ["全文索引和向量索引分别每 30 秒和 60 秒更新。", "全文索引和向量索引分别每 60 秒和 30 秒更新。"],
    ["快速续聊约 2,000 Token，任务模式最多 5,000 Token。", "快速续聊约 5,000 Token，任务模式最多 2,000 Token。"],
  ];
  for (const [first, second] of swapped) {
    expect(protectedDifference(first, second)).toBe(true);
    expect([similarStatements(first, second), sameSentence(first, second)]).toEqual([false, false]);
  }
  // The same numbers on the same objects, reworded, or in another order of clauses, are still the same point.
  expect(protectedDifference("全文索引每 30 秒更新，向量索引每 60 秒更新。", "向量索引每 60 秒更新，全文索引每 30 秒更新。")).toBe(false);
  expect(protectedDifference("索引每 30 秒更新一次。", "每 30 秒更新一次索引。")).toBe(false);
  expect(protectedDifference("首次导入约 1.5 万条消息，增量约 200 条。", "首次导入约 1.5 万条消息，增量约 200 条。")).toBe(false);
});

it("lists only a member's own statement clauses as conditions", async () => {
  // A clause taken from a detail (a function name) is context, not a condition the paragraph must write.
  const base = unit(1, "导出提供 Markdown 文件。"), extra = { ...unit(2, "导出提供 Markdown 文件，附带来源。"), details: ["search_conversations"] };
  const exported: WikiExplanationGroup = { id: "g:1", core: "导出提供 Markdown 文件。", homeSubjectId: "s:search", anchorUnitId: base.id, signature: "g", members: [
    { unitId: base.id, support: "导出提供 Markdown 文件", adds: [], role: "restates" }, { unitId: extra.id, support: "导出提供 Markdown 文件", adds: ["附带来源", "search_conversations"], role: "adds" }] };
  const first = model(faithful);
  const draft = await writeWikiDraft({ ledger: ledger([base, extra], { groups: [exported] }), ai: first.ai, locale: "zh-CN", signal });
  expect((first.calls[0].data as unknown as { groups: Array<{ conditions: Array<{ text: string }> }> }).groups[0].conditions.map(item => item.text)).toEqual(["附带来源"]);
  expect(draft.chapters[0].problems.filter(problem => problem.includes("drops the condition"))).toEqual([]);
});

it("quotes sources without the escapes, emphasis, cut tags, tables and citation numbers of pasted documents", () => {
  const pasted = { ...unit(1, "首页不应被设计成普通 AI 聊天页面。"), evidence: { ...unit(1, "").evidence, role: "user" as const, pasted: true, quote: "首页不应被设计成普通 AI 聊天页面" } };
  const tagged = { ...unit(2, "产品介绍强调跨平台搜索对话。"), evidence: { ...unit(2, "").evidence, quote: "lor=\"secondary\" size=\"sm\">Search conversations across AI platforms." } };
  const draft = { version: 1 as const, generatedAt: 0, status: "complete" as const, report: {}, chapters: [{ id: "a", title: "定位", question: "?", group: "", body: "首页不是聊天页面。", paragraphs: [{ subtopic: "首页", text: "首页不是聊天页面。", unitIds: ["unit:1", "unit:2"] }], problems: [] }] };
  const full = String.raw`\\*历史记录\*\ · [30]\ 约束：首页不应被设计成普通 AI 聊天页面或第二个 ChatGPT。 ## 七、其他 | 表 | 格 |`;
  const markdown = wikiDraftMarkdown({ ...ledger([pasted, tagged]), draft }, "Atlas", "zh-CN", {}, { m1: full });
  expect(markdown).toContain("“历史记录 · 约束：首页不应被设计成普通 AI 聊天页面或第二个 ChatGPT。”");
  expect(markdown).toContain("“Search conversations across AI platforms.”");
  const notes = markdown.slice(markdown.indexOf("[^1]:"));
  expect(notes).not.toMatch(/\|\*|="|\[30\]|##/u);
});

it("cites a restating member where its core is, and supplements an important unit the rewrite still left out", async () => {
  const decided = unit(1, "我要在对话旁加上书签，支持手动标注。", { adoption: "user_decision", role: "user", kind: "decision" });
  const core = unit(2, "导出提供 Markdown 文件。"), echo = unit(3, "导出提供 Markdown 格式的文件。");
  const exported: WikiExplanationGroup = { id: "g:1", core: "导出提供 Markdown 文件。", homeSubjectId: "s:search", anchorUnitId: core.id, signature: "g", members: [
    { unitId: core.id, support: "导出提供 Markdown 文件", adds: [], role: "restates" }, { unitId: echo.id, support: "导出提供 Markdown 格式的文件", adds: [], role: "restates" }] };
  // Both attempts write the export once, citing one member, and leave the decision out; the supplement writes it.
  const { ai, calls } = model((data, system) => {
    if (system.includes("SUPPLEMENT")) return { opening: "", subtopics: data.subtopics.map(topic => ({ title: topic.title, paragraphs: [{ text: "已决定在对话旁加上书签，支持手动标注。", unitIds: topic.units.map(item => item.id), claims: [{ text: "已决定在对话旁加上书签，支持手动标注。", unitIds: topic.units.map(item => item.id) }] }] })) };
    const ids = data.subtopics[0].units.map(item => item.id);
    return { opening: "本章说明导出方式。", openingUnitIds: [], subtopics: [{ title: "全文索引", paragraphs: [{ text: "AI 建议导出提供 Markdown 文件。", unitIds: [ids[1]] }] }] };
  });
  const draft = await writeWikiDraft({ ledger: ledger([decided, core, echo], { groups: [exported] }), ai, locale: "zh-CN", signal });
  const supplement = calls.find(call => call.system.includes("SUPPLEMENT"))!;
  expect(supplement.data.subtopics.flatMap(topic => topic.units.map(item => item.statement))).toEqual(["我要在对话旁加上书签，支持手动标注。"]);
  expect(draft.chapters[0].paragraphs.map(paragraph => paragraph.unitIds)).toEqual([[core.id, echo.id], [decided.id]]);
  expect(draft.chapters[0].problems.filter(problem => problem.startsWith("important units"))).toEqual([]);
  expect(draft.report).toMatchObject({ restatements_cited: 1, write_supplements: 1, write_supplemented_units: 1 });
});

it("drops a supplement paragraph that copies a written point under another unit's label", async () => {
  const decided = unit(1, "我要在对话旁加上书签，支持手动标注。", { adoption: "user_decision", role: "user", kind: "decision" });
  const exported = unit(2, "导出功能提供 Markdown 文件，按章节拆分并附带来源链接与生成时间。");
  const written = "AI 建议导出功能提供 Markdown 文件，按章节拆分并附带来源链接与生成时间。";
  // The part leaves the decision out; the supplement repeats the written point and cites the decision for it.
  const { ai } = model((data, system) => {
    const ids = data.subtopics.flatMap(topic => topic.units.map(item => item.id));
    if (system.includes("SUPPLEMENT")) return { opening: "", subtopics: data.subtopics.map(topic => ({ title: topic.title, paragraphs: [{ text: written, unitIds: ids }] })) };
    return { opening: "", openingUnitIds: [], subtopics: [{ title: "全文索引", paragraphs: [{ text: written, unitIds: [ids[1]] }] }] };
  });
  const draft = await writeWikiDraft({ ledger: ledger([decided, exported]), ai, locale: "zh-CN", signal });
  expect(draft.chapters[0].paragraphs.map(paragraph => paragraph.unitIds)).toEqual([[exported.id], [decided.id]]);
  expect(draft.report).toMatchObject({ repeated_paragraphs_dropped: 1, confirmed_decisions_restored: 1 });
  expect(draft.chapters[0].problems.some(problem => problem.startsWith("important units"))).toBe(false);
});

it("measures how a draft uses its explanation groups: cores explained twice and conditions lost", () => {
  const a = unit(1, "导出提供 Markdown 文件。"), b = unit(2, "导出提供 Markdown 文件，附带来源。"), c = unit(3, "导出提供 Markdown 文件，按章节拆分。");
  const exported: WikiExplanationGroup = { id: "g:1", core: "导出提供 Markdown 文件。", homeSubjectId: "s:search", anchorUnitId: a.id, signature: "g", members: [
    { unitId: a.id, support: "导出提供 Markdown 文件", adds: [], role: "restates" }, { unitId: b.id, support: "导出提供 Markdown 文件", adds: ["附带来源"], role: "adds" }, { unitId: c.id, support: "导出提供 Markdown 文件", adds: ["按章节拆分"], role: "adds" }] };
  const draft = { version: 1 as const, generatedAt: 0, status: "complete" as const, report: {}, chapters: [{ id: "a", title: "导出", question: "?", group: "", body: "", paragraphs: [
    { subtopic: "导出", text: "AI 建议导出提供 Markdown 文件，并附带来源。", unitIds: [a.id, b.id] }, { subtopic: "导出", text: "导出提供 Markdown 文件。", unitIds: [c.id] }], problems: [] }] };
  // The core twice; 按章节拆分 never written where its member is cited.
  expect(wikiGroupMetrics({ ...ledger([a, b, c], { groups: [exported] }), draft })).toMatchObject({ groups: 1, cited: 1, explainedTwice: 1, explainedTwiceRate: 1, conditions: 2, conditionsLost: 1, conditionLossRate: .5 });
});

it("skips the stored answers on every writing request of a fresh rewrite, and only then", async () => {
  const units = [unit(1, "全文索引使用 Orama。", { adoption: "user_adopted" }), unit(2, "索引每 30 秒增量更新。")];
  const seen: Array<boolean | undefined> = [];
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => { seen.push(request.bypassCache); const data = JSON.parse(request.prompt) as Payload; return request.validate(claimed(faithful(data))); } };
  await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(seen.every(value => !value)).toBe(true);
  seen.length = 0;
  await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal, fresh: true });
  expect(seen.length).toBeGreaterThan(0);expect(seen.every(value => value === true)).toBe(true);
});

it("keeps the earlier draft when every writing request fails, and marks the failure", async () => {
  const book = ledger([unit(1, "全文索引使用 Orama。"), unit(2, "侧边栏只放搜索入口。")]);
  const good = await writeLedgerDraft(book, { ai: model(faithful).ai, locale: "zh-CN", signal });
  expect(good.draft?.chapters.some(chapter => chapter.paragraphs.length)).toBe(true);
  const down = { generateStructured: async <T,>(): Promise<T> => { throw new TypeError("Failed to fetch"); } };
  const kept = await writeLedgerDraft(good, { ai: down, locale: "zh-CN", signal });
  expect(kept.draft).toBe(good.draft);expect(kept.lastFailure?.step).toBe("write");
  // An update hands the earlier draft as previous: it stays when the new one, written afresh, is empty.
  const update = await writeLedgerDraft(book, { ai: down, locale: "zh-CN", signal, previous: good.draft, fresh: true });
  expect(update.draft).toBe(good.draft);
  expect((await writeLedgerDraft(kept, { ai: model(faithful).ai, locale: "zh-CN", signal })).lastFailure).toBeUndefined();
});

it("writes a part that runs past the output limit as two halves instead of losing it", async () => {
  // The user's own words: every one is shown, so the part holds all twelve.
  const statements = ["导出提供 Markdown 文件。", "侧栏默认收起。", "首页只放搜索入口。", "索引在后台增量更新。", "书签支持手动标注。", "来源面板展示原文。", "主题使用深色模式。", "快捷键打开搜索框。", "对话按平台分组。", "摘要限制在三百字内。", "回收站保留三十天。", "设置页可以清空缓存。"];
  // More than eight units in one request runs past the limit; fewer is written.
  const { ai, calls } = model(data => { const size = data.subtopics.reduce((sum, topic) => sum + topic.units.length, 0); if (size > 8) throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED"); return faithful(data); });
  const draft = await writeWikiDraft({ ledger: ledger(statements.map((text, index) => unit(index + 1, text, { role: "user" }))), ai, locale: "zh-CN", signal });
  expect(draft.report).toMatchObject({ write_parts_halved: 1 });
  expect(draft.report.write_parts_lost).toBeUndefined();
  expect(new Set(draft.chapters[0].paragraphs.flatMap(paragraph => paragraph.unitIds)).size).toBe(12);
  // One truncated request, not retried as it was, then the two halves.
  expect(calls.map(call => call.data.subtopics.reduce((sum, topic) => sum + topic.units.length, 0))).toEqual([12, 6, 6]);
});

it("drops ChatGPT's citation markers from quotes and keeps a link's name", () => {
  const text = "不能把「支持导入 ChatGPT」当成独特优势。citeturn478237search0 2. TypingMind urlTypingMind 官网https://www.typingmind.com/ 也是统一入口。";
  expect(chatMarkers(text)).toBe("不能把「支持导入 ChatGPT」当成独特优势。 2. TypingMind TypingMind 官网 也是统一入口。");
  expect(chatMarkers("由 entity[\"company\",\"OpenAI\",\"AI lab\"] 发布。")).toBe("由 OpenAI 发布。");
  // In a footnote: no marker left, and an excerpt never opens with the closing mark of the sentence before.
  const marked = { ...unit(1, "统一入口产品很多。"), evidence: { ...unit(1, "").evidence, quote: "统一入口产品很多。citeturn1search0" } };
  const opened = { ...unit(2, "目标用户是用多个 AI 推进项目的人。"), evidence: { ...unit(2, "").evidence, messageId: "m2", quote: "」 而是：使用多个 AI 推进同一个项目的人。" } };
  const draft = { version: 1 as const, generatedAt: 0, status: "complete" as const, report: {}, chapters: [{ id: "a", title: "定位", question: "?", group: "", body: "统一入口产品很多。", paragraphs: [{ subtopic: "竞品", text: "统一入口产品很多。", unitIds: ["unit:1"] }, { subtopic: "用户", text: "目标用户是用多个 AI 推进项目的人。", unitIds: ["unit:2"] }], problems: [] }] };
  const notes = wikiDraftMarkdown({ ...ledger([marked, opened]), draft }, "Atlas", "zh-CN");
  expect(notes).not.toMatch(/[-]|turn1search0/u);
  expect(notes).toContain("“而是：使用多个 AI 推进同一个项目的人。”");
});

it("sends versions of one point as one, cites the others where it is written, and asks again when a paragraph repeats one point", async () => {
  const versions = [unit(1, "底部面板默认完全收起，仅显示 40~44px 高的 Bar，包含架构、BOM、校验，点击才展开。"), unit(2, "底部 BOM/Validation 区域默认折叠为 36-40px 的 Bottom Bar，点击后展开，Canvas 作为视觉焦点。"), unit(3, "底部 Drawer 包含架构、BOM、校验，默认收起，仅保留 40-48px 高的 Tab Bar，点击后展开。")];
  const other = unit(4, "首页只放一个搜索输入框。");
  const merged = "AI 建议底部面板默认收起为一条包含架构、BOM、校验的标签栏，点击才展开（高度在不同讨论中为 40–44px、36–40px 或 40–48px）。";
  const { ai, calls } = model(data => ({ opening: "底部面板和首页都以简洁为主。", subtopics: [{ title: data.subtopics[0].title, paragraphs: [{ text: merged, unitIds: [data.subtopics[0].units[0].id] }, { text: "AI 建议首页只放一个搜索输入框。", unitIds: [data.subtopics[0].units[1].id] }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger([...versions, other]), ai, locale: "zh-CN", signal });
  // One point goes out, the fullest version, carrying the others' wording; the three are cited together.
  const sent = calls[0].data.subtopics[0].units as unknown as Array<{ statement: string; otherVersions?: string[] }>;
  expect(sent).toHaveLength(2);
  expect(sent[0].otherVersions).toHaveLength(2);
  expect(draft.chapters[0].paragraphs[0].unitIds.sort()).toEqual(versions.map(item => item.id).sort());
  expect(draft.report).toMatchObject({ versions_cited: 2 });
  expect(calls).toHaveLength(1);
  // A paragraph that still tells one point twice is asked for again.
  const repeated = "AI 建议底部面板默认完全收起，仅显示 40~44px 高的 Bar，包含架构、BOM、校验，点击才展开。AI 还建议底部 Drawer 包含架构、BOM、校验，默认收起，仅保留 40-48px 高的 Tab Bar，点击后展开。";
  const again = model((data, system) => ({ opening: "底部面板和首页都以简洁为主。", subtopics: [{ title: data.subtopics[0].title, paragraphs: [{ text: system.includes("SECOND ATTEMPT") ? merged : repeated, unitIds: [data.subtopics[0].units[0].id] }, { text: "AI 建议首页只放一个搜索输入框。", unitIds: [data.subtopics[0].units[1].id] }] }] }));
  await writeWikiDraft({ ledger: ledger([...versions, other]), ai: again.ai, locale: "zh-CN", signal });
  expect(again.calls[1].system).toContain("tells again a point another sentence of this paragraph states");
});

it("writes a stray version of a group's point into the group's paragraph, never folding a decision into a proposal", async () => {
  const a = unit(1, "V0.1 版本严格限定仅支持 ESP32 DevKit V1 及常见模块化电子元件，禁止 PCB 设计、Gerber 导出、STM32、FPGA 支持。"), b = unit(2, "V0.1 版本仅支持 ESP32 模块化硬件，不包含 PCB 设计或复杂嵌入式代码生成。");
  const stray = unit(3, "第一版严格限定支持 ESP32 DevKit V1 及常见模块化电子元件，禁止加入 PCB 设计、STM32、FPGA、高压电路、多人协作。");
  const decided = unit(4, "我决定第一版只支持 ESP32 DevKit V1 及常见模块化电子元件，不做 PCB 设计、STM32、FPGA。", { adoption: "user_decision", role: "user", kind: "decision" });
  const scope: WikiExplanationGroup = { id: "g:1", core: "V0.1 仅支持 ESP32 模块化硬件，不做 PCB。", homeSubjectId: "s:search", anchorUnitId: a.id, signature: "g", members: [
    { unitId: a.id, support: "V0.1 仅支持 ESP32 模块化硬件", adds: ["禁止 Gerber 导出、STM32、FPGA 支持"], role: "adds" }, { unitId: b.id, support: "V0.1 仅支持 ESP32 模块化硬件", adds: ["不包含复杂嵌入式代码生成"], role: "adds" }] };
  const text = "AI 建议 V0.1 只支持 ESP32 DevKit V1 及常见模块化电子元件，不做 PCB 设计、Gerber 导出、STM32、FPGA、高压电路、多人协作和复杂嵌入式代码生成。";
  const { ai, calls } = model(data => { const ids = data.subtopics[0].units.map(item => item.id); return { opening: "第一版范围很窄。", subtopics: [{ title: data.subtopics[0].title, paragraphs: [{ text, unitIds: ids.slice(0, 2) }, { text: "用户已决定第一版只支持 ESP32 DevKit V1 及常见模块化电子元件，不做 PCB 设计、STM32、FPGA。", unitIds: ids.slice(2) }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger([a, b, stray, decided], { groups: [scope] }), ai, locale: "zh-CN", signal });
  const data = calls[0].data as unknown as { groups: Array<{ otherVersions?: string[] }>; subtopics: Array<{ units: Array<{ statement: string }> }> };
  // The proposal joins the group as another version; the decision stays a point of its own.
  expect(data.groups[0].otherVersions).toEqual([stray.statement]);
  expect(data.subtopics[0].units.map(item => item.statement)).not.toContain(stray.statement);
  expect(data.subtopics[0].units.map(item => item.statement)).toContain(decided.statement);
  expect(draft.chapters[0].paragraphs[0].unitIds).toContain(stray.id);
});

it("writes a unit the merge kept apart into its partner's explanation group, even in words of its own", async () => {
  const a = unit(1, "V0.1 版本严格限定仅支持 ESP32 DevKit V1 及常见模块化电子元件。"), b = unit(2, "V0.1 版本仅支持 ESP32 模块化硬件，不包含 PCB 设计。");
  // Its wording shares too little with the members to be read as a version; the merge said it is the same point.
  const partner = unit(3, "首个公开版本的硬件范围限定在 ESP32 开发板与常见模块。");
  const scope: WikiExplanationGroup = { id: "g:1", core: "V0.1 仅支持 ESP32 模块化硬件。", homeSubjectId: "s:search", anchorUnitId: a.id, signature: "g", members: [
    { unitId: a.id, support: "V0.1 仅支持 ESP32 模块化硬件", adds: [], role: "adds" }, { unitId: b.id, support: "V0.1 仅支持 ESP32 模块化硬件", adds: ["不包含 PCB 设计"], role: "adds" }] };
  const { ai, calls } = model(faithful);
  const draft = await writeWikiDraft({ ledger: ledger([a, b, partner], { groups: [scope], restated: [[a.id, partner.id]] }), ai, locale: "zh-CN", signal });
  const data = calls[0].data as unknown as { groups: Array<{ otherVersions?: string[] }> };
  expect(data.groups[0].otherVersions).toEqual([partner.statement]);
  expect(draft.report.write_restated_together).toBe(1);expect(draft.report.write_restated_in_chapter).toBe(2);
});

it("writes the parts after the first at the same time, merged in order without repeats", async () => {
  const units = Array.from({ length: 160 }, (_, index) => unit(index, `检索第 ${index} 条机制。`, { role: "user" }));
  const { ai: base, calls } = model(faithful);
  let open = 0, most = 0;
  const ai = { ...base, generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => { open++; most = Math.max(most, open); try { await new Promise(resolve => setTimeout(resolve, 5)); return await base.generateStructured(request); } finally { open--; } } };
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  const parts = calls.map(call => call.data.part.index);
  expect(parts[0]).toBe(1);
  expect([...parts].sort()).toEqual([1, 2, 3]);
  // The second and third parts were in flight together, each told what the first part wrote.
  expect(most).toBe(2);
  expect(calls.filter(call => call.data.part.index > 1).every(call => call.data.part.written?.length === 1)).toBe(true);
  expect(draft.chapters[0].body.match(/^### /gmu)).toHaveLength(1);
  expect(draft.chapters[0].paragraphs.flatMap(paragraph => paragraph.unitIds)).toHaveLength(160);
});

it("names the check behind each rewrite, without the text it quotes", () => {
  expect(rewriteReason('"消息保存在…" has numbers its units do not state: 3, 5')).toBe("has numbers its units do not state");
  expect(rewriteReason('the claim "检索…" is not in the paragraph; copy the sentence exactly')).toBe("is not in the paragraph");
  expect(rewriteReason('the opening presents proposals as settled ("首页…"); mark them')).toBe("opening presents proposals as settled");
  expect(rewriteReason('"侧栏…" drops the exact details v1.2')).toBe("drops the exact details");
});

it("treats a sentence as a restatement only when it adds no number or name of its own", () => {
  expect(restatesSentence("ChatAtlas 定位为本地优先、BYOK 的开源 AI 知识管理工具，用于整理跨平台对话。", "ChatAtlas 定位为开源、本地优先且支持 BYOK 的 AI 对话知识管理工具，用于整理跨平台的 AI 对话。")).toBe(true);
  expect(restatesSentence("第一版目标是 10 名有真实历史记录的用户参与测试。", "第一版目标是 20 名有真实历史记录的用户参与测试。")).toBe(false);
  expect(restatesSentence("索引使用 Orama 在本地完成全文检索。", "首页只保留搜索入口和最近项目。")).toBe(false);
});

it("treats roadmaps for the whole project as one scope, whatever subjects they were filed under, and marks the newest", async () => {
  const units = [unit(1, "MVP 第一版 P0 包括导入、全文搜索和消息定位。", { kind: "plan" }), unit(2, "开发分为 M1 全文检索、M2 混合检索、M3 LLM 重排。", { kind: "plan" })];
  const organization = { subjects: [{ id: "s:mvp", name: "MVP 功能", aliases: [], unitIds: ["unit:1"] }, { id: "s:road", name: "开发里程碑", aliases: [], unitIds: ["unit:2"] }] };
  const fake = model(faithful);
  await writeWikiDraft({ ledger: ledger(units, organization), ai: fake.ai, locale: "zh-CN", signal });
  const sent = fake.calls[0].data.subtopics.flatMap(topic => topic.units) as Array<{ planScope?: string; latestPlan?: boolean }>;
  // One scope for the whole project: the newer roadmap is the one sent.
  expect((sent as Array<{ statement?: string }>).map(item => item.statement)).toEqual([units[1].statement]);
});

it("removes holder wording, since the mark after the sentence says whose it is", async () => {
  const units = [unit(1, "导入支持 ChatGPT。", { role: "user" }), unit(2, "搜索覆盖标题与正文。", { role: "user" })];
  const { ai } = model(data => ({ opening: "导入与搜索。", subtopics: [{ title: data.subtopics[0].title, paragraphs: [
    { text: "据用户提供的材料，导入支持 ChatGPT，首期只做这一个平台的对话导入。", unitIds: [data.subtopics[0].units[0].id] },
    { text: "据用户提供的材料，搜索覆盖标题与正文，结果定位到具体消息并高亮原文。", unitIds: [data.subtopics[0].units[1].id] }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(draft.chapters[0].paragraphs.map(paragraph => paragraph.text)).toEqual(["导入支持 ChatGPT，首期只做这一个平台的对话导入。", "搜索覆盖标题与正文，结果定位到具体消息并高亮原文。"]);
});

it("tells roadmaps apart across a chapter's parts, versions in any spelling included", async () => {
  // 80 units of the user's own words fill more than one part; the two roadmaps sit in different parts.
  const units = [unit(0, "V0.1 只做 Orama 全文检索，V0.2 再加入向量检索。", { kind: "plan" }), ...Array.from({ length: 78 }, (_, index) => unit(index + 1, `检索第 ${index + 1} 条机制。`, { role: "user" })), unit(79, "v0.2 版本加入 Embedding 混合检索，v0.3 加入 LLM 重排。", { kind: "plan" })];
  const { ai, calls } = model(faithful);
  await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(calls.length).toBeGreaterThan(1);
  const sent = calls.flatMap(call => call.data.subtopics.flatMap(topic => topic.units)) as Array<{ statement: string; plan?: string; planScope?: string; latestPlan?: boolean }>;
  // The two roadmaps sit in different parts; only the newest, in the later part, is sent and written.
  expect(sent.map(item => item.statement)).toContain(units[79].statement);
  expect(sent.map(item => item.statement)).not.toContain(units[0].statement);
});

it("keeps the letters that tell plans apart out of the text", async () => {
  const units = [unit(1, "M1 完成全文检索，M2 加入混合检索。", { kind: "plan" })];
  const { ai } = model(data => ({ opening: "路线。", subtopics: [{ title: data.subtopics[0].title, paragraphs: [{ text: "最新提出的路线（Plan B）为 M1 完成全文检索，M2 加入混合检索。", unitIds: [data.subtopics[0].units[0].id] }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(draft.chapters[0].paragraphs[0].text).toBe("最新提出的路线为 M1 完成全文检索，M2 加入混合检索。");
  expect(draft.report.plan_labels_removed).toBe(1);
});

it("leaves an earlier roadmap out and writes the newest in full", async () => {
  const inMessage = (item: WikiKnowledgeUnit, messageId: string, messageIndex: number) => ({ ...item, evidence: { ...item.evidence, messageId, messageIndex } });
  const units = [
    inMessage(unit(1, "M1 实现全文检索。", { kind: "plan" }), "old", 1), inMessage(unit(2, "M2 加入 Embedding 混合检索与本地向量。", { kind: "plan" }), "old", 1), inMessage(unit(3, "M3 加入 LLM 重排。", { kind: "plan" }), "old", 1),
    inMessage(unit(4, "M1 先做消息定位。", { kind: "plan" }), "new", 9), inMessage(unit(5, "M2 再做项目重建。", { kind: "plan" }), "new", 9)];
  const fake = model(faithful);
  const draft = await writeWikiDraft({ ledger: ledger(units), ai: fake.ai, locale: "zh-CN", signal });
  const sent = fake.calls[0].data.subtopics.flatMap(topic => topic.units).map(item => item.statement);
  // No step of the earlier plan; the newest plan's steps as selected.
  expect(sent.filter(text => [units[0], units[1], units[2]].some(item => item.statement === text))).toEqual([]);
  expect(sent).toContain(units[3].statement);
  expect(draft.report.earlier_plans_left_out).toBe(1);
});

it("removes a sentence repeating its paragraph and drops a claim not copied exactly, without a rewrite", async () => {
  const units = [unit(1, "索引使用 Orama 在本地完成全文检索，覆盖标题与正文。")];
  const { ai, calls } = model(data => ({ opening: "检索在本地完成。", subtopics: [{ title: data.subtopics[0].title, paragraphs: [{ text: "AI 建议索引使用 Orama 在本地完成全文检索，覆盖标题与正文。也就是说，索引使用 Orama 在本地完成全文检索并覆盖标题与正文。", unitIds: [data.subtopics[0].units[0].id], claims: [{ text: "索引用 Orama 做全文检索", unitIds: [data.subtopics[0].units[0].id] }] }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(calls).toHaveLength(1);
  expect(draft.chapters[0].paragraphs[0].text).toBe("索引使用 Orama 在本地完成全文检索，覆盖标题与正文。");
  expect(draft.report.paragraph_repeats_trimmed).toBe(1);
});

it("ends each holder run of a paragraph on a claim, so the document can mark where the holder changes", async () => {
  const material = { ...unit(2, "首页只保留搜索入口。", { role: "user" }), evidence: { ...unit(2, "").evidence, role: "user" as const, pasted: true } };
  const units = [unit(1, "搜索结果按时间排序。"), unit(3, "排序时最近一周的对话优先。"), material];
  const { ai } = model(data => { const [first, second, third] = data.subtopics[0].units.map(item => item.id); return { opening: "搜索与首页。", subtopics: [{ title: data.subtopics[0].title, paragraphs: [
    { text: "搜索结果按时间排序。排序时最近一周的对话优先。首页只保留搜索入口。", unitIds: [first, second, third], claims: [] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  const claims = draft.chapters[0].paragraphs[0].claims ?? [];
  // Two AI sentences make one run, its mark on the second; the pasted sentence is a run of its own.
  expect(claims.map(claim => claim.text)).toEqual(["排序时最近一周的对话优先。", "首页只保留搜索入口。"]);
  // Each mark cites only its own sentence, so a click opens that sentence's original.
  expect(claims[0].unitIds).toEqual(["unit:3"]);expect(claims.every(claim => claim.markOnly)).toBe(true);
  expect(draft.report.holder_marks_added).toBe(2);
});

it("does not count list numbering or 一天 written as 1 天 as numbers the units lack", async () => {
  const units = [unit(1, "首次整理预计耗时一天，之后按需增量更新。")];
  const { calls, ai } = model(data => ({ opening: "整理节奏。", subtopics: [{ title: data.subtopics[0].title, paragraphs: [{ text: "AI 建议分两步：1. 首次整理预计耗时 1 天；2、之后按需增量更新。", unitIds: [data.subtopics[0].units[0].id] }] }] }));
  await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(calls).toHaveLength(1);
});

it("sends only the newest of several roadmaps of a scope, and strips bare plan letters from the text", async () => {
  const road = (index: number, text: string) => ({ ...unit(index, text, { kind: "plan" }), evidence: { ...unit(index, text).evidence, messageId: `plan${index}`, messageIndex: index } });
  const units = [
    road(1, "第一套路线先做导入：M1 支持 ChatGPT 与 Claude 对话导入和去重；M2 做标题搜索；M3 做标签管理；M4 做团队共享与权限。"),
    road(2, "第二套路线先做检索：M1 实现 IndexedDB 加 Orama 全文检索；M2 引入本地 Embedding 实现混合检索；M3 进行 LLM 重排。"),
    road(3, "第三套路线先做导出：M1 生成 Markdown 上下文包；M2 支持 Dashboard 摘要；M3 接入 MCP Server 给其他 AI 调用。"),
    road(4, "最新路线分三版推进：v0.1 只做 Orama 全文索引；v0.2 增加 Embedding 和 Hybrid Search。")];
  const fake = model(data => ({ opening: "检索路线以最新一套为准。", subtopics: [{ title: data.subtopics[0].title, paragraphs: [{ text: "AI 最近提出的路线 Plan D 分三版推进：v0.1 只做 Orama 全文索引；v0.2 增加 Embedding 和 Hybrid Search。此前还提出过 Plan B 等按 M1–M4 推进的路线。", unitIds: data.subtopics[0].units.map(item => item.id) }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger(units), ai: fake.ai, locale: "zh-CN", signal });
  const sent = fake.calls[0].data.subtopics.flatMap(topic => topic.units) as Array<{ statement: string; earlierPlan?: true; latestPlan?: true }>;
  expect(sent.map(item => item.statement)).toContain(units[3].statement);
  expect(sent.filter(item => item.earlierPlan)).toEqual([]);
  expect(sent.some(item => /^第[一二三]套/u.test(item.statement))).toBe(false);
  expect(draft.report.earlier_plans_left_out).toBe(3);
  expect(draft.chapters[0].body).not.toMatch(/Plan [A-Z]/u);
});

it("sends a rewrite for a sentence broken off with ……, and never sends …… itself", async () => {
  const units = [unit(1, "第一版只需稳定支持 ChatGPT 导入，核心功能包括统一全文搜索与消息级定位。")];
  const { ai, calls } = model((data, system) => ({ opening: "第一版范围。", subtopics: [{ title: data.subtopics[0].title, paragraphs: [{ text: system.includes("SECOND ATTEMPT") ? "第一版只需稳定支持 ChatGPT 导入，核心功能包括统一全文搜索与消息级定位。" : "第一版只需稳定支持 ChatGPT 导入，核心功能包括统一全文搜索与消息级定……", unitIds: [data.subtopics[0].units[0].id] }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(calls).toHaveLength(2);
  expect(draft.chapters[0].body).not.toContain("……");
});

it("finds sentences that only evaluate or sum up their paragraph, and keeps those with a rule, name or number of their own", () => {
  const rest = "主内容区通过标签页切换总览、知识库、对话和时间线四个视图，用户能从项目状态到原始记录逐层查阅。";
  expect(isCommentary("这种设计确保用户能从宏观状态到微观原始记录进行全方位查阅。", rest)).toBe(true);
  expect(isCommentary("这种设计确保了用户在低介入状态下仍能获得高价值回报，体现了产品对用户体验流畅性的重视。", "用户不主动整理也能搜索和复用。")).toBe(true);
  expect(isCommentary("这一设计确保搜索结果不超过 20 条。", rest)).toBe(false);
  expect(isCommentary("这一约束确保插入前必须由用户确认。", rest)).toBe(false);
  expect(isCommentary("索引使用 Orama 在本地完成全文检索。", rest)).toBe(false);
  // A comment on the previous sentence, or one achieving only abstract qualities, goes even in words of its own.
  expect(isCommentary("这一决定明确了当前阶段的核心交付物，确保资源集中在最基础且高频使用的场景上，避免过早陷入复杂功能的开发泥潭。", rest)).toBe(true);
  expect(isCommentary("这一原则旨在避免数据孤岛，确保各模块间事实的一致性。", rest)).toBe(true);
  expect(isCommentary("这种机制确保了内容的灵活性与准确性。", rest)).toBe(true);
  expect(isCommentary("这种机制确保插入前由用户预览上下文。", rest)).toBe(false);
});

it("removes a closing sentence that only sums up the paragraph", async () => {
  const units = [unit(1, "主内容区通过标签页切换总览、知识库、对话和时间线四个视图。")];
  const { ai } = model(data => ({ opening: "四个视图。", subtopics: [{ title: data.subtopics[0].title, paragraphs: [{ text: "主内容区通过标签页切换总览、知识库、对话和时间线四个视图。这种设计确保用户能在总览、知识库、对话和时间线之间全方位查阅。", unitIds: [data.subtopics[0].units[0].id] }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(draft.chapters[0].paragraphs[0].text).toBe("主内容区通过标签页切换总览、知识库、对话和时间线四个视图。");
  expect(draft.report.commentary_removed).toBe(1);
});

it("finds a clause that names what a cited unit rules out without ruling it out, and accepts other wordings of the negation", () => {
  const unit = "优先采用 Chrome 原生 Side Panel API 实现，避免使用 margin-left 或强行修改页面宽度来平移整个 ChatGPT 页面。";
  expect(lostNegation("侧栏优先采用 Chrome 原生 Side Panel API 实现，或通过 margin-left 或强行修改页面宽度来平移整个 ChatGPT 页面。", [unit])?.clause).toBe("或通过 margin-left 或强行修改页面宽度来平移整个 ChatGPT 页面");
  expect(lostNegation("侧栏优先采用 Chrome 原生 Side Panel API 实现，不通过 margin-left 或强行修改页面宽度来平移整个 ChatGPT 页面。", [unit])).toBeUndefined();
  expect(lostNegation("侧栏采用原生 Side Panel，而非用 margin-left 强行修改页面宽度来平移 ChatGPT 页面。", [unit])).toBeUndefined();
  expect(lostNegation("第一版明确排除完整 Wiki 自动生成、知识图谱和自动同步等功能。", ["第一版不实现 Wiki、知识图谱、自动同步等所有功能。"])).toBeUndefined();
  // A paragraph about something else that happens to share a word is not the ruled-out thing.
  expect(lostNegation("本地数据库使用 IndexedDB 保存原始消息。", ["不引入新的数据库或单独的向量库。"])).toBeUndefined();
});

it("sends a rewrite when the paragraph turns a ruled-out option into an option", async () => {
  const units = [unit(1, "优先采用 Chrome 原生 Side Panel API 实现，避免使用 margin-left 或强行修改页面宽度来平移整个 ChatGPT 页面。")];
  const { ai, calls } = model((data, system) => ({ opening: "侧栏实现。", subtopics: [{ title: data.subtopics[0].title, paragraphs: [{ text: system.includes("SECOND ATTEMPT") ? units[0].statement : "优先采用 Chrome 原生 Side Panel API 实现，或通过 margin-left 或强行修改页面宽度来平移整个 ChatGPT 页面。", unitIds: [data.subtopics[0].units[0].id] }] }] }));
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(calls).toHaveLength(2);
  expect(calls[1].system).toContain("drops the negation");
  expect(draft.chapters[0].body).toContain("避免使用 margin-left");
});

it("drops a remark on the writer's own sentences and a sentence that only records the user's question", () => {
  const rest = "原生 ChatGPT 在长对话中不保证能准确找回早期消息的原文或细节，仅能保持大致上下文连续性。";
  expect(isCommentary("询问原生 ChatGPT 在同一个对话聊了400条后是否还记得第一条。", rest)).toBe(true);
  expect(isCommentary("这两者并存，前者为探讨方向，后者为具体建议。", "探讨是否建立统一的 Project Knowledge Layer。建议建立统一的 Project Knowledge Layer。")).toBe(true);
  // A paragraph made only of the question keeps it.
  expect(isCommentary("询问原生 ChatGPT 是否还记得第一条。", "")).toBe(false);
});

it("sends a rewrite for a subtopic opening on 这一决定 and for a false choice", async () => {
  const units = [unit(1, "首页以居中主标题、简短副标题和横向导入卡片为基准，后续不再重新设计整体布局。")];
  const { ai, calls } = model((data, system) => ({ opening: "首页布局。", subtopics: [{ title: data.subtopics[0].title, paragraphs: [{ text: system.includes("SECOND ATTEMPT") ? units[0].statement : "这一决定确立了后续不再重新设计整体布局的基准，包括居中主标题、简短副标题和横向导入卡片。", unitIds: [data.subtopics[0].units[0].id] }] }] }));
  await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(calls).toHaveLength(2);
  expect(calls[1].system).toContain("opens the subtopic pointing back");
});


it("preserves a grounded Markdown comparison instead of flattening it into prose",async()=>{
 const units=[unit(1,"关键词搜索无需密钥。"),unit(2,"语义搜索需要用户配置。")];
 const text="| 查找方式 | 使用条件 |\n| --- | --- |\n| 关键词搜索 | 无需密钥 |\n| 语义搜索 | 需要用户配置 |";
 const {ai,calls}=model(data=>({opening:"查找方式有不同的使用条件。",subtopics:[{title:data.subtopics[0].title,paragraphs:[{text,unitIds:data.subtopics[0].units.map(item=>item.id)}]}]}));
 const draft=await writeWikiDraft({ledger:ledger(units),ai,locale:"zh-CN",signal});
 expect(calls[0].system).toContain("compact GFM table");
 expect(draft.chapters[0].paragraphs[0].text).toBe(text);
 expect(draft.chapters[0].body).toContain(text);
});


it("writes structured lists and comparisons with per-item evidence and preserves Markdown through local repairs",async()=>{
 const units=[unit(1,"AI 建议关键词查找无需密钥。"),unit(2,"AI 建议语义增强需要用户配置。")];
 const {ai,calls}=model(data=>{
  const [one,two]=data.subtopics[0].units.map(item=>item.id);
  return {opening:"查找方式与使用条件。",subtopics:[{title:data.subtopics[0].title,blocks:[
   {type:"list",items:[{text:"AI 建议关键词查找无需密钥。",unitIds:[one]},{text:"AI 建议语义增强需要用户配置。",unitIds:[two]}]},
  ]}]};
 });
 const draft=await writeWikiDraft({ledger:ledger(units),ai,locale:"zh-CN",signal});
 expect(calls).toHaveLength(1);
 expect(draft.chapters[0].body).toContain("- AI 建议关键词查找无需密钥。\n- AI 建议语义增强需要用户配置。");
 expect(draft.chapters[0].paragraphs[0].claims).toEqual(expect.arrayContaining([
  {text:"AI 建议关键词查找无需密钥。",unitIds:[units[0].id]},
  {text:"AI 建议语义增强需要用户配置。",unitIds:[units[1].id]},
 ]));
});

it("accepts a structured comparison without flattening rows or borrowing evidence across them",async()=>{
 const units=[unit(1,"关键词查找无需密钥。"),unit(2,"语义增强需要用户配置。")];
 const {ai}=model(data=>({opening:"查找条件。",subtopics:[{title:data.subtopics[0].title,blocks:[{type:"comparison",columns:["方式","条件"],rows:[
  {cells:["关键词查找","无需密钥"],unitIds:[data.subtopics[0].units[0].id]},
  {cells:["语义增强","需要用户配置"],unitIds:[data.subtopics[0].units[1].id]},
 ]}]}]}));
 const draft=await writeWikiDraft({ledger:ledger(units),ai,locale:"zh-CN",signal});
 expect(draft.chapters[0].body).toContain("| 方式 | 条件 |\n| --- | --- |\n| 关键词查找 | 无需密钥 |\n| 语义增强 | 需要用户配置 |");
 const claims=draft.chapters[0].paragraphs[0].claims!;
 expect(claims.find(claim=>claim.text==="无需密钥")?.unitIds).toEqual([units[0].id]);
 expect(claims.find(claim=>claim.text==="需要用户配置")?.unitIds).toEqual([units[1].id]);
 const {ledgerDocument}=await import("./wiki-ledger-document");
 const {projectSession}=await import("../test/project-fixture");
 const {projectDocument}=await import("../export/project-document");
 const book={...ledger(units),draft},saved=ledgerDocument(book,{c:"查找讨论"});
 const session={...projectSession(),...saved,projectState:undefined,wikiKnowledge:book};
 const selection={overview:false,wikiIds:saved.sections.map(section=>section.id),matters:false,history:false,sources:false};
 const exported=projectDocument(session,selection,"md").text;
 expect(exported).toContain("| 关键词查找 | 无需密钥");expect(exported).toContain("需要用户配置");
 expect(projectDocument(session,selection,"html").text).toContain("<table>");
});


it("does not present an assistant naming proposal as a settled choice even inside bold",async()=>{
 const units=[unit(1,"项目名为 ChatAtlas。",{kind:"decision"})];
 const {ai}=model(data=>({opening:"项目命名建议。",subtopics:[{title:data.subtopics[0].title,paragraphs:[{text:"**确定项目名为 ChatAtlas**。",unitIds:[data.subtopics[0].units[0].id]}]}]}));
 const draft=await writeWikiDraft({ledger:ledger(units),ai,locale:"zh-CN",signal});
 // The settling word goes, inside the bold too; nothing is put in its place: the sentence is unmarked, the default.
 expect(draft.chapters[0].body).toContain("**项目名为 ChatAtlas**。");
 expect(draft.chapters[0].body).not.toContain("确定项目名");
});

it("drops a sentence a later chapter tells again when an earlier paragraph told it, keeping new values and decisions", () => {
  const chapter = (id: string, paragraphs: Array<{ text: string; claims?: Array<{ text: string; unitIds: string[] }> }>) => ({ id, title: id, question: "", group: "", problems: [], body: paragraphs.map(paragraph => paragraph.text).join("\n\n"), paragraphs: paragraphs.map(paragraph => ({ subtopic: "s", unitIds: [], ...paragraph })) });
  const first = chapter("one", [{ text: "继续以 IndexedDB 和 Orama 为基础，优先 Local-first，不引入大型 GraphRAG、Agent 框架或新的数据库。项目采用 BYOK。" }]);
  const second = chapter("two", [
    { text: "侧边栏只显示摘要和原文入口，点击后在右侧展开详情。保持 Local-first + BYOK，复用 IndexedDB/Orama/已有数据模型，不引入大型框架或新数据库。" },
    // A value of its own (Transformers.js) keeps the sentence; a decided one stays too.
    { text: "继续以 IndexedDB 和 Orama 为基础，优先 Local-first，不引入 GraphRAG，改用 Transformers.js 做本地语义理解。" },
    { text: "继续以 IndexedDB 和 Orama 为基础，优先 Local-first，不引入大型 GraphRAG 或新的数据库。", claims: [{ text: "继续以 IndexedDB 和 Orama 为基础，优先 Local-first，不引入大型 GraphRAG 或新的数据库。", unitIds: ["u1"] }] },
  ]);
  const chapters = [first, second] as unknown as Parameters<typeof toldEarlier>[0];
  expect(toldEarlier(chapters, new Map([["u1", "confirmed"]]))).toBe(1);
  expect(second.paragraphs[0].text).toBe("侧边栏只显示摘要和原文入口，点击后在右侧展开详情。");
  expect(second.body).not.toContain("复用 IndexedDB/Orama/已有数据模型");
  expect(second.paragraphs).toHaveLength(3);
  expect(first.paragraphs[0].text).toContain("GraphRAG");
});

it("drops a suggestion that names the same count again after the sentence listing those items", () => {
  const text = "主内容区通过标签页切换四个视图：总览关注状态，知识库关注决策，对话浏览历史，时间线展示演进。建议包含 Overview、Wiki、Conversations、Timeline 四个视图。";
  expect(countedEcho(text)).toBe("建议包含 Overview、Wiki、Conversations、Timeline 四个视图。");
  // A count named once, or a suggestion with a count of its own, is no echo.
  expect(countedEcho("主内容区通过标签页切换四个视图。建议首屏只显示两个视图。")).toBeUndefined();
  expect(countedEcho("建议包含四个视图。")).toBeUndefined();
});

it("drops a sentence telling its paragraph's rule again with many shared terms, and tidies a gap or a closing semicolon", async () => {
  const units = [unit(1, "不照搬固定的 69 天时间衰减。"), unit(2, "低频操作收进更多菜单。")];
  const { ai } = model(data => { const [first, second] = data.subtopics[0].units.map(item => item.id); return { opening: "检索。", subtopics: [{ title: "全文索引", paragraphs: [
    { text: "在时间衰减策略上，不建议照搬 Personal AI Memory 的固定指数公式或固定的 69 天向量半衰期，因为 ChatAtlas 需要查找数月甚至一年前的具体内容，强时间衰减会导致正确答案排序靠后。资料提出采用查询意图驱动的时间衰减策略，严禁照搬竞品固定的69天时间半衰期公式。", unitIds: [first], claims: [] },
    { text: "保留极简深色列表，点击整行展开详情。 低频操作收进更多菜单，无可靠数据的模块应隐藏或放入次级操作；", unitIds: [second], claims: [] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  const [decay, list] = draft.chapters[0].paragraphs.map(paragraph => paragraph.text);
  expect(decay).not.toContain("资料提出");
  expect(list).toBe("保留极简深色列表，点击整行展开详情。低频操作收进更多菜单，无可靠数据的模块应隐藏或放入次级操作。");
});

it("names why a writing answer was refused by its check, never by its text", () => {
  expect(refusalReason(new Error("invalid_writing_item"))).toBe("invalid_writing_item");
  expect(refusalReason(new Error("一段模型写的说明"))).toBe("unknown");
});

it("keeps the first two sentences saying what the product is and drops later rewordings", () => {
  const chapter = (id: string, texts: string[]) => ({ id, title: id, question: "", group: "", problems: [], body: texts.join("\n\n"), paragraphs: texts.map(text => ({ subtopic: "s", unitIds: [], text })) });
  const one = chapter("one", ["ChatAtlas 定位为开源、本地优先的 AI 对话管理与项目知识工作区。首页只保留搜索入口。", "定位为跨平台 AI 知识管理层，而非统一聊天工作台。对话库应定位为原始对话资产管理模块。"]);
  const two = chapter("two", ["Atlas 定位为独立于任何 AI 平台、持续更新且用户可验证的项目知识工作区。侧边栏默认收起，只在用户点击按钮或搜索历史时才展开。"]);
  const chapters = [one, two] as unknown as Parameters<typeof toldEarlier>[0];
  expect(toldEarlier(chapters, new Map())).toBe(1);
  // A module's positioning (对话库) is not the product's and stays.
  expect(one.paragraphs[1].text).toContain("对话库应定位为原始对话资产管理模块。");
  expect(two.paragraphs[0].text).toBe("侧边栏默认收起，只在用户点击按钮或搜索历史时才展开。");
});

it("says whose report a passed check is when no unit is the user's report, and drops copied source numbers", async () => {
  expect(qualifyVerification("推荐推开式分屏。验证表明该方案下布局正常，并通过现有 lint、typecheck、test 和 build。", ["proposal"]))
    .toBe("推荐推开式分屏。来源报告该方案下布局正常，并通过现有 lint、typecheck、test 和 build（来源报告，未独立核验）。");
  // The user's own report, or a sentence already saying so, keeps its words.
  expect(qualifyVerification("已通过全部测试。", ["reported"])).toBe("已通过全部测试。");
  // The checks named before 通过 are a report too.
  expect(qualifyVerification("Lint/Typecheck/Test/Build 均通过，95 项测试覆盖 AI Logic。", ["proposal"])).toContain("（来源报告，未独立核验）");
  expect(qualifyVerification("上线前需验证是否通过 build。", ["proposal"])).toBe("上线前需验证是否通过 build。");
  const units = [unit(1, "Dashboard 回答四个核心问题。"), unit(2, "固定包含五个模块。")];
  const { ai } = model(data => { const [first, second] = data.subtopics[0].units.map(item => item.id); return { opening: "总览。", subtopics: [{ title: "全文索引", paragraphs: [
    { text: "Dashboard 定位为轻量级项目状态视图，回答四个核心问题[1]，保持极简快速[2,3]。", unitIds: [first], claims: [] },
    { text: "- 固定包含五个模块：当前进展、下一步行动、关键决策[5,6]。\n- 无实质数据的模块默认隐藏[7]。", unitIds: [second], claims: [] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(draft.chapters[0].paragraphs.map(paragraph => paragraph.text).join("\n")).not.toMatch(/\[\d/u);
});

it("keeps a paragraph whole when the repeat to remove is a clause the rest of its sentence leans on", () => {
  const chapter = { id: "one", title: "one", question: "", group: "", problems: [], body: "", paragraphs: [{ subtopic: "s", unitIds: [], text: "AI 推荐不等于采纳，用户建议不等于决定，计划开发不等于完成，保存建议不代表采用建议。" }] };
  const earlier = { ...chapter, id: "zero", paragraphs: [{ subtopic: "s", unitIds: [], text: "严格区分讨论、决定、完成和发布；用户建议不等于决定，AI 推荐不等于采纳，计划开发不等于完成。" }] };
  const chapters = [earlier, chapter] as unknown as Parameters<typeof toldEarlier>[0];
  toldEarlier(chapters, new Map());
  expect(chapter.paragraphs[0]?.text ?? "").not.toMatch(/^[，；]|^不等于/u);
});

it("keeps a point told twice in the chapter that talks most about what it names", () => {
  const chapter = (id: string, texts: string[]) => ({ id, title: id, question: "", group: "", problems: [], body: texts.join("\n\n"), paragraphs: texts.map(text => ({ subtopic: "s", unitIds: [], text })) });
  const value = chapter("定位", ["Atlas 帮用户找回历史讨论，不必每次重新整理。利用 IndexedDB 和 Orama 本地筛选，使用 contentHash 识别未变化消息并持久化缓存结果，只重新分析新增或修改的消息。"]);
  const technical = chapter("技术", ["IndexedDB 保存原始消息，Orama 负责检索，两者都在浏览器本地运行。", "使用 contentHash 识别未变化消息并持久化缓存结果，IndexedDB 与 Orama 只重新分析新增或修改的消息。"]);
  const chapters = [value, technical] as unknown as Parameters<typeof toldEarlier>[0];
  expect(toldEarlier(chapters, new Map())).toBe(1);
  // The earlier chapter loses it: the technical chapter names IndexedDB and Orama more.
  expect(value.paragraphs[0].text).toBe("Atlas 帮用户找回历史讨论，不必每次重新整理。");
  expect(technical.paragraphs[1].text).toContain("contentHash");
});

it("drops a clause that says again what its own sentence said, keeping clauses that add something", () => {
  expect(withoutRepeatedClauses("实施路径上，必须先完成稳定的 Orama 消息全文检索、中英文代码搜索、增量索引恢复及 Reader 精确定位，在此基础上完成现有 Orama 消息全文索引与准确 Reader 定位。"))
    .toBe("实施路径上，必须先完成稳定的 Orama 消息全文检索、中英文代码搜索、增量索引恢复及 Reader 精确定位。");
  // Different points, or a repeat naming something new, stay.
  const different = "侧边栏只显示摘要，详情在右侧抽屉展开，删除操作放入更多菜单。";
  expect(withoutRepeatedClauses(different)).toBe(different);
  const adds = "先完成 Orama 消息全文检索，再完成 Orama 消息全文检索的 Embedding 融合。";
  expect(withoutRepeatedClauses(adds)).toBe(adds);
});

it("leaves a check the work must pass as a requirement, without the report note", () => {
  expect(qualifyVerification("完成后必须通过 lint、typecheck、test 和 build，且不得 skip 测试。", ["proposal"])).toBe("完成后必须通过 lint、typecheck、test 和 build，且不得 skip 测试。");
  expect(qualifyVerification("提交前需通过全部单元测试。", ["proposal"])).toBe("提交前需通过全部单元测试。");
});

it("drops a sentence repeating its paragraph's list when its names differ from the rest only in case", async () => {
  const units = [unit(1, "禁止 hardcode UI 展示效果和使用大量 any。")];
  const text = "禁止 hardcode UI 展示效果、业务逻辑塞进组件、使用大量 any、生成假硬件参数、提前实现 PCB 或 Agent Framework。具体包括禁止大量Hardcode、any、业务逻辑塞UI、编造硬件参数、提前PCB、提前Agent Framework。";
  const { ai } = model(data => { const [first] = data.subtopics[0].units.map(item => item.id); return { opening: "约束。", subtopics: [{ title: "全文索引", paragraphs: [{ text, unitIds: [first], claims: [] }] }] }; });
  const draft = await writeWikiDraft({ ledger: ledger(units), ai, locale: "zh-CN", signal });
  expect(draft.chapters[0].paragraphs[0].text).not.toContain("具体包括");
});

it("leaves a table row without the report note", () => {
  const table = "| 竞品 | 特点 |\n| --- | --- |\n| 灵犀造物 | 已验证从需求到实物全流程可行性 |";
  expect(qualifyVerification(table, ["proposal"])).toBe(table);
});

it("splits a long paragraph of semicolon-joined rules into its lead and a list, keeping each claim's mark", () => {
  const text = "节点与连线的视觉规范如下：连接线默认中性灰以降低存在感，选中状态才使用强调色；节点保持中性色，禁止彩色分类卡；节点间距增加 15%-20% 以优化留白；全局圆角统一控制在 6px-8px，禁止 20px 超大圆角；动画仅允许约 200ms 的过渡。";
  const listed = parallelAsList(text, [{ text: "连接线默认中性灰以降低存在感，选中状态才使用强调色；节点保持中性色，禁止彩色分类卡；", unitIds: ["u1"] }, { text: "全局圆角统一控制在 6px-8px，禁止 20px 超大圆角；", unitIds: ["u2"] }])!;
  expect(listed.text).toBe("节点与连线的视觉规范如下：\n\n- 连接线默认中性灰以降低存在感，选中状态才使用强调色\n- 节点保持中性色，禁止彩色分类卡\n- 节点间距增加 15%-20% 以优化留白\n- 全局圆角统一控制在 6px-8px，禁止 20px 超大圆角\n- 动画仅允许约 200ms 的过渡");
  expect(listed.claims).toEqual([{ text: "节点保持中性色，禁止彩色分类卡", unitIds: ["u1"] }, { text: "全局圆角统一控制在 6px-8px，禁止 20px 超大圆角", unitIds: ["u2"] }]);
  // Reasoning across sentences is no list.
  expect(parallelAsList("先做 A；再做 B。因为 C；所以 D；最后 E；以及 F。", [])).toBeUndefined();
});

it("drops a list item's clause an earlier item already gives, and an item left with nothing", () => {
  const text = ["- **连线颜色**：连接线默认中性灰，选中为强调色，Error 为红色。", "- **Canvas 焦点**：Canvas 为视觉中心，节点间距增加 15%-20%，连接线默认中性灰，选中为强调色。", "- **重复**：连接线默认中性灰，选中为强调色。", "- **字号**：正文最小字号 14px。"].join("\n");
  const result = withoutRepeatedItems(text);
  expect(result.text).toBe(["- **连线颜色**：连接线默认中性灰，选中为强调色，Error 为红色。", "- **Canvas 焦点**：Canvas 为视觉中心，节点间距增加 15%-20%。", "- **字号**：正文最小字号 14px。"].join("\n"));
  expect(result.changed.map(([, after]) => after)).toEqual(["Canvas 为视觉中心，节点间距增加 15%-20%。", ""]);
  // Prose is left to the clause check.
  expect(withoutRepeatedItems("连接线默认中性灰。连接线默认中性灰。").changed).toEqual([]);
});

it("never cuts a list item's clause inside brackets or at an English comma", () => {
  const text = "- **主界面冻结**：在“我的零件”界面增加拍照识别入口，保持主界面（Canvas, Top Bar等）冻结，不做大型Gallery展示。\n- **组件限制**：主界面（Canvas, Top Bar, Right Inspector, Bottom Panel, Theme）已冻结，仅允许为 Visual Inventory 增加必要入口和组件。";
  expect(withoutRepeatedItems(text).text).toBe(text);
  expect(clausesOutsideBrackets("保持主界面（Canvas, Top Bar，Theme）冻结，不做大型展示；其余不变。")).toEqual(["保持主界面（Canvas, Top Bar，Theme）冻结，", "不做大型展示；", "其余不变。"]);
});

it("notes an excluded project and restores a confirmed decision omitted by the writer", async () => {
  const kept = unit(1, "全文索引使用 Orama。"), confirmed = unit(2, "首屏是类似 ChatGPT 的欢迎页。", { kind: "decision" }), other = { ...unit(3, "ChatAtlas 恢复过去的理解。"), about: { name: "ChatAtlas", role: "other_project" as const } };
  // The writer cites only the first unit and names the left-out project anyway.
  const { ai } = model(data => ({ opening: "检索在本地完成。", openingUnitIds: [], subtopics: data.subtopics.map(topic => ({ title: topic.title, paragraphs: [{ text: "全文索引使用 Orama，参考 ChatAtlas。", unitIds: [topic.units[0].id], claims: [] }] })) }));
  const draft = await writeWikiDraft({ ledger: { ...ledger([kept, confirmed, other]), scopeAnswers: { chatatlas: "exclude" }, decisions: { [confirmed.id]: { verdict: "confirmed", at: 1 } } }, ai, locale: "zh-CN", signal });
  expect(draft.chapters[0].problems).toContain("names ChatAtlas, a project you left out");
  expect(draft.chapters[0].body).toContain(confirmed.statement);
  expect(draft.report).toMatchObject({ excluded_named: 1, confirmed_decisions_restored: 1 });
  expect(draft.report.confirmed_unwritten).toBeUndefined();  expect(draft.quality?.passed).toBe(false);
});

it("reads the current baseline from the latest plans, things left out now and completion criteria", () => {
  const units = [
    unit(1, "第一阶段先做 Mock AI。", { kind: "plan" }), unit(2, "下一阶段开发 Inventory 模块。", { kind: "plan" }),
    unit(3, "固定包含模块：当前进展、下一步行动、本阶段目标、关键决策。", { kind: "fact" }), unit(4, "V0.1 暂不做实时比价。", { kind: "decision", adoption: "user_decision", role: "user" }),
    unit(5, "运行 lint、typecheck、test、build 且必须全部通过。", { kind: "constraint" }),
  ];
  const statuses = wikiUnitStatuses(units, ledger(units).organization!);
  expect(currentBaseline(units, statuses).map(item => [item.part, item.text, item.holder ?? ""])).toEqual([
    ["now", "下一阶段开发 Inventory 模块。", ""],
    ["notNow", "V0.1 暂不做实时比价。", "decided"],
    ["done", "运行 lint、typecheck、test、build 且必须全部通过。", ""],
  ]);
});

it("keeps the baseline's completion criteria within what is done now, and one left-out line per stage", () => {
  const units = [
    unit(1, "本阶段明确不做 PCB/KiCad/专业仿真/高压设计。", { kind: "constraint" }), unit(2, "本阶段禁止开发 PCB、KiCad、商城。", { kind: "constraint" }),
    unit(3, "MVP 成功标准为：方案正确率>90%，仿真运行率>80%。", { kind: "plan" }), unit(4, "Phase A 完成需具备三入口统一和 E2E Benchmark。", { kind: "plan" }),
    unit(5, "只显示事项标题与必要的未完成条件。", { kind: "constraint" }),
  ];
  const baseline = currentBaseline(units, wikiUnitStatuses(units, ledger(units).organization!));
  expect(baseline.filter(item => item.part === "notNow").map(item => item.text)).toEqual(["本阶段禁止开发 PCB、KiCad、商城。"]);
  expect(baseline.filter(item => item.part === "done").map(item => item.text)).toEqual(["Phase A 完成需具备三入口统一和 E2E Benchmark。"]);
});

it("keeps adoption of a wish separate from an assistant restriction on the current stage", () => {
  const wish = { ...unit(1, "针对小白用户，项目应提供元件购买清单、比价推荐及链接功能。", { kind: "decision", adoption: "user_decision", role: "user" }), evidence: { ...unit(1, "").evidence, role: "user" as const, quote: "应该提供比价推荐" } };
  const scope = unit(2, "提供复制采购清单，本阶段不包含商城、比价或价格信息。", { kind: "constraint" }), other = unit(3, "首页以输入框为视觉中心。");
  const book = ledger([wish, scope, other]), report: Record<string, number> = {};
  const organization = scopedWishes(book.organization!, new Map([wish, scope, other].map(item => [item.id, item])), report);
  expect(organization.relations).toEqual([{ older: wish.id, newer: scope.id, kind: "narrows", status: "resolved" }]);
  expect(report.wishes_scoped).toBe(1);
  expect(wikiUnitStatuses([wish, scope, other], book.organization!).get(wish.id)).toBe("confirmed");
  expect(wikiUnitStatuses([wish, scope, other], organization).get(wish.id)).toBe("confirmed");
  // The user's own verdict on it still holds.
  expect(wikiUnitStatuses([wish, scope, other], organization, { [wish.id]: { verdict: "confirmed", at: 1 } }).get(wish.id)).toBe("confirmed");
});

it("reads a line leaving out an item a later stage takes up as that earlier stage's scope, for that item only", () => {
  const at = (index: number, statement: string, kind: WikiKnowledgeUnit["kind"] = "constraint") => ({ ...unit(index, statement, { kind }), evidence: { ...unit(index, "").evidence, messageIndex: index } });
  const scope = at(53, "本阶段禁止开发拍照识别、PCB、Wokwi 和数据库。"), later = at(90, "必须完整跑通从拍照识别 DHT22 到 Canvas 的全链路。", "plan");
  const pcb = at(95, "真实外壳设计必须在 PCB 尺寸确定后才能进行。"), refused = at(96, "仅支持低压模块，不支持 Wokwi 仿真。");
  const taken = laterTakenUp([scope, later, pcb, refused]);
  expect([...taken]).toEqual([[scope.id, ["拍照识别"]]]);
  // The sentence leaving it out reads as that stage, past; a claim on it follows.
  const chapter: WikiDraftChapter = { id: "c", title: "范围", question: "", group: "", problems: [], body: "本阶段禁止开发拍照识别、PCB、Wokwi 和数据库。另有说明。", paragraphs: [{ subtopic: "s", text: "本阶段禁止开发拍照识别、PCB、Wokwi 和数据库。另有说明。", unitIds: [scope.id], claims: [{ text: "本阶段禁止开发拍照识别、PCB、Wokwi 和数据库。", unitIds: [scope.id] }] }] };
  expect(pastStageWords([chapter], taken)).toBe(1);
  expect(chapter.paragraphs[0].text).toBe("当时阶段禁止开发拍照识别、PCB、Wokwi 和数据库。另有说明。");
  expect(chapter.body).toBe(chapter.paragraphs[0].text);
  expect(chapter.paragraphs[0].claims![0].text).toBe("当时阶段禁止开发拍照识别、PCB、Wokwi 和数据库。");
  // The baseline leaves that line out of what is left out now.
  const statuses = wikiUnitStatuses([scope, later], ledger([scope, later]).organization!);
  expect(currentBaseline([scope, later], statuses, taken).some(item => item.part === "notNow")).toBe(false);
  expect(currentBaseline([scope, later], statuses).some(item => item.part === "notNow")).toBe(true);
});

it("reads instructions, scope, stages and taken-up items in English as in Chinese", async () => {
  const { assistantRequest } = await import("../shared/wiki-knowledge");
  expect(assistantRequest("Tell Codex to report back the new architecture and test results.")).toBe(true);
  expect(assistantRequest("The first version stores keys in session storage only.")).toBe(false);
  const at = (index: number, statement: string, kind: WikiKnowledgeUnit["kind"] = "constraint") => ({ ...unit(index, statement, { kind }), evidence: { ...unit(index, "").evidence, messageIndex: index } });
  const scope = at(10, "This phase won't build photo recognition, PCB or firmware."), later = at(40, "We must run photo recognition end to end with a DHT22 module.", "plan");
  expect([...laterTakenUp([scope, later])]).toEqual([[scope.id, ["photo recognition"]]]);
  const next = at(50, "Next phase: implement inventory-aware planning.", "plan"), criterion = at(60, "Done when lint, typecheck, test and build must all pass.", "plan");
  const baseline = currentBaseline([next, criterion], wikiUnitStatuses([next, criterion], ledger([next, criterion]).organization!));
  expect(baseline.map(item => item.part)).toEqual(["now", "done"]);
});

it("recovers a malformed writing part in bounded smaller requests",async()=>{
 const units=Array.from({length:10},(_,index)=>unit(index+1,`规则${index+1}只对项目的独立模块${index+1}生效。`,{kind:"constraint",role:"user"}));
 let attempts=0;
 const {ai,calls}=model(data=>++attempts<=2
  ? {opening:"本地规则按模块执行。",subtopics:[{title:data.subtopics[0].title,blocks:[{type:"stages",items:[]}]}]}
  : faithful(data));
 const draft=await writeWikiDraft({ledger:ledger(units),ai,locale:"zh-CN",signal});
 expect(draft.report.write_parts_halved).toBe(1);
 expect(draft.report.write_parts_lost).toBeUndefined();
 expect(calls.length).toBeLessThanOrEqual(6);
 expect(draft.chapters[0].paragraphs.length).toBeGreaterThan(0);
});

it("carries unresolved relation status to the writer and removes unsupported replacement stories",async()=>{
 const units=[unit(1,"索引使用 Orama。"),unit(2,"索引采用 SQLite。")];
 const input=ledger(units,{relations:[{older:units[0].id,newer:units[1].id,kind:"replaces",status:"unresolved"}]});
 const {ai,calls}=model(data=>({opening:"索引存在两个方案。",subtopics:[{title:data.subtopics[0].title,paragraphs:[{text:"索引采用 SQLite。该设计取代了早期使用 Orama 的方案。",unitIds:data.subtopics[0].units.map(item=>item.id)}]}]}));
 const draft=await writeWikiDraft({ledger:input,ai,locale:"zh-CN",signal});
 const payload=calls[0].data as unknown as {subtopics:Array<{units:Array<{relates?:Array<{status:string;verifiedChange:boolean;otherIs:string}>}>}>};
 expect(payload.subtopics[0].units[0].relates?.[0]).toMatchObject({status:"unresolved",verifiedChange:false,otherIs:"later"});
 expect(draft.chapters[0].body).not.toContain("取代了");
 expect(draft.report.unsupported_changes_repaired).toBeGreaterThan(0);
});

it("restores a source prohibition omitted from a general rule list after the bounded rewrite",async()=>{
 const units=[unit(1,"避免使用 margin-left 平移页面。",{kind:"constraint"})];
 const {ai}=model(data=>({opening:"布局保持稳定。",subtopics:[{title:data.subtopics[0].title,paragraphs:[{text:"使用 margin-left 平移页面。",unitIds:[data.subtopics[0].units[0].id]}]}]}));
 const draft=await writeWikiDraft({ledger:ledger(units),ai,locale:"zh-CN",signal});
 expect(draft.chapters[0].body).toContain("避免使用 margin-left 平移页面");
 expect(draft.report.negations_restored).toBe(1);
 expect(draft.chapters[0].problems.some(problem=>problem.includes("drops the negation"))).toBe(false);
});

it("checks the chapter opening against resolved relationships too",async()=>{
 const units=[unit(1,"首页采用简洁风格。"),unit(2,"用户确认需求后进入画布。")];
 const {ai}=model(data=>({...faithful(data),opening:"交互流程取代了早期的简洁首页。",openingUnitIds:data.subtopics.flatMap(topic=>topic.units.map(unit=>unit.id))}));
 const draft=await writeWikiDraft({ledger:ledger(units),ai,locale:"zh-CN",signal});
 expect(draft.chapters[0].body).not.toContain("取代了");
 expect(draft.chapters[0].paragraphs.length).toBeGreaterThan(0);
});

it("gives a claim the qualified wording its paragraph now has, so the final check finds it", async () => {
  const done = unit(1, "lint、typecheck、test 和 build 均通过。", { kind: "report" });
  const { ai } = model(data => ({ opening: "检索在本地完成。", openingUnitIds: [], subtopics: data.subtopics.map(topic => ({ title: topic.title, paragraphs: [{ text: "lint、typecheck、test 和 build 均通过。", unitIds: [topic.units[0].id], claims: [{ text: "lint、typecheck、test 和 build 均通过。", unitIds: [topic.units[0].id] }] }] })) }));
  const draft = await writeWikiDraft({ ledger: ledger([done]), ai, locale: "zh-CN", signal });
  const paragraph = draft.chapters[0].paragraphs[0];
  expect(paragraph.text).toContain("均通过（来源报告，未独立核验）。");
  expect(paragraph.claims?.[0].text).toBe("lint、typecheck、test 和 build 均通过（来源报告，未独立核验）。");
  expect(draft.chapters[0].problems.some(problem => /not in the paragraph/u.test(problem))).toBe(false);
});

it("bounds the baseline by the latest entry into a stage, and leaves the assistant's account of the state out", () => {
  const units = [
    unit(1, "第一阶段不关注 DAU，方案正确率>90%、仿真运行率>80%。", { kind: "plan" }),
    unit(2, "严禁大爆炸重写，按 Phase A 至 Phase B 的顺序逐步实现。", { kind: "plan" }),
    unit(3, "建议进入 Milestone 5 Alpha Validation 阶段，冻结大功能 1-2 周，仅测试现有链路。", { kind: "plan" }),
    unit(4, "项目已进入系统测试阶段，177 项测试通过。", { kind: "report" }),
    unit(5, "核心 E2E 软件流程通过率>95%，Planner 成功率>90%。", { kind: "constraint" }),
  ];
  const baseline = currentBaseline(units, wikiUnitStatuses(units, ledger(units).organization!));
  expect(baseline.filter(item => item.part === "now").map(item => item.text)).toEqual([units[2].statement]);
  expect(baseline.filter(item => item.part === "done").map(item => item.text)).toEqual([units[4].statement]);
});

it("asks again for a rule written without the exception its details give", async () => {
  const header = unit(1, "Header 右侧最多 3 个 action，不显示 Provider 连接状态。", { kind: "constraint", details: ["除非用户正在进行需要 Provider 的任务。"] });
  const { ai, calls } = model(data => ({ opening: "检索在本地完成。", openingUnitIds: [], subtopics: data.subtopics.map(topic => ({ title: topic.title, paragraphs: [{ text: "Header 右侧最多 3 个 action，不显示 Provider 连接状态。", unitIds: [topic.units[0].id] }] })) }));
  const draft = await writeWikiDraft({ ledger: ledger([header]), ai, locale: "zh-CN", signal });
  expect(calls.length).toBe(2);
  expect(calls[1].system).toContain("drops the exception");
  expect(draft.chapters[0].problems.some(problem => problem.includes("drops the exception"))).toBe(true);
});

it("trims a list item repeating an item of the same list in an earlier paragraph", () => {
  const first = "- **第一版规则**：建立 validateProject 函数，需补充 GPIO 重复占用、I²C 地址冲突等规则。";
  const result = withoutRepeatedItems("- **强化检测**：强化 Validator 规则，需补充 GPIO 重复占用、I²C 地址冲突等规则。", [first.replace(/^- \*\*[^*]+\*\*：/u, "")]);
  expect(result.text).toBe("- **强化检测**：强化 Validator 规则。");
});

it("keeps the user's own direction and working steps for an AI out of the baseline and the selection", () => {
  const units = [
    unit(1, "坚持硬件AI方向，结合C++、STM32、Linux、ROS2和Edge AI，最终汇合到机器人领域。", { kind: "decision", adoption: "user_decision", role: "user" }),
    unit(2, "给 Codex 的指令应包含当前任务、必须保持的契约、禁止事项及验收标准，而非重复整个项目历史。", { kind: "plan" }),
    unit(3, "Alpha 阶段验收标准：核心 E2E 软件流程通过率>95%。", { kind: "constraint" }),
  ];
  const book = ledger(units), statuses = wikiUnitStatuses(units, book.organization!);
  expect(currentBaseline(units, statuses).map(item => item.text)).toEqual([units[2].statement]);
  const selected = curateWikiUnits(book, statuses).selected;
  expect(selected.has(units[0].id)).toBe(false);
  expect(selected.has(units[1].id)).toBe(false);
});

it("notes once that another product's figures are what the discussion cited", () => {
  const flux = { ...unit(1, "Boardly 公开声称拥有超过 80 万 builders。", { kind: "fact" }), about: { name: "Boardly", role: "competitor" as const } };
  const text = "Boardly 拥有超过 80 万 builders，工作流覆盖到 PCB 仿真。";
  expect(citedFigures(text, [flux])).toBe(`${text}\n\n以上数据为讨论中引用的外部信息，未独立核验。`);
  // Already qualified, or this project's own figures: unchanged.
  expect(citedFigures("Boardly 据讨论中引用有 80 万 builders。", [flux])).toBe("Boardly 据讨论中引用有 80 万 builders。");
  expect(citedFigures("准备 20 个任务。", [unit(2, "准备 20 个任务。")])).toBe("准备 20 个任务。");
});

it("asks again for a part written on a side its units do not give", async () => {
  const panel = unit(1, "Right Inspector 显示所选节点的参数与引脚。", { kind: "decision" });
  const { ai, calls } = model(data => ({ opening: "检查器展示节点信息。", openingUnitIds: [], subtopics: data.subtopics.map(topic => ({ title: topic.title, paragraphs: [{ text: "左侧栏显示所选节点的参数与引脚。", unitIds: [topic.units[0].id] }] })) }));
  const draft = await writeWikiDraft({ ledger: ledger([panel]), ai, locale: "zh-CN", signal });
  expect(calls.length).toBe(2);
  expect(draft.chapters[0].problems.some(problem => problem.includes("side its units do not give"))).toBe(true);
});

it("leaves a stage limit out of what is not done now once the user confirmed that item", () => {
  const scope = unit(1, "本阶段不开发实时商品比价。", { kind: "constraint" });
  const confirmed = unit(2, "提供商品比价入口，展示各平台价格。", { kind: "decision" });
  const statuses = wikiUnitStatuses([scope, confirmed], ledger([scope, confirmed]).organization!);
  expect(currentBaseline([scope, confirmed], statuses).some(item => item.part === "notNow")).toBe(true);
  expect(currentBaseline([scope, confirmed], statuses, new Map(), [confirmed]).some(item => item.part === "notNow")).toBe(false);
});

it("tells a figure one product has from a row naming several, and a guarantee no unit gives", () => {
  const flux = unit(1, "Boardly平台公开声称拥有超过80万builders和12万个完成的电路板设计。", { kind: "fact" });
  const both = unit(2, "AI生成硬件路线已被Boardly、WireMind等产品验证。", { kind: "fact" });
  const table = "| 项目 | 数据 |\n| --- | --- |\n| Boardly / WireMind | 超过80万builders |";
  expect(sharedFigures(table, [flux, both])).toEqual([["Boardly / WireMind", "Boardly"]]);
  expect(sharedFigures("| 项目 | 数据 |\n| --- | --- |\n| Boardly | 超过80万builders |", [flux])).toEqual([]);
  const engine = unit(3, "构建 Compatibility Engine，用于实时检查电压、电流及 GPIO 冲突。", { kind: "fact" });
  expect(addedGuarantees("系统实时检查电压，确保生成的硬件方案正确且可执行。", [engine])).toHaveLength(1);
  expect(addedGuarantees("测试确保元件 ID 唯一。", [unit(4, "建立 Validator tests，确保元件 ID 唯一。")])).toEqual([]);
});

it("asks again for a global rule written without the parts that set it otherwise", async () => {
  const rule = unit(1, "全局圆角统一控制在6px~8px，禁止使用16px以上的大圆角。", { kind: "constraint" });
  const composer = unit(2, "首页输入框 border-radius 20~26px，padding 16~20px。", { kind: "decision" });
  const { ai, calls } = model(data => ({ opening: "界面规范如下。", openingUnitIds: [], subtopics: data.subtopics.map(topic => ({ title: topic.title, paragraphs: topic.units.map(item => ({ text: item.statement, unitIds: [item.id] })) })) }));
  const draft = await writeWikiDraft({ ledger: ledger([rule, composer]), ai, locale: "zh-CN", signal });
  expect(JSON.stringify(calls[0].data)).toContain("partValues");
  // Asked again and still left out: the line names the parts itself.
  expect(calls.length).toBe(2);
  expect(draft.chapters[0].body).toContain("以下组件另有取值");
  expect(draft.chapters[0].problems.some(problem => problem.includes("without the parts that set it otherwise"))).toBe(false);
});

it("checks a table cell against its whole row", async () => {
  const count = unit(1, "已完成 6 个本地元件支持及自然语言组合指令链路。", { kind: "fact", role: "user" });
  const target = unit(2, "V1 元件库收录 20-30 个常用元件。", { kind: "plan" });
  const table = "| 阶段 | 元件数量 |\n| --- | --- |\n| 当前已完成 | 6 个 |\n| V1 目标 | 20-30 个 |";
  const { ai } = model(data => ({ opening: "元件规模分阶段扩展。", openingUnitIds: [], subtopics: data.subtopics.map((topic, index) => ({ title: topic.title, blocks: index ? [] : [{ type: "paragraph", text: table, unitIds: topic.units.map(item => item.id), claims: [] }] })) }));
  const draft = await writeWikiDraft({ ledger: ledger([count, target]), ai, locale: "zh-CN", signal });
  expect(draft.chapters.flatMap(chapter => chapter.problems).filter(problem => /^claim "(?:6 个|当前已完成|20-30 个)/u.test(problem))).toEqual([]);
});

it("keeps one of two parts that state one rule, the one giving every number", () => {
  const line = "- **圆角规范**：全局圆角统一控制在 6px~8px，禁止使用超大圆角以符合工程工具定位；统一推荐6px～8px，禁止20px/30px超大圆角，体现工程工具属性。";
  expect(withoutRepeatedSegments(line).text).toBe("- **圆角规范**：统一推荐6px～8px，禁止20px/30px超大圆角，体现工程工具属性。");
  const distinct = "- **顶部导航**：左侧为 Logo；右侧最多 3 个 action，默认不显示 Provider 连接状态。";
  expect(withoutRepeatedSegments(distinct).changed).toEqual([]);
});

it("binds a user's point said over two sentences instead of adding its statement again", () => {
  const text = "整体视觉遵循 Codex/Linear 工具级标准，Canvas 占据绝对主体，禁止五颜六色、蓝紫渐变和大圆角卡片。首页、Sidebar 和 Node 等组件需符合该标准，且浅色和深色模式从第一天起同步优化。";
  expect(coveringRun(text, "节点禁止五颜六色、蓝紫渐变和大圆角卡片；Canvas占绝对主体；首页、Sidebar、Node等需符合Codex/Linear工具级UI标准；浅色和深色模式从第一天做好。")).toBe(text);
  expect(coveringRun(text, "BOM 必须从 Hardware IR 派生，不由 LLM 重新生成。")).toBeUndefined();
});

it("cites the units whose values a merged sentence keeps, by range", () => {
  const own = unit(1, "底部区域默认折叠为36-40px的Bottom Bar以最大化Canvas空间，点击后展开显示BOM、Validation等信息。");
  const drawer = unit(2, "底部Drawer默认收起，仅保留40-48px高的Tab Bar（架构/BOM/校验），点击后展开对应内容。");
  const panel = unit(3, "底部面板默认完全收起，仅显示40~44px高的Bottom Bar，包含架构、BOM、校验入口。");
  const top = unit(4, "采用工程工具式布局：Top Bar (44-52px)，底部 Bottom Bar 显示 BOM。");
  const text = "底部区域默认折叠为36-40px的Bottom Bar以最大化Canvas空间，点击后展开显示BOM、Validation等信息；不同讨论中高度也有40-48px或40~44px的说法。";
  expect(versionSources(text, [own], [own, drawer, panel, top])).toEqual([drawer, panel]);
});

it("names an unlabelled list item for the product it is about, and flags a label that drops its object", () => {
  const schgen = { ...unit(1, "Microsoft SchGen 展示了自然语言到 KiCad 的路线。"), about: { name: "Microsoft SchGen", role: "reference" as const } };
  const paragraph = { text: "- **FlowCode**：拖拽节点生成代码。\n- 展示了“自然语言 → KiCad”的路线。\n- **Fritzing**：面包板视图。", claims: [{ text: "展示了“自然语言 → KiCad”的路线。", unitIds: [schgen.id] }] };
  expect(namedListItems(paragraph, new Map([[schgen.id, schgen]]))).toBe(true);
  expect(paragraph.text.split("\n")[1]).toBe("- **Microsoft SchGen**：展示了“自然语言 → KiCad”的路线。");
  // The part its unit names before what the item says it does.
  const roles = unit(2, "Canvas 负责表达系统结构，Right Inspector 解释选中元件，AI 修改项目，Bottom Validation 发现问题。");
  const lost = { text: "- **Canvas**：负责表达系统结构。\n- 解释选中元件的细节信息。\n- **AI 修改**：根据用户意图修改项目内容。\n- 发现并提示潜在问题。", claims: ["负责表达系统结构。", "解释选中元件的细节信息。", "根据用户意图修改项目内容。", "发现并提示潜在问题。"].map(text => ({ text, unitIds: [roles.id] })) };
  expect(namedListItems(lost, new Map([[roles.id, roles]]))).toBe(true);
  expect(lost.text.split("\n")).toEqual(["- **Canvas**：负责表达系统结构。", "- **Right Inspector**：解释选中元件的细节信息。", "- **AI 修改**：根据用户意图修改项目内容。", "- **Bottom Validation**：发现并提示潜在问题。"]);
  expect(bareLabels("| 事项 | 第一版 |\n| --- | --- |\n| 实时全网比价 | 不做 |\n| API 对接 | 不实现 |")).toEqual(["API 对接"]);
  expect(bareLabels("| 事项 | 第一版 |\n| --- | --- |\n| 比价 API 对接 | 不实现 |")).toEqual([]);
});

it("moves a claim to the past stage only with its sentence", () => {
  const scope = unit(1, "本阶段禁止开发拍照识别功能。", { kind: "constraint" });
  const text = "本阶段禁止开发拍照识别功能。本阶段目标是完成从拍照识别到生成项目的完整产品闭环。";
  const chapter: WikiDraftChapter = { id: "c", title: "范围", question: "", group: "", problems: [], body: text, paragraphs: [{ subtopic: "s", text, unitIds: [scope.id], claims: [{ text: "本阶段禁止开发拍照识别功能。", unitIds: [scope.id] }, { text: "本阶段目标是完成从拍照识别到生成项目的完整产品闭环。", unitIds: [scope.id] }] }] };
  pastStageWords([chapter], new Map([[scope.id, ["拍照识别"]]]));
  expect(chapter.paragraphs[0].text).toBe("当时阶段禁止开发拍照识别功能。本阶段目标是完成从拍照识别到生成项目的完整产品闭环。");
  expect(chapter.paragraphs[0].claims!.every(claim => chapter.paragraphs[0].text.includes(claim.text))).toBe(true);
});

it("adds back a group's prohibition the line weakened, citing its unit", () => {
  const strict = unit(1, "API Key默认仅存在于内存中，仅在用户明确选择时写入sessionStorage，绝不写入localStorage或项目文件。", { kind: "constraint" });
  const text = "- **需求检查**：在Planner之前增加需求完整性检查。\n- **Key存储**：API Key 默认仅保存在运行时内存中；可选 sessionStorage，禁止默认使用 localStorage。";
  const chapter: WikiDraftChapter = { id: "c", title: "架构", question: "", group: "", body: text, paragraphs: [{ subtopic: "s", text, unitIds: [], claims: [] }], problems: ['"- **需求检查**：在Planner之前增加需…" drops the condition "绝不写入localStorage或项目文件" of k9; write every listed condition of a group'] };
  expect(restoreProhibitions(chapter, new Map([[strict.id, strict]]))).toBe(1);
  expect(chapter.paragraphs[0].text.split("\n")[1]).toBe("- **Key存储**：API Key 默认仅保存在运行时内存中；可选 sessionStorage，禁止默认使用 localStorage；绝不写入localStorage或项目文件。");
  expect(chapter.body).toBe(chapter.paragraphs[0].text);
  expect(chapter.problems).toEqual([]);
  expect(chapter.paragraphs[0].claims).toEqual([{ text: "绝不写入localStorage或项目文件", unitIds: [strict.id] }]);
});

it("tells a line giving one value twice from lines giving several values once", () => {
  const animation = "- **动画限制**：必须克制，允许150~220ms的fade/translate及hover效果；严禁大型loading。各页面保持相同的header，允许150~220ms的fade和小幅translateY。";
  const radius = "- **全局圆角**：统一控制在6px~8px，禁止使用16px以上的大圆角；统一推荐6px～8px，禁止20px/30px超大圆角。";
  expect(repeatedValues(`${animation}\n${radius}`).map(([, value]) => value)).toEqual(["150~220ms", "6px～8px"]);
  expect(repeatedValues("- **CTA按钮**：高度40~44px，圆角8~10px，内边距14~16px。\n| 高度 | 40~44px | 40~44px |")).toEqual([]);
});

it("writes a chapter's missing opening from the chapter in one short request", async () => {
  const rule = unit(1, "检索在本地完成，不调用模型。", { kind: "decision" });
  const prompts: string[] = [];
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    const data = JSON.parse(request.prompt) as Payload & { presentation?: string };
    prompts.push(String(data.presentation ?? "write"));
    if (data.presentation === "wiki_unit_propositions") return request.validate({ same: [] });
    if (data.presentation === "wiki_chapter_opening") return request.validate({ opening: "检索在本地完成，不调用模型。" });
    return request.validate(claimed({ opening: "", openingUnitIds: [], subtopics: data.subtopics.map(topic => ({ title: topic.title, paragraphs: [{ text: "检索在本地完成，不调用模型。", unitIds: [topic.units[0].id] }] })) }));
  } };
  const draft = await writeWikiDraft({ ledger: ledger([rule]), ai, locale: "zh-CN", signal });
  expect(prompts).toContain("wiki_chapter_opening");
  expect(draft.chapters[0].body.startsWith("检索在本地完成，不调用模型。")).toBe(true);
  expect(draft.chapters[0].problems).not.toContain("the opening is missing");
});

it("labels a step by the stage its unit names, and puts a dropped code where it reads as one", () => {
  const stage = unit(1, "在 Milestone 3.2 和 3.3 阶段，明确禁止开发 PCB、仿真、固件生成。", { kind: "plan" });
  const steps = { text: "3. **当时阶段**：禁止扩展至 30 个元件。\n4. 明确禁止开发 PCB、仿真、固件生成。", claims: [{ text: "明确禁止开发 PCB、仿真、固件生成。", unitIds: [stage.id] }] };
  expect(labelledSteps(steps, new Map([[stage.id, stage]]))).toBe(true);
  expect(steps.text.split("\n")[1]).toBe("4. **Milestone 3.2 和 3.3**：明确禁止开发 PCB、仿真、固件生成。");
  const i2c = unit(2, "检查SDA/SCL类型及同一Bus下的设备地址冲突，未知地址仅给info提示。", { kind: "constraint" });
  i2c.evidence = { ...i2c.evidence, quote: "同一 bus 地址冲突\n\n如果两个设备声明：\n\n0x3C\n\n产生：\n\nI2C_ADDRESS_CONFLICT" };
  const terms = unit(3, "内部保留 GPIO_CONFLICT 等工程 code。", { kind: "constraint", details: ["LOAD_REQUIRES_DRIVER"] });
  const list = { text: "- **I²C 地址**：检查设备地址冲突（I2C_ADDRESS_CONFLICT），未知地址仅给 info 提示。\n- **术语**：内部保留GPIO_CONFLICT等工程code。\n- **门禁**：完成后必须通过 lint。", claims: [{ text: "检查设备地址冲突（I2C_ADDRESS_CONFLICT），未知地址仅给 info 提示。", unitIds: [i2c.id] }, { text: "内部保留GPIO_CONFLICT等工程code。", unitIds: [terms.id] }] };
  expect(restoredCodes(list, new Map([[i2c.id, i2c], [terms.id, terms]]))).toEqual(["0x3C", "LOAD_REQUIRES_DRIVER"]);
  expect(list.text.split("\n")).toEqual(["- **I²C 地址**：检查设备地址冲突（I2C_ADDRESS_CONFLICT，例如地址 0x3C），未知地址仅给 info 提示。", "- **术语**：内部保留GPIO_CONFLICT、LOAD_REQUIRES_DRIVER等工程code。", "- **门禁**：完成后必须通过 lint。"]);
});

it("puts back a code the writer bracketed where its point is not", () => {
  const status = unit(1, "在 Planner 之前增加需求完整性检查，仅返回 READY、NEEDS_CLARIFICATION 或 UNSUPPORTED 三种状态。");
  const button = unit(2, "从方案草稿进入 Canvas 的按钮文案定为“生成硬件方案”，而非 Commit Design。");
  const entry = unit(3, "仿真入口仅在 Canvas 设计通过（VERIFIED 或 NEEDS_REVIEW 允许继续）后才出现。");
  const driver = unit(4, "GPIO 不能直接驱动 DC Fan 等负载，必须通过驱动器模块（LOAD_REQUIRES_DRIVER）。");
  const units = new Map([status, button, entry, driver].map(item => [item.id, item]));
  const paragraph = { text: [
    "- **按钮文案**：从方案草稿进入 Canvas 的按钮文案应为“生成硬件方案”，而非 Commit Design（NEEDS_CLARIFICATION）。",
    "- **仿真入口**：仅在 Canvas 设计通过（VERIFIED 或允许继续）后才出现（NEEDS_REVIEW）。",
    "- **负载驱动**：GPIO 不能直接驱动 DC Fan 等负载，必须通过驱动器模块（LOAD_REQUIRES_DRIVER）。",
  ].join("\n"), unitIds: [status.id, button.id, entry.id, driver.id] };
  expect(misplacedCodes(paragraph, units)).toBe(2);
  expect(paragraph.text.split("\n")).toEqual([
    "- **按钮文案**：从方案草稿进入 Canvas 的按钮文案应为“生成硬件方案”，而非 Commit Design。",
    "- **仿真入口**：仅在 Canvas 设计通过（VERIFIED 或 NEEDS_REVIEW 允许继续）后才出现。",
    "- **负载驱动**：GPIO 不能直接驱动 DC Fan 等负载，必须通过驱动器模块（LOAD_REQUIRES_DRIVER）。",
  ]);
});

it("drops a property given the same value earlier on the same screen size, however short", () => {
  const first = "- **移动端适配**：优先支持移动端；Mobile padding 16px，Composer width 100% min-height 100~120px，标题 24~28px，Chips 允许换行；Canvas Workspace 仍桌面优先。";
  const again = "Mobile 优先可读，padding 16px，title 24~28px，Component row 在移动端改为垂直排列，禁止横向滚动。";
  const desktop = "Desktop 布局，padding 16px，侧栏保持展开。";
  const chapter: WikiDraftChapter = { id: "c", title: "界面", question: "", group: "", problems: [], body: [first, again, desktop].join("\n\n"),
    paragraphs: [first, again, desktop].map(text => ({ subtopic: "s", text, unitIds: ["u1"], claims: [{ text, unitIds: ["u1"] }] })) };
  expect(chapterRepeatedClauses(chapter)).toBe(2);
  expect(chapter.paragraphs[1].text).toBe("Mobile 优先可读，Component row 在移动端改为垂直排列，禁止横向滚动。");
  expect(chapter.paragraphs[2].text).toBe(desktop);
  expect(chapter.body).toContain(chapter.paragraphs[1].text);
});

it("drops a clause one part of a chapter says again after another, but never inside brackets", () => {
  const first = "构建知识库用于检查电气冲突；当前 Validator 不检查电压、GPIO 冲突、I²C 地址或电源安全，计划补充。";
  const second = "当前画布仅为架构预览，不能直接照图接线；Validator 不检查电压、GPIO 冲突、I²C 地址或电源安全，无结构错误不等于硬件安全。";
  const third = "- **全局圆角**：统一推荐6px～8px（以下组件另有取值：Welcome Screen border-radius 20~26px；是组件例外还是后来的规范，讨论中未明确）。";
  const chapter: WikiDraftChapter = { id: "c", title: "验证", question: "", group: "", problems: [], body: [first, second, "- **输入框**：border-radius 20~26px。", third].join("\n\n"),
    paragraphs: [first, second, "- **输入框**：border-radius 20~26px。", third].map(text => ({ subtopic: "s", text, unitIds: ["u1"], claims: [{ text, unitIds: ["u1"] }] })) };
  expect(chapterRepeatedClauses(chapter)).toBe(1);
  expect(chapter.paragraphs[1].text).toBe("当前画布仅为架构预览，不能直接照图接线；无结构错误不等于硬件安全。");
  expect(chapter.paragraphs[3].text).toBe(third);
  expect(chapter.body).toContain(chapter.paragraphs[1].text);
  expect(chapter.paragraphs[1].claims![0].text.length).toBeGreaterThan(6);
});

it("keeps every point of a subtopic the writer and its supplement both left out, and does not keep the chapter as written", async () => {
  const index = unit(1, "检索按消息维护全文索引。", { kind: "mechanism" }), gpio = unit(2, "Validator 区分独占 GPIO 与共享总线，仅对独占资源重复连接报错。", { kind: "constraint" });
  const book = ledger([index, gpio], { subjects: [{ id: "s:a", name: "索引", aliases: [], unitIds: [index.id] }, { id: "s:b", name: "规则", aliases: [], unitIds: [gpio.id] }],
    chapters: [{ id: "chapter:search", title: "检索", question: "如何找回历史？", group: "", subtopics: [{ title: "全文索引", subjectIds: ["s:a"] }, { title: "规则引擎", subjectIds: ["s:b"] }] }] });
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    const data = JSON.parse(request.prompt) as Payload & { presentation?: string; written?: unknown };
    if (data.presentation === "wiki_unit_propositions") return request.validate({ same: [] });
    if (data.presentation === "wiki_chapter_opening") return request.validate({ opening: "检索按消息维护全文索引。" });
    // The supplement for what it left out fails.
    if (request.system.includes("SUPPLEMENT:")) throw new Error("STRUCTURE_OR_PROVIDER_ERROR");
    // The writer answers the first subtopic only.
    return request.validate(claimed({ opening: "检索按消息维护全文索引。", openingUnitIds: [], subtopics: [{ title: data.subtopics[0].title, paragraphs: [{ text: "检索按消息维护全文索引。", unitIds: [data.subtopics[0].units[0].id] }] }] }));
  } };
  const draft = await writeWikiDraft({ ledger: book, ai, locale: "zh-CN", signal });
  const chapter = draft.chapters[0];
  expect(chapter.body).toContain("### 规则引擎");
  expect(chapter.body).toContain(gpio.statement);
  expect(chapter.problems.some(problem => problem.endsWith("points kept as their units state them"))).toBe(true);
  expect(chapter.signature).toBeUndefined();
});

it("asks for a refused opening once more with the reason", async () => {
  const rule = unit(1, "检索在本地完成，不调用模型。", { kind: "decision" });
  const systems: string[] = [];
  let openings = 0;
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    const data = JSON.parse(request.prompt) as Payload & { presentation?: string };
    if (data.presentation === "wiki_unit_propositions") return request.validate({ same: [] });
    if (data.presentation === "wiki_chapter_opening") { systems.push(request.system); return request.validate({ opening: openings++ ? "检索在本地完成，不调用模型。" : "检索确保硬件方案的正确性与可执行性。" }); }
    return request.validate(claimed({ opening: "", openingUnitIds: [], subtopics: data.subtopics.map(topic => ({ title: topic.title, paragraphs: [{ text: "检索在本地完成，不调用模型。", unitIds: [topic.units[0].id] }] })) }));
  } };
  const draft = await writeWikiDraft({ ledger: ledger([rule]), ai, locale: "zh-CN", signal });
  expect(systems).toHaveLength(2);
  expect(systems[1]).toContain("SECOND ATTEMPT");
  expect(systems[1]).toContain("确保硬件方案的正确性");
  expect(draft.chapters[0].body.startsWith("检索在本地完成，不调用模型。")).toBe(true);
});

it("does not take a guarantee the chapter's question asks about as one the chapter gives", async () => {
  const rule = unit(1, "检索在本地完成，不调用模型。", { kind: "decision" });
  const systems: string[] = [];
  let openings = 0;
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    const data = JSON.parse(request.prompt) as Payload & { presentation?: string };
    if (data.presentation === "wiki_unit_propositions") return request.validate({ same: [] });
    if (data.presentation === "wiki_chapter_opening") { systems.push(request.system); return request.validate({ opening: openings++ ? "检索在本地完成，不调用模型。" : "检索在本地完成来确保方案正确可执行。" }); }
    return request.validate(claimed({ opening: "", openingUnitIds: [], subtopics: data.subtopics.map(topic => ({ title: topic.title, paragraphs: [{ text: "检索在本地完成，不调用模型。", unitIds: [topic.units[0].id] }] })) }));
  } };
  const base = ledger([rule]);
  const asked = ledger([rule], { chapters: base.organization!.chapters.map(chapter => ({ ...chapter, question: "系统如何确保生成的方案是正确且可执行的？" })) });
  const draft = await writeWikiDraft({ ledger: asked, ai, locale: "zh-CN", signal });
  expect(systems[1]).toContain("确保方案正确可执行");
  expect(draft.chapters[0].body).not.toContain("确保");
});

it("puts a subtopic of the writer's own title under the planned subtopic of its units", () => {
  const a = unit(1, "定位为面向大学生的硬件工作台。"), b = unit(2, "首页采用极简 Hero。");
  const alias = new Map([["k1", a], ["k2", b]]);
  const part = [{ title: "目标用户", units: [a] }, { title: "首页引导", units: [b] }];
  const result = { subtopics: [
    { title: "首页引导", paragraphs: [{ text: "首页采用极简 Hero。", unitIds: ["k2"], claims: [] }] },
    { title: "产品定位", paragraphs: [{ text: "定位为面向大学生的硬件工作台。", unitIds: ["k1"], claims: [] }] },
    { title: "其他", paragraphs: [{ text: "无归属。", unitIds: ["k9"], claims: [] }] },
  ] };
  expect(rehomedSubtopics(result, part, alias)).toBe(true);
  expect(result.subtopics.map(topic => topic.title)).toEqual(["目标用户", "首页引导", "其他"]);
  expect(rehomedSubtopics(result, part, alias)).toBe(false);
});

it("tells a guarantee sharing one character pair with another from one the units give", () => {
  const precise = unit(1, "当前保持 6 个基础元件以确保数据可靠性和 Validator 准确性。");
  expect(addedGuarantees("系统确保硬件方案的正确性与可执行性。", [precise])).toHaveLength(1);
  expect(addedGuarantees("保持基础元件以确保数据可靠性。", [precise])).toEqual([]);
});

it("asks again for a label naming a side no unit gives", async () => {
  const panel = unit(1, "宽度约280～340px，默认显示项目概览；选择节点时切换Component Inspector。", { kind: "decision" });
  const { ai, calls } = model(data => ({ opening: "面板显示项目概览。", openingUnitIds: [], subtopics: data.subtopics.map(topic => ({ title: topic.title, paragraphs: [{ text: "- **左侧栏**：宽度约280～340px，默认显示项目概览。\n- **详情**：选择节点时切换Component Inspector。", unitIds: [topic.units[0].id] }] })) }));
  const draft = await writeWikiDraft({ ledger: ledger([panel]), ai, locale: "zh-CN", signal });
  expect(calls.length).toBe(2);
  expect(draft.chapters[0].problems.some(problem => problem.includes("names a side no unit gives"))).toBe(true);
});

it("reads a label's side against the units its own line cites, and finds it on a saved chapter", () => {
  const inspector = { ...unit(1, "宽度约280～340px，默认显示项目概览。", { kind: "decision" }), subject: "Right Inspector" };
  const toolbar = unit(2, "顶部工具栏左侧显示项目名，右侧显示保存状态。", { kind: "decision" });
  const units = new Map([[inspector.id, inspector], [toolbar.id, toolbar]]);
  const text = "- **左侧栏**：宽度约 280～340px，默认显示项目概览。\n- **顶部工具栏**：左侧显示项目名，右侧显示保存状态。";
  const paragraph = { text, unitIds: [inspector.id, toolbar.id], claims: [{ text: "宽度约 280～340px，默认显示项目概览。", unitIds: [inspector.id] }, { text: "左侧显示项目名，右侧显示保存状态。", unitIds: [toolbar.id] }] };
  expect(sideLabels(paragraph, id => units.get(id))).toEqual(["左侧栏"]);
  const chapter: WikiDraftChapter = { id: "c", title: "界面", question: "", group: "", problems: [], body: `系统确保硬件方案的正确性与可执行性。\n\n### 布局\n\n${text}`, paragraphs: [{ subtopic: "布局", ...paragraph }] };
  expect(reusedChapterProblems(chapter, units)).toEqual(["the opening says \"确保硬件方案的正确性与可执行\", which no unit says", "\"**左侧栏**\" names a side no unit gives"]);
});

it("turns a list label to the side its own line's units give, and leaves one whose units give no side", () => {
  const inspector = { ...unit(1, "宽度约280～340px，默认显示项目概览。", { kind: "decision" }), subject: "Right Inspector" };
  const toolbar = unit(2, "顶部工具栏左侧显示项目名，右侧显示保存状态。", { kind: "decision" });
  const drawer = unit(3, "默认折叠为 36-40px 的 Bottom Bar。", { kind: "decision" });
  const units = new Map([[inspector.id, inspector], [toolbar.id, toolbar], [drawer.id, drawer]]);
  const text = "- **顶部工具栏**：左侧显示项目名，右侧显示保存状态。\n- **左侧面板**：宽度约 280～340px，默认显示项目概览。\n- **左侧抽屉**：默认折叠为 36-40px 的 Bottom Bar。";
  const chapter: WikiDraftChapter = { id: "c", title: "界面", question: "", group: "", problems: ["\"**左侧面板**\" names a side no unit gives; name the part"], body: `开头。\n\n### 布局\n\n${text}`, paragraphs: [{ subtopic: "布局", text, unitIds: [toolbar.id, inspector.id, drawer.id], claims: [{ text: "左侧显示项目名，右侧显示保存状态。", unitIds: [toolbar.id] }, { text: "宽度约 280～340px，默认显示项目概览。", unitIds: [inspector.id] }, { text: "默认折叠为 36-40px 的 Bottom Bar。", unitIds: [drawer.id] }] }] };
  expect(correctedSideLabels([chapter], id => units.get(id))).toBe(1);
  expect(chapter.body).toContain("- **右侧面板**：宽度约 280～340px");
  // The drawer's units give no side: not guessed the other way.
  expect(chapter.body).toContain("- **左侧抽屉**");
  expect(chapter.paragraphs[0].text).toContain("**右侧面板**");
  expect(chapter.problems).toEqual([]);
});

it("removes a lifted limit opening its sentence with the comma and the 仅 after it, and a line that was the limit alone", () => {
  const first = "前期不做实时全网比价，仅提供Procurement Spec和中英文搜索词，引导用户自行购买缺失零件。", second = "第一版（V0.1）不实现实时全网比价和API对接，仅输出缺件清单及中英文搜索关键词。";
  const text = `${first}${second}`, alone = "本阶段不包含商城、比价或价格信息。";
  const chapter: WikiDraftChapter = { id: "c", title: "选型", question: "", group: "", body: `${text}\n\n${alone}`, problems: [], paragraphs: [
    { subtopic: "采购", text, unitIds: ["a", "b"], claims: [{ text: first, unitIds: ["a"] }, { text: second, unitIds: ["b"] }] },
    { subtopic: "采购", text: alone, unitIds: ["c"], claims: [{ text: alone, unitIds: ["c"] }] },
  ] };
  const lifted = new Map([["a", "前期不做实时全网比价"], ["b", "第一版（V0.1）不实现实时全网比价和API对接"], ["c", "本阶段不包含商城、比价或价格信息"]]);
  expect(removedLiftedLimits([chapter], lifted)).toBe(3);
  expect(chapter.paragraphs.map(paragraph => paragraph.text)).toEqual(["提供Procurement Spec和中英文搜索词，引导用户自行购买缺失零件。输出缺件清单及中英文搜索关键词。"]);
  expect(chapter.paragraphs[0].claims?.map(claim => claim.text)).toEqual(["提供Procurement Spec和中英文搜索词，引导用户自行购买缺失零件。", "输出缺件清单及中英文搜索关键词。"]);
  // A limit closing its sentence leaves the "仅" before it.
  const tail: WikiDraftChapter = { id: "d", title: "存储", question: "", group: "", body: "仅保留本地存储，本阶段不做云同步。", problems: [], paragraphs: [{ subtopic: "存储", text: "仅保留本地存储，本阶段不做云同步。", unitIds: ["e"], claims: [{ text: "仅保留本地存储，本阶段不做云同步。", unitIds: ["e"] }] }] };
  expect(removedLiftedLimits([tail], new Map([["e", "本阶段不做云同步"]]))).toBe(1);
  expect(tail.body).toBe("仅保留本地存储。");
});

it("removes a lifted limit that was a whole sentence with its full stop, and table rows leaving out what the answer put in", () => {
  const limit = "本阶段不包含商城、比价或价格信息", kept = "明确区分已有和缺少元件，提供复制采购清单功能。";
  const text = `${limit}功能。${kept}`, table = "| 事项 | 第一版 |\n| --- | --- |\n| 实时全网比价 | 不做 |\n| API对接 | 不做 |";
  const chapter: WikiDraftChapter = { id: "c", title: "采购", question: "", group: "", body: `${text}\n\n${table}`, problems: [], paragraphs: [
    { subtopic: "采购", text, unitIds: ["a"], claims: [{ text: kept, unitIds: ["a"] }] },
    { subtopic: "采购", text: table, unitIds: ["b"], claims: [{ text: "实时全网比价", unitIds: ["b"] }, { text: "API对接", unitIds: ["b"] }] },
  ] };
  const lifted = new Map([["a", limit], ["b", "第一版（V0.1）不实现实时全网比价和API对接"]]);
  expect(removedLiftedLimits([chapter], lifted)).toBe(2);
  expect(chapter.paragraphs.map(paragraph => paragraph.text)).toEqual([kept]);
  expect(chapter.body).toBe(kept);
  // A row the answer did not put in stays.
  const other = "| 事项 | 第一版 |\n| --- | --- |\n| 实时全网比价 | 不做 |\n| 数据库 | 不引入 |";
  const kept2: WikiDraftChapter = { id: "d", title: "采购", question: "", group: "", body: other, problems: [], paragraphs: [{ subtopic: "采购", text: other, unitIds: ["b"], claims: [{ text: "数据库", unitIds: ["b"] }] }] };
  removedLiftedLimits([kept2], lifted);
  expect(kept2.body).toBe("| 事项 | 第一版 |\n| --- | --- |\n| 数据库 | 不引入 |");
  // The writer added 阶段 after the version the unit names.
  const bom = "BOM 必须从 Hardware IR 派生；V0.1 阶段不需要实时价格或电商链接。";
  const staged: WikiDraftChapter = { id: "e", title: "BOM", question: "", group: "", body: bom, problems: [], paragraphs: [{ subtopic: "BOM", text: bom, unitIds: ["c"], claims: [{ text: bom, unitIds: ["c"] }] }] };
  expect(removedLiftedLimits([staged], new Map([["c", "V0.1 不需要实时价格或电商链接"]]))).toBe(1);
  expect(staged.body).toBe("BOM 必须从 Hardware IR 派生。");
});

it("trims opening sentences after the answer that the chapter's sections tell in full, values and all", () => {
  const answer = "界面采用极简浅色主题，主背景为 #FAFAFA，文字色为 #18181B。";
  const palette = "视觉规范禁止大面积渐变及玻璃拟态，App Background 定为 #FAFAFA，Panel 为 #FFFFFF，Border 为 #E8E8E8。";
  const flow = "首屏采用 ChatGPT 式简洁欢迎页，输入需求后进入对话层确定清单。";
  const section = "界面采用浅色主题，禁止大面积渐变及玻璃拟态，App Background #FAFAFA，Panel #FFFFFF，Border #E8E8E8。";
  const chapter: WikiDraftChapter = { id: "c", title: "界面", question: "", group: "", body: `${answer}${palette}${flow}\n\n### 视觉\n\n${section}`, problems: [], paragraphs: [{ subtopic: "视觉", text: section, unitIds: ["a"] }] };
  expect(openingRepeatsTrimmed([chapter])).toBe(1);
  // The answer stays, and a sentence no section tells.
  expect(chapter.body).toBe(`${answer}${flow}\n\n### 视觉\n\n${section}`);
});

it("tells the writer which AI proposed each unit, and the rule for two AIs' different proposals, only when there are several", async () => {
  const chat = unit(1, "底部栏高 40px。", { details: ["40px"] }), claude = { ...unit(2, "底部栏高 48px。", { details: ["48px"] }), evidence: { ...unit(2, "").evidence, conversationId: "c2", quote: "底部栏高 48px。" } };
  const own = { ...unit(3, "我想要底部栏。", { role: "user" }), evidence: { ...unit(3, "").evidence, role: "user" as const, quote: "我想要底部栏。" } };
  const sources = { c: { platform: "chatgpt", title: "A" }, c2: { platform: "claude", title: "B" } };
  const { ai, calls } = model(faithful);
  await writeWikiDraft({ ledger: { ...ledger([chat, claude, own]), sources }, ai, locale: "zh-CN", signal });
  const sent = (calls[0].data.subtopics[0].units as Array<{ statement: string; platform?: string }>);
  expect(sent.find(item => item.statement === chat.statement)?.platform).toBe("ChatGPT");
  expect(sent.find(item => item.statement === claude.statement)?.platform).toBe("Claude");
  expect(sent.find(item => item.statement === own.statement)?.platform).toBeUndefined();
  expect(calls[0].system).toContain("each with its platform");
  // One AI: no platform is given.
  const single = model(faithful);
  await writeWikiDraft({ ledger: { ...ledger([chat, own]), sources }, ai: single.ai, locale: "zh-CN", signal });
  expect((single.calls[0].data.subtopics[0].units as Array<{ platform?: string }>).every(item => !item.platform)).toBe(true);
});

it("drops the clause leaning on a sentence opening that went as a repeat", () => {
  const first = "避免依赖 Service Worker 内存中的 setInterval，必须使用结束时间戳计算剩余时间，并利用 chrome.alarms 安排结束事件。";
  const second = "使用结束时间戳计算剩余时间，而非依靠持续运行的 setInterval，Service Worker 不要求一直运行。";
  const chapter: WikiDraftChapter = { id: "c", title: "技术", question: "", group: "", problems: [], body: [first, second].join("\n\n"),
    paragraphs: [first, second].map(text => ({ subtopic: "s", text, unitIds: ["u1"], claims: [{ text, unitIds: ["u1"] }] })) };
  chapterRepeatedClauses(chapter);
  expect(chapter.paragraphs[1].text).not.toMatch(/^而非/u);
  expect(chapter.paragraphs[1].text).toContain("Service Worker 不要求一直运行。");
});
