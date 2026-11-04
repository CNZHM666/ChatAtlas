import { expect, it, vi } from "vitest";
import * as policy from "./request-policy";
import { coverageBatches, coverageMaterials } from "./focus-coverage";
import { transcriptPassages } from "../search/transcript-index";
import type { Conversation, ConversationMessage } from "../shared/types";
it("checks a 256-turn source with logarithmic budget calls without losing evidence", () => {
  const source: Conversation = { id: "many-small-turns", title: "Source", platform: "chatgpt", url: "", messageCount: 256, updatedAt: 1 };
  const messages = Array.from({ length: 256 }, (_, i): ConversationMessage => ({ id: `m${i}`, conversationId: source.id, role: i % 2 ? "assistant" : "user", messageIndex: i, content: `Turn ${i}`, preview: "", contentHash: String(i), createdAt: 1, updatedAt: 1 }));
  const { materials } = coverageMaterials(transcriptPassages(source, messages), [source]);
  const budget = vi.spyOn(policy, "requestBudget");
  const batches = coverageBatches(materials, "Read", "review", "en", 1, materials.length, "reading", "qwen-plus");
  expect(batches).toEqual([materials]);
  expect(budget.mock.calls.length).toBeLessThanOrEqual(10);
  budget.mockRestore();
});
it("keeps the greedy prefix boundary under exact wire budgets for mixed scripts and escaping", () => {
  const source: Conversation = { id: "mixed", title: "Source", platform: "chatgpt", url: "", messageCount: 75, updatedAt: 1 };
  const messages = Array.from({ length: 75 }, (_, i): ConversationMessage => ({ id: `m${i}`, conversationId: source.id, role: "assistant", messageIndex: i, content: (i % 3 ? "条件和修正😀\\\"\n" : "ASCII evidence ").repeat(40 + i * 2), preview: "", contentHash: String(i), createdAt: 1, updatedAt: 1 }));
  const { materials } = coverageMaterials(transcriptPassages(source, messages), [source]);
  for (const analysisMode of ["fast", "balanced", "deep"] as const) {
    const fits = (batch: typeof materials) => {
      const includedSourceCount = new Set(batch.flatMap((m) => m.sourceConversationIds)).size;
      const prompt = JSON.stringify({ intent: "Read", mode: "review", strategy: "review", locale: "zh-CN", analysisMode, semanticStructure: true, coverage: { confirmedSourceCount: includedSourceCount, includedSourceCount, sampled: false, stage: "reading", final: false, sourceSegmentCount: batch.length, ...(batch[0].precedingContext ? { precedingContext: batch[0].precedingContext } : {}) }, passages: batch.map(({ id, conversationId, sourceConversationIds, title, messageId, date, text }) => ({ id, conversationId, sourceConversationIds, title, messageId, date, text })) });
      const budget = policy.requestBudget({ taskType: "focus_session", system: "", prompt }, "qwen-plus");
      return budget.inputTokens <= budget.maxInputTokens - 500;
    };
    const expected: typeof materials[] = []; let current: typeof materials = [];
    for (const item of materials) { if (current.length && !fits([...current, item])) { expected.push(current); current = []; } current.push(item); }
    if (current.length) expected.push(current);
    expect(coverageBatches(materials, "Read", "review", "zh-CN", 1, materials.length, "reading", "qwen-plus", analysisMode)).toEqual(expected);
  }
});
