import { expect, it } from "vitest";
import { mergeOverlappingRows, pendingDisagreements, scopeDisagreements, scopeTables, staleValueNotes, statusClashes, stageOf, versionDisagreements } from "./wiki-draft-checks";
import type { WikiDraftChapter } from "../shared/wiki-knowledge";

const chapter = (id: string, title: string, texts: string[]): WikiDraftChapter => ({ id, title, question: "", group: "", problems: [], body: texts.join("\n\n"), paragraphs: texts.map(text => ({ subtopic: "s", text, unitIds: [] })) });

it("notes a first-version item a scope table leaves out while another sentence puts it in", () => {
  const table = "| 事项 | 第一版 |\n| --- | --- |\n| 多平台导入适配器 | 做（首期仅稳定支持 ChatGPT） |\n| 全平台同步 | 不做 |\n| Wiki/知识图谱/自动同步 | 暂缓 |";
  const workflow = chapter("a", "核心工作流", [table, "5. **P0 基础能力**：支持 ChatGPT、Claude、Gemini 等平台的完整同步与消息级索引。"]);
  const scope = chapter("b", "范围", ["保留消息级搜索、侧边栏快速上下文、项目Dashboard/Wiki及原文定位为P0或核心；将独立问答合并入搜索。", "P1 实现可靠的上下文复制。"]);
  expect(scopeDisagreements([workflow, scope])).toBe(2);
  expect(workflow.body).toContain(`${table}\n\n> 范围有分歧：「全平台同步」写为不做，下文又写「P0 基础能力：支持 ChatGPT、Claude、Gemini 等平台的完整同步与消息级索引」。第一版是否包含，需要你确认。`);
  expect(workflow.body).toContain("> 范围有分歧：「Wiki/知识图谱/自动同步」写为暂缓，「范围」中又写「保留消息级搜索、侧边栏快速上下文、项目Dashboard/Wiki及原文定位为P0或核心」。");
  // Nothing put in elsewhere: no note.
  const alone = chapter("c", "范围", ["| 事项 | 第一版 |\n| --- | --- |\n| 团队协作 | 暂缓 |"]);
  expect(scopeDisagreements([alone])).toBe(0);
});

it("merges table rows telling one mechanism under other names, keeping what each adds", () => {
  const table = [
    "| 方案 | 实现 | 说明 |", "| --- | --- | --- |",
    "| 混合检索 | 结合 IndexedDB + Orama，采用本地全文检索（BM25）及可选 Embedding 语义检索融合 | Embedding 不可用时自动退回全文检索 |",
    "| 双路检索 | Orama BM25 全文检索 + 本地 Embedding 向量检索 | 评估使用 RRF 合并排名结果 |",
    "| 两阶段搜索 | Orama 全文检索结合可选语义检索 | 结果融合排序后定位到具体消息并高亮原文 |",
    "| 时间衰减 | 按查询意图调整新旧权重 | 不照搬固定半衰期 |",
  ].join("\n");
  const { text, merged } = mergeOverlappingRows(`检索方案如下。\n\n${table}`);
  expect(merged).toBe(2);
  const rows = text.split("\n").filter(line => line.startsWith("| ") && !line.startsWith("| ---"));
  expect(rows).toHaveLength(3);
  expect(rows[1]).toMatch(/^\| 混合检索、双路检索、两阶段搜索 \| .*Embedding 语义检索融合/u);
  expect(rows[1]).toContain("RRF");
  expect(rows[2]).toContain("时间衰减");
  // Products are different things however alike their cells.
  expect(mergeOverlappingRows("| 产品 | 能力 | 局限 |\n| --- | --- | --- |\n| Memex | 整合多平台对话，支持全文检索和 AI 总结 | 缺乏项目重建 |\n| Echoes | 整合多平台对话，支持全文检索和 AI 管理 | 缺乏项目知识 |").merged).toBe(0);
  // Different rows stay as they are.
  expect(mergeOverlappingRows("| 模块 | 负责 | 说明 |\n| --- | --- | --- |\n| Wiki | 解释 | 长文 |\n| Reader | 证据 | 原文 |").merged).toBe(0);
});

it("notes items a list or sentence leaves out of the first version while another clause puts them in", () => {
  const plan = chapter("a", "开发规划", [
    "- P0/核心保留：消息级搜索、侧边栏快速上下文、项目 Dashboard/Wiki 及原文定位。\n- 暂缓开发：完整 Wiki 自动生成、3D 知识球/大型知识图谱、所有平台实时同步。",
    "第一版只需保证核心流程稳定，不实现 Wiki、知识图谱、自动同步等所有功能。",
  ]);
  expect(scopeDisagreements([plan])).toBe(1);
  expect(plan.body).toContain("> 范围有分歧：「完整 Wiki 自动生成」写为暂缓开发，同一处又写「P0/核心保留：消息级搜索、侧边栏快速上下文、项目 Dashboard/Wiki 及原文定位」。");
  // Wiki is noted once, not again for the second sentence; a list leaving out what nothing puts in adds no note.
  expect(plan.body.match(/范围有分歧/gu)).toHaveLength(1);
  const quiet = chapter("b", "规划", ["- 暂缓开发：看板、甘特图。", "P0 实现消息级搜索。"]);
  expect(scopeDisagreements([quiet])).toBe(0);
});

it("notes an item left out of the first version that another chapter proposes to use", () => {
  const product = chapter("a", "产品定位", ["当前仅预留 Level 3 Buildability，不实现 Wokwi 仿真或固件生成。"]);
  const tests = chapter("b", "测试体系", ["利用 Wokwi 进行浏览器端仿真，计算 Simulation Pass Rate。", "后期集成 Wokwi 进行在线仿真。"]);
  expect(scopeDisagreements([product, tests])).toBe(1);
  expect(product.body).toContain("> 范围有分歧：「Wokwi 仿真」写为不实现，「测试体系」中又建议「利用 Wokwi 进行浏览器端仿真，计算 Simulation Pass Rate」。这是后期方向还是第一版要做，需要你确认。");
  // A use already placed later is no disagreement.
  const later = chapter("c", "测试体系", ["后期集成 Wokwi 进行在线仿真。"]);
  expect(scopeDisagreements([chapter("d", "定位", ["不实现 Wokwi 仿真。"]), later])).toBe(0);
});

it("reads a negated use as no proposal", () => {
  const scope = chapter("a", "工作流", ["| 事项 | 第一版 |\n| --- | --- |\n| 实时比价 | 不做 |"]);
  const journey = chapter("b", "产品定位", ["零件盘点：标记缺失零件，提供规格建议，但不接入实时比价或商城购买功能。", "第一版不实现实时比价。"]);
  expect(scopeDisagreements([scope, journey])).toBe(0);
});

it("notes an item left out of the first version that a flow of the first version runs as a step", () => {
  const scope = chapter("a", "开发计划", ["| 事项 | 第一版 |\n| --- | --- |\n| PCB/仿真/固件 | 不做：禁止 PCB、KiCad、Wokwi 仿真 |", "第一版不实现 Wokwi 仿真。"]);
  const flow = chapter("b", "技术架构", ["V0.1 版本严格限定为：自然语言输入 -> Hardware IR 生成 -> 规则检查 -> BOM/代码生成 -> Wokwi 仿真，不包含 PCB 设计。"]);
  expect(scopeDisagreements([scope, flow])).toBe(1);
  expect(scope.body).toContain("「Wokwi 仿真」写为不实现，「技术架构」中又建议「V0.1 版本严格限定为");
});

it("reads exporting to an item as using it", () => {
  const scope = chapter("a", "电气验证", ["第一版不进行拍照识别、PCB、Wokwi、Code Generation 及数据库开发。"]);
  const flow = chapter("b", "仿真", ["V1 阶段不自研仿真器，而是将生成的项目导出至 Wokwi 进行在线仿真。"]);
  expect(scopeDisagreements([scope, flow])).toBe(1);
});

it("merges lines leaving items out of each stage into one table, each row adding only what is new", () => {
  const lines = [
    "- 严禁大量 hardcode UI、使用 any。",
    "- 当前阶段禁止扩展 PCB、KiCad、Wokwi、代码生成、数据库，仅聚焦 AI 理解层和 Undo。",
    "- 本阶段不进行拍照识别、PCB、Wokwi、数据库开发。",
    "- 在 Milestone 3.2 和 3.3 阶段，明确禁止开发 PCB、KiCad、Wokwi。",
  ];
  const plan = chapter("a", "开发规划", [lines.join("\n")]);
  plan.paragraphs[0].claims = [{ text: "本阶段不进行拍照识别、PCB、Wokwi、数据库开发。", unitIds: ["u2"] }, { text: "在 Milestone 3.2 和 3.3 阶段，明确禁止开发 PCB、KiCad、Wokwi。", unitIds: ["u3"] }];
  expect(scopeTables([plan])).toBe(3);
  expect(plan.paragraphs[0].text).toBe([
    "- 严禁大量 hardcode UI、使用 any。", "",
    "| 阶段 | 不做 | 只做 |", "| --- | --- | --- |",
    "| 当前阶段 | PCB、KiCad、Wokwi、代码生成、数据库 | 仅聚焦 AI 理解层和 Undo |",
    "| 本阶段 | 同上，另加 拍照识别、数据库开发 | — |",
    "| Milestone 3.2 和 3.3 阶段 | 同上 | — |",
  ].join("\n"));
  expect(plan.body).toBe(plan.paragraphs[0].text);
  expect(plan.paragraphs[0].claims).toEqual([{ text: "同上，另加 拍照识别、数据库开发", unitIds: ["u2"] }, { text: "Milestone 3.2 和 3.3 阶段", unitIds: ["u3"] }]);
  // One such line is a list item, not a table.
  expect(scopeTables([chapter("b", "规划", ["- 本阶段不做 PCB、KiCad、Wokwi。\n- 先做导入。"])])).toBe(0);
  // What a line keeps to, told before its limit, goes under 只做, not 阶段.
  const kept = chapter("c", "规划", [["- **第一版**：严格限定为 ESP32 DevKit V1 + 常见模块，禁止加入 PCB设计、STM32、FPGA。", "- **当前阶段禁令**：禁止扩展 PCB、KiCad、Wokwi。"].join("\n")]);
  scopeTables([kept]);
  expect(kept.paragraphs[0].text).toContain("| 第一版 | PCB设计、STM32、FPGA | ESP32 DevKit V1 + 常见模块 |");
});

it("compares scope only within one stage", () => {
  const scope = chapter("a", "开发规划", ["本阶段不进行拍照识别、PCB、Wokwi 及数据库开发。"]);
  const flow = chapter("b", "仿真", ["V1 阶段不自研仿真器，而是将生成的项目导出至 Wokwi 进行在线仿真。"]);
  expect(scopeDisagreements([scope, flow])).toBe(0);
});

it("notes a name told both as still to come and as done", () => {
  const architecture = chapter("a", "AI 核心", ["现有本地规则解析重构为 LocalInterpreter，未来可新增 LLMInterpreter，两者输出相同的 RequestPlan。"]);
  const plan = chapter("b", "开发路线", ["AI Core 基础设施（含 LocalInterpreter, LLMInterpreter, Request Router 等）已具备较高成熟度，建议冻结。"]);
  expect(statusClashes([architecture, plan])).toBe(1);
  expect(plan.problems).toEqual(['"LLMInterpreter" is told both as still to come and as done; say which holds now and mark the earlier one 此前']);
  expect(statusClashes([chapter("c", "AI", ["未来可新增 LLMInterpreter。"])])).toBe(0);
});

it("reads stages and to-come-versus-done in English as in Chinese", () => {
  expect(stageOf("This phase won't build PCB or firmware.")).toEqual({ level: "iteration", label: "current" });
  expect(stageOf("The first version supports ESP32 only.")).toEqual({ level: "version", label: "first" });
  const plan = chapter("a", "AI", ["We will add LLMInterpreter after the local parser is stable."]), done = chapter("b", "Roadmap", ["The AI core (LocalInterpreter, LLMInterpreter) is already mature."]);
  expect(statusClashes([plan, done])).toBe(1);
});

it("keeps an item's object when its only Latin name is a common word, and reads a confirmed decision as putting an item in", () => {
  const buy = () => chapter("a", "采购", ["第一版不实现实时全网比价和商城API对接，仅提供缺件清单。", "针对小白用户，项目应直接询问需要购买的元件，并提供比价推荐及链接。"]);
  const keys = chapter("b", "密钥", ["核心策略是让用户自行接入 API，避免共享密钥风险。"]);
  // "商城API对接" is not the model API the user connects.
  const plain = buy();
  expect(scopeDisagreements([plain, keys])).toBe(0);
  // A decision the user confirmed names the core of 「实时全网比价」.
  const decided = buy();
  expect(scopeDisagreements([decided, keys], new Set(["针对小白用户，项目应直接询问需要购买的元件，并提供比价推荐及链接。"]))).toBe(0);
  decided.paragraphs[1].claims = [{ text: "针对小白用户，项目应直接询问需要购买的元件，并提供比价推荐及链接。", unitIds: ["u"] }];
  expect(scopeDisagreements([decided, keys], new Set(["针对小白用户，项目应直接询问需要购买的元件，并提供比价推荐及链接。"]))).toBe(1);
  expect(decided.body).toContain("> 范围有分歧：「实时全网比价」写为不实现，下文有你确认过的「针对小白用户，项目应直接询问需要购买的元件，并提供比价推荐及链接」。这是后期方向还是第一版要做，需要你确认。");
  expect(decided.body).not.toContain("「商城API对接」");
});

it("notes two versions of a rule written in two places, one allowing what the other refuses, with no word settling them", () => {
  const statements: Record<string, string> = { old: "默认使用 sessionStorage 仅本次会话有效；可选“在此设备记住”存 localStorage，但需提示安全风险。", new: "API Key 默认仅保存在运行时内存；可选使用 sessionStorage，禁止使用 localStorage 或长期保存。", more: "ProviderPreference 可持久化到 localStorage，并记住 baseUrl。" };
  const make = () => {
    const architecture = chapter("a", "技术架构", ["- **密钥存储**：默认使用 sessionStorage 仅本次会话有效；可选“在此设备记住”存 localStorage，但需提示安全风险。"]), safety = chapter("b", "安全策略", ["- **存储机制**：API Key 默认仅存在于运行时内存，禁止写入 localStorage。"]);
    architecture.paragraphs[0].unitIds = ["old"]; safety.paragraphs[0].unitIds = ["new"];
    return [architecture, safety];
  };
  const unresolved = [{ older: "old", newer: "new", kind: "replaces", status: "unresolved" }];
  const chapters = make();
  expect(versionDisagreements(chapters, unresolved, id => statements[id])).toBe(1);
  expect(chapters[0].body).toContain("> 版本未定：此处「默认使用 sessionStorage 仅本次会话有效；可选“在此设备记住”存 localSt…」是较早的说法，「安全策略」中");
  expect(chapters[0].body).toContain("对 localStorage 一个允许、一个禁止。原文未见你确认改用哪一版，需要你确认。");
  // A change the user settled, or a later version adding to the earlier one, is not noted.
  expect(versionDisagreements(make(), [{ ...unresolved[0], status: "resolved" }], id => statements[id])).toBe(0);
  expect(versionDisagreements(make(), [{ older: "more", newer: "old", kind: "replaces", status: "unresolved" }], id => statements[id])).toBe(0);
});

it("matches a name as a whole word, reads a negated priority as none, and leaves another product's paragraph out", () => {
  const scope = () => chapter("a", "范围", ["当时阶段不进行拍照识别、Code Generation、LangGraph 及 RAG 开发。"]);
  const rules = chapter("b", "界面", ["禁止大量 Hardcode、滥用 any、业务逻辑耦合 UI 及提前实现非核心功能。"]);
  const rivals = chapter("c", "竞品", ["NeuroBoard 定位为 AI 驱动的 PCB 编译器，使用 LangGraph 进行 Agent 编排。"]);
  expect(scopeDisagreements([scope(), rules])).toBe(0);
  // Another product's paragraph is not this project using it.
  expect(scopeDisagreements([scope(), rivals], new Set(), paragraph => paragraph.text.startsWith("NeuroBoard"))).toBe(0);
  // Without that, it would be read as this project's proposal: the check still catches a use of this project's own.
  const ours = chapter("d", "架构", ["使用 LangGraph 进行 Agent 编排。"]);
  expect(scopeDisagreements([scope(), ours])).toBe(1);
});

it("reads a scope line after its label, names a stageless row by its label, and drops an empty column", () => {
  const lines = [
    "- **当前阶段禁止项**：禁止扩展30个元件、PCB、KiCad、Wokwi、代码生成、数据库。",
    "- **阶段禁令**：明确禁止开发 PCB、仿真、固件生成、高压设计。",
  ];
  const plan = chapter("a", "开发规划", [lines.join("\n")]);
  expect(scopeTables([plan])).toBe(2);
  expect(plan.paragraphs[0].text).toBe([
    "| 阶段 | 不做 |", "| --- | --- |",
    "| 当前阶段禁止项 | 扩展30个元件、PCB、KiCad、Wokwi、代码生成、数据库 |",
    "| 阶段禁令 | 同上，另加 仿真、固件生成、高压设计 |",
  ].join("\n"));
});

it("notes a value the user changed that a paragraph citing neither version still gives", () => {
  const statements: Record<string, string> = { old: "默认 25 分钟专注、5 分钟休息（25/5）。", now: "默认专注时长改为 50 分钟，休息 10 分钟（50/10）。" };
  const relations = [{ older: "old", newer: "now", kind: "replaces", status: "resolved" }];
  const flow = chapter("a", "核心流程", ["首次打开默认显示 25:00，点击开始。", "专注结束后进入 5 分钟休息。", "此前为 25/5，后改为 50/10。", "当前默认 50 分钟。"]);
  expect(staleValueNotes([flow], relations, id => statements[id], id => id === "now", "zh-CN")).toBe(1);
  expect(flow.body).toContain("首次打开默认显示 25:00，点击开始。\n\n> 数值已更新：这里的「25:00」是较早的数值；你后来决定默认专注时长改为 50 分钟，休息 10 分钟（50/10）。");
  // A lone one-digit value says too little; the change told, or the new value given, is left alone.
  expect(flow.body.match(/数值已更新/gu)).toHaveLength(1);
  // A change the user did not make is not noted.
  const other = chapter("b", "流程", ["首次打开默认显示 25:00。"]);
  expect(staleValueNotes([other], relations, id => statements[id], () => false, "zh-CN")).toBe(0);
});

it("notes a first-version item that a list of pending items names", () => {
  const scope = chapter("a", "产品定位", ["第一版包含学习任务名称（如“高等数学”）。", "第一版支持暂停与继续。"]);
  const plan = chapter("b", "规划路线", ["其他待定事项还包括任务名称、7天统计、提前结束统计、跨午夜归属等。"]);
  expect(pendingDisagreements([scope, plan])).toBe(1);
  expect(scope.body).toContain("第一版包含学习任务名称（如“高等数学”）。\n\n> 范围有分歧：这里写「第一版包含学习任务名称（如“高等数学”）」，「规划路线」中又把「任务名称」列为待定事项。第一版是否包含，需要你确认。");
  expect(pendingDisagreements([chapter("c", "范围", ["第一版支持暂停与继续。"]), plan])).toBe(0);
});

it("pairs old and new values in order, reads two minute values as a pair, and puts the note before a code block", () => {
  const statements: Record<string, string> = { old: "第一版默认专注时长为25分钟，短休息时长为5分钟，每4轮后休息15分钟。", now: "用户决定将默认专注时长改为 50 分钟，休息时长改为 10 分钟。" };
  const relations = [{ older: "old", newer: "now", kind: "replaces", status: "resolved" }];
  const scope = chapter("a", "产品定位", ["第一版仅保留固定25/5交替计时与通知。", "是否加入每 4 个番茄钟一次的 15 分钟长休息尚未确定。", "标准流程为：25分钟专注 -> 提醒。\n\n```\nidle — 准备开始\n\nfocusing — 专注中\n```"]);
  expect(staleValueNotes([scope], relations, id => statements[id], id => id === "now", "zh-CN")).toBe(2);
  expect(scope.body).toContain("第一版仅保留固定25/5交替计时与通知。\n\n> 数值已更新：这里的「25/5」是较早的数值；你后来决定默认专注时长改为 50 分钟，休息时长改为 10 分钟。");
  // The long break was not decided again.
  expect(scope.body).toContain("15 分钟长休息尚未确定。\n\n标准流程");
  expect(scope.body).toContain("标准流程为：25分钟专注 -> 提醒。\n\n> 数值已更新：这里的「25分钟」");
  expect(scope.body.endsWith("```")).toBe(true);
});

it("keeps apart rows that give different values in one column", () => {
  const table = "| 阶段 | 时长 | 界面/行为特征 |\n| --- | --- | --- |\n| 专注 | 50 分钟 | 显示暖棕色剩余分钟；完成后发送通知，等待用户手动开始休息 |\n| 休息 | 10 分钟 | 显示绿色剩余分钟；完成后发送通知，等待用户手动开始下一轮 |\n| 暂停 | - | 显示灰色标识；暂停时间不计入实际学习时长 |";
  expect(mergeOverlappingRows(table)).toEqual({ text: table, merged: 0 });
});

it("reads a decided table cell with its row: an item the user decided to leave out is no disagreement", () => {
  const decided = "| 事项 | 第一版 |\n| --- | --- |\n| 账号系统 | 不做，所有数据仅存储在本地 |";
  const data = { ...chapter("a", "数据模型存储", [decided]) };
  data.paragraphs[0].claims = [{ text: "账号系统", unitIds: ["u"] }];
  const stages = chapter("b", "阶段安排", ["第一版暂不开发 AI 助手、网站屏蔽、复杂任务管理、社交排行榜及账号系统，以避免 MVP 过于复杂。"]);
  expect(scopeDisagreements([data, stages], new Set(["账号系统"]))).toBe(0);
  expect(stages.body).not.toContain("范围有分歧");
});
