import { expect, it } from "vitest";
import { exportChapters, scoreWikiEvaluation, type WikiEvalCases } from "./wiki-eval";
import type { WikiKnowledgeLedger } from "../shared/wiki-knowledge";
import { aboutName, scoreWikiLedger } from "./wiki-eval";
import casesText from "./fixtures/wiki-eval/cases.json?raw";
import goodExport from "./fixtures/wiki-eval/good.md?raw";
import badExport from "./fixtures/wiki-eval/bad.md?raw";

const files: Record<string, string> = { "good.md": goodExport, "bad.md": badExport };
const fixture = (name: string) => files[name];
const cases = JSON.parse(casesText) as WikiEvalCases;
const labelled = (report: ReturnType<typeof scoreWikiEvaluation>) => report.results.filter(result => result.type !== "hygiene" && result.type !== "reader");
const failed = (markdown: string) => labelled(scoreWikiEvaluation(markdown, cases)).filter(result => !result.pass).map(result => result.id);

it("reads chapters, subtopics and key conclusions but not the overview or the source index", () => {
  const chapters = exportChapters(fixture("good.md"));
  expect(chapters.map(chapter => chapter.title)).toEqual(["存储", "同步"]);
  expect(chapters[1].subtopics).toEqual(["冲突处理", "云同步建议"]);
  expect(chapters[0].keyLines).toHaveLength(1);
  expect(chapters.flatMap(chapter => chapter.paragraphs).join("")).not.toContain("不计入正文");
});

it("passes a well-formed export on every case", () => {
  const report = scoreWikiEvaluation(fixture("good.md"), cases, { requests: 12 });
  expect(failed(fixture("good.md"))).toEqual([]);
  expect(report.score).toBe(10);
  expect(report.shape).toMatchObject({ chapters: 2, subtopics: 3, maxSubtopics: 2 });
  expect(report.run).toEqual({ requests: 12 });
});

it("catches each defect type: mislabelled decision, split subject, repeat, lost details, unsupported wording, unowned chapters", () => {
  expect(failed(fixture("bad.md"))).toEqual(["A1", "A2", "B1", "C1", "D1", "D2", "E1", "F1"]);
  const report = scoreWikiEvaluation(fixture("bad.md"), cases);
  expect(report.results.find(result => result.id === "A1")?.detail).toBe("read as proposal ×1");
  expect(report.results.find(result => result.id === "A2")?.detail).toBe("read as decision ×1");
  expect(report.results.find(result => result.id === "C1")?.detail).toBe("2 paragraphs explain it");
  expect(report.results.find(result => result.id === "F1")?.detail).toContain("unowned chapters: Notes App 项目");
  // The repeated explanation is present, so repetition fails and presence passes; the fixture is otherwise clean (hygiene passes).
  expect(report.results.filter(result => result.id === "C1").map(result => [result.type, result.pass])).toEqual([["duplicate", false], ["presence", true]]);
  // The bad export also says status in words beside its marks (H7).
  // Each case counts once; the earlier mean of per-type rates is kept beside it.
  // Its six reader checks pass: it has none of those defects.
  expect(report.score).toBe(5.9);
  expect(report.typeScore).toBe(3.2);
  expect(report.qualifiersPer1000).toBeGreaterThan(0);
});

it("leaves unreviewed adoption cases out of the score", () => {
  const draft: WikiEvalCases = { ...cases, cases: [{ id: "A9", type: "adoption", statement: "SQLite", expected: "proposal", needsReview: true }, ...cases.cases.filter(item => item.type === "detail")] };
  const report = scoreWikiEvaluation(fixture("good.md"), draft);
  expect(report.byType).toMatchObject({ detail: { passed: 2, total: 2 } });expect(report.byType.adoption).toBeUndefined();
  expect(report.results[0]).toMatchObject({ id: "A9", needsReview: true });
});

it("scores a knowledge-unit ledger on adoption, details and coverage before any document exists", async () => {
  const { scoreWikiLedger } = await import("./wiki-eval");
  const evidence = (id: string, role: "user" | "assistant", pasted = false) => ({ evidenceId: id, conversationId: "c", messageId: id, messageIndex: 0, role, pasted, quote: "" });
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "partial", materials: 4, batches: [
    { sourceIds: ["a", "b"], status: "ok" as const, rejected: { quote: 1 }, units: [
      { id: "u1", subject: "存储", statement: "笔记保存在 SQLite 中。", kind: "decision" as const, details: [], evidence: evidence("a", "assistant"), adoption: { status: "user_adopted" as const }, delivery: "unknown" as const },
      { id: "u2", subject: "同步", statement: "提供云同步，每 30 秒检查一次。", kind: "plan" as const, details: ["30 秒"], evidence: evidence("b", "assistant"), adoption: { status: "proposal" as const }, delivery: "unknown" as const },
    ] },
    { sourceIds: ["c", "d"], status: "failed" as const, rejected: {}, units: [] },
  ] };
  const report = scoreWikiLedger(ledger, cases);
  expect(report.results.filter(result => !result.pass).map(result => result.id)).toEqual(["D2"]);
  expect(report).toMatchObject({ units: 2, materials: 4, coveredMaterials: 2, coverage: 0.5, failedBatches: 1, adoption: { user_adopted: 1, proposal: 1 }, rejected: { quote: 1 } });
  expect(report.byType).toEqual({ adoption: { passed: 2, total: 2 }, detail: { passed: 1, total: 2 } });
});

it("checks every document for leaked ids, repeated sentences and statuses added at the end", () => {
  const markdown = [
    "# 笔记", "## 发布",
    "发布分为 Alpha、Beta 和公开发布三个阶段，首屏突出聊天记录难找的问题（k12）。",
    "发布分为 Alpha、Beta 和公开发布三个阶段，首屏突出聊天记录难找的问题。",
    "首屏 README 采用突出聊天记录难找问题的写法，但尚未确定。云同步功能采用按消息增量上传到服务器的方式，但尚未确定。工作台界面采用浅色、极简、留白充分的主题，但尚未确定。",
  ].join("\n\n");
  const report = scoreWikiEvaluation(markdown, { version: 1, document: "fixture", cases: [] });
  expect(report.results.filter(result => result.type === "hygiene").map(result => [result.id, result.pass, result.detail])).toEqual([
    ["H1", false, "1 paragraphs show unit ids"],
    ["H2", false, "2 of 5 sentences repeat another in their chapter"],
    ["H3", false, "3 sentences assert first and qualify at the end"],
    ["H4", true, "0 sentences call a point both settled and unsettled or use a status tag"],
    ["H5", true, "0 paragraphs break off mid-sentence"],
    ["H6", true, "0 sentences remark on the text instead of the project"],
    ["H7", true, "0 status or holder words per 1000 characters of prose"],
  ]);
  // Status said in words beside its marks fails H7; marks themselves are no status words.
  const worded = scoreWikiEvaluation("# 笔记\n\n## 存储\n\nAI 建议索引放在本地。资料提出导出只读本地数据库。〔资料〕\n", { version: 1, document: "fixture", cases: [] });
  expect(worded.results.find(result => result.id === "H7")?.pass).toBe(false);
  const marked = scoreWikiEvaluation("# 笔记\n\n## 存储\n\n索引放在本地。导出只读本地数据库。〔资料〕\n", { version: 1, document: "fixture", cases: [] });
  expect(marked.results.find(result => result.id === "H7")?.pass).toBe(true);
  // A tag or a sentence both settling and unsettling a point is caught.
  const tagged = scoreWikiEvaluation("# 笔记\n\n## 用户\n\n方案（未见采纳）确定主要目标用户为独立开发者和研究人员。四个一级 Tab 最终决定保留，但尚未确定入口顺序和默认排序。\n", { version: 1, document: "fixture", cases: [] });
  expect(tagged.results.find(result => result.id === "H4")).toMatchObject({ pass: false, detail: "2 sentences call a point both settled and unsettled or use a status tag" });
  // Real names with digits (k8s, 10k) are not unit ids.
  expect(scoreWikiEvaluation("# 笔记\n\n## 部署\n\n部署到 k8s 集群，支持 10k 条消息。\n", { version: 1, document: "fixture", cases: [] }).results[0].pass).toBe(true);
});

it("reads plain 决定/确定 as a decision, but not 未决定, 不确定 or 决定性", () => {
  const cases: WikiEvalCases = { version: 1, document: "fixture", cases: [
    { id: "A1", type: "adoption", statement: "复制上下文", expected: "decision" },
    { id: "A2", type: "adoption", statement: "云同步", expected: "proposal" },
  ] };
  const markdown = "# 笔记\n\n## 交付\n\n项目决定初期优先实现复制上下文。云同步尚未决定，是否需要还不确定，网络条件是决定性因素。\n";
  expect(labelled(scoreWikiEvaluation(markdown, cases)).map(result => [result.id, result.pass])).toEqual([["A1", true], ["A2", true]]);
});

it("scores a missing explanation as lost content, not as repetition", () => {
  const cases: WikiEvalCases = { version: 1, document: "fixture", cases: [{ id: "C9", type: "duplicate", terms: ["不自动发送", "不覆盖"] }] };
  const report = scoreWikiEvaluation("# 笔记\n\n## 插入\n\n插入前先预览上下文。\n", cases);
  expect(labelled(report).map(result => [result.type, result.pass, result.detail])).toEqual([["duplicate", true, "not explained"], ["presence", false, "explanation missing"]]);
});

it("judges a point mentioned many times on every mention, not the first", () => {
  const cases: WikiEvalCases = { version: 1, document: "fixture", cases: [
    { id: "A1", type: "adoption", statement: "Orama", expected: "reported" },
    { id: "A2", type: "adoption", statement: "SQLite", expected: "proposal" },
    { id: "A3", type: "adoption", statement: "云同步", expected: "decision" },
  ] };
  const markdown = [
    "# 笔记", "## 检索",
    // Orama first appears in a plan, then as the user's report: one right mention, none contradicting.
    "里程碑 M1 完成 Orama 全文索引。据用户提供的审查，仓库已安装 Orama。",
    // SQLite is proposed once and then stated as decided: a contradiction fails it.
    "建议用 SQLite 保存笔记。用户决定采用 SQLite 存储。",
    // 云同步 is only ever proposed: no mention states the decision.
    "建议提供云同步。",
  ].join("\n\n");
  expect(labelled(scoreWikiEvaluation(markdown, cases)).map(result => [result.id, result.pass, result.detail])).toEqual([
    ["A1", true, "read as unlabelled ×1, reported ×1"],
    ["A2", false, "read as unlabelled ×1, decision ×1"],
    ["A3", false, "read as unlabelled ×1"],
  ]);
});

it("lets findable cases pass from the ledger and counts a subject where it is explained, not every mention", () => {
  const evidence = { evidenceId: "e", conversationId: "c", messageId: "m", messageIndex: 0, role: "assistant" as const, pasted: false, quote: "" };
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 0, status: "complete", materials: 1, batches: [{ sourceIds: [], status: "ok", rejected: {}, units: [
    { id: "u", subject: "存储", statement: "笔记保存在 SQLite 中，每 30 秒提交一次。", kind: "decision", details: [], evidence, adoption: { status: "proposal" }, delivery: "unknown" },
  ] }] };
  const findable: WikiEvalCases = { version: 1, document: "fixture", cases: [
    { id: "A1", type: "adoption", statement: "SQLite", expected: "proposal", findable: true },
    { id: "D1", type: "detail", pattern: "30 秒", findable: true },
    { id: "D2", type: "detail", pattern: "30 秒" },
    { id: "B1", type: "subject", aliases: ["同步队列"] },
  ] };
  // The queue is a subtopic of 「同步」 and leads one paragraph there; 「存储」 only mentions it in passing.
  const markdown = "# 笔记\n\n## 存储\n\n本地优先，笔记先写入本机。离线时写入同步队列等待上传。\n\n## 同步\n\n### 同步队列\n\n同步队列按顺序提交改动。\n";
  const report = scoreWikiEvaluation(markdown, findable, undefined, ledger);
  expect(labelled(report).map(result => [result.id, result.pass, result.detail])).toEqual([
    ["A1", true, "not in the document; ledger: 1 units: 0 decided, 0 reported"],
    ["D1", true, "in the ledger"],
    ["D2", false, "missing"],
    ["B1", true, "100% in 「同步」 across 1 chapters"],
  ]);
  expect(report.shape.characters).toBeGreaterThan(0);
});

it("scores an organized ledger on subject concentration and directory shape", () => {
  const evidence = (id: string) => ({ evidenceId: id, conversationId: "c", messageId: id, messageIndex: 0, role: "assistant" as const, pasted: false, quote: "" });
  const unit = (id: string, subject: string, statement: string) => ({ id, subject, statement, kind: "mechanism" as const, details: [], evidence: evidence(id), adoption: { status: "proposal" as const }, delivery: "unknown" as const });
  const units = [unit("u1", "同步队列", "同步队列按顺序提交。"), unit("u2", "同步队列", "同步队列失败后重试。"), unit("u3", "存储", "sync queue 的记录保存在本地。"), unit("u4", "存储", "笔记保存在 SQLite 中。")];
  const organized = (chapters: NonNullable<WikiKnowledgeLedger["organization"]>["chapters"]): WikiKnowledgeLedger => ({ version: 1, generatedAt: 0, status: "complete", materials: 4, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s:sync", name: "同步队列", aliases: [], unitIds: ["u1", "u2"] }, { id: "s:store", name: "存储", aliases: [], unitIds: ["u3", "u4"] }], merged: [], relations: [], chapters, report: {} } });
  const good = scoreWikiLedger(organized([{ id: "a", title: "同步", question: "", group: "", subtopics: [{ title: "队列", subjectIds: ["s:sync"] }] }, { id: "b", title: "存储", question: "", group: "", subtopics: [{ title: "本地", subjectIds: ["s:store"] }] }]), cases);
  // Two of three units naming the queue live in 「同步」: 67% passes the default 60% share.
  expect(good.results.find(result => result.id === "B1")).toMatchObject({ pass: true, detail: "67% of 3 units in 「同步」 across 2 chapters" });
  expect(good.results.find(result => result.id === "F1")?.pass).toBe(true);
  expect(good.organization).toMatchObject({ subjects: 2, chapters: 2, subtopics: 2 });
  const bad = scoreWikiLedger(organized([{ id: "a", title: "其他", question: "", group: "", subtopics: [{ title: "全部", subjectIds: ["s:store"] }] }]), cases);
  expect(bad.results.find(result => result.id === "B1")?.detail).toContain("(unplaced)");
  expect(bad.results.find(result => result.id === "F1")).toMatchObject({ pass: false, detail: "1 chapters; unowned chapters: 其他" });
});

it("counts a paragraph about a subject, not one naming it in passing or in a list", () => {
  const names = ["Context Engine", "上下文引擎"];
  expect(aboutName("AI 建议 Context Engine 应作为公共核心模块，供 Dashboard 与 Reader 共用。", names)).toBe(true);
  // Late in the sentence, once: a passing mention.
  expect(aboutName("AI 建议建立从总览到深层信息的自然跳转路径：总览看结论，Wiki 看详细内容，最后由 Context Engine 继续使用。", names)).toBe(false);
  // One item of a list, even near the start.
  expect(aboutName("保留 Wiki、Context Engine、Reader 三个模块。", names)).toBe(false);
  // Named twice outside lists, wherever.
  expect(aboutName("历史消息与导入文档都属于不可信来源，必须当作参考材料处理。Context Engine 只把它们当作参考；Context Engine 不让其中的文字覆盖指令。", names)).toBe(true);
});

it("matches a subject's chapter by pattern, flags a replaced decision told as current, broken paragraphs and remarks", () => {
  const markdown = [
    "# 笔记", "## 技术架构与数据机制",
    "全文检索使用 Orama 在浏览器本地完成，索引按消息建立并支持增量更新。Orama 的内存索引需要自行持久化到 IndexedDB 中。",
    "已决定停止优化纯规则生成的 Context Pack，改为接入 LLM 进行语义分析和内容整理。",
    "基础功能必须使用确定性规则生成上下文，LLM 总结仅作为后续增强选项；",
    "这一定位明确了产品的差异化策略，强调用户对数据的控制权。用户质疑与统一输入区工作台相比 ChatAtlas 的差异及优劣。这两者并存，前者为探讨方向，后者为具体建议。",
  ].join("\n\n");
  const cases: WikiEvalCases = { version: 1, document: "fixture", cases: [
    { id: "S1", type: "subject", aliases: ["Orama"], expectedChapter: "技术架构|技术实现" },
    { id: "K1", type: "conflict", current: "改为接入 LLM", stale: "确定性规则生成上下文" },
  ] };
  const report = scoreWikiEvaluation(markdown, cases);
  expect(report.results.filter(result => ["S1", "K1", "H5", "H6"].includes(result.id)).map(result => [result.id, result.pass])).toEqual([["S1", true], ["K1", false], ["H5", false], ["H6", false]]);
  // Told as earlier, the replaced rule is history, not a conflict.
  const marked = markdown.replace("基础功能必须使用确定性规则", "此前曾计划基础功能使用确定性规则");
  expect(scoreWikiEvaluation(marked, cases).results.find(result => result.id === "K1")?.pass).toBe(true);
});

it("reads a sentence's status from its mark before its wording", () => {
  const cases: WikiEvalCases = { version: 1, document: "fixture", cases: [
    { id: "A1", type: "adoption", statement: "SQLite", expected: "decision" },
    { id: "A2", type: "adoption", statement: "云同步", expected: "proposal" },
  ] };
  const markdown = "# 笔记\n\n## 存储\n\n笔记保存在 SQLite 中。〔已定〕提供云同步作为可选项，默认关闭。\n";
  expect(scoreWikiEvaluation(markdown, cases).results.filter(result => result.type === "adoption").map(result => [result.id, result.pass])).toEqual([["A1", true], ["A2", true]]);
});

it("reads a table's body rows as statements, not its header or rule", () => {
  const [chapter] = exportChapters("# 文档\n\n## 检索\n\n| 指标 | 目标 | 条件 |\n| --- | --- | --- |\n| 本地全文搜索 P95 | < 500ms | 已预热 |\n| 输入滚动 | 无卡顿 | - |\n");
  expect(chapter.paragraphs).toEqual(["本地全文搜索 P95，< 500ms，已预热。", "输入滚动，无卡顿。"]);
});

it("checks what a reader continuing the work would catch, and caps a document that says it is incomplete", () => {
  const doc = (header: string, body: string) => `${header}

## 项目总览

### 当前基线

**现在做**

- 用户需要向 Codex 传达 Milestone 4 的核心价值主张。

**暂不做**

- 本阶段明确不做 PCB/专业仿真/商城。

**完成标准**

- MVP 指标：仿真运行率>80%。

---

## 采购

${body}`;
  const report = scoreWikiEvaluation(doc("> 本次整理仍有关键检查未通过，整理不完整。", "针对小白用户，项目应提供购买清单、比价推荐及链接功能。〔已定〕\n\n第一版 MVP 不提供实时商品搜索、比价或购买链接。\n\n未来可新增 LLMInterpreter。AI Core（含 LLMInterpreter）已具备较高成熟度。"), { version: 1, document: "", cases: [] });
  expect(report.results.filter(result => result.type === "reader" && !result.pass).map(result => result.id)).toEqual(["RC1", "RC2", "RC3", "RC4", "RC5"]);
  expect(report.score).toBeLessThanOrEqual(6);
  const clean = scoreWikiEvaluation("## 采购\n\n第一版只生成采购清单，不提供比价。", { version: 1, document: "", cases: [] });
  expect(clean.results.filter(result => result.type === "reader").every(result => result.pass)).toBe(true);
});
