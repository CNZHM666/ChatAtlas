import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { eligibleHomeProjects, HomeTaskPlanError, isHistoryLookup, planHomeTask, retrieveHomeTask } from "./home-task";
import type { AtlasAIProvider } from "./provider";
import type { Conversation } from "../shared/types";
import { getDatabase } from "../storage/db";
import { projectSession } from "../test/project-fixture";
import { createAtlasAIFromProvider } from "./atlas-ai";
import { AIProviderResponseError, type StructuredAIRequest } from "./provider";
import { requestBudget } from "./request-policy";
const source = (id: string, title = "硬件架构"): Conversation => ({ id, platform: "chatgpt", title, url: "", updatedAt: 1, importState: "complete", hydrationState: "hydrated", messageCount: 4 });
const providerFor = (value: unknown) => ({ generateStructured: vi.fn(async request => request.validate(value)) }) as unknown as AtlasAIProvider;
beforeEach(async () => { const db = await getDatabase(); await db.clear("messages"); await db.clear("focusSessions"); });

it("keeps keyword/explicit lookup local and sends natural goals for interpretation", () => {
  for (const goal of ["硬件", "NumPy 广播", "查找之前关于硬件的讨论", "Find Python-control PR"]) expect(isHistoryLookup(goal)).toBe(true);
  for (const goal of ["我想完成我的戒色项目", "总结硬件架构", "复习极点", "Review poles", "帮我把已选对话整理成项目", "Why did we choose Orama?"]) expect(isHistoryLookup(goal)).toBe(false);
});
it("plans explicit selected-pool actions locally, while keeping topic and partial tasks on their normal path", async () => {
  const provider = providerFor({ action: "project", queries: ["硬件"] });
  const pool = [source("one"), source("two")], signal = new AbortController().signal;
  for (const [goal, action] of [["把全部已选对话整理成一个项目", "project"], ["总结全部已选对话的主要结论、决策和未解决问题", "answer"], ["Create a project from all selected conversations", "project"]] as const) {
    const plan = await planHomeTask(provider, goal, pool, [], true, signal, action);
    expect(plan).toEqual({ action, queries: [], allSources: true, sourceScope: "conversations" });
    expect((await retrieveHomeTask(plan, pool, signal)).ids).toEqual(["one", "two"]);
  }
  expect(provider.generateStructured).not.toHaveBeenCalled();
  await planHomeTask(provider, "只整理全部已选对话中关于硬件的部分", pool, [], true, signal, "project");
  expect(provider.generateStructured).toHaveBeenCalledOnce();
  const cancelled = new AbortController(); cancelled.abort();
  await expect(planHomeTask(provider, "把全部已选对话整理成一个项目", pool, [], true, cancelled.signal, "project")).rejects.toThrow();
});
it("bounds navigation metadata and validates existing project IDs without exporting raw history", async () => {
  const sources = Array.from({ length: 132 }, (_, index) => source(`s${index}`));
  const project = { ...projectSession(), sourceConversationIds: ["s0"], status: "ready" as const };
  const eligible = eligibleHomeProjects([project, { ...project, id: "excluded", sourceConversationIds: ["private"] }], new Set(sources.map(source => source.id)));
  expect(eligible.map(project => project.id)).toEqual([project.id]);
  const provider = providerFor({ action: "continue", queries: [], projectId: project.id });
  await expect(planHomeTask(provider, "继续硬件项目", sources, eligible, true, new AbortController().signal)).resolves.toMatchObject({ action: "continue", projectId: project.id });
  const request = vi.mocked(provider.generateStructured).mock.calls[0][0];
  const prompt = JSON.parse(request.prompt);
  expect(prompt.selectedCount).toBe(132); expect(prompt.sources).toHaveLength(80);
  expect(prompt.sources[0]).toEqual({ title: "硬件架构" }); expect(request.conversationIds).toHaveLength(132);
  for (const value of [{ action: "continue", queries: [], projectId: "excluded" }, { action: "project", queries: [] }, { action: "clarify", queries: [], question: "" }, { action: "answer", queries: ["x".repeat(81)] }]) {
    await expect(planHomeTask(providerFor(value), "goal", sources, eligible, true, new AbortController().signal)).rejects.toThrow();
  }
});
it("accepts harmless model field variations without inventing a task topic or widening the pool", async () => {
  const signal = new AbortController().signal;
  const sources = [source("one")];
  const project = { ...projectSession(), sourceConversationIds: ["one"] };
  await expect(planHomeTask(providerFor({ action: " Project ", queries: " 硬件AI ", projectId: null, question: null, allSources: null }), "创建项目：硬件AI", sources, [], true, signal)).resolves.toEqual({ action: "project", queries: ["硬件AI"] });
  await expect(planHomeTask(providerFor({ action: "clarify", question: " 哪个主题？ " }), "创建项目", sources, [], true, signal)).resolves.toEqual({ action: "clarify", queries: [], question: "哪个主题？" });
  await expect(planHomeTask(providerFor({ action: "continue", projectId: project.id }), "继续项目", sources, [project], true, signal)).resolves.toEqual({ action: "continue", queries: [], projectId: project.id });
  for (const value of [{ action: "project" }, { action: "project", queries: null }, { action: "project", queries: ["硬件"], allSources: "true" }, { action: "continue", projectId: "outside-pool" }, { action: "create_project", queries: ["硬件"] }, [{ action: "project", queries: ["硬件"] }]]) {
    await expect(planHomeTask(providerFor(value), "goal", sources, [project], true, signal)).rejects.toBeInstanceOf(HomeTaskPlanError);
  }
});
it("provides schema examples and reports the invalid field without including source or model text in errors", async () => {
  const provider = providerFor({ action: "project", queries: [42] });
  const error = await planHomeTask(provider, "创建项目：硬件AI", [source("one")], [], true, new AbortController().signal).catch(error => error);
  expect(error).toMatchObject({ code: "PROVIDER_SCHEMA_invalid_task_plan", fieldPaths: ["queries"] });
  expect(error.message).toContain("AI 返回的任务安排不符合要求");
  const request = vi.mocked(provider.generateStructured).mock.calls[0][0];
  expect(JSON.parse(request.prompt)).toMatchObject({ presentation: "home_task_plan", version: 6, expectedShape: { action: "project", queries: ["主题词"], allSources: false } });
  expect(request.system).toContain("Always include queries as an array");
});
it("retrieves whole relevant turns and dependent follow-ups from a 132-source pool, excluding other topics and unselected sources", async () => {
  const db = await getDatabase();
  const sources = Array.from({ length: 132 }, (_, index) => source(`s${index}`, index ? `其他学习 ${index}` : "硬件架构"));
  for (const [id, conversationId, role, content, messageIndex] of [
    ["u1", "s0", "user", "硬件如何验证？", 0], ["a1", "s0", "assistant", "使用 Validator。", 1],
    ["u2", "s0", "user", "为什么？", 2], ["a2", "s0", "assistant", "因为可校验电气约束。", 3],
    ["u3", "s0", "user", "午餐吃什么？", 4], ["a3", "s0", "assistant", "米饭。", 5],
    ["private", "not-selected", "assistant", "硬件私密讨论。", 0],
  ] as const) await db.put("messages", { id, conversationId, role, content, messageIndex, preview: content, contentHash: "", createdAt: 1, updatedAt: 1 });
  const result = await retrieveHomeTask({ action: "project", queries: ["硬件"], sourceScope: "passages" }, sources, new AbortController().signal);
  expect(result.ids).toEqual(["s0"]); expect(result.pending).toEqual([]); expect(result.scope.kind).toBe("goal");
  expect(result.scope.blocks?.flatMap(block => block.messageIds)).toEqual(["u1", "a1", "u2", "a2"]);
  expect(result.scope.blocks?.[0].messageSignatures).toHaveProperty("a2");
});
it("does not substitute all sources when retrieval fails, and preserves explicit all-source requests", async () => {
  const pool = Array.from({ length: 132 }, (_, index) => source(`s${index}`, "数学学习"));
  expect((await retrieveHomeTask({ action: "answer", queries: ["无匹配主题"] }, pool, new AbortController().signal)).ids).toEqual([]);
  expect(await retrieveHomeTask({ action: "project", queries: [], allSources: true }, pool, new AbortController().signal)).toMatchObject({ ids: pool.map(item => item.id), scope: { kind: "all" }, limited: false });
  const abort = new AbortController(); abort.abort();
  await expect(retrieveHomeTask({ action: "answer", queries: ["数学"] }, pool, abort.signal)).rejects.toThrow();
});
it("requests syncing only selected relevant conversations before constructing evidence", async () => {
  const pool = [{ ...source("relevant"), importState: "discovered" as const, hydrationState: undefined, messageCount: null }, source("other", "数学")];
  const result = await retrieveHomeTask({ action: "project", queries: ["硬件"], sourceScope: "passages" }, pool, new AbortController().signal);
  expect(result.pending).toEqual(["relevant"]); expect(result.ids).toEqual(["relevant"]);
});

it("uses original discussion meaning to exclude lexical false positives without widening the pool", async () => {
  const db = await getDatabase();
  const pool = [source("hardware"), source("investment", "硬件公司投资")];
  for (const [conversationId, content] of [["hardware", "使用 Validator 校验 GPIO 电气约束。"], ["investment", "硬件公司的股价风险。"], ["private", "硬件私密方案。"]]) await db.put("messages", { id: conversationId, conversationId, messageIndex: 0, role: "assistant", content, preview: content, contentHash: "", createdAt: 1, updatedAt: 1 });
  const provider = { generateStructured: vi.fn(async request => {
    const data = JSON.parse(request.prompt);
    expect(data.goal).toBe("总结硬件电气架构"); expect(data.turns.some((turn: { text: string }) => turn.text.includes("私密"))).toBe(false);
    return request.validate({ ids: data.turns.filter((turn: { text: string }) => turn.text.includes("GPIO")).map((turn: { id: string }) => turn.id), understanding: "根据已有讨论整理 GPIO 电气约束和校验方案。", queries: [], question: "" });
  }) } as unknown as AtlasAIProvider;
  const result = await retrieveHomeTask({ action: "project", queries: ["硬件"], sourceScope: "passages" }, pool, new AbortController().signal, { provider, goal: "总结硬件电气架构", zh: true });
  expect(result.ids).toEqual(["hardware"]); expect(result.scope.taskUnderstanding).toContain("GPIO");
});

it("refines terminology once and refuses fabricated semantic source IDs", async () => {
  const db = await getDatabase();
  await db.put("messages", { id: "control", conversationId: "control", messageIndex: 0, role: "assistant", content: "使用 Validator 校验 GPIO。", preview: "", contentHash: "", createdAt: 1, updatedAt: 1 });
  const pool = [source("control", "电气约束")];
  let calls = 0;
  const provider = { generateStructured: vi.fn(async request => {
    const data = JSON.parse(request.prompt); calls++;
    return request.validate({ ids: calls === 1 ? [] : data.turns.map((turn: { id: string }) => turn.id), understanding: "整理电气校验", queries: calls === 1 ? ["GPIO"] : [], question: "" });
  }) } as unknown as AtlasAIProvider;
  const next = await retrieveHomeTask({ action: "answer", queries: ["本地校验"] }, pool, new AbortController().signal, { provider, goal: "之前如何做电气验证", zh: true });
  expect(next.ids).toEqual(["control"]); expect(calls).toBe(2);
  await expect(retrieveHomeTask({ action: "answer", queries: ["GPIO"] }, pool, new AbortController().signal, { provider: providerFor({ ids: ["private"], understanding: "", queries: [], question: "" }), goal: "电气验证", zh: true })).rejects.toThrow();
});

async function materialFixture() {
  const db = await getDatabase();
  await db.put("messages", { id: "hardware-message", conversationId: "hardware", messageIndex: 0, role: "assistant", content: "硬件 GPIO 使用 Validator 校验电气约束。", preview: "", contentHash: "", createdAt: 1, updatedAt: 1 });
  return [source("hardware")];
}

it("accepts omitted/null optional assessment fields and maps short IDs back to original scoped messages", async () => {
  const pool = await materialFixture();
  for (const value of [{ ids: ["turn1"] }, { ids: " turn1 ", understanding: null, queries: null, question: null }, { ids: ["turn1", "turn1"], queries: " GPIO " }, { ids: ["turn1"], understanding: "说明".repeat(250) }]) {
    const provider = providerFor(value);
    const result = await retrieveHomeTask({ action: "project", queries: ["硬件"], sourceScope: "passages" }, pool, new AbortController().signal, { provider, goal: "创建项目：硬件AI", zh: true });
    expect(result.ids).toEqual(["hardware"]);
    expect(result.scope.blocks?.[0].messageIds).toEqual(["hardware-message"]);
    expect(result.scope.blocks?.[0].messageSignatures).toHaveProperty("hardware-message");
    const prompt = JSON.parse(vi.mocked(provider.generateStructured).mock.calls[0][0].prompt);
    expect(prompt).toMatchObject({ version: 4, expectedShape: { ids: ["turn1"] }, turns: [{ id: "turn1" }] });
  }
});

it.each([
  [{ understanding: "不能默认全选" }, "ids"],
  [{ ids: ["private-message"] }, "ids[0]"],
  [{ ids: ["hardware"] }, "ids[0]"],
  [{ ids: ["turn999"] }, "ids[0]"],
  [{ ids: ["turn1"], queries: [42] }, "queries[0]"],
  [{ ids: ["turn1"], question: {} }, "question"],
  [[{ ids: ["turn1"] }], "response"],
])("rejects unsafe assessments with a precise field path: %s", async (value, field) => {
  const pool = await materialFixture();
  await expect(retrieveHomeTask({ action: "project", queries: ["硬件"], sourceScope: "passages" }, pool, new AbortController().signal, { provider: providerFor(value), goal: "创建项目", zh: true })).rejects.toMatchObject({ fieldPaths: [`materialReview.${field}`], message: expect.stringContaining("材料分析") });
});

it("treats an empty selection as insufficient evidence and skips AI when no discussion text is available", async () => {
  const pool = await materialFixture();
  const empty = providerFor({ ids: [] });
  expect(await retrieveHomeTask({ action: "project", queries: ["硬件"], sourceScope: "passages" }, pool, new AbortController().signal, { provider: empty, goal: "创建项目", zh: true })).toMatchObject({ ids: [], question: expect.any(String) });
  await (await getDatabase()).clear("messages");
  const unused = providerFor({ ids: ["turn1"] });
  expect(await retrieveHomeTask({ action: "project", queries: ["硬件"], sourceScope: "passages" }, pool, new AbortController().signal, { provider: unused, goal: "创建项目", zh: true })).toMatchObject({ ids: [], question: expect.any(String) });
  expect(unused.generateStructured).not.toHaveBeenCalled();
});

it("requires explicit retry after a rejected assessment and reuses the next validated selection", async () => {
  const pool = await materialFixture();
  const generate = vi.fn(async (request: StructuredAIRequest<unknown>) => request.validate(generate.mock.calls.length === 1 ? { ids: ["unknown"] } : { ids: ["turn1"], understanding: "整理硬件验证方案" }));
  const provider = createAtlasAIFromProvider({ id: `home-review-${crypto.randomUUID()}`, generateStructured: generate } as unknown as AtlasAIProvider, { id: "ai-settings", provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiKey: "test", model: "test", updatedAt: 1 });
  const run = () => retrieveHomeTask({ action: "project", queries: ["硬件"], sourceScope: "passages" }, pool, new AbortController().signal, { provider, goal: "创建硬件项目", zh: true });
  await expect(run()).rejects.toThrow(); expect(generate).toHaveBeenCalledOnce();
  expect((await run()).ids).toEqual(["hardware"]);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[1][0].maxAttempts).toBe(1);
  expect((await run()).scope.blocks?.[0].messageIds).toEqual(["hardware-message"]);
  expect(generate).toHaveBeenCalledTimes(2);
});

it("does not automatically repeat paid assessment on format or transport failure", async () => {
  const pool = await materialFixture();
  const settings = { id: "ai-settings" as const, provider: "deepseek" as const, baseUrl: "https://api.deepseek.com/v1", apiKey: "test", model: "test", updatedAt: 1 };
  for (const transportFailure of [false, true]) {
    const generate = vi.fn(async (request: StructuredAIRequest<unknown>) => {
      if (transportFailure) throw new AIProviderResponseError("PROVIDER_TIMEOUT");
      return request.validate({ ids: ["private"] });
    });
    const provider = createAtlasAIFromProvider({ id: crypto.randomUUID(), generateStructured: generate } as unknown as AtlasAIProvider, settings);
    await expect(retrieveHomeTask({ action: "project", queries: ["硬件"], sourceScope: "passages" }, pool, new AbortController().signal, { provider, goal: "创建项目", zh: true })).rejects.toThrow();
    expect(generate).toHaveBeenCalledOnce();
  }
});

it("bounds paid navigation across both retrieval rounds and reads full selected turns only later", async () => {
  const db = await getDatabase(), pool = Array.from({ length: 24 }, (_, index) => source(`budget-${index}`));
  const content = Array.from({ length: 35 }, (_, index) => `硬件 GPIO 方案段落 ${index}。${"完整原文条件。".repeat(30)}`).join("\n\n");
  for (const item of pool) await db.put("messages", { id: `${item.id}-message`, conversationId: item.id, role: "assistant", content, preview: content, contentHash: "", messageIndex: 1, createdAt: 1, updatedAt: 1 });
  const calls: StructuredAIRequest<unknown>[] = [];
  const provider = { modelId: "fixture", generateStructured: async <T,>(request: StructuredAIRequest<T>) => { calls.push(request as StructuredAIRequest<unknown>); return request.validate({ ids: [], queries: ["GPIO"] }); } } as AtlasAIProvider;
  const result = await retrieveHomeTask({ action: "project", queries: ["硬件"], sourceScope: "passages" }, pool, new AbortController().signal, { provider, goal: "硬件 GPIO", zh: true });
  expect(result.ids).toEqual([]); expect(result.question).toBeTruthy(); expect(calls.length).toBeGreaterThan(1); expect(calls.length).toBeLessThanOrEqual(4);
  expect(calls.reduce((sum, request) => sum + requestBudget(request, "fixture").inputTokens, 0)).toBeLessThanOrEqual(12000);
  expect(calls.every(request => requestBudget(request, "fixture").inputTokens <= 4000 && request.maxAttempts === 1)).toBe(true);
  for (const request of calls) for (const turn of JSON.parse(request.prompt).turns) { expect(turn.partial).toBe(true); expect(turn.text).not.toBe(content); }
});

it("invalidates a cached excerpt assessment when original content changes outside its excerpt", async () => {
  const pool = await materialFixture(), db = await getDatabase();
  const original = (await db.get("messages", "hardware-message"))!;
  const content = `${original.content}\n\n\`\`\`text\n${"indivisible example ".repeat(900)}\n\`\`\``;
  await db.put("messages", { ...original, content });
  const generate = vi.fn(async (request: StructuredAIRequest<unknown>) => request.validate({ ids: ["turn1"] }));
  const provider = createAtlasAIFromProvider({ id: `revision-${crypto.randomUUID()}`, generateStructured: generate } as unknown as AtlasAIProvider, { id: "ai-settings", provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiKey: "test", model: "test", updatedAt: 1 });
  const run = () => retrieveHomeTask({ action: "project", queries: ["硬件"], sourceScope: "passages" }, pool, new AbortController().signal, { provider, goal: "创建硬件项目", zh: true });
  await run(); await run(); expect(generate).toHaveBeenCalledOnce();
  await db.put("messages", { ...original, content: content.replace("indivisible example", "changed example"), updatedAt: 2 });
  const result = await run(); expect(result.ids).toEqual(["hardware"]); expect(generate).toHaveBeenCalledTimes(2);
  const first = JSON.parse(generate.mock.calls[0][0].prompt), second = JSON.parse(generate.mock.calls[1][0].prompt);
  expect(first.turns[0].text).toBe(second.turns[0].text); expect(first.turns[0].revision).not.toBe(second.turns[0].revision);
});

it("respects a selected shortcut action before validating unrelated project IDs", async () => {
  const provider = providerFor({ action: "continue", queries: ["控制学习"], projectId: "not-a-real-project" });
  const plan = await planHomeTask(provider, "控制学习", [source("one")], [], true, new AbortController().signal, "answer");
  expect(plan).toEqual({ action: "answer", queries: ["控制学习"] });
  expect(JSON.parse(vi.mocked(provider.generateStructured).mock.calls[0][0].prompt).requestedAction).toBe("answer");
});
