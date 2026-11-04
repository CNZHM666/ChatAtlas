import { getDatabase } from "../storage/db";
import { cacheAIResult, touchAIResult } from "../storage/ai-result-cache";
import type { WikiKnowledgeOrganization } from "../shared/wiki-knowledge";

/** Only recomputable, complete organizing results use the existing bounded LRU.
 * Sources, saved documents and personal edits never live in this cache. */
export async function readWikiOrganizationCache(signature: string): Promise<WikiKnowledgeOrganization | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const row = await (await getDatabase()).get("semanticDecisionCache", `wiki-organization:${signature}`);
    const value = row?.result as { signature?: string; organization?: WikiKnowledgeOrganization } | undefined;
    if (value?.signature !== signature || value.organization?.inputSignature !== signature || value.organization.status !== "complete" || !value.organization.chapters.length) return undefined;
    if (row) await touchAIResult(row);
    return structuredClone(value.organization);
  } catch { return undefined; }
}
export async function cacheWikiOrganization(signature: string, organization: WikiKnowledgeOrganization): Promise<void> {
  if (typeof indexedDB === "undefined" || organization.status !== "complete") return;
  try {
    await cacheAIResult({ id: `wiki-organization:${signature}`, providerId: "wiki-organization", modelId: "local-snapshot-v1", taskType: "synthesis", analysisVersion: 1, inputHash: signature, createdAt: Date.now(), result: { signature, organization } });
  } catch { /* Recomputable acceleration is optional. */ }
}
