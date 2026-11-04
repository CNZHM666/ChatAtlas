import "fake-indexeddb/auto";
import {expect,it,vi} from "vitest";
import {createAtlasAIFromProvider} from "./atlas-ai";
import type {StructuredAIRequest} from "./provider";
import {getDatabase} from "../storage/db";
import {listAIUsage} from "../storage/ai-usage";
import {analyzeOrganizationRuns,organizationAnalysisCsv} from "./usage-analysis";
import {pruneAIResultCache,AI_CACHE_MAX_ROWS,type ReadingCacheRow} from "../storage/ai-result-cache";

it("reuses run A reading in run B after ordinary LRU pressure without a provider call",async()=>{
 const db=await getDatabase();await db.clear("semanticDecisionCache");
 const generateStructured=vi.fn(async<T>(request:StructuredAIRequest<T>)=>request.validate({notes:"retained"}));
 const provider={id:"reading-cache-regression",modelId:"fixture",testConnection:vi.fn(),generateStructured:<T>(request:StructuredAIRequest<T>)=>generateStructured(request as StructuredAIRequest<unknown>) as Promise<T>};
 const settings={id:"ai-settings" as const,provider:"deepseek" as const,baseUrl:"https://api.deepseek.com/v1",apiKey:"test",model:"fixture",updatedAt:1};
 const request={taskType:"focus_session" as const,system:"Read originals",prompt:JSON.stringify({locale:"en",coverage:{stage:"reading",final:false},passages:[{id:"raw",text:"Original"}]}),conversationIds:["source"],validate:(value:unknown)=>value};
 const first=createAtlasAIFromProvider(provider,settings,undefined,"run-a");await first.synthesize(request);
 const saved=(await db.getAll("semanticDecisionCache"))[0];
 const tx=db.transaction("semanticDecisionCache","readwrite");
 for(let i=0;i<=AI_CACHE_MAX_ROWS;i++)await tx.store.put({...saved,id:`noise-${i}`,providerId:"noise",readingConversationIds:undefined,accessedAt:Date.now()+i+1} as ReadingCacheRow);
 await tx.done;await pruneAIResultCache();generateStructured.mockClear();
 const second=createAtlasAIFromProvider(provider,settings,undefined,"run-b");
 expect(await second.synthesize(request)).toEqual({notes:"retained"});expect(generateStructured).not.toHaveBeenCalled();
 const metrics=analyzeOrganizationRuns([],await listAIUsage(),[]).find(row=>row.run.id==="run-b")!;
 expect(metrics.readingCacheHits).toBe(1);expect(organizationAnalysisCsv([metrics]).split("\r\n")[0]).toContain('"reading_cache_hits"');
 await second.synthesize({...request,bypassCache:true});expect(generateStructured).toHaveBeenCalledOnce();
});
