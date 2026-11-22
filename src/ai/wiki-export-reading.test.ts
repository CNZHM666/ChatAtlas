import { describe, expect, it } from "vitest";
import { wikiUnitStatuses } from "./wiki-knowledge-state";
import { routeWikiUnits } from "./wiki-unit-routing";
import { rehomedStrayParagraphs } from "./wiki-stray-paragraphs";
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

it("gathers independent report sentences in one usage topic under product positioning", () => {
  const audience = unit("audience", "产品面向独立开发者。", {kind:"fact"});
  const reports = [
    unit("retention", "新增用户次日留存为25%。", {kind:"fact"}, "user"),
    unit("active", "当前日活用户达到42人。", {kind:"report"}, "user"),
  ];
  const units = new Map([audience, ...reports].map(item=>[item.id,item]));
  const source = organization([["people",[...units.keys()]]], [["product","产品定位",[["目标用户",["people"]]]]]);
  const plan = routeWikiUnits(source, units);
  const [, metrics] = plan.chapters[0].subtopics;
  expect(plan.chapters[0].subtopics.map(topic=>topic.title)).toEqual(["目标用户","运营指标"]);
  expect(plan.subjects.find(subject=>subject.id===metrics.subjectIds[0])?.unitIds).toEqual(reports.map(report=>report.id));
  const paragraphs = [{ subtopic:"目标用户", text:[...units.values()].map(item=>item.statement).join(""),
    unitIds:[...units.keys()],claims:[...units.values()].map(item=>({text:item.statement,unitIds:[item.id]})) }];
  const chapter = { id:"product", title:"产品定位", question:"", group:"", body:`### 目标用户\n\n${paragraphs[0].text}`, paragraphs, problems:[] };
  const home = new Map(plan.subjects.flatMap(subject=>subject.unitIds.map(id=>[id,subject.id] as const)));
  expect(rehomedStrayParagraphs([chapter], plan, home, units)).toBe(2);
  expect(chapter.body).toBe(`### 目标用户\n\n${audience.statement}\n\n### 运营指标\n\n${reports.map(report=>report.statement).join("\n\n")}`);
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

it("uses the later proposed next step in the development summary without promoting it to a decision", () => {
  const early = unit("early", "按顺序执行：M1 搭建界面，M2 完成数据模型，M3 加入校验。");
  const next = unit("next", "项目进入 Milestone 5，建议冻结大功能，集中验证真实场景。");
  next.evidence.messageIndex = early.evidence.messageIndex + 2;
  const source: WikiKnowledgeLedger = { version: 1, generatedAt: 1, status: "complete", materials: 1,
    batches: [{ sourceIds: [], status: "ok", rejected: {}, units: [early, next] }],
    organization: organization([["s", [early.id, next.id]]], [["dev", "开发实施与测试", [["实施路线", ["s"]]]]]),
    draft: { version: 1, generatedAt: 1, status: "complete", report: {}, chapters: [{ id: "dev", title: "开发实施与测试",
      question: "", group: "", openingUnitIds: [early.id], body: `${early.statement}\n\n### 实施路线\n\n${next.statement}`,
      problems: [], paragraphs: [{ subtopic: "实施路线", text: next.statement, unitIds: [next.id] }] }] },
  };
  expect(wikiChapterLeads(resolveWikiReading(source)).get("dev")).toEqual([
    expect.objectContaining({ unit: expect.objectContaining({ id: next.id }), status: "proposal", nextStep: true }),
  ]);
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

it("keeps design compounds intact and restores durations from their bound sources", () => {
  const design = unit("design", "目前的设计稿可作为开发参考。", {kind:"fact"});
  const review = unit("review", "每天晚上提供30秒复盘。", {kind:"fact"});
  const experiment = unit("experiment", "若有20名参与者持续使用，则验证需求成立。", {subject:"增长验证"});
  const points = [design,review,experiment];
  const paragraphs = [design.statement,"每天晚上提供30（7月8日）秒复盘。","验证标准为："+experiment.statement]
    .map((text,index)=>({subtopic:"设计与验证",text,unitIds:[points[index].id],claims:[{text,unitIds:[points[index].id]}]}));
  const chapter = {id:"c",title:"产品设计",question:"",group:"",body:`### 设计与验证\n\n${paragraphs.map(item=>item.text).join("\n\n")}`,paragraphs,problems:[]};
  const source: WikiKnowledgeLedger = {version:1,generatedAt:0,status:"complete",materials:3,
    batches:[{sourceIds:[],status:"ok",rejected:{},units:points}],
    organization:organization([["s",points.map(item=>item.id)]],[["c","产品设计",[["设计与验证",["s"]]]]]),
    draft:{version:1,generatedAt:0,status:"complete",report:{},chapters:[chapter]}};
  const [section]=ledgerDocument(source,{}).sections;
  expect(section.body).toContain(design.statement);
  expect(section.body).toContain(review.statement);
  expect(section.body).toContain("验证提案：若有20名参与者持续使用，可作为线索，帮助判断需求成立。");
  expect(section.claims?.find(claim=>claim.text===review.statement)?.unitIds).toEqual([review.id]);
});

it("moves project handoffs and confirmed standards out of reference prose without dropping comparisons", () => {
  const tool: WikiKnowledgeUnit["about"]={name:"DesignBox",role:"reference"};
  const handoff=unit("handoff","界面设计稿交给 DesignBox 生成下一版草稿。",{about:tool,kind:"decision"});
  const reference=unit("reference","DesignBox 支持导出可编辑的界面设计稿。",{about:tool,kind:"fact"});
  const layout=unit("layout","首页的导航栏保留工作台入口。");
  const standard=unit("standard","无障碍规范对齐：严格遵循内部无障碍规范。",{kind:"decision"});
  const comparison="各参考工具的公开资料未说明键盘操作范围。";
  const paragraph=(subtopic:string,point:WikiKnowledgeUnit)=>({subtopic,text:point.statement,unitIds:[point.id],claims:[{text:point.statement,unitIds:[point.id]}]});
  const chapter=(id:string,title:string,paragraphs: Array<ReturnType<typeof paragraph>>)=>({
    id,title,group:"",question:"",problems:[],paragraphs,body:paragraphs.map(item=>`### ${item.subtopic}\n\n${item.text}`).join("\n\n"),
  });
  const externalDraft=chapter("compare","竞品参考",[paragraph("外部产品",reference),paragraph("工具交接",handoff),paragraph("使用规范",standard)]);
  const policy=unit("policy","保存前应核对处理权限。");
  const source: WikiKnowledgeLedger={version:1,generatedAt:0,status:"complete",materials:5,
    batches:[{sourceIds:[],status:"ok",rejected:{},units:[handoff,reference,layout,standard,policy]}],
    decisions:{handoff:{verdict:"confirmed",at:1},standard:{verdict:"confirmed",at:2}},
    organization:organization([["external",["reference"]],["tools",["handoff"]],["ui",["layout"]],["standard",["standard"]],["policy",["policy"]]],[
      ["compare","竞品参考",[["外部产品",["external"]],["工具交接",["tools"]],["使用规范",["standard"]]]],
      ["screens","界面设计",[["导航",["ui"]]]],["policy","安全与合规",[["安全规则",["policy"]]]]]),
    draft:{version:1,generatedAt:0,status:"complete",report:{},chapters:[
      {...externalDraft,openingUnitIds:[standard.id],body:`项目发起人确认无障碍规范严格遵循内部无障碍规范，但${comparison}\n\n${externalDraft.body}`},
      chapter("screens","界面设计",[paragraph("导航",layout)]),
      chapter("policy","安全与合规",[paragraph("安全规则",policy)]),
    ]}};
  const result=ledgerDocument(source,{});
  const external=result.sections.find(section=>section.id==="compare")!, ui=result.sections.find(section=>section.id==="screens")!;
  expect(external.body).toContain(reference.statement);
  expect(external.body).toContain(comparison);
  expect(external.body).not.toContain(handoff.statement);
  expect(external.body).not.toContain("严格遵循内部无障碍规范");
  expect(ui.body).toContain(`### 设计交接\n\n${handoff.statement}`);
  expect(ui.claims?.find(claim=>claim.unitIds?.includes(handoff.id))?.userDecided).toBe(true);
  expect(result.sections.find(section=>section.id==="policy")?.body).toContain(standard.statement);
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
  const formatDate = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" });
  const sourceSpan = (text: string) => wikiLedgerUnits(ledger).find(unit => unit.statement.includes(text))!.evidence.conversationSpan!;
  const older = sourceSpan("稳定在22人"), later = sourceSpan("卡在40左右");
  const olderDate = `${formatDate.format(older.start)}—${formatDate.format(older.end)}`;
  const laterDate = formatDate.format(later.start);
  expect(md).toMatch(new RegExp(`\\| ${olderDate} \\| 稳定在22人 \\|[^\\n]*\\n\\| ${laterDate} \\| 卡在40左右 \\|`, "u"));
  // Chapters open on what was decided.
  expect(md).toMatch(/## 产品定位与范围\n\n> [^\n]*〔已定〕/u);
  expect(md).toMatch(/## 用户界面与交互\n\n> 首屏应仅保留[^\n]*〔已定〕/u);
  // A citation stands apart from the sentence after it.
  expect(md).not.toMatch(/\[S-\d+-[a-z0-9]+\](?=[\p{Script=Han}*])/u);
}, 120000);
