import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { pruneAIResultCache, touchAIResult, AI_CACHE_MAX_BYTES, READING_CACHE_MAX_BYTES, type ReadingCacheRow } from "./ai-result-cache";
import { getDatabase } from "./db";

it("drops oversized recomputable outputs while retaining small cache entries and durable focus ledgers", async () => {
  const db = await getDatabase(); await db.clear("semanticDecisionCache");
  const row = { taskType: "synthesis" as const, inputHash: "test", analysisVersion: 1, modelId: "fixture", result: {}, createdAt: 1 };
  await db.put("semanticDecisionCache", { ...row, id: "large", providerId: "fixture", accessedAt: 3, sizeBytes: AI_CACHE_MAX_BYTES + 1 });
  await db.put("semanticDecisionCache", { ...row, id: "small", providerId: "fixture", sizeBytes: 10 });
  await db.put("semanticDecisionCache", { ...row, id: "ledger", providerId: "focus-batch-ledger", sizeBytes: AI_CACHE_MAX_BYTES + 1 });
  await pruneAIResultCache();
  expect((await db.getAll("semanticDecisionCache")).map(row => row.id).sort()).toEqual(["ledger", "small"]);
});
it("evicts whole connected source groups using their most recent access, independently of ordinary cache",async()=>{
 const db=await getDatabase();await db.clear("semanticDecisionCache");
 const base={taskType:"synthesis" as const,inputHash:"test",analysisVersion:1,modelId:"fixture",providerId:"fixture",result:{},createdAt:1};
 const rows:ReadingCacheRow[]=[
  {...base,id:"old-a",readingConversationIds:["a"],accessedAt:1,sizeBytes:10},
  {...base,id:"old-ab",readingConversationIds:["a","b"],accessedAt:2,sizeBytes:10},
  {...base,id:"old-b",readingConversationIds:["b"],accessedAt:3,sizeBytes:10},
  {...base,id:"new",readingConversationIds:["c"],accessedAt:4,sizeBytes:READING_CACHE_MAX_BYTES-20},
  {...base,id:"ordinary",sizeBytes:10},
 ];
 for(const row of rows)await db.put("semanticDecisionCache",row);await pruneAIResultCache();
 expect((await db.getAll("semanticDecisionCache")).map(row=>row.id).sort()).toEqual(["new","ordinary"]);
});
it("promotes a reused legacy reading row without changing its key or validated result",async()=>{
 const db=await getDatabase();const row={id:"legacy-reading",taskType:"synthesis" as const,inputHash:"legacy",analysisVersion:1,modelId:"fixture",providerId:"fixture",result:{notes:"old"},createdAt:1};
 await db.put("semanticDecisionCache",row);await touchAIResult(row,["source"]);
 expect(await db.get("semanticDecisionCache",row.id)).toMatchObject({...row,readingConversationIds:["source"]});
});
it("a delayed cache touch cannot overwrite a freshly regenerated result", async () => {
  const db = await getDatabase();
  const row = { id: "touch", taskType: "synthesis" as const, inputHash: "test", analysisVersion: 1, modelId: "fixture", providerId: "fixture", result: { old: true }, createdAt: 1 };
  await db.put("semanticDecisionCache", { ...row, result: { new: true }, createdAt: 2 });
  await touchAIResult(row);
  expect((await db.get("semanticDecisionCache", row.id))?.result).toEqual({ new: true });
});
