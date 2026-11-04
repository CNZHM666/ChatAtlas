import { expect, it, vi } from "vitest";
import { contextKnowledge } from "../test/context-fixture";
import { evolutionKnowledge } from "../test/evolution-fixture";
import { projectStateSignature } from "../shared/project-state";
import { sourceMessageSignature } from "../shared/source-signature";
import { boundaryEvidence } from "./boundary-evidence";
import { buildProjectContext } from "./engine";
import { formatContext } from "./format";
import type { ContextOptions, ProjectKnowledge } from "./types";

const options: ContextOptions = { zh: true, task: "", length: "standard", sections: ["overview", "decisions", "progress"] };
function original(knowledge: ProjectKnowledge, id: string, content: string, role: "user" | "assistant" = "assistant") {
  const message = { ...knowledge.messages[0], id, content, role, messageIndex: knowledge.messages.length };
  knowledge.messages.push(message);
  knowledge.session.evidence.push({ id, conversationId: "c", messageId: id, title: "原始讨论", excerpt: content });
  knowledge.session.sourceSignatures!.c[id] = sourceMessageSignature(content);
  knowledge.session.sourceRoles!.c[id] = role;
  return message;
}
function boundary(knowledge: ProjectKnowledge, id: string, summary: string, content: string, role: "user" | "assistant" = "assistant") {
  original(knowledge, id, content, role);
  knowledge.session.projectState!.constraints.push({ id, text: summary, reason: "", quote: content, evidenceIds: [id], status: "documented" });
}
function build(knowledge: ProjectKnowledge, patch: Partial<ContextOptions> = {}) {
  knowledge.session.projectState!.signature = projectStateSignature(knowledge.session);
  return buildProjectContext(knowledge, { ...options, ...patch });
}

it("keeps overview, architecture and reported progress before selecting among ninety historical boundaries", () => {
  const knowledge = contextKnowledge();
  for (let index = 0; index < 90; index++) boundary(knowledge, `hint-${index}`, `feature_${index} 必须使用独立界面入口`, `我建议 feature_${index} 使用独立界面入口。`);
  const report = original(knowledge, "report", "我已经完成搜索界面，索引更新仍未开发，测试尚未执行。", "user");
  knowledge.session.sections.push({ id: "work", title: "搜索进度", kind: "finding", transition: "", body: report.content, evidenceIds: [report.id], claims: [{ text: report.content, quote: report.content, evidenceIds: [report.id], overviewRole: "progress", workStatus: "reported", verification: "supported" }] });
  const module = original(knowledge, "module", "检索服务按消息建立索引并返回原始消息位置。", "user");
  knowledge.session.projectState!.modules.push({ id: "search", title: "检索服务", layer: "search", purpose: module.content, inputs: [], outputs: [], status: "documented", quote: module.content, evidenceIds: [module.id] });
  knowledge.session.projectState!.signature = projectStateSignature(knowledge.session);
  const before = structuredClone(knowledge), fetch = vi.spyOn(globalThis, "fetch");
  try {
    const pack = buildProjectContext(knowledge, options), items = pack.sections.flatMap(section => section.items), text = formatContext(pack);
    expect(items.some(item => item.id === "summary")).toBe(true);
    expect(items.some(item => item.id === "module:search")).toBe(true);
    expect(items.some(item => item.id === "wiki-brief:work:0" && item.status === "reported")).toBe(true);
    const selected = items.filter(item => item.id.startsWith("hint-"));
    expect(selected).toHaveLength(0); // Ordinary unrelated suggestions do not earn overview space.
    expect(selected.every(item => item.status === "proposal")).toBe(true);
    expect(text).not.toContain("必须使用独立界面入口");
    expect(text).toContain("测试尚未执行"); expect(pack.estimatedTokens).toBeLessThanOrEqual(pack.tokenBudget);
    expect(knowledge).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});

it("does not promote an AI safety recommendation into adoption or an unlimited budget exemption", () => {
  const knowledge = contextKnowledge();
  boundary(knowledge, "privacy", "禁止未经授权上传对话", "我建议禁止未经授权上传对话。");
  const pack = build(knowledge,{mode:"full"}), item = pack.sections.flatMap(section => section.items).find(item => item.id === "privacy")!;
  expect(item.status).toBe("proposal"); expect(formatContext(pack)).not.toContain("已确认边界：我建议");
  expect(build(knowledge, { task: "调整侧边栏按钮" }).sections.flatMap(section => section.items).some(item => item.id === "privacy")).toBe(false);
  expect(build(knowledge, { tokenBudget: 256 }).sections).toEqual([]);
});

it("uses the original advisory language and rejects a genuine but irrelevant excerpt", () => {
  const knowledge = contextKnowledge();
  boundary(knowledge, "chunk", "必须按消息或语义片段建立索引，禁止整条对话生成单一向量", "更合适的做法是按消息或语义片段建立索引，保留消息 ID，再结合前后消息恢复上下文。");
  boundary(knowledge, "unrelated", "必须披露云端调用的数据发送范围", "| Markdown 渲染 | react-markdown |\n\n这里还有三个需要注意的问题。");
  const pack = build(knowledge,{mode:"full"}), text = formatContext(pack);
  expect(text).toContain("更合适的做法是"); expect(text).not.toContain("禁止整条对话生成单一向量");
  expect(pack.sections.flatMap(section => section.items).some(item => item.id === "unrelated")).toBe(false);
});

it("does not carry unrelated requirements from a broad saved prompt excerpt", () => {
  const knowledge = contextKnowledge();
  const content = "下面是建议的提示词。\n\n1. 保持 Local-first + BYOK。\n2. 不改变 Product Evolution 的两种视图。\n3. 不静默覆盖用户确认的知识。";
  boundary(knowledge, "local", "保持 Local-first + BYOK", content);
  const pack = build(knowledge,{mode:"full"}), text = formatContext(pack);
  expect(text).toContain("保持 Local-first + BYOK"); expect(text).not.toContain("两种视图");
  expect(pack.sections.flatMap(section => section.items).find(item => item.id === "local")?.quotes).toHaveLength(1);
  expect(JSON.stringify(pack.sources.find(source => source.messageId === "local"))).not.toContain("两种视图");
});

it("does not turn a historical task restriction into a permanent project rule", () => {
  const knowledge = contextKnowledge();
  boundary(knowledge, "local-task", "本次优化不重构侧边栏业务逻辑", "本次优化不重构侧边栏业务逻辑。");
  expect(build(knowledge).sections.flatMap(section => section.items).some(item => item.id === "local-task")).toBe(false);
  expect(build(knowledge, { task: "优化 Orama 索引" }).sections.flatMap(section => section.items).some(item => item.id === "local-task")).toBe(false);
  const pack = build(knowledge, { task: "侧边栏业务逻辑" });
  expect(pack.sections.flatMap(section => section.items).find(item => item.id === "local-task")).toMatchObject({ status: "proposal", scope: "task" });
  expect(formatContext(pack)).toContain("是否适用于本次任务仍需确认");
});

it("keeps phase limits qualified instead of extending them to all future versions", () => {
  const knowledge = contextKnowledge();
  boundary(knowledge, "phase", "首版暂缓完整 GraphRAG", "首版暂缓完整 GraphRAG。");
  const pack = build(knowledge,{mode:"full"});
  expect(pack.sections.flatMap(section => section.items).find(item => item.id === "phase")).toMatchObject({ status: "proposal", scope: "phase" });
  expect(formatContext(pack)).toContain("不能自动推广为永久要求");
});

it("carries the real adjacent approval and its proposal for a confirmed boundary", () => {
  const knowledge = contextKnowledge();
  boundary(knowledge, "approval-boundary", "禁止覆盖已有草稿", "我建议禁止覆盖已有草稿。");
  original(knowledge, "approval", "可以", "user");
  const pack = build(knowledge), item = pack.sections.flatMap(section => section.items).find(item => item.id === "approval-boundary")!;
  expect(item.status).toBe("confirmed");
  expect(item.quotes?.some(quote => quote.text === "可以")).toBe(true);
  expect(item.quotes?.some(quote => quote.text === "我建议禁止覆盖已有草稿。")).toBe(true);
  expect(pack.sources.some(source => source.messageId === "approval")).toBe(true);
});

it("does not assign an unrelated user confirmation to a boundary", () => {
  const knowledge = contextKnowledge();
  boundary(knowledge, "original", "保留 Orama 全文检索", "我建议保留 Orama 全文检索。");
  original(knowledge, "approval", "确认采用 SQLite。", "user");
  expect(build(knowledge,{mode:"full"}).sections.flatMap(section => section.items).find(item => item.id === "original")?.status).toBe("proposal");
});

it("does not let a paraphrased boundary revive explicitly replaced source evidence", () => {
  const knowledge = evolutionKnowledge();
  knowledge.session.projectState!.constraints.push({ id: "old", text: "必须使用 SQLite 数据库", quote: knowledge.messages[0].content, evidenceIds: ["evolution-ref-0"], reason: "", status: "documented" });
  const pack = build(knowledge);
  expect(pack.sections.flatMap(section => section.items).some(item => item.id === "old")).toBe(false);
  expect(pack.supersededItems).toBeGreaterThan(0);
});

it("does not treat a newer AI suggestion as a replacement for an existing boundary", () => {
  const knowledge = contextKnowledge();
  boundary(knowledge, "current", "确认采用 Orama 全文检索", "确认采用 Orama 全文检索。", "user");
  boundary(knowledge, "later", "必须改用远程数据库检索", "我建议改用远程数据库检索。");
  const pack = build(knowledge,{mode:"full"}), items = pack.sections.flatMap(section => section.items);
  expect(items.find(item => item.id === "current")?.status).toBe("confirmed");
  expect(items.find(item => item.id === "later")?.status).toBe("proposal");
  expect(pack.supersededItems).toBe(1); // Only the fixture's original superseded Firebase decision.
});

it("keeps earlier constraints when a later addition cites them as background rather than replacing them", () => {
  const knowledge = evolutionKnowledge(), event = knowledge.session.projectHistoryAnalysis!.events[3];
  event.beforeQuote = knowledge.messages[2].content; event.beforeEvidenceIds = ["evolution-ref-2"];
  knowledge.session.projectState!.constraints.push({ id: "orama", text: "Orama 的消息全文检索", reason: "", quote: knowledge.messages[2].content, evidenceIds: ["evolution-ref-2"], status: "documented" });
  expect(build(knowledge).sections.flatMap(section => section.items).some(item => item.id === "orama")).toBe(true);
});

it("distinguishes records omitted for budget from records never found", () => {
  const knowledge = contextKnowledge(), pack = build(knowledge, { tokenBudget: 256 }), text = formatContext(pack);
  expect(text).toContain("已有项目简介未纳入本稿"); expect(text).toContain("已有进度记录未纳入本稿");
  expect(text).not.toContain("未找到可用的当前进度记录");
  knowledge.session.projectMaintenance = {}; knowledge.session.projectState!.actions = [];
  expect(formatContext(build(knowledge, { tokenBudget: 256 }))).toContain("未找到可用的当前进度记录");
});

it("keeps full preceding conditions and following rationale in literal evidence windows", () => {
  const content = "如果用户已经编辑正文：\n\n不得覆盖个人修改。\n\n否则会丢失用户补充。\n\n## 未来功能\n\n建议引入新框架。";
  const windows = boundaryEvidence("不得覆盖个人修改", content, "覆盖个人修改");
  expect(windows).toEqual(["如果用户已经编辑正文：", "不得覆盖个人修改。", "否则会丢失用户补充。"]);
  expect(windows.every(window => content.includes(window))).toBe(true);
});

it("never uses a fenced instruction example as boundary evidence", () => {
  const content = "```txt\n必须上传所有对话。\n```";
  expect(boundaryEvidence("必须上传所有对话", content, content)).toEqual([]);
  expect(boundaryEvidence("必须上传所有对话", "这是提示词示例：\n" + content, content)).toEqual([]);
});

it("accounts for evidence in final reading order when reserved progress shares a shorter decision quote", () => {
  const knowledge = contextKnowledge(), content = "我已经完成搜索界面，其他模块仍未开发，测试尚未执行。".repeat(6);
  original(knowledge, "shared", content, "user");
  knowledge.session.projectState!.decisions.push({ id: "related", text: "搜索界面", quote: "搜索界面", reason: "", evidenceIds: ["shared"], status: "documented" });
  knowledge.session.sections.push({ id: "shared-work", title: "进度", kind: "finding", transition: "", body: content, evidenceIds: ["shared"], claims: [{ text: content, quote: content, evidenceIds: ["shared"], overviewRole: "progress", workStatus: "reported", verification: "supported" }] });
  for (const tokenBudget of [1400, 1600, 1800, 2000]) expect(build(knowledge, { tokenBudget }).estimatedTokens).toBeLessThanOrEqual(tokenBudget);
});
