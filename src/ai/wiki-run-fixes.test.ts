import { expect, it } from "vitest";
import type { WikiDraftChapter, WikiKnowledgeUnit, WikiUnitStatus } from "../shared/wiki-knowledge";
import { earlierValuesHold } from "./wiki-ledger-document";
import { plannedCapabilityWords } from "./wiki-capability-state";
import { placedTrailingCodes } from "./wiki-knowledge-write";
import { droppedRepeatedOpeningLimits, droppedUnsourcedLimits, limitItems } from "./wiki-repeated-limits";
import { rehomedStrayParagraphs } from "./wiki-stray-paragraphs";
import { assignShifted } from "./wiki-knowledge-organize";

const unit = (id: string, statement: string, extra: Partial<WikiKnowledgeUnit> = {}): WikiKnowledgeUnit => ({ id, subject: "", statement, kind: "decision", details: [], evidence: { evidenceId: id, conversationId: "c", messageId: id, messageIndex: 1, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown", ...extra });
const chapter = (id: string, body: string, paragraphs: WikiDraftChapter["paragraphs"]): WikiDraftChapter => ({ id, title: id, question: "", group: "", body, paragraphs, problems: [] });

it("keeps a row current when the earlier palette's value it keeps is one the later palette leaves unset", () => {
  const earlier = unit("old", "App Background #0F0F10，Canvas #111112，Panel #151516，Border #27272A。");
  const later = unit("new", "所有新页面必须真正支持Dark模式，背景色#101011/#111112，Surface #18181B，Border #27272A。");
  expect(earlierValuesHold("Dark / #101011 / #111112 / #151516 / #18181B / #27272A", [later], [earlier])).toBe(true);
  // A value under a label the later palette sets again: replaced.
  const panel = unit("panel", "Dark Panel #18181B，Border #27272A。");
  expect(earlierValuesHold("Dark / #151516 / #27272A", [panel], [earlier])).toBe(false);
});

it("tells a check beside the user's report that it is missing as planned in the paragraph too", () => {
  const report = unit("rep", "当前画布仅为架构预览；Validator不检查电压、GPIO冲突或电源安全。", { evidence: { evidenceId: "rep", conversationId: "c", messageId: "rep", messageIndex: 58, role: "user", pasted: true, quote: "" } });
  const text = "规则引擎是项目第二核心，用于验证硬件方案。实现确定性执行的 validateProject 函数，检查电压兼容、GPIO 冲突等基础电气规则。当前画布仅为架构预览；Validator不检查电压、GPIO冲突或电源安全。";
  const written = chapter("c", `开头。\n\n### 验证\n\n${text}`, [{ subtopic: "验证", text, unitIds: [report.id] }]);
  expect(plannedCapabilityWords([written], [report], new Map<string, WikiUnitStatus>([[report.id, "reported"]]))).toBe(1);
  expect(written.paragraphs[0].text).toContain("。计划实现确定性执行的 validateProject 函数");
  expect(written.paragraphs[0].text).toContain("Validator不检查电压");
  expect(written.body).toContain("计划实现确定性执行");
});

it("puts a code the writer added at a sentence's end beside the code it follows in the source", () => {
  const gate = unit("g", "仿真入口仅在 Canvas 设计通过（VERIFIED 或允许继续）后才出现。", { evidence: { evidenceId: "g", conversationId: "c", messageId: "g", messageIndex: 1, role: "assistant", pasted: false, quote: "只有设计达到：\n\n```text\nVERIFIED\n或\nNEEDS_REVIEW\n```\n\n才出现仿真入口。" } });
  const text = "仿真入口仅在 Canvas 设计通过（VERIFIED 或允许继续）后才出现，且界面应侧重行为模拟而非专业调试工具（NEEDS_REVIEW）。";
  const written = chapter("c", `开头。\n\n### 仿真\n\n${text}`, [{ subtopic: "仿真", text, unitIds: [gate.id], claims: [{ text, unitIds: [gate.id] }] }]);
  expect(placedTrailingCodes([written], id => id === gate.id ? gate : undefined)).toBe(1);
  expect(written.paragraphs[0].text).toBe("仿真入口仅在 Canvas 设计通过（VERIFIED 或 NEEDS_REVIEW 允许继续）后才出现，且界面应侧重行为模拟而非专业调试工具。");
  expect(written.paragraphs[0].claims?.[0].text).toBe(written.paragraphs[0].text);
  expect(written.body).toContain("VERIFIED 或 NEEDS_REVIEW 允许继续");
});

it("drops a limit sentence its cited unit never says, and keeps one a unit says", () => {
  expect(limitItems("本阶段不包含商城比价功能")).toEqual(["比价"]);
  const wish = unit("w", "针对小白用户，项目应增加直接询问购买清单、提供比价推荐及链接的功能。");
  const stage = unit("s", "本阶段不开发实时商品比价、淘宝/Amazon API。");
  const text = "针对小白用户，项目应增加直接询问购买清单、提供比价推荐及链接的功能。\n\n本阶段不包含比价。";
  const kept = "本阶段不开发实时商品比价。";
  const written = chapter("c", `开头。\n\n### 采购\n\n${text}\n\n${kept}`, [
    { subtopic: "采购", text, unitIds: [wish.id], claims: [{ text: "针对小白用户，项目应增加直接询问购买清单、提供比价推荐及链接的功能。", unitIds: [wish.id] }, { text: "本阶段不包含比价。", unitIds: [wish.id] }] },
    { subtopic: "采购", text: kept, unitIds: [stage.id] },
  ]);
  const units = new Map([[wish.id, wish], [stage.id, stage]]);
  expect(droppedUnsourcedLimits([written], id => units.get(id))).toBe(1);
  expect(written.paragraphs[0].text).toBe("针对小白用户，项目应增加直接询问购买清单、提供比价推荐及链接的功能。");
  expect(written.paragraphs[0].claims).toHaveLength(1);
  expect(written.paragraphs[1].text).toBe(kept);
  expect(written.body).not.toContain("本阶段不包含比价。");
});

it("drops a limit closing a later opening that an earlier opening gave, and keeps one adding its own items", () => {
  const first = chapter("a", "完整流程包含三个阶段；库存管理功能增加购买清单询问及比价推荐（本阶段暂不包含比价）。\n\n### 库存\n\n正文。", []);
  const ui = chapter("b", "界面采用顶部工具栏结构。动画遵循克制原则，本阶段不包含商城比价功能。\n\n### 布局\n\n正文。", []);
  const plan = chapter("c", "项目分阶段推进，暂不实现实时比价、PCB 设计或复杂仿真。\n\n### 路线\n\n正文。", []);
  expect(droppedRepeatedOpeningLimits([first, ui, plan])).toBe(1);
  expect(ui.body.startsWith("界面采用顶部工具栏结构。动画遵循克制原则。\n\n### 布局")).toBe(true);
  expect(plan.body).toContain("暂不实现实时比价、PCB 设计或复杂仿真");
  expect(first.body).toContain("（本阶段暂不包含比价）");
});

it("moves a paragraph none of whose units belongs to its chapter to the chapter most of them do", () => {
  const organization = { chapters: [
    { id: "flow", title: "核心工作流", question: "", group: "", subtopics: [{ title: "库存管理", question: "", subjectIds: ["inventory"] }] },
    { id: "ui", title: "UI 规范", question: "", group: "", subtopics: [{ title: "视觉风格", question: "", subjectIds: ["style"] }] },
  ] } as never;
  const home = new Map([["stock", "inventory"], ["light", "style"], ["dark", "style"], ["font", "style"], ["radius", "style"]]);
  const palette = "- Light / #FAFAFA\n- Dark / #101011";
  const flow = chapter("flow", `开头。\n\n### 库存管理\n\n圆角 8px。\n\n零件盒。\n\n${palette}\n\n正文 14px。`, [
    // One unit is too little to tell alone.
    { subtopic: "库存管理", text: "圆角 8px。", unitIds: ["radius"] },
    { subtopic: "库存管理", text: "零件盒。", unitIds: ["stock"] },
    { subtopic: "库存管理", text: palette, unitIds: ["light", "dark"] },
    // Right after a paragraph that moved there, it goes along.
    { subtopic: "库存管理", text: "正文 14px。", unitIds: ["font"] },
  ]);
  const ui = chapter("ui", "界面开头。\n\n### 视觉风格\n\n克制。", [{ subtopic: "视觉风格", text: "克制。", unitIds: ["light"] }]);
  expect(rehomedStrayParagraphs([flow, ui], organization, home)).toBe(2);
  expect(flow.body).toBe("开头。\n\n### 库存管理\n\n圆角 8px。\n\n零件盒。");
  expect(ui.body).toBe(`界面开头。\n\n### 视觉风格\n\n克制。\n\n${palette}\n\n正文 14px。`);
  expect(ui.paragraphs.map(paragraph => paragraph.subtopic)).toEqual(["视觉风格", "视觉风格", "视觉风格"]);
});

it("refuses a subject answer whose indexes are one place off", () => {
  const names = ["证据引用", "增量更新", "ProjectEvent", "表达类型判断"];
  const rows = ["状态区分", "证据引用", "增量更新", "ProjectEvent", "表达类型判断"];
  // Each name got its neighbour's: the answer skipped the first.
  expect(assignShifted([0, 1, 2, 3], rows, names)).toBe(true);
  expect(assignShifted([1, 2, 3, 4], rows, names)).toBe(false);
});

it("lets a chapter opening that tells a decision carry it instead of adding it again", async () => {
  const { ensureWikiDecisions } = await import("./wiki-decision-coverage");
  const byok = unit("byok", "采用 BYOK（Bring Your Own Key）模式，默认仅保存在当前浏览器会话中，不保存到服务器，以降低运营成本并保护用户隐私。");
  const organization = { subjects: [{ id: "s", name: "安全", aliases: [], unitIds: [byok.id] }], chapters: [{ id: "arch", title: "技术架构", question: "", group: "", subtopics: [{ title: "安全", question: "", subjectIds: ["s"] }] }], relations: [], merged: [] } as never;
  const body = "系统采用 BYOK 模式管理 API Key，默认仅保存在当前浏览器会话中且不写入服务器。底层通过规则引擎验证方案。\n\n### 安全\n\n日志脱敏。";
  const arch = chapter("arch", body, [{ subtopic: "安全", text: "日志脱敏。", unitIds: [] }]);
  expect(ensureWikiDecisions([arch], organization, [byok], new Map<string, WikiUnitStatus>([[byok.id, "confirmed"]]))).toBe(1);
  expect(arch.body).toBe(body);
  expect(arch.openingUnitIds).toEqual([byok.id]);
});

it("moves one list item whose units all belong to another chapter, leaving the rest of the list", () => {
  const organization = { chapters: [
    { id: "arch", title: "技术架构", question: "", group: "", subtopics: [{ title: "数据源", question: "", subjectIds: ["db"] }] },
    { id: "ui", title: "UI", question: "", group: "", subtopics: [{ title: "布局", question: "", subjectIds: ["layout"] }] },
  ] } as never;
  const home = new Map([["a", "layout"], ["b", "layout"], ["c", "db"]]);
  const list = "- **界面布局**：主屏仅保留三个区域。\n- **视觉风格**：参考 Codex 的极简工作流。";
  const arch = chapter("arch", `开头。\n\n### 数据源\n\n${list}`, [{ subtopic: "数据源", text: list, unitIds: ["a", "b", "c"], claims: [{ text: "主屏仅保留三个区域。", unitIds: ["a", "b"] }, { text: "参考 Codex 的极简工作流。", unitIds: ["c"] }] }]);
  const ui = chapter("ui", "界面开头。\n\n### 布局\n\n三栏。", [{ subtopic: "布局", text: "三栏。", unitIds: ["a"] }]);
  expect(rehomedStrayParagraphs([arch, ui], organization, home)).toBe(1);
  expect(arch.body).toBe("开头。\n\n### 数据源\n\n- **视觉风格**：参考 Codex 的极简工作流。");
  expect(arch.paragraphs[0].unitIds).toEqual(["c"]);
  expect(ui.body).toBe("界面开头。\n\n### 布局\n\n三栏。\n\n- **界面布局**：主屏仅保留三个区域。");
});

it("takes a decision told across two sentences as said, not adding it again", async () => {
  const { ensureWikiDecisions } = await import("./wiki-decision-coverage");
  const size = unit("size", "宽度固定为360px，高度按内容自适应，首页目标高度约460px（建议控制在420–480px）。");
  const organization = { subjects: [{ id: "s", name: "尺寸", aliases: [], unitIds: [size.id] }], chapters: [{ id: "ui", title: "界面设计", question: "", group: "", subtopics: [{ title: "Popup 布局尺寸", question: "", subjectIds: ["s"] }] }], relations: [], merged: [] } as never;
  const text = "Chrome Popup 的宽度固定为 360px，高度根据内容自适应，旨在避免首页出现滚动条。首页的目标高度约为 460px，建议控制在 420–480px 范围内。";
  const body = `### Popup 布局尺寸\n\n${text}`;
  const ui = chapter("ui", body, [{ subtopic: "Popup 布局尺寸", text, unitIds: [size.id], claims: [{ text: "首页的目标高度约为 460px，建议控制在 420–480px 范围内。", unitIds: [size.id] }] }]);
  expect(ensureWikiDecisions([ui], organization, [size], new Map<string, WikiUnitStatus>([[size.id, "confirmed"]]))).toBe(1);
  expect(ui.body).toBe(body);
  expect(ui.paragraphs[0].claims).toEqual([{ text, unitIds: [size.id] }]);
});

it("keeps a paragraph that says much more than the short decision citing it", async () => {
  const { ensureWikiDecisions } = await import("./wiki-decision-coverage");
  const answer = unit("answer", "380px.");
  const organization = { subjects: [{ id: "s", name: "尺寸", aliases: [], unitIds: [answer.id] }], chapters: [{ id: "ui", title: "界面设计", question: "", group: "", subtopics: [{ title: "Popup 布局尺寸", question: "", subjectIds: ["s"] }] }], relations: [], merged: [] } as never;
  const text = "建议将 Popup 宽度设为 380px，通过 CSS 变量 --popup-width 控制，高度自适应，首页目标高度约 460-480px。";
  const ui = chapter("ui", `### Popup 布局尺寸\n\n${text}`, [{ subtopic: "Popup 布局尺寸", text, unitIds: [answer.id], claims: [] }]);
  ensureWikiDecisions([ui], organization, [answer], new Map<string, WikiUnitStatus>([[answer.id, "confirmed"]]));
  expect(ui.body).toContain(text);
});

it("takes the points one answer confirmed as one decision, and a subject-value choice as said by a sentence naming both", async () => {
  const { ensureWikiDecisions } = await import("./wiki-decision-coverage");
  const first = unit("first", "第一版默认专注25分钟、短休息5分钟，每4轮后长休息15分钟。"), second = unit("second", "V0.1版本默认专注时间为25分钟，休息时间为5分钟。"), width = unit("answer:q:o", "Popup 宽度：380px。");
  const organization = { subjects: [{ id: "s", name: "时长", aliases: [], unitIds: [first.id, second.id] }, { id: "w", name: "尺寸", aliases: [], unitIds: [width.id] }], chapters: [{ id: "flow", title: "核心流程", question: "", group: "", subtopics: [{ title: "专注", question: "", subjectIds: ["s", "w"] }] }], relations: [], merged: [] } as never;
  const said = "- **默认时长**：第一版默认专注25分钟、短休息5分钟，每4轮后长休息15分钟。", chose = "经过权衡，用户最终确认 Popup 宽度定为 380px。";
  const body = `### 专注\n\n${said}\n\n${chose}`;
  const flow = chapter("flow", body, [{ subtopic: "专注", text: said, unitIds: [first.id], claims: [{ text: "第一版默认专注25分钟、短休息5分钟，每4轮后长休息15分钟。", unitIds: [first.id] }] }, { subtopic: "专注", text: chose, unitIds: [], claims: [] }]);
  const statuses = new Map<string, WikiUnitStatus>([[first.id, "confirmed"], [second.id, "confirmed"], [width.id, "confirmed"]]);
  ensureWikiDecisions([flow], organization, [first, second, width], statuses, new Set(), new Set(), new Map([[first.id, [second.id]], [second.id, [first.id]]]));
  expect(flow.body).toBe(body);
  expect(flow.paragraphs[0].claims![0].unitIds).toEqual([first.id, second.id]);
  expect(flow.paragraphs[1].claims).toEqual([{ text: chose, unitIds: [width.id] }]);
});

it("takes a subject-value choice as said by the clause naming both, after a clause on an earlier proposal", async () => {
  const { ensureWikiDecisions } = await import("./wiki-decision-coverage");
  const width = unit("answer:q:o", "Popup 宽度：380px。");
  const organization = { subjects: [{ id: "w", name: "尺寸", aliases: [], unitIds: [width.id] }], chapters: [{ id: "ui", title: "界面设计", question: "", group: "", subtopics: [{ title: "尺寸", question: "", subjectIds: ["w"] }] }], relations: [], merged: [] } as never;
  const text = "尽管曾有 B1（380px）与 B2（360px）两案并存的提议，但最终确认 Popup 宽度为 380px。";
  const ui = chapter("ui", `### 尺寸\n\n${text}`, [{ subtopic: "尺寸", text, unitIds: [], claims: [] }]);
  ensureWikiDecisions([ui], organization, [width], new Map<string, WikiUnitStatus>([[width.id, "confirmed"]]));
  expect(ui.body).toBe(`### 尺寸\n\n${text}`);
});

it("lets an opening state a decision without its closing decide-later clause", async () => {
  const { ensureWikiDecisions } = await import("./wiki-decision-coverage");
  const sync = unit("sync", "明确决定 V0.1 版本不做数据云同步，后续再根据用户需求评估。");
  const organization = { subjects: [{ id: "s", name: "同步", aliases: [], unitIds: [sync.id] }], chapters: [{ id: "data", title: "数据存储", question: "", group: "", subtopics: [{ title: "存储策略方案", question: "", subjectIds: ["s"] }] }], relations: [], merged: [] } as never;
  const body = "V0.1 版本明确决定不做数据云同步，采用本地优先策略。\n\n### 存储策略方案\n\n使用 chrome.storage.local。";
  const data = chapter("data", body, [{ subtopic: "存储策略方案", text: "使用 chrome.storage.local。", unitIds: [], claims: [] }]);
  expect(ensureWikiDecisions([data], organization, [sync], new Map<string, WikiUnitStatus>([[sync.id, "confirmed"]]))).toBe(1);
  expect(data.body).toBe(body);
  expect(data.openingUnitIds).toEqual([sync.id]);
});

it("splits an opening sentence that opens on a decision and goes on, instead of adding the decision again", async () => {
  const { ensureWikiDecisions } = await import("./wiki-decision-coverage");
  const sync = unit("sync", "明确决定 V0.1 版本不做数据云同步，后续再根据用户需求评估。");
  const organization = { subjects: [{ id: "s", name: "同步", aliases: [], unitIds: [sync.id] }], chapters: [{ id: "data", title: "数据存储", question: "", group: "", subtopics: [{ title: "存储策略方案", question: "", subjectIds: ["s"] }] }], relations: [], merged: [] } as never;
  const body = "V0.1 版本明确决定不做数据云同步，所有数据仅存储在本地，禁止使用 chrome.storage.sync 或任何网络请求。第一版不引入登录功能。\n\n### 存储策略方案\n\n使用 chrome.storage.local。";
  const data = chapter("data", body, [{ subtopic: "存储策略方案", text: "使用 chrome.storage.local。", unitIds: [], claims: [] }]);
  expect(ensureWikiDecisions([data], organization, [sync], new Map<string, WikiUnitStatus>([[sync.id, "confirmed"]]))).toBe(1);
  expect(data.body.startsWith("V0.1 版本明确决定不做数据云同步。所有数据仅存储在本地，禁止使用 chrome.storage.sync 或任何网络请求。")).toBe(true);
  expect(data.body).not.toContain("后续再根据用户需求评估");
  expect(data.openingUnitIds).toEqual([sync.id]);
});
