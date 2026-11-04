import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import type { Conversation, ConversationMessage } from "../shared/types";
import { projectSession } from "../test/project-fixture";
import { planHomeTask, retrieveHomeTask } from "./home-task";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";
import { scopedFocusPassages } from "./focus-scope";
import { loadFullReadingPassages } from "./focus-source-text";
import { synthesizeCoveredFocus } from "./focus-coverage";
import { validateFocusResult } from "./focus-session";
import { requestBudget } from "./request-policy";
import { createAtlasAIFromProvider } from "./atlas-ai";

const signal = () => new AbortController().signal;
const source = (id: string, title = "硬件AI"): Conversation => ({ id, title, platform: "chatgpt", url: "", updatedAt: 1, importState: "complete", hydrationState: "hydrated", messageCount: 2 });
const providerFor = (value: unknown) => ({ generateStructured: vi.fn(async (request: StructuredAIRequest<unknown>) => request.validate(value)) }) as unknown as AtlasAIProvider;
async function putMessage(conversationId: string, index: number, content: string, role: ConversationMessage["role"] = "user") {
  await (await getDatabase()).put("messages", { id: `${conversationId}-${index}`, conversationId, messageIndex: index, role, content, preview: content, contentHash: "", createdAt: 1, updatedAt: 1 });
}
const selectSources = () => ({ modelId: "navigation-fixture", generateStructured: vi.fn(async (request: StructuredAIRequest<unknown>) => {
  const data = JSON.parse(request.prompt);
  expect(data.coverage).toContain("WHOLE conversations");
  return request.validate({ ids: data.conversations.map((item: { id: string }) => item.id), understanding: "整理所选完整讨论，包括后续修正。" });
}) }) as unknown as AtlasAIProvider;
beforeEach(async () => { const db = await getDatabase(); await db.clear("messages"); await db.clear("focusSessions"); await db.clear("semanticDecisionCache"); });

it.each(["硬件AI", "missing", " ", 42, { id: "missing" }])("ignores irrelevant projectId on creation: %s", async projectId => {
  expect(await planHomeTask(providerFor({ action: "project", queries: ["硬件AI"], projectId }), "创建项目：硬件AI", [source("one")], [], true, signal())).toEqual({ action: "project", queries: ["硬件AI"] });
});

it("honors explicit creation over model continuation without reusing or inventing a project", async () => {
  const project = projectSession();
  for (const projectId of [project.id, "硬件AI", undefined]) {
    expect(await planHomeTask(providerFor({ action: "continue", queries: [], projectId }), "创建项目：硬件AI", [source("one")], [project], true, signal())).toEqual({ action: "project", queries: ["硬件AI"] });
  }
  expect(await planHomeTask(providerFor({ action: "continue", projectId: ` ${project.id} ` }), "继续已有项目", [source("one")], [project], true, signal())).toMatchObject({ action: "continue", projectId: project.id });
  await expect(planHomeTask(providerFor({ action: "continue", projectId: "outside" }), "继续已有项目", [source("one")], [project], true, signal())).rejects.toMatchObject({ fieldPaths: ["projectId"], message: expect.stringContaining("已有项目") });
});

it("reads the entire relevant conversation through synthesis, including a late correction without topic keywords", async () => {
  const selected = source("hardware");
  for (let index = 0; index < 46; index++) await putMessage(selected.id, index, index === 0 ? "硬件AI 使用初步方案 A。" : index === 45 ? "更正：放弃 A，最终选择 B；旧建议不能视为已实现。" : `第 ${index} 次讨论的条件与追问。`, index % 2 ? "assistant" : "user");
  await putMessage("private", 0, "硬件AI 私密内容不属于已选池。");
  await putMessage("math", 0, "积分求导。");
  const provider = selectSources();
  const found = await retrieveHomeTask({ action: "project", queries: ["硬件AI"] }, [selected, source("math", "数学")], signal(), { provider, goal: "创建项目：硬件AI", zh: true });
  expect(found.ids).toEqual([selected.id]); expect(found.scope).toMatchObject({ kind: "all", sourceConversationIds: [selected.id] }); expect(found.scope.blocks).toBeUndefined();
  const originals = await loadFullReadingPassages([selected], signal());
  const passages = scopedFocusPassages(originals.passages, found.scope);
  expect(passages).toHaveLength(46);
  const read: string[] = [], readText: string[] = [];
  const result = await synthesizeCoveredFocus({ goal: "创建项目：硬件AI", mode: "work", locale: "zh-CN", sources: [selected], passages, scopeKind: found.scope.kind, modelId: "qwen-plus", signal: signal(), validate: validateFocusResult,
    ai: { synthesize: async <T,>(request: StructuredAIRequest<T>) => {
      const data = JSON.parse(request.prompt);
      if (data.coverage.stage === "reading") { read.push(...data.passages.map((item: { messageId: string }) => item.messageId)); readText.push(...data.passages.map((item: { text: string }) => item.text)); }
      return request.validate({ title: "完整回顾", sections: [{ title: "讨论与修正", body: "保留讨论条件和最终修正。", transition: "", kind: "finding", evidenceIds: data.passages.map((item: { id: string }) => item.id) }] });
    } },
  });
  expect(read).toEqual(Array.from({ length: 46 }, (_, index) => `hardware-${index}`));
  expect(readText.at(-1)).toContain("最终选择 B"); expect(readText.join(" ")).not.toContain("私密"); expect(result.segmentCount).toBe(46);
  expect(result.sourceOutlines[0].chapters.flatMap(item => item.messageIds)).toContain("hardware-45");
});

it("assesses every related conversation beyond 16 candidates and four accepted turns with bounded individual calls", async () => {
  const pool = Array.from({ length: 30 }, (_, index) => source(`many-${index}`));
  for (const item of pool) await putMessage(item.id, 0, `硬件AI 的真实讨论：${"电气条件与后续修正。".repeat(120)}`);
  const provider = selectSources();
  const found = await retrieveHomeTask({ action: "project", queries: ["硬件AI"] }, pool, signal(), { provider, goal: "创建项目：硬件AI", zh: true });
  expect(new Set(found.ids)).toEqual(new Set(pool.map(item => item.id))); expect(found.limited).toBe(false); expect(found.scope.kind).toBe("all");
  const requests = vi.mocked(provider.generateStructured).mock.calls.map(call => call[0]);
  expect(requests.length).toBeGreaterThan(1);
  expect(requests.flatMap(request => JSON.parse(request.prompt).conversations)).toHaveLength(30);
  expect(requests.every(request => requestBudget(request, "navigation-fixture").inputTokens <= 4000 && request.maxAttempts === 1)).toBe(true);
});

it("keeps full-selected requests, hydration requirements and duplicate IDs intact beyond 24 conversations", async () => {
  const pool = Array.from({ length: 32 }, (_, index) => source(`all-${index}`));
  pool[31] = { ...pool[31], importState: "discovered", hydrationState: undefined, messageCount: null };
  const provider = selectSources();
  const found = await retrieveHomeTask({ action: "project", queries: [], allSources: true }, [...pool, pool[0]], signal(), { provider, goal: "完整整理全部已选对话", zh: true });
  expect(found.ids).toEqual(pool.map(item => item.id)); expect(found.pending).toEqual(["all-31"]); expect(found.limited).toBe(false); expect(found.question).toBeUndefined(); expect(provider.generateStructured).not.toHaveBeenCalled();
  expect(await planHomeTask(providerFor({ action: "project" }), "完整整理全部已选对话", pool, [], true, signal())).toMatchObject({ allSources: true, queries: [] });
  expect(await planHomeTask(providerFor({ action: "answer", queries: ["对话"] }), "总结整条对话", [pool[0]], [], true, signal())).toMatchObject({ allSources: true });
});

it("keeps explicit partial organization scoped and full-summary/review requests complete", async () => {
  const pool = [source("mixed")];
  await putMessage("mixed", 0, "硬件AI 如何检查 GPIO？"); await putMessage("mixed", 1, "用 Validator。", "assistant"); await putMessage("mixed", 2, "采购预算怎么安排？");
  const partial = await planHomeTask(providerFor({ action: "project", queries: ["GPIO"] }), "只整理 GPIO 检查部分", pool, [], true, signal());
  expect(partial.sourceScope).toBe("passages");
  const found = await retrieveHomeTask(partial, pool, signal(), { provider: providerFor({ ids: ["turn1"] }), goal: "只整理 GPIO 检查部分", zh: true });
  expect(found.scope.kind).toBe("goal"); expect(found.scope.blocks?.flatMap(item => item.messageIds)).toEqual(["mixed-0", "mixed-1"]);
  const full = await planHomeTask(providerFor({ action: "answer", queries: ["GPIO"] }), "总结整条对话", pool, [], true, signal());
  expect((await retrieveHomeTask(full, pool, signal(), { provider: selectSources(), goal: "总结整条对话", zh: true })).scope.kind).toBe("all");
  expect((await retrieveHomeTask({ action: "review", queries: ["GPIO"] }, pool, signal(), { provider: selectSources(), goal: "复习 GPIO", zh: true })).scope.kind).toBe("all");
});

it("rejects fabricated whole-conversation selections and stops after cancellation", async () => {
  await putMessage("hardware", 0, "硬件AI 原文。");
  const pool = [source("hardware")];
  await expect(retrieveHomeTask({ action: "project", queries: ["硬件AI"] }, pool, signal(), { provider: providerFor({ ids: ["private"] }), goal: "创建项目：硬件AI", zh: true })).rejects.toMatchObject({ fieldPaths: ["materialReview.ids[0]"] });
  const abort = new AbortController();
  const provider = { generateStructured: vi.fn(async (request: StructuredAIRequest<unknown>) => { abort.abort(); return request.validate({ ids: ["source1"] }); }) } as unknown as AtlasAIProvider;
  await expect(retrieveHomeTask({ action: "project", queries: ["硬件AI"] }, pool, abort.signal, { provider, goal: "创建项目：硬件AI", zh: true })).rejects.toThrow();
  expect(provider.generateStructured).toHaveBeenCalledOnce();
});

it("invalidates whole-conversation navigation when unexcerpted originals change", async () => {
  const db = await getDatabase(), pool = [source("cached")];
  for (let index = 0; index < 30; index++) await putMessage("cached", index, `硬件AI 第 ${index} 个讨论条件。`);
  const generate = vi.fn(async (request: StructuredAIRequest<unknown>) => request.validate({ ids: ["source1"] }));
  const provider = createAtlasAIFromProvider({ id: "complete-cache-fixture", modelId: "complete-cache-fixture", generateStructured: generate } as unknown as AtlasAIProvider, { id: "ai-settings", provider: "deepseek", baseUrl: "https://complete-cache.example/v1", apiKey: "test", model: "complete-cache-fixture", updatedAt: 1 });
  const run = () => retrieveHomeTask({ action: "project", queries: ["硬件AI"] }, pool, signal(), { provider, goal: "创建项目：硬件AI", zh: true });
  await run(); await run(); expect(generate).toHaveBeenCalledOnce();
  const original = (await db.get("messages", "cached-20"))!;
  await db.put("messages", { ...original, content: "硬件AI 第 20 个讨论条件已更正。", updatedAt: 2 });
  await run(); expect(generate).toHaveBeenCalledTimes(2);
  const first = JSON.parse(generate.mock.calls[0][0].prompt), second = JSON.parse(generate.mock.calls[1][0].prompt);
  expect(first.conversations[0].text).toBe(second.conversations[0].text); expect(first.conversations[0].revision).not.toBe(second.conversations[0].revision);
});
