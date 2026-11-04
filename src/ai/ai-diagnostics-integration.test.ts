import "fake-indexeddb/auto";
import { expect,it,vi } from "vitest";
import { createAtlasAIFromProvider } from "./atlas-ai";
import type { StructuredAIRequest,AtlasAIProvider } from "./provider";
import { getDatabase } from "../storage/db";
import { listAIUsage } from "../storage/ai-usage";
import { AIProviderHttpError } from "./provider-errors";
const settings={id:"ai-settings" as const,provider:"openai" as const,baseUrl:"https://fixture.invalid/v1",apiKey:"LOCAL_TEST",model:"fixture",updatedAt:1};
it("records every feature phase and cache layer without changing result-cache identities",async()=>{
 const db=await getDatabase();await db.clear("semanticDecisionCache");await db.clear("aiUsageEvents");
 const generateStructured=vi.fn(async<T>(request:StructuredAIRequest<T>)=>{request.onDiagnostics?.({queueMs:5,responseHeadersMs:10,firstTokenMs:20,responseMs:30,receivedCharacters:30});request.onUsage?.({inputTokens:80,outputTokens:12,requestId:"provider-id"});return request.validate({events:[]});});
 const ai=createAtlasAIFromProvider({id:"openai",modelId:"fixture",capabilities:{textGeneration:true,structuredOutput:"json",embeddings:false,requestUsage:true},testConnection:vi.fn(),generateStructured:generateStructured as AtlasAIProvider["generateStructured"]},settings,undefined,"diagnostic-run");
 const request={system:"private instruction",prompt:JSON.stringify({presentation:"product_history",stage:"extract",material:"PRIVATE ORIGINAL"}),taskType:"other" as const,maxAttempts:1 as const,validate:()=>[]};
 await ai.synthesize(request);await ai.synthesize({...request,trace:{feature:"evolution",operation:"renamed-display"}});await ai.recordReuse?.(request,"field");await ai.recordReuse?.(request,"checkpoint");
 const rows=(await listAIUsage()).filter(row=>row.runId==="diagnostic-run");expect(generateStructured).toHaveBeenCalledOnce();
 expect(rows.filter(row=>row.status!=="cached")).toHaveLength(1);
 const paid=rows.find(row=>row.status==="completed")!;expect(paid).toMatchObject({feature:"evolution",operation:"product_history:extract",inputTokens:80,outputTokens:12,tokenSource:"provider",queueMs:5,responseMs:30,timing:{queueMs:5,responseMs:30}});expect(paid.operationId).toBeTruthy();expect(paid.timing?.validationMs).toBeGreaterThanOrEqual(0);
 expect(rows.filter(row=>row.status==="cached").map(row=>row.cacheLayer).sort()).toEqual(["checkpoint","field","result"]);expect(JSON.stringify(rows)).not.toContain("PRIVATE ORIGINAL");
});
it("connects retries by one operation ID and keeps retry cost and unknown tokens visible",async()=>{
 const db=await getDatabase();await db.clear("semanticDecisionCache");await db.clear("aiUsageEvents");let attempt=0;
 const generateStructured=vi.fn(async<T>(request:StructuredAIRequest<T>)=>{request.onDiagnostics?.({queueMs:2,responseMs:2});if(++attempt===1)throw new AIProviderHttpError(429,"fixture",0);return request.validate({ok:true});});
 const ai=createAtlasAIFromProvider({id:"openai",modelId:"fixture",testConnection:vi.fn(),generateStructured:generateStructured as AtlasAIProvider["generateStructured"]},settings,undefined,"retry-run");
 await ai.decide({taskType:"question_snapshot",system:"fixture",prompt:"retry fixture",validate:()=>({ok:true})});
 const rows=(await listAIUsage()).filter(row=>row.runId==="retry-run").sort((a,b)=>a.attempt-b.attempt);expect(rows).toHaveLength(2);expect(rows[0].status).toBe("failed");expect(rows[0].tokenSource).toBe("unavailable");expect(rows[1].attempt).toBe(2);expect(rows[0].operationId).toBe(rows[1].operationId);expect(rows[1].timing?.backoffMs).toBeGreaterThanOrEqual(0);
});
