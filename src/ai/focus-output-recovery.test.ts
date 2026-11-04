import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { AISettings, Conversation, ConversationMessage } from "../shared/types";
import type { FocusAnalysisProgress } from "../shared/focus-progress";
import type { StructuredAIRequest } from "./provider";
import { AIProviderHttpError, AIProviderResponseError } from "./provider-errors";
import { DemoApiError } from "./demo-api";
import { createAtlasAIFromProvider } from "./atlas-ai";
import { synthesizeCoveredFocus } from "./focus-coverage";
import { validateFocusResult } from "./focus-session";
import { transcriptPassages } from "../search/transcript-index";
import { sourceMessageSignature } from "../shared/source-signature";
import { getDatabase } from "../storage/db";

type Payload = { intent: string; coverage: { final: boolean }; passages: Array<{ id: string; text: string }> };
const fixture = (count = 4, content = "Conditions, original reasoning and later corrections.") => {
  const source: Conversation = { id: crypto.randomUUID(), title: "One long conversation", platform: "chatgpt", url: "", messageCount: count, updatedAt: 1 };
  const messages: ConversationMessage[] = Array.from({ length: count }, (_, index) => ({ id: `${source.id}-${index}`, conversationId: source.id, messageIndex: index, role: index % 2 ? "assistant" : "user", content: `${content} ${index}`, preview: "", contentHash: `${index}`, createdAt: 1, updatedAt: 1 }));
  return { source, messages };
};
function facade(generate: <T>(request: StructuredAIRequest<T>) => Promise<T>) {
  const settings: AISettings = { id: "ai-settings", provider: "openai-compatible", baseUrl: "https://fixture.invalid/v1", apiKey: "synthetic", model: "output-recovery-fixture", updatedAt: 1 };
  return createAtlasAIFromProvider({ id: "openai-compatible", modelId: settings.model, testConnection: async () => ({ ok: true, model: settings.model }), generateStructured: generate }, settings);
}
function valueFor<T>(request: StructuredAIRequest<T>, separate = false) {
  const data: Payload = JSON.parse(request.prompt);
  const groups = separate ? data.passages.map(passage => [passage]) : [data.passages];
  return request.validate({ title: "Review", sections: groups.map(group => ({ title: "Conditions and corrections", body: group.map(passage => passage.text).join("\n"), transition: "", kind: "review", evidenceIds: group.map(passage => passage.id) })) });
}
const run = (f: ReturnType<typeof fixture>, ai: ReturnType<typeof facade>, progress: FocusAnalysisProgress[] = [], signal = new AbortController().signal) => synthesizeCoveredFocus({ goal: "Review all conditions", mode: "review", analysisMode: "deep", locale: "en", sources: [f.source], passages: transcriptPassages(f.source, f.messages), modelId: "output-recovery-fixture", ai, signal, validate: validateFocusResult, onProgress: (_completed, _total, _stage, detail) => { if (detail) progress.push(detail); } });

describe("bounded output recovery", () => {
  it("stops persistent source truncation after three new split levels", async () => {
    const f = fixture(50); let calls = 0;
    const failure = new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED");
    const ai = facade(async () => { calls++; throw failure; });
    await expect(run(f, ai)).rejects.toBe(failure);
    expect(calls).toBe(4);
    await expect(run(f, ai)).rejects.toBe(failure);
    expect(calls).toBe(8);
  });
  it("stops final-output recovery after a bounded number of attempts", async () => {
    const f = fixture(4, "Conditions and later corrections. ".repeat(30)); let finalCalls = 0;
    const failure = new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED");
    await expect(run(f, facade(async <T>(request: StructuredAIRequest<T>) => {
      const payload: Payload = JSON.parse(request.prompt);
      if (payload.coverage.final) { finalCalls++; throw failure; }
      return valueFor(request);
    }))).rejects.toBe(failure);
    expect(finalCalls).toBe(3);
  });
  it("does not split source batches when reasoning exhausted the answer budget", async () => {
    const f = fixture(4); let calls = 0;
    const failure = new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED", "reasoning-only", { outputTokenLimit: 1200, receivedCharacters: 0, reasoningTokens: 1200 });
    await expect(run(f, facade(async () => { calls++; throw failure; }))).rejects.toBe(failure);
    expect(calls).toBe(1);
  });
  it("scales recovery across a long conversation instead of stopping after 32 splits", async () => {
    const f = fixture(50, "更正条件。".repeat(350)); const progress: FocusAnalysisProgress[] = [];
    const result = await run(f, facade(async <T>(request: StructuredAIRequest<T>) => {
      const data: Payload = JSON.parse(request.prompt);
      if (!data.coverage.final && data.passages.length > 1) throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED");
      return valueFor(request);
    }), progress);
    expect(progress.some(detail => (detail.recoverySplits ?? 0) > 32)).toBe(true);
    expect(progress.at(-1)?.processedSegments).toBe(50);
    expect(result.result.sections.flatMap(section => section.evidenceIds)).toHaveLength(50);
  });
  it("splits a truncated reading batch losslessly and remembers the successful partitions", async () => {
    const f = fixture(); const progress: FocusAnalysisProgress[] = []; const sent: Payload[] = [];
    const generate = async <T>(request: StructuredAIRequest<T>) => {
      const data: Payload = JSON.parse(request.prompt); sent.push(data);
      if (!data.coverage.final && data.passages.length > 1) throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED");
      return valueFor(request);
    };
    const result = await run(f, facade(generate), progress);
    expect(result.segmentCount).toBe(4);
    expect(result.result.sections[0].evidenceIds.map(id => result.evidence.find(evidence => evidence.id === id)?.messageId)).toEqual(f.messages.map(message => message.id));
    for (const message of f.messages) expect(result.result.sections[0].body).toContain(message.content);
    expect(progress.some(detail => detail.recoverySplits === 3)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ remainingSteps: 0, stepsEstimated: false, processedSegments: 4 });
    const before = sent.length;
    await run(f, facade(generate));
    expect(sent).toHaveLength(before);
    const hints = (await (await getDatabase()).getAll("semanticDecisionCache")).filter(row => row.providerId === "focus-output-recovery");
    expect(hints.length).toBeGreaterThanOrEqual(3);
    expect(hints.every(row => !row.inputHash.includes("Conditions, original"))).toBe(true);
  });
  it("recovers a truncated final composition in ordered parts without regenerating source analysis", async () => {
    const f = fixture(2); let reading = 0; const finalSizes: number[] = [];
    const result = await run(f, facade(async <T>(request: StructuredAIRequest<T>) => {
      const data: Payload = JSON.parse(request.prompt);
      if (!data.coverage.final) { reading++; return valueFor(request, true); }
      finalSizes.push(data.passages.length);
      if (data.passages.length > 1) throw new DemoApiError("PROVIDER_OUTPUT_TRUNCATED", 502);
      return valueFor(request);
    }));
    expect(reading).toBe(1); expect(finalSizes).toEqual([2, 1, 1]);
    expect(result.result.sections).toHaveLength(2);
    expect(new Set(result.result.sections.map(section => section.id)).size).toBe(2);
    expect(result.result.sections.map(section => section.evidenceIds.map(id => result.evidence.find(ref => ref.id === id)?.messageId))).toEqual(f.messages.map(message => [message.id]));
    expect(result.result.sections[0].body).toContain(f.messages[0].content);
    expect(result.result.sections[1].body).toContain(f.messages[1].content);
  });
  it("resumes after a later failure using cached split results and never resends the failed parent", async () => {
    const f = fixture(2); let unavailable = true; const calls: string[][] = [];
    const generate = async <T>(request: StructuredAIRequest<T>) => {
      const data: Payload = JSON.parse(request.prompt);
      if (!data.coverage.final) {
        calls.push(data.passages.map(passage => passage.id));
        if (data.passages.length > 1) throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED");
        if (data.passages[0].text.endsWith("1") && unavailable) { unavailable = false; throw new AIProviderHttpError(503, "fixture unavailable"); }
      }
      return valueFor(request);
    };
    await expect(run(f, facade(generate))).rejects.toBeInstanceOf(AIProviderHttpError);
    expect(calls.map(call => call.length)).toEqual([2, 1, 1]);
    const result = await run(f, facade(generate));
    expect(calls.map(call => call.length)).toEqual([2, 1, 1, 1]);
    expect(result.sourceOutlines[0].chapters.flatMap(chapter => chapter.messageIds)).toEqual(f.messages.map(message => message.id));
  });
  it("splits a single long message without breaking emoji or prematurely claiming completion", async () => {
    const f = fixture(1, "完整条件😀。".repeat(330)); const progress: FocusAnalysisProgress[] = []; const leaves: string[] = [];
    const result = await run(f, facade(async <T>(request: StructuredAIRequest<T>) => {
      const data: Payload = JSON.parse(request.prompt);
      if (!data.coverage.final) {
        if (data.passages[0].text.length > 900) throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED");
        leaves.push(data.passages[0].text);
      }
      return valueFor(request);
    }), progress);
    expect(leaves.join("")).toBe(`user: ${f.messages[0].content}`);
    expect(leaves.every(text => !/[\uD800-\uDBFF]$/u.test(text))).toBe(true);
    expect(result.sourceOutlines[0].messageSignatures?.[f.messages[0].id]).toBe(sourceMessageSignature(f.messages[0].content));
    const reading = progress.filter(detail => !detail.final);
    expect(reading.find(detail => detail.completed === 1)?.processedSegments).toBe(0);
    expect(reading.at(-1)).toMatchObject({ processedSegments: 1, completedSourceIds: [f.source.id] });
  });
  it("stops at a minimal fragment rather than repeating the same truncated request", async () => {
    const f = fixture(1); let calls = 0;
    await expect(run(f, facade(async () => { calls++; throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED"); }))).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_TRUNCATED" });
    expect(calls).toBe(1);
  });
  it("cancels before sending replacement requests and does not split unrelated provider errors", async () => {
    const f = fixture(2); const controller = new AbortController(); let calls = 0;
    await expect(run(f, facade(async () => { calls++; controller.abort(); throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED"); }), [], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
    await expect(run(f, facade(async () => { calls++; throw new AIProviderResponseError("PROVIDER_TIMEOUT"); }))).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(calls).toBe(2);
  });
});
