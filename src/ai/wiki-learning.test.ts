import { describe, expect, it, vi } from "vitest";
import type { WikiKnowledgeLedger, WikiKnowledgeOrganization, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { detectDocumentType, heuristicLearningRole, learningChapterOrder, learningRoles, learningUnitsOwn } from "./wiki-learning";
import { wikiLedgerUnits } from "../shared/wiki-knowledge";
import { learningOverview } from "../shared/wiki-learning-overview";
import { wikiHolderLegend } from "../shared/wiki-holder";

const unit = (id: string, statement: string, extra: { index?: number; role?: "user" | "assistant"; quote?: string; kind?: WikiKnowledgeUnit["kind"] } = {}): WikiKnowledgeUnit => ({ id, subject: "s", statement, kind: extra.kind ?? "fact", details: [],
  evidence: { evidenceId: id, conversationId: "c", messageId: `m${id}`, messageIndex: extra.index ?? 0, role: extra.role ?? "assistant", pasted: false, quote: extra.quote ?? statement }, adoption: { status: "proposal" }, delivery: "unknown" });
const ledger = (units: WikiKnowledgeUnit[], extra: Partial<WikiKnowledgeLedger> = {}): WikiKnowledgeLedger => ({ version: 1, generatedAt: 1, status: "complete", materials: units.length, batches: [{ sourceIds: [], signature: "", status: "complete", units, rejected: {} } as unknown as WikiKnowledgeLedger["batches"][number]], ...extra });

describe("document type", () => {
  it("reads a course as learning and a product discussion as a project", () => {
    const course = Array.from({ length: 10 }, (_, index) => unit(`c${index}`, index % 2 ? `第 ${index} 课：练习 if 判断，掌握缩进规则。` : `append 用于添加单个元素，复习时先做 10 分钟小题。`));
    const product = Array.from({ length: 10 }, (_, index) => unit(`p${index}`, index % 2 ? "第一版只做专注计时功能，不做账号系统。" : "设置页面提供学习时长统计，按钮放在弹窗底部。"));
    expect(detectDocumentType(course)).toBe("learning");
    expect(detectDocumentType(product)).toBe("project");
    // Too little to tell keeps the project layout.
    expect(detectDocumentType(course.slice(0, 4))).toBe("project");
  });
});

describe("learning roles", () => {
  it("tells progress, mistakes and the user's own code by their words", () => {
    expect(heuristicLearningRole(unit("a", "暂时不学习 lambda、装饰器、生成器和异步编程。"))).toBe("skip");
    expect(heuristicLearningRole(unit("b", "尚未学习 NumPy、tuple、class 和 pytest，将在后续按需补充。"))).toBe("todo");
    expect(heuristicLearningRole(unit("c", "已掌握变量、if/elif/else、list、for、def，足以进入 NumPy 学习。"))).toBe("learned");
    expect(heuristicLearningRole(unit("d", "在范围判断中需区分 > 与 >=，否则边界值 3 和 10 会被误判。"))).toBe("mistake");
    expect(heuristicLearningRole(unit("e", "用 for 循环检查电压列表。", { role: "user", quote: "for v in voltages:\n    if v > 10:\n        print(v)" }))).toBe("exercise");
    expect(heuristicLearningRole(unit("f", "达到 8 项中的 7 项即算通过第一周验收。"))).toBe("check");
    // "易错点" among what a study note holds is how to study, not a mistake: it carried 〔已纠正〕 onto the Notion advice.
    expect(heuristicLearningRole(unit("g", "避免抄写课本定义，应记录具体学会的技能、易错点、个人理解、练习内容及明日计划。"))).toBe("method");
    expect(heuristicLearningRole(unit("h", "易错点是把 = 当成 ==。"))).toBe("mistake");
  });

  it("keeps the heuristic role when the model fails, and the user's code as their exercise", async () => {
    const units = [unit("a", "暂时不学习 lambda。"), unit("b", "列表用 append 添加元素。", { role: "user", quote: "scores.append(90)\nprint(scores)" })];
    const failing = { generateStructured: vi.fn().mockRejectedValue(new Error("network")) };
    expect(await learningRoles(ledger(units), { ai: failing, locale: "zh-CN", signal: new AbortController().signal })).toEqual({ a: "skip", b: "exercise" });
    const answering = { generateStructured: vi.fn(async (request: { validate: (value: unknown) => unknown }) => request.validate({ roles: [{ unit: "p1", role: "todo" }, { unit: "p2", role: "example" }] })) };
    expect(await learningRoles(ledger(units), { ai: answering as never, locale: "zh-CN", signal: new AbortController().signal })).toEqual({ a: "skip", b: "exercise" });
  });

  it("never takes the learner's question as what they learned or how they study", async () => {
    const units = [unit("q", "向列表添加多个元素时，可使用 extend。", { role: "user", quote: "如果我想加两个元素有没有方便的写法" }), unit("m", "用户询问更好的学习方法。", { role: "user", quote: "这个教程抓不住重点你有什么好的学习方法吗" }), unit("t", "已掌握 if 和 for。", { role: "user", quote: "if 和 for 我都会了" })];
    const answering = { generateStructured: vi.fn(async (request: { validate: (value: unknown) => unknown }) => request.validate({ roles: [{ unit: "p1", role: "learned" }, { unit: "p2", role: "method" }, { unit: "p3", role: "learned" }] })) };
    expect(await learningRoles(ledger(units), { ai: answering as never, locale: "zh-CN", signal: new AbortController().signal })).toEqual({ q: "concept", m: "concept", t: "learned" });
  });
});

describe("learning order", () => {
  it("puts chapters and their parts in the order they were learned", () => {
    const units = [unit("git", "Git 分支", { index: 2 }), unit("py", "if 判断", { index: 40 }), unit("np", "NumPy 数组", { index: 70 }), unit("py2", "for 循环", { index: 50 })];
    const organization = { version: 1, generatedAt: 1, status: "complete", merged: [], relations: [],
      subjects: [{ id: "S1", name: "NumPy", aliases: [], unitIds: ["np"] }, { id: "S2", name: "Git", aliases: [], unitIds: ["git"] }, { id: "S3", name: "循环", aliases: [], unitIds: ["py2"] }, { id: "S4", name: "判断", aliases: [], unitIds: ["py"] }],
      chapters: [{ id: "c1", title: "NumPy", question: "", group: "", subtopics: [{ title: "数组", subjectIds: ["S1"] }] }, { id: "c2", title: "Python", question: "", group: "", subtopics: [{ title: "循环", subjectIds: ["S3"] }, { title: "判断", subjectIds: ["S4"] }] }, { id: "c3", title: "Git", question: "", group: "", subtopics: [{ title: "分支", subjectIds: ["S2"] }] }] } as unknown as WikiKnowledgeOrganization;
    const ordered = learningChapterOrder(organization, units);
    expect(ordered.chapters.map(chapter => chapter.title)).toEqual(["Git", "Python", "NumPy"]);
    expect(ordered.chapters[1].subtopics.map(topic => topic.title)).toEqual(["判断", "循环"]);
  });
});

describe("learning overview", () => {
  it("lists where the learner stands, with the basis of what is learned, and nothing for a project", () => {
    const units = [unit("g", "学习目标是读懂 python-control 源码并完成第一个 PR。", { kind: "plan" }), unit("l", "已掌握变量、list、for、def。", { index: 70 }), unit("t", "尚未学习 NumPy 和 class。", { index: 74 }), unit("s", "暂时不学习 lambda、装饰器。", { index: 70 }), unit("m", "注意区分赋值 = 与比较 ==。", { index: 74 })];
    const roles = { g: "goal", l: "learned", t: "todo", s: "skip", m: "mistake" } as const;
    const standing = learningOverview(ledger(units, { documentType: "learning", learningRoles: roles }))!;
    expect(standing.goal.map(item => item.text)).toEqual(["学习目标是读懂 python-control 源码并完成第一个 PR。"]);
    expect(standing.learned).toEqual([{ text: "已掌握变量、list、for、def。", unitId: "l", by: "ai", points: ["变量", "list", "for", "def"], status: "learned", conversationId: "c", messageIndex: 70 }]);
    expect(standing.todo.map(item => item.unitId)).toEqual(["t"]);
    expect(standing.skip.map(item => item.unitId)).toEqual(["s"]);
    expect(standing.mistakes.map(item => item.unitId)).toEqual(["m"]);
    expect(learningOverview(ledger(units, { learningRoles: roles }))).toBeUndefined();
  });

  it("lists each point once under its latest standing, so a point learned is no longer still to learn", () => {
    const units = [
      unit("t1", "需按优先级陆续学习 range、in、tuple、class 和 pytest。", { index: 60 }),
      unit("l", "已掌握变量、list、for、def、return，足以进入 NumPy 学习。", { index: 70 }),
      // The AI's model of a learning note ("今天学会：def …") tells what was learned that day, not what is still to learn.
      { ...unit("r", "需掌握 def 定义函数、参数传递、return 返回值。", { index: 72 }), evidence: { ...unit("r", "").evidence, messageIndex: 72, quote: "你应该写成：", code: { language: "text", text: "今天学会：\n- def 定义函数\n- 参数传递" } } },
      unit("n", "明天先复习，随后开始 NumPy 的 array 和 shape。", { index: 73 }),
      unit("t2", "尚未学习 tuple、class、pytest 和 for 循环嵌套。", { index: 74 }),
      unit("s", "暂时不学习 lambda、装饰器和 list 推导式。", { index: 74 }),
    ];
    const roles = { t1: "todo", l: "learned", r: "todo", n: "todo", t2: "todo", s: "skip" } as const;
    const standing = learningOverview(ledger(units, { documentType: "learning", learningRoles: roles }))!;
    expect(standing.learned.map(item => item.points)).toEqual([["变量", "list", "for", "def", "return"], ["参数传递"]]);
    expect(standing.next?.unitId).toBe("n");
    // Planned twice: each point where it was planned last; one learned since is gone.
    expect(standing.todo.map(item => [item.status, item.points])).toEqual([["next", ["明天先复习，随后开始 NumPy 的 array 和 shape。"]], ["todo", ["range", "in"]], ["todo", ["tuple", "class", "pytest"]]]);
    expect(standing.map.map(item => item.status)).toEqual(["learned", "learned", "next", "todo", "todo", "skip"]);
    expect(standing.skip[0].points).toEqual(["lambda", "装饰器"]);
    expect(standing.now?.unitId).toBe("r");
  });

  it("explains a learning record's own marks", () => {
    expect(wikiHolderLegend(true, true)).toBe("句末标记说明：〔你〕你写的代码、回答或报告；〔已纠正〕学习中出过的错，附改法；〔此前〕此前的方案，已被后来的取代；没有标记的是 AI 的讲解。");
    expect(wikiHolderLegend(true)).toContain("〔已定〕");
  });
});

describe("what a learning record keeps", () => {
  it("keeps points tagged as about another project as the learner's own", () => {
    const git = { ...unit("g", "第一周跳过复杂 rebase、cherry-pick、bisect。"), about: { name: "GitHub", role: "other_project" as const } };
    expect(wikiLedgerUnits(learningUnitsOwn(ledger([git], { documentType: "learning" })))[0].about).toBeUndefined();
    expect(wikiLedgerUnits(learningUnitsOwn(ledger([git], { documentType: "project" })))[0].about?.name).toBe("GitHub");
  });
});
