import { describe, expect, it } from "vitest";
import { wikiUnitStatuses } from "./wiki-knowledge-state";
import { routeWikiUnits } from "./wiki-unit-routing";
import { wikiChapterLeads } from "./wiki-chapter-lead";
import { resolveWikiReading } from "./wiki-knowledge-reading";
import { ledgerDocument } from "./wiki-ledger-document";
import { projectDocument } from "../export/project-document";
import { contextKnowledge } from "../test/context-fixture";
import { wikiLedgerUnits, type WikiDraftClaim, type WikiKnowledgeLedger, type WikiKnowledgeOrganization, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";

const unit = (id: string, statement: string, extra: Partial<WikiKnowledgeUnit> = {}, role: "user" | "assistant" = "assistant"): WikiKnowledgeUnit => ({ id, subject: "项目", statement, kind: "plan", details: [], delivery: "unknown", adoption: { status: role === "user" ? "unknown" : "proposal" },
  evidence: { evidenceId: `e-${id}`, conversationId: "c", messageId: `m-${id}`, messageIndex: 1, role, pasted: false, quote: statement }, ...extra });
const organization = (subjects: Array<[string, string[]]>, chapters: Array<[string, string, Array<[string, string[]]>]>): WikiKnowledgeOrganization => ({ version: 1, generatedAt: 0, status: "complete", merged: [], relations: [], report: {},
  subjects: subjects.map(([id, unitIds]) => ({ id, name: id, aliases: [], unitIds })), chapters: chapters.map(([id, title, topics]) => ({ id, title, question: "", group: "", subtopics: topics.map(([topic, subjectIds]) => ({ title: topic, subjectIds })) })) });

it("reads the AI's retelling of a user's figure, then the user's later one, as figures over time", () => {
  const retold = unit("a", "小程序日活稳定在22人，其中15人为连续使用的稳定用户。", { kind: "fact" });
  const later = unit("b", "当前日活32人，累计用户1100人。", { kind: "fact" }, "user");
  const statuses = wikiUnitStatuses([retold, later], { relations: [{ older: "a", newer: "b", kind: "replaces", status: "unresolved" }] });
  expect(statuses.get("a")).toBe("history");
  // Two plans still differ: a change touching the user's words stays open.
  const plan = unit("c", "首页先放看板。"), idea = unit("d", "首页先放列表。", {}, "user");
  expect(wikiUnitStatuses([plan, idea], { relations: [{ older: "c", newer: "d", kind: "replaces", status: "unresolved" }] }).get("c")).toBe("open");
});

it("gathers what is sold where most of it sits when no subtopic is about earning", () => {
  const price = unit("p", "设置7天体验（免费或¥1.9）、30天计划（¥19.9）。", { subject: "会员定价体系", facet: "价格阶梯" });
  const split = unit("f", "免费用户每日限3次AI对话，付费用户享有完整个性化流程。", { subject: "功能限制", facet: "免费与付费差异", kind: "constraint" });
  const sub = unit("s", "确认为免费体验+订阅制，取消一次性买断。", { subject: "商业化策略", kind: "decision" });
  const reach = unit("g", "在QQ群和贴吧发布打卡海报获客。"), rival = unit("r", "对比其他戒色工具的社区功能。");
  const units = new Map([price, split, sub, reach, rival].map(item => [item.id, item]));
  const routed = routeWikiUnits(organization([["home", ["p"]], ["engine", ["f"]], ["growth", ["s", "g"]], ["rival", ["r"]]],
    [["ui", "用户界面与交互", [["首页信息架构", ["home"]]]], ["algo", "干预机制与算法", [["AI Agent引擎", ["engine"]]]], ["grow", "增长规划与竞品", [["获客策略", ["growth"]], ["竞品分析", ["rival"]]]]]), units);
  const grow = routed.chapters.find(chapter => chapter.id === "grow")!;
  expect(grow.subtopics.map(topic => topic.title)).toEqual(["获客策略", "商业模式与定价", "竞品分析"]);
  const opened = routed.subjects.find(subject => subject.id === "grow:role:commerce")!;
  expect(opened.unitIds.sort()).toEqual(["f", "p", "s"]);
});

describe("a chapter's lead", () => {
  const confirmed = unit("k", "首屏仅保留问候语、连续坚持天数、状态卡片及动态主按钮，日历下移。", { subject: "首页首屏布局", kind: "decision" });
  const layers = unit("l", "界面包含风险日历、高危雷达和提前干预三个层级。", { subject: "产品界面层级" });
  const ledger = (opening: string): WikiKnowledgeLedger => ({ version: 1, generatedAt: 0, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units: [confirmed, layers], rejected: {} }],
    decisions: { k: { verdict: "confirmed", at: 1 } },
    organization: organization([["s", ["l", "k"]]], [["ui", "用户界面与交互", [["首页", ["s"]]]]]),
    draft: { version: 1, generatedAt: 1, status: "complete", report: {}, chapters: [{ id: "ui", title: "用户界面与交互", question: "", group: "", openingUnitIds: ["l"], body: `${opening}\n\n### 首页\n\n${layers.statement}${confirmed.statement}`, problems: [],
      paragraphs: [{ subtopic: "首页", text: `${layers.statement}${confirmed.statement}`, unitIds: ["l", "k"] }] }] } });
  it("is the confirmed decision the opening tells in its words, over a proposal naming the chapter", () => {
    expect(wikiChapterLeads(resolveWikiReading(ledger("界面采用混合模式，首屏仅保留问候语、连续坚持天数、状态卡片及动态主按钮。"))).get("ui")![0].unit.id).toBe("k");
  });
  it("stays the chapter's own proposal when the opening tells another point", () => {
    expect(wikiChapterLeads(resolveWikiReading(ledger("界面包含风险日历、高危雷达和提前干预三个层级。"))).get("ui")![0].unit.id).toBe("l");
  });
});

it("tells a confirmation no cited point backs as proposed, and drops it where it repeats a decision told elsewhere", () => {
  const decided = unit("d", "长期方向扩展为“年轻男性状态恢复/自律成长”，保留戒色作为获客入口。", { kind: "decision" });
  const proposal = unit("p", "建议优先深耕“戒色”单一垂直领域，待用户稳定后再拓展相邻需求。", { kind: "decision" });
  const other = unit("o", "首页加入状态打卡。");
  const repeat = "你已确认将长期方向扩展为“年轻男性状态恢复/自律成长”，保留戒色作为获客入口。", rest = "**建议优先深耕单一垂直领域**，待用户稳定后再拓展相邻需求。";
  const unbacked = "你已确认首页加入状态打卡。";
  const claims: WikiDraftClaim[] = [{ text: repeat, unitIds: ["p"] }, { text: unbacked, unitIds: ["o"] }];
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 3, batches: [{ sourceIds: [], status: "ok", units: [decided, proposal, other], rejected: {} }],
    decisions: { d: { verdict: "confirmed", at: 1 } },
    organization: organization([["a", ["d"]], ["b", ["p", "o"]]], [["one", "产品定位", [["方向", ["a"]]]], ["two", "增长规划", [["获客", ["b"]]]]]),
    draft: { version: 1, generatedAt: 1, status: "complete", report: {}, chapters: [
      { id: "one", title: "产品定位", question: "", group: "", body: `### 方向\n\n${decided.statement}`, problems: [], paragraphs: [{ subtopic: "方向", text: decided.statement, unitIds: ["d"] }] },
      { id: "two", title: "增长规划", question: "", group: "", body: `### 获客\n\n${repeat}${rest}\n\n${unbacked}`, problems: [], paragraphs: [{ subtopic: "获客", text: `${repeat}${rest}`, unitIds: ["p"], claims: [claims[0]] }, { subtopic: "获客", text: unbacked, unitIds: ["o"], claims: [claims[1]] }] },
    ] } };
  const body = ledgerDocument(ledger, {}).sections.find(section => section.title === "增长规划")!.body;
  expect(body).not.toContain("你已确认");
  expect(body).toContain(rest);
  expect(body).toContain("讨论中提出首页加入状态打卡。");
});

// The exported document of a frozen sample (evaluation/regression/exports, git-ignored): each of these read wrong in it.
const moduleName = "node:fs";
const { existsSync, readFileSync } = await import(/* @vite-ignore */ moduleName) as { existsSync: (path: string) => boolean; readFileSync: (path: string, encoding: "utf8") => string };
const SAMPLE = "evaluation/regression/exports/AI戒色小程序-1112a-ledger.json";
it.skipIf(!existsSync(SAMPLE))("exports the 1112a sample without the breaks it had", () => {
  const ledger = (JSON.parse(readFileSync(SAMPLE, "utf8")) as { ledger: WikiKnowledgeLedger }).ledger;
  const base = contextKnowledge().session, doc = ledgerDocument(ledger, {});
  const ids = [...new Set(wikiLedgerUnits(ledger).map(item => item.evidence.conversationId))];
  const session = { ...base, ...doc, title: "AI戒色小程序", wikiKnowledge: ledger, sourceConversationIds: ids, scope: undefined, wikiOverview: undefined, projectMaintenance: undefined };
  const md = projectDocument(session, { overview: true, wikiIds: doc.sections.map(section => section.id), matters: false, history: false, sources: false }, "md").text;
  // A question mark left alone where its sentence went to the 版本未定 note.
  expect(md).not.toMatch(/^[？?]\s*$/mu);
  // A list glued to its label, and a cut lead-in.
  expect(md).not.toMatch(/建议：- /u);
  expect(md).not.toMatch(/(?:^|[。！？])中引用，/mu);
  // A confirmation no point backs, with a version no source gives, repeated from 产品定位.
  expect(md).not.toContain("你已确认将产品定位");
  expect(md).not.toMatch(/未通过：[^\n]*你已确认/u);
  // Figures said weeks apart read as two dated rows, not two views of one open question.
  expect(md).not.toMatch(/另一视角|未统一说法/u);
  expect(md).not.toMatch(/\*\*稳定在22人\*\*/u);
  expect(md).toMatch(/\| 6月14日—7月7日 \| 稳定在22人 \|[^\n]*\n\| 8月18日 \| 卡在40左右 \|/u);
  // Chapters open on what was decided.
  expect(md).toMatch(/\| 产品定位与范围 \| [^|]*〔已定〕/u);
  expect(md).toMatch(/\| 用户界面与交互 \| 首屏应仅保留[^|]*〔已定〕/u);
  // A citation stands apart from the sentence after it.
  expect(md).not.toMatch(/\[S-\d+-[a-z0-9]+\](?=[\p{Script=Han}*])/u);
}, 120000);
