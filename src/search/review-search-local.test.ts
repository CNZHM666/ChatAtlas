import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import * as embeddings from "../ai/embedding-provider";
import * as semantic from "./semantic-index";
import { searchRelatedDiscussions } from "./review-search";

afterEach(() => vi.restoreAllMocks());

it("keeps ordinary related lookup local even when an embedding connection is saved", async () => {
  const db = await getDatabase();
  await db.put("aiSettings", { id: "ai-settings", provider: "openai", baseUrl: "https://vectors.example/v1", apiKey: "synthetic", model: "chat", embeddingModel: "vector", updatedAt: 1 });
  const source = { id: "local-related", title: "操作计划", platform: "chatgpt", url: "", updatedAt: 1, messageCount: 0 };
  await db.put("semanticProfiles", { conversationId: source.id, title: source.title, summary: "操作计划由确定性执行器执行", domains: [], topics: [], concepts: [], intent: "", evidenceRefs: [], analyzedVersion: "1", updatedAt: 1 });
  const resolve = vi.spyOn(embeddings, "resolveEmbeddingProvider");
  const vectors = vi.spyOn(semantic, "searchCachedVectors");
  try {
    expect((await searchRelatedDiscussions("操作计划", [source])).some(hit => hit.kind === "conversation" && hit.id === source.id)).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(vectors).not.toHaveBeenCalled();
  } finally {
    await db.delete("aiSettings", "ai-settings");
    await db.delete("semanticProfiles", source.id);
  }
});
