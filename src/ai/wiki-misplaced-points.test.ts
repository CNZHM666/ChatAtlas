import { expect, it } from "vitest";
import { routeWikiUnits, wikiUnitLane } from "./wiki-unit-routing";
import { explicitExclusions, userAskedOnly, withUserQuestionsAsked } from "./wiki-user-questions";
import { openingRepeatsTrimmed } from "./wiki-knowledge-write";
import { placedSourceCode } from "../shared/wiki-source-code";
import { datedMeasures } from "../shared/wiki-measures";
import { droppedEarlierPaths } from "../shared/wiki-step-paths";
import { framingFirst } from "../shared/wiki-subtopic-order";
import { reportedStatusRows } from "../shared/wiki-section-status";
import { withoutReadingAdvice } from "./wiki-overview";
import { claimSupported, rowSupported } from "./wiki-claim-support";
import type { WikiDraftChapter, WikiKnowledgeLedger, WikiKnowledgeOrganization, WikiKnowledgeUnit } from "../shared/wiki-knowledge";

const unit = (n: number, statement: string, extra: Partial<WikiKnowledgeUnit> = {}): WikiKnowledgeUnit => ({ id: `u${n}`, subject: "项目", statement, kind: "plan", details: [], adoption: { status: "proposal" }, delivery: "unknown", evidence: { evidenceId: `e${n}`, conversationId: "c", messageId: `m${n}`, messageIndex: n, role: "assistant", pasted: false, quote: statement }, ...extra });
const user = (n: number, statement: string, quote: string, extra: Partial<WikiKnowledgeUnit> = {}) => unit(n, statement, { ...extra, evidence: { ...unit(n, statement).evidence, role: "user", quote } });
const chapter = (title: string, paragraphs: Array<{ subtopic: string; text: string; unitIds: string[] }>, opening = ""): WikiDraftChapter => ({ id: title, title, question: "", group: "", problems: [], body: [opening, ...paragraphs.map(paragraph => paragraph.text)].filter(Boolean).join("\n\n"), paragraphs: paragraphs.map(paragraph => ({ ...paragraph, claims: [] })) });

it("routes a shop's rules and a scoring formula out of the positioning and interface chapters", () => {
  const shop = unit(1, "定位为“守护工具箱”，售卖行为改变工具而非焦虑/补药/擦边产品；首批SKU不超过3个。", { subject: "商店策略", facet: "定位与原则", kind: "decision" });
  const pay = unit(2, "接入虚拟支付前必须核对微信小程序最新规则，VIP会员、代币等非实物商品属于虚拟支付场景。", { subject: "合规要求", facet: "支付规则", kind: "constraint" });
  const score = unit(3, "推荐分数由平均缓解效果(35%)、用户主动标记有效率(25%)和完成率(15%)加权计算。", { subject: "个性化推荐算法", facet: "评分公式", kind: "mechanism" });
  const own = unit(4, "产品核心应定位为“行为改变系统”而非单纯的聊天机器人。", { subject: "产品定位", kind: "decision" });
  expect([shop, pay, score].map(wikiUnitLane)).toEqual(["commerce", "commerce", "algorithm"]);
  // Not a sale: the product's own positioning stays purpose.
  expect(wikiUnitLane(own)).toBe("purpose");
  const organization: WikiKnowledgeOrganization = { version: 1, generatedAt: 0, status: "complete", merged: [], relations: [], report: {},
    subjects: [{ id: "pos", name: "产品定位", aliases: [], unitIds: [own.id, pay.id] }, { id: "home", name: "首页", aliases: [], unitIds: [score.id] }, { id: "money", name: "商业化", aliases: [], unitIds: [shop.id] }, { id: "algo", name: "推荐", aliases: [], unitIds: [unit(5, "风险评分").id] }],
    chapters: [
      { id: "a", title: "产品定位与合规", question: "", group: "", subtopics: [{ title: "核心价值主张", subjectIds: ["pos"] }] },
      { id: "b", title: "用户旅程与交互", question: "", group: "", subtopics: [{ title: "首页与导航设计", subjectIds: ["home"] }] },
      { id: "c", title: "算法与数据技术", question: "", group: "", subtopics: [{ title: "行为链与风险识别", subjectIds: ["algo"] }] },
      { id: "d", title: "市场增长与竞品", question: "", group: "", subtopics: [{ title: "商业化模式", subjectIds: ["money"] }] },
    ] };
  const units = new Map([shop, pay, score, own, unit(5, "风险评分")].map(item => [item.id, item]));
  const routed = routeWikiUnits(organization, units);
  const subjectOf = (id: string) => routed.subjects.find(subject => subject.unitIds.includes(id))?.id;
  expect(subjectOf(pay.id)).toBe("money");
  expect(subjectOf(shop.id)).toBe("money");
  expect(subjectOf(own.id)).toBe("pos");
  const chapterOf = (id: string) => routed.chapters.find(item => item.subtopics.some(topic => topic.subjectIds.includes(subjectOf(id)!)))?.title;
  expect(chapterOf(score.id)).toBe("算法与数据技术");
});

it("reads a user's question as a question, and a later exclusion as replacing what it rules out", () => {
  const feasible = user(1, "探讨将戒色行为管理与人工智能技术结合的可行性及有效性。", "你觉得把戒色和AI结合怎么样，真的有效吗有用吗");
  const teens = user(2, "建议将侧重点从戒色限制转向帮助青少年男性找回自信和自律。", "是不是小程序和戒色限制了上限，应该侧重点放到帮助青少年男性找回自信和自律的方向？这个方向竞争怎么样");
  const reported = user(3, "当前小程序日活（DAU）约40，活跃留存率略高于40%。", "为什么我现在的小程序日活卡在40了，活跃留存只有40%多，是不是戒色和AI没法贴合？", { kind: "fact" });
  const told = user(4, "既然是小白，应该首屏就展示一个类似 ChatGPT 的欢迎页面。", "怎么跟codex说我记得之前没有这个流程感觉对小白不友好，既然是小白应该首屏就展示一个类似chatgpt的欢迎页面");
  expect([feasible, teens, reported, told].map(userAskedOnly)).toEqual([true, true, false, false]);
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 4, batches: [{ sourceIds: [], status: "ok", units: [feasible, teens, reported, told], rejected: {} }] };
  expect(withUserQuestionsAsked(ledger).batches[0].units.map(item => item.kind)).toEqual(["question", "question", "fact", "plan"]);
  const adults = unit(9, "为避免未成年人内容治理的合规风险，明确将目标用户定位为18-25岁成年男性，而非青少年。", { kind: "constraint" });
  const merely = unit(10, "产品核心应定位为“行为改变系统”而非单纯的聊天机器人。");
  const chat = unit(1, "首页提供单纯的聊天机器人入口。");
  const organization: WikiKnowledgeOrganization = { version: 1, generatedAt: 0, status: "complete", merged: [], relations: [], report: {}, chapters: [], subjects: [{ id: "s", name: "定位", aliases: [], unitIds: [teens.id, adults.id, merely.id, chat.id] }] };
  const relations = explicitExclusions(organization, new Map([teens, adults, merely, chat].map(item => [item.id, item]))).relations;
  // "而非单纯……" says not merely, and rules nothing out.
  expect(relations).toEqual([{ older: teens.id, newer: adults.id, kind: "replaces", status: "resolved" }]);
});

it("places a block with the point it shows and drops a table row listing the structure's fields", () => {
  const table = "| 方向 | 市场空间 | 竞争 |\n|---|---:|---:|\n| 男性健康 | 8 | 6 |\n| 年轻男性成长 | 9 | 6 |";
  const code = { language: "table", text: table };
  const adults = unit(1, "明确将目标用户定位为18-25岁成年男性，而非青少年。", { subject: "合规与受众限制" });
  adults.evidence.code = code;
  const market = unit(2, "海外存在专门围绕男性自律成长的产品，中国市场分散在男性健康、习惯打卡等相邻类别，竞争较少。", { subject: "竞品分析", facet: "市场空间" });
  market.evidence.code = code;
  const structure = "interface RescueSession {\n  id: string;\n  userId: string;\n  startedAt: number;\n  completedAt: number;\n  urgeLevelBefore: 'mild' | 'medium' | 'severe';\n  outcome: string;\n}";
  const session = unit(3, "急救记录保存每次会话。", { subject: "数据结构" });
  session.evidence.code = { language: "ts", text: structure };
  const rows = "| 事项 | 第一版 |\n| --- | --- |\n| 架构模式 | 采用半Agent模式 |\n| 数据结构 | 包含id、userId、startedAt/completedAt、urgeLevelBefore(mild/medium/severe)、outcome |";
  const chapters = [
    chapter("产品定位与合规", [{ subtopic: "隐私与安全合规", text: adults.statement, unitIds: [adults.id] }]),
    chapter("算法与数据技术", [{ subtopic: "架构与开发规划", text: rows, unitIds: [session.id] }]),
    chapter("市场增长与竞品", [{ subtopic: "海外竞品参考", text: market.statement, unitIds: [market.id] }]),
  ];
  const units = new Map([adults, market, session].map(item => [item.id, item]));
  placedSourceCode(chapters, id => units.get(id), () => "proposal", true, [...units.values()]);
  expect(chapters[0].body).not.toContain("| 方向 |");
  expect(chapters[2].body).toContain("| 方向 | 市场空间 |");
  expect(chapters[1].body).toContain("interface RescueSession");
  expect(chapters[1].body).not.toContain("| 数据结构 |");
  expect(chapters[1].body).toContain("| 架构模式 |");
});

it("dates daily-user counts from different days, and drops the earlier of two paths told in one sentence", () => {
  const day = (month: number, date: number) => new Date(2026, month - 1, date, 12).getTime();
  const early = user(1, "当前日活仅25，面临推广难的问题。", "现在日活才25", { kind: "fact" });
  early.evidence.conversationSpan = { start: day(6, 6), end: day(6, 6) };
  const later = user(2, "小程序目前每天稳定在22人，其中15个为稳定用户。", "我的小程序现在每天稳定在22个人了", { kind: "report" });
  later.evidence.conversationSpan = { start: day(6, 14), end: day(7, 7) };
  const target = unit(3, "第二个月目标DAU 50。");
  const units = new Map([early, later, target].map(item => [item.id, item]));
  const chapters = [chapter("产品", [
    { subtopic: "现状", text: "当前日活仅25，面临推广难的问题。", unitIds: [early.id] },
    { subtopic: "增长", text: "当前小程序日活稳定在22人（其中15个为稳定用户）。第二个月目标DAU 50。", unitIds: [later.id, target.id] },
  ])];
  expect(datedMeasures(chapters, id => units.get(id), true)).toBe(2);
  expect(chapters[0].paragraphs[0].text).toBe("当时日活仅25（6月6日），面临推广难的问题。");
  expect(chapters[0].paragraphs[1].text).toBe("当前小程序日活稳定在22人（6月14日—7月7日；其中15个为稳定用户）。第二个月目标DAU 50。");
  expect(chapters[0].body).toContain("当时日活仅25（6月6日）");

  const first = unit(4, "将新用户首次进入流程压缩至30秒内，路径为：选择目标→设置高风险时间→开启挑战→完成首次打卡→获得即时反馈。");
  first.evidence.conversationId = "a"; first.evidence.conversationSpan = { start: day(6, 6), end: day(6, 6) };
  const second = unit(5, "新用户首次进入需强制引导完成“选择目标-高危时间-生成计划-打卡-加入小组”闭环，确保30秒内产生有效动作。");
  second.evidence.conversationId = "b"; second.evidence.conversationSpan = { start: day(6, 14), end: day(6, 14) };
  const paths = new Map([first, second].map(item => [item.id, item]));
  const text = "新用户首次进入流程压缩至30秒内，路径为选择目标→设置高风险时间→开启挑战→完成首次打卡→获得即时反馈，需强制引导完成“选择目标-高危时间-生成计划-打卡-加入小组”闭环，确保30秒内产生有效动作。";
  const onboarding = [chapter("旅程", [{ subtopic: "新手引导", text, unitIds: [first.id, second.id] }])];
  expect(droppedEarlierPaths(onboarding, id => paths.get(id))).toBe(1);
  expect(onboarding[0].body).toBe("新用户首次进入流程压缩至30秒内，需强制引导完成“选择目标-高危时间-生成计划-打卡-加入小组”闭环，确保30秒内产生有效动作。");
});

it("tells what a subtopic's feature is for first, and trims an opening clause the subtopics repeat", () => {
  const paragraphs = ["急救流程分为三步：站起来、把手机放远、跟随呼吸。", "- **重度模式**：隐藏非必要入口。", "为减少选择负担，界面采用分离结构。", "冲动自救模式作为王牌功能，旨在关键时刻拉回用户。"].map(text => ({ subtopic: "紧急干预机制", text, unitIds: [] }));
  const rescue = [chapter("旅程", paragraphs, "### 紧急干预机制")];
  expect(framingFirst(rescue)).toBe(1);
  expect(rescue[0].body).toBe("### 紧急干预机制\n\n冲动自救模式作为王牌功能，旨在关键时刻拉回用户。\n\n急救流程分为三步：站起来、把手机放远、跟随呼吸。\n\n- **重度模式**：隐藏非必要入口。\n\n为减少选择负担，界面采用分离结构。");
  expect(rescue[0].paragraphs[0].text).toBe(paragraphs[3].text);

  const body = [{ subtopic: "首页", text: "原有的今日指南、AI建议等分散模块被合并为单一的“今日任务”卡片。为了优化首屏密度，首页仅展示最近7天的记录。", unitIds: [] }, { subtopic: "新手", text: "新手引导压缩至30秒内。", unitIds: [] }];
  const journey = chapter("旅程", body, "用户通过混合模式进入产品，首页将分散模块合并为单一的“今日任务”卡片并仅展示最近7天记录。新手引导决定次日留存。");
  journey.body = journey.body.replace("\n\n原有", "\n\n### 首页\n\n原有");
  expect(openingRepeatsTrimmed([journey])).toBe(1);
  expect(journey.body.startsWith("用户通过混合模式进入产品。新手引导决定次日留存。")).toBe(true);
  // A clause leaning on the kept one ("而非……") stays with it.
  const own = chapter("定位", [{ subtopic: "价值", text: "产品帮助用户摆脱失控行为，而非追求戒断天数。", unitIds: [] }], "产品帮助用户摆脱失控行为，而非单纯追求戒断天数。核心策略是本地优先。");
  own.body = own.body.replace("\n\n产品帮助", "\n\n### 价值\n\n产品帮助");
  openingRepeatsTrimmed([own]);
  expect(own.body).toContain("产品帮助用户摆脱失控行为，而非单纯追求戒断天数。");
});

it("finds the source of a table row joining two points, cell by cell", () => {
  const thirty = unit(1, "日活约30人（近期降至22人），整体留存率26.92%，新增用户次日留存19%。", { kind: "fact" });
  const core = unit(2, "当前日活稳定在22人，其中15人为连续使用的核心用户，占比约68%。", { kind: "fact" });
  const row = ["日活用户数", "约30人（近期降至22人）", "其中15人为连续使用核心用户，占比约68%"];
  expect(claimSupported(row.join("，"), [thirty, core])).toBe(false);
  expect(rowSupported(row, [thirty, core])).toBe(true);
  // A value no point gives still has no source.
  expect(rowSupported(["日活用户数", "约30人", "其中18人为核心用户"], [thirty, core])).toBe(false);
});

it("lists a reported count as dated data, not as work done, and drops reading advice from the overview", () => {
  const count = user(1, "小程序目前每天稳定在22人，其中15个为稳定用户。", "小程序目前每天稳定在22人，其中15个为稳定用户", { kind: "report" });
  count.evidence.conversationSpan = { start: new Date(2026, 5, 6, 12).getTime(), end: new Date(2026, 5, 6, 13).getTime() };
  const built = user(2, "急救流程已完成上线。", "急救流程已完成上线", { kind: "report" });
  expect(reportedStatusRows([count, built], new Set([count.id, built.id]))).toEqual([
    { text: count.statement, done: false, status: "measured", when: "6月6日", at: count.evidence.conversationSpan.start },
    { text: built.statement, done: true, status: "built" },
  ]);
  expect(withoutReadingAdvice("该项目定位为面向成年男性的AI戒色守护Agent。建议优先阅读“产品定位与合规”章节，以深入理解产品的核心目标用户群体。")).toBe("该项目定位为面向成年男性的AI戒色守护Agent。");
  expect(withoutReadingAdvice("该项目帮助用户恢复理解。它以本地存储为主。")).toBe("该项目帮助用户恢复理解。它以本地存储为主。");
});
