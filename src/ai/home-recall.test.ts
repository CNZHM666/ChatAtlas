import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { answerHomeRecall } from "./home-recall";
import { generateFocusSession } from "./focus-session";
import { createAtlasAI } from "./atlas-ai";
import { getDatabase } from "../storage/db";
import { sourceMessageSignature } from "../shared/source-signature";
import { projectSession } from "../test/project-fixture";
import type { StructuredAIRequest } from "./provider";
import { requestBudget } from "./request-policy";
vi.mock("./focus-session", () => ({ generateFocusSession: vi.fn() }));
vi.mock("./atlas-ai", () => ({ createAtlasAI: vi.fn() }));
vi.mock("../storage/knowledge-graph", () => ({ getAISettings: async () => ({ id: "ai-settings", mode: "byok", provider: "openai-compatible", baseUrl: "https://fixture.example/v1", apiKey: "fixture", model: "fixture", updatedAt: 1 }) }));
const source = { id: "hardware", title: "硬件AI", platform: "chatgpt", url: "", messageCount: 1, updatedAt: 1 };
const text = "硬件AI 使用 GPIO 校验电气约束。";
const found = () => ({ ids: [source.id], pending: [], limited: false, scope: { kind: "goal" as const, blocks: [{ conversationId: source.id, title: source.title, messageIds: ["m"], messageSignatures: { m: sourceMessageSignature(text) } }] } });
const decide = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks(); const db = await getDatabase(); await db.clear("messages"); await db.clear("homeResults");
  await db.put("messages", { id: "m", conversationId: source.id, role: "assistant", messageIndex: 0, content: text, contentHash: "", preview: "", createdAt: 1, updatedAt: 1 });
  vi.mocked(generateFocusSession).mockResolvedValue({ ...projectSession(), sections: [{ id: "s", title: "找到相关讨论", body: "讨论了电气校验。", transition: "", kind: "finding", evidenceIds: ["e"] }], evidence: [{ id: "e", title: source.title, conversationId: source.id, messageId: "m", excerpt: text, sourceSignature: sourceMessageSignature(text) }] });
  decide.mockImplementation(async (request: StructuredAIRequest<unknown>) => request.validate({ relevant: true, sourceIds: ["e"], quote: text }));
  vi.mocked(createAtlasAI).mockReturnValue({ decide, modelId: "fixture" } as unknown as ReturnType<typeof createAtlasAI>);
});
it("audits the actual original topic after generation and keeps earlier answers as background only", async () => {
  const response = await answerHomeRecall("硬件AI", [source], found(), ["AI 产品留存"], true, new AbortController().signal, undefined, { runId:"shared-search-run", history: [{ question: "之前的问题", answer: "旧回答" }] });
  expect(response.evidence[0].messageId).toBe("m");
  expect(vi.mocked(generateFocusSession).mock.calls[0][7]).toBe("shared-search-run");
  expect(vi.mocked(generateFocusSession).mock.calls[0][9]).toMatchObject({ querySearchQueries: ["硬件AI"], homeRecallIntent: "find", queryHistory: [{question:"之前的问题",answer:"旧回答"}] });
  const request = decide.mock.calls[0][0]; expect(JSON.parse(request.prompt).originals[0].text).toContain(text); expect(requestBudget(request, "fixture").inputTokens).toBeLessThanOrEqual(4500);
  expect(await (await getDatabase()).count("homeResults")).toBe(0);
});
it("rejects a source-grounded answer about the wrong product before it can be saved", async () => {
  decide.mockImplementation(async (request: StructuredAIRequest<unknown>) => request.validate({ relevant: false, sourceIds: [], quote: "" }));
  await expect(answerHomeRecall("硬件AI", [source], found(), ["硬件AI"], true, new AbortController().signal)).rejects.toThrow("指定的主题");
  expect(await (await getDatabase()).count("homeResults")).toBe(0);
});
it("rejects changed or unrelated original material before generation", async () => {
  const db = await getDatabase(); const original = (await db.get("messages", "m"))!;
  await db.put("messages", { ...original, content: "戒色AI 日活与留存。" }); const selection = found(); selection.scope.blocks[0].messageSignatures.m = sourceMessageSignature("戒色AI 日活与留存。");
  await expect(answerHomeRecall("硬件AI", [source], selection, ["AI 产品"], true, new AbortController().signal)).rejects.toThrow("指定的主题"); expect(generateFocusSession).not.toHaveBeenCalled();
});
