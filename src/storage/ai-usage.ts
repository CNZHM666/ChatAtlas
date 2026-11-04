import type { AIUsageEvent } from "../shared/types";
import { getDatabase } from "./db";

export async function recordAIUsage(event: AIUsageEvent): Promise<void> {
  const db = await getDatabase();
  // Reconnecting to one hosted task may deliver the same receipt again. Keep the
  // original charge once; record the later delivery as a zero-cost reuse event.
  if (event.providerId === "atlas-demo" && event.requestId && event.status !== "cached" && ((event.costCny ?? 0) > 0 || (event.pendingCostCny ?? 0) > 0 || event.inputTokens + event.outputTokens + (event.embeddingTokens ?? 0) > 0)) {
    const tx = db.transaction("aiUsageEvents", "readwrite");
    const prior = (await tx.store.getAll()).find((item) => item.requestId === event.requestId && item.providerId === event.providerId && item.status !== "cached" && ((item.costCny ?? 0) > 0 || (item.pendingCostCny ?? 0) > 0 || item.inputTokens + item.outputTokens + (item.embeddingTokens ?? 0) > 0));
    await tx.store.put(prior ? { ...event, inputTokens: 0, outputTokens: 0, embeddingTokens: 0, costCny: 0, pendingCostCny: 0, status: "cached" } : event);
    await tx.done;
    return;
  }
  await db.put("aiUsageEvents", event);
}

export async function listAIUsage(): Promise<AIUsageEvent[]> {
  return (await (await getDatabase()).getAll("aiUsageEvents")).sort((a, b) => b.createdAt - a.createdAt);
}
