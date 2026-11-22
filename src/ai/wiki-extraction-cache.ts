import { getDatabase } from "../storage/db";
import { cacheAIResult, touchAIResult } from "../storage/ai-result-cache";
import type { WikiUnitBatch } from "../shared/wiki-knowledge";

export async function wikiExtractionCacheKey(input: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function readWikiExtractionBatch(key: string, partial = false): Promise<WikiUnitBatch | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const row = await (await getDatabase()).get("semanticDecisionCache", "wiki-extraction:" + key);
    const batch = row?.result as WikiUnitBatch | undefined;
    if (row?.inputHash !== key || !batch || batch.skipped
      || (partial ? batch.status !== "failed" || !batch.recoveredHalves?.length : batch.status !== "ok")) return undefined;
    void touchAIResult(row).catch(() => undefined);
    return batch;
  } catch { return undefined; }
}

export async function cacheWikiExtractionBatch(key: string, batch: WikiUnitBatch, partial = false): Promise<void> {
  if (typeof indexedDB === "undefined" || batch.skipped
    || (partial ? batch.status !== "failed" || !batch.recoveredHalves?.length : batch.status !== "ok")) return;
  try {
    await cacheAIResult({ id: "wiki-extraction:" + key, providerId: "wiki-extraction", modelId: "local-snapshot-v1",
      taskType: "synthesis", analysisVersion: 1, inputHash: key, createdAt: Date.now(), result: batch });
  } catch { /* A cache write never delays recovery by turning it into a failure. */ }
}
