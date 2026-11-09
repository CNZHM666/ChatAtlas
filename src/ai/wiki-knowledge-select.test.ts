import { expect, it } from "vitest";
import { curateWikiUnits } from "./wiki-knowledge-select";
import { chooseGroupHomes } from "./wiki-knowledge-groups";
import { wikiUnitStatuses, writeWikiDraft } from "./wiki-knowledge-write";
import type { StructuredAIRequest } from "./provider";
import type { WikiExplanationGroup, WikiKnowledgeLedger, WikiKnowledgeOrganization, WikiKnowledgeUnit, WikiSubject } from "../shared/wiki-knowledge";

// Phase 2, step 3: selection and placement by explanation group.
const signal = new AbortController().signal;
const unit = (index: number, subject: string, statement: string, extra: { adoption?: WikiKnowledgeUnit["adoption"]["status"]; role?: "user" | "assistant"; kind?: WikiKnowledgeUnit["kind"] } = {}): WikiKnowledgeUnit =>
  ({ id: `unit:${index}`, subject, statement, kind: extra.kind ?? "mechanism", details: [], evidence: { evidenceId: `e${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role: extra.role ?? "assistant", pasted: false, quote: statement }, adoption: { status: extra.adoption ?? "proposal" }, delivery: "unknown" });
const subject = (id: string, name: string, units: WikiKnowledgeUnit[]): WikiSubject => ({ id, name, aliases: [], unitIds: units.map(item => item.id) });
const group = (id: string, core: string, home: string, members: Array<[WikiKnowledgeUnit, "restates" | "adds", string[]?]>): WikiExplanationGroup =>
  ({ id, core, homeSubjectId: home, anchorUnitId: members[0][0].id, signature: id, members: members.map(([item, role, adds]) => ({ unitId: item.id, support: core.replace(/。$/u, ""), adds: adds ?? [], role })) });
function ledger(units: WikiKnowledgeUnit[], organization: Partial<WikiKnowledgeOrganization>): WikiKnowledgeLedger {
  return { version: 1, generatedAt: 0, status: "complete", materials: units.length, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [], merged: [], relations: [], report: {}, chapters: [], ...organization } };
}
const curate = (book: WikiKnowledgeLedger, budget?: number, length?: number) => curateWikiUnits(book, wikiUnitStatuses(book.batches.flatMap(batch => batch.units), book.organization!), budget, length);

it("explains a group at the subject its core speaks of, keeping an earlier home unless another fits clearly better", () => {
  const search = [unit(1, "检索", "侧边栏搜索只覆盖已导入的对话。"), unit(2, "检索", "全文索引使用 Orama。"), unit(3, "检索", "索引在后台增量更新。")];
  const sidebar = [unit(4, "侧边栏", "侧边栏搜索只覆盖已导入或授权同步的对话。"), unit(5, "侧边栏", "侧边栏搜索结果可以插入输入框。")];
  const subjects = [subject("s:search", "检索", search), subject("s:sidebar", "侧边栏搜索", sidebar)];
  // The anchor sits under 检索, but the core is about the sidebar's search.
  const found = group("g:1", "侧边栏搜索只覆盖已导入的对话。", "s:search", [[search[0], "restates"], [sidebar[0], "adds", ["或授权同步"]]]);
  const report: Record<string, number> = {};
  expect(chooseGroupHomes([found], subjects, [...search, ...sidebar], [], report)[0].homeSubjectId).toBe("s:sidebar");
  expect(report.group_home_not_anchor).toBe(1);
  // Two subjects fitting equally: the anchor's wins a first run, an earlier run's home stays.
  const even = [subject("s:a", "检索", search.slice(0, 2)), subject("s:b", "侧边栏", sidebar)];
  const near = group("g:2", "搜索只覆盖已导入的对话。", "s:a", [[search[0], "restates"], [sidebar[0], "adds", ["或授权同步"]]]);
  expect(chooseGroupHomes([near], even, [...search, ...sidebar])[0].homeSubjectId).toBe("s:a");
  expect(chooseGroupHomes([near], even, [...search, ...sidebar], [{ ...near, homeSubjectId: "s:b" }])[0].homeSubjectId).toBe("s:b");
});

it("counts a group as one point, chosen whole and placed at its home, and names it where its other members sit", () => {
  const search = [unit(1, "检索", "侧边栏搜索只覆盖已导入的对话。"), ...Array.from({ length: 5 }, (_, index) => unit(10 + index, "检索", ["全文索引使用 Orama。", "消息按段落切分。", "向量模型本地运行。", "结果按时间排序。", "高亮命中的关键词。"][index], { kind: "fact" }))];
  const sidebar = [unit(4, "侧边栏", "侧边栏搜索只覆盖已导入或授权同步的对话。"), unit(5, "侧边栏", "侧边栏搜索只覆盖已导入的对话，按平台筛选。")];
  const found = group("g:1", "侧边栏搜索只覆盖已导入的对话。", "s:sidebar", [[sidebar[0], "adds", ["或授权同步"]], [search[0], "restates"], [sidebar[1], "adds", ["按平台筛选"]]]);
  const book = ledger([...search, ...sidebar], { subjects: [subject("s:search", "检索", search), subject("s:sidebar", "侧边栏", sidebar)], groups: [found] });
  const view = curate(book);
  // All three members are shown, all at the sidebar's subject. 检索's quota is taken from its own five
  // points (four of five), the group's member there costing it nothing: 4 + 1 group = 5 points.
  expect([search[0], ...sidebar].every(item => view.selected.has(item.id) && view.home.get(item.id) === "s:sidebar")).toBe(true);
  expect(view.elsewhere.get("s:search")).toEqual([{ core: found.core, home: "s:sidebar" }]);
  expect(view.report).toMatchObject({ group_points: 1, points: 5 });
  // A tight point budget keeps the group whole or drops it whole; it never keeps one member alone.
  const tight = curate(book, 2);
  expect([search[0], ...sidebar].filter(item => tight.selected.has(item.id)).length % 3).toBe(0);
});

it("brings a whole group in when one member must show, and leaves the lowest-valued points out whole under the length budget", () => {
  const decided = unit(1, "检索", "全文索引使用 Orama。", { adoption: "user_adopted", kind: "decision", role: "user" });
  const restated = unit(2, "检索", "全文检索用 Orama 实现。"), extra = unit(3, "检索", "全文索引使用 Orama，按消息切分。");
  const long = unit(4, "检索", `历史背景：${"很长的讨论内容".repeat(20)}。`, { kind: "history" });
  const found = group("g:1", "全文索引使用 Orama。", "s:search", [[decided, "restates"], [restated, "restates"], [extra, "adds", ["按消息切分"]]]);
  const book = ledger([decided, restated, extra, long], { subjects: [subject("s:search", "检索", [decided, restated, extra, long])], groups: [found] });
  const full = curate(book);
  expect([decided, restated, extra, long].every(item => full.selected.has(item.id))).toBe(true);
  // The group's length is its core plus the one condition only a member states, not three statements.
  const tight = curate(book, undefined, 30);
  expect([decided, restated, extra].every(item => tight.selected.has(item.id))).toBe(true);
  expect(tight.selected.has(long.id)).toBe(false);expect(tight.report.length_dropped).toBe(1);
});

it("counts a point repeated in other messages as repeated discussion, and two units from one message as one mention", () => {
  const facts: Record<string, string[]> = { 侧边栏: ["侧边栏宽度固定为四百像素。", "收藏夹按项目分组展示。", "顶部显示当前平台图标。", "设置入口放在右上角。"], 上下文: ["上下文包导出为 Markdown 文件。", "模板包含项目目标与约束。", "Token 预算按模型窗口计算。", "引用保留原消息链接。"] };
  // Four facts in each subject, quota 4; a fifth, the principle, said once more elsewhere, outranks them.
  const fill = (start: number, name: string) => facts[name].map((text, index) => unit(start + index, name, text, { kind: "fact" }));
  const principle = unit(1, "侧边栏", "插入上下文时不自动发送消息，也不覆盖用户已经输入的内容。", { kind: "fact" });
  const again = unit(2, "上下文", "插入上下文时绝不自动发送消息，不覆盖用户已输入的内容。", { kind: "fact" });
  const sidebar = [...fill(10, "侧边栏"), principle], context = [...fill(20, "上下文"), again];
  const book = ledger([...sidebar, ...context], { subjects: [subject("s:sidebar", "侧边栏", sidebar), subject("s:context", "上下文", context)] });
  const view = curate(book);
  expect(view.report.echoed_points).toBe(1);
  expect(view.selected.has(principle.id)).toBe(true);
  expect(view.selected.has(again.id)).toBe(false);
  // The same point read twice from one message is one mention: nothing echoes.
  const sameMessage = { ...again, evidence: { ...again.evidence, messageId: principle.evidence.messageId } };
  const once = ledger([...sidebar, ...context.slice(0, 4), sameMessage], { subjects: [subject("s:sidebar", "侧边栏", sidebar), subject("s:context", "上下文", [...context.slice(0, 4), sameMessage])] });
  expect(curate(once).report.echoed_points).toBeUndefined();
});

it("writes a group's members together at its home chapter and only points to it from the other chapter", async () => {
  const search = [unit(1, "检索", "侧边栏搜索只覆盖已导入的对话。"), unit(2, "检索", "全文索引使用 Orama。")];
  const sidebar = [unit(4, "侧边栏", "侧边栏搜索只覆盖已导入或授权同步的对话。"), unit(5, "侧边栏", "侧边栏只放搜索入口。")];
  const found = group("g:1", "侧边栏搜索只覆盖已导入的对话。", "s:sidebar", [[sidebar[0], "adds", ["或授权同步"]], [search[0], "restates"]]);
  const book = ledger([...search, ...sidebar], { subjects: [subject("s:search", "检索", search), subject("s:sidebar", "侧边栏", sidebar)], groups: [found],
    chapters: [{ id: "c:search", title: "检索", question: "如何找回？", group: "", subtopics: [{ title: "全文索引", subjectIds: ["s:search"] }] }, { id: "c:sidebar", title: "侧边栏", question: "侧边栏做什么？", group: "", subtopics: [{ title: "搜索入口", subjectIds: ["s:sidebar"] }] }] });
  const calls: Array<{ chapter: string; statements: string[]; elsewhere: Array<{ subject: string; chapter: string }> }> = [];
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    const data = JSON.parse(request.prompt) as { presentation: string; chapter: { title: string }; elsewhere?: Array<{ subject: string; chapter: string }>; subtopics: Array<{ title: string; units: Array<{ id: string; statement: string }> }> };
    if (data.presentation === "wiki_unit_propositions") return request.validate({ same: [] });
    calls.push({ chapter: data.chapter.title, statements: data.subtopics.flatMap(topic => topic.units.map(item => item.statement)), elsewhere: data.elsewhere ?? [] });
    return request.validate({ opening: "", subtopics: data.subtopics.map(topic => ({ title: topic.title, paragraphs: [{ text: topic.units.map(item => item.statement).join(""), unitIds: topic.units.map(item => item.id), claims: [{ text: topic.units.map(item => item.statement).join(""), unitIds: topic.units.map(item => item.id) }] }] })) });
  } };
  await writeWikiDraft({ ledger: book, ai, locale: "zh-CN", signal });
  const searchCall = calls.find(call => call.chapter === "检索")!, sidebarCall = calls.find(call => call.chapter === "侧边栏")!;
  expect(searchCall.statements).toEqual(["全文索引使用 Orama。"]);
  expect(searchCall.elsewhere).toContainEqual({ subject: found.core, chapter: "侧边栏" });
  // The members sit together, the home's own member first.
  expect(sidebarCall.statements).toEqual(["侧边栏搜索只覆盖已导入或授权同步的对话。", "侧边栏搜索只覆盖已导入的对话。", "侧边栏只放搜索入口。"]);
});

it("always shows a rule giving a measure and a point said in three or more messages, beyond the quota", () => {
  const filler = Array.from({ length: 40 }, (_, index) => unit(index + 10, "阅读", `阅读第${"甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄黄宇宙洪荒日月盈昃辰宿"[index]}项安排。`, { kind: "decision" }));
  const width = unit(1, "阅读", "正文宽度控制在 720–850px。", { kind: "constraint" });
  const repeated = [2, 3, 4].map(index => unit(index, "阅读", "Service Worker 可能终止，需持久化索引。", { kind: "fact" }));
  const units = [...filler, width, ...repeated];
  const view = curate(ledger(units, { subjects: [subject("s:read", "阅读", units)] }));
  expect(view.selected.has(width.id)).toBe(true);
  // One copy of the repeated point is shown.
  expect(repeated.filter(item => view.selected.has(item.id))).toHaveLength(1);
});

it("always shows a point naming an error code, a hex address or a screen size, beyond the quota", () => {
  const filler = Array.from({ length: 40 }, (_, index) => unit(index + 10, "校验", `校验第${"甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄黄宇宙洪荒日月盈昃辰宿"[index]}项安排。`, { kind: "decision" }));
  const exact = [unit(1, "校验", "同一总线上两个设备都用 0x3C 地址时报错。", { kind: "fact" }), unit(2, "校验", "GPIO 直接驱动风扇时抛出 LOAD_REQUIRES_DRIVER。", { kind: "fact" }), unit(3, "校验", "需验证 1440x900 下的布局。", { kind: "fact" })];
  const units = [...filler, ...exact];
  const view = curate(ledger(units, { subjects: [subject("s:check", "校验", units)] }));
  expect(exact.filter(item => view.selected.has(item.id))).toHaveLength(3);
});

it("keeps a subtopic within its length, leaving its lowest-valued optional points in the ledger", () => {
  const points = Array.from({ length: 8 }, (_, index) => unit(index + 1, index < 4 ? "视觉" : "布局", `第 ${index + 1} 条界面建议说明${"细节".repeat(10)}。`, { kind: index === 0 ? "constraint" : "fact" }));
  const book = ledger(points, { subjects: [subject("s:a", "视觉", points.slice(0, 4)), subject("s:b", "布局", points.slice(4))], chapters: [{ id: "c", title: "界面", question: "", group: "", subtopics: [{ title: "规范", subjectIds: ["s:a", "s:b"] }] }] });
  expect(curate(book).selected.size).toBe(8);
  const tight = curateWikiUnits(book, wikiUnitStatuses(points, book.organization!), undefined, undefined, 100);
  expect(tight.selected.size).toBe(3);
  // The best-valued point stays; the rest are counted beside the subtopic.
  expect(tight.selected.has(points[0].id)).toBe(true);
  expect(tight.report.subtopic_dropped).toBe(5);
});

it("counts English material by what it says, not its longer spelling, against a subtopic's length", () => {
  // Each about 75 characters of English, which says what about 30 characters of Chinese do.
  const points = Array.from({ length: 8 }, (_, index) => unit(index + 1, "Visual", `Suggestion ${index + 1}: rows use a ${40 + index}px icon container with a hover surface.`, { kind: "fact" }));
  const book = ledger(points, { subjects: [subject("s:a", "Visual", points)], chapters: [{ id: "c", title: "Interface", question: "", group: "", subtopics: [{ title: "Rows", subjectIds: ["s:a"] }] }] });
  // 130 characters of room: one of them counted as written; the subject's quota of four counted by what they say.
  expect(curateWikiUnits(book, wikiUnitStatuses(points, book.organization!), undefined, undefined, 130).selected.size).toBe(4);
});

it("leaves advice to the developer about their own learning out of the project's text", () => {
  const skills = unit(1, "技术栈", "开发者需掌握嵌入式、控制理论、Linux、ROS2 及前端开发能力。", { kind: "fact" }), stack = unit(2, "技术栈", "前端使用 Next.js 与 React Flow。", { kind: "decision" });
  const book = ledger([skills, stack], { subjects: [subject("s:a", "技术栈", [skills, stack])] });
  const view = curate(book);
  expect(view.selected.has(stack.id)).toBe(true);
  expect(view.selected.has(skills.id)).toBe(false);
});

it("always shows a colour value or a duration range, past the subtopic cap", () => {
  const colour = unit(1, "视觉", "主要文字颜色为 #18181B。", { kind: "fact" }), motion = unit(2, "视觉", "方案生成过渡 300-600ms。", { kind: "fact" }), plain = unit(3, "视觉", `普通说明${"细节".repeat(20)}。`, { kind: "fact" });
  const book = ledger([colour, motion, plain], { subjects: [subject("s:a", "视觉", [colour, motion, plain])], chapters: [{ id: "c", title: "界面", question: "", group: "", subtopics: [{ title: "视觉", subjectIds: ["s:a"] }] }] });
  const view = curateWikiUnits(book, wikiUnitStatuses([colour, motion, plain], book.organization!), undefined, undefined, 10);
  expect([...view.selected].sort()).toEqual([colour.id, motion.id]);
});

it("always shows a rule keeping the hardware and the builder safe", () => {
  const many = Array.from({ length: 30 }, (_, index) => unit(index + 1, "验证", `Validator 第 ${index} 条规则检查 I²C 地址与引脚占用的不同情况和提示文案。`, { kind: "mechanism" }));
  const gpio = unit(40, "验证", "禁止 ESP32 GPIO 直接驱动 Fan 等高电流负载，必须通过 MOSFET 等驱动模块连接。", { kind: "constraint" });
  const book = ledger([...many, gpio], { subjects: [subject("s", "验证", [...many, gpio])], chapters: [{ id: "c", title: "验证", question: "", group: "", subtopics: [{ title: "规则", subjectIds: ["s"] }] }] });
  expect(curate(book, 520, 34000).selected.has(gpio.id)).toBe(true);
  expect(curateWikiUnits(book, wikiUnitStatuses(book.batches.flatMap(batch => batch.units), book.organization!), 3).selected.has(gpio.id)).toBe(true);
});

it("always shows a target counted in tasks or scenarios to build or test", () => {
  const many = Array.from({ length: 30 }, (_, index) => unit(index + 1, "测试", `测试第 ${index} 条：覆盖页面切换与提示文案的不同情况和细节说明。`, { kind: "plan" }));
  const bench = unit(40, "测试", "建立包含 20~30 个真实用户任务的 End-to-End Benchmark，记录 Intent 解析与 IR 合法性。", { kind: "plan" });
  const book = ledger([...many, bench], { subjects: [subject("s", "测试", [...many, bench])], chapters: [{ id: "c", title: "测试", question: "", group: "", subtopics: [{ title: "基准", subjectIds: ["s"] }] }] });
  expect(curateWikiUnits(book, wikiUnitStatuses(book.batches.flatMap(batch => batch.units), book.organization!), 3).selected.has(bench.id)).toBe(true);
});

it("always shows a point naming a function a reader calls by name", () => {
  const many = Array.from({ length: 30 }, (_, index) => unit(index + 1, "安全", `安全第 ${index} 条：密钥不得出现在页面提示文案和截图里。`, { kind: "mechanism" }));
  const redact = unit(40, "安全", "建立 redactSecrets() 处理 API Key、Authorization 和 Bearer token。", { kind: "constraint" });
  const book = ledger([...many, redact], { subjects: [subject("s", "安全", [...many, redact])], chapters: [{ id: "c", title: "安全", question: "", group: "", subtopics: [{ title: "密钥", subjectIds: ["s"] }] }] });
  expect(curateWikiUnits(book, wikiUnitStatuses(book.batches.flatMap(batch => batch.units), book.organization!), 3).selected.has(redact.id)).toBe(true);
});

it("gives a chapter far below the others its best points back, up to half the average chapter", () => {
  const vision = ["主要用户是第一次接触电子制作的高中生", "套件开箱后十分钟内点亮第一盏灯", "说明书只用图片不用电路术语", "价格控制在两百元以内", "不需要焊接全部用磁吸连接", "每个模块都印有用途图标", "失败时板载蜂鸣器提示原因", "课程按周组织共八周", "老师端能看到全班进度", "家长可以离线打印作业单", "社区分享作品需要审核", "第二年推出进阶扩展包", "电池采用可更换的五号电池", "外壳颜色区分输入与输出模块", "手机应用只负责展示教程", "不收集学生的个人信息", "学校批量采购提供发票", "售后承诺坏件七天内换新", "首批只在三个城市试点", "竞品普遍需要电脑编程环境", "我们的差异是零代码入门", "长期目标是成为课堂标配", "成功标准是九成学生完成第一课"].map((text, index) => unit(index, "产品定位", `${text}。`));
  const technical = "数据库 缓存层 消息队列 日志采集 鉴权网关 路由表 渲染管线 全文索引 增量同步 冷备份 指标监控 速率限制 重试策略 压缩算法 密钥轮换 分页游标 批量导出 文件导入 推送通知 定时调度".split(" ");
  const actions = ["选用开源方案并锁定主版本", "部署在独立容器里由运维托管", "接口超时设为三秒后降级返回"];
  const long = (base: number, area: string) => technical.flatMap((word, index) => actions.map((action, part) => unit(base + index * 3 + part, area, `${area}${word}${action}，编号${base + index * 3 + part}。`)));
  const tech = long(100, "技术"), ui = long(200, "界面");
  const subjects = [subject("s:v", "产品定位", vision), ...[0, 1, 2].map(part => subject(`s:t${part}`, `技术${part}`, tech.slice(part * 20, part * 20 + 20))), ...[0, 1, 2].map(part => subject(`s:u${part}`, `界面${part}`, ui.slice(part * 20, part * 20 + 20)))];
  const book = ledger([...vision, ...tech, ...ui], { subjects, chapters: [
    { id: "v", title: "产品愿景", question: "?", group: "", subtopics: [{ title: "核心价值", subjectIds: ["s:v"] }] },
    { id: "t", title: "技术架构", question: "?", group: "", subtopics: [0, 1, 2].map(part => ({ title: `技术${part}`, subjectIds: [`s:t${part}`] })) },
    { id: "u", title: "界面设计", question: "?", group: "", subtopics: [0, 1, 2].map(part => ({ title: `界面${part}`, subjectIds: [`s:u${part}`] })) },
  ] });
  const curated = curate(book), shown = (items: WikiKnowledgeUnit[]) => items.filter(item => curated.selected.has(item.id));
  const length = (items: WikiKnowledgeUnit[]) => shown(items).reduce((sum, item) => sum + item.statement.length, 0);
  // Its subject quota kept 7 of 23 (about 90 characters) beside chapters of 533: points come back until it holds half
  // the average chapter, and no further.
  expect(shown(vision).length).toBe(16);
  expect(curated.report.chapter_filled).toBe(9);
  expect(length(vision)).toBeGreaterThan((length(tech) + length(ui)) / 3 / 2);
  // The long chapters keep what their caps gave them.
  expect([shown(tech).length, shown(ui).length]).toEqual([21, 21]);
});
