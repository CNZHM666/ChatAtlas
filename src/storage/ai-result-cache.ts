import type { SemanticDecisionCache } from "../shared/types";
import { getDatabase } from "./db";

export const AI_CACHE_MAX_ROWS = 2000, AI_CACHE_MAX_BYTES = 32_000_000;
export const READING_CACHE_MAX_BYTES = 64_000_000;
export type ReadingCacheRow = SemanticDecisionCache & { readingConversationIds?: string[] };
let maintenance: Promise<void> | undefined, lastPruned = 0;
/** Recomputable model outputs only. Never touches source versions, saved Wiki or reading ledgers. */
export async function pruneAIResultCache(): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction("semanticDecisionCache", "readwrite");
  const all = await tx.store.getAll() as ReadingCacheRow[];
  const records = all.filter(row => !row.providerId.startsWith("focus-") && !row.readingConversationIds);
  const weighted = records.map(row => ({ row, bytes: row.sizeBytes ?? new TextEncoder().encode(JSON.stringify(row.result)).length })).sort((a, b) => (b.row.accessedAt ?? b.row.createdAt) - (a.row.accessedAt ?? a.row.createdAt));
  let bytes = 0, count = 0;
  for (const entry of weighted) { if (count + 1 > AI_CACHE_MAX_ROWS || bytes + entry.bytes > AI_CACHE_MAX_BYTES) { const current = await tx.store.get(entry.row.id); if (current && current.createdAt === entry.row.createdAt && current.accessedAt === entry.row.accessedAt) await tx.store.delete(entry.row.id); } else { bytes += entry.bytes; count++; } }
  // Shared-source batches belong to the same eviction group, including batches
  // spanning several conversations. Never leave half a source's reading behind.
  const groups: Array<{sources:Set<string>;rows:ReadingCacheRow[]}> = [];
  for(const row of all.filter(row=>row.readingConversationIds)){
    const sources=new Set(row.readingConversationIds!.length?row.readingConversationIds:["unknown"]),rows=[row];
    for(let i=groups.length-1;i>=0;i--)if([...sources].some(id=>groups[i].sources.has(id))){for(const id of groups[i].sources)sources.add(id);rows.push(...groups[i].rows);groups.splice(i,1);i=groups.length;}
    groups.push({sources,rows});
  }
  let readingBytes=0;
  groups.sort((a,b)=>Math.max(...b.rows.map(row=>row.accessedAt??row.createdAt))-Math.max(...a.rows.map(row=>row.accessedAt??row.createdAt)));
  for(const group of groups){const size=group.rows.reduce((sum,row)=>sum+(row.sizeBytes??new TextEncoder().encode(JSON.stringify(row.result)).length),0);if(readingBytes+size>READING_CACHE_MAX_BYTES){for(const row of group.rows)await tx.store.delete(row.id);}else readingBytes+=size;}
  await tx.done;
}
export async function cacheAIResult(row: ReadingCacheRow): Promise<void> {
  const db = await getDatabase();
  await db.put("semanticDecisionCache", { ...row, accessedAt: Date.now(), sizeBytes: new TextEncoder().encode(JSON.stringify(row.result)).length });
  if(row.readingConversationIds){await pruneAIResultCache();return;}
  if (!maintenance && Date.now() - lastPruned > 30_000) {
    lastPruned = Date.now(); maintenance = pruneAIResultCache().catch(() => undefined).finally(() => { maintenance = undefined; });
  }
}
export async function touchAIResult(row: SemanticDecisionCache, readingConversationIds?: string[]): Promise<void> {
  const tx = (await getDatabase()).transaction("semanticDecisionCache", "readwrite");
  const current = await tx.store.get(row.id);
  if (current && current.createdAt === row.createdAt) { const updated:ReadingCacheRow={ ...current, accessedAt: Date.now(),...(readingConversationIds?{readingConversationIds}:{}) };await tx.store.put(updated); }
  await tx.done;
}
