import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { AISettings, Conversation, ConversationMessage } from "../shared/types";
import { createAtlasAIFromProvider } from "./atlas-ai";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";
import { AIProviderHttpError } from "./provider";
import { synthesizeCoveredFocus } from "./focus-coverage";
import { validateFocusResult } from "./focus-session";
import { transcriptPassages } from "../search/transcript-index";
import type { FocusAnalysisProgress } from "../shared/focus-progress";

describe("quality-preserving generation reuse", () => {
  it("retries only failed work, reuses composition across identical goals and invalidates only changed source analysis", async () => {
    const sources: Conversation[] = Array.from({ length: 3 }, (_, index) => ({ id: `resume-${crypto.randomUUID()}`, title: `Source ${index}`, url: "", platform: "chatgpt", updatedAt: 1, messageCount: 1 }));
    const messages = sources.map((source): ConversationMessage => ({ id: `${source.id}-q`, conversationId: source.id, messageIndex: 0, role: "user", content: `Original ${source.title}. Qualification B applies.`, contentHash: "1", preview: "", createdAt: 1, updatedAt: 1 }));
    let fail = true;
    const readingCalls: string[] = [];
    const finalCalls: string[] = [];
    const settings: AISettings = { id: "ai-settings", provider: "openai-compatible", baseUrl: "https://fixture.invalid/v1", apiKey: "synthetic", model: "same-quality-model", updatedAt: 1 };
    const provider: AtlasAIProvider = { id: "openai-compatible", modelId: settings.model, capabilities: { textGeneration: true, structuredOutput: "json", embeddings: false, maxConcurrency: 1 }, testConnection: async () => ({ ok: true, model: settings.model }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      const data = JSON.parse(request.prompt);
      if (!data.coverage.final) {
        readingCalls.push(data.passages[0].conversationId);
        if (data.passages[0].conversationId === sources[1].id && fail) { fail = false; throw new AIProviderHttpError(503, "synthetic unavailable"); }
      } else finalCalls.push(data.intent);
      return request.validate({ title: "Review", sections: [{ title: "Conditions", body: data.passages.map((item: { text: string }) => item.text).join("\n"), transition: "", kind: "review", evidenceIds: data.passages.map((item: { id: string }) => item.id) }] });
    } };
    const ai = createAtlasAIFromProvider(provider, settings);
    const progress: FocusAnalysisProgress[] = [];
    const run = (goal: string, current = messages) => synthesizeCoveredFocus({ goal, mode: "review", locale: "en", sources, passages: sources.flatMap((source, index) => transcriptPassages(source, [current[index]])), modelId: settings.model, ai, signal: new AbortController().signal, validate: validateFocusResult, onProgress: (_completed, _total, _stage, detail) => { if (detail) progress.push(detail); } });
    await expect(run("Review constraints")).rejects.toBeInstanceOf(AIProviderHttpError);
    expect(readingCalls).toEqual([sources[0].id, sources[1].id]);
    const recovered = await run("Review constraints");
    expect(readingCalls).toEqual([sources[0].id, sources[1].id, sources[1].id, sources[2].id]);
    expect(recovered.result.sections[0].evidenceIds.map((id) => recovered.evidence.find((item) => item.id === id)?.messageId)).toEqual(messages.map((item) => item.id));
    expect(recovered.result.sections[0].body).toContain("Qualification B applies.");
    expect(progress.at(-1)?.reusedBatches).toBe(1);
    await run("Review constraints");
    expect(readingCalls).toHaveLength(4); expect(finalCalls).toHaveLength(1);
    expect(progress.at(-1)?.reusedBatches).toBe(4);
    await run("Compare qualification B");
    expect(readingCalls).toHaveLength(4); expect(finalCalls).toHaveLength(2);
    await run("Compare qualification B", messages.map((item, index) => index === 2 ? { ...item, content: "Correction: qualification C, not B, is required." } : item));
    expect(readingCalls.slice(4)).toEqual([sources[2].id]);
    expect(finalCalls).toHaveLength(3);
  });
});
