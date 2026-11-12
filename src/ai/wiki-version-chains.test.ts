import { expect, it } from "vitest";
import type { StructuredAIRequest } from "./provider";
import type { WikiDraftChapter, WikiKnowledgeLedger, WikiKnowledgeOrganization, WikiKnowledgeUnit, WikiTopicChain } from "../shared/wiki-knowledge";
import { chapterInvariants, draftInvariants, invariantCorrection, partTold, unitParts } from "./wiki-draft-invariants";
import { checkedTopic, topicCandidates, wikiTopicChains, wikiUnitVersion } from "./wiki-topic-chains";
import { checkedChapterFit } from "./wiki-chapter-fit";
import { declinedNamed, fittingSlot, numberMismatch } from "./wiki-knowledge-write";
import { wikiUnitStatuses } from "./wiki-knowledge-state";
import { wikiDecisionQuestions } from "./wiki-key-decisions";
import { differingPlans } from "../shared/wiki-differing-plans";
import { wikiDecidedTopics } from "../shared/wiki-decided-topics";
import { withHolderMarks } from "../shared/wiki-holder";
import { currentCaptions } from "../shared/wiki-source-code";

const unit = (id: string, statement: string, options: { role?: "user" | "assistant"; kind?: string; subject?: string; adoption?: string; at?: number } = {}): WikiKnowledgeUnit => ({
  id, subject: options.subject ?? "首页", statement, kind: options.kind ?? "decision", details: [], adoption: { status: options.adoption ?? (options.role === "user" ? "unknown" : "proposal") }, delivery: "unknown",
  evidence: { evidenceId: `e:${id}`, conversationId: "c", messageId: `m:${id}`, messageIndex: options.at ?? 1, role: options.role ?? "assistant", pasted: false, quote: statement },
}) as unknown as WikiKnowledgeUnit;
const ledgerOf = (units: WikiKnowledgeUnit[], organization: Partial<WikiKnowledgeOrganization>, decisions: WikiKnowledgeLedger["decisions"] = {}) => ({ version: 1, generatedAt: 1, status: "complete", materials: 1, batches: [{ status: "complete", units }], decisions,
  organization: { version: 1, generatedAt: 2, status: "complete", subjects: [], merged: [], relations: [], chapters: [], report: {}, ...organization } }) as unknown as WikiKnowledgeLedger;
const fakeAI = (answer: (request: StructuredAIRequest<unknown>) => unknown) => ({ id: "fake", modelId: "fake", generateStructured: async <T,>(request: StructuredAIRequest<T>) => request.validate!(answer(request as StructuredAIRequest<unknown>)) as T });

it("splits a listed point into its parts and finds the part a chapter left out", () => {
  const plan = "分三版迭代：第一版保留原成长区并适配AI流程；第二版增加Agent动态状态、10分钟守护、60秒复盘、风险报告；第三版加入自动分组、小组任务。";
  expect(unitParts(plan)).toHaveLength(3);
  expect(unitParts("首屏100%为AI Agent驾驶舱。")).toEqual([]);
  expect(partTold("第二版增加Agent动态状态、10分钟守护、60秒复盘、风险报告", "第一版保留原成长区，第三版加入自动分组。")).toBe(false);
  const chapter = { id: "plan", title: "开发规划", question: "", group: "", body: "开发规划分三版迭代：第一版保留原成长区并适配AI流程，第三版加入自动分组与小组任务。", paragraphs: [{ subtopic: "", text: "开发规划分三版迭代：第一版保留原成长区并适配AI流程，第三版加入自动分组与小组任务。", unitIds: ["v"] }], problems: [] } as WikiDraftChapter;
  const issues = chapterInvariants(chapter, { unitOf: id => id === "v" ? unit("v", plan) : undefined, statusOf: () => "confirmed" });
  expect(issues.map(issue => [issue.kind, issue.text.slice(0, 3)])).toEqual([["coverage", "第二版"]]);
  expect(invariantCorrection(issues, { unitOf: () => undefined, statusOf: () => undefined })).toContain("leaves out \"第二版增加");
});

it("finds an earlier version told as now, the user's idea told as a suggestion, a confirmed point written nowhere and one sentence in two chapters", () => {
  const units = new Map([unit("old", "首屏应改为状态询问、动态主按钮和今日风险结构。"), unit("now", "首屏100%为AI Agent驾驶舱。"), unit("mine", "将侧重点从戒色限制转向帮助青少年男性找回自信和自律。", { role: "user", kind: "plan" }), unit("gone", "采用莫兰迪色系。")].map(item => [item.id, item]));
  const topics: WikiTopicChain[] = [{ id: "t", name: "首屏布局", current: ["now"], earlier: ["old"], open: false }];
  const context = { unitOf: (id: string) => units.get(id), statusOf: (id: string) => id === "mine" ? "proposal" as const : id === "gone" ? "confirmed" as const : "proposal" as const, topics };
  const repeated = "低DAU和留存并非因为戒色与AI不贴合，而是通用AI聊天缺乏每日回访理由。";
  const chapters = [
    { id: "ui", title: "界面", question: "", group: "", body: `首屏结构调整为状态询问、动态主按钮和今日风险。\n\n此前首屏曾改为状态询问。\n\n${repeated}`, paragraphs: [{ subtopic: "", text: "首屏结构调整为状态询问、动态主按钮和今日风险。", unitIds: ["old"] }, { subtopic: "", text: "此前首屏曾改为状态询问。", unitIds: ["old"] }], problems: [] },
    { id: "pos", title: "定位", question: "", group: "", body: `早期曾建议将侧重点转向帮助青少年男性找回自信和自律。\n\n${repeated}`, paragraphs: [{ subtopic: "", text: "早期曾建议将侧重点转向帮助青少年男性找回自信和自律。", unitIds: ["mine"] }], problems: [] },
  ] as WikiDraftChapter[];
  const kinds = draftInvariants(chapters, context, ["gone"]).map(issue => issue.kind);
  expect(kinds.sort()).toEqual(["earlier_as_current", "missing", "repeat", "user_as_ai"]);
  expect(invariantCorrection(chapterInvariants(chapters[0], context), context)).toContain("what holds now is \"首屏100%为AI Agent驾驶舱");
});

it("groups points settling one thing across subjects and keeps the user's choice ahead of a later suggestion", () => {
  const units = [unit("a", "首屏100%为AI Agent驾驶舱，原日历、任务等功能下移。", { subject: "首页架构" }), unit("b", "首屏应改为状态询问、动态主按钮和今日风险结构，移除大日历。", { subject: "首屏设计" }), unit("c", "接入虚拟支付前必须核对微信小程序最新规则。", { subject: "支付" }), unit("d", "首屏仅保留问候、Agent判断和一个主行动，其他模块下滑显示。", { subject: "密度" })];
  const groups = topicCandidates(units);
  expect(groups.some(group => ["a", "b"].every(id => group.some(item => item.id === id)))).toBe(true);
  expect(groups.flat().some(item => item.id === "c")).toBe(false);
  const group = new Map([["k1", unit("mine", "首屏只放一个主按钮。", { role: "user", adoption: "user_decision" })], ["k2", unit("ai", "首屏放三个入口。")]]);
  expect(checkedTopic({ name: "首屏", current: ["k2"], earlier: ["k1"], open: false }, group, {}, "t")).toMatchObject({ current: ["k2", "k1"], earlier: [], open: true });
  expect(checkedTopic({ name: "首屏", current: ["k2"], earlier: [], open: false }, group, {}, "t")).toBeUndefined();
});

it("builds version chains from the model's answer, held to each group", async () => {
  const units = [unit("a", "首屏100%为AI Agent驾驶舱，原日历、任务等功能下移。", { at: 9 }), unit("b", "首屏应改为状态询问、动态主按钮和今日风险结构，移除大日历。", { at: 2 })];
  const organization = { subjects: [{ id: "s", name: "首页", aliases: [], unitIds: ["a", "b"] }] } as unknown as WikiKnowledgeOrganization;
  const ai = fakeAI(request => { const sent = JSON.parse(request.prompt as string) as { groups: Array<{ group: string; units: Array<{ id: string; statement: string }> }> }; const group = sent.groups[0]; const latest = group.units.find(item => item.statement.includes("驾驶舱"))!.id; return { topics: [{ group: group.group, name: "首屏布局", current: [latest], earlier: group.units.filter(item => item.id !== latest).map(item => item.id), open: false }, { group: "g9", name: "无", current: ["k1"], earlier: ["k2"] }] }; });
  const report: Record<string, number> = {};
  const topics = await wikiTopicChains({ ...ledgerOf(units, {}).organization!, ...organization }, ledgerOf(units, {}), { ai, locale: "zh-CN", signal: new AbortController().signal }, report);
  expect(topics.map(topic => [topic.name, topic.current, topic.earlier])).toEqual([["首屏布局", ["a"], ["b"]]]);
  expect(report.topics).toBe(1);
});

it("reads statuses from the chains: earlier holds no longer, open stays open until the user chooses", () => {
  const units = [unit("now", "首屏100%为AI Agent驾驶舱。"), unit("old", "首屏应改为状态询问结构。"), unit("mine", "中间加号按钮直接跳转AI界面。", { role: "user", kind: "plan" }), unit("theirs", "中央按钮改为守护入口。")];
  const topics: WikiTopicChain[] = [{ id: "t1", name: "首屏", current: ["now"], earlier: ["old"], open: false }, { id: "t2", name: "中央按钮", current: ["mine", "theirs"], earlier: [], open: true }];
  const statuses = wikiUnitStatuses(units, { relations: [], topics });
  expect([statuses.get("old"), statuses.get("mine"), statuses.get("theirs")]).toEqual(["history", "open", "open"]);
  const chosen = wikiUnitStatuses(units, { relations: [], topics }, { mine: { verdict: "confirmed", at: 1 } } as unknown as WikiKnowledgeLedger["decisions"]);
  expect([chosen.get("mine"), chosen.get("theirs")]).toEqual(["confirmed", "history"]);
  const version = wikiUnitVersion("old", topics, statuses, id => ({ statement: id === "now" ? "首屏100%为AI Agent驾驶舱。" : "", chapter: "系统架构" }));
  expect(version).toEqual({ topic: "首屏", is: "earlier", holdsNow: [{ statement: "首屏100%为AI Agent驾驶舱。", chapter: "系统架构" }] });
  const notes = differingPlans(units, id => statuses.get(id), true, topics);
  expect(notes[0]).toEqual({ unitIds: ["mine", "theirs"], note: "中央按钮：你提议中间加号按钮直接跳转AI界面；AI 建议中央按钮改为守护入口。" });
});

it("asks every open version chain and every returning suggestion before writing, the ones changing most first", () => {
  const units = [unit("mine", "中间加号按钮直接跳转AI界面。", { role: "user", kind: "plan" }), unit("theirs", "中央按钮改为守护入口。"),
    ...Array.from({ length: 5 }, (_, index) => [unit(`p${index}a`, `第${index}个建议：采用方案${"甲乙丙丁戊"[index]}来处理用户的晚间复盘提醒与数据记录。`, { at: 3 }), unit(`p${index}b`, `第${index}个建议：采用方案${"甲乙丙丁戊"[index]}来处理用户的晚间复盘提醒与数据记录流程。`, { at: 5 })]).flat()];
  const subjects = [{ id: "s1", name: "首页", aliases: [], unitIds: ["mine", "theirs"] }, { id: "s2", name: "复盘", aliases: [], unitIds: units.slice(2).map(item => item.id) }];
  const ledger = ledgerOf(units, { subjects, chapters: [{ id: "c1", title: "界面", question: "", group: "", subtopics: [{ title: "首页", subjectIds: ["s1"] }] }, { id: "c2", title: "旅程", question: "", group: "", subtopics: [{ title: "复盘", subjectIds: ["s2"] }] }] as WikiKnowledgeOrganization["chapters"],
    topics: [{ id: "t", name: "中央按钮", current: ["mine", "theirs"], earlier: [], open: true }] });
  const asked = wikiDecisionQuestions(ledger, true);
  expect(asked.versions.map(question => [question.kind, question.question])).toEqual([["topic", "「中央按钮」现在按哪一个？"]]);
  expect(asked.candidates).toHaveLength(5);
  expect(asked.shown).toBe(5);
});

it("moves a point the chapter check is sure of, and keeps doubts and a chapter emptied at once where they are", async () => {
  const units = [unit("dau", "当前日活稳定在22人。", { kind: "fact" }), unit("color", "采用莫兰迪色系。"), unit("radius", "按钮圆角8px。"), unit("retain", "下一阶段提升次日留存。", { kind: "plan" })];
  const organization = { version: 1, generatedAt: 1, status: "complete", merged: [], relations: [], report: {},
    subjects: [{ id: "v", name: "视觉", aliases: [], unitIds: ["dau", "color", "radius"] }, { id: "g", name: "留存", aliases: [], unitIds: ["retain"] }],
    chapters: [{ id: "ui", title: "界面设计", question: "", group: "", subtopics: [{ title: "视觉风格", subjectIds: ["v"] }] }, { id: "grow", title: "增长运营", question: "", group: "", subtopics: [{ title: "留存提升", subjectIds: ["g"] }] }] } as unknown as WikiKnowledgeOrganization;
  const ai = fakeAI(request => { const sent = JSON.parse(request.prompt as string) as { chapter: string; units: Array<{ id: string; statement: string }> }; return { moves: sent.chapter === "c1" ? [{ unit: sent.units.find(item => item.statement.includes("日活"))!.id, chapter: "c2", subtopic: "留存提升", sure: true }, { unit: sent.units.find(item => item.statement.includes("圆角"))!.id, chapter: "c2", sure: false }] : [] }; });
  const report: Record<string, number> = {};
  const checked = await checkedChapterFit(organization, ledgerOf(units, {}), { ai, locale: "zh-CN", signal: new AbortController().signal }, report);
  expect(checked.subjects.find(subject => subject.id === "g")!.unitIds).toEqual(["retain", "dau"]);
  expect(checked.placementDoubts).toEqual([{ unitId: "radius", from: "界面设计", to: "增长运营" }]);
  const greedy = fakeAI(request => { const sent = JSON.parse(request.prompt as string) as { chapter: string; units: Array<{ id: string }> }; return { moves: sent.chapter === "c1" ? sent.units.map(item => ({ unit: item.id, chapter: "c2", sure: true })) : [] }; });
  const kept = await checkedChapterFit(organization, ledgerOf(units, {}), { ai: greedy, locale: "zh-CN", signal: new AbortController().signal }, {});
  expect(kept.subjects.find(subject => subject.id === "v")!.unitIds).toHaveLength(3);
  expect(kept.placementDoubts).toHaveLength(3);
});

it("reads the chains against the user's latest answers: a turned-down point leaves, a confirmed one holds", () => {
  const topics: WikiTopicChain[] = [
    { id: "t1", name: "首屏", current: ["b"], earlier: ["a", "c"], open: false },
    { id: "t2", name: "小组", current: ["g1"], earlier: ["g2"], open: false },
    { id: "t3", name: "付费", current: ["p1", "p2"], earlier: [], open: true },
  ];
  const decided = wikiDecidedTopics(topics, { a: { verdict: "confirmed", at: 1 }, b: { verdict: "confirmed", at: 1 }, g1: { verdict: "rejected", at: 1 }, g2: { verdict: "rejected", at: 1 }, p2: { verdict: "rejected", at: 1 } });
  expect(decided.map(topic => [topic.name, topic.current, topic.earlier, topic.open])).toEqual([["首屏", ["b", "a"], ["c"], false]]);
  expect(wikiDecidedTopics(decided, {})).toEqual(decided);
});

it("finds a turned-down point told as adopted, a user's one-sentence decision left untold and what holds now told nowhere", () => {
  const units = new Map([
    unit("auto", "用户开始计划后由系统自动分配匿名小组，不再提供手动创建或寻找战友入口。"),
    unit("deep", "决定先深耕戒色单一垂直领域，待核心闭环和留存稳定后再扩展至泛自律工具。", { role: "user", adoption: "user_decision" }),
    unit("now", "将顶部大卡的核心指标从连续戒色天数改为今日状态，保留天数作为次要指标。"),
    unit("old", "顶部坚持数据应避免重复，改为当前连续X天与本月完成Y/Z天。"),
  ].map(item => [item.id, item]));
  const context = { unitOf: (id: string) => units.get(id), statusOf: (id: string) => id === "deep" ? "stated" as const : id === "old" || id === "auto" ? "history" as const : "proposal" as const,
    topics: [{ id: "t", name: "顶部指标", current: ["now"], earlier: ["old"], open: false }], declined: (id: string) => id === "auto", placed: () => ["now", "old", "auto", "deep"] };
  const body = "此前采用系统自动分配匿名小组，不再提供手动创建或寻找战友入口。\n\n建议将戒色作为获客入口，逐步扩展至男性成长。\n\n此前顶部坚持数据改为当前连续X天与本月完成Y/Z天。";
  const chapter = { id: "c", title: "定位", question: "", group: "", body, paragraphs: body.split("\n\n").map((text, at) => ({ subtopic: "", text, unitIds: [["auto"], ["deep"], ["old"]][at] })) } as WikiDraftChapter;
  const issues = chapterInvariants(chapter, context);
  expect(issues.map(issue => [issue.kind, issue.unitIds[0]]).sort()).toEqual([["coverage", "deep"], ["coverage", "now"], ["rejected_as_current", "auto"], ["user_as_ai", "deep"]]);
  expect(invariantCorrection(issues, context)).toContain("你否定了");
  const declinedTold = { ...chapter, body: body.replace("此前采用", "你否定了由") };
  expect(chapterInvariants(declinedTold, context).some(issue => issue.kind === "rejected_as_current")).toBe(false);
});

it("leaves no version note on a point a settled chain holds", () => {
  const wall = unit("wall", "付费墙在第3天展示部分解锁报告后出现，让用户先看到具体结果再面对价格。"), trial = unit("trial", "最终建议先免费开放7天Agent体验，随后销售¥19.9的30天守护计划。");
  const statusOf = () => "proposal";
  expect(differingPlans([wall, trial], statusOf, true).some(item => item.note.startsWith("付费出现的时间"))).toBe(true);
  expect(differingPlans([wall, trial], statusOf, true, [{ id: "t", name: "付费", current: ["trial"], earlier: ["x"], open: false }])).toEqual([]);
});

it("finds a point never turned down told as turned down, keeps a rule beside a change out of its chain and asks a 版本未定 note before writing", () => {
  const units = new Map([unit("auto", "系统自动分配同期小组。"), unit("entry", "群组入口改为展示真实小组进度。")].map(item => [item.id, item]));
  const text = "群组入口改为展示真实小组进度的提议也被否定。";
  const chapter = { id: "c", title: "旅程", question: "", group: "", body: text, paragraphs: [{ subtopic: "", text, unitIds: ["entry"], claims: [{ text, unitIds: ["entry"] }] }] } as WikiDraftChapter;
  const issues = chapterInvariants(chapter, { unitOf: id => units.get(id), statusOf: () => "proposal", declined: id => id === "auto" });
  expect(issues.map(issue => issue.kind)).toEqual(["declined_overstated"]);
  const group = new Map([["k1", unit("rule", "必须严格区分并统一展示当前连续坚持、历史最佳、本月成功天数和累计坚持。", { kind: "constraint" })], ["k2", unit("now", "将顶部大卡的核心指标从连续戒色天数改为今日状态。")], ["k3", unit("old", "顶部大卡的核心指标为连续戒色天数。")]]);
  expect(checkedTopic({ name: "顶部指标", current: ["k2"], earlier: ["k1", "k3"], open: false }, group, {}, "t")).toMatchObject({ current: ["k2"], earlier: ["k3"] });
  expect(checkedTopic({ name: "顶部指标", current: ["k2"], earlier: ["k1"], open: false }, group, {}, "t")).toBeUndefined();
  const notes = [unit("mine", "将首页中间的加号按钮点击后直接跳转至AI界面。", { role: "user", kind: "plan" }), unit("theirs", "中央按钮命名为“守护”，高危时段变橙色。")];
  const ledger = ledgerOf(notes, { subjects: [{ id: "s", name: "首页", aliases: [], unitIds: ["mine", "theirs"] }], chapters: [{ id: "c", title: "界面", question: "", group: "", subtopics: [{ title: "首页", subjectIds: ["s"] }] }] as WikiKnowledgeOrganization["chapters"] });
  const asked = wikiDecisionQuestions(ledger, true).versions;
  expect(asked.map(question => [question.kind, question.options.map(option => option.id)])).toEqual([["topic", ["mine", "theirs"]]]);
  expect(asked[0].question).toContain("现在按哪一个");
});

it("marks a sentence where it is told, not in a table cell sharing its first words, and keeps a block current a current point speaks of", () => {
  const text = "| 指标 | 数值 |\n| --- | --- |\n| 日活 (DAU) | 约30人 |\n\n你提到当前小程序日活（DAU）约40，活跃留存率略高于40%。";
  expect(withHolderMarks(text, [{ text: "你提到当前小程序日活（DAU）约40，活跃留存率略高于40%。", holder: "user" }], true)).toBe(`${text}〔你〕`);
  const code = "页面状态包括：stable、risk、urge、relapse、protecting；适配微信胶囊按钮和底部安全区；组件化、数据驱动。";
  const carrier = (id: string, statement: string) => ({ ...unit(id, statement), evidence: { ...unit(id, statement).evidence, code: { language: "text", text: code } } }) as WikiKnowledgeUnit;
  const now = carrier("now", "交付给Codex时要求组件化、数据驱动，适配微信胶囊按钮和安全区，定义stable、risk、urge页面状态。"), old = carrier("old", "页面状态包括stable、risk、urge、relapse、protecting，适配胶囊按钮，组件化。");
  const body = `*讨论中的原文代码 · 早期版本，已被替换*\n\n\`\`\`text\n${code}\n\`\`\``;
  expect(currentCaptions(body, [now, old], id => id === "old" ? "history" : "proposal")).toContain("AI 建议");
});

it("refuses an opening whose figure the chapter gives otherwise, and writes a left-out point under the subtopic saying most of it", () => {
  expect(numberMismatch("在日活稳定突破40人前，暂不开发大型新方向。", "在达到日活稳定超过100、7日留存比较稳定前，暂时不做大型新方向。")).toMatchObject({ said: "40", chapter: "100" });
  expect(numberMismatch("算法组7日留存≥35%。", "算法组目标为7日留存≥35%，30日留存≥20%。")).toBeUndefined();
  expect(numberMismatch("急救用时60秒。", "```text\n进入10分钟守护\n```")).toBeUndefined();
  const point = (n: number, subject: string, statement: string): WikiKnowledgeUnit => ({ id: `u${n}`, subject, statement, kind: "plan", details: [], evidence: { evidenceId: `e${n}`, conversationId: "c", messageId: `m${n}`, messageIndex: n, role: "assistant", pasted: false, quote: statement } } as unknown as WikiKnowledgeUnit);
  const price = point(1, "定价方案", "建议推出7天体验、30天AI守护计划（¥19.9）、90天计划（¥49.9），避免永久买断。");
  const part = [
    { title: "商业模式设计", units: [point(2, "商业化定价策略", "先免费开放7天体验，随后销售¥19.9的30天守护计划，再推出季度版。"), point(3, "商业模式", "初期采用30天AI守护计划付费模式，暂不做永久买断。")] },
    { title: "合规安全边界", units: [price, point(4, "合规约束", "必须严格遵守个人信息保护法。"), point(5, "隐私", "敏感记录需加密存储。")] },
  ];
  expect(fittingSlot(price, part)).toBe("商业模式设计");
  expect(fittingSlot(part[1].units[1], part)).toBe("合规安全边界");
});

it("refuses an opening naming a plan the user turned down, and asks nothing of a button the AI took up the user's idea for", () => {
  const groups = unit("groups", "系统自动分配匿名小组，每组六到十人。"), light = unit("light", "小组仅支持固定轻互动动作，避免复杂聊天。");
  expect(declinedNamed("社群互助依赖系统自动分配匿名小组及固定轻互动动作。", [groups], [light])).toBe(groups.statement);
  expect(declinedNamed("社群互助仅支持固定轻互动动作。", [groups], [light])).toBeUndefined();
  const named = unit("named", "中央按钮改为“守护”入口。", { at: 2 }), mine = unit("mine", "中间加号按钮直接跳转AI界面。", { role: "user", at: 3 });
  const asked = differingPlans([named, mine], () => undefined, true);
  expect(asked.map(item => item.unitIds)).toEqual([["mine", "named"]]);
  const taken = unit("taken", "采纳中间按钮跳转AI的方向，但禁止AI自由发挥聊天。", { at: 4 });
  expect(differingPlans([named, mine, taken], () => undefined, true).some(item => item.unitIds.includes("mine"))).toBe(false);
});
