import { expect, it } from "vitest";
import { coverageBatches, coverageMaterials } from "./focus-coverage";
import { requestBudget } from "./request-policy";
import { transcriptPassages } from "../search/transcript-index";
import type { Conversation } from "../shared/types";

it("compacts cold planning without dropping source text across languages and models", () => {
  const rows = [];
  for (const scenario of ["mixed-code", "chinese-discussion", "short-turns"] as const) {
    const count = scenario === "short-turns" ? 784 : 160;
    const source: Conversation = { id: "benchmark-source", title: "Source conditions and later corrections ".repeat(5), platform: "chatgpt", url: "", messageCount: count, updatedAt: 1 };
    const { materials } = coverageMaterials(transcriptPassages(source, Array.from({ length: count }, (_, i) => ({ id: `b${i}`, conversationId: source.id, role: i % 2 ? "assistant" as const : "user" as const, messageIndex: i,
      content: scenario === "mixed-code" ? 'const answer = "condition";\n\\code\\examples\n'.repeat(30) : scenario === "chinese-discussion" ? "必须保留完整条件、后来更正、用户的问题和推理。".repeat(45) : `Question ${i}: keep this condition.`, preview: "", contentHash: `${i}`, createdAt: 1, updatedAt: 1 }))), [source]);
    for (const model of ["qwen/qwen3.7-flash", "deepseek-v4.1-flash", "unknown-model"]) {
      const plan = (compact: boolean) => coverageBatches(materials, "Preserve the complete chronological discussion for later reuse.", "review", "zh-CN", 1, materials.length, "reading", model, "balanced", false, compact);
      const legacy = plan(false), modern = plan(true);
      expect(modern.flat()).toEqual(materials); expect(modern.length).toBeLessThanOrEqual(legacy.length);
      const sent = (batches: typeof modern) => batches.reduce((sum, batch) => sum + requestBudget({ taskType: "focus_session", system: "", prompt: JSON.stringify({ intent: "Preserve the complete chronological discussion for later reuse.", mode: "review", strategy: "review", locale: "zh-CN", analysisMode: "balanced", coverage: { confirmedSourceCount: 1, includedSourceCount: 1, sampled: false, stage: "reading", final: false, sourceSegmentCount: batch.length, ...(batch[0].precedingContext ? { precedingContext: batch[0].precedingContext } : {}) }, passages: batch.map(({ id, conversationId, sourceConversationIds, title, messageId, date, text }) => ({ id, conversationId, sourceConversationIds, title, messageId, date, text })) }) }, model).inputTokens, 0);
      rows.push({ scenario, model, materialBlocks: materials.length, oldRequests: legacy.length, newRequests: modern.length, oldSentInputEstimate: sent(legacy), newSentInputEstimate: sent(modern), sourceTextPreserved: true });
    }
  }
  console.info(`FOCUS_BENCHMARK ${JSON.stringify({ kind: "offline-synthetic-planning", paidProviderRequests: 0, rows })}`);
});
