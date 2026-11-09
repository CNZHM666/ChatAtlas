import { describe, expect, it, vi } from "vitest";
import { wikiDraftCompleteness, type WikiDraftChapter, type WikiKnowledgeLedger, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { learningCardChapters as numberedCardChapters, learningCardTitles, learningSkillChapterIds, reviewSaid } from "./wiki-learning-cards";

/** Cards are numbered ("### 1.2 for循环", "| 1.2 for循环 |"); most tests read what a card holds, so they read it without
 * its number. The numbering has a test of its own. */
const unnumbered = (text: string) => text.replace(/^(###\s+)\d+\.\d+\s/gmu, "$1").replace(/^\|\s\d+\.\d+\s/gmu, "| ");
function learningCardChapters(...args: Parameters<typeof numberedCardChapters>): number {
  const laid = numberedCardChapters(...args);
  for (const chapter of args[0]) {
    chapter.body = unnumbered(chapter.body);
    for (const paragraph of chapter.paragraphs) { paragraph.text = unnumbered(paragraph.text); if (paragraph.subtopic) paragraph.subtopic = paragraph.subtopic.replace(/^\d+\.\d+\s/u, ""); }
  }
  return laid;
}

const unit = (id: string, subject: string, statement: string, extra: Partial<WikiKnowledgeUnit> & { index?: number; code?: { language: string; text: string } } = {}): WikiKnowledgeUnit => ({ id, subject, statement, kind: extra.kind ?? "fact", details: [], ...(extra.facet ? { facet: extra.facet } : {}),
  evidence: { evidenceId: id, conversationId: "c", messageId: `m${id}`, messageIndex: extra.index ?? 0, role: "assistant", pasted: false, quote: statement, ...(extra.code ? { code: extra.code } : {}) }, adoption: { status: "proposal" }, delivery: "unknown" });

function setup() {
  const units = [
    unit("if", "条件判断", "if/elif/else 从上往下判断，遇到第一个 True 即停止。", { index: 44, kind: "mechanism", code: { language: "python", text: "if x > 3:\n    print(x)" } }),
    unit("for", "Python基础语法", "for 循环逐个取出列表元素。", { index: 53, facet: "for循环", kind: "mechanism", code: { language: "python", text: "for v in voltages:\n    print(v)" } }),
    unit("def", "Python基础语法", "def 定义函数，return 返回结果。", { index: 57, facet: "函数定义", kind: "mechanism", code: { language: "python", text: "print(x)" } }),
    unit("edge", "边界条件处理", "在范围判断中需区分 > 与 >=，否则边界值 3 和 10 会被误判。", { index: 47 }),
    unit("loop-check", "for 循环练习", "不看笔记写出 for 循环遍历 voltages 列表并打印每个元素。", { index: 60 }),
    unit("pace", "学习节奏", "每天 1～2 个新知识点加大量复习。", { index: 59, kind: "decision" }),
    unit("done", "掌握状态", "已掌握变量、if/elif/else、for、def、return。", { index: 70 }),
    unit("plan", "路线", "第三周开始筛选 python-control 的 Issue。", { index: 36, kind: "plan" }),
  ];
  const roles = { if: "concept", for: "concept", def: "concept", edge: "mistake", "loop-check": "check", pace: "method", done: "learned", plan: "concept" } as const;
  const subjects = [["S1", ["if", "edge"]], ["S2", ["for", "def", "loop-check", "done"]], ["S3", ["pace"]], ["S4", ["plan"]]] as const;
  const ledger = { version: 1, generatedAt: 1, status: "complete", materials: units.length, documentType: "learning", learningRoles: roles,
    batches: [{ sourceIds: [], signature: "", status: "complete", units, rejected: {} }],
    organization: { version: 1, generatedAt: 1, status: "complete", merged: [], relations: [], subjects: subjects.map(([id, unitIds]) => ({ id, name: id, aliases: [], unitIds: [...unitIds] })),
      chapters: [{ id: "py", title: "Python", question: "", group: "", subtopics: [{ title: "语法", subjectIds: ["S1", "S2", "S3"] }] }, { id: "route", title: "路线", question: "", group: "", subtopics: [{ title: "计划", subjectIds: ["S4"] }] }] } } as unknown as WikiKnowledgeLedger;
  const chapters: WikiDraftChapter[] = [
    { id: "py", title: "Python", question: "", group: "", body: "Python 基础的开场。\n\n### 语法\n\n模型写的段落。", paragraphs: [{ subtopic: "语法", text: "模型写的段落。", unitIds: ["if"] }], problems: ["旧问题"] },
    { id: "route", title: "路线", question: "", group: "", body: "### 计划\n\n第三周开始筛选 Issue。", paragraphs: [{ subtopic: "计划", text: "第三周开始筛选 Issue。", unitIds: ["plan"] }], problems: [] },
  ];
  return { ledger, chapters, units: new Map(units.map(item => [item.id, item])) };
}

describe("learning cards", () => {
  it("lays a skill chapter out as one card per point, with its example, mistake and self-test, and leaves a route chapter as written", () => {
    const { ledger, chapters, units } = setup();
    expect(learningCardChapters(chapters, ledger, units, true)).toBe(1);
    const [python, route] = chapters;
    expect(route.body).toBe("### 计划\n\n第三周开始筛选 Issue。");
    // Each point a heading of its own, in the order taught; the writer's subtopic is gone.
    expect(python.body.startsWith("Python 基础的开场。\n\n### 条件判断\n\nif/elif/else 从上往下判断")).toBe(true);
    expect(python.body).not.toContain("### 语法");
    // A subject telling several points is a card per point, titled by it; a one-line call is no example.
    expect(python.body).toContain("### for循环 · 已会\n\nfor 循环逐个取出列表元素。\n\n*示例*\n\n```python\nfor v in voltages:\n    print(v)\n```\n\n**自测**：不看笔记写出 for 循环");
    // Learned only where a learned point is the card's name: "for" is "for循环"'s, "def" no more than a word of "函数定义".
    expect(python.body).toContain("### 函数定义\n\ndef 定义函数，return 返回结果。");
    expect(python.body).not.toContain("print(x)\n```\n\n### 函数");
    // A mistake sharing too few words with any card is a card of its own, in the order taught; progress is the overview's, how to study a list at the end.
    expect(python.body).toContain("**易错**：在范围判断中需区分 > 与 >=");
    expect(python.body.indexOf("**易错**")).toBeLessThan(python.body.indexOf("### for循环"));
    expect(python.body).not.toContain("已掌握变量");
    // How to study is the overview's list, not the chapter's.
    expect(python.body).not.toContain("学习方法与资源");
    expect(python.paragraphs.find(paragraph => paragraph.text.startsWith("**易错**"))?.claims).toEqual([{ text: "在范围判断中需区分 > 与 >=，否则边界值 3 和 10 会被误判。", unitIds: ["edge"] }]);
    expect(python.problems).toEqual([]);
    for (const paragraph of python.paragraphs) expect(python.body).toContain(paragraph.text);
  });

  it("opens a long skill chapter with its own overview, and leaves a project untouched", () => {
    const { ledger, chapters, units } = setup();
    const extra = Array.from({ length: 4 }, (_, index) => unit(`x${index}`, `知识点${index}`, `第 ${index} 个知识点的说明。`, { index: 80 + index }));
    for (const item of extra) units.set(item.id, item);
    (ledger.organization!.subjects as Array<{ id: string; name: string; aliases: string[]; unitIds: string[] }>).push({ id: "S5", name: "S5", aliases: [], unitIds: extra.map(item => item.id) });
    ledger.organization!.chapters[0].subtopics[0].subjectIds.push("S5");
    Object.assign(ledger.learningRoles!, Object.fromEntries(extra.map(item => [item.id, "concept"])));
    learningCardChapters(chapters, ledger, units, true);
    expect(chapters[0].body).toContain("**本章学习总览**\n\n| 知识点 | 状态 | 易错 / 自测 |\n|---|---|---|\n| 条件判断 | 讲过 | — |\n| 边界条件处理 | 讲过 | 有易错 |\n| for循环 | 已会 | 有自测 |");
    const project = setup();
    expect(learningCardChapters(project.chapters, { ...project.ledger, documentType: "project" }, project.units, true)).toBe(0);
    expect(project.chapters[0].body).toBe("Python 基础的开场。\n\n### 语法\n\n模型写的段落。");
  });
  it("keeps only examples that show their point, shows the learner's code, and takes better titles where given", () => {
    const { ledger, chapters, units } = setup();
    // Lesson 1's "x = 3" under an if lesson it does not use, and a signature over "...": neither is an example.
    units.set("def", { ...units.get("def")!, evidence: { ...units.get("def")!.evidence, code: { language: "python", text: "def ss(A, B, C, D):\n    ..." } } });
    units.set("if", { ...units.get("if")!, evidence: { ...units.get("if")!.evidence, code: { language: "python", text: "x = 3\nx = x + 2\nprint(x)" } } });
    const yours = unit("mine", "for循环", "第三题的问题在这里", { index: 45 });
    units.set("mine", { ...yours, evidence: { ...yours.evidence, learnerCode: true, code: { language: "python", text: "for v in voltages:\n    print(v > 5)" } } });
    (ledger.organization!.subjects[1].unitIds as string[]).push("mine");
    (ledger.learningRoles as Record<string, string>).mine = "exercise";
    learningCardChapters(chapters, ledger, units, true, { titles: new Map([["if", "if / elif / else"]]) });
    const body = chapters[0].body;
    expect(body).not.toContain("x = 3");
    expect(body).not.toContain("def ss");
    expect(body).toContain("### if / elif / else · 已会");
    expect(body).toContain("### for循环 · 练过");
    // The bare cue says nothing: where it was sent stands in for it.
    expect(body).toContain("**你写的**（第 46 条消息）\n\n```python\nfor v in voltages:\n    print(v > 5)\n```");
  });

  it("shows the AI's review under the learner's code: what was wrong, then its version", () => {
    const { ledger, chapters, units } = setup();
    const yours = unit("mine", "字典", "第二题有问题。你写的是", { index: 63 });
    units.set("mine", { ...yours, evidence: { ...yours.evidence, learnerCode: true, code: { language: "python", text: "controller = {\"kp\": 2.0}\n\"kp\" = 3.0" },
      review: { said: "字符串不能被赋值，要通过键去改字典里的值。", code: { language: "python", text: "controller[\"kp\"] = 3.0" } } } });
    (ledger.organization!.subjects[1].unitIds as string[]).push("mine");
    (ledger.learningRoles as Record<string, string>).mine = "exercise";
    learningCardChapters(chapters, ledger, units, true);
    expect(chapters[0].body).toContain("### 字典的读取与修改 · 练过\n\n#### 练习 1\n\n**你写的**（第 64 条消息）\n\n```python\ncontroller = {\"kp\": 2.0}\n\"kp\" = 3.0\n```\n\n**AI 批改**：字符串不能被赋值，要通过键去改字典里的值。\n\n*改法*\n\n```python\ncontroller[\"kp\"] = 3.0\n```");
  });

  it("puts the learner's code on the card named for what it practises, not a second card of that name", () => {
    const { ledger, chapters, units } = setup();
    const yours = unit("mine", "函数定义", "顺便说一下，这道函数题你做对了。", { index: 58 });
    units.set("mine", { ...yours, evidence: { ...yours.evidence, learnerCode: true, code: { language: "python", text: "def area(r):\n    return 3.14 * r * r" } } });
    (ledger.organization!.subjects[1].unitIds as string[]).push("mine");
    (ledger.learningRoles as Record<string, string>).mine = "exercise";
    learningCardChapters(chapters, ledger, units, true);
    const body = chapters[0].body;
    expect(body.match(/### 函数定义/gu)).toHaveLength(1);
    // The AI's words before the code it quotes are its review, not what the learner wrote.
    expect(body).toContain("### 函数定义 · 练过\n\ndef 定义函数，return 返回结果。\n\n#### 练习 1\n\n**你写的**（第 59 条消息）\n\n```python\ndef area(r):\n    return 3.14 * r * r\n```\n\n**AI 批改**：顺便说一下，这道函数题你做对了。");
  });

  it("names the skill chapters, which need no writing, and asks the model for titles, keeping the subject names when it fails", async () => {
    const { ledger, units } = setup();
    expect([...learningSkillChapterIds(ledger, units)]).toEqual(["py"]);
    expect(learningSkillChapterIds({ ...ledger, documentType: "project" }, units).size).toBe(0);
    const answering = { generateStructured: vi.fn(async (request: { validate: (value: unknown) => unknown }) => request.validate({ titles: [
      { card: "k1", title: "if / elif / else", question: "多个条件都为 True 时，if/elif/else 执行哪一个？", point: "p1" },
      { card: "k2", title: "一个远远超过十八个字符长度限制的标题会被丢弃掉的", question: "没有问号的问题", point: "p1" },
      // A point the card does not have answers nothing; a question giving its answer away is no question.
      { card: "k3", question: "for 循环怎么用？", point: "p9" },
      { card: "k4", question: "def 定义函数，return 返回结果。对吗？", point: "p1" }] })) };
    const words = await learningCardTitles(ledger, units, { ai: answering as never, locale: "zh-CN", signal: new AbortController().signal });
    expect([...words.titles]).toEqual([["if", "if / elif / else"]]);
    expect([...words.recalls]).toEqual([["if", { question: "多个条件都为 True 时，if/elif/else 执行哪一个？", unitId: "if" }]]);
    const failing = { generateStructured: vi.fn().mockRejectedValue(new Error("network")) };
    expect((await learningCardTitles(ledger, units, { ai: failing, locale: "zh-CN", signal: new AbortController().signal })).titles.size).toBe(0);
  });

  it("puts recall questions under their card, each answered by the card's own point, mistake or review", () => {
    const { ledger, chapters, units } = setup();
    const yours = unit("mine", "函数定义", "第二题有问题。你写的是", { index: 63 });
    units.set("mine", { ...yours, evidence: { ...yours.evidence, learnerCode: true, code: { language: "python", text: "def area(r):\n    print(3.14 * r * r)" },
      review: { said: "函数要用 return 把结果交回去，print 只是打印。", code: { language: "python", text: "def area(r):\n    return 3.14 * r * r" } } } });
    (ledger.organization!.subjects[1].unitIds as string[]).push("mine");
    (ledger.learningRoles as Record<string, string>).mine = "exercise";
    learningCardChapters(chapters, ledger, units, true, { recalls: new Map([["if", { question: "多个条件都为 True 时，执行哪一个？", unitId: "if" }]]) });
    const body = chapters[0].body;
    expect(body).toContain("    print(x)\n```\n\n> **回忆**：多个条件都为 True 时，执行哪一个？\n>\n> if/elif/else 从上往下判断，遇到第一个 True 即停止。\n\n### 边界条件处理");
    expect(body).toContain("**易错**：在范围判断中需区分 > 与 >=，否则边界值 3 和 10 会被误判。\n\n> **回忆**：「边界条件处理」容易错在哪里？\n>\n> 在范围判断中需区分 > 与 >=，否则边界值 3 和 10 会被误判。");
    expect(body).toContain("\n\n> **回忆**：「函数定义」里你写的以 `def area(r):` 开头的代码，哪里要改？\n>\n> 函数要用 return 把结果交回去，print 只是打印。（改法见该卡片）");
    // A review that says nothing alone gets the AI's one-line fix; one hanging on what came before, with no such fix, no question.
    const short = setup(), dict = unit("dict", "函数定义", "你写的是", { index: 64 }), range = unit("range", "边界条件处理", "你写的是", { index: 48 });
    short.units.set("dict", { ...dict, evidence: { ...dict.evidence, learnerCode: true, code: { language: "python", text: "\"kd\" = 0.1" }, review: { said: "这样不行，因为： 只是一个字符串", code: { language: "python", text: "controller[\"kd\"] = 0.1" }, shows: { language: "python", text: "\"kd\"" } } } });
    short.units.set("range", { ...range, evidence: { ...range.evidence, learnerCode: true, code: { language: "python", text: "if voltage > 3 and voltage < 10:" }, review: { said: "而题目要求是“3 到 10 之间”，我之前给的范围实际上是： 所以", code: { language: "python", text: "if voltage >= 3 and voltage <= 10:\n    print(\"Normal\")" } } } });
    (short.ledger.organization!.subjects[1].unitIds as string[]).push("dict", "range");
    Object.assign(short.ledger.learningRoles as Record<string, string>, { dict: "exercise", range: "exercise", edge: "concept" });
    learningCardChapters(short.chapters, short.ledger, short.units, true);
    expect(short.chapters[0].body).toContain("> **回忆**：「函数定义」里你写的 `\"kd\" = 0.1` 哪里要改？\n>\n> 这样不行，改成 `controller[\"kd\"] = 0.1`");
    expect(short.chapters[0].body).toContain("而题目要求是");
    expect(short.chapters[0].body).not.toContain("「边界条件处理」的练习里");
    // What the AI showed that is only the learner's own line again is left out; its fix is still shown.
    expect(short.chapters[0].body).not.toContain("*AI 的说明*\n\n```python\n\"kd\"\n```");
    expect(short.chapters[0].body).toContain("*改法*\n\n```python\ncontroller[\"kd\"] = 0.1\n```");
    // After "完全正确" the AI's code is a pattern it added, not a fix.
    const praised = setup(), good = unit("good", "函数定义", "你写的是", { index: 66 });
    praised.units.set("good", { ...good, evidence: { ...good.evidence, learnerCode: true, code: { language: "python", text: "def f(v):\n    return v" }, review: { said: "完全正确。", code: { language: "python", text: "for item in items:\n    result = f(item)" }, shows: { language: "python", text: "y = ...\nx = ..." } } } });
    (praised.ledger.organization!.subjects[1].unitIds as string[]).push("good");
    Object.assign(praised.ledger.learningRoles as Record<string, string>, { good: "exercise" });
    learningCardChapters(praised.chapters, praised.ledger, praised.units, true);
    expect(praised.chapters[0].body).toContain("*AI 补充的写法*\n\n```python\nfor item in items:");
    expect(praised.chapters[0].body).not.toContain("y = ...");
    // They claim nothing a second time.
    expect(chapters[0].paragraphs.filter(paragraph => paragraph.text.startsWith("> **回忆**")).every(paragraph => !paragraph.unitIds.length && !paragraph.claims?.length)).toBe(true);
    for (const paragraph of chapters[0].paragraphs) expect(body).toContain(paragraph.text);
    // No question and nothing to recall: none.
    const plain = setup();
    (plain.ledger.learningRoles as Record<string, string>).edge = "concept";
    learningCardChapters(plain.chapters, plain.ledger, plain.units, true);
    expect(plain.chapters[0].body).not.toContain("回忆");
  });

  it("folds a card told twice into its first, keeping every point, only when the model says so and they share words", async () => {
    const { ledger, chapters, units } = setup();
    const again = unit("pr", "PR自动更新机制", "for 循环每次从 voltages 列表取出一个元素。", { index: 61, kind: "mechanism" });
    units.set("pr", again);
    (ledger.organization!.subjects as Array<{ id: string; name: string; aliases: string[]; unitIds: string[] }>).push({ id: "S6", name: "S6", aliases: [], unitIds: ["pr"] });
    ledger.organization!.chapters[0].subtopics[0].subjectIds.push("S6");
    (ledger.learningRoles as Record<string, string>).pr = "concept";
    // k1 条件判断, k2 边界条件处理, k3 for循环, k4 函数定义, k5 the repeat.
    const answering = { generateStructured: vi.fn(async (request: { validate: (value: unknown) => unknown }) => request.validate({ titles: [{ card: "k5", same: "k3" }, { card: "k4", same: "k1" }, { card: "k2", same: "k5" }] })) };
    const words = await learningCardTitles(ledger, units, { ai: answering as never, locale: "zh-CN", signal: new AbortController().signal });
    // Unrelated cards, or a "same" pointing at a later card, are not folded.
    expect([...words.same!]).toEqual([["pr", "for"]]);
    learningCardChapters(chapters, ledger, units, true, words);
    const body = chapters[0].body;
    expect(body).not.toContain("PR自动更新机制");
    expect(body).toContain("### for循环 · 已会\n\n- for 循环逐个取出列表元素。\n- for 循环每次从 voltages 列表取出一个元素。");
  });

  it("folds a card told again in a later chapter into the earlier chapter's card", async () => {
    const { ledger, chapters, units } = setup();
    const later = [unit("pr", "for 循环回顾", "for 循环每次从 voltages 列表取出一个元素。", { index: 90, kind: "mechanism" }), unit("w1", "while", "while 在条件为 True 时重复执行。", { index: 91, kind: "mechanism" }), unit("r1", "range", "range(3) 产生 0、1、2。", { index: 92, kind: "mechanism" })];
    for (const item of later) units.set(item.id, item);
    (ledger.organization!.subjects as Array<{ id: string; name: string; aliases: string[]; unitIds: string[] }>).push({ id: "S7", name: "S7", aliases: [], unitIds: later.map(item => item.id) });
    (ledger.organization!.chapters as Array<{ id: string; title: string; question: string; group: string; subtopics: Array<{ title: string; subjectIds: string[] }> }>).push({ id: "py2", title: "Python 2", question: "", group: "", subtopics: [{ title: "循环", subjectIds: ["S7"] }] });
    Object.assign(ledger.learningRoles!, { pr: "concept", w1: "concept", r1: "concept" });
    chapters.push({ id: "py2", title: "Python 2", question: "", group: "", body: "", paragraphs: [], problems: [] });
    // k1 条件判断, k2 边界条件处理, k3 for循环, k4 函数定义, then the second chapter: k5 for 循环回顾.
    const answering = { generateStructured: vi.fn(async (request: { validate: (value: unknown) => unknown }) => request.validate({ titles: [{ card: "k5", same: "k3" }] })) };
    const words = await learningCardTitles(ledger, units, { ai: answering as never, locale: "zh-CN", signal: new AbortController().signal });
    expect([...words.same!]).toEqual([["pr", "for"]]);
    learningCardChapters(chapters, ledger, units, true, words);
    expect(chapters[0].body).toContain("- for 循环逐个取出列表元素。\n- for 循环每次从 voltages 列表取出一个元素。");
    expect(chapters[2].body).not.toContain("for 循环回顾");
    expect(chapters[2].body).toContain("### while");
  });

  it("leaves a planning chapter to the overview, puts what is still to learn last, names a lesson by what it taught, and keeps a chapter's recall questions few", () => {
    const { ledger, chapters, units } = setup();
    const roles = ledger.learningRoles as Record<string, string>;
    const added = [unit("np", "NumPy", "NumPy 的 shape 给出数组每一维的长度。", { index: 10, kind: "mechanism" }), unit("l1", "第1课内容", "学习print、变量、数字(int/float)及基本运算。", { index: 40 }),
      ...Array.from({ length: 8 }, (_, index) => unit(`x${index}`, `知识点${index}`, `第 ${index} 个知识点的说明。`, { index: 80 + index }))];
    for (const item of added) { units.set(item.id, item); roles[item.id] = "concept"; }
    (ledger.organization!.subjects[0].unitIds as string[]).push(...added.map(item => item.id));
    const want = unit("want", "计划", "还要学习 NumPy、class 和 pytest。", { index: 71 });
    units.set("want", want); (ledger.organization!.subjects[3].unitIds as string[]).push("want");
    // The learning map reads the ledger's own units.
    (ledger.batches[0].units as WikiKnowledgeUnit[]).push(...added, want);
    Object.assign(roles, { plan: "todo", want: "todo" });
    const recalls = new Map([...["if", "for", "def", "np", "l1"], ...added.slice(2).map(item => item.id)].map(id => [id, { question: `${id} 为什么这样写？`, unitId: id }]));
    learningCardChapters(chapters, ledger, units, true, { recalls });
    // The route chapter, all plans, is left empty: the document leaves it out.
    expect(chapters[1]).toMatchObject({ body: "", paragraphs: [], leftOut: "plan" });
    // Left out on purpose, it is not counted as a chapter whose writing was lost.
    expect(wikiDraftCompleteness({ ...ledger, draft: { version: 1, generatedAt: 1, status: "complete", chapters, report: {} } })).toEqual({ planned: 1, written: 1, missing: [] });
    const body = chapters[0].body;
    expect(body).toContain("### NumPy · 待学");
    expect(body.lastIndexOf("\n### ")).toBe(body.indexOf("\n### NumPy · 待学"));
    expect(body).toContain("### print、变量、数字\n");
    // Eight questions at most, the mistake's first.
    expect(body.match(/> \*\*回忆\*\*/gu)).toHaveLength(8);
    expect(body).toContain("「边界条件处理」容易错在哪里？");
  });

  it("shows the task an exercise answers, asks it again by its task, and counts a practised card found right as learned", () => {
    const { ledger, chapters, units } = setup();
    const roles = ledger.learningRoles as Record<string, string>;
    const wrong = unit("wrong", "边界条件处理", "你写的是", { index: 48 }), right = unit("right", "for循环", "第一题", { index: 55 });
    units.set("wrong", { ...wrong, evidence: { ...wrong.evidence, learnerCode: true, code: { language: "python", text: "if voltage > 3 and voltage < 10:" },
      task: { said: "如果电压在 3 到 10 之间，输出 `Normal voltage`；否则输出 `Abnormal voltage`。", code: { language: "python", text: "voltage = 7" } },
      review: { said: "边界要包含 3 和 10。", code: { language: "python", text: "if 3 <= voltage <= 10:" } } } });
    units.set("right", { ...right, evidence: { ...right.evidence, learnerCode: true, code: { language: "python", text: "for v in voltages:\n    print(v)" }, review: { said: "完全正确。" } } });
    (ledger.organization!.subjects[0].unitIds as string[]).push("wrong");
    (ledger.organization!.subjects[1].unitIds as string[]).push("right");
    Object.assign(roles, { wrong: "exercise", right: "exercise", edge: "concept" });
    learningCardChapters(chapters, ledger, units, true);
    const body = chapters[0].body;
    expect(body).toContain("**题目**：如果电压在 3 到 10 之间，输出 `Normal voltage`；否则输出 `Abnormal voltage`。\n\n*题目给的数据*\n\n```python\nvoltage = 7\n```\n\n**你写的**");
    expect(body).toContain("> **回忆**：做「如果电压在 3 到 10 之间，输出 Normal voltage；否则输出 A…」这道题时，你的代码哪里要改？\n>\n> 边界要包含 3 和 10，改成 `if 3 <= voltage <= 10:`");
    expect(body).toContain("### for循环 · 已会");
    expect(body).toMatch(/### 边界条件处理 · 练过/u);
    // The learner's code a point carried as its example is shown as theirs, not as the AI's example.
    const again = setup(), mine = unit("mine", "for循环", "第一题", { index: 55 }), code = { language: "python", text: "for v in voltages:\n    print(v)" };
    again.units.set("mine", { ...mine, evidence: { ...mine.evidence, learnerCode: true, code, review: { said: "完全正确。", shows: { language: "python", text: "voltages" } } } });
    (again.ledger.organization!.subjects[1].unitIds as string[]).push("mine");
    (again.ledger.learningRoles as Record<string, string>).mine = "exercise";
    learningCardChapters(again.chapters, again.ledger, again.units, true);
    expect(again.chapters[0].body).not.toContain("*示例*\n\n```python\nfor v in voltages:");
    expect(again.chapters[0].body).toContain("**你写的**（第 56 条消息）\n\n```python\nfor v in voltages:\n    print(v)\n```");
    // One bare name the AI pointed at says nothing alone.
    expect(again.chapters[0].body).not.toContain("*AI 的说明*");
  });

  it("keeps the AI's review up to where its words led into code that is no longer beside them", () => {
    expect(reviewSaid("完全正确。 这里尤其要确认你理解： 不是数学里的“左右相等”，而是： 所以最终输出：")).toBe("完全正确。");
    expect(reviewSaid("也是完全正确，结果： y=13")).toBe("也是完全正确");
    expect(reviewSaid("这样不行，因为： 只是一个字符串")).toBe("这样不行");
    expect(reviewSaid("我原来的要求是：")).toBe("");
    expect(reviewSaid("**完全正确。** 这里尤其要确认你理解： 不是")).toBe("**完全正确。**");
    expect(reviewSaid("这里你已经掌握了几个关键点：`sensors` 是一个列表；最后打印。 你的输出大概会是： 其他")).toBe("这里你已经掌握了几个关键点：`sensors` 是一个列表；最后打印。");
    expect(reviewSaid("字符串不能被赋值，要通过键去改字典里的值。")).toBe("字符串不能被赋值，要通过键去改字典里的值。");
  });

  it("lays a card with a mistake out as its chain: the mistake, the learner's code, the AI's fix, then the self-test", () => {
    const { ledger, chapters, units } = setup();
    const yours = unit("mine", "边界条件处理", "第三题的问题在这里", { index: 48 });
    units.set("mine", { ...yours, evidence: { ...yours.evidence, learnerCode: true, code: { language: "python", text: "if v > 3:\n    print(\"Normal\")" },
      review: { said: "边界值 3 也应算正常。", code: { language: "python", text: "if v >= 3:\n    print(\"Normal\")" } } } });
    (ledger.organization!.subjects[0].unitIds as string[]).push("mine");
    (ledger.learningRoles as Record<string, string>).mine = "exercise";
    learningCardChapters(chapters, ledger, units, true);
    const body = chapters[0].body, at = (text: string) => body.indexOf(text);
    expect(at("**易错**：在范围判断")).toBeGreaterThan(-1);
    expect(at("**易错**：在范围判断")).toBeLessThan(at("**你写的**（第 49 条消息）"));
    expect(at("**你写的**（第 49 条消息）")).toBeLessThan(at("**AI 批改**：边界值 3 也应算正常。"));
    expect(at("**AI 批改**")).toBeLessThan(at("*改法*"));
  });

  it("numbers each card by its chapter, in its heading and the chapter's overview table", () => {
    const { ledger, chapters, units } = setup();
    numberedCardChapters(chapters, ledger, units, true);
    const body = chapters[0].body, headings = [...body.matchAll(/^### (.+)$/gmu)].map(match => match[1]);
    expect(headings.slice(0, 3)).toEqual(["1.1 条件判断", "1.2 边界条件处理", "1.3 for循环 · 已会"]);
    expect(chapters[0].paragraphs[0].subtopic).toBe("1.1 条件判断");
  });
  it("puts each exercise on the card for what its code practises, folds one workflow told twice, and says a lesson's scope once", () => {
    const { ledger, chapters, units } = setup();
    const roles = ledger.learningRoles as Record<string, string>;
    const add = (item: WikiKnowledgeUnit, role: string) => { units.set(item.id, item); roles[item.id] = role; return item.id; };
    const code = (id: string, subject: string, statement: string, index: number, text: string, review: NonNullable<WikiKnowledgeUnit["evidence"]["review"]>) => {
      const made = unit(id, subject, statement, { index });
      return { ...made, evidence: { ...made.evidence, learnerCode: true, code: { language: "python", text }, review } } as WikiKnowledgeUnit;
    };
    const ids = [
      add(unit("bool", "布尔运算", "and 要求两个条件都为真，or 只要一个为真。", { index: 46, kind: "mechanism" }), "concept"),
      add(unit("flowA", "贡献流程", "标准流程为：Fork -> Clone -> 创建 Branch -> 修改 -> Commit -> Push -> Pull Request。", { index: 20, kind: "mechanism" }), "concept"),
      add(unit("flowB", "Branch加PR", "核心操作为：git switch -c 创建分支 -> 修改 -> git add/commit -> git push -> Compare & pull request -> Create Pull Request。", { index: 25, kind: "mechanism" }), "concept"),
      add(unit("scope", "学习范围", "仅优先掌握函数、条件循环、常用容器这3类知识。", { index: 40 }), "concept"),
      add(code("andx", "条件判断", "第一题", 48, "if age >= 18 and has_ticket:\n    print(\"You cannot enter\")", { said: "这里你甚至用了一个很好的写法： 你的写法更自然。", shows: { language: "python", text: "and has_ticket" } }), "exercise"),
      add(code("idx", "Python 练习", "你写的是", 52, "voltage[1] = 4.8", { said: "第二题有一个小拼写错误：", code: { language: "python", text: "voltages[1] = 4.8" }, shows: { language: "python", text: "print(f\"{temp} Hot\")" } }), "exercise"),
    ];
    ledger.organization!.subjects.push({ id: "S5", name: "S5", aliases: [], unitIds: ids } as never);
    (ledger.organization!.chapters[0].subtopics[0].subjectIds as string[]).push("S5");
    learningCardChapters(chapters, ledger, units, true);
    const body = chapters[0].body, headings = [...body.matchAll(/^### (.+)$/gmu)].map(match => match[1]);
    // The and / or exercise is the boolean card's, not the condition card's it was read under.
    const card = (title: string) => body.slice(body.indexOf(`### ${title}`)).split(/\n### /u)[0];
    expect(card("布尔运算")).toContain("has_ticket");
    expect(card("条件判断")).not.toContain("has_ticket");
    // A card of exercises alone is named for what they practise.
    expect(headings).toContain("列表索引与修改 · 练过");
    // One workflow, one card.
    expect(headings.filter(title => /贡献流程|Branch加PR/u.test(title))).toEqual(["贡献流程"]);
    expect(card("贡献流程")).toContain("核心操作为：git switch -c");
    // What the lesson covers is the chapter's scope, before its cards, and no card or recall question.
    expect(body).toContain("**本章学习范围**：仅优先掌握函数、条件循环、常用容器这3类知识。");
    expect(headings.some(title => title.includes("学习范围"))).toBe(false);
    // A review pointing at a line says it with the line; code the AI showed about something else is left out.
    expect(card("布尔运算")).toContain("**AI 批改**：这里你甚至用了一个很好的写法：`and has_ticket`。");
    expect(body).not.toContain("{temp} Hot");
  });
});
