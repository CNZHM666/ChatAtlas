import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import { generateFocusSession } from "./focus-session";
import { createAtlasAI } from "./atlas-ai";
import type { StructuredAIRequest } from "./provider";
import type { Conversation } from "../shared/types";
import { requestBudget } from "./request-policy";

vi.mock("../storage/knowledge-graph", () => ({ getAISettings: async () => ({ id: "ai-settings", mode: "byok", provider: "openai-compatible", baseUrl: "https://complete.example/v1", model: "qwen-plus", apiKey: "fixture", updatedAt: 1 }) }));
vi.mock("./provider", () => ({ hasProviderPermission: async () => true }));
vi.mock("./atlas-ai", () => ({ createAtlasAI: vi.fn() }));

it("generates a complete result for more than 24 selected conversations, deduplicating IDs without dropping sources", async () => {
  const db = await getDatabase();
  for (const store of ["messages", "conversations", "semanticDecisionCache"] as const) await db.clear(store);
  const sources: Conversation[] = Array.from({ length: 32 }, (_, index) => ({ id: `whole-${index}`, title: `完整讨论 ${index}`, platform: "chatgpt", url: "", updatedAt: 1, messageCount: 1, importState: "complete", hydrationState: "hydrated" }));
  for (const source of sources) {
    await db.put("conversations", source);
    await db.put("messages", { id: `${source.id}-message`, conversationId: source.id, messageIndex: 0, role: "user", content: `讨论 ${source.id} 的原始条件与最终修正。`, preview: "", contentHash: "", createdAt: 1, updatedAt: 1 });
  }
  const read: string[] = [];
  vi.mocked(createAtlasAI).mockReturnValue({ modelId: "qwen-plus", synthesize: async <T,>(request: StructuredAIRequest<T>) => {
    const data = JSON.parse(request.prompt);
    expect(requestBudget(request, "qwen-plus").inputTokens).toBeLessThanOrEqual(requestBudget(request, "qwen-plus").maxInputTokens);
    if (data.coverage.stage === "reading") read.push(...data.passages.map((item: { messageId: string }) => item.messageId));
    return request.validate({ title: "全文整理", sections: [{ title: "原始条件与修正", body: "保留所选材料的条件与修正。", transition: "", kind: "finding", evidenceIds: data.passages.map((item: { id: string }) => item.id) }] });
  } } as unknown as ReturnType<typeof createAtlasAI>);
  const result = await generateFocusSession("整理完整已选对话", "answer", [...sources, sources[0]], "zh-CN", new AbortController().signal, undefined, undefined, undefined, undefined, { complete: true, skipProjectState: true });
  expect(new Set(read)).toEqual(new Set(sources.map(source => `${source.id}-message`)));
  expect(read).toHaveLength(32);
  expect(result.sourceConversationIds).toEqual(sources.map(source => source.id));
  expect(result.coverage).toMatchObject({ method: "full_batched", sourceCount: 32, totalSegments: 32, processedSegments: 32 });
  expect(Object.keys(result.sourceSignatures ?? {})).toHaveLength(32);
});
