import {singleOwnerPlan} from "../test/wiki-outline-fixture";
import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { getDatabase } from "../storage/db";
import { createAtlasAIFromProvider } from "./atlas-ai";
import { synthesizeCoveredFocus } from "./focus-coverage";
import { validateFocusResult } from "./focus-session";
import { transcriptPassages } from "../search/transcript-index";
import type { StructuredAIRequest } from "./provider";
import type { Conversation } from "../shared/types";

it("reuses source analysis across goals and source reordering, while changed text is analyzed again", async () => {
  await (await getDatabase()).clear("semanticDecisionCache");
  const analyzed: string[] = [];
  let compositions = 0;
  const ai = createAtlasAIFromProvider({ id: "deepseek", modelId: "source-reuse", testConnection: async () => ({ ok: true, model: "source-reuse" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
    const data = JSON.parse(request.prompt);
    if (data.coverage.final) compositions++;
    else analyzed.push(...request.conversationIds!);
    return request.validate({ title: "Review", sections: [{ title: "Note", body: data.passages.map((item: { text: string }) => item.text).join("\n"), transition: "", kind: "review", evidenceIds: data.passages.map((item: { id: string }) => item.id) }] });
  } }, { id: "ai-settings", provider: "deepseek", baseUrl: "https://source-reuse.example/v1", model: "source-reuse", apiKey: "test", updatedAt: 1 });
  const source = (id: string): Conversation => ({ id, title: id, platform: "chatgpt", url: "", messageCount: 1, updatedAt: 1 });
  const a = source("reuse-a"); const b = source("reuse-b");
  const run = async (sources: Conversation[], goal: string, changed = false) => synthesizeCoveredFocus({ goal, mode: "review", locale: "en", sources, passages: sources.flatMap((item) => transcriptPassages(item, [{ id: `${item.id}-message`, conversationId: item.id, messageIndex: 0, role: "user", content: `${item.id}: ${changed && item.id === a.id ? "Corrected condition" : "Original condition"}`, preview: "", contentHash: changed ? "changed" : "original", createdAt: 1, updatedAt: 1 }])), modelId: "source-reuse", ai, signal: new AbortController().signal, validate: validateFocusResult });
  expect((await run([a], "First goal")).method).toBe("full_direct");
  await run([b, a], "Cross-conversation goal");
  expect(analyzed).toEqual([b.id, a.id]);
  const reused = await run([a, b], "Another goal");
  expect(reused.sourceOutlines.map((item) => item.conversationId)).toEqual([a.id, b.id]);
  expect(reused.sourceOutlines.every((item) => item.chapters[0].messageIds.length === 1 && Boolean(item.messageSignatures))).toBe(true);
  expect(analyzed).toEqual([b.id, a.id]);
  expect(new Set(reused.result.sections[0].evidenceIds.map((id) => reused.evidence.find((item) => item.id === id)?.conversationId))).toEqual(new Set([a.id, b.id]));
  const cachedShort = await run([a], "Single-source goal with reusable notes");
  expect(cachedShort.method).toBe("full_batched");
  expect(analyzed).toEqual([b.id, a.id]);
  await run([b, a], "Updated goal", true);
  expect(analyzed).toEqual([b.id, a.id, a.id]);
  expect(compositions).toBe(5);
});

it("adopts old successful batches, then reads only additions or modified batches across new goals", async () => {
  const db = await getDatabase(); await db.clear("semanticDecisionCache");
  const source: Conversation = { id: "long-incremental", title: "Long chronological source ".repeat(5), platform: "chatgpt", url: "", messageCount: 45, updatedAt: 1 };
  const readings: Array<string[]> = [];
  const ai = createAtlasAIFromProvider({ id: "deepseek", modelId: "incremental-fixture", testConnection: async () => ({ ok: true, model: "incremental-fixture" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
    const data = JSON.parse(request.prompt);
    if(data.presentation==="wiki_topic_plan")return singleOwnerPlan(request);
    if (!data.coverage.final) readings.push(data.passages.map((item: { id: string }) => item.id));
    return request.validate({ title: "Review", sections: [{ title: "Conditions and later corrections", body: "## 具体机制\n\nKeep important conditions, later corrections and the user's open question.", transition: "", kind: "review", evidenceIds: data.passages.map((item: { id: string }) => item.id) }] });
  } }, { id: "ai-settings", provider: "deepseek", baseUrl: "https://incremental.example/v1", model: "incremental-fixture", apiKey: "test", updatedAt: 1 });
  const legacy = { generateStructured:ai.generateStructured!.bind(ai), synthesize: ai.synthesize.bind(ai), hasCachedSynthesis: ai.hasCachedSynthesis!.bind(ai), getAnalysisKey: ai.getAnalysisKey!.bind(ai), usesContentTokenEstimates: false };
  const run = (count: number, goal: string, changed = false, locale = "en") => synthesizeCoveredFocus({ goal, mode: "work", locale, sources: [source], modelId: "incremental-fixture", ai: goal === "Legacy goal" ? legacy : ai, signal: new AbortController().signal, validate: validateFocusResult,
    passages: transcriptPassages(source, Array.from({ length: count }, (_, index) => ({ id: `inc-m${index}`, conversationId: source.id, messageIndex: index, role: "user" as const, content: (changed && index === 0 ? "Later correction. " : "An important original condition. ").repeat(50), preview: "", contentHash: `${index}:${changed}`, createdAt: 1, updatedAt: 1 }))) });
  await run(45, "Legacy goal");
  const originalCalls = readings.length; expect(originalCalls).toBeGreaterThan(1);
  // Old installations did not have partition hints; keep only their paid results.
  for (const entry of await db.getAll("semanticDecisionCache")) if (entry.providerId === "focus-reading-planner") await db.delete("semanticDecisionCache", entry.id);
  const reused = await run(45, "New goal");
  expect(readings).toHaveLength(originalCalls); expect(reused.segmentCount).toBe(45);
  await run(46, "Goal after an additional message");
  expect(readings).toHaveLength(originalCalls + 1); expect(readings.at(-1)).toEqual(["e:long-incremental:45:1"]);
  await run(46, "Goal after one corrected message", true);
  expect(readings).toHaveLength(originalCalls + 2); expect(readings.at(-1)).toContain("e:long-incremental:0:1");
  expect(readings.at(-1)).not.toContain("e:long-incremental:45:1");
});
