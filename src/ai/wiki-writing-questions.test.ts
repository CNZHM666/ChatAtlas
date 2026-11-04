import { expect, it } from "vitest";
import { pendingWriterQuestions, pendingWritingQuestions, wikiNamedProjects, withAnswersFrom, withWriterQuestions, withExcludedProject, withWritingAnswer, withWritingQuestions } from "./wiki-writing-questions";
import { resolveWikiReading } from "./wiki-knowledge-reading";
import { reviseForAnswers, writeWikiDraft } from "./wiki-knowledge-write";
import type { StructuredAIRequest } from "./provider";
import type { WikiKnowledgeLedger, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { readQuestions } from "./wiki-question-parse";

const signal = new AbortController().signal;
const unit = (index: number, statement: string, extra: Partial<WikiKnowledgeUnit> = {}): WikiKnowledgeUnit => ({ id: `u${index}`, subject: "密钥", statement, kind: "constraint", details: [], evidence: { evidenceId: `e${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown", ...extra });
const earlier = unit(1, "默认使用 sessionStorage；可选“在此设备记住”存 localStorage。"), later = unit(2, "API Key 仅保存在内存，禁止写入 localStorage。");
const atlas = unit(3, "需识别新决定替代旧决定的关系，避免保留冲突方案。", { subject: "决策演变" });
const header = unit(4, "Header 不显示 Provider 连接状态。", { subject: "界面", details: ["除非用户正在进行需要 Provider 的任务。"] });
const book = (): WikiKnowledgeLedger => ({ version: 1, generatedAt: 0, status: "complete", materials: 4, batches: [{ sourceIds: [], status: "ok", units: [earlier, later, atlas, header], rejected: {} }],
  organization: { version: 1, generatedAt: 7, status: "complete", subjects: [{ id: "s", name: "密钥", aliases: [], unitIds: [earlier.id, later.id, atlas.id, header.id] }], merged: [], report: {},
    relations: [{ older: earlier.id, newer: later.id, kind: "replaces", status: "unresolved" }], chapters: [{ id: "c", title: "安全", question: "", group: "", subtopics: [{ title: "密钥", subjectIds: ["s"] }] }] } });

/** A model that reads the material and answers with the given questions, ids as it was sent them. */
function asking(answer: (prompt: { chapters: Array<{ subtopics: Array<{ units: Array<{ id: string; statement: string; exceptions?: string[] }> }> }> }) => unknown) {
  const prompts: unknown[] = [];
  return { prompts, ai: { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => { const data = JSON.parse(request.prompt); prompts.push(data); return request.validate(answer(data)); } } };
}
const idOf = (prompt: Parameters<Parameters<typeof asking>[0]>[0], statement: string) => prompt.chapters.flatMap(chapter => chapter.subtopics.flatMap(topic => topic.units)).find(item => item.statement === statement)!.id;

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
  // Asked once per organization.
  expect(await withWritingQuestions(asked, { ai, signal, locale: "zh-CN" })).toBe(asked);

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
  // Taken back, everything returns.
  const back = withExcludedProject(left, "ChatAtlas", false);
  expect(back.scopeAnswers).toBeUndefined();
  expect(all.every(item => live(back).has(item.id))).toBe(true);
  // A name the user types tags the points naming it.
  const typed = withExcludedProject(ledger, "Project Brief", true);
  expect(typed.userOwners).toEqual({ [review[2].id]: "Project Brief" });
  expect(live(typed).has(review[2].id)).toBe(false);
});

it("passes on what a chapter's writer asks as soon as it is written, and revises only the paragraphs an answer concerns", async () => {
  const raised: string[][] = [];
  const sent: string[] = [];
  const writer = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    const data = JSON.parse(request.prompt); sent.push(data.presentation);
    if (data.presentation === "wiki_unit_propositions") return request.validate({ same: [] });
    if (data.presentation === "wiki_paragraph_revise") return request.validate({ text: data.paragraph.includes("localStorage") ? "API Key 仅保存在内存，禁止写入 localStorage。" : data.paragraph });
    const ids = data.subtopics[0].units.map((item: { id: string }) => item.id);
    const key = (statement: string) => data.subtopics[0].units.find((item: { statement: string }) => item.statement === statement).id;
    return request.validate({ opening: "密钥只在本地。", openingUnitIds: [], subtopics: data.subtopics.map((topic: { title: string }) => ({ title: topic.title, paragraphs: [
      { text: "API Key 是否允许存 localStorage，还是一律禁止，仍未确定。", unitIds: [key(earlier.statement), key(later.statement)] },
      { text: "Header 不显示 Provider 连接状态，除非用户正在进行需要 Provider 的任务。", unitIds: [key(header.statement)] },
    ] })), questions: [{ about: "API Key 存储", ask: "允许存 localStorage 还是一律禁止？", unitIds: [key(earlier.statement), key(later.statement)], options: [{ label: "一律禁止", actions: [{ do: "confirm", units: [key(later.statement)] }, { do: "reject", units: [key(earlier.statement)] }] }, { label: "允许可选保存", actions: [] }] }, { about: "空", ask: "?", unitIds: ids, options: [] }] });
  } };
  const ledger = book();
  const draft = await writeWikiDraft({ ledger, ai: writer, locale: "zh-CN", signal, onQuestions: questions => raised.push(questions.map(question => question.about)) });
  // Asked as soon as the part came back; a question with no answers to choose is not one.
  expect(raised).toEqual([["API Key 存储"]]);
  const written = { ...ledger, draft };
  const { ledger: asked, added } = withWriterQuestions(written);
  expect(pendingWriterQuestions(asked).map(question => question.about)).toEqual(["API Key 存储"]);
  // Answered on another copy while writing: only the answers are taken.
  const answeredCopy = withWritingAnswer(asked, added[0], "o1");
  const answered = withAnswersFrom(asked, answeredCopy);
  expect(answered.draft).toBe(asked.draft);
  sent.length = 0;
  const revised = await reviseForAnswers(answered, added, { ai: writer, locale: "zh-CN", signal });
  // One small request, for the one paragraph the answer concerns; the other keeps its text and its exception.
  expect(sent).toEqual(["wiki_paragraph_revise"]);
  const paragraphs = revised.draft!.chapters[0].paragraphs;
  expect(paragraphs[0].text).toBe("API Key 仅保存在内存，禁止写入 localStorage。");
  expect(paragraphs[0].claims?.length).toBeGreaterThan(0);
  expect(paragraphs[1].text).toBe(draft.chapters[0].paragraphs[1].text);
  expect(revised.draft!.chapters[0].body).toContain("禁止写入 localStorage");
  // Nothing answered: nothing revised, no request.
  sent.length = 0;
  expect(await reviseForAnswers(asked, added, { ai: writer, locale: "zh-CN", signal })).toBe(asked);
  expect(sent).toEqual([]);
});

it("drops a question or an answer that shows an id the model was sent", () => {
  const real = new Map([["k1", "u1"], ["k2", "u2"]]);
  const option = (label: string) => ({ label, actions: [{ do: "confirm", units: ["k1"] }] });
  expect(readQuestions({ questions: [{ about: "密钥", ask: "k1 和 k2 哪个算数？", unitIds: ["k1", "k2"], options: [option("是"), option("否")] }] }, real, 1)).toEqual([]);
  expect(readQuestions({ questions: [{ about: "密钥", ask: "密钥放在哪里？", unitIds: ["k1"], options: [option("按 k1"), option("本地")] }] }, real, 1)).toEqual([]);
  expect(readQuestions({ questions: [{ about: "密钥", ask: "密钥放在哪里？", unitIds: ["k1"], options: [option("服务端"), option("本地")] }] }, real, 1)).toHaveLength(1);
});
