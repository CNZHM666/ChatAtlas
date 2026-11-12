import { expect, it } from "vitest";
import { soundQuestion, withSetAsideOffers, withSoundAnswers } from "./wiki-question-parse";
import { withWritingAnswer } from "./wiki-writing-questions";
import { withDecision } from "./wiki-key-decisions";
import { resolveWikiReading } from "./wiki-knowledge-reading";
import { answeredTogether } from "./wiki-user-questions";
import { earlierVersionsLast } from "./wiki-fragments";
import { ledgerDocument } from "./wiki-ledger-document";
import { datedMeasures } from "../shared/wiki-measures";
import { placedSourceCode } from "../shared/wiki-source-code";
import { withoutTableRows } from "../shared/wiki-body-text";
import { leftOutClause } from "../shared/wiki-left-out";
import { unsaidPlanClause, withoutUnsaidPlan } from "../shared/wiki-unsaid-plan";
import { currentCaptions } from "../shared/wiki-source-code";
import { valuesDifferSaid } from "../shared/wiki-values-differ";
import { rowListAsTable } from "../shared/wiki-row-list";
import { aiAdvicePresentation } from "../shared/ai-advice-presentation";
import { withoutMadeRanges } from "../shared/wiki-made-range";
import { decidedAgainstDeclined, differingPlans, lengthAgainstDecided, outgrownCentralBy, outgrownCentralNames } from "../shared/wiki-differing-plans";
import { claimSourceUnits, claimSupported } from "./wiki-claim-support";
import { reportedStatusRows } from "../shared/wiki-section-status";
import type { WikiDraftChapter, WikiKnowledgeLedger, WikiKnowledgeOrganization, WikiKnowledgeUnit, WikiWritingQuestion } from "../shared/wiki-knowledge";

const unit = (n: number, statement: string, extra: Partial<WikiKnowledgeUnit> = {}): WikiKnowledgeUnit => ({ id: `u${n}`, subject: "项目", statement, kind: "plan", details: [], adoption: { status: "proposal" }, delivery: "unknown", evidence: { evidenceId: `e${n}`, conversationId: "c", messageId: `m${n}`, messageIndex: n, role: "assistant", pasted: false, quote: statement }, ...extra });
const ledgerOf = (units: WikiKnowledgeUnit[], extra: Partial<WikiKnowledgeLedger> = {}): WikiKnowledgeLedger => ({ version: 1, generatedAt: 0, status: "complete", materials: 1, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }], ...extra });

const dau = [unit(1, "当前日活仅25，面临推广难。", { kind: "fact" }), unit(2, "小程序目前每天稳定在22人。", { kind: "report" }), unit(3, "当前小程序日活（DAU）约40。", { kind: "fact" })];
const dauQuestion: WikiWritingQuestion = { id: "ask:1:2", about: "当前日活数据", ask: "当前日活是25人、22人还是40人？", unitIds: dau.map(item => item.id), organization: 1,
  options: [{ id: "o1", label: "约25人（近期降至22）", actions: [{ do: "confirm", units: ["u1", "u2"] }, { do: "reject", units: ["u3"] }] }, { id: "o2", label: "约40人", actions: [{ do: "confirm", units: ["u3"] }, { do: "reject", units: ["u1", "u2"] }] }] };

it("asks no user to choose among figures said on different days, and withdraws an answer already given", () => {
  const byId = new Map(dau.map(item => [item.id, item]));
  expect(soundQuestion(dauQuestion, id => byId.get(id)?.statement, undefined, id => byId.get(id))).toBeUndefined();
  // A question between two plans stays.
  const plans = [unit(4, "首页采用左侧布局。", { kind: "decision" }), unit(5, "首页采用混合模式。", { kind: "decision" })], plansById = new Map(plans.map(item => [item.id, item]));
  const choice: WikiWritingQuestion = { ...dauQuestion, id: "ask:1:1", unitIds: ["u4", "u5"], options: [{ id: "o1", label: "左侧", actions: [{ do: "confirm", units: ["u4"] }] }, { id: "o2", label: "混合", actions: [{ do: "confirm", units: ["u5"] }] }] };
  expect(soundQuestion(choice, id => plansById.get(id)?.statement, undefined, id => plansById.get(id))).toBe(choice);
  const answered = ledgerOf(dau, { writingQuestions: [dauQuestion], userAnswers: [{ questionId: dauQuestion.id, unitIds: dauQuestion.unitIds, question: dauQuestion.ask, answer: "约25人（近期降至22）", optionId: "o1", at: 5 }],
    decisions: { u1: { verdict: "confirmed", at: 5 }, u2: { verdict: "confirmed", at: 5 }, u3: { verdict: "rejected", at: 5 } } });
  const read = withSoundAnswers(answered);
  expect(read.userAnswers).toBeUndefined();
  expect(read.decisions).toBeUndefined();
});

it("keeps a confirmed business model separate from the assistant's unchosen pricing and duration", () => {
  const offer = unit(1, "先免费开放7天Agent体验，再销售¥19.9的30天守护计划。", { kind: "decision" });
  const oneOff = unit(2, "免费开放7天Agent体验，随后一次性买断¥19.9的30天守护计划。", { kind: "decision" });
  const question: WikiWritingQuestion = { id: "q", about: "付费模式", ask: "采用订阅制还是一次性买断？", unitIds: [offer.id, oneOff.id], organization: 1,
    options: [{ id: "o1", label: "免费体验＋订阅制", actions: [{ do: "confirm", units: [offer.id] }, { do: "reject", units: [oneOff.id] }] }, { id: "o2", label: "一次性买断", actions: [{ do: "confirm", units: [oneOff.id] }, { do: "reject", units: [offer.id] }] }] };
  const answered = withWritingAnswer(ledgerOf([offer, oneOff], { writingQuestions: [question] }), question, "o1");
  expect(answered.decisions?.[offer.id]).toBeUndefined();
  const reading = resolveWikiReading(answered);
  expect(reading.statuses.get(offer.id)).toBe("proposal");
  expect(reading.statuses.get("answer:q:o1")).toBe("confirmed");
  expect(reading.units.find(point => point.id === "answer:q:o1")?.statement).toBe("付费模式：免费体验＋订阅制。");
  // A later, explicit verdict on this exact offer still holds.
  const atOfChoice = answered.userAnswers![0].at;
  const legacy = withDecision(answered, [offer.id], "confirmed", atOfChoice + 1);
  expect(resolveWikiReading(legacy).statuses.get(offer.id)).toBe("proposal");
  const direct = withDecision(legacy, [offer.id], "confirmed", atOfChoice + 2, [offer.statement]);
  expect(resolveWikiReading(direct).statuses.get(offer.id)).toBe("confirmed");
  expect(resolveWikiReading(direct).statuses.has("answer:q:o1")).toBe(false);
  const completeQuestion = { ...question, options: [{ ...question.options[0], label: offer.statement }, question.options[1]] };
  const complete = withWritingAnswer(ledgerOf([offer, oneOff], { writingQuestions: [completeQuestion] }), completeQuestion, "o1");
  expect(resolveWikiReading(complete).statuses.get(offer.id)).toBe("confirmed");
  // Confirming the broad model again in a different question must not treat
  // the price as a restatement of the newly rejected buyout option.
  const model = unit(3, "付费模式采用免费体验加订阅制。", { kind: "decision" });
  const later: WikiWritingQuestion = { ...question, id: "later", unitIds: [offer.id, oneOff.id, model.id],
    options: [{ id: "subscription", label: "确认采用免费体验加订阅制", actions: [{ do: "confirm", units: [model.id] }, { do: "reject", units: [oneOff.id] }] },
      { id: "buyout", label: "一次性买断", actions: [{ do: "confirm", units: [oneOff.id] }] }] };
  const at = answered.userAnswers![0].at + 100;
  const again = ledgerOf([offer, oneOff, model], { writingQuestions: [question, later],
    userAnswers: [...answered.userAnswers!, { questionId: later.id, unitIds: later.unitIds, question: later.ask, answer: later.options[0].label, optionId: "subscription", at }],
    decisions: { ...answered.decisions, [oneOff.id]: { verdict: "rejected", at }, [model.id]: { verdict: "confirmed", at } } });
  expect(resolveWikiReading(again).statuses.get(offer.id)).toBe("proposal");
  expect(resolveWikiReading(again).statuses.get(oneOff.id)).toBe("history");
});

it("sets aside the suggestions naming the offer an answer turned down", () => {
  const units = [
    unit(1, "主流App多采用买断制，而本项目计划采用基础功能永久免费、高级AI服务订阅的模式。", { kind: "history", evidence: { ...unit(1, "").evidence, role: "user" } }),
    unit(2, "初期采用免费核心功能加一次性“30天AI守护计划”付费模式。", { kind: "decision" }),
    unit(3, "建议推出7天体验、30天AI守护计划（¥19.9）、90天计划。"),
    unit(4, "最终建议先免费开放7天体验，随后销售¥19.9的30天守护计划。"),
    unit(5, "基础打卡、急救永久免费；高级Agent守护收费。"),
  ];
  const question: WikiWritingQuestion = { id: "ask:1:4", about: "商业化付费模式", ask: "初期采用一次性买断制还是订阅制？", unitIds: ["u1", "u2"], organization: 1,
    options: [{ id: "o1", label: "基础免费+高级AI服务订阅", actions: [{ do: "confirm", units: ["u1"] }, { do: "reject", units: ["u2"] }] }, { id: "o2", label: "一次性30天计划", actions: [{ do: "confirm", units: ["u2"] }, { do: "reject", units: ["u1"] }] }] };
  const ledger = ledgerOf(units, { writingQuestions: [question], userAnswers: [{ questionId: question.id, unitIds: question.unitIds, question: question.ask, answer: "基础免费+高级AI服务订阅", optionId: "o1", at: 7 }],
    decisions: { u1: { verdict: "confirmed", at: 7 }, u2: { verdict: "rejected", at: 7 } } });
  const decisions = withSetAsideOffers(ledger).decisions!;
  expect(decisions.u3?.verdict).toBe("rejected");
  expect(decisions.u4?.verdict).toBe("rejected");
  // A suggestion the chosen model keeps is left alone.
  expect(decisions.u5).toBeUndefined();
});

it("keeps an answered question's points together when routing moves one of them", () => {
  const before: WikiKnowledgeOrganization = { version: 1, generatedAt: 0, status: "complete", merged: [], relations: [], report: {},
    subjects: [{ id: "agent", name: "Agent", aliases: [], unitIds: ["u1", "u2", "u3"] }, { id: "home", name: "首页", aliases: [], unitIds: ["u9"] }],
    chapters: [{ id: "a", title: "技术", question: "", group: "", subtopics: [{ title: "AI Agent机制", subjectIds: ["agent"] }] }, { id: "b", title: "界面", question: "", group: "", subtopics: [{ title: "首页架构与布局", subjectIds: ["home"] }] }] };
  const after = { ...before, subjects: [{ ...before.subjects[0], unitIds: ["u2", "u3"] }, { ...before.subjects[1], unitIds: ["u9", "u1"] }] };
  const report: Record<string, number> = {};
  const moved = answeredTogether(before, after, [{ questionId: "q", unitIds: ["u1", "u2", "u3"], question: "首页采用左侧布局还是驾驶舱？", answer: "混合模式", optionId: "o2", at: 1 }], report);
  expect(moved.subjects.find(subject => subject.id === "home")!.unitIds).toEqual(["u9", "u1", "u2", "u3"]);
  expect(moved.subjects.find(subject => subject.id === "agent")!.unitIds).toEqual([]);
  expect(report.answered_moved_together).toBe(2);
});

it("moves a replaced sentence out of a paragraph of current ones, to the earlier versions", () => {
  const text = "首页最终采用左侧布局作为功能结构，借用右侧的简洁感。顶部大卡的核心指标改为“今日状态”，保留天数作为次要指标。";
  const draft: WikiDraftChapter = { id: "ui", title: "界面", question: "", group: "", problems: [], body: `### 首页架构与布局\n\n${text}`,
    paragraphs: [{ subtopic: "首页架构与布局", text, unitIds: ["old", "now"], claims: [{ text: "首页最终采用左侧布局作为功能结构，借用右侧的简洁感。", unitIds: ["old"] }, { text: "顶部大卡的核心指标改为“今日状态”，保留天数作为次要指标。", unitIds: ["now"] }] }] };
  expect(earlierVersionsLast([draft], id => id === "old" ? "history" : "proposal", true)).toBe(1);
  expect(draft.body).toBe("### 首页架构与布局\n\n顶部大卡的核心指标改为“今日状态”，保留天数作为次要指标。\n\n### 早先版本\n\n- 首页最终采用左侧布局作为功能结构，借用右侧的简洁感。");
});

it("leaves out of the document an emptied table, a withdrawn answer's sentence and a row no source gives", () => {
  const units = [unit(1, "当前新增用户留存率为19%，整体留存率为26.92%。", { kind: "fact" }), unit(2, "首页采用混合模式，而非纯聊天界面。", { kind: "decision" })];
  const table = "| 指标 | 当前状态 |\n| --- | --- |\n| 整体留存率 | 26.92% |\n| 稳定用户数 | 22人 |";
  const emptied = "| 阶段 | 首页布局方案 |\n| --- | --- |\n |";
  const body = ["当前日活约25-30人（近期降至22）。", emptied, table, "首页采用混合模式，而非纯聊天界面。"].join("\n\n");
  const ledger = ledgerOf(units, {
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "指标", aliases: [], unitIds: ["u1", "u2"] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "指标", question: "?", group: "", subtopics: [{ title: "指标", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "指标", question: "?", group: "", body, problems: ['row "稳定用户数 | 22人…" has no supported source after final formatting'], paragraphs: [
      { subtopic: "指标", text: "当前日活约25-30人（近期降至22）。", unitIds: ["answer:ask:1:2:o1"], claims: [{ text: "当前日活约25-30人（近期降至22）。", unitIds: ["answer:ask:1:2:o1"] }] },
      { subtopic: "指标", text: emptied, unitIds: ["u2"], claims: [] },
      { subtopic: "指标", text: table, unitIds: ["u1"], claims: [{ text: "26.92%", unitIds: ["u1"] }, { text: "22人", unitIds: ["u1"] }] },
      { subtopic: "指标", text: "首页采用混合模式，而非纯聊天界面。", unitIds: ["u2"], claims: [{ text: "首页采用混合模式，而非纯聊天界面。", unitIds: ["u2"] }] },
    ] }] },
  });
  const [section] = ledgerDocument(ledger, {}).sections;
  expect(section.body).toBe("| 指标 | 当前状态 |\n| --- | --- |\n| 整体留存率 | 26.92% |\n\n首页采用混合模式，而非纯聊天界面。");
  expect(withoutTableRows("| a | b |\n| --- | --- |\n| x | 1 |", cells => cells[0] === "x")).toBe("| a | b |\n| --- | --- |\n| x | 1 |");
});

it("dates a daily count written before its 日活, in a decision telling it as today's", () => {
  const reason = unit(1, "鉴于当前约30日活规模数据稀疏，第一版不训练深度学习模型。", { kind: "decision", evidence: { ...unit(1, "").evidence, conversationSpan: { start: new Date(2026, 5, 15, 12).getTime(), end: new Date(2026, 5, 17, 12).getTime() } } });
  const report = unit(2, "当前日活仅25。", { kind: "fact", evidence: { ...unit(2, "").evidence, conversationSpan: { start: new Date(2026, 5, 6, 12).getTime(), end: new Date(2026, 5, 6, 13).getTime() } } });
  const text = "鉴于当前约30日活规模数据稀疏，第一版不训练深度学习模型。";
  const chapters: WikiDraftChapter[] = [{ id: "a", title: "算法", question: "", group: "", problems: [], body: text, paragraphs: [{ subtopic: "算法", text, unitIds: ["u1"], claims: [] }, { subtopic: "算法", text: "当时日活仅25（6月6日）。", unitIds: ["u2"], claims: [] }] }];
  const byId = new Map([reason, report].map(item => [item.id, item]));
  expect(datedMeasures(chapters, id => byId.get(id), true)).toBe(1);
  expect(chapters[0].paragraphs[0].text).toBe("鉴于当时约30日活（6月15日—6月17日）规模数据稀疏，第一版不训练深度学习模型。");
});

it("puts the day before a bracket telling a later change, and says it came after", () => {
  const span = (day: number) => ({ conversationSpan: { start: new Date(2026, 5, day, 12).getTime(), end: new Date(2026, 5, day, 13).getTime() } });
  const before = unit(1, "日活约30人（近期降至22人）。", { kind: "fact", evidence: { ...unit(1, "").evidence, ...span(14) } });
  const other = unit(2, "日活仅25。", { kind: "fact", evidence: { ...unit(2, "").evidence, ...span(6) } });
  const chapters: WikiDraftChapter[] = [{ id: "a", title: "数据", question: "", group: "", problems: [], body: "日活约30人（近期降至22人）。", paragraphs: [{ subtopic: "数据", text: "日活约30人（近期降至22人）。", unitIds: ["u1"], claims: [] }, { subtopic: "数据", text: "日活仅25（6月6日）。", unitIds: ["u2"], claims: [] }] }];
  const byId = new Map([before, other].map(item => [item.id, item]));
  datedMeasures(chapters, id => byId.get(id), true);
  expect(chapters[0].paragraphs[0].text).toBe("日活约30人（6月14日；其后降至22人）。");
});

it("drops a sentence only naming a structure's fields once the structure stands below it", () => {
  const code = { language: "ts", text: "interface RescueSession {\n  id: string;\n  userId: string;\n  startedAt: number;\n  completedAt?: number;\n  triggerTags: string[];\n  outcome: string;\n}" };
  const fields = unit(1, "数据结构包含id、userId、startedAt/completedAt、triggerTags、outcome。", { kind: "mechanism", evidence: { ...unit(1, "").evidence, code } });
  const lead = unit(2, "急救记录需保存每次会话的结果。", { kind: "mechanism" });
  const chapters: WikiDraftChapter[] = [{ id: "a", title: "技术", question: "", group: "", problems: [], body: "急救记录需保存每次会话的结果。\n\n数据结构包含id、userId、startedAt/completedAt、triggerTags、outcome。",
    paragraphs: [{ subtopic: "技术架构", text: "急救记录需保存每次会话的结果。", unitIds: ["u2"], claims: [] }, { subtopic: "技术架构", text: "数据结构包含id、userId、startedAt/completedAt、triggerTags、outcome。", unitIds: ["u1"], claims: [] }] }];
  const byId = new Map([fields, lead].map(item => [item.id, item]));
  placedSourceCode(chapters, id => byId.get(id), () => "proposal", true, [fields, lead]);
  expect(chapters[0].body).not.toContain("数据结构包含");
  expect(chapters[0].body).toContain("interface RescueSession");
  expect(chapters[0].body.startsWith("急救记录需保存每次会话的结果。")).toBe(true);
});

it("lists under 暂不做 only what a plan leaves out, with its stage", () => {
  expect(leftOutClause("初期采用免费核心功能加一次性“30天AI守护计划”付费模式，暂不做强制会员或周订阅。")).toBe("初期暂不做强制会员或周订阅。");
  expect(leftOutClause("暂不做账号系统。")).toBe("暂不做账号系统。");
});

it("takes out a plan read into the user's question", () => {
  const asked = unit(1, "主流戒色App多采用买断制（评估后付费解锁），而本项目计划采用基础功能永久免费、高级AI服务订阅的模式。", { kind: "history",
    evidence: { ...unit(1, "").evidence, role: "user", quote: "我看现在主流的戒色app是买断制的，就是可以先做评估然后付费解锁，你感觉这种怎么样" } });
  expect(unsaidPlanClause(asked)).toBe("而本项目计划采用基础功能永久免费、高级AI服务订阅的模式");
  expect(withoutUnsaidPlan(asked).statement).toBe("主流戒色App多采用买断制（评估后付费解锁）。");
  // A plan the user did say stays.
  const said = { ...asked, evidence: { ...asked.evidence, quote: "主流是买断制，我们计划采用基础功能永久免费、高级AI服务订阅的模式" } };
  expect(unsaidPlanClause(said)).toBeUndefined();
  // The AI's words are not read this way.
  expect(unsaidPlanClause({ ...asked, evidence: { ...asked.evidence, role: "assistant" } })).toBeUndefined();
});

it("captions a block as replaced only when a replaced point carrying it speaks of it", () => {
  const table = ["| 方向 | 市场空间 | 留存潜力 |", "|---|---:|---:|", "| 纯戒色 | 4 | 4 |", "| 年轻男性成长 | 9 | 8 |"].join("\n");
  const code = { language: "table", text: table };
  const limit = unit(1, "为避免未成年人合规风险，将目标用户定位为18-25岁成年男性。", { evidence: { ...unit(1, "").evidence, code } });
  const market = unit(2, "年轻男性成长方向市场空间大、留存潜力高。", { evidence: { ...unit(2, "").evidence, code } });
  const text = `*对照表 · 早期方案，已被替换*

${table}`;
  const status = (replaced: string[]) => (id: string) => replaced.includes(id) ? "history" : "analysis";
  expect(currentCaptions(text, [limit, market], status(["u1"]))).toBe(`*对照表 · AI 建议*

${table}`);
  expect(currentCaptions(text, [limit, market], status(["u1", "u2"]))).toBe(text);
});

it("lets a sentence say two sources give different values, when each value is a source's", () => {
  const sources = ["破戒后提供30秒结构化复盘。", "破戒后通过60秒快速复盘保留部分修为。"];
  expect(valuesDifferSaid("破戒后的复盘时长有 30 秒和 60 秒两种说法，尚未统一。", sources)).toBe(true);
  expect(valuesDifferSaid("破戒后的复盘时长有 30 秒和 90 秒两种说法，尚未统一。", sources)).toBe(false);
  expect(valuesDifferSaid("破戒后提供30秒复盘，60秒快速复盘。", sources)).toBe(false);
});

it("reads a table kept as a list of its rows as the table again", () => {
  const list = ["- **Quittr**：关键数据或特征: 月收入约50万美元；约10万付费用户。; 备注: 依靠强营销。", "- **Brainbuddy**：关键数据或特征: 50万次以上下载。; 备注: 验证了付费意愿。"].join("\n");
  expect(rowListAsTable(list, true)).toBe(["| 名称 | 关键数据或特征 | 备注 |", "| --- | --- | --- |", "| Quittr | 月收入约50万美元；约10万付费用户。 | 依靠强营销。 |", "| Brainbuddy | 50万次以上下载。 | 验证了付费意愿。 |"].join("\n"));
  // Items naming different columns stay a list.
  const mixed = ["- **A**：甲: 1; 乙: 2", "- **B**：甲: 1; 丙: 2"].join("\n");
  expect(rowListAsTable(mixed, true)).toBe(mixed);
});

it("keeps a product named with a dash when narration says AI for 助手", () => {
  expect(aiAdvicePresentation("| 克己-戒色助手 | 提供打卡。 |\n\n- **克己-戒色助手**：提供打卡。")).toBe("| 克己-戒色助手 | 提供打卡。 |\n\n- **克己-戒色助手**：提供打卡。");
  expect(aiAdvicePresentation("助手认为先整理。")).toBe("AI认为先整理。");
});

it("takes out a range of figures no source gives, and keeps one a source gives", () => {
  const sources = ["小程序目前每天稳定在22人。", "日活停留在32人左右，难以突破40人。"];
  expect(withoutMadeRanges("运营上主打匿名裂变。截至当前，日活稳定在20-30人区间，增长目标为突破40人至100人。", sources)).toBe("运营上主打匿名裂变。增长目标为突破40人至100人。");
  expect(withoutMadeRanges("日活稳定在20-30人区间。", ["日活在20-30人之间。"])).toBe("日活稳定在20-30人区间。");
});

it("reads a user's dated report as theirs", () => {
  const report = unit(1, "小程序目前每天稳定在22人，其中15个为稳定用户。", { kind: "report", evidence: { ...unit(1, "").evidence, role: "user" } });
  expect(claimSupported("小程序当时每天稳定在22人（6月14日—7月7日），其中15个为稳定用户。", [report])).toBe(true);
});

it("shows two renames of one item and the user's idea against the AI's for one control as not settled", () => {
  const units = [
    unit(1, "将“今日任务”升级为“今天只做这一件事”，由AI根据状态推荐1-3个具体行动。", { kind: "decision" }),
    unit(2, "将“今日任务0/7”改为“今日重点0/1”，仅展示一个核心必做任务。", { kind: "decision" }),
    unit(3, "用户提议将首页中间的加号按钮点击后直接跳转至AI界面。", { kind: "fact", evidence: { ...unit(3, "").evidence, role: "user" } }),
    unit(4, "中央按钮命名为“守护”，平时蓝色，高危时段变橙色。", { kind: "mechanism" }),
    unit(5, "首页中间区域由连续天数改为风险值仪表盘，显示“今晚风险：中低”。", { kind: "decision" }),
  ];
  const found = differingPlans(units, id => id === "u3" ? "stated" : "proposal", true);
  expect(found.map(item => item.unitIds)).toEqual([["u1", "u2"], ["u3", "u4"]]);
  expect(found[1].note).toBe("首页中央按钮的用法：你提议将首页中间的加号按钮点击后直接跳转至AI界面；AI 建议中央按钮命名为“守护”，平时蓝色，高危时段变橙色。");
  // A decision chooses between them: nothing is left open.
  expect(differingPlans(units, id => id === "u2" ? "confirmed" : "proposal", true).some(item => item.unitIds.includes("u1"))).toBe(false);
});

it("keeps the user's sentence apart, names coins and the AI, drops a reason no source gives and adds an untold plan", () => {
  const user = (n: number, statement: string, extra: Partial<WikiKnowledgeUnit> = {}) => unit(n, statement, { ...extra, evidence: { ...unit(n, statement).evidence, role: "user" } });
  const units = [
    unit(1, "科学戒色属于窄蓝海，需求真实但获客难。", { kind: "fact" }),
    user(2, "现有竞品仅停留在文章阅读，缺乏科学预测，存在蓝海机会。", { kind: "fact" }),
    user(3, "日活停留在32人左右，累计用户1100人。", { kind: "fact" }),
    unit(4, "挑战营报名费应设计为可返还的押金机制。", { evidence: { ...unit(4, "").evidence, quote: "“支付20金币”也需要说明金币价值，失败是否退还。" } }),
    user(5, "计划将戒色行为转化为算法，结合历史破戒时间和诱因计算高危时段。"),
    unit(6, "风险算法按历史破戒时间加权。"),
    unit(7, "先深耕戒色领域，再扩展到自律工具。"),
  ];
  const market = "科学戒色属于窄蓝海，需求真实但获客难。现有竞品仅停留在文章阅读，缺乏科学预测，存在蓝海机会。";
  const report = "- **当时数据**：小程序每天22人；另有反馈称日活停留在32人左右，累计用户1100人。";
  const table = "| 方向 | 我的评价 |\n| --- | --- |\n| 纯戒色 | **我最看好** |";
  const reason = "先深耕戒色领域，再扩展到自律工具。\n\n这种渐进式路径旨在确保基础功能的稳固性，防止过早分散资源。";
  const paragraphs = [
    { subtopic: "市场", text: market, unitIds: ["u1", "u2"], claims: [{ text: "科学戒色属于窄蓝海，需求真实但获客难。", unitIds: ["u1"] }, { text: "现有竞品仅停留在文章阅读，缺乏科学预测，存在蓝海机会。", unitIds: ["u2"] }] },
    { subtopic: "市场", text: report, unitIds: ["u3"], claims: [{ text: "小程序每天22人；另有反馈称日活停留在32人左右，累计用户1100人。", unitIds: ["u3"] }] },
    { subtopic: "市场", text: table, unitIds: ["u1"], claims: [] },
    { subtopic: "市场", text: "挑战营报名费应设计为可返还的押金机制。", unitIds: ["u4"], claims: [{ text: "挑战营报名费应设计为可返还的押金机制。", unitIds: ["u4"] }] },
    { subtopic: "市场", text: "风险算法按历史破戒时间加权。", unitIds: ["u6"], claims: [{ text: "风险算法按历史破戒时间加权。", unitIds: ["u6"] }] },
    { subtopic: "市场", text: reason, unitIds: ["u7"], claims: [{ text: "先深耕戒色领域，再扩展到自律工具。", unitIds: ["u7"] }] },
  ];
  const ledger = ledgerOf(units, {
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "市场", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "市场", question: "?", group: "", subtopics: [{ title: "市场", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "市场", question: "?", group: "", problems: [], body: paragraphs.map(item => item.text).join("\n\n"), paragraphs }] },
  });
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).toContain("科学戒色属于窄蓝海，需求真实但获客难。\n\n现有竞品仅停留在文章阅读");
  expect(body).toContain("你还提到日活停留在32人左右");
  expect(body).toContain("| 方向 | AI 评价 |");
  expect(body).toContain("**AI 最看好**");
  expect(body).toContain("挑战营报名所需金币应设计为可返还的金币押金机制。");
  expect(body).not.toContain("这种渐进式路径");
  expect(body).toContain("风险算法按历史破戒时间加权。\n\n你计划将戒色行为转化为算法");
});

it("lists every figure the user gave, oldest first, without the 用户反馈 they were read with", () => {
  const day = (month: number, date: number) => ({ start: new Date(2026, month - 1, date, 12).getTime(), end: new Date(2026, month - 1, date, 13).getTime() });
  const said = (n: number, statement: string, month: number, date: number, kind: WikiKnowledgeUnit["kind"] = "fact") => unit(n, statement, { kind, evidence: { ...unit(n, statement).evidence, role: "user", conversationSpan: day(month, date) } });
  const units = [said(1, "当前小程序日活（DAU）约40，付费率较低。", 8, 18), said(2, "小程序目前每天稳定在22人。", 6, 20, "report"), said(3, "用户反馈日活停留在32人左右。", 6, 25), said(4, "希望首页更简洁。", 6, 25)];
  const rows = reportedStatusRows(units, new Set(units.map(item => item.id)), true);
  expect(rows.map(row => row.text)).toEqual(["小程序目前每天稳定在22人。", "日活停留在32人左右。", "小程序日活（DAU）约40，付费率较低。"]);
  expect(rows.every(row => row.status === "measured")).toBe(true);
});

it("lists a report once when another of the same day gives each of its figures after the same word", () => {
  const day = { start: new Date(2026, 2, 3, 12).getTime(), end: new Date(2026, 2, 3, 13).getTime() }, later = { start: new Date(2026, 3, 9, 12).getTime(), end: new Date(2026, 3, 9, 13).getTime() };
  const said = (n: number, statement: string, span = day) => unit(n, statement, { kind: "fact", evidence: { ...unit(n, statement).evidence, role: "user", conversationSpan: span } });
  const units = [said(1, "读书社群日活约60人，留存率35.5%，付费用户8人。"), said(2, "留存率只有35.5%，付费用户8人。"), said(3, "累计用户60人。"), said(4, "留存率35.5%。", later)];
  const rows = reportedStatusRows(units, new Set(units.map(item => item.id)), true).map(row => row.text);
  // The shorter report goes; 60 users in all is no part of 60 a day, and the same rate said another day stays.
  expect(rows).toEqual(["读书社群日活约60人，留存率35.5%，付费用户8人。", "累计用户60人。", "留存率35.5%。"]);
});

it("tells a plan the user turned down as turned down, keeps figures to their sources and dates a figure called current", () => {
  const span = { start: new Date(2026, 5, 14, 12).getTime(), end: new Date(2026, 6, 7, 12).getTime() };
  const said = (n: number, statement: string, quote: string, extra: Partial<WikiKnowledgeUnit> = {}) => unit(n, statement, { kind: "fact", ...extra, evidence: { ...unit(n, statement).evidence, quote, conversationSpan: span, ...extra.evidence } });
  const units = [
    unit(1, "首屏100%为AI Agent驾驶舱，原日历、任务等功能下移。", { kind: "decision" }),
    unit(2, "首页保留左侧布局，Agent作为卡片。", { kind: "decision" }),
    said(3, "日活约30人（近期降至22人），整体留存率26.92%。", "19%是新增用户次日留存，偏低。"),
    said(4, "当前日活稳定在22人，其中15人为核心用户，占比约68%。", "你现在每天稳定22人，15 ÷ 22 ≈ 68%"),
    said(5, "当前新增用户留存率为19%。", "新增用户19%", { evidence: { ...unit(5, "").evidence, role: "user", quote: "新增用户19%", conversationSpan: span } }),
  ];
  const turned = "早期曾提出首屏100%为AI Agent驾驶舱、原日历任务下移的方案，这些已被当前的混合布局取代。";
  const joined = "日活约30人（近期降至22人），其中15人为核心用户，占比约68%。";
  const now = "当前新增用户留存率为19%。";
  const paragraphs = [
    { subtopic: "首页", text: turned, unitIds: ["u1"], claims: [{ text: turned, unitIds: ["u1"] }] },
    { subtopic: "首页", text: joined, unitIds: ["u3", "u4"], claims: [{ text: joined, unitIds: ["u3", "u4"] }] },
    { subtopic: "首页", text: now, unitIds: ["u5"], claims: [{ text: now, unitIds: ["u5"] }] },
  ];
  const ledger = ledgerOf(units, {
    decisions: { u1: { verdict: "rejected", at: 5 }, u2: { verdict: "confirmed", at: 5 } },
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "首页", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "首页", question: "?", group: "", subtopics: [{ title: "首页", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "首页", question: "?", group: "", problems: [], body: paragraphs.map(item => item.text).join("\n\n"), paragraphs }] },
  });
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).toContain("你在回答中否定了「首屏100%为AI Agent驾驶舱，原日历、任务等功能下移」的方案。");
  expect(body).not.toContain("约30人");
  expect(body).toContain("当时日活稳定在22人，其中15人为核心用户，占比约68%（6月14日—7月7日）。");
  expect(body).toContain("当时新增用户留存率为19%（6月14日—7月7日）。");
});

it("leaves open two lengths of one step, two flows from one start and a paywall before the free days end", () => {
  const units = [
    unit(1, "破戒后提供30秒结构化复盘（时间、场景、情绪、诱因）。"),
    unit(2, "破戒后不清零记录，通过60秒快速复盘保留成长记录。"),
    unit(3, "新用户首次进入路径为：选择目标→设置高风险时间→开启挑战。"),
    unit(4, "新用户首次进入需完成“选择目标-高危时间-生成计划-加入小组”闭环。"),
    unit(5, "付费墙在第3天展示部分解锁报告后出现。"),
    unit(6, "先免费开放7天Agent体验，随后销售30天守护计划。"),
  ];
  const notes = differingPlans(units, () => "proposal", true).map(item => item.unitIds.join(","));
  expect(notes).toEqual(["u1,u2", "u3,u4", "u5,u6"]);
});

it("reads rows that give only some of the table's fields as rows of it", () => {
  const list = ["- **Quittr**：关键数据: 月收入约50万美元; 备注: 依靠强营销", "- **Brainbuddy**：关键数据: 50万次以上下载; 备注: 验证了付费意愿", "- **主流App**：关键数据: 多采用买断制"].join("\n");
  expect(rowListAsTable(list, true)).toContain("| 主流App | 多采用买断制 | — |");
});

it("keeps one of two tables of the same features and one telling of a figure, and moves an item to the subtopic its label names", () => {
  const units = [1, 2, 3, 4, 5, 6].map(n => unit(n, `要点${n}`, { kind: "fact" }));
  const older = "| 能力 | 免费 | 付费 |\n|---|---|---|\n| 每日打卡 | 有 | 有 |\n| 基础日历 | 有 | 有 |\n| 风险报告 | 简版 | 完整 |\n| 守护小组 | 普通 | 智能 |";
  const newer = "| 功能 | 免费 | 付费 |\n|---|---|---|\n| 基础打卡 | ✅ | ✅ |\n| 日历和天数 | ✅ | ✅ |\n| 风险报告 | 部分 | 完整 |\n| 守护小组 | 普通组 | 智能匹配 |";
  const figures = "当时日活稳定在22人，其中15人为核心用户，占比约68%。", again = "小程序当时每天稳定在22人，其中15个为稳定用户。";
  const list = "- **首页布局**：首页中间区域改为风险仪表盘。\n- **推荐理由**：折叠展示推荐原因。";
  const para = (subtopic: string, text: string, ids: string[]) => ({ subtopic, text, unitIds: ids, claims: text.startsWith("|") ? [] : text.split("\n").map(line => ({ text: line.replace(/^- \*\*[^*]+\*\*：/u, ""), unitIds: ids })) });
  const first = [para("首页架构与布局", "首页保留左侧布局。", ["u1"]), para("留存", figures, ["u2"])];
  const second = [para("Agent机制", list, ["u3"]), para("商业化", older, ["u4"]), para("商业化", newer, ["u5"]), para("商业化", again, ["u6"])];
  const chapter = (id: string, title: string, paragraphs: ReturnType<typeof para>[]) => ({ id, title, question: "?", group: "", problems: [], body: paragraphs.map(item => `### ${item.subtopic}\n\n${item.text}`).join("\n\n"), paragraphs });
  const subtopics = (titles: string[]) => titles.map(title => ({ title, subjectIds: ["s"] }));
  const ledger = ledgerOf(units, {
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "项目", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "a", title: "界面设计", question: "?", group: "", subtopics: subtopics(["首页架构与布局", "留存"]) }, { id: "b", title: "技术与运营", question: "?", group: "", subtopics: subtopics(["Agent机制", "商业化"]) }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [chapter("a", "界面设计", first), chapter("b", "技术与运营", second)] },
  });
  const [interfaceChapter, techChapter] = ledgerDocument(ledger, {}).sections.map(section => section.body);
  expect(techChapter).not.toContain("| 能力 |");expect(techChapter).toContain("| 功能 |");
  expect(techChapter).not.toContain("小程序当时每天稳定在22人");expect(interfaceChapter).toContain(figures);
  expect(interfaceChapter).toContain("- **首页布局**：首页中间区域改为风险仪表盘。");expect(techChapter).not.toContain("首页布局");expect(techChapter).toContain("推荐理由");
});

it("puts a subtopic's opening that points at a path after the block telling the path", () => {
  const lead = "该路径旨在让新用户当天完成第一次复盘。", flow = "```\n注册 → 首次打卡\n首次打卡 → 晚间复盘\n```";
  const units = [unit(1, lead, { kind: "mechanism" }), unit(2, "新用户从注册到首次打卡，再到晚间复盘。", { kind: "mechanism" })];
  const ledger = ledgerOf(units, {
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "激活", aliases: [], unitIds: ["u1", "u2"] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "增长", question: "?", group: "", subtopics: [{ title: "激活路径", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "增长", question: "?", group: "", body: `### 激活路径\n\n${lead}\n\n${flow}`, problems: [], paragraphs: [
      { subtopic: "激活路径", text: lead, unitIds: ["u1"], claims: [{ text: lead, unitIds: ["u1"] }] },
      { subtopic: "激活路径", text: flow, unitIds: ["u2"], claims: [] },
    ] }] },
  });
  const [section] = ledgerDocument(ledger, {}).sections;
  expect(section.body.indexOf("注册 → 首次打卡")).toBeLessThan(section.body.indexOf("该路径旨在"));
});

it("leaves a table cell as written though its claim's figures come from an AI restatement", () => {
  const span = (day: number) => ({ conversationSpan: { start: new Date(2026, 5, day, 12).getTime(), end: new Date(2026, 5, day, 13).getTime() } });
  const restated = unit(1, "日活约30人（近期降至22人），整体留存率26.92%。", { kind: "fact", evidence: { ...unit(1, "").evidence, quote: "19%是新增用户次日留存", ...span(14) } });
  const reported = unit(2, "当前小程序日活（DAU）约40，活跃留存率略高于40%。", { kind: "fact", evidence: { ...unit(2, "").evidence, role: "user", ...span(18) } });
  const table = "| 指标 | 数值 | 备注 |\n| --- | --- | --- |\n| 日活 | 约30人（近期降至22人） | 活跃留存率略高于40% |";
  const ledger = ledgerOf([restated, reported], {
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "指标", aliases: [], unitIds: ["u1", "u2"] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "指标", question: "?", group: "", subtopics: [{ title: "指标", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "指标", question: "?", group: "", body: table, problems: [], paragraphs: [
      { subtopic: "指标", text: table, unitIds: ["u1", "u2"], claims: [{ text: "约30人（近期降至22人）", unitIds: ["u1", "u2"] }, { text: "活跃留存率略高于40%", unitIds: ["u1", "u2"] }] },
    ] }] },
  });
  expect(ledgerDocument(ledger, {}).sections[0].body).toBe(table);
});

it("dates a reported figure in a chapter's opening", () => {
  const span = { conversationSpan: { start: new Date(2026, 5, 14, 12).getTime(), end: new Date(2026, 5, 14, 13).getTime() } };
  const retention = unit(1, "当前新增用户留存率为19%，整体留存率为26.92%。", { kind: "fact", evidence: { ...unit(1, "").evidence, role: "user", ...span } });
  const goal = unit(2, "下一阶段把稳定用户提升至20人。", { kind: "plan" });
  const opening = "暂不开发大型新方向。整体留存率为26.92%，新增用户次日留存为19%。";
  const ledger = ledgerOf([retention, goal], {
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "增长", aliases: [], unitIds: ["u1", "u2"] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "增长", question: "?", group: "", subtopics: [{ title: "目标", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "增长", question: "?", group: "", openingUnitIds: ["u1"], body: `${opening}\n\n### 目标\n\n下一阶段把稳定用户提升至20人。`, problems: [], paragraphs: [
      { subtopic: "目标", text: "下一阶段把稳定用户提升至20人。", unitIds: ["u2"], claims: [{ text: "下一阶段把稳定用户提升至20人。", unitIds: ["u2"] }] },
    ] }] },
  });
  expect(ledgerDocument(ledger, {}).sections[0].body).toContain("暂不开发大型新方向。整体留存率为26.92%，新增用户次日留存为19%（6月14日）。");
});

it("leaves no length open that a confirmed version plan gives", () => {
  const units = [unit(1, "破戒后通过60秒快速复盘（时间、情绪、阻断措施）保留成长记录。", { kind: "mechanism" }), unit(2, "破戒后提供低负担的30秒复盘，保留成长记录。", { kind: "mechanism" }),
    unit(3, "分三版迭代：第二版增加Agent动态状态、60秒复盘、风险报告。", { kind: "plan" })];
  expect(differingPlans(units, () => "proposal", true).some(item => item.note.includes("时长"))).toBe(true);
  expect(differingPlans(units, id => id === "u3" ? "confirmed" : "proposal", true).some(item => item.note.includes("时长"))).toBe(false);
});

it("points the AI's side of a note up when the paragraph above tells it", () => {
  const mine = unit(1, "用户提议将首页中间的加号按钮点击后直接跳转至AI界面。", { kind: "fact", evidence: { ...unit(1, "").evidence, role: "user" } });
  const theirs = unit(2, "中央按钮命名为“守护”，平时蓝色，高危时段变橙色。", { kind: "mechanism" });
  const text = "中央按钮命名为“守护”，平时蓝色，高危时段变橙色。";
  const ledger = ledgerOf([mine, theirs], {
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "首页", aliases: [], unitIds: ["u1", "u2"] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "界面", question: "?", group: "", subtopics: [{ title: "首页", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "界面", question: "?", group: "", body: text, problems: [], paragraphs: [{ subtopic: "首页", text, unitIds: ["u2"], claims: [] }] }] },
  });
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).toContain("> 版本未定：首页中央按钮的用法：你提议将首页中间的加号按钮点击后直接跳转至AI界面；AI 的建议见上文。");
  expect(body.split("中央按钮命名为").length).toBe(2);
});

it("gives no day to a competitor's figure in a chapter's opening", () => {
  const span = { conversationSpan: { start: new Date(2026, 5, 14, 12).getTime(), end: new Date(2026, 5, 14, 13).getTime() } };
  const rival = unit(1, "Brainbuddy 在 Google Play 显示已有50万次以上下载。", { kind: "fact", evidence: { ...unit(1, "").evidence, ...span } });
  const table = "| 产品 | 下载 |\n| --- | --- |\n| Brainbuddy | 50万次以上 |";
  const opening = "海外竞品验证了需求。Brainbuddy 在 Google Play 显示下载量超50万次。";
  const ledger = ledgerOf([rival], {
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "竞品", aliases: [], unitIds: ["u1"] }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "市场", question: "?", group: "", subtopics: [{ title: "海外", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "市场", question: "?", group: "", openingUnitIds: ["u1"], body: `${opening}\n\n### 海外\n\n${table}`, problems: [], paragraphs: [{ subtopic: "海外", text: table, unitIds: ["u1"], claims: [] }] }] },
  });
  expect(ledgerDocument(ledger, {}).sections[0].body).toContain("Brainbuddy 在 Google Play 显示下载量超50万次。");
});

it("tells a turned-down point as turned down however it was worded, a replaced point said as now as before, and drops an opening's dangling 并", () => {
  const units = [
    unit(1, "采用系统自动分配同期小组，而非用户主动寻找战友或创建队伍。", { kind: "decision" }),
    unit(2, "弱化戒色敏感词，将外层定位调整为自律恢复工具。", { kind: "decision" }),
    unit(3, "决定先深耕戒色单一垂直领域，再扩展至泛自律工具。", { kind: "decision", evidence: { ...unit(3, "").evidence, role: "user", quote: "先深耕戒色" } }),
    unit(4, "坚持默认匿名、本地优先的数据处理原则。", { kind: "constraint" }),
  ];
  const adopted = "此前采用系统自动分配同期小组（滚动制），不再提供手动创建入口。";
  const now = "当前策略是弱化“戒色”敏感词，将外层定位调整为“自律恢复工具”。";
  const opening = "并严格遵守《个人信息保护法》及反伪科学宣传的合规底线。";
  const paragraphs = [
    { subtopic: "定位", text: adopted, unitIds: ["u1"], claims: [{ text: adopted, unitIds: ["u1"] }] },
    { subtopic: "定位", text: now, unitIds: ["u2"], claims: [{ text: now, unitIds: ["u2"] }] },
    { subtopic: "定位", text: "坚持默认匿名、本地优先的数据处理原则。", unitIds: ["u4"], claims: [{ text: "坚持默认匿名、本地优先的数据处理原则。", unitIds: ["u4"] }] },
  ];
  const ledger = ledgerOf(units, {
    decisions: { u1: { verdict: "rejected", at: 5 } },
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "定位", aliases: [], unitIds: units.map(item => item.id) }], merged: [], report: {}, chapters: [{ id: "ch", title: "定位", question: "?", group: "", subtopics: [{ title: "定位", subjectIds: ["s"] }] }],
      relations: [], topics: [{ id: "t", name: "定位", current: ["u3"], earlier: ["u2"], open: false }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "定位", question: "?", group: "", problems: [], body: `${opening}\n\n### 定位\n\n${paragraphs.map(item => item.text).join("\n\n")}`, paragraphs }] },
  } as Partial<WikiKnowledgeLedger>);
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).toContain("你在回答中否定了「采用系统自动分配同期小组，而非用户主动寻找战友或创建队伍」的方案。");
  expect(body).not.toContain("此前采用系统自动分配");
  expect(body).toContain("此前策略是弱化“戒色”敏感词");
  expect(body).not.toMatch(/^并严格/mu);
});

it("keeps the latest figure the user gave as now, marks a sentence by its latest point and drops a list item retelling the opening's decision", () => {
  const span = (month: number, day: number) => ({ conversationSpan: { start: new Date(2026, month - 1, day, 12).getTime(), end: new Date(2026, month - 1, day, 13).getTime() } });
  const own = (n: number, statement: string, month: number, day: number) => unit(n, statement, { kind: "fact", evidence: { ...unit(n, statement).evidence, role: "user", quote: statement, ...span(month, day) } });
  const old = own(1, "小程序每天稳定在22人。", 6, 20), latest = own(2, "当前小程序日活约40。", 8, 18);
  const chapters: WikiDraftChapter[] = [{ id: "a", title: "数据", question: "", group: "", problems: [], body: "", paragraphs: [{ subtopic: "数据", text: "当前小程序日活约40。", unitIds: ["u2"], claims: [] }, { subtopic: "数据", text: "小程序每天稳定在22人。", unitIds: ["u1"], claims: [] }] }];
  const byId = new Map([old, latest].map(item => [item.id, item]));
  datedMeasures(chapters, id => byId.get(id), true);
  expect(chapters[0].paragraphs[0].text).toBe("当前小程序日活约40（8月18日）。");
  const plan = unit(3, "分三版迭代：第一版保留原成长区；第二版增加守护流程；第三版加入自动分组。", { kind: "decision" });
  const both = "你提到小程序日活约40；此前曾报告每天稳定在22人。";
  const repeat = "分三版迭代：第一版保留原成长区；第二版增加守护流程；第三版加入自动分组。";
  const opening = "开发规划分三版迭代：第一版保留原成长区，第二版增加守护流程，第三版加入自动分组。";
  const paragraphs = [
    { subtopic: "路线", text: `- **开发顺序**：${repeat}\n- **近期目标**：先重做新手流程。`, unitIds: ["u3"], claims: [{ text: repeat, unitIds: ["u3"] }] },
    { subtopic: "路线", text: both, unitIds: ["u1", "u2"], claims: [{ text: both, unitIds: ["u1", "u2"] }] },
  ];
  const ledger = ledgerOf([old, latest, plan], {
    decisions: { u3: { verdict: "confirmed", at: 5 } },
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "路线", aliases: [], unitIds: ["u1", "u2", "u3"] }], merged: [], report: {}, relations: [{ older: "u1", newer: "u2", kind: "replaces", status: "resolved" }], chapters: [{ id: "ch", title: "开发规划", question: "?", group: "", subtopics: [{ title: "路线", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "开发规划", question: "?", group: "", problems: [], openingUnitIds: ["u3"], body: `${opening}\n\n### 路线\n\n${paragraphs.map(item => item.text).join("\n\n")}`, paragraphs }] },
  } as Partial<WikiKnowledgeLedger>);
  const [section] = ledgerDocument(ledger, {}).sections;
  expect(section.body).not.toContain("开发顺序");
  expect(section.body).toContain("- **近期目标**：先重做新手流程。");
  expect(section.claims?.find(claim => claim.text.includes("日活约40"))?.holder).not.toBe("earlier");
});

it("tells the AI's turned-down plan as the AI's, splits versions in one item, keeps a list whole and drops a heading left with a note", () => {
  const ai = unit(1, "首屏100%为AI Agent驾驶舱，原日历下移。", { kind: "decision" });
  const rescue = unit(2, "急救支持三档强度独立流程和急救后二次评估。"), first = unit(3, "第一版优先实现干预前选强度和60秒三步流程。");
  const pay = unit(4, "会员权益售卖风险预测和深度分析。"), sos = unit(5, "急救入口和基础恢复流程必须免费。", { evidence: { ...unit(5, "SOS急救不要完全收费。").evidence, role: "user" } });
  const plan = unit(6, "分三版迭代：第一版保留原成长区；第二版增加守护流程；第三版加入自动分组。", { kind: "decision" });
  const proposed = "你曾提议将首屏100%设为AI Agent驾驶舱，原日历下移，但该方案已被否定。";
  const versions = "- **急救流程**：当前建议：支持三档强度独立流程、急救后二次评估；早期版本：优先实现：干预前选强度、60秒三步流程";
  const list = "- **权益售卖**：会员权益应售卖风险预测和深度分析。\nSOS急救不要完全收费。\n- **转化流程**：先免费评估再付费。";
  const second = "- **免费范围**：急救入口和基础恢复流程必须免费。";
  const opening = "开发规划分三版迭代：第一版保留原成长区；第二版增加守护流程；第三版加入自动分组。";
  const paragraphs = [
    { subtopic: "架构", text: proposed, unitIds: ["u1"], claims: [{ text: proposed, unitIds: ["u1"] }] },
    { subtopic: "验收", text: versions, unitIds: ["u2", "u3"], claims: [{ text: "支持三档强度独立流程、急救后二次评估", unitIds: ["u2"] }, { text: "优先实现：干预前选强度、60秒三步流程", unitIds: ["u3"] }] },
    { subtopic: "付费", text: list, unitIds: ["u4", "u5"], claims: [{ text: "会员权益应售卖风险预测和深度分析。", unitIds: ["u4"] }] },
    { subtopic: "付费", text: second, unitIds: ["u5"], claims: [{ text: "急救入口和基础恢复流程必须免费。", unitIds: ["u5"] }] },
  ];
  const body = `${opening}\n\n### 架构\n\n${proposed}\n\n### 验收\n\n${versions}\n\n### 付费\n\n${list}\n\n${second}\n\n### 早先版本\n\n> 相关讨论 1 条`;
  const ledger = ledgerOf([ai, rescue, first, pay, sos, plan], {
    decisions: { u1: { verdict: "rejected", at: 5 }, u6: { verdict: "confirmed", at: 5 } },
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "开发", aliases: [], unitIds: ["u1", "u2", "u3", "u4", "u5", "u6"] }], merged: [], report: {}, relations: [{ older: "u3", newer: "u2", kind: "replaces", status: "resolved" }], chapters: [{ id: "ch", title: "开发规划", question: "?", group: "", subtopics: [{ title: "架构", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "开发规划", question: "?", group: "", problems: [], openingUnitIds: ["u6"], body, paragraphs }] },
  } as Partial<WikiKnowledgeLedger>);
  const [section] = ledgerDocument(ledger, {}).sections;
  expect(section.body).toContain("AI 曾建议将首屏100%设为AI Agent驾驶舱");
  expect(section.body).not.toContain("你曾提议");
  expect(section.body).toContain("- **急救流程**：支持三档强度独立流程、急救后二次评估\n- **急救流程**：此前优先实现：干预前选强度、60秒三步流程");
  expect(section.body).toContain("- SOS急救不要完全收费。");
  expect(section.body).toContain("- **转化流程**：先免费评估再付费。\n- **免费范围**");
  expect(section.body).not.toContain("早先版本");
  expect(section.claims?.find(claim => claim.unitIds?.includes("u6"))?.text).toContain("第三版加入自动分组");
});

it("dates a table of figures, says no AI suggestion holds, names a point's subject and tells the user's idea as theirs", () => {
  const span = (month: number, day: number) => ({ conversationSpan: { start: new Date(2026, month - 1, day, 12).getTime(), end: new Date(2026, month - 1, day, 13).getTime() } });
  const figure = (n: number, statement: string, role: "user" | "assistant", month: number, day: number) => unit(n, statement, { kind: "fact", evidence: { ...unit(n, statement).evidence, role, quote: statement, ...span(month, day) } });
  const early = figure(1, "日活仅25。", "user", 6, 6), later = figure(2, "日活约40，付费率较低。", "user", 8, 18), told = figure(3, "日活约30人（近期降至22人）。", "assistant", 6, 20);
  told.evidence.quote = "次日留存19%偏低。";
  const kept = figure(4, "新增用户留存率为19%。", "user", 6, 20);
  const button = unit(5, "首页主按钮平时显示守护，高危时段显示橙色点。"), rescue = unit(6, "紧急求助升级为包含10秒冷静弹窗的王牌功能。", { subject: "紧急求助" });
  const challenge = unit(7, "作为主要推广活动，按天解锁特定任务。", { subject: "21天清醒挑战" }), own = unit(8, "将侧重点转向帮助青少年男性找回自信。", { evidence: { ...unit(8, "将侧重点转向帮助青少年男性找回自信。").evidence, role: "user" } });
  const table = "| 数据来源 | 日活 | 留存率 |\n| --- | --- | --- |\n| 当前统计 | 约40 | 付费率较低 |\n| 另一视角 | 仅25 | - |\n| 整体分析 | 约30人（近期降至22人） | 新增19% |";
  const holds = "关于首页主按钮的状态逻辑，现行方案为：平时显示守护，高危时段显示橙色点。";
  const upgraded = "当前方案升级为包含10秒冷静弹窗的王牌功能。";
  const lead = "强制引导完成新手闭环。", joined = "此外，作为主要推广活动，按天解锁特定任务。";
  const idea = "此前建议将侧重点转向帮助青少年男性找回自信。";
  const paragraphs = [
    { subtopic: "数据", text: table, unitIds: ["u1", "u2", "u3", "u4"], claims: [{ text: "当前统计", unitIds: ["u2"] }, { text: "约40", unitIds: ["u2"] }, { text: "另一视角", unitIds: ["u1"] }, { text: "仅25", unitIds: ["u1"] }, { text: "约30人（近期降至22人）", unitIds: ["u3", "u4"] }, { text: "新增19%", unitIds: ["u3", "u4"] }] },
    { subtopic: "数据", text: holds, unitIds: ["u5"], claims: [{ text: holds, unitIds: ["u5"] }] },
    { subtopic: "数据", text: upgraded, unitIds: ["u6"], claims: [{ text: upgraded, unitIds: ["u6"] }] },
    { subtopic: "数据", text: `${lead}${joined}`, unitIds: ["u7"], claims: [{ text: lead, unitIds: ["u7"] }, { text: joined, unitIds: ["u7"] }] },
    { subtopic: "数据", text: idea, unitIds: ["u8"], claims: [{ text: idea, unitIds: ["u8"] }] },
  ];
  const body = `产品是守护系统。 项目先深耕戒色。\n\n### 数据\n\n${paragraphs.map(item => item.text).join("\n\n")}`;
  const ledger = ledgerOf([early, later, told, kept, button, rescue, challenge, own], {
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "数据", aliases: [], unitIds: ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"] }], merged: [], report: {}, relations: [], chapters: [{ id: "ch", title: "增长", question: "?", group: "", subtopics: [{ title: "数据", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "增长", question: "?", group: "", problems: [], body, paragraphs }] },
  } as Partial<WikiKnowledgeLedger>);
  const [section] = ledgerDocument(ledger, {}).sections;
  expect(section.body).toContain("| 时间 | 日活 | 留存率 |");
  expect(section.body.indexOf("| 6月6日 | 仅25 |")).toBeLessThan(section.body.indexOf("| 8月18日 | 约40 |"));
  expect(section.body).toContain("| 6月20日 | — | 新增19% |");
  expect(section.body).not.toMatch(/当前统计|另一视角|现行方案|当前方案/u);
  expect(section.body).toContain("首页主按钮的状态逻辑：平时显示守护");
  expect(section.body).toContain("紧急求助升级为包含10秒冷静弹窗的王牌功能。");
  expect(section.body).toContain("此外，21天清醒挑战作为主要推广活动");
  expect(section.body).toContain("你此前曾提出将侧重点转向");
  expect(section.body).toContain("产品是守护系统。项目先深耕戒色。");
});

it("keeps a version in force out of the earlier versions, a declined plan out of the opening, and each point's status words its own", () => {
  const user = (n: number, statement: string, extra: Partial<WikiKnowledgeUnit> = {}) => unit(n, statement, { ...extra, evidence: { ...unit(n, statement).evidence, role: "user" } });
  const softer = unit(1, "弱化敏感词，将外层定位调整为自律恢复工具。"), focus = user(2, "决定先深耕戒色垂直领域，待留存稳定后再扩展至泛自律工具。");
  const card = unit(3, "将今日指南、防守建议合并为单一的今日任务卡片。"), one = unit(4, "将今日任务升级为今天只做这一件事，由AI根据状态推荐具体行动。");
  const renamed = unit(5, "将我的挑战更名为我的计划。"), plans = unit(6, "计划页展示早睡重启与专注恢复两类计划。");
  const metric = unit(7, "将顶部大卡的核心指标改为今日状态，保留天数作为次要指标。");
  const groups = unit(8, "系统自动分配匿名小组，每组六到十人。");
  const early = user(9, "每天稳定在22人，其中15个为稳定用户。", { kind: "fact" }), core = user(10, "日活稳定在22人，其中15人为核心用户，占比约68%。", { kind: "fact" });
  const guide = unit(11, "改为强制引导完成新手闭环，同样确保首日激活。", { subject: "新手引导" });
  const lines = {
    focusPart: "此前曾建议弱化敏感词，将外层定位调整为自律恢复工具；现行策略仍坚持深耕戒色垂直领域，待留存稳定后再扩展至泛自律工具。",
    cardPart: "此前曾提议将今日指南、防守建议合并为单一的今日任务卡片。当前规划将今日任务升级为今天只做这一件事，由AI根据状态推荐具体行动。",
    renamed: "早期决定将我的挑战更名为我的计划。", metric: "此前曾提议将顶部大卡的核心指标改为今日状态，保留天数作为次要指标。",
    refused: "你在回答中否定了「系统自动分配匿名小组，每组六到十人」的方案。", guide: "当前建议改为强制引导完成新手闭环，同样确保首日激活。",
    figures: "- **早期数据**：此前每天稳定在22人，其中15个为稳定用户；当时日活仅25，面临推广难。\n- **核心构成**：当时日活稳定在22人，其中15人为核心用户，占比约68%。",
  };
  const paragraphs = [
    { subtopic: "现状", text: lines.metric, unitIds: ["u7"], claims: [{ text: lines.metric, unitIds: ["u7"] }] },
    { subtopic: "现状", text: lines.guide, unitIds: ["u11"], claims: [{ text: lines.guide, unitIds: ["u11"] }] },
    { subtopic: "现状", text: plans.statement, unitIds: ["u6"], claims: [{ text: plans.statement, unitIds: ["u6"] }] },
    { subtopic: "现状", text: lines.figures, unitIds: ["u9", "u10"], claims: [{ text: "此前每天稳定在22人，其中15个为稳定用户", unitIds: ["u9"] }, { text: "当时日活稳定在22人，其中15人为核心用户，占比约68%", unitIds: ["u10"] }] },
    { subtopic: "早先版本", text: lines.focusPart, unitIds: ["u1", "u2"], claims: [{ text: lines.focusPart, unitIds: ["u1", "u2"] }] },
    { subtopic: "早先版本", text: lines.cardPart, unitIds: ["u3"], claims: [{ text: lines.cardPart.split("。")[0] + "。", unitIds: ["u3"] }] },
    { subtopic: "早先版本", text: lines.renamed, unitIds: ["u5"], claims: [{ text: lines.renamed, unitIds: ["u5"] }] },
    { subtopic: "早先版本", text: `${lines.refused}该方案不提供手动创建入口。此设计已被否定，未采纳。`, unitIds: ["u8"], claims: [{ text: lines.refused, unitIds: ["u8"] }] },
  ];
  const opening = "项目先深耕戒色垂直领域，社群互助则依赖系统自动分配匿名小组，每组六到十人。";
  const body = `${opening}\n\n### 现状\n\n${paragraphs.slice(0, 4).map(item => item.text).join("\n\n")}\n\n### 早先版本\n\n${paragraphs.slice(4).map(item => item.text).join("\n\n")}`;
  const all = [softer, focus, card, one, renamed, plans, metric, groups, early, core, guide];
  const ledger = ledgerOf(all, {
    decisions: { u8: { verdict: "rejected", at: 1 } },
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "现状", aliases: [], unitIds: all.map(item => item.id) }], merged: [], report: {}, relations: [],
      topics: [{ id: "t1", name: "定位", current: ["u2"], earlier: ["u1"], open: false }, { id: "t2", name: "任务", current: ["u4"], earlier: ["u3"], open: false }, { id: "t3", name: "计划", current: ["u6"], earlier: ["u5"], open: false }],
      chapters: [{ id: "ch", title: "产品", question: "?", group: "", subtopics: [{ title: "现状", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "产品", question: "?", group: "", problems: [], body, paragraphs }] },
  } as Partial<WikiKnowledgeLedger>);
  const [section] = ledgerDocument(ledger, {}).sections;
  const [current, earlier] = section.body.split("### 早先版本");
  expect(section.body.split("\n")[0]).not.toMatch(/自动分配/u);
  expect(section.body).toContain("项目先深耕戒色垂直领域。");
  expect(earlier).not.toMatch(/现行策略|深耕|当前规划|今天只做这一件事|此设计已被否定/u);
  expect(earlier).toContain("将外层定位调整为自律恢复工具。");
  expect(current).toContain("将今日任务升级为今天只做这一件事，由AI根据状态推荐具体行动。");
  expect(earlier).toContain("早期曾建议将我的挑战更名为我的计划。");
  expect(current).toContain("AI 建议将顶部大卡的核心指标改为今日状态");
  expect(current).toContain("新手引导改为强制引导完成新手闭环，并确保首日激活。");
  expect(current).toContain("- **早期数据**：当时日活仅25，面临推广难。");
  expect(current).toContain("其中15人为核心用户，占比约68%");
});

it("moves an item of replaced versions to the earlier versions, mends a broken list and table, and keeps a suggestion or a past figure from reading as now", () => {
  const softer = unit(1, "弱化敏感词，将外层定位调整为自律恢复工具。"), focus = unit(2, "先深耕戒色垂直领域。"), path = unit(3, "采用戒色到状态恢复到自律的渐进式扩展路径。");
  const button = unit(4, "首页守护按钮平时显示守护，高危时段显示橙色点。"), first = unit(5, "第一版优先实现干预前选强度与急救后评估。"), task = unit(6, "首页只展示一件核心任务。");
  const rescue = unit(7, "升级为包含10秒冷静弹窗的王牌功能。", { subject: "紧急求助功能" }), old = unit(8, "小程序每天稳定在22人。", { kind: "fact" });
  const lines = {
    list: "1.\n2. **早期策略**：弱化敏感词，将外层定位调整为自律恢复工具。\n3. **扩展路径**：采用戒色到状态恢复到自律的渐进式扩展路径。",
    held: "首页主要按钮应根据用户状态动态变化。当前方案为平时显示守护，高危时段显示橙色点。",
    table: "| 维度 | 当前版本要求 | 后续改进目标 |\n| --- | --- | --- |\n| 第一版优先实现干预前选强度与急救后评估。|\n| 首页任务 | 首页只展示一件核心任务。 | — |",
    rescue: "此前曾提出升级为包含10秒冷静弹窗的王牌功能。",
    past: "- **当时数据**：小程序目前每天稳定在22人。\n- **最新报告**：日活约40。",
  };
  const paragraphs = [
    { subtopic: "定位", text: lines.list, unitIds: ["u1", "u3"], claims: [{ text: "弱化敏感词，将外层定位调整为自律恢复工具。", unitIds: ["u1"] }, { text: "采用戒色到状态恢复到自律的渐进式扩展路径。", unitIds: ["u3"] }] },
    { subtopic: "定位", text: lines.held, unitIds: ["u4"], claims: [] },
    { subtopic: "定位", text: lines.table, unitIds: ["u5", "u6"], claims: [{ text: "| 第一版优先实现干预前选强度与急救后评估。", unitIds: ["u5"] }, { text: "首页只展示一件核心任务。", unitIds: ["u6"] }] },
    { subtopic: "定位", text: lines.rescue, unitIds: ["u7"], claims: [{ text: lines.rescue, unitIds: ["u7"] }] },
    { subtopic: "定位", text: lines.past, unitIds: ["u8"], claims: [{ text: "小程序目前每天稳定在22人。", unitIds: ["u8"] }] },
  ];
  const body = `项目先深耕戒色垂直领域。\n\n### 定位\n\n${paragraphs.map(item => item.text).join("\n\n")}`;
  const all = [softer, focus, path, button, first, task, rescue, old];
  const ledger = ledgerOf(all, {
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "定位", aliases: [], unitIds: all.map(item => item.id) }], merged: [], report: {}, relations: [],
      topics: [{ id: "t1", name: "定位", current: ["u2"], earlier: ["u1"], open: false }],
      chapters: [{ id: "ch", title: "产品", question: "?", group: "", subtopics: [{ title: "定位", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "产品", question: "?", group: "", problems: [], body, paragraphs }] },
  } as Partial<WikiKnowledgeLedger>);
  const [section] = ledgerDocument(ledger, {}).sections;
  const [current, earlier] = section.body.split("### 早先版本");
  expect(earlier).toContain("- **早期策略**：弱化敏感词");
  expect(current).not.toMatch(/早期策略|^\s*\d+\.\s*$/mu);
  expect(current).toContain("- **扩展路径**：");
  expect(current).toContain("动态变化。AI 建议平时显示守护");
  expect(current).not.toMatch(/\|[ \t]*第一版优先实现/u);
  expect(current).toContain("\n\n第一版优先实现干预前选强度与急救后评估。");
  expect(current).toContain("AI 建议将紧急求助功能升级为包含10秒冷静弹窗的王牌功能。");
  expect(current).toContain("- **当时数据**：小程序每天稳定在22人。");
});

it("tells a table of versions by what its column names, and reads a list of one-field rows as a table", () => {
  const table = "| 版本 | 主按钮状态逻辑 |\n| --- | --- |\n| 此前 | 正常状态显示“开启今晚守护”。 |\n| 现行 | 平时显示“守护”，高危时段显示橙色点。 |";
  const draft: WikiDraftChapter = { id: "ui", title: "界面", question: "", group: "", problems: [], body: `### 首页\n\n${table}`,
    paragraphs: [{ subtopic: "首页", text: table, unitIds: ["old", "now"], claims: [{ text: "此前", unitIds: ["old"] }, { text: "正常状态显示“开启今晚守护”。", unitIds: ["old"] }, { text: "现行", unitIds: ["now"] }, { text: "平时显示“守护”，高危时段显示橙色点。", unitIds: ["now"] }] }] };
  expect(earlierVersionsLast([draft], id => id === "old" ? "history" : "proposal", true)).toBe(1);
  expect(draft.body).toBe("### 首页\n\n主按钮状态逻辑：平时显示“守护”，高危时段显示橙色点。\n\n### 早先版本\n\n- **主按钮状态逻辑**：正常状态显示“开启今晚守护”。");
  expect(draft.paragraphs[0].claims!.map(claim => claim.text)).toEqual(["平时显示“守护”，高危时段显示橙色点。"]);
  const rows = "- **整体留存率**：数值/状态：26.92%\n- **新增用户次日留存**：数值/状态：19%\n- **日活**：数值/状态：约30人；备注：其中15人为核心用户";
  expect(rowListAsTable(rows, true)).toBe("| 名称 | 数值/状态 | 备注 |\n| --- | --- | --- |\n| 整体留存率 | 26.92% | — |\n| 新增用户次日留存 | 19% | — |\n| 日活 | 约30人 | 其中15人为核心用户 |");
});

it("opens a chapter on what holds when its opening told only the replaced version, and keeps the writer's asides and bare changes out", () => {
  const span = { conversationSpan: { start: new Date(2026, 5, 20, 12).getTime(), end: new Date(2026, 5, 20, 13).getTime() } };
  const once = unit(1, "初期采用免费核心功能加一次性30天守护计划付费模式，暂不做强制会员。"), now = unit(2, "先免费开放7天体验，随后销售30天守护计划。");
  const roadmap = unit(3, "分三版实施：V1替换首页大月历，V2实现动态状态，V3加入自动分组。"), rescue = unit(4, "升级为包含10秒冷静弹窗的王牌功能。", { subject: "紧急求助功能" });
  const card = unit(5, "将分散模块合并为单一的今日任务卡片。"), task = unit(6, "将今日任务升级为今天只做这一件事，由AI根据状态推荐具体行动。");
  const rate = unit(7, "整体留存率为26.92%。", { kind: "fact", evidence: { ...unit(7, "整体留存率为26.92%。").evidence, role: "user", ...span } }), total = unit(8, "累计用户1100人。", { kind: "fact", evidence: { ...unit(8, "累计用户1100人。").evidence, role: "user", ...span } }), fresh = unit(9, "新增用户次日留存19%。", { kind: "fact", evidence: { ...unit(9, "新增用户次日留存19%。").evidence, role: "user", ...span } });
  const lines = { plan: "最终建议先免费开放7天体验，随后销售30天守护计划。", roadmap: "此前曾提出分三版实施：V1替换首页大月历，V2实现动态状态，V3加入自动分组，该方案与当前规划存在差异且未明确取代关系。", rescue: "升级为包含10秒冷静弹窗的王牌功能。", task: "现行方案将今日任务升级为今天只做这一件事，由AI根据状态推荐具体行动。",
    rows: "- **整体留存率**：数值/状态：26.92%\n- **新增用户次日留存**：数值/状态：19%\n- **累计用户**：数值/状态：1100人" };
  const paragraphs = [
    { subtopic: "模式", text: lines.plan, unitIds: ["u2"], claims: [{ text: lines.plan, unitIds: ["u2"] }] },
    { subtopic: "模式", text: lines.roadmap, unitIds: ["u3"], claims: [{ text: lines.roadmap, unitIds: ["u3"] }] },
    { subtopic: "模式", text: lines.rescue, unitIds: ["u4"], claims: [{ text: lines.rescue, unitIds: ["u4"] }] },
    { subtopic: "模式", text: lines.task, unitIds: ["u5", "u6"], claims: [{ text: lines.task, unitIds: ["u5", "u6"] }] },
    { subtopic: "模式", text: lines.rows, unitIds: ["u7", "u8", "u9"], claims: [{ text: "整体留存率", unitIds: ["u7"] }, { text: "26.92%", unitIds: ["u7"] }, { text: "新增用户次日留存", unitIds: ["u9"] }, { text: "19%", unitIds: ["u9"] }, { text: "累计用户", unitIds: ["u8"] }, { text: "1100人", unitIds: ["u8"] }] },
  ];
  const opening = "产品初期采用免费核心功能加一次性30天守护计划付费模式，暂不做强制会员。";
  const body = `${opening}\n\n### 模式\n\n${paragraphs.map(item => item.text).join("\n\n")}`;
  const all = [once, now, roadmap, rescue, card, task, rate, total, fresh];
  const ledger = ledgerOf(all, {
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "模式", aliases: [], unitIds: all.map(item => item.id) }], merged: [], report: {}, relations: [],
      topics: [{ id: "t1", name: "付费", current: ["u2"], earlier: ["u1"], open: false }, { id: "t2", name: "任务", current: ["u6"], earlier: ["u5"], open: false }],
      chapters: [{ id: "ch", title: "商业", question: "?", group: "", subtopics: [{ title: "模式", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "商业", question: "?", group: "", problems: [], body, paragraphs: [{ subtopic: "", text: opening, unitIds: ["u1"], claims: [{ text: opening, unitIds: ["u1"] }] }, ...paragraphs] }] },
  } as Partial<WikiKnowledgeLedger>);
  const [section] = ledgerDocument(ledger, {}).sections;
  expect(section.body.startsWith("最终建议先免费开放7天体验")).toBe(true);
  expect(section.body).not.toMatch(/取代关系|现行方案/u);
  expect(section.body).toContain("V3加入自动分组。");
  expect(section.body).toContain("紧急求助功能升级为包含10秒冷静弹窗的王牌功能。");
  expect(section.body).toContain("将今日任务升级为今天只做这一件事");
  expect(section.body).toContain("| 整体留存率 | 26.92% |");
  expect(section.body).toContain("| 累计用户 | 1100人 |");
});

it("names the AI's central-button suggestion outgrown once a later reply takes up the user's idea for it", () => {
  const suggestion = unit(1, "中央悬浮“+”号含义不明，建议改为盾牌图标并标注“守护”。", { kind: "decision" });
  const mine = unit(2, "中间按钮点击后跳转到AI页面。", { kind: "decision", evidence: { evidenceId: "e2", conversationId: "c", messageId: "m2", messageIndex: 2, role: "user", pasted: false, quote: "" } });
  const adopted = unit(3, "采纳中间按钮跳转AI的方向，任务与复盘由AI主导。", { kind: "decision" });
  expect([...outgrownCentralNames([suggestion, mine, adopted], () => "proposal")]).toEqual(["u1"]);
  expect([...outgrownCentralNames([suggestion, mine], () => "proposal")]).toEqual([]);
  expect([...outgrownCentralNames([suggestion, mine, adopted], id => id === "u1" ? "confirmed" : "proposal")]).toEqual([]);
});

it("moves rows named by version to the earlier versions without a 版本 header", () => {
  const table = "| 报告 | 日活 | 留存 |\n| --- | --- | --- |\n| 此前报告 | 32人 | 未知 |\n| 当前报告 | 22人 | 30% |";
  const draft: WikiDraftChapter = { id: "m", title: "市场", question: "", group: "", problems: [], body: `### 数据\n\n${table}`,
    paragraphs: [{ subtopic: "数据", text: table, unitIds: ["old", "now"], claims: [{ text: "此前报告 | 32人", unitIds: ["old"] }, { text: "当前报告 | 22人", unitIds: ["now"] }] }] };
  expect(earlierVersionsLast([draft], id => id === "old" ? "history" : "proposal", true)).toBe(1);
  expect(draft.body).not.toContain("| --- |");
  expect(draft.body).toContain("### 早先版本");
  expect(draft.body.split("### 早先版本")[1]).toContain("32人");
  expect(draft.body.split("### 早先版本")[0]).toContain("22人");
});

it("tells a version-named row by its field, drops a stage label the discussion never used, and opens with the user's decision", () => {
  const own = { evidenceId: "e1", conversationId: "c", messageId: "m1", messageIndex: 1, role: "user" as const, pasted: false, quote: "决定先深耕戒色单一垂直领域，暂不扩展到其他自律场景。" };
  const units = [
    unit(1, "决定先深耕戒色单一垂直领域，暂不扩展到其他自律场景。", { kind: "decision", adoption: { status: "unknown" }, evidence: own } as Partial<WikiKnowledgeUnit>),
    unit(2, "小程序日活每天稳定在22人。", { kind: "report" }),
    unit(3, "风险预测按历史破戒时间段加权计算。", { kind: "plan" }),
  ];
  const row = "- 此前报告 · 日活数据: 每天稳定在22人";
  const stage = "V4阶段，风险预测按历史破戒时间段加权计算。";
  const paragraphs = [
    { subtopic: "定位", text: "产品面向希望戒色的年轻用户。", unitIds: ["u1"], claims: [] },
    { subtopic: "定位", text: row, unitIds: ["u2"], claims: [] },
    { subtopic: "定位", text: stage, unitIds: ["u3"], claims: [{ text: stage, unitIds: ["u3"] }] },
  ];
  const ledger = ledgerOf(units, {
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "定位", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "定位", question: "?", group: "", subtopics: [{ title: "定位", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "定位", question: "?", group: "", problems: [], openingUnitIds: ["u1"], body: `### 定位\n\n${paragraphs.map(item => item.text).join("\n\n")}`, paragraphs }] },
  });
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body.startsWith("决定先深耕戒色单一垂直领域")).toBe(true);
  expect(body).toContain("- **日活数据**：每天稳定在22人");
  expect(body).not.toContain("V4阶段");
  expect(body).toContain("风险预测按历史破戒时间段加权计算。");
});

const oneChapter = (units: WikiKnowledgeUnit[], paragraphs: Array<{ subtopic: string; text: string; unitIds: string[]; claims: Array<{ text: string; unitIds: string[] }> }>, decisions: WikiKnowledgeLedger["decisions"] = {}, openingUnitIds: string[] = []) => {
  const subtopics = [...new Set(paragraphs.map(item => item.subtopic))];
  let body = "", last = "";
  for (const item of paragraphs) { body += `${item.subtopic !== last ? `${body ? "\n\n" : ""}### ${item.subtopic}\n\n` : "\n\n"}${item.text}`; last = item.subtopic; }
  return ledgerOf(units, { decisions,
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "章", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "章", question: "?", group: "", subtopics: subtopics.map(title => ({ title, subjectIds: ["s"] })) }] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ id: "ch", title: "章", question: "?", group: "", problems: [], openingUnitIds, body, paragraphs }] },
  });
};
const rejected = { verdict: "rejected" as const, at: 1 }, confirmedVerdict = { verdict: "confirmed" as const, at: 1 };

it("lists in a turned-down list what the user turned down, with the condition no item gave", () => {
  const units = [unit(1, "采用系统自动分配同期小组（滚动制），而非用户主动寻找战友或创建队伍。"), unit(2, "用户开始计划后自动分配至守护小组，作为每日回访的社交理由。"), unit(3, "用户开始计划后由系统自动分配匿名小组，不再提供手动创建或寻找战友入口。")];
  const text = "你否定了此前关于社群互助的以下方案：采用系统自动分配同期小组（滚动制），而非用户主动寻找战友或创建队伍；用户开始计划后自动分配至守护小组，作为每日回访的社交理由。";
  const ledger = oneChapter(units, [{ subtopic: "早先版本", text, unitIds: ["u1", "u2", "u3"], claims: [{ text, unitIds: ["u2"] }] }], { u1: rejected, u2: rejected, u3: rejected });
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).toContain("而非用户主动寻找战友或创建队伍，不再提供手动创建或寻找战友入口；用户开始计划后自动分配至守护小组");
});

it("asks about a confirmed decision holding what the user turned down, and not about a shared card name", () => {
  const plan = unit(1, "分三版迭代：第一版保留原成长区；第三版加入自动分组、小组任务。");
  const layout = unit(2, "首屏展示今日计划；守护小组、最近7天记录通过向下滚动查看。");
  const declined = [unit(3, "采用系统自动分配同期小组（滚动制）。"), unit(4, "用户开始计划后由系统自动分配匿名小组。"), unit(5, "用户开始计划后加入守护小组，作为每日回访的社交理由。")];
  const others = [unit(6, "守护小组显示今日完成人数。"), unit(7, "守护小组支持一键鼓励。")];
  const status = (id: string) => ["u1", "u2"].includes(id) ? "confirmed" : "proposal";
  const found = decidedAgainstDeclined([plan, layout, ...declined, ...others], status, id => ["u3", "u4", "u5"].includes(id));
  expect(found.map(item => item.decidedId)).toEqual(["u1"]);
  expect(found[0].note).toContain("「第三版加入自动分组」");
  expect(found[0].note).toContain("另有 1 条类似");
});

it("moves a sentence told as replaced out of the current points, and drops one telling the confirmed plan as replaced", () => {
  const units = [unit(1, "首屏优先展示问候、Agent判断和唯一核心行动。"), unit(2, "首屏应减少密度，仅保留问候、Agent判断和一个主行动。"), unit(3, "分三版迭代：第一版保留原成长区；第二版增加动态状态；第三版加入自动分组。")];
  const ledger = oneChapter(units, [
    { subtopic: "布局", text: "首屏优先展示问候、Agent判断和唯一核心行动。\n\n此前曾提出减少首屏密度仅保留核心要素的方案，现行方案明确了具体展示层级。", unitIds: ["u1", "u2"], claims: [{ text: "首屏优先展示问候、Agent判断和唯一核心行动。", unitIds: ["u1"] }] },
    { subtopic: "规划", text: "分三版迭代：第一版保留原成长区；第二版增加动态状态；第三版加入自动分组。", unitIds: ["u3"], claims: [{ text: "分三版迭代：第一版保留原成长区；第二版增加动态状态；第三版加入自动分组。", unitIds: ["u3"] }] },
    { subtopic: "规划", text: "此前曾提出分三版实施：V1替换首页大月历，V2实现动态状态，V3加入自动分组。", unitIds: ["u3"], claims: [{ text: "此前曾提出分三版实施：V1替换首页大月历，V2实现动态状态，V3加入自动分组。", unitIds: ["u3"] }] },
  ], { u2: { verdict: "superseded" as never, at: 1 }, u3: confirmedVerdict });
  ledger.batches[0].units[1] = { ...units[1], adoption: { status: "rejected" } } as WikiKnowledgeUnit;
  ledger.decisions = { u3: confirmedVerdict };
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).not.toContain("现行方案明确了");
  expect(body).not.toContain("V1替换首页大月历");
  expect(body.split("### 早先版本")[1]).toContain("- 此前曾提出减少首屏密度仅保留核心要素的方案。");
});

it("drops a row's empty fields, tells a question the user asked as theirs, and keeps an earlier version's borrowed figures with the current point", () => {
  const asked = unit(1, "需评估转向自信自律方向后的市场竞争状况及发展前景。", { evidence: { evidenceId: "e1", conversationId: "c", messageId: "m1", messageIndex: 1, role: "user", pasted: false, quote: "这个方向竞争怎么样前景怎么样？" } } as Partial<WikiKnowledgeUnit>);
  const report = unit(2, "日活约40，整体留存率略高于40%。", { kind: "report" });
  const tiers = unit(3, "建议推出7天体验、30天计划（¥19.9）、90天计划（¥49.9）。");
  const earlier = unit(4, "初期采用免费核心功能加一次性“30天AI守护计划”付费模式，暂不做周订阅。", { adoption: { status: "rejected" } } as Partial<WikiKnowledgeUnit>);
  const row = "- **当前报告**：日活 (DAU)：约40；核心用户数：-；整体留存率：略高于40%";
  const before = "此前曾规划初期采用一次性“30天AI守护计划”付费模式，暂不做周订阅，包含前7天免费体验、30天¥19.9及90天¥49.9等档位。";
  const ledger = oneChapter([asked, report, tiers, earlier], [
    { subtopic: "增长", text: "需评估转向自信自律方向后的市场竞争状况及发展前景。", unitIds: ["u1"], claims: [{ text: "需评估转向自信自律方向后的市场竞争状况及发展前景。", unitIds: ["u1"] }] },
    { subtopic: "增长", text: row, unitIds: ["u2"], claims: [] },
    { subtopic: "增长", text: tiers.statement, unitIds: ["u3"], claims: [{ text: tiers.statement, unitIds: ["u3"] }] },
    { subtopic: "早先版本", text: before, unitIds: ["u4"], claims: [{ text: before, unitIds: ["u4"] }] },
  ]);
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).toContain("你提出需评估转向自信自律方向");
  expect(body).toContain("- **当前报告**：日活 (DAU)约40；整体留存率略高于40%");
  expect(body).toContain("此前曾规划初期采用一次性“30天AI守护计划”付费模式，暂不做周订阅。");
  expect(body).not.toContain("等档位");
});

it("restores a broken-off item, drops a row told on the wrong point, and tells suggestions as suggestions", () => {
  const grade = unit(1, "系统根据时间、诱因、保护因素加权计算风险分数，分为低风险、需要注意、高风险和立即干预四个等级。");
  const button = unit(2, "中央悬浮“+”号含义不明，建议改为盾牌图标并标注“守护”。");
  const daily = unit(3, "AI生成每日任务时需读取历史失守时间、高频诱因、当前状态、睡眠情绪记录，并展示一句基于数据的理由。");
  const rescue = unit(4, "紧急状态下弹窗优化为单步骤倒计时流程，点击主按钮后其他入口收起。");
  const table = "| 模块 | 负责 |\n| --- | --- |\n| 核心任务 | 读取历史失序、高频诱因、状态、睡眠情绪记录，展示基于数据的理由 |";
  const ledger = oneChapter([grade, button, daily, rescue], [
    { subtopic: "模型", text: "- **风险分级**：系统根据时间、诱因、保护因…", unitIds: ["u1"], claims: [{ text: "系统根据时间、诱因、保护因…", unitIds: ["u1"] }] },
    { subtopic: "边界", text: table, unitIds: ["u2"], claims: [{ text: "读取历史失序、高频诱因、状态、睡眠情绪记录，展示基于数据的理由", unitIds: ["u2"] }] },
    { subtopic: "边界", text: daily.statement, unitIds: ["u3"], claims: [{ text: daily.statement, unitIds: ["u3"] }] },
    { subtopic: "急救", text: `首页按钮的状态逻辑存在版本差异。此前推荐的最终结构为${rescue.statement}补充决策指出，界面应减少选择负担。`, unitIds: ["u4"], claims: [{ text: rescue.statement, unitIds: ["u4"] }] },
  ]);
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).toContain("- **风险分级**：系统根据时间、诱因、保护因素加权计算风险分数，分为低风险、需要注意、高风险和立即干预四个等级。");
  expect(body).not.toContain("失序");
  expect(body).toContain("AI 推荐的结构为紧急状态下弹窗");
  expect(body).toContain("补充建议指出");
  expect(body).not.toContain("存在版本差异");
});

it("notes a step given another length than the confirmed plan gives it", () => {
  const plan = unit(1, "分三版迭代：第一版保留原成长区；第二版增加10分钟守护、60秒复盘、风险报告。");
  const told = unit(2, "破戒后不清零所有记录，通过60秒快速复盘保留成长记录，以降低挫败感。");
  const other = unit(3, "失守后应避免强调清零，而是提供低负担的30秒复盘，保留成长数据。");
  const evening = unit(4, "通过每日晚间30秒复盘制造回访理由。");
  const notes = lengthAgainstDecided([plan, told, other, evening], id => id === "u1" ? "confirmed" : "proposal", true);
  expect(notes.map(item => item.unitIds)).toEqual([["u3"]]);
  expect(notes[0].note).toContain("你确认的规划为60秒复盘");
});

it("drops the empty field of a line of fields with no label", () => {
  const report = unit(1, "日活约40，活跃留存率略高于40%，付费率较低。", { kind: "report" });
  const line = "日活 (DAU)：约40；核心用户数：-；备注：活跃留存率略高于40%，付费率较低";
  const body = ledgerDocument(oneChapter([report], [{ subtopic: "留存", text: line, unitIds: ["u1"], claims: [] }]), {}).sections[0].body;
  expect(body).toContain("日活 (DAU)约40；活跃留存率略高于40%，付费率较低。");
});

it("keeps a bare table label on its own point, not on a later one naming the same metric", () => {
  const earlier = unit(1, "日活约30人（近期降至22人）。", { kind: "report" }), later = unit(2, "当前小程序日活（DAU）约40。", { kind: "report" });
  expect(claimSourceUnits("日活 (DAU)", [earlier], [earlier, later])).toEqual([earlier]);
});

it("opens a chapter whose opening only repeats its first paragraph with the decision the user confirmed", () => {
  const units = [unit(1, "项目定位为垂直、科学可信的个人行为恢复系统，通过算法识别高危时间和诱因并匹配干预。", { evidence: { evidenceId: "e1", conversationId: "c", messageId: "m1", messageIndex: 1, role: "user", pasted: false, quote: "项目定位为垂直、科学可信的个人行为恢复系统" } } as Partial<WikiKnowledgeUnit>), unit(2, "先深耕“戒色”单一垂直领域，待核心闭环和留存稳定后再扩展至泛自律工具。")];
  const ledger = oneChapter(units, [
    { subtopic: "定义", text: units[0].statement, unitIds: ["u1"], claims: [{ text: units[0].statement, unitIds: ["u1"] }] },
    { subtopic: "定义", text: "现行决定是先深耕“戒色”单一垂直领域，待核心闭环和留存稳定后再扩展至泛自律工具。", unitIds: ["u2"], claims: [{ text: "现行决定是先深耕“戒色”单一垂直领域，待核心闭环和留存稳定后再扩展至泛自律工具。", unitIds: ["u2"] }] },
  ], { u2: confirmedVerdict });
  const chapter = ledger.draft!.chapters[0];
  chapter.body = `产品定位为垂直、科学可信的个人行为恢复系统，通过算法识别高危时间和诱因并匹配干预。\n\n${chapter.body}`;
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body.startsWith("决定先深耕“戒色”单一垂直领域")).toBe(true);
  expect(body.match(/深耕/gu)).toHaveLength(1);
});

it("drops the opening's clause the paragraph under it says in full", () => {
  const units = [unit(1, "优先通过低成本渠道验证和内容引流，实施匿名裂变。"), unit(2, "在达到日活稳定超过100、有一批连续使用30天以上的用户、7日留存比较稳定这些状态前，暂时不做大型新方向。")];
  const ledger = oneChapter(units, [{ subtopic: "获客", text: units[1].statement, unitIds: ["u2"], claims: [{ text: units[1].statement, unitIds: ["u2"] }] }], {}, ["u1"]);
  const chapter = ledger.draft!.chapters[0];
  chapter.body = `核心策略是优先通过低成本渠道验证和内容引流，实施匿名裂变，并在日活稳定超过100、拥有连续使用30天以上用户群等状态达成前，暂不开发大型新方向。\n\n${chapter.body}`;
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body.split("\n\n")[0]).toBe("核心策略是优先通过低成本渠道验证和内容引流，实施匿名裂变。");
});

it("drops an earlier figure another sentence gives whole, and tells an older report after the latest figure as earlier", () => {
  const user = (n: number, statement: string) => unit(n, statement, { kind: "report", evidence: { evidenceId: `e${n}`, conversationId: "c", messageId: `m${n}`, messageIndex: n, role: "user", pasted: false, quote: statement } } as Partial<WikiKnowledgeUnit>);
  const told = unit(1, "日活稳定在22人，其中15人为连续使用的核心用户，占比约68%。", { kind: "report" });
  const latest = user(2, "当前小程序日活约40，付费率较低；此前每天稳定在22人，其中15个为稳定用户。"), older = user(3, "日活停留在32人左右，难以突破40人。");
  const now = "当前小程序日活约40（8月18日），付费率较低；此前报告每天稳定在22人（6月14日—7月7日），其中15个为稳定用户。";
  const before = "**你反馈日活停留在32人左右（6月14日—7月7日）**，难以突破40人。";
  const ledger = oneChapter([told, latest, older], [
    { subtopic: "留存", text: "当时日活稳定在22人（6月14日—7月7日），其中15人为连续使用的核心用户，占比约68%。", unitIds: ["u1"], claims: [{ text: "当时日活稳定在22人（6月14日—7月7日），其中15人为连续使用的核心用户，占比约68%。", unitIds: ["u1"] }] },
    { subtopic: "诊断", text: now, unitIds: ["u2"], claims: [{ text: now, unitIds: ["u2"] }] },
    { subtopic: "诊断", text: before, unitIds: ["u3"], claims: [{ text: "你反馈日活停留在32人左右（6月14日—7月7日）**，难以突破40人。", unitIds: ["u3"] }] },
  ]);
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).not.toContain("此前报告每天稳定在22人");
  expect(body).toContain("付费率较低。此前你反馈日活停留在32人左右（6月14日—7月7日）");
});

it("tells an earlier version saying what should be as a suggestion", () => {
  const units = [unit(1, "首页最大按钮不应常驻“进入恢复中心”，而应根据用户状态动态变化。")];
  const text = "- 此前首页最大按钮不应常驻“进入恢复中心”，而应根据用户状态动态变化。";
  const ledger = oneChapter(units, [{ subtopic: "早先版本", text, unitIds: ["u1"], claims: [{ text: text.slice(2), unitIds: ["u1"] }] }]);
  expect(ledgerDocument(ledger, {}).sections[0].body).toContain("- 此前建议首页最大按钮不应常驻");
});

it("tells what outgrew the AI's central-button suggestion: the user's idea and the reply taking it up", () => {
  const suggestion = unit(1, "中央悬浮“+”号含义不明，建议改为盾牌图标并标注“守护”。", { kind: "decision" });
  const mine = unit(2, "中间按钮点击后跳转到AI页面。", { kind: "decision", evidence: { evidenceId: "e2", conversationId: "c", messageId: "m2", messageIndex: 2, role: "user", pasted: false, quote: "" } });
  const adopted = unit(3, "采纳中间按钮跳转AI的方向，任务与复盘由AI主导。", { kind: "decision" });
  expect(outgrownCentralBy([suggestion, mine, adopted], () => "proposal").get("u1")).toEqual(["u2", "u3"]);
});

it("drops an earlier report a current sentence gives whole, never leaving its leaning clause, and the AI's clause repeating the user's figure", () => {
  const user = (n: number, statement: string, conversationId = "c") => unit(n, statement, { kind: "report", evidence: { evidenceId: `e${n}`, conversationId, messageId: `m${n}`, messageIndex: n, role: "user", pasted: false, quote: statement } } as Partial<WikiKnowledgeUnit>);
  const told = unit(1, "日活稳定在22人，其中15人为连续使用的核心用户，占比约68%。", { kind: "report" });
  const earlier = unit(2, "小程序每天稳定在22人，其中15个为稳定用户。", { kind: "report", adoption: { status: "rejected" } } as Partial<WikiKnowledgeUnit>);
  const stuck = user(3, "日活停留在32人左右，难以突破40人。", "c2"), small = user(4, "日活仅25，推广难。", "c1");
  const ai = unit(5, "主要问题在于新增、回访或唤醒机制未打通，而非产品失败。");
  const now = "当时日活稳定在22人（6月14日—7月7日），其中15人为连续使用的核心用户，占比约68%。";
  const before = "- 此前报告称每天稳定在22人（6月14日—7月7日），其中15个为稳定用户。";
  const reports = "你提到日活停留在32人左右（6月14日—7月7日），难以突破40人。当时日活仅25（6月6日），推广难。";
  const item = "当时DAU卡在32左右（6月14日—7月7日），主要问题在于新增、回访或唤醒机制未打通，而非产品失败。";
  const ledger = oneChapter([told, earlier, stuck, small, ai], [
    { subtopic: "诊断", text: now, unitIds: ["u1"], claims: [{ text: now, unitIds: ["u1"] }] },
    { subtopic: "诊断", text: `- **机制未打通**：${item}`, unitIds: ["u5"], claims: [{ text: item, unitIds: ["u5"] }] },
    { subtopic: "诊断", text: reports, unitIds: ["u3", "u4"], claims: [{ text: "你提到日活停留在32人左右（6月14日—7月7日），难以突破40人。", unitIds: ["u3"] }, { text: "当时日活仅25（6月6日），推广难。", unitIds: ["u4"] }] },
    { subtopic: "早先版本", text: before, unitIds: ["u2"], claims: [{ text: before.slice(2), unitIds: ["u2"] }] },
  ]);
  const section = ledgerDocument(ledger, {}).sections[0];
  expect(section.body).not.toContain("15个为稳定用户");
  expect(section.body).not.toContain("早先版本");
  expect(section.body).toContain("- **机制未打通**：主要问题在于新增");
  expect(section.claims?.find(claim => claim.text.startsWith("你提到日活停留在32人"))?.holderMark).toBe(true);
});

it("puts the user's decision after an opening that tells none, and tells the earlier versions plainly", () => {
  const units = [unit(1, "产品定位为帮助用户管理冲动行为的AI守护系统。"), unit(2, "先深耕“戒色”单一垂直领域，待核心闭环和留存稳定后再扩展至泛自律工具。"), unit(3, "采用系统自动分配同期小组。"), unit(4, "付费墙在第3天出现。"), unit(5, "顶部指标改为当前连续天数。")];
  const turned = "你否定了采用系统自动分配同期小组的决定。";
  const ledger = oneChapter(units, [
    { subtopic: "定义", text: "目标用户为18-25岁成年男性，首页呈现为守护驾驶舱。", unitIds: ["u1"], claims: [] },
    { subtopic: "定义", text: "决定先深耕“戒色”单一垂直领域，待核心闭环和留存稳定后再扩展至泛自律工具。", unitIds: ["u2"], claims: [{ text: "决定先深耕“戒色”单一垂直领域，待核心闭环和留存稳定后再扩展至泛自律工具。", unitIds: ["u2"] }] },
    { subtopic: "早先版本", text: turned, unitIds: ["u3"], claims: [{ text: turned, unitIds: ["u3"] }] },
    { subtopic: "早先版本", text: "- **早期方案**：此前建议付费墙在第3天出现。\n- **顶部指标**: 此前曾建议改为当前连续天数。", unitIds: ["u4", "u5"], claims: [{ text: "此前建议付费墙在第3天出现。", unitIds: ["u4"] }, { text: "此前曾建议改为当前连续天数。", unitIds: ["u5"] }] },
  ], { u2: confirmedVerdict }, ["u1"]);
  const chapter = ledger.draft!.chapters[0];
  chapter.body = `产品定位为帮助用户管理冲动行为的AI守护系统。\n\n${chapter.body}`;
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body.split("\n\n")[0]).toBe("产品定位为帮助用户管理冲动行为的AI守护系统。决定先深耕“戒色”单一垂直领域，待核心闭环和留存稳定后再扩展至泛自律工具。");
  expect(body).toContain("小组的方案");
  expect(body).toContain("- 此前建议付费墙在第3天出现。");
  expect(body).toContain("- **顶部指标**：此前曾建议");
});

it("tells a row's catch-all fields as one sentence, gives back a statement's dropped head, and tells earlier items as suggestions", () => {
  const user = (n: number, statement: string) => unit(n, statement, { kind: "report", evidence: { evidenceId: `e${n}`, conversationId: "c", messageId: `m${n}`, messageIndex: n, role: "user", pasted: false, quote: statement } } as Partial<WikiKnowledgeUnit>);
  const dau = user(1, "日活约40，活跃留存率略高于40%，付费率较低。"), viral = unit(2, "实施“匿名裂变”，生成不含敏感词的打卡海报引导分享。"), task = unit(3, "将“今日任务0/7”改为“今日重点0/1”。");
  const field = "- 日活 (DAU)：约40；留存/其他指标：活跃留存率略高于40%，付费率较低";
  const tail = "生成不含敏感词的打卡海报引导分享。";
  const earlier = "- **任务展示逻辑**：将“今日任务0/7”改为“今日重点0/1”。";
  const ledger = oneChapter([dau, viral, task], [
    { subtopic: "现状", text: field, unitIds: ["u1"], claims: [{ text: "约40", unitIds: ["u1"] }, { text: "活跃留存率略高于40%，付费率较低", unitIds: ["u1"] }] },
    { subtopic: "获客", text: tail, unitIds: ["u2"], claims: [{ text: tail, unitIds: ["u2"] }] },
    { subtopic: "早先版本", text: earlier, unitIds: ["u3"], claims: [{ text: earlier.slice(14), unitIds: ["u3"] }] },
  ]);
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).toContain("- 日活 (DAU)约40；活跃留存率略高于40%，付费率较低。");
  expect(body).toContain("实施“匿名裂变”，生成不含敏感词的打卡海报");
  expect(body).toContain("- **任务展示逻辑**：此前建议将“今日任务0/7”");
});

it("tells the user's question joined on with 此外 as theirs, an AI item naming no time as the suggestion it was, a block among the earlier versions as one, and drops an earlier row a current sentence gives whole", () => {
  const user = (n: number, statement: string, kind: WikiKnowledgeUnit["kind"] = "report") => unit(n, statement, { kind, evidence: { evidenceId: `e${n}`, conversationId: "c", messageId: `m${n}`, messageIndex: n, role: "user", pasted: false, quote: statement } } as Partial<WikiKnowledgeUnit>);
  const asked = { ...user(1, "需评估转向自信自律方向后的市场竞争状况及发展前景。", "fact") };
  asked.evidence = { ...asked.evidence, quote: "这个方向竞争怎么样前景怎么样？" };
  const now = unit(2, "日活稳定在22人，其中15人为连续使用的核心用户。", { kind: "report" }), row = user(3, "小程序每天稳定在22人，其中15个为稳定用户。");
  const button = unit(4, "中央AI按钮在首页已有Agent的情况下缩小尺寸。"), labelled = unit(5, "破戒后提供30秒结构化复盘。");
  const sketch = "*讨论中的原文代码 · AI 建议，未确认*\n\n```text\n今晚整体风险：低\n```";
  const ledger = oneChapter([asked, now, row, button, labelled], [
    { subtopic: "获客", text: `此外，${asked.statement}`, unitIds: ["u1"], claims: [{ text: `此外，${asked.statement}`, unitIds: ["u1"] }] },
    { subtopic: "诊断", text: "当时日活稳定在22人，其中15人为连续使用的核心用户。", unitIds: ["u2"], claims: [{ text: "当时日活稳定在22人，其中15人为连续使用的核心用户。", unitIds: ["u2"] }] },
    { subtopic: "早先版本", text: "- **日活 (DAU)**：22人；核心用户数15个；其中15个为稳定用户。", unitIds: ["u3"], claims: [{ text: "22人", unitIds: ["u3"] }, { text: "15个", unitIds: ["u3"] }, { text: "其中15个为稳定用户", unitIds: ["u3"] }] },
    { subtopic: "早先版本", text: `- ${button.statement}`, unitIds: ["u4"], claims: [{ text: button.statement, unitIds: ["u4"] }] },
    { subtopic: "早先版本", text: "- **复盘（早期方案）**：提供30秒结构化复盘。", unitIds: ["u5"], claims: [{ text: "提供30秒结构化复盘。", unitIds: ["u5"] }] },
    { subtopic: "早先版本", text: sketch, unitIds: ["u4"], claims: [] },
  ]);
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).toContain("你提出需评估转向自信自律方向");
  expect(body).not.toContain("此外");
  expect(body).not.toContain("15个为稳定用户");
  expect(body).toContain("- 此前建议中央AI按钮在首页已有Agent的情况下缩小尺寸。");
  expect(body).toContain("- **复盘（早期方案）**：提供30秒结构化复盘。");
  expect(body).toContain("*讨论中的原文代码 · 早期版本，已被替换*");
});

it("tells versions of one measure by their days, an older figure as then, drops the AI's figure the user never gave, and lists rejections", () => {
  const on = (month: number, day: number) => ({ start: new Date(2026, month - 1, day, 12).getTime(), end: new Date(2026, month - 1, day, 13).getTime() });
  const user = (n: number, statement: string, span: ReturnType<typeof on>) => unit(n, statement, { kind: "report", evidence: { evidenceId: `e${n}`, conversationId: `c${n}`, messageId: `m${n}`, messageIndex: n, role: "user", pasted: false, quote: statement, conversationSpan: span } } as Partial<WikiKnowledgeUnit>);
  const june = user(1, "小程序每天稳定在22人，其中15个为稳定用户。", on(6, 14)), stuck = user(2, "日活停留在32人左右，难以突破40人。", on(6, 14)), august = user(3, "当前小程序日活（DAU）约40，付费率较低。", on(8, 18));
  const ai = unit(4, "日活约30人（近期降至22人），整体留存率较低。", { kind: "fact", evidence: { ...unit(4, "").evidence, role: "assistant" } } as Partial<WikiKnowledgeUnit>);
  const refusedA = unit(5, "采用系统自动分配同期小组。", { adoption: { status: "rejected" } } as Partial<WikiKnowledgeUnit>), refusedB = unit(6, "用户开始计划后自动分配至守护小组。", { adoption: { status: "rejected" } } as Partial<WikiKnowledgeUnit>);
  const table = "| 指标 | 数值/状态 | 来源/备注 |\n| --- | --- | --- |\n| 日活 (DAU) | 22人 | 其中15个为稳定用户 |\n| 日活 (DAU) | 约40 | 付费率较低 |";
  const ledger = oneChapter([june, stuck, august, ai, refusedA, refusedB], [
    { subtopic: "留存", text: table, unitIds: ["u1", "u3"], claims: [{ text: "日活 (DAU)", unitIds: ["u1"] }, { text: "22人", unitIds: ["u1"] }, { text: "日活 (DAU)", unitIds: ["u3"] }, { text: "约40", unitIds: ["u3"] }] },
    { subtopic: "诊断", text: "日活约30人（近期降至22人）。整体留存率较低。", unitIds: ["u4"], claims: [{ text: "日活约30人（近期降至22人）。", unitIds: ["u4"] }] },
    { subtopic: "早先版本", text: "你否定了采用系统自动分配同期小组。你否定了用户开始计划后自动分配至守护小组。", unitIds: ["u5", "u6"], claims: [{ text: "你否定了采用系统自动分配同期小组。", unitIds: ["u5"] }, { text: "你否定了用户开始计划后自动分配至守护小组。", unitIds: ["u6"] }] },
  ], {}, ["u2"]);
  const chapter = ledger.draft!.chapters[0];
  chapter.body = `针对当前日活卡在32人左右且难以突破40人的瓶颈，需打通回访。\n\n${chapter.body}`;
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).toContain("| 时间 | 日活 (DAU) | 来源/备注 |");
  expect(body.indexOf("| 6月14日 | 22人")).toBeLessThan(body.indexOf("| 8月18日 | 约40"));
  expect(body).toContain("针对当时日活卡在32人左右（6月14日）且难以突破40人");
  expect(body).not.toContain("约30");
  expect(body).toContain("你否定过这些方案：\n- 采用系统自动分配同期小组。\n- 用户开始计划后自动分配至守护小组。");
});

it("tells a one-row version table as a dated sentence, drops a sentence telling only a change, joins a follow-on item and moves an earlier paragraph out", () => {
  const on = (month: number, day: number) => ({ start: new Date(2026, month - 1, day, 12).getTime(), end: new Date(2026, month - 1, day, 13).getTime() });
  const august = unit(1, "当前小程序日活（DAU）约40，活跃留存率略高于40%，付费率较低。", { kind: "fact", evidence: { evidenceId: "e1", conversationId: "c1", messageId: "m1", messageIndex: 1, role: "user", pasted: false, quote: "日活卡在40了，活跃留存只有40%多", conversationSpan: on(8, 18) } } as Partial<WikiKnowledgeUnit>);
  const merged = unit(2, "将分散模块合并为单一的“今日任务”卡片。"), upgraded = unit(3, "将今日任务升级为“今天只做这一件事”。");
  const entry = unit(4, "早期曾将“我现在有冲动”和“刚刚失守”设为一级紧急入口。"), flow = unit(5, "紧急干预采用分步急救流程。"), now = unit(6, "首页仅展示最近7天记录。");
  const table = "| 阶段/时间点 | 日活(DAU) | 核心/稳定用户 | 留存率指标 |\n| --- | --- | --- | --- |\n| 当前报告 | 约40 | - | 活跃留存率略高于40% |";
  const items = "- 此前将分散模块合并为单一的“今日任务”卡片。\n- 随后进一步升级为“今天只做这一件事”。";
  const paragraphs = [
    { subtopic: "留存", text: table, unitIds: ["u1"], claims: [{ text: "当前报告", unitIds: ["u1"] }, { text: "约40", unitIds: ["u1"] }, { text: "活跃留存率略高于40%", unitIds: ["u1"] }] },
    { subtopic: "首页", text: "首屏信息密度经过多轮优化。首页仅展示最近7天记录。", unitIds: ["u6"], claims: [{ text: "首页仅展示最近7天记录。", unitIds: ["u6"] }] },
    { subtopic: "急救", text: "紧急干预采用分步急救流程。", unitIds: ["u5"], claims: [{ text: "紧急干预采用分步急救流程。", unitIds: ["u5"] }] },
    { subtopic: "急救", text: entry.statement, unitIds: ["u4"], claims: [{ text: entry.statement, unitIds: ["u4"] }] },
    { subtopic: "早先版本", text: items, unitIds: ["u2", "u3"], claims: [{ text: "此前将分散模块合并为单一的“今日任务”卡片。", unitIds: ["u2"] }, { text: "随后进一步升级为“今天只做这一件事”。", unitIds: ["u3"] }] },
  ];
  const all = [august, merged, upgraded, entry, flow, now];
  const ledger = oneChapter(all, paragraphs);
  ledger.organization!.topics = [{ id: "t", name: "急救", current: ["u5"], earlier: ["u2", "u3", "u4"], open: false }] as never;
  const [section] = ledgerDocument(ledger, {}).sections;
  const [current, earlier] = section.body.split("### 早先版本");
  expect(current).toContain("日活(DAU)约40；活跃留存率略高于40%（8月18日）。");
  expect(current).not.toMatch(/\| 当前报告|多轮优化|一级紧急入口/u);
  expect(current).toContain("首页仅展示最近7天记录。");
  expect(earlier).toContain("- 早期曾将“我现在有冲动”和“刚刚失守”设为一级紧急入口。");
  expect(earlier).toContain("“今日任务”卡片，随后进一步升级为“今天只做这一件事”。");
  expect(earlier).not.toMatch(/^- 随后/mu);
});

it("keeps a figure's magnitude, tells turned-down points as theirs, tells the user's idea as theirs and opens a heading-first chapter on its decision", () => {
  const brain = unit(1, "海外竞品Brainbuddy在Google Play显示已有50万次以上下载和约2.88万条评价，验证了付费意愿。", { kind: "fact" });
  const autoGroup = unit(2, "用户开始计划后自动分配至守护小组，作为每日回访的社交理由。"), entry = unit(3, "群组入口应从“寻找组织”改为展示自动分配后的真实小组进度。");
  const idea = unit(4, "建议将侧重点从戒色限制转向帮助青少年男性找回自信和自律。", { evidence: { ...unit(4, "").evidence, role: "user", quote: "建议将侧重点从戒色限制转向帮助青少年男性找回自信和自律" } } as Partial<WikiKnowledgeUnit>);
  const adult = unit(5, "为避免未成年人内容治理风险，明确将目标用户定位为18-25岁成年男性，而非青少年。");
  const plan = unit(6, "分三版迭代：第一版保留原成长区；第二版增加10分钟守护；第三版加入小组任务。", { kind: "decision" }), rule = unit(7, "坚持产品先变，品牌后变的原则。");
  const row = "| 产品名称 | 下载规模 | 付费情况 |\n| --- | --- | --- |\n| Brainbuddy | 50 万次以上下载 | 约 2.88 条评价 |";
  const declined = "- 此前曾提出用户开始计划后自动分配至守护小组作为每日回访的社交理由，以及群组入口从“寻找组织”改为展示自动分配后的真实小组进度，但这些手动创建或寻找战友的入口已被否定。";
  const told = "早期曾建议将侧重点从戒色限制转向帮助青少年男性找回自信和自律，后为避免未成年人内容治理风险，明确将目标用户定位为18-25岁成年男性。";
  const list = "- **版本规划**：分三版迭代：第一版保留原成长区；第二版增加10分钟守护；第三版加入小组任务。\n- **原则**：坚持产品先变，品牌后变的原则。";
  const ledger = oneChapter([brain, autoGroup, entry, idea, adult, plan, rule], [
    { subtopic: "竞品", text: row, unitIds: ["u1"], claims: [{ text: "Brainbuddy", unitIds: ["u1"] }, { text: "约 2.88 条评价", unitIds: ["u1"] }] },
    { subtopic: "定位", text: told, unitIds: ["u5"], claims: [{ text: told, unitIds: ["u5"] }] },
    { subtopic: "路线", text: list, unitIds: ["u6", "u7"], claims: [{ text: "分三版迭代：第一版保留原成长区；第二版增加10分钟守护；第三版加入小组任务。", unitIds: ["u6"] }, { text: "坚持产品先变，品牌后变的原则。", unitIds: ["u7"] }] },
    { subtopic: "早先版本", text: declined, unitIds: ["u2", "u3"], claims: [{ text: declined.slice(2), unitIds: ["u2", "u3"] }] },
  ], { u2: rejected, u3: rejected, u6: confirmedVerdict });
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).toContain("约 2.88 万条评价");
  expect(body).toContain("你此前曾提出将侧重点从戒色限制转向帮助青少年男性找回自信和自律。");
  expect(body).toContain("后来为避免未成年人内容治理风险，明确将目标用户定位为18-25岁成年男性。");
  expect(body).not.toContain("寻找战友的入口已被否定");
  expect(body).toContain("否定了「用户开始计划后自动分配至守护小组，作为每日回访的社交理由」");
  expect(body.startsWith("分三版迭代：")).toBe(true);
});

it("tells a labelled rejected item as the user's, drops a sentence repeating a code line, moves an earlier table row and keeps today's prices off an earlier plan", () => {
  const cockpit = unit(1, "首屏100%为AI Agent驾驶舱，原日历、任务等功能下移作为Agent的执行结果。"), plan = unit(2, "第一版不训练深度学习模型，而是采用规则评分方案。", { kind: "decision" });
  const roleA = unit(3, "AI生成每日任务时需读取历史失守时间。"), roleB = unit(4, "AI不负责直接判定风险等级。"), button = unit(5, "中央悬浮“+”号含义不明，建议改为盾牌图标并标注“守护”。");
  const once = unit(6, "初期采用免费核心功能加一次性“30天AI守护计划”付费模式，暂不做强制会员或周订阅。");
  const table = "| 模块 | 负责 |\n| --- | --- |\n| 每日任务生成 | AI生成每日任务时需读取历史失守时间。|\n| 中央悬浮按钮 | 中央悬浮“+”号含义不明，建议改为盾牌图标并标注“守护”。|\n| 风险判定 | AI不负责直接判定风险等级。|";
  const block = "```text\n基础风险 = 当前时间段历史风险 × 30%\n\n诱因风险：\n当前独处 +10\n```";
  const earlierPlan = "- 初期曾提出免费核心功能加一次性“30天AI守护计划”的模式，暂不做强制会员或周订阅（含30天¥19.9、90天¥49.9）。";
  const ledger = oneChapter([cockpit, plan, roleA, roleB, button, once], [
    { subtopic: "模型", text: "第一版不训练深度学习模型，而是采用规则评分方案。基础风险 = 当前时间段历史风险 × 30%。", unitIds: ["u2"], claims: [{ text: "第一版不训练深度学习模型，而是采用规则评分方案。", unitIds: ["u2"] }, { text: "基础风险 = 当前时间段历史风险 × 30%。", unitIds: ["u2"] }] },
    { subtopic: "模型", text: block, unitIds: [], claims: [] },
    { subtopic: "角色", text: table, unitIds: ["u3", "u4", "u5"], claims: [{ text: "每日任务生成", unitIds: ["u3"] }, { text: "AI生成每日任务时需读取历史失守时间。", unitIds: ["u3"] }, { text: "中央悬浮按钮", unitIds: ["u5"] }, { text: "中央悬浮“+”号含义不明，建议改为盾牌图标并标注“守护”。", unitIds: ["u5"] }, { text: "风险判定", unitIds: ["u4"] }, { text: "AI不负责直接判定风险等级。", unitIds: ["u4"] }] },
    { subtopic: "早先版本", text: `- **AI Agent驾驶舱**：负责：首屏100%为AI Agent驾驶舱，原日历、任务等功能下移作为Agent的执行结果。（已否定）。\n${earlierPlan}`, unitIds: ["u1", "u6"], claims: [{ text: "AI Agent驾驶舱", unitIds: ["u1"] }, { text: "首屏100%为AI Agent驾驶舱，原日历、任务等功能下移作为Agent的执行结果。（已否定）", unitIds: ["u1"] }, { text: earlierPlan.slice(2), unitIds: ["u6"] }] },
  ], { u1: rejected });
  ledger.organization!.topics = [{ id: "t", name: "按钮", current: ["u3"], earlier: ["u5", "u6"], open: false }] as never;
  const body = ledgerDocument(ledger, {}).sections[0].body;
  const [current, earlier] = body.split("### 早先版本");
  expect(current).not.toContain("规则评分方案。基础风险");
  expect(current).toContain("基础风险 = 当前时间段历史风险 × 30%\n");
  expect(current).not.toContain("中央悬浮");
  expect(current).toContain("| 风险判定 | AI不负责直接判定风险等级。|");
  expect(earlier).toContain("- 你否定了「首屏100%为AI Agent驾驶舱，原日历、任务等功能下移作为Agent的执行结果」的方案。");
  expect(earlier).not.toMatch(/负责：|（已否定）/u);
  expect(earlier).toContain("中央悬浮“+”号含义不明，此前建议改为盾牌图标");
  expect(earlier).not.toContain("¥19.9");
});

it("drops an opening's sentence telling one side of a point left open, keeping the rest of the opening", () => {
  const download = unit(1, "将“导出按钮”改为“下载报表”。", { kind: "decision", subject: "报表页" }), pdf = unit(2, "将“导出按钮”改为“生成PDF”。", { kind: "decision", subject: "报表页" });
  const monthly = unit(3, "图表默认按月汇总。", { kind: "decision", subject: "报表页" });
  expect(differingPlans([download, pdf, monthly], () => "proposal", true).length).toBeGreaterThan(0);
  const opening = "报表页将“导出按钮”改为“下载报表”。图表默认按月汇总。";
  const chapter = { id: "ch", title: "报表", question: "?", group: "", subtopics: [{ title: "报表页", subjectIds: ["s"] }] };
  const ledger = ledgerOf([download, pdf, monthly], {
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "报表页", aliases: [], unitIds: ["u1", "u2", "u3"] }], merged: [], relations: [], report: {}, chapters: [chapter] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ ...chapter, body: `${opening}\n\n### 报表页\n\n${pdf.statement}`, openingUnitIds: ["u1", "u3"], problems: [], paragraphs: [{ subtopic: "报表页", text: pdf.statement, unitIds: ["u2"], claims: [] }] }] },
  });
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).toMatch(/版本未定/u);
  expect(body.split("\n### ")[0]).not.toContain("下载报表");
  expect(body.startsWith("图表默认按月汇总。")).toBe(true);
});

it("tells a plan turned down by an answer with what was chosen instead, however the writer opened it", () => {
  const once = unit(1, "首年采用一次性买断授权，买断价¥999。", { kind: "plan", subject: "计费" }), monthly = unit(2, "按月订阅，每席位¥29。", { kind: "plan", subject: "计费" });
  const question: WikiWritingQuestion = { id: "ask", about: "计费方式", ask: "买断还是订阅？", unitIds: [once.id, monthly.id], organization: 1,
    options: [{ id: "buy", label: "一次性买断", actions: [{ do: "confirm", units: [once.id] }, { do: "reject", units: [monthly.id] }] }, { id: "sub", label: "按月订阅", actions: [{ do: "reject", units: [once.id] }, { do: "confirm", units: [monthly.id] }] }] };
  const told = "- 此前曾提议首年采用一次性买断授权，买断价¥999，该方案已被否定。";
  const chapter = { id: "ch", title: "计费", question: "?", group: "", subtopics: [{ title: "早先版本", subjectIds: ["s"] }] };
  const ledger = ledgerOf([once, monthly], {
    writingQuestions: [question], userAnswers: [{ questionId: "ask", question: question.ask, answer: "按月订阅", optionId: "sub", at: 2, unitIds: question.unitIds }],
    decisions: { [once.id]: { verdict: "rejected", at: 2 }, [monthly.id]: { verdict: "confirmed", at: 2 } },
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "计费", aliases: [], unitIds: ["u1", "u2"] }], merged: [], relations: [], report: {}, chapters: [chapter] },
    draft: { version: 1, generatedAt: 0, status: "complete", report: {}, chapters: [{ ...chapter, body: `### 早先版本\n\n${told}`, problems: [], paragraphs: [{ subtopic: "早先版本", text: told, unitIds: ["u1"], claims: [{ text: told.slice(2), unitIds: ["u1"] }] }] }] },
  });
  const body = ledgerDocument(ledger, {}).sections[0].body;
  expect(body).toContain("你在回答中否定了「首年采用一次性买断授权，买断价¥999」的方案，选择了「按月订阅」。");
  expect(body).not.toContain("该方案已被否定");
});
