import { gatherNamedItems, gatherPositioning, gatherVersions } from "./wiki-knowledge-organize";
import { ensureWikiDecisions } from "./wiki-decision-coverage";
import { retitleMisnamedChapters, routeOutOfReferences, routeWikiUnits, wikiUnitLane } from "./wiki-unit-routing";
import { componentExceptions, componentParts, notePartExceptions } from "./wiki-component-values";
import { currentCapabilityState, outdatedCapabilityReports, pastCapabilityWords } from "./wiki-capability-state";
import { expect, it } from "vitest";
import { claimSupported } from "./wiki-claim-support";
import { reviewWikiChapter } from "./wiki-claim-review";
import { resolveWikiReading } from "./wiki-knowledge-reading";
import { currentBaseline, laterTakenUp, scopedWishes, wikiUnitStatuses } from "./wiki-knowledge-state";
import { curateWikiUnits } from "./wiki-knowledge-select";
import { holderRunClaims, validateFinalClaims, writeLedgerDraft } from "./wiki-knowledge-write";
import { ledgerDocument } from "./wiki-ledger-document";
import { wikiVersionQuestions, withVersionAnswer } from "./wiki-key-decisions";
import { exclusiveWikiVersions } from "./wiki-version-conflict";
import { foreignDetail, ownSection, wikiUnitDetails, CRITICAL_PROBLEM, scopedWikiDraft, wikiDraftMarkdown, type WikiDraftChapter, type WikiKnowledgeLedger, type WikiKnowledgeUnit, type WikiDraftClaim } from "../shared/wiki-knowledge";
import { contextKnowledge } from "../test/context-fixture";

const unit = (n: number, statement: string, extra: Partial<WikiKnowledgeUnit> = {}): WikiKnowledgeUnit => ({ id: `u${n}`, subject: "项目", statement, kind: "plan", details: [], adoption: { status: "proposal" }, delivery: "unknown", evidence: { evidenceId: `e${n}`, conversationId: "c", messageId: `m${n}`, messageIndex: n, role: "assistant", pasted: false, quote: statement }, ...extra });
const book = (units: WikiKnowledgeUnit[]): WikiKnowledgeLedger => ({ version: 1, generatedAt: 0, status: "complete", materials: units.length, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }], organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "项目", aliases: [], unitIds: units.map(unit => unit.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "项目", question: "如何继续？", group: "", subtopics: [{ title: "方案", subjectIds: ["s"] }] }] } });
const chapter = (units: WikiKnowledgeUnit[], text: string, claims: WikiDraftClaim[] = [{ text, unitIds: units.map(unit => unit.id) }]): WikiDraftChapter => ({ id: "ch", title: "项目", question: "如何继续？", group: "", body: text, paragraphs: [{ subtopic: "方案", text, unitIds: units.map(unit => unit.id), claims }], problems: [] });
const withDraft = (ledger: WikiKnowledgeLedger, chapters: WikiDraftChapter[]): WikiKnowledgeLedger => ({ ...ledger, draft: { version: 1, generatedAt: 5, status: "complete", chapters, report: {} } });

it("uses the same derived replacement in the ledger and the document without changing source decisions", () => {
  const old = unit(1, "API Key 只能使用服务端环境变量。"), next = unit(9, "确定采用 BYOK 模式，由用户提供 API 密钥，而非仅使用服务端环境变量。");
  const ledger = withDraft(book([old, next]), [chapter([old], old.statement)]), original = JSON.stringify(ledger);
  expect(resolveWikiReading(ledger).statuses.get(old.id)).toBe("history");
  expect(ledgerDocument(ledger, {}).sections[0].claims?.[0].holder).toBe("earlier");
  expect(JSON.stringify(ledger)).toBe(original);
  const confirmed = { ...ledger, decisions: { [old.id]: { verdict: "confirmed" as const, at: 10 } } };
  expect(ledgerDocument(confirmed, {}).sections[0].claims?.[0].holder).toBe("decided");
});

it("never infers a temporal replacement or a narrowed wish across conversation indices", () => {
  const old = unit(1, "API Key 只能使用服务端环境变量。"), next = unit(999, "确定采用 BYOK 模式，由用户提供 API 密钥，而非仅使用服务端环境变量。");
  next.evidence.conversationId = "another";
  expect(resolveWikiReading(book([old, next])).statuses.get(old.id)).toBe("proposal");
  const scope = unit(2, "本阶段禁止开发拍照识别。"), later = unit(999, "必须完整跑通拍照识别全链路。");
  later.evidence.conversationId = "another";
  expect(laterTakenUp([scope, later]).size).toBe(0);
});

it("keeps adoption independent of an assistant's narrower phase scope", () => {
  const wish = unit(1, "项目应提供拍照识别。", { kind: "decision", adoption: { status: "user_decision" } });
  wish.evidence = { ...wish.evidence, role: "user", quote: "我想提供拍照识别" };
  const scope = unit(2, "本阶段禁止开发拍照识别。", { kind: "constraint" }), ledger = book([wish, scope]);
  const organized = scopedWishes(ledger.organization!, new Map([wish, scope].map(unit => [unit.id, unit])));
  expect(organized.relations).toMatchObject([{ kind: "narrows" }]);
  expect(wikiUnitStatuses([wish, scope], organized).get(wish.id)).toBe("confirmed");
});

it("requires evidence for adoption and keeps a user asking about their own idea in proposal language", () => {
  const idea = unit(1, "开始使用后自动分配到守护小组。", { kind: "decision", adoption: { status: "user_decision" } });
  idea.evidence = { ...idea.evidence, role: "user", quote: "我的想法是开始使用后自动分配到守护小组，你觉得怎么样" };
  const assistant = unit(2, "首次打卡后自动分配到守护小组。", { kind: "decision", adoption: { status: "user_adopted" } });
  const units = [idea, assistant], ledger = withDraft(book(units), [chapter(units, `${idea.statement}${assistant.statement}`, units.map(point => ({ text: point.statement, unitIds: [point.id] })))]);
  const statuses = resolveWikiReading(ledger).statuses;
  expect(statuses.get(idea.id)).toBe("stated");
  expect(statuses.get(assistant.id)).toBe("proposal");
  const { sections: [read], evidence } = ledgerDocument(ledger, {});
  expect(read.body).toContain(`你曾提议：${idea.statement}`);
  expect(read.body).toContain(`AI 建议：${assistant.statement}`);
  expect(read.claims?.some(claim => claim.holder === "decided")).toBe(false);
  const session = { ...contextKnowledge().session, sourceConversationIds: ["c"], evidence, wikiKnowledge: ledger };
  const saved = { ...read, body: `${idea.statement}\n\n${assistant.statement}`, claims: read.claims?.map(claim => ({ ...claim, text: claim.text.replace(/^(?:你曾提议|AI 建议)：/u, ""), holder: "decided" as const, userDecided: true })) };
  const reviewed = reviewWikiChapter(saved, session);
  expect(reviewed.body).toContain(`你曾提议：${idea.statement}`);
  expect(reviewed.body).toContain(`AI 建议：${assistant.statement}`);
  expect(reviewed.claims?.some(claim => claim.holder === "decided")).toBe(false);
});

it("dates a reported range and percentage in an opening with no figure bindings", () => {
  const earlier = unit(1, "小程序日活约22-30人，整体留存率26.92%。", { kind: "report", delivery: "user_reported" });
  earlier.evidence = { ...earlier.evidence, role: "user", conversationSpan: { start: Date.UTC(2026, 5, 14, 12), end: Date.UTC(2026, 6, 7, 12) } };
  const later = unit(2, "小程序日活约40人。", { kind: "report", delivery: "user_reported" });
  later.evidence = { ...later.evidence, role: "user", conversationId: "aug", conversationSpan: { start: Date.UTC(2026, 7, 18, 12) } };
  const reports = chapter([earlier, later], earlier.statement, [{ text: earlier.statement, unitIds: [earlier.id] }]);
  reports.body = `截至当前，小程序日活约22-30人，留存率26.92%，需关注付费转化。\n\n### 运营数据\n\n${earlier.statement}`;
  const body = ledgerDocument(withDraft(book([earlier, later]), [reports]), {}).sections[0].body;
  expect(body).toContain("用户在 6月14日—7月7日 的讨论中报告，小程序日活约22-30人，留存率26.92%");
  expect(body).not.toContain("截至当前");
});

it("qualifies proposed flow timings and checks the trigger against the quoted action", () => {
  const mismatch = unit(1, "首次打卡后自动分配到守护小组。");
  mismatch.evidence.quote = "AI 建议在开始计划后自动分配到守护小组。";
  const match = unit(2, "开始计划后自动分配到7天守护小组，支持退出。");
  const offer = unit(3, "新用户前3天体验，第3天展示风险报告后引导付费。", { kind: "mechanism" });
  offer.evidence.quote = "第1—3天体验。\n### 第3天\n显示风险报告。\n解锁完整计划。";
  const points = [mismatch, match, offer], text = points.map(item => item.statement).join("\n\n");
  const ledger = withDraft(book(points), [chapter(points, text, points.map(item => ({ text: item.statement, unitIds: [item.id] })))]);
  const { sections: [section], evidence } = ledgerDocument(ledger, {});
  const session = { ...contextKnowledge().session, sourceConversationIds: ["c"], evidence, wikiKnowledge: ledger };
  const reviewed = reviewWikiChapter({ ...section, body: `AI 建议：${text}` }, session);
  // The trigger the writer gave is not the quote's: the sentence takes the quote's, with no reviewer's note.
  expect(reviewed.body).toContain("AI 建议：开始计划后自动分配到守护小组。");
  expect(reviewed.body).not.toMatch(/首次打卡后自动分配|待核对/u);
  expect(reviewed.body).toContain(`AI 建议：${match.statement}`);
  expect(reviewed.body).toContain(`AI 对付费时机的建议：${offer.statement}`);
  expect(reviewed.claims?.find(claim => claim.unitIds?.includes(mismatch.id))?.text).toBe("AI 建议：开始计划后自动分配到守护小组。");
  expect(reviewWikiChapter(reviewed, session).body).toBe(reviewed.body);
  expect(reviewWikiChapter({ ...section, userEdited: true }, session).body).toBe(section.body);
});

it("keeps the denominator with an assistant's calculation and the range with the user's report", () => {
  const report = unit(1, "小程序日活约22-30人。", { kind: "report", delivery: "user_reported" });
  report.evidence = { ...report.evidence, role: "user" };
  const calculation = unit(2, "小程序日活稳定在22人，其中15人为连续使用的稳定用户，核心用户占比约68%。", { kind: "fact" });
  calculation.evidence.quote = `${calculation.statement}\n> 15 ÷ 22 ≈ 68%`;
  const text = "小程序日活约22（6月14日—7月7日）-30人，其中15人为连续使用的稳定用户，核心用户占比约68%。";
  const ledger = withDraft(book([report, calculation]), [chapter([report, calculation], text)]);
  const { sections: [section], evidence } = ledgerDocument(ledger, {});
  const session = { ...contextKnowledge().session, sourceConversationIds: ["c"], evidence, wikiKnowledge: ledger };
  const reviewed = reviewWikiChapter({ ...section, body: `### 运营\n\n- **日活规模**：${text}` }, session);
  expect(reviewed.body).toContain("日活约22–30人（6月14日—7月7日）。AI 按日活22人的口径计算，15人为连续使用的稳定用户，核心用户占比约68%（15 ÷ 22）。");
  expect(reviewed.claims?.filter(claim => claim.text.includes("68%")).map(claim => claim.unitIds)).toEqual([[calculation.id]]);
});

it("protects a later proposed phase even with a freeze and a very small editorial budget", () => {
  const old = unit(1, "项目正式定义为 Milestone 3.1，完成数据流。"), next = unit(77, "建议进入 Milestone 5 Alpha Validation 阶段，冻结大功能 1-2 周，仅测试现有链路。"), tip = unit(100, "默认只展示当前阶段最需要的下一步。");
  const ledger = book([old, next, tip]), statuses = wikiUnitStatuses([old, next, tip], ledger.organization!);
  const baseline = currentBaseline([old, next, tip], statuses);
  expect(baseline.filter(item => item.part === "now").map(item => item.unitIds)).toEqual([[next.id]]);
  expect(baseline[0].holder).toBeUndefined();
  expect(curateWikiUnits(ledger, statuses, 1, 10, 10).selected.has(next.id)).toBe(true);
});

it("does not ask for a choice between style and journey, or a mock and deferred API integration", () => {
  const flow = unit(1, "首页类似 ChatGPT，输入需求后经对话层进入 Canvas，再识别旧物并仿真。", { facet: "交互流程" });
  const style = unit(2, "首页采用 ChatGPT/Claude 简洁风格，中央为大输入框。", { facet: "视觉风格", kind: "decision" });
  const mock = unit(3, "第一阶段允许 Mock AI，准备三个 Demo，确保 IR 到 Canvas 稳定后再接模型。"), api = unit(4, "第一阶段不依赖 LLM API，准备三个 Demo 以证明 IR 到 Canvas 链路稳定。");
  const ledger = book([flow, style, mock, api]);
  ledger.organization!.relations = [{ older: flow.id, newer: style.id, kind: "replaces", status: "unresolved" }, { older: mock.id, newer: api.id, kind: "replaces", status: "unresolved" }];
  expect(exclusiveWikiVersions(mock, api)).toBe(false);
  expect(wikiVersionQuestions(ledger, true).filter(question => question.kind === "versions")).toEqual([]);
  // Even a question kept by an older UI cannot discard the independent journey.
  const next = withVersionAnswer(ledger, { id: "old-question", kind: "versions", question: "?", options: [{ id: "older", label: flow.statement, unitIds: [flow.id] }, { id: "newer", label: style.statement, unitIds: [style.id] }] }, "newer");
  expect(next.decisions?.[style.id].verdict).toBe("confirmed");
  expect(next.decisions?.[flow.id]).toBeUndefined();
  const existing = { ...ledger, decisions: { [flow.id]: { verdict: "rejected" as const, at: 10 } } };
  expect(resolveWikiReading(existing).statuses.get(flow.id)).toBe("history");
});

it("does not hide the distinguishing end of a genuine version choice", () => {
  const prefix = "索引持久化方式".repeat(13), old = unit(1, `${prefix}：索引放在内存里。`, { kind: "mechanism" }), next = unit(2, `${prefix}：索引改放 IndexedDB。`, { kind: "mechanism" });
  const ledger = book([old, next]);
  ledger.organization!.relations = [{ older: old.id, newer: next.id, kind: "replaces", status: "unresolved" }];
  expect(wikiVersionQuestions(ledger, true)[0].options[1].label).toBe(next.statement);
});

it("does not use numbers elsewhere in a large quote to justify a point or borrow its decision label", () => {
  const style = unit(1, "首页采用简洁风格和大输入框。", { kind: "decision" });
  const header = unit(2, "Header 高度约 56-64px，右侧最多 3 个 action。", { kind: "constraint" });
  style.evidence.quote += header.statement;
  expect(claimSupported(header.statement, [style])).toBe(false);
  const ledger = withDraft({ ...book([style, header]), decisions: { [style.id]: { verdict: "confirmed", at: 1 } } }, [chapter([style, header], `${style.statement}${header.statement}`, [{ text: style.statement, unitIds: [style.id] }, { text: header.statement, unitIds: [style.id], markOnly: true }])]);
  const claim = ledgerDocument(ledger, {}).sections[0].claims!.find(claim => claim.text === header.statement)!;
  expect(claim.unitIds).toEqual([header.id]);
  expect(claim.holder).toBe("ai");
  expect(claim.userDecided).toBeUndefined();
});

it("never turns an unsupported following sentence into a holder mark on the preceding decision", () => {
  const style = unit(1, "首页采用简洁风格。", { kind: "decision" });
  const runs = holderRunClaims({ text: `${style.statement}Header 高度为 64px。`, unitIds: [style.id], claims: [{ text: style.statement, unitIds: [style.id] }] }, new Map([[style.id, style]]), new Map([[style.id, "confirmed"]]), new Map());
  expect(runs.some(claim => claim.text.includes("64px"))).toBe(false);
  const ledger = withDraft({ ...book([style]), decisions: { [style.id]: { verdict: "confirmed", at: 1 } } }, [chapter([style], "Header 高度为 64px。")]);
  expect(ledgerDocument(ledger, {}).sections[0].claims?.[0].userDecided).toBeUndefined();
});

it("checks presentation marks after final formatting and flags an unsupported number", () => {
  const style = unit(1, "首页采用简洁风格。", { kind: "decision" }), header = unit(2, "Header 高度约 56-64px，右侧最多 3 个 action。", { kind: "constraint" });
  const written = chapter([style, header], `${style.statement}${header.statement}`, [{ text: header.statement, unitIds: [style.id], markOnly: true }]);
  const report: Record<string, number> = {};
  validateFinalClaims([written], new Map([style, header].map(unit => [unit.id, unit])), report);
  expect(written.paragraphs[0].claims![0].unitIds).toEqual([header.id]);
  expect(report.claim_sources_rebound).toBe(1);
  const unsupported = chapter([style], "Header 高度为 900px。", [{ text: "Header 高度为 900px。", unitIds: [style.id], markOnly: true }]);
  validateFinalClaims([unsupported], new Map([[style.id, style]]));
  expect(unsupported.problems.some(problem => CRITICAL_PROBLEM.test(problem))).toBe(true);
});

it("keeps the supported offer as an AI proposal when final validation rejects a compound current-plan claim", () => {
  const detail = "先免费开放7天Agent体验，随后销售¥19.9的30天守护计划，验证后再推季度和年度套餐。";
  const offer = unit(1, `采用订阅模式：${detail}`, { kind: "plan" });
  const text = `早期的¥999买断方案已被否定；现行策略为${detail}`;
  const written = chapter([offer], text, [{ text, unitIds: [offer.id] }]);
  written.body = `### 方案\n\n${text}`;
  const report: Record<string, number> = {};
  validateFinalClaims([written], new Map([[offer.id, offer]]), report, [], new Map([[offer.id, "proposal"]]));
  expect(written.body).toBe(`### 方案\n\nAI 建议${detail}`);
  expect(written.paragraphs[0].claims).toEqual([{ text: `AI 建议${detail}`, unitIds: [offer.id] }]);
  expect(written.problems.some(problem => CRITICAL_PROBLEM.test(problem))).toBe(false);
  expect(report.unsupported_plans_qualified).toBe(1);
});

it("gives own positioning its own subject when the positioning chapter only holds a competitor", () => {
  const own = unit(1, "项目定位为面向初学者的创作工作台。"), code = unit(2, "密钥存于 session storage。"), rival = unit(3, "OtherTool 采用订阅制。", { about: { name: "OtherTool", role: "competitor" } });
  const ledger = book([own, code, rival]);
  ledger.organization!.subjects = [{ id: "s", name: "产品定位", aliases: [], unitIds: [own.id, code.id] }, { id: "r", name: "OtherTool 竞品分析", aliases: [], unitIds: [rival.id] }];
  ledger.organization!.chapters = [{ id: "ch", title: "技术架构", question: "?", group: "", subtopics: [{ title: "技术", subjectIds: ["s"] }] }, { id: "position", title: "产品定位与用户价值", question: "?", group: "", subtopics: [{ title: "竞品", subjectIds: ["r"] }] }];
  const { organization } = resolveWikiReading(ledger);
  const home = organization!.subjects.find(subject => subject.unitIds.includes(own.id))!;
  expect(home.id).not.toBe("r");
  expect(organization!.chapters.find(chapter => chapter.id === "position")!.subtopics.flatMap(topic => topic.subjectIds)).toContain(home.id);
  expect(organization!.subjects.find(subject => subject.unitIds.includes(code.id))!.id).toBe("s");
});

it("does not resurrect excluded projects when writing fails and an earlier draft is retained", async () => {
  const own = unit(1, "本项目使用本地索引。"), other = unit(2, "AnotherProject 使用云端服务。", { about: { name: "AnotherProject", role: "other_project" } });
  const ledger = withDraft(book([own, other]), [chapter([own], own.statement), { ...chapter([other], other.statement), id: "other", title: "相关项目：AnotherProject" }]);
  ledger.organization!.subjects = [{ id: "s", name: "索引", aliases: [], unitIds: [own.id] }, { id: "other", name: "AnotherProject", aliases: [], unitIds: [other.id] }];
  ledger.organization!.chapters.push({ id: "other", title: "相关项目：AnotherProject", question: "?", group: "", subtopics: [{ title: "AnotherProject", subjectIds: ["other"] }] });
  ledger.scopeAnswers = { anotherproject: "exclude" };
  const original = JSON.stringify(ledger.draft);
  const failed = await writeLedgerDraft(ledger, { ai: { generateStructured: async () => { throw new Error("offline"); } }, locale: "zh-CN", signal: new AbortController().signal });
  expect(failed.lastFailure?.step).toBe("write");
  expect(JSON.stringify(failed.draft)).toBe(original);
  expect(scopedWikiDraft(failed)!.chapters.map(chapter => chapter.id)).toEqual(["ch"]);
  expect(ledgerDocument(failed, {}).sections.map(section => section.id)).toEqual(["ch"]);
  expect(wikiDraftMarkdown(failed, "项目")).not.toContain("AnotherProject");
});

it("does not lend a confirmed buying direction to an adjacent feasibility question",()=>{
 const photo=unit(1,"支持拍照识别闲置零件。",{adoption:{status:"user_decision"}});
 photo.evidence={...photo.evidence,role:"user",quote:"可以做拍照识别的吗，识别以前不用的零件，你感觉怎么样"};
 const buy=unit(2,"直接询问购买元件，并提供比价推荐及链接。",{adoption:{status:"user_decision"}});
 buy.evidence={...buy.evidence,role:"user",quote:"我想直接询问购买元件，并提供比价推荐及链接"};
 const text="支持拍照识别闲置零件；直接询问购买元件，并提供比价推荐及链接。";
 const ledger=withDraft(book([photo,buy]),[chapter([photo,buy],text)]);
 const claims=ledgerDocument(ledger,{}).sections[0].claims!;
 expect(claims.find(claim=>claim.text.includes("拍照识别"))?.userDecided).toBeUndefined();
 expect(claims.find(claim=>claim.text.includes("比价推荐"))?.holder).toBe("decided");
});

it("checks unsupported replacement stories introduced by a supplement or final formatting",()=>{
 const flow=unit(1,"先确认需求再进入画布。"),style=unit(2,"首页采用大输入框和简洁风格。");
 const text="先确认需求再进入画布。该流程取代了早期的大输入框和简洁风格。";
 const saved=chapter([flow,style],text);
 validateFinalClaims([saved],new Map([flow,style].map(unit=>[unit.id,unit])));
 expect(saved.body).not.toContain("取代了");
 expect(saved.body).toContain(flow.statement);
});

it("keeps an explicit key-ownership decision independent of mixed implementation details",()=>{
 const key=unit(1,"让用户自己接 API，不用开发者的 Key。",{kind:"decision",adoption:{status:"user_decision"}});
 key.evidence={...key.evidence,role:"user",quote:"我想让用户自己接api，不想别人用我自己的"};
 const detail=unit(2,"ProviderConfig 允许配置模型和密钥。",{kind:"mechanism"});
 const written=chapter([key,detail],"系统复用 BYOK ProviderConfig，并允许配置模型和密钥。",[{text:"系统复用 BYOK ProviderConfig，并允许配置模型和密钥。",unitIds:[key.id,detail.id]}]);
 const ledger=book([key,detail]),statuses=wikiUnitStatuses([key,detail],ledger.organization!);
 expect(ensureWikiDecisions([written],ledger.organization!,[key,detail],statuses)).toBe(1);
 expect(written.paragraphs.find(paragraph=>paragraph.text===key.statement)?.claims).toEqual([{text:key.statement,unitIds:[key.id]}]);
 expect(ensureWikiDecisions([written],ledger.organization!,[key,detail],statuses)).toBe(0);
 const claims=ledgerDocument(withDraft(ledger,[written]),{}).sections[0].claims!;
 expect(claims.find(claim=>claim.text===key.statement)?.userDecided).toBe(true);
});

it("routes documentation, examples and progress out of broad positioning subjects without losing sources",()=>{
 const purpose=unit(1,"项目定位为面向初学者的创作平台。",{subject:"产品定位",kind:"fact"});
 const example=unit(2,"设备持续检测环境温度，超过阈值后报警。",{subject:"使用示例",kind:"mechanism"});
 const docs=unit(3,"建议将项目文档分为概览、架构和历史。",{subject:"文档结构"});
 const progress=unit(4,"已完成主框架和基础测试。",{subject:"Project Status",facet:"Completed Features",kind:"report"});
 const workflow=unit(5,"输入需求后确认方案。",{subject:"核心流程"}),technical=unit(6,"ProviderConfig 保存非敏感配置。",{subject:"架构",kind:"mechanism"}),plan=unit(7,"下一阶段开始验证。",{subject:"开发计划"});
 const units=[purpose,example,docs,progress,workflow,technical,plan],ledger=book(units);
 ledger.organization!.subjects=[{id:"s",name:"项目定位",aliases:[],unitIds:[purpose.id,example.id,progress.id]},{id:"w",name:"流程",aliases:[],unitIds:[workflow.id]},{id:"t",name:"技术",aliases:[],unitIds:[technical.id,docs.id]},{id:"p",name:"计划",aliases:[],unitIds:[plan.id]}];
 ledger.organization!.chapters=[...[["a","产品定位","s"],["b","核心工作流","w"],["c","技术架构","t"],["d","开发计划与质量保障","p"]].map(([id,title,subject])=>({id,title,question:"",group:"",subtopics:[{title,subjectIds:[subject]}]}))];
 ledger.organization!.groups=[{id:"mixed",core:workflow.statement,homeSubjectId:"w",anchorUnitId:workflow.id,signature:"mixed",members:[workflow,docs].map(unit=>({unitId:unit.id,support:unit.statement,adds:[],role:"adds" as const}))}];
 const before=JSON.stringify(ledger.organization),routed=routeWikiUnits(ledger.organization!,new Map(units.map(unit=>[unit.id,unit])));
 const home=(id:string)=>routed.chapters.find(chapter=>chapter.subtopics.some(topic=>topic.subjectIds.some(subject=>routed.subjects.find(row=>row.id===subject)?.unitIds.includes(id))))!.id;
 expect(home(purpose.id)).toBe("a");expect(home(example.id)).toBe("b");expect(home(docs.id)).toBe("d");expect(home(progress.id)).toBe("d");
 expect(routed.subjects.flatMap(subject=>subject.unitIds).sort()).toEqual(units.map(unit=>unit.id).sort());
 expect(JSON.stringify(ledger.organization)).toBe(before);
 expect(wikiUnitLane(example)).toBe("example");
 expect(routed.groups?.some(group=>group.members.some(member=>member.unitId===docs.id))).toBe(false);
});

it("repairs a table's counted object before final source validation",()=>{
 const task=unit(1,"准备20~30个真实用户任务，统计解析通过率。");
 const table="| 阶段 | 数量 | 指标 |\n| --- | --- | --- |\n| 真实用户 | 20~30个 | 解析通过率 |";
 const written=chapter([task],table),report:Record<string,number>={};
 validateFinalClaims([written],new Map([[task.id,task]]),report);
 expect(written.body).toContain("真实用户任务");
 expect(report.quantity_objects_restored).toBe(1);
});

it("routes a stage out of the interface chapter, README rules to the development plan and key rules to security",()=>{
 const freeze=unit(1,"建议进入Milestone 5 Alpha Validation阶段，冻结大功能1-2周。",{subject:"Milestone 5",facet:"Alpha Validation"});
 const theme=unit(2,"所有新页面必须支持 Dark Mode。",{subject:"Dark Mode",kind:"constraint"});
 const readme=unit(3,"README需增加Pipeline Hardening章节。",{subject:"文档更新",facet:"README要求"});
 const shop=unit(4,"第一版只提供缺件清单。",{subject:"采购"});
 const proxy=unit(5,"/api/ai/proxy 仅接受结构化生成，不记录密钥。",{subject:"AI代理限制",facet:"后端安全",kind:"mechanism"});
 const rollback=unit(6,"Candidate IR 依次通过 Zod 与 Validator，失败即回滚。",{subject:"Transaction / Rollback",facet:"安全机制",kind:"mechanism"});
 const roadmap=unit(7,"按阶段推进。",{subject:"路线"}),key=unit(8,"API Key 由用户提供。",{subject:"BYOK",kind:"decision"}),architecture=unit(9,"Hardware IR 是唯一事实源。",{subject:"架构",kind:"mechanism"});
 const example=unit(10,"设备持续检测环境温度，超过阈值后报警。",{subject:"使用示例",kind:"mechanism"});
 const units=[freeze,theme,readme,shop,proxy,rollback,roadmap,key,architecture,example],ledger=book(units);
 ledger.organization!.subjects=[{id:"ui",name:"界面",aliases:[],unitIds:[freeze.id,theme.id]},{id:"buy",name:"采购",aliases:[],unitIds:[readme.id,shop.id]},{id:"plan",name:"规划",aliases:[],unitIds:[proxy.id,roadmap.id,example.id]},{id:"tech",name:"技术",aliases:[],unitIds:[rollback.id,architecture.id]},{id:"safe",name:"密钥",aliases:[],unitIds:[key.id]}];
 ledger.organization!.chapters=[["a","界面设计与交互体验","ui"],["b","采购与实物集成","buy"],["c","开发规划与质量保障","plan"],["d","技术架构与数据模型","tech"],["e","硬件验证与安全策略","safe"]].map(([id,title,subject])=>({id,title,question:"",group:"",subtopics:[{title,subjectIds:[subject]}]}));
 const routed=routeWikiUnits(ledger.organization!,new Map(units.map(item=>[item.id,item])));
 const home=(id:string)=>routed.chapters.find(chapter=>chapter.subtopics.some(topic=>topic.subjectIds.some(subject=>routed.subjects.find(row=>row.id===subject)?.unitIds.includes(id))))!.id;
 expect([freeze,theme,readme,proxy,rollback,example].map(item=>home(item.id))).toEqual(["c","a","c","e","d","c"]);
});

it("routes a point into the planned subtopic its words fit, and opens a role heading only when none does",()=>{
 const rule=unit(1,"Validator 作为规则引擎核心，分为结构、电气和可构建性三层，检查 GPIO 冲突。",{subject:"Validator 架构",kind:"mechanism"});
 const stray=unit(2,"项目目录采用 Next.js App Router 与 components 分层。",{subject:"目录结构",kind:"mechanism"});
 const engine=unit(3,"规则引擎确定性运行，Validator 检查 GPIO 冲突与电压兼容。",{subject:"规则引擎",kind:"mechanism"});
 const parts=unit(4,"优先使用成熟主控板和成品模块。",{subject:"元件策略",kind:"decision"});
 const units=[rule,stray,engine,parts],ledger=book(units);
 ledger.organization!.subjects=[{id:"plan",name:"规划",aliases:[],unitIds:[rule.id,stray.id]},{id:"rules",name:"规则引擎",aliases:[],unitIds:[engine.id]},{id:"parts",name:"元件",aliases:[],unitIds:[parts.id]}];
 ledger.organization!.chapters=[{id:"p",title:"开发规划与发布策略",question:"",group:"",subtopics:[{title:"版本路线图",subjectIds:["plan"]}]},{id:"t",title:"技术架构与验证引擎",question:"",group:"",subtopics:[{title:"元件策略",subjectIds:["parts"]},{title:"规则引擎与电气验证",subjectIds:["rules"]}]}];
 const routed=routeWikiUnits(ledger.organization!,new Map(units.map(item=>[item.id,item])));
 const topicOf=(id:string)=>routed.chapters.flatMap(chapter=>chapter.subtopics).find(topic=>topic.subjectIds.some(subject=>routed.subjects.find(row=>row.id===subject)?.unitIds.includes(id)))?.title;
 expect(topicOf(rule.id)).toBe("规则引擎与电气验证");
 expect(topicOf(stray.id)).toBe("实现机制");
});

it("leaves out the untagged rest of an excluded project, and a subtopic named for it, though nothing was extracted again",()=>{
 const atlas={about:{name:"ChatAtlas",role:"other_project" as const}};
 const said=(n:number,statement:string,extra:Partial<WikiKnowledgeUnit>={})=>unit(n,statement,{evidence:{evidenceId:`e${n}`,conversationId:"c",messageId:"review",messageIndex:9,role:"assistant",pasted:false,quote:statement},...extra});
 const own=Array.from({length:22},(_,index)=>unit(index+20,`Hardware IR 方案第 ${index} 条：Validator 检查 GPIO 冲突。`));
 const review=[said(1,"每条结论区分已决定和建议。",atlas),said(2,"文档顶部显示当前状态快照。",atlas),said(3,"需识别新决定替代旧决定的关系。"),said(4,"建立人工标注的项目事件基准。",{subject:"Project Understanding Bench"})];
 const units=[...own,...review],ledger={...book(units),scopeAnswers:{chatatlas:"exclude" as const}};
 ledger.organization!.subjects=[{id:"s",name:"项目",aliases:[],unitIds:own.map(item=>item.id)},{id:"a",name:"ChatAtlas",aliases:[],unitIds:review.slice(0,2).map(item=>item.id)},{id:"b",name:"决策演变",aliases:[],unitIds:[review[2].id]},{id:"x",name:"基准",aliases:[],unitIds:[review[3].id]}];
 ledger.organization!.chapters=[{id:"ch",title:"竞品分析",question:"",group:"",subtopics:[{title:"方案",subjectIds:["s"]},{title:"相关项目：ChatAtlas",subjectIds:["a","b"]},{title:"评测",subjectIds:["x"]}]}];
 const live=new Set(resolveWikiReading(ledger).organization!.subjects.flatMap(subject=>subject.unitIds));
 expect(review.filter(item=>live.has(item.id))).toEqual([]);
 expect(own.every(item=>live.has(item.id))).toBe(true);
});

it("routes the code's layout to the architecture, a development stage out of the interface, and a theme rule out of the plan",()=>{
 expect(wikiUnitLane(unit(1,"采用 Next.js App Router 结构，包含 app/api、components。",{subject:"项目目录结构"}))).toBe("technical");
 expect(wikiUnitLane(unit(2,"第一阶段允许 Mock AI，先准备三个 Demo。",{subject:"Mock AI策略",facet:"开发阶段安排"}))).toBe("stage");
 expect(wikiUnitLane(unit(3,"提供 Light/Dark/System 选项，localStorage 保存设置。",{subject:"Theme Toggle",facet:"主题同步",kind:"constraint"}))).toBe("interface");
});

it("gathers versions of one setting told with other values in two subjects, and keeps different objects apart",()=>{
 const first=unit(1,"底部区域默认折叠为36-40px的Bottom Bar以最大化Canvas空间，点击后展开显示BOM、Validation及Design Intent等信息。",{kind:"constraint"});
 const later=unit(2,"底部Drawer默认收起，仅保留40-48px高的Tab Bar（架构/BOM/校验），点击后展开对应内容。",{kind:"decision"});
 const toolbar=unit(3,"顶部工具栏高度44~50px，左侧显示项目名。",{kind:"constraint"}),nav=unit(4,"导航栏高度约56~64px，左侧为Logo。",{kind:"constraint"});
 const units=[first,later,toolbar,nav],ledger=book(units);
 ledger.organization!.subjects=[{id:"a",name:"工作台",aliases:[],unitIds:[first.id,toolbar.id]},{id:"b",name:"布局",aliases:[],unitIds:[later.id,nav.id]}];
 ledger.organization!.chapters=[{id:"c",title:"界面",question:"",group:"",subtopics:[{title:"工作台",subjectIds:["a"]},{title:"布局",subjectIds:["b"]}]}];
 const gathered=gatherVersions(ledger.organization!,new Map(units.map(item=>[item.id,item])));
 const home=(id:string)=>gathered.subjects.find(subject=>subject.unitIds.includes(id))!.id;
 expect([home(first.id),home(later.id),home(toolbar.id),home(nav.id)]).toEqual(["a","a","a","b"]);
});

it("names a chapter for the user's own direction by what it holds when it holds none of it",()=>{
 const phase=unit(1,"采用分阶段开发，先完成 Phase A 再开始 Phase B。"),alpha=unit(2,"Alpha 阶段通过标准为核心 E2E 流程通过率>95%。"),path=unit(3,"我需要学习 FreeRTOS 和 ROS2，最终汇合到机器人领域。");
 const plan=book([phase,alpha]);plan.organization!.chapters=[{id:"ch",title:"个人方向与学习路线",question:"",group:"",subtopics:[{title:"方案",subjectIds:["s"]}]}];
 expect(retitleMisnamedChapters(plan.organization!,new Map([phase,alpha].map(item=>[item.id,item]))).chapters[0].title).toBe("开发计划与流程");
 // Holding the user's direction, it keeps its title.
 const own=book([phase,path]);own.organization!.chapters=[{id:"ch",title:"个人方向与学习路线",question:"",group:"",subtopics:[{title:"方案",subjectIds:["s"]}]}];
 expect(retitleMisnamedChapters(own.organization!,new Map([phase,path].map(item=>[item.id,item]))).chapters[0].title).toBe("个人方向与学习路线");
});

it("routes whole roadmaps to the plan chapter and tells the positioning in one subtopic",()=>{
 const phases=unit(1,"分7个Phase：1.Foundation, 2.Hardware Domain, 3.Canvas, 4.Workspace UI。"),milestones=unit(2,"开发按7个里程碑推进：静态Canvas、IR转Canvas、Prompt转IR。"),panel=unit(3,"右侧AI面板定位为Hardware Copilot。",{kind:"decision"});
 const first=unit(4,"项目定位为面向硬件小白的AI辅助硬件设计工具。",{kind:"fact"}),second=unit(5,"产品形态定位为Web端可视化工作台。",{kind:"fact"});
 const units=[phases,milestones,panel,first,second],ledger=book(units);
 ledger.organization!.subjects=[{id:"ui",name:"界面",aliases:[],unitIds:[phases.id]},{id:"tech",name:"架构",aliases:[],unitIds:[milestones.id]},{id:"plan",name:"计划",aliases:[],unitIds:[]},{id:"p1",name:"核心",aliases:[],unitIds:[first.id,panel.id]},{id:"p2",name:"形态",aliases:[],unitIds:[second.id]}];
 ledger.organization!.chapters=[{id:"a",title:"产品定位与用户价值",question:"",group:"",subtopics:[{title:"核心",subjectIds:["p1"]},{title:"形态",subjectIds:["p2"]}]},{id:"b",title:"界面设计",question:"",group:"",subtopics:[{title:"界面",subjectIds:["ui"]}]},{id:"c",title:"技术架构",question:"",group:"",subtopics:[{title:"架构",subjectIds:["tech"]}]},{id:"d",title:"开发计划与流程",question:"",group:"",subtopics:[{title:"计划",subjectIds:["plan"]}]}];
 const known=new Map(units.map(item=>[item.id,item]));
 const routed=routeWikiUnits(gatherPositioning(ledger.organization!,known),known);
 const home=(id:string)=>routed.chapters.find(chapter=>chapter.subtopics.some(topic=>topic.subjectIds.some(subject=>routed.subjects.find(row=>row.id===subject)?.unitIds.includes(id))))!.id;
 const subjectOf=(id:string)=>routed.subjects.find(subject=>subject.unitIds.includes(id))!.id;
 expect([home(phases.id),home(milestones.id)]).toEqual(["d","d"]);
 expect(subjectOf(second.id)).toBe(subjectOf(first.id));
 expect(wikiUnitLane(panel)).not.toBe("roadmap");
});

it("keeps the own sections of a chapter only partly about competitors",()=>{
 const rival=unit(1,"Quittr 宣称超过100万次下载。",{kind:"fact",about:{name:"Quittr",role:"competitor" as const}}),retention=unit(2,"小程序目前每天稳定在22人，其中15个为稳定用户。",{subject:"用户留存现状",kind:"fact"});
 const ui=unit(3,"首页仅展示最近7天记录，完整月历移至二级页面。",{subject:"首页",kind:"decision"}),stray=unit(4,"小程序目前日活稳定，首页仅展示最近7天记录。",{kind:"fact"});
 const units=[rival,retention,ui,stray],ledger=book(units);
 ledger.organization!.subjects=[{id:"q",name:"Quittr竞品分析",aliases:[],unitIds:[rival.id,stray.id]},{id:"r",name:"用户留存现状",aliases:[],unitIds:[retention.id]},{id:"u",name:"首页",aliases:[],unitIds:[ui.id]}];
 ledger.organization!.chapters=[{id:"a",title:"界面交互与视觉设计",question:"",group:"",subtopics:[{title:"首页布局",subjectIds:["u"]}]},{id:"b",title:"增长运营与竞品参考",question:"",group:"",subtopics:[{title:"开发迭代规划",subjectIds:["r"]},{title:"海外竞品分析",subjectIds:["q"]}]}];
 const known=new Map(units.map(item=>[item.id,item]));
 const routed=routeOutOfReferences(ledger.organization!,known);
 // The retention section stays in its chapter; the comparison section still gives up a point of this project's own.
 expect(routed.subjects.find(subject=>subject.id==="r")!.unitIds).toEqual([retention.id]);
 expect(routed.subjects.find(subject=>subject.id==="q")!.unitIds).toEqual([rival.id]);
});

it("moves this project's own points out of the references chapter, and gathers one tool's plans in one place",()=>{
 const flux={about:{name:"Boardly",role:"competitor" as const}};
 const rival=unit(1,"Boardly 面向专业工程师，覆盖从需求到 PCB 仿真。",{kind:"fact",...flux}),theme=unit(2,"提供Light/Dark/System选项，localStorage保存设置，切换时禁止React Flow背景残留白色。",{subject:"Theme Toggle",kind:"constraint"});
 const ui=unit(3,"复用现有 Light/Dark/System Theme，Light 模式 Page #FAFAFA。",{subject:"主题",kind:"constraint"}),own=unit(4,"刻意避开灵犀造物路线，形成差异化。",{kind:"plan"});
 const integrate=unit(5,"集成 Wokwi 在线仿真器，用于验证生成的代码。",{kind:"mechanism"}),send=unit(6,"V1 不自建仿真器，而是生成项目后引导用户跳转至 Wokwi 进行在线仿真。",{kind:"decision"}),later=unit(7,"Wokwi仿真集成推迟至Prompt到Code流程稳定后进行。",{kind:"decision"});
 const listed=unit(8,"当前阶段禁止扩展PCB、KiCad、Wokwi、代码生成、复杂接线、数据库。",{kind:"constraint"});
 const units=[rival,theme,ui,own,integrate,send,later,listed],ledger=book(units);
 ledger.organization!.subjects=[{id:"r",name:"竞品",aliases:[],unitIds:[rival.id,theme.id,own.id,send.id]},{id:"u",name:"主题",aliases:[],unitIds:[ui.id]},{id:"v",name:"验证",aliases:[],unitIds:[integrate.id]},{id:"p",name:"路线",aliases:[],unitIds:[later.id,listed.id]}];
 ledger.organization!.chapters=[["a","竞品分析与参考项目","r"],["b","界面设计与交互体验","u"],["c","硬件知识库与验证引擎","v"],["d","开发规划与发布策略","p"]].map(([id,title,subject])=>({id,title,question:"",group:"",subtopics:[{title,subjectIds:[subject]}]}));
 const known=new Map(units.map(item=>[item.id,item]));
 const routed=gatherNamedItems(routeOutOfReferences(ledger.organization!,known),known);
 const home=(id:string)=>routed.chapters.find(chapter=>chapter.subtopics.some(topic=>topic.subjectIds.some(subject=>routed.subjects.find(row=>row.id===subject)?.unitIds.includes(id))))!.id;
 // A competitor, and a comparison, stay; the theme rule goes to the interface.
 expect([home(rival.id),home(own.id),home(theme.id)]).toEqual(["a","a","b"]);
 // The three plans for Wokwi sit with the latest; a list only naming it stays where it is.
 expect([home(integrate.id),home(send.id),home(later.id),home(listed.id)]).toEqual(["d","d","d","d"]);
 expect(routed.subjects.find(subject=>subject.unitIds.includes(listed.id))!.id).toBe("p");
});

it("routes a page layout out of the architecture and a version's scope out of the visual rules", () => {
  expect(wikiUnitLane(unit(1, "采用大面积空白和极简Hero，中间放置宽约600～720px的输入框及CTA。", { subject: "Landing Page", facet: "视觉极简主义", kind: "decision" }))).toBe("interface");
  expect(wikiUnitLane(unit(2, "第一版严格限定为 ESP32 DevKit V1 + 常见模块，禁止加入 PCB设计、STM32、高压电路。", { subject: "V0.1 范围", facet: "功能限制", kind: "constraint" }))).toBe("stage");
});

it("names the parts that set a global rule's property otherwise, and what the user says a part does not do yet", () => {
  const rule = unit(1, "全局圆角统一控制在6px~8px，禁止使用16px以上的大圆角。", { subject: "Border Radius", kind: "constraint" });
  const composer = unit(2, "采用极简设计，圆角极轻边框，无阴影；max-width 760~800px，border-radius 20~26px，padding 16~20px。", { subject: "Welcome Screen", kind: "decision" });
  const button = unit(3, "Primary按钮高度40~44px，圆角6~8px。", { subject: "CTA", kind: "decision" });
  expect([...componentExceptions([rule, composer, button])]).toEqual([[rule.id, ["Welcome Screen：border-radius 20~26px"]]]);
  const report = unit(7, "当前画布仅为架构预览；Validator不检查电压、GPIO冲突或电源安全。", { kind: "constraint" });
  report.evidence = { ...report.evidence, role: "user" };
  const engine = unit(5, "构建 Compatibility Engine，用于实时检查电压、电流及通信协议冲突。", { kind: "fact" });
  const shopping = unit(6, "商品搜索后必须经过“兼容性检查”的确定性流程，需确保逻辑电压符合当前设计。", { kind: "constraint" });
  const lacks = currentCapabilityState([report, engine, shopping], new Map());
  expect([...lacks.keys()]).toEqual([engine.id]);
  expect(lacks.get(engine.id)).toEqual({ id: report.id, text: expect.stringContaining("Validator不检查电压") });
});

it("tells a report of what a part does not do yet as before once later units build it", () => {
  const design = unit(24, "实现确定性执行的 validateProject 函数，检查元件存在性、Pin存在性、电压兼容、GPIO冲突等基础电气规则。", { kind: "mechanism" });
  const report = unit(58, "当前画布仅为架构预览，不能直接照图接线；Validator不检查电压、GPIO冲突、I²C地址或电源安全。", { kind: "constraint" });
  report.evidence = { ...report.evidence, role: "user" };
  const built = unit(59, "实现 GPIO 冲突、I²C 地址冲突、电压兼容、负载驱动检查等六类电气规则，Validator 检查这些冲突。", { kind: "mechanism", delivery: "user_reported" });
  // Only proposed after the report: still a plan, and the report holds.
  const proposed = { ...built, delivery: "unknown" as const };
  expect(outdatedCapabilityReports([design, report, proposed], new Map()).size).toBe(0);
  expect([...currentCapabilityState([design, report, proposed], new Map()).keys()]).toEqual([design.id, proposed.id]);
  const units = [design, report, built];
  expect(currentCapabilityState(units, new Map()).size).toBe(0);
  const outdated = outdatedCapabilityReports(units, new Map());
  expect([...outdated]).toEqual([[report.id, "Validator"]]);
  const text = "实现确定性执行的 validateProject 函数，检查电压兼容、GPIO冲突。当前 Validator 不检查电压、GPIO冲突、I²C地址或电源安全；计划补充电压兼容检查。";
  const written = { ...chapter([design, report], text), body: `当前 Validator 不检查电压、GPIO 冲突或电源安全，画布仅为架构预览。\n\n### 方案\n\n${text}` };
  expect(pastCapabilityWords([written], outdated)).toBe(2);
  expect(written.paragraphs[0].text).toContain("此前 Validator 不检查电压");
  expect(written.paragraphs[0].text).toContain("检查电压兼容、GPIO冲突。");
  expect(written.body.startsWith("此前 Validator 不检查电压")).toBe(true);
  expect(written.body).not.toContain("当前 Validator");
});

it("never lets an earlier point replace one said after it, and notes a global rule's part values", () => {
  const decision = unit(50, "采用 BYOK 模式，默认仅保存在当前浏览器会话中，不保存到服务器。", { kind: "decision", adoption: { status: "user_decision" } });
  decision.evidence = { ...decision.evidence, role: "user", quote: "我想让用户自己接api" };
  const how = unit(53, "默认将 API Key 仅保存在运行时内存，刷新即消失；可选 sessionStorage，禁止默认使用 localStorage。", { kind: "mechanism" });
  const ledger = book([decision, how]);
  ledger.organization!.relations = [{ older: how.id, newer: decision.id, kind: "replaces", status: "resolved", evidence: "我想让用户自己接api" }];
  const read = resolveWikiReading(ledger);
  expect(read.organization!.relations).toContainEqual(expect.objectContaining({ older: decision.id, newer: how.id, kind: "supplements" }));
  expect(wikiUnitStatuses([decision, how], read.organization!).get(how.id)).not.toBe("history");
  const rule = unit(1, "全局圆角统一控制在6px~8px，禁止使用16px以上的大圆角。", { kind: "constraint" });
  const composer = unit(2, "max-width 760~800px，border-radius 20~26px，padding 16~20px。", { kind: "decision" });
  composer.subject = "Welcome Screen";
  const paragraph = { text: "- **圆角**：全局圆角统一控制在 6px~8px。\n- **间距**：节点间距增加 15%。", unitIds: [rule.id], claims: [{ text: "全局圆角统一控制在 6px~8px。", unitIds: [rule.id] }] };
  expect(notePartExceptions([paragraph], new Map([[rule.id, rule], [composer.id, composer]]), componentParts([rule, composer]))).toBe(1);
  expect(paragraph.text.split("\n")[0]).toBe("- **圆角**：全局圆角统一控制在 6px~8px（以下组件另有取值：Welcome Screen border-radius 20~26px；是组件例外还是后来的规范，讨论中未明确）。");
  expect(paragraph.text.includes(paragraph.claims[0].text)).toBe(true);
});

it("leaves a code from the section before a quote's break out of the unit's details", () => {
  const quote = "> `LOAD_REQUIRES_DRIVER ERROR`\n\n技术 code 可以内部保留。\n\n---\n\n# 第九阶段：Canvas通过以后，才出现下一步\n\n只有设计达到 VERIFIED 或允许继续，才出现仿真入口，侧重行为模拟。";
  const simulation = unit(1, "仿真入口仅在 Canvas 设计通过（VERIFIED 或允许继续）后才出现，侧重行为模拟。", { kind: "decision", details: ["LOAD_REQUIRES_DRIVER ERROR", "VERIFIED"] });
  simulation.evidence = { ...simulation.evidence, quote };
  expect(foreignDetail(simulation, "LOAD_REQUIRES_DRIVER ERROR")).toBe(true);
  expect(wikiUnitDetails(simulation)).not.toContain("LOAD_REQUIRES_DRIVER ERROR");
  expect(ownSection(quote, simulation.statement)).toContain("仿真入口");
});

it("keeps open whether a part's own value is an exception, and has the line cite the parts", () => {
  const rule = unit(1, "全局圆角统一控制在6px~8px，禁止使用16px以上的大圆角。", { kind: "constraint" });
  const composer = unit(2, "max-width 760~800px，border-radius 20~26px，padding 16~20px。", { kind: "decision" });
  composer.subject = "Welcome Screen";
  const line = "- **圆角规范**：全局圆角统一控制在6px~8px，禁止使用16px以上的大圆角；Welcome Screen border-radius 20~26px为组件例外。";
  const paragraph = { text: line, unitIds: [rule.id], claims: [{ text: line.slice(line.indexOf("全局")), unitIds: [rule.id] }] };
  expect(notePartExceptions([paragraph], new Map([[rule.id, rule], [composer.id, composer]]), componentParts([rule, composer]))).toBe(1);
  expect(paragraph.text).toBe("- **圆角规范**：全局圆角统一控制在6px~8px，禁止使用16px以上的大圆角；Welcome Screen border-radius 20~26px另有取值（是组件例外还是后来的规范，讨论中未明确）。");
  expect(paragraph.claims[0].unitIds).toEqual([rule.id, composer.id]);
  expect(paragraph.text.includes(paragraph.claims[0].text)).toBe(true);
  expect(paragraph.unitIds).toContain(composer.id);
});

it("does not add a decision again when its steps already state it",()=>{
 const flow=unit(1,"首屏采用ChatGPT式简洁欢迎页，用户输入需求后进入对话层确定清单，再进入Canvas，中间嵌套旧物识别，最后进行仿真。",{kind:"decision",adoption:{status:"user_decision"}});
 flow.evidence={...flow.evidence,role:"user",quote:flow.statement};
 const steps=["采用ChatGPT式简洁欢迎页。","用户输入需求后进入此层确定清单。","确定清单后进入画布视图。","在流程中间嵌套旧物识别环节。","最后进行仿真操作。"];
 const written=chapter([flow],steps.map((text,index)=>`${index+1}. **步骤${index+1}**：${text}`).join("\n"),steps.map(text=>({text,unitIds:[flow.id]})));
 const ledger=book([flow]),statuses=wikiUnitStatuses([flow],ledger.organization!);
 expect(ensureWikiDecisions([written],ledger.organization!,[flow],statuses)).toBe(0);
 expect(written.paragraphs).toHaveLength(1);
});

it("does not write back a decision whose sentence lost a default a later message changed",()=>{
 const byok=unit(1,"采用 BYOK 模式，默认仅保存在当前浏览器会话中，不保存到服务器，以降低运营成本并保护用户隐私。",{kind:"decision",adoption:{status:"user_decision"}});
 byok.evidence={...byok.evidence,role:"user",quote:"我想让用户自己接api，我不想别人用我自己的"};
 const left="采用 BYOK 模式，不保存到服务器。",ledger=book([byok]),statuses=wikiUnitStatuses([byok],ledger.organization!);
 const written=()=>chapter([byok],left,[{text:left,unitIds:[byok.id]}]);
 const trimmed=written();
 expect(ensureWikiDecisions([trimmed],ledger.organization!,[byok],statuses,new Set([byok.id]))).toBe(0);
 expect(trimmed.paragraphs).toHaveLength(1);
 // Without the note, the shorter sentence does not state the decision, and it is written in full.
 expect(ensureWikiDecisions([written()],ledger.organization!,[byok],statuses)).toBe(1);
});

it("adds a decision before the paragraph that opens with its words, which then goes on without them",()=>{
 const flow=unit(1,"首屏采用ChatGPT式简洁欢迎页，用户输入需求后进入对话层确定清单，再进入Canvas，中间嵌套旧物识别，最后进行仿真。",{kind:"decision",adoption:{status:"user_decision"}});
 flow.evidence={...flow.evidence,role:"user",quote:flow.statement};
 const text="首屏采用 ChatGPT 式简洁欢迎页，用户输入需求后不直接生成 Canvas，而是通过轻量对话复述目标。";
 const written=chapter([flow],text,[{text:"用户输入需求后不直接生成 Canvas，而是通过轻量对话复述目标。",unitIds:[flow.id]}]);
 const ledger=book([flow]),statuses=wikiUnitStatuses([flow],ledger.organization!);
 expect(ensureWikiDecisions([written],ledger.organization!,[flow],statuses)).toBe(1);
 expect(written.paragraphs.map(paragraph=>paragraph.text)).toEqual([flow.statement,"用户输入需求后不直接生成 Canvas，而是通过轻量对话复述目标。"]);
 expect(written.body).toBe(`${flow.statement}\n\n用户输入需求后不直接生成 Canvas，而是通过轻量对话复述目标。`);
 expect(written.body.match(/简洁欢迎页/gu)).toHaveLength(1);
});

it("moves delivery rules and test plans to the plan chapter's testing subtopic, out of its roadmap",()=>{
 const flow=unit(1,"每个Phase开始需说明目标/文件/理由/风险，完成后必须通过lint/typecheck/test/build。",{kind:"constraint"});flow.subject="开发工作流要求";flow.facet="交付标准";
 const bench=unit(2,"建立 tests/e2e-hardware-bench/，准备 20~30 个真实用户需求。",{kind:"plan"});bench.subject="End-to-End HardwareBench";
 const step=unit(3,"Phase 1 建立最基础 Hardware IR Schema。",{kind:"plan"});
 const rule=unit(4,"提交前运行 lint 和 test。",{kind:"constraint"});
 const organization={...book([]).organization!,subjects:[{id:"ui",name:"Bottom Panel",aliases:[],unitIds:[flow.id]},{id:"road",name:"开发路线图",aliases:[],unitIds:[step.id,bench.id]},{id:"tests",name:"测试要求",aliases:[],unitIds:[rule.id]}],
  chapters:[{id:"a",title:"界面设计与交互体验",question:"",group:"",subtopics:[{title:"元件库与库存管理UI",subjectIds:["ui"]}]},{id:"b",title:"开发规划与发布策略",question:"",group:"",subtopics:[{title:"版本路线图与功能范围",subjectIds:["road"]},{title:"工程规范与测试要求",subjectIds:["tests"]}]}]};
 const routed=routeWikiUnits(organization,new Map([flow,bench,step,rule].map(item=>[item.id,item])));
 expect([...routed.subjects.find(subject=>subject.id==="tests")!.unitIds].sort()).toEqual([rule.id,bench.id,flow.id].sort());
 expect(routed.subjects.find(subject=>subject.id==="road")!.unitIds).toEqual([step.id]);
 expect(routed.chapters[0]?.title).not.toBe("界面设计与交互体验");
});

it("keeps the error code and address a short quote about the rule gives in plain text",()=>{
 const i2c=unit(1,"检查SDA/SCL类型及同一Bus下的设备地址冲突，未知地址仅给info提示。",{kind:"constraint"});
 i2c.evidence={...i2c.evidence,quote:"- I²C 设备是否连接到正确 bus\n- 同一 bus 地址冲突\n\n如果两个设备声明：\n\n0x3C\n\n并处于同一 I²C bus：\n\n产生：\n\nI2C_ADDRESS_CONFLICT"};
 expect(wikiUnitDetails(i2c)).toEqual(["0x3C","I2C_ADDRESS_CONFLICT"]);
 const long=unit(2,"检查地址冲突。",{kind:"constraint"});long.evidence={...long.evidence,quote:`${"其他说明。".repeat(140)}\n\nOTHER_RULE_CODE`};
 expect(wikiUnitDetails(long)).toEqual([]);
});
