import { expect, it } from "vitest";
import { pendingWriterQuestions, pendingWritingQuestions, wikiNamedProjects, withAnswersFrom, withWriterQuestions, withExcludedProject, withWritingAnswer, withWritingQuestions, withAnswersRevisited, answerLiftedLimits } from "./wiki-writing-questions";
import { resolveWikiReading } from "./wiki-knowledge-reading";
import { writeWikiDraft } from "./wiki-knowledge-write";
import type { StructuredAIRequest } from "./provider";
import type { WikiKnowledgeLedger, WikiKnowledgeUnit, WikiWritingQuestion } from "../shared/wiki-knowledge";
import { readQuestions, wikiLocalAnswer } from "./wiki-question-parse";
import { wikiRoadmapScope } from "../shared/wiki-roadmap-scope";

const signal = new AbortController().signal;
const unit = (index: number, statement: string, extra: Partial<WikiKnowledgeUnit> = {}): WikiKnowledgeUnit => ({ id: `u${index}`, subject: "密钥", statement, kind: "constraint", details: [], evidence: { evidenceId: `e${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown", ...extra });
const earlier = unit(1, "可选“在此设备记住”时把 API Key 存 localStorage。"), later = unit(2, "API Key 仅保存在内存，禁止写入 localStorage。");
const atlas = unit(3, "需识别新决定替代旧决定的关系，避免保留冲突方案。", { subject: "决策演变" });
const header = unit(4, "Header 不显示 Provider 连接状态。", { subject: "界面", details: ["除非用户正在进行需要 Provider 的任务。"] });
header.evidence.quote = "Header 不显示 Provider 连接状态。除非用户正在进行需要 Provider 的任务。";
const book = (): WikiKnowledgeLedger => ({ version: 1, generatedAt: 0, status: "complete", materials: 4, batches: [{ sourceIds: [], status: "ok", units: [earlier, later, atlas, header], rejected: {} }],
  organization: { version: 1, generatedAt: 7, status: "complete", subjects: [{ id: "s", name: "密钥", aliases: [], unitIds: [earlier.id, later.id, atlas.id, header.id] }], merged: [], report: {},
    relations: [{ older: earlier.id, newer: later.id, kind: "replaces", status: "unresolved" }], chapters: [{ id: "c", title: "安全", question: "", group: "", subtopics: [{ title: "密钥", subjectIds: ["s"] }] }] } });

/** A model that reads the material and answers with the given questions, ids as it was sent them. */
function asking(answer: (prompt: { chapters: Array<{ subtopics: Array<{ units: Array<{ id: string; statement: string; exceptions?: string[] }> }> }> }) => unknown) {
  const prompts: unknown[] = [];
  return { prompts, ai: { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => { const data = JSON.parse(request.prompt); prompts.push(data); return request.validate(answer(data)); } } };
}
const idOf = (prompt: Parameters<Parameters<typeof asking>[0]>[0], statement: string) => prompt.chapters.flatMap(chapter => chapter.subtopics.flatMap(topic => topic.units)).find(item => item.statement === statement)!.id;

it("omits external implementations from decision material and rejects answers from a stale mixed question", async () => {
  const reference = unit(5, "Reflow 并行生成固件和 PCB。", { kind: "plan", researchUse: "reference" });
  const ledger = book();
  ledger.batches[0].units.push(reference);
  ledger.organization!.subjects[0].unitIds.push(reference.id);
  const question: WikiWritingQuestion = { id: "mixed", organization: 7, about: "生成范围", ask: "先做单一方向，还是并行做固件和 PCB？",
    unitIds: [atlas.id, reference.id], options: [
      { id: "one", label: "先做单一方向", actions: [{ do: "reject", units: [reference.id] }] },
      { id: "parallel", label: "并行做固件和 PCB", actions: [{ do: "confirm", units: [reference.id] }] },
    ] };
  const model = asking(() => ({ questions: [] }));
  await withWritingQuestions(ledger, { ai: model.ai, signal, locale: "zh-CN" });
  expect(model.prompts).toHaveLength(1);
  expect(JSON.stringify(model.prompts[0])).not.toContain("Reflow");
  expect(JSON.stringify(model.prompts[0])).toContain(later.statement);
  const stale = { ...ledger, writingQuestions: [question] };
  expect(pendingWritingQuestions(stale)).toEqual([]);
  expect(withWritingAnswer(stale, question, "one")).toBe(stale);
});

it("records the scope of a compound choice and retains its receipt when generation finds changed evidence", async () => {
  const ledger = book();
  const compound = unit(42, "首版密钥只存在内存；界面框架使用 React。", { kind: "plan" });
  ledger.batches[0].units.push(compound);
  ledger.organization!.subjects[0].unitIds.push(compound.id);
  const question: WikiWritingQuestion = { id: "scope", scoped: true, organization: 7, about: "首版密钥", ask: "首版密钥存在哪里？",
    unitIds: [compound.id], options: [
      { id: "memory", label: "首版密钥只存在内存", actions: [{ do: "confirm", units: [compound.id] }] },
      { id: "open", label: "暂不定", actions: [{ do: "open", units: [compound.id] }] },
    ] };
  const saved = withWritingAnswer(ledger, question, "memory", undefined, 9);
  expect(saved.decisions?.[compound.id]).toBeUndefined();
  expect(saved.userAnswers?.[0].scope?.targets[0]).toMatchObject({ unitId: compound.id, messageId: compound.evidence.messageId });
  expect(resolveWikiReading(saved).units.find(unit => unit.id === "answer:scope:memory")?.statement).toContain("首版密钥只存在内存");
  const changed = structuredClone(saved);
  changed.batches[0].units.find(unit => unit.id === compound.id)!.statement = "首版密钥存入系统凭据库；界面框架使用 React。";
  expect(resolveWikiReading(changed).units.some(unit => unit.id === "answer:scope:memory")).toBe(false);
  const refreshed = await withWritingQuestions(changed, { ai: asking(() => ({ questions: [] })).ai, signal, locale: "zh-CN" });
  expect(withWriterQuestions(refreshed).ledger.userAnswers?.[0].answer).toBe("首版密钥只存在内存");
  expect(resolveWikiReading(refreshed).report.scoped_answers_pending_review).toBe(1);
});

it("projects the selected release without rejecting a different release or confirming extras", () => {
  const first = unit(5, "V0 阶段不包含拖拽画布，仅提供“一句话需求 -> AI分析 -> 输出推荐方案/BOM/接线/代码”的静态结果页，用于验证核心价值。", { subject: "V0 MVP" });
  const follow = unit(6, "在 V0 验证通过后引入画布，支持 Hardware IR 和实时规则检查。", { subject: "画布规划", kind: "plan" });
  const ledger = book();
  ledger.batches[0].units.push(first, follow);
  ledger.organization!.subjects[0].unitIds.push(first.id, follow.id);
  const question: WikiWritingQuestion = { id: "canvas-scope", organization: 7, about: "V1画布", ask: "V1版本是否包含交互式画布，还是仅保留V0的静态结果页？",
    unitIds: [first.id, follow.id], options: [
      { id: "include", label: "V1包含画布", actions: [{ do: "confirm", units: [follow.id] }, { do: "reject", units: [first.id] }] },
      { id: "static", label: "V1仅静态页", actions: [{ do: "confirm", units: [first.id] }] },
    ] };
  const selected = withWritingAnswer(ledger, question, "include", undefined, 8);
  expect(selected.decisions?.[first.id]).toBeUndefined();
  expect(selected.decisions?.[follow.id]).toBeUndefined();
  const legacy = { ...selected, decisions: { [first.id]: { verdict: "rejected" as const, at: 8 }, [follow.id]: { verdict: "confirmed" as const, at: 8 } } };
  const reading = resolveWikiReading(legacy);
  const answer = reading.units.find(item => item.id === "answer:canvas-scope:include")!;
  expect(answer.statement).toBe("V1包含画布。");
  expect(reading.statuses.get(answer.id)).toBe("confirmed");
  expect(wikiLocalAnswer(reading.ledger, answer.id)?.answer).toBe("V1包含画布");
  expect(reading.statuses.get(first.id)).not.toBe("history");
  expect(reading.statuses.get(follow.id)).not.toBe("confirmed");
  expect(wikiRoadmapScope(answer).rawLabels).toEqual(["V1"]);
  const restorable = reading.ledger.writingQuestions?.find(item => item.id === question.id);
  if (!restorable) throw new Error("Missing saved choice");
  expect(restorable.options.map(option => option.id)).toEqual(["include", "static"]);
  const changed = withWritingAnswer(legacy, restorable, "static", undefined, 9);
  const updated = resolveWikiReading(changed);
  expect(updated.units.find(item => item.id === "answer:canvas-scope:static")?.statement).toBe("V1仅静态页。");
  expect(updated.statuses.get("answer:canvas-scope:static")).toBe("confirmed");
  expect(updated.units.some(item => item.id === answer.id)).toBe(false);
  expect(updated.statuses.get(first.id)).toBe("proposal");
  expect(updated.statuses.get(follow.id)).toBe("proposal");
  expect(changed.userAnswers?.[0].previousChoices?.[0].answer).toBe("V1包含画布");
  expect(legacy.decisions[first.id].verdict).toBe("rejected");
});

it("derives stage, priority and exclusion without assigning an unsupported current release", () => {
  const staged = unit(8, "M3.2 暂不做拍照识别，Phase B / GitHub Alpha 讨论开放。");
  expect(wikiRoadmapScope(staged)).toMatchObject({
    rawLabels: ["M3.2", "Phase B", "GitHub Alpha"], priorities: [], bucket: "out_of_scope", exclusionType: "phase_only", exclusionLabels: ["M3.2"],
  });
  const priority = unit(9, "Phase A 优先级为 P0。");
  expect(wikiRoadmapScope(priority)).toMatchObject({ rawLabels: ["Phase A"], priorities: ["P0"], bucket: undefined });
  const boundary = unit(10, "永久禁止向第三方写入密钥。");
  expect(wikiRoadmapScope(boundary)).toMatchObject({ exclusionType: "permanent", bucket: "out_of_scope" });
});
it("keeps the answered question across rewrites and recovers a legacy positional collision", () => {
  const version = unit(5, "首个公开标签定为 v0.1.0-alpha，或仅公开 main 分支。"), bench = unit(6, "优先搭建硬件基准测试集。");
  const real = new Map([["k1", version.id], ["k2", bench.id]]);
  const parse = (about: string, ask: string, label: string, id: string) => readQuestions({ questions: [{ about, ask, unitIds: [id], options: [
    { label, actions: [{ do: "confirm", units: [id] }] }, { label: "未定", actions: [] },
  ] }] }, real, 7, { prefix: "w:c:0", stage: "writing" })[0];
  const chosen = parse("发布标签", "发布 v0.1.0-alpha 标签吗？", "发布v0.1.0-alpha标签", "k1");
  const regenerated = parse("基准测试", "优先搭建基准测试集吗？", "优先搭建硬件基准测试集", "k2");
  expect(chosen.id).not.toBe(regenerated.id);
  const base = book();
  base.batches[0].units.push(version, bench);
  base.organization!.subjects[0].unitIds.push(version.id, bench.id);
  const answered = withWritingAnswer(base, chosen, "o1");
  const merged = withAnswersFrom({ ...base, writingQuestions: [regenerated] }, answered);
  expect(merged.writingQuestions).toContain(chosen);
  expect(pendingWritingQuestions(merged)).toEqual([regenerated]);

  const collision = { ...regenerated, id: chosen.id };
  const restored = resolveWikiReading({ ...answered, writingQuestions: [collision] });
  const choiceId = `answer:${chosen.id}:o1`;
  expect(restored.units.find(item => item.id === choiceId)?.statement).toBe("发布v0.1.0-alpha标签。");
  expect(wikiLocalAnswer(restored.ledger, choiceId)?.answer).toBe(chosen.options[0].label);
  expect(wikiLocalAnswer(restored.ledger, bench.id)).toBeUndefined();
  expect(restored.statuses.get(bench.id)).toBe("proposal");
});

it("does not ask a paraphrased choice with new source IDs after the user answered it", () => {
  const old = unit(5, "检索结果使用 Compact Rows/List。"), next = unit(6, "结果列表可采用 Compact Rows/List。");
  const alternative = unit(7, "搜索结果按已归档和未归档两组显示。");
  const ledger = book();
  ledger.batches[0].units.push(old, next, alternative);
  ledger.organization!.subjects[0].unitIds.push(old.id, next.id, alternative.id);
  const options = (id: string): WikiWritingQuestion["options"] => [
    { id: "rows", label: "Compact Rows/List", actions: [{ do: "confirm", units: [id] }] },
    { id: "groups", label: "分为已归档和未归档两组", actions: [{ do: "confirm", units: [alternative.id] }] },
  ];
  const asked: WikiWritingQuestion = { id: "original", about: "检索结果", organization: 7, ask: "检索结果的样式是 Compact Rows/List，还是分为已归档和未归档两组？",
    unitIds: [old.id, alternative.id], options: options(old.id) };
  const repeated: WikiWritingQuestion = { ...asked, id: "rewritten", ask: "检索结果最终采用 Compact Rows/List 还是分为已归档和未归档两组？", unitIds: [next.id, alternative.id], options: options(next.id) };
  const version = { ...repeated, id: "version", ask: "V2 " + repeated.ask };
  const change = { ...repeated, id: "change", ask: repeated.ask.replace("已归档和未归档", "当前项目和其他项目") };
  const answered = withWritingAnswer(ledger, asked, "rows", undefined, 8);
  const queue = { ...answered, writingQuestions: [...answered.writingQuestions ?? [], repeated, version, change] };
  expect(pendingWritingQuestions(queue).map(question => question.id)).toEqual([version.id, change.id]);
  const reading = resolveWikiReading(queue);
  expect(pendingWritingQuestions(reading.ledger, reading.statuses).map(question => question.id)).toEqual([version.id, change.id]);
});

it("asks in the model's words what it cannot write without the user, with answers that act on the ledger", async () => {
  const { ai, prompts } = asking(prompt => ({ questions: [
    { about: "API Key 存储", ask: "允许“在此设备记住”存 localStorage，还是一律禁止？", unitIds: [idOf(prompt, earlier.statement), idOf(prompt, later.statement)],
      options: [{ label: "一律禁止，只存内存或会话", actions: [{ do: "confirm", units: [idOf(prompt, later.statement)] }, { do: "reject", units: [idOf(prompt, earlier.statement)] }] }, { label: "两种都保留，各有场景", actions: [{ do: "both", units: [idOf(prompt, earlier.statement), idOf(prompt, later.statement)] }] }] },
    { about: "决策演变", ask: "识别新旧决定是这个项目的功能吗？", unitIds: [idOf(prompt, atlas.statement)], options: [{ label: "不是，是 ChatAtlas 的，不写", actions: [{ do: "owner", units: [idOf(prompt, atlas.statement)], name: "ChatAtlas", answer: "exclude" }] }, { label: "是本项目的", actions: [] }] },
    // Not asked: an id it was never sent, and a question with one answer.
    { about: "幽灵", ask: "？", unitIds: ["k99"], options: [{ label: "a", actions: [] }, { label: "b", actions: [] }] },
    { about: "单选", ask: "只有一个答案？", unitIds: [idOf(prompt, header.statement)], options: [{ label: "是", actions: [] }] },
  ] }));
  const asked = await withWritingQuestions(book(), { ai, signal, locale: "zh-CN" });
  const questions = pendingWritingQuestions(asked);
  expect(questions.map(question => question.about)).toEqual(["API Key 存储", "决策演变"]);
  expect(questions[0].unitIds).toEqual([earlier.id, later.id]);
  // The exception a rule carries goes with it.
  expect(JSON.stringify(prompts[0])).toContain("除非用户正在进行需要 Provider 的任务");
  // Reorganizing identical material does not repeat the same model request.
  expect(await withWritingQuestions(asked, { ai, signal, locale: "zh-CN" })).toBe(asked);
  const refreshed = await withWritingQuestions({ ...asked, organization: { ...asked.organization!, generatedAt: 40 } }, { ai, signal, locale: "zh-CN" });
  expect(pendingWritingQuestions(refreshed).map(question => question.id)).toEqual(questions.map(question => question.id));
  expect(prompts).toHaveLength(1);

  const chosen = withWritingAnswer(asked, questions[0], "o1");
  expect(chosen.decisions).toMatchObject({ [later.id]: { verdict: "confirmed" }, [earlier.id]: { verdict: "rejected" } });
  expect(chosen.userAnswers).toMatchObject([{ unitIds: [earlier.id, later.id], answer: "一律禁止，只存内存或会话" }]);
  // Another answer undoes the first.
  const both = withWritingAnswer(chosen, questions[0], "o2");
  expect(both.coexisting).toEqual([`${earlier.id}>${later.id}`]);
  expect(both.decisions).toMatchObject({ [earlier.id]: { verdict: "confirmed" }, [later.id]: { verdict: "confirmed" } });
  expect(both.userAnswers).toHaveLength(1);
  // A point the user says is another project's is left out wherever the ledger is read.
  const owned = withWritingAnswer(asked, questions[1], "o1");
  expect(resolveWikiReading(owned).organization!.subjects.flatMap(subject => subject.unitIds)).not.toContain(atlas.id);
  // What the user writes instead is kept in their words; clearing removes it.
  const written = withWritingAnswer(asked, questions[0], undefined, "会话里可以记住，跨会话绝不保存");
  expect(written.userAnswers?.[0].answer).toBe("会话里可以记住，跨会话绝不保存");
  expect(withWritingAnswer(written, questions[0], undefined).userAnswers).toBeUndefined();
});

it("asks nothing when the request fails, and the writer gets the user's answers and a rule's exceptions", async () => {
  const failing = { generateStructured: async () => { throw new Error("provider down"); } };
  const ledger = book();
  expect(await withWritingQuestions(ledger, { ai: failing, signal, locale: "zh-CN" })).toBe(ledger);
  const answered: WikiKnowledgeLedger = { ...ledger, userAnswers: [{ questionId: "q", unitIds: [later.id], question: "localStorage 允许吗？", answer: "绝不允许", at: 1 }] };
  const sent: string[] = [];
  const writer = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => { sent.push(request.prompt); const data = JSON.parse(request.prompt); if (data.presentation === "wiki_unit_propositions") return request.validate({ same: [] }); return request.validate({ opening: "密钥只在本地。", openingUnitIds: [], subtopics: data.subtopics.map((topic: { title: string; units: Array<{ id: string; statement: string }> }) => ({ title: topic.title, paragraphs: [{ text: topic.units.map(item => item.statement).join(""), unitIds: topic.units.map(item => item.id) }] })) }); } };
  await writeWikiDraft({ ledger: answered, ai: writer, locale: "zh-CN", signal });
  const prompt = sent.find(text => text.includes("wiki_chapter_write"))!;
  expect(prompt).toContain("localStorage 允许吗？ → 绝不允许");
  expect(prompt).toContain("\"exceptions\":[\"除非用户正在进行需要 Provider 的任务。\"]");
});

it("lists the other products and projects the material names, and leaves out the ones the user ticks or types", () => {
  const said = (index: number, statement: string, messageId: string, extra: Partial<WikiKnowledgeUnit> = {}) => unit(index, statement, { evidence: { evidenceId: `e${index}`, conversationId: "c", messageId, messageIndex: index, role: "assistant", pasted: false, quote: statement }, ...extra });
  const own = Array.from({ length: 22 }, (_, index) => said(index + 10, `Hardware IR 方案第 ${index} 条：Validator 检查 GPIO 冲突。`, `m${index + 10}`));
  // Extraction tagged ChatAtlas once, as a reference, and none of the message reviewing it.
  const review = [said(1, "ChatAtlas 当前能收集项目知识，但缺乏判断最新决定的能力。", "review"), said(2, "下一轮优化应重点升级 ChatAtlas 的项目理解能力。", "review"), said(3, "默认提供简短 Project Brief，点击展开 Wiki。", "review"), said(4, "引入轻量结构化记录 ProjectEvent。", "review")];
  const seen = said(5, "用户确认综述由 ChatAtlas 生成。", "earlier", { about: { name: "ChatAtlas", role: "reference" } }), flux = said(6, "Boardly 面向专业工程师。", "rivals", { about: { name: "Boardly", role: "competitor" } });
  const all = [...own, ...review, seen, flux];
  const ledger: WikiKnowledgeLedger = { ...book(), batches: [{ sourceIds: [], status: "ok", units: all, rejected: {} }], organization: { ...book().organization!, subjects: [{ id: "s", name: "项目", aliases: [], unitIds: all.map(item => item.id) }] } };
  const named = wikiNamedProjects(ledger);
  // What the discussion talks about as a product reads as another project, with its untagged points counted; a
  // competitor stays a competitor.
  expect(named.map(item => [item.name, item.role])).toEqual([["ChatAtlas", "other_project"], ["Boardly", "competitor"]]);
  expect(named[0].count).toBeGreaterThan(1);
  const live = (book: WikiKnowledgeLedger) => new Set(resolveWikiReading(book).organization!.subjects.flatMap(subject => subject.unitIds));
  const left = withExcludedProject(ledger, "ChatAtlas", true);
  expect(left.scopeAnswers).toEqual({ chatatlas: "exclude" });
  expect(review.filter(item => live(left).has(item.id))).toEqual([]);
  expect(own.every(item => live(left).has(item.id))).toBe(true);
  expect(wikiNamedProjects(left)[0]).toMatchObject({ name: "ChatAtlas", excluded: true });
  const mistakenName = { ...left, organization: { ...left.organization!, projectName: "ChatAtlas" } };
  expect(wikiNamedProjects(mistakenName).find(item => item.key === "chatatlas")?.excluded).toBe(true);
  expect(review.some(item => live(mistakenName).has(item.id))).toBe(false);
  expect(own.every(item => live(mistakenName).has(item.id))).toBe(true);
  // Taken back, everything returns.
  const back = withExcludedProject(left, "ChatAtlas", false);
  expect(back.scopeAnswers).toBeUndefined();
  expect(all.every(item => live(back).has(item.id))).toBe(true);
  // A name the user types tags the points naming it.
  const typed = withExcludedProject(ledger, "Project Brief", true);
  expect(typed.userOwners).toEqual({ [review[2].id]: "Project Brief" });
  expect(live(typed).has(review[2].id)).toBe(false);
});

it("ignores new writer questions while keeping a saved writer question answerable", async () => {
  const writer = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    const data = JSON.parse(request.prompt);
    if (data.presentation === "wiki_unit_propositions") return request.validate({ same: [] });
    const ids = data.subtopics[0].units.map((item: { id: string }) => item.id);
    const key = (statement: string) => data.subtopics[0].units.find((item: { statement: string }) => item.statement === statement).id;
    return request.validate({ opening: "密钥只在本地。", openingUnitIds: [], subtopics: data.subtopics.map((topic: { title: string }) => ({ title: topic.title, paragraphs: [
      { text: "API Key 是否允许存 localStorage，还是一律禁止，仍未确定。", unitIds: [key(earlier.statement), key(later.statement)] },
      { text: "Header 不显示 Provider 连接状态，除非用户正在进行需要 Provider 的任务。", unitIds: [key(header.statement)] },
    ] })), questions: [{ about: "API Key 存储", ask: "允许存 localStorage 还是一律禁止？", unitIds: [key(earlier.statement), key(later.statement)], options: [{ label: "一律禁止", actions: [{ do: "confirm", units: [key(later.statement)] }, { do: "reject", units: [key(earlier.statement)] }] }, { label: "允许可选保存", actions: [] }] }, { about: "空", ask: "?", unitIds: ids, options: [] }] });
  } };
  const ledger = book();
  const draft = await writeWikiDraft({ ledger, ai: writer, locale: "zh-CN", signal });
  expect(draft.chapters.some(chapter => chapter.questions?.length)).toBe(false);
  const previousQuestion: WikiWritingQuestion = { id: "prior-writer", organization: 7, stage: "writing",
    scoped: true, about: "API Key 存储", ask: "允许存 localStorage 还是一律禁止？", unitIds: [earlier.id, later.id], options: [
      { id: "o1", label: "一律禁止", actions: [{ do: "confirm", units: [later.id] }, { do: "reject", units: [earlier.id] }] },
      { id: "o2", label: "允许可选保存", actions: [] },
    ] };
  const stored = { ...draft, chapters: draft.chapters.map((chapter, index) => index === 0 ? { ...chapter, questions: [previousQuestion] } : chapter) };
  const { ledger: asked, added } = withWriterQuestions({ ...ledger, draft: stored });
  expect(pendingWriterQuestions(asked).map(question => question.about)).toEqual(["API Key 存储"]);
  const answeredCopy = withWritingAnswer(asked, added[0], "o1");
  const answered = withAnswersFrom(asked, answeredCopy);
  expect(answered.draft).toBe(asked.draft);
  expect(answered.userAnswers?.[0].scope?.targets.map(target => target.unitId)).toEqual([earlier.id, later.id]);
  expect(pendingWriterQuestions(answered)).toEqual([]);
});

it("drops a question or an answer that shows an id the model was sent", () => {
  const real = new Map([["k1", "u1"], ["k2", "u2"]]);
  const option = (label: string) => ({ label, actions: [{ do: "confirm", units: ["k1"] }] });
  expect(readQuestions({ questions: [{ about: "密钥", ask: "k1 和 k2 哪个算数？", unitIds: ["k1", "k2"], options: [option("是"), option("否")] }] }, real, 1)).toEqual([]);
  expect(readQuestions({ questions: [{ about: "密钥", ask: "密钥放在哪里？", unitIds: ["k1"], options: [option("按 k1"), option("本地")] }] }, real, 1)).toEqual([]);
  expect(readQuestions({ questions: [{ about: "密钥", ask: "密钥放在哪里？", unitIds: ["k1"], options: [option("服务端"), option("本地")] }] }, real, 1)).toHaveLength(1);
});

it("keeps from an answer's rejection a unit with other rules, the other mode the answer keeps, and another wording of what it confirms", () => {
  const light = unit(1, "主背景接近 #FAFAFA，文字接近 #18181B。"), dark = unit(2, "主背景 #0D0D0D ~ #111111，Panel #151515，Border #27272A。");
  const wish = unit(3, "针对小白用户，项目应增加直接询问购买清单、提供比价推荐及链接的功能。"), bom = unit(4, "BOM 必须从 Hardware IR 派生，不由 LLM 重新生成；V0.1 不需要实时价格、商城购买或电商链接。");
  const missing = unit(5, "明确区分已有和缺少元件，对缺少元件显示采购规格，提供复制采购清单功能，本阶段不包含商城、比价或价格信息。"), early = unit(6, "前期不做实时全网比价，仅提供中英文搜索词，引导用户自行购买缺失零件。");
  const chosen = unit(7, "项目定位为 AI Hardware Canvas，即面向大学生和硬件初学者的 Web 端可视化工作台，通过自然语言生成硬件方案。");
  const same = unit(8, "面向大学生、电子/嵌入式初学者和创客的自然语言硬件设计工作台，核心是帮助小白理解并搭建硬件系统。"), other = unit(9, "项目定位为面向硬件小白的AI辅助硬件设计工具，解决“有想法但不会电子设计”的问题，而非专业EDA软件。");
  const ledger = { ...book(), batches: [{ sourceIds: [], status: "ok" as const, units: [light, dark, wish, bom, missing, early, chosen, same, other], rejected: {} }] };
  const ask = (id: string, about: string, text: string, label: string, confirm: string[], reject: string[]) => ({ id, about, ask: text, unitIds: [...confirm, ...reject], organization: 1, options: [{ id: "o1", label, actions: [{ do: "confirm" as const, units: confirm }, { do: "reject" as const, units: reject }] }, { id: "o2", label: "暂不确定", actions: [] }] });
  let next = withWritingAnswer(ledger, ask("q1", "首页视觉", "首页采用浅色（#FAFAFA）还是深色（#0D0D0D）作为默认主背景？", "浅色为主，支持切换深色", [light.id], [dark.id]), "o1");
  next = withWritingAnswer(next, ask("q2", "比价", "当前阶段是否包含“直接询问购买清单、提供比价推荐及链接”的功能？", "包含，需实现比价和链接推荐", [wish.id], [bom.id, missing.id, early.id]), "o1");
  next = withWritingAnswer(next, ask("q3", "定位", "项目核心定位是“AI Hardware Canvas”工作台，还是通用的“AI辅助硬件设计工具”？", "定位为 AI Hardware Canvas", [chosen.id], [same.id, other.id]), "o1");
  const verdict = (id: string) => next.decisions?.[id]?.verdict;
  expect([light, wish, chosen].map(item => verdict(item.id))).toEqual([undefined, "confirmed", "confirmed"]);
  expect([early, other].map(item => verdict(item.id))).toEqual(["rejected", "rejected"]);
  // Kept: the dark mode the answer keeps, the BOM rule, the rule closing on a limit, the same positioning in other words.
  expect([dark, bom, missing, same].map(item => verdict(item.id))).toEqual([undefined, undefined, undefined, undefined]);
  // The answer still reaches the writer for every unit asked about.
  expect(next.userAnswers?.find(answer => answer.questionId === "q2")?.unitIds).toContain(bom.id);
});

it("applies saved answers again with the checks, but leaves a decision the user changed by hand afterwards", () => {
  const light = unit(1, "主背景接近 #FAFAFA，文字接近 #18181B。"), dark = unit(2, "主背景 #0D0D0D ~ #111111，Panel #151515，Border #27272A。");
  const question = { id: "q1", about: "首页视觉", ask: "首页采用浅色（#FAFAFA）还是深色（#0D0D0D）作为默认主背景？", unitIds: [light.id, dark.id], organization: 1, options: [{ id: "o1", label: "浅色为主，支持切换深色", actions: [{ do: "confirm" as const, units: [light.id] }, { do: "reject" as const, units: [dark.id] }] }, { id: "o2", label: "暂不确定", actions: [] }] };
  const at = 1000;
  const saved = { ...book(), batches: [{ sourceIds: [], status: "ok" as const, units: [light, dark], rejected: {} }], writingQuestions: [question], userAnswers: [{ questionId: "q1", unitIds: [light.id, dark.id], question: question.ask, answer: question.options[0].label, optionId: "o1", at }], decisions: { [light.id]: { verdict: "confirmed" as const, at }, [dark.id]: { verdict: "rejected" as const, at } } };
  expect(withAnswersRevisited(saved).decisions).toEqual({});
  const byHand = { ...saved, decisions: { ...saved.decisions, [dark.id]: { verdict: "rejected" as const, at: at + 60_000 } } };
  expect(withAnswersRevisited(byHand)).toBe(byHand);
});

it("names the closing limit an answer lifts from a rule it keeps", () => {
  const wish = unit(1, "针对小白用户，项目应增加直接询问购买清单、提供比价推荐及链接的功能。");
  const missing = unit(2, "明确区分已有和缺少元件，对缺少元件显示采购规格，提供复制采购清单功能，本阶段不包含商城、比价或价格信息。");
  const question = { id: "q1", about: "比价", ask: "当前阶段是否包含“直接询问购买清单、提供比价推荐及链接”的功能？", unitIds: [wish.id, missing.id], organization: 1, options: [{ id: "o1", label: "包含，需实现比价和链接推荐", actions: [{ do: "confirm" as const, units: [wish.id] }, { do: "reject" as const, units: [missing.id] }] }, { id: "o2", label: "不包含", actions: [] }] };
  const asked = { ...book(), batches: [{ sourceIds: [], status: "ok" as const, units: [wish, missing], rejected: {} }], writingQuestions: [question] };
  const answered = withWritingAnswer(asked, question, "o1");
  expect(answered.decisions?.[missing.id]).toBeUndefined();
  expect([...answerLiftedLimits(answered)]).toEqual([[missing.id, "本阶段不包含商城、比价或价格信息"]]);
});

it("keeps a limit held to a stage when the question and answer name no stage, and lifts one that is not", () => {
  const wish = unit(1, "针对小白用户，项目应增加直接询问购买清单、提供比价推荐及链接的功能。");
  const missing = unit(2, "明确区分已有和缺少元件，对缺少元件显示采购规格，提供复制采购清单功能，本阶段不包含商城、比价或价格信息。");
  const first = unit(3, "第一版（V0.1）不实现实时全网比价和API对接，仅输出缺件清单。");
  const early = unit(4, "前期不做实时全网比价，仅提供Procurement Spec和中英文搜索词。");
  const never = unit(5, "购物页面只列出采购规格，不包含比价和链接。");
  const question = { id: "q1", about: "比价", ask: "项目是否包含比价推荐及链接功能？", unitIds: [wish.id, missing.id], organization: 1, options: [{ id: "o1", label: "确认包含比价和链接", actions: [{ do: "confirm" as const, units: [wish.id] }, { do: "reject" as const, units: [missing.id] }] }] };
  const asked = { ...book(), batches: [{ sourceIds: [], status: "ok" as const, units: [wish, missing, first, early, never], rejected: {} }], writingQuestions: [question] };
  // The project has it; when is not said, so the first version's limits hold.
  expect([...answerLiftedLimits(withWritingAnswer(asked, question, "o1"))]).toEqual([[never.id, "不包含比价和链接"]]);
});

it("lifts the same limit from rules the question did not list, and one closing after a semicolon", () => {
  const wish = unit(1, "针对小白用户，项目应增加直接询问购买清单、提供比价推荐及链接的功能。");
  const bom = unit(2, "BOM 必须从 Hardware IR 派生，不由 LLM 重新生成；V0.1 不需要实时价格、商城购买、库存或电商链接。");
  const stage = unit(3, "本阶段不开发实时商品比价、淘宝/Amazon API、Affiliate 或商城系统。");
  const focus = unit(4, "聚焦 ESP32 低压模块，不直接竞争专业 EDA；采用 BYOK，简单操作优先本地执行；暂不开发实时商品比价。");
  const other = unit(5, "第一版不做 PCB 设计和 KiCad 导出。");
  const question = { id: "q1", about: "比价", ask: "当前阶段是否包含“直接询问购买清单、提供比价推荐及链接”的功能？", unitIds: [wish.id, bom.id], organization: 1, options: [{ id: "o1", label: "包含，需实现比价和链接推荐", actions: [{ do: "confirm" as const, units: [wish.id] }, { do: "reject" as const, units: [bom.id] }] }, { id: "o2", label: "不包含", actions: [] }] };
  const asked = { ...book(), batches: [{ sourceIds: [], status: "ok" as const, units: [wish, bom, stage, focus, other], rejected: {} }], writingQuestions: [question] };
  const lifted = answerLiftedLimits(withWritingAnswer(asked, question, "o1"));
  expect(lifted.get(bom.id)).toBe("V0.1 不需要实时价格、商城购买、库存或电商链接");
  expect(lifted.get(stage.id)).toBe("本阶段不开发实时商品比价、淘宝/Amazon API、Affiliate 或商城系统");
  expect(lifted.get(focus.id)).toBe("暂不开发实时商品比价");
  expect(lifted.has(other.id)).toBe(false);
  // Not listed by the question: "电商链接" ends in the 链接 the answer names.
  const short = { ...question, unitIds: [wish.id, stage.id], options: [{ id: "o1", label: "确认包含比价和链接", actions: [{ do: "confirm" as const, units: [wish.id] }, { do: "reject" as const, units: [stage.id] }] }] };
  const unlisted = answerLiftedLimits(withWritingAnswer({ ...asked, writingQuestions: [short] }, short, "o1"));
  expect(unlisted.get(bom.id)).toBe("V0.1 不需要实时价格、商城购买、库存或电商链接");
  expect(unlisted.has(other.id)).toBe(false);
  // An answer naming a positioning puts nothing in: a rule that leaves out a word of it holds.
  const canvas = unit(6, "项目定位为 AI Hardware Canvas，通过自然语言生成硬件方案。"), noAi = unit(7, "先完成 Schema 与 Validator，此阶段不需要 AI。");
  const positioning = { id: "q2", about: "定位", ask: "项目定位是 AI Hardware Canvas 还是通用工具？", unitIds: [canvas.id], organization: 1, options: [{ id: "o1", label: "定位为 AI Hardware Canvas", actions: [{ do: "confirm" as const, units: [canvas.id] }] }] };
  const named = { ...book(), batches: [{ sourceIds: [], status: "ok" as const, units: [canvas, noAi], rejected: {} }], writingQuestions: [positioning] };
  expect(answerLiftedLimits(withWritingAnswer(named, positioning, "o1")).size).toBe(0);
});

it("rejects the option set aside when it gives other values for the same setting", () => {
  const short = unit(1, "第一版默认专注时长为25分钟，短休息时长为5分钟。"), long = unit(2, "用户决定将默认专注时长改为 50 分钟，休息时长改为 10 分钟。", { evidence: { evidenceId: "e2", conversationId: "c", messageId: "m2", messageIndex: 2, role: "user", pasted: false, quote: "" } });
  const ledger = { ...book(), batches: [{ sourceIds: [], status: "ok" as const, units: [short, long], rejected: {} }] };
  const question = { id: "q1", about: "默认专注/休息时长", ask: "第一版默认时长用 25/5 还是 50/10？", unitIds: [short.id, long.id], organization: 1, options: [{ id: "o1", label: "25分钟专注，5分钟休息", actions: [{ do: "confirm" as const, units: [short.id] }, { do: "reject" as const, units: [long.id] }] }, { id: "o2", label: "暂不确定", actions: [] }] };
  const next = withWritingAnswer(ledger, question, "o1");
  expect(next.decisions?.[short.id]?.verdict).toBe("confirmed");
  // Nearly every word is shared, but 50/10 is not another wording of 25/5.
  expect(next.decisions?.[long.id]?.verdict).toBe("rejected");
});

it("retires what another option kept open once a choice is made", () => {
  const narrow = unit(1, "宽度固定为360px。"), wide = unit(2, "建议将 Popup 宽度设为 380px。"), both = unit(3, "弹窗宽度保留 B1（380px）与 B2（360px）两案并存，未最终指定前不做选择。"), tip = unit(4, "宽度可用 CSS 变量控制。");
  const ledger = { ...book(), batches: [{ sourceIds: [], status: "ok" as const, units: [narrow, wide, both, tip], rejected: {} }] };
  const question = { id: "q", about: "Popup 宽度", ask: "Popup 宽度定为 360px 还是 380px？", unitIds: [narrow.id, wide.id, both.id, tip.id], organization: 1, options: [
    { id: "o1", label: "380px", actions: [{ do: "confirm" as const, units: [wide.id] }, { do: "reject" as const, units: [narrow.id] }] },
    { id: "o3", label: "暂不决定", actions: [{ do: "open" as const, units: [both.id, tip.id] }] }] };
  const next = withWritingAnswer(ledger, question, "o1");
  expect(next.decisions?.[both.id]?.verdict).toBe("rejected");
  // A point not saying the choice is open stays as it was.
  expect(next.decisions?.[tip.id]).toBeUndefined();
  // Answering "not yet" retires nothing.
  expect(withWritingAnswer(ledger, question, "o3").decisions?.[both.id]?.verdict).toBe("open");
});
