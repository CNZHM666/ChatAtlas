import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import { generateFocusSession } from "./focus-session";
import { sourceMessageSignature } from "../shared/source-signature";
import { createAtlasAI } from "./atlas-ai";
import type { StructuredAIRequest } from "./provider";
import { requestBudget } from "./request-policy";
vi.mock("../storage/knowledge-graph", () => ({ getAISettings: async () => ({ id: "ai-settings", mode: "byok", provider: "openai-compatible", baseUrl: "https://query.example/v1", model: "query-model", apiKey: "test", updatedAt: 1 }) }));
vi.mock("./provider", () => ({ hasProviderPermission: async () => true }));
vi.mock("./atlas-ai", () => ({ createAtlasAI: vi.fn() }));
const calls: StructuredAIRequest<unknown>[] = [];
beforeEach(async () => {
  calls.length = 0; const db = await getDatabase(); await db.clear("messages");
  for (const [index, content] of ["private stability secret", "unrelated material ".repeat(7000), "pole stability requires a later correction", "assistant: only under bounded conditions"].entries()) await db.put("messages", { id: `query-real-${index}`, conversationId: "query-real", messageIndex: index, role: index % 2 ? "assistant" : "user", content, contentHash: "", preview: "", createdAt: 1, updatedAt: 1 });
  vi.mocked(createAtlasAI).mockReturnValue({ synthesize: async <T>(request: StructuredAIRequest<T>) => { calls.push(request as StructuredAIRequest<unknown>); const data = JSON.parse(request.prompt); return request.validate({ title: "Project answer", sections: [{ title: "Condition", body: "Only under the supplied conditions.", transition: "", kind: "finding", evidenceIds: [data.passages.at(-1).id] }] }); } } as unknown as ReturnType<typeof createAtlasAI>);
});
it("answers in one bounded request without full analysis and excludes unselected original messages", async () => {
  const result = await generateFocusSession("pole stability", "answer", [{ id: "query-real", title: "Source", platform: "chatgpt", url: "", messageCount: 4, updatedAt: 1 }], "en", new AbortController().signal, undefined, undefined, undefined, undefined, { query: true, scope: { kind: "goal", blocks: [{ conversationId: "query-real", title: "Chosen", messageIds: ["query-real-2", "query-real-3"], messageSignatures: { "query-real-2": sourceMessageSignature("pole stability requires a later correction"), "query-real-3": sourceMessageSignature("assistant: only under bounded conditions") } }] } });
  expect(calls).toHaveLength(1); expect(JSON.parse(calls[0].prompt)).toMatchObject({ presentation: "project_query", strategy: "answer", coverage: { sampled: true, final: true } });
  expect(calls[0].prompt).not.toContain("private stability secret"); expect(calls[0].prompt).not.toContain("unrelated material"); expect(calls[0].prompt).toContain("bounded conditions");
  expect(requestBudget(calls[0], "query-model").inputTokens).toBeLessThanOrEqual(7500);
  expect(result.evidence.every(ref => ["query-real-2", "query-real-3"].includes(ref.messageId))).toBe(true); expect(result.coverage?.method).toBe("sampled");
});
it("does not call AI when no original evidence matches", async () => {
  await expect(generateFocusSession("never-matching-topic", "answer", [{ id: "query-real", title: "Source", platform: "chatgpt", url: "", messageCount: 4, updatedAt: 1 }], "en", new AbortController().signal, undefined, undefined, undefined, undefined, { query: true, scope: { kind: "all" } })).rejects.toThrow("did not locate usable original passages");
  expect(calls).toHaveLength(0);
});
it("answers a paraphrase from navigation references while excluding unselected messages", async () => {
  const result = await generateFocusSession("explain the decay", "answer", [{ id: "query-real", title: "Source", platform: "chatgpt", url: "", messageCount: 4, updatedAt: 1 }], "en", new AbortController().signal, undefined, undefined, undefined, undefined, { query: true, queryContext: "Chapter hint: damping", queryReferences: [{ id: "pin", conversationId: "query-real", messageId: "query-real-2", title: "Source", excerpt: "" }, { id: "hidden", conversationId: "query-real", messageId: "query-real-0", title: "Source", excerpt: "" }], scope: { kind: "goal", blocks: [{ conversationId: "query-real", title: "Chosen", messageIds: ["query-real-2", "query-real-3"], messageSignatures: { "query-real-2": sourceMessageSignature("pole stability requires a later correction"), "query-real-3": sourceMessageSignature("assistant: only under bounded conditions") } }] } });
  expect(calls).toHaveLength(1); expect(calls[0].prompt).toContain("later correction"); expect(calls[0].prompt).toContain("bounded conditions"); expect(calls[0].prompt).not.toContain("private stability secret"); expect(result.evidence.map(ref => ref.messageId)).toContain("query-real-3");
});
