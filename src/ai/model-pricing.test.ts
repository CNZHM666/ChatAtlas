import "fake-indexeddb/auto";
import {afterEach,expect,it,vi} from "vitest";
import {MODEL_TOKEN_PRICES,modelUsageCostCny} from "../shared/model-pricing";
import {createAtlasAI} from "./atlas-ai";
import {analyzeOrganizationRuns,organizationAnalysisCsv} from "./usage-analysis";
import {listAIUsage} from "../storage/ai-usage";

const models=["deepseek-v4.1-flash-1017","qwen3.8-flash"];
afterEach(()=>{vi.unstubAllGlobals();});
it("reserves both exact model prices as unknown until the user supplies rates",()=>{
 for(const model of models){expect(MODEL_TOKEN_PRICES[`qwen/${model}`]).toBeDefined();expect(modelUsageCostCny("qwen",model,100,20)).toBeUndefined();}
 expect(modelUsageCostCny("other","qwen3.8-flash",100,20)).toBeUndefined();
});
it.each(models)("prices reported receipts for %s through the facade and CSV when configured",async model=>{
 const price=MODEL_TOKEN_PRICES[`qwen/${model}`],previous={...price};
 // Synthetic test rates only; these are not advertised model prices.
 Object.assign(price,{inputCnyPerMillion:2,outputCnyPerMillion:4,cachedInputCnyPerMillion:1});
 try{
  expect(modelUsageCostCny("qwen",model,100,20,50)).toBeCloseTo(.00023);
  expect(modelUsageCostCny("qwen",model,-1,20)).toBeUndefined();
  expect(modelUsageCostCny("qwen",model,100,20,101)).toBeUndefined();
  price.cachedInputCnyPerMillion=undefined;expect(modelUsageCostCny("qwen",model,100,20,50)).toBeUndefined();
  vi.stubGlobal("fetch",vi.fn().mockImplementation(async()=>new Response(JSON.stringify({model,id:crypto.randomUUID(),choices:[{finish_reason:"stop",message:{content:'{"ok":true}'}}],usage:{prompt_tokens:100,completion_tokens:20}}),{headers:{"Content-Type":"application/json"}})));
  const runId=crypto.randomUUID(),ai=createAtlasAI({id:"ai-settings",provider:"qwen",baseUrl:"https://dashscope.aliyuncs.com/compatible-mode/v1",apiKey:"fixture",model,updatedAt:1},undefined,runId);
  await ai.generateStructured({system:"Return JSON",prompt:crypto.randomUUID(),taskType:"other",maxAttempts:1,validate:value=>value});
  const usage=(await listAIUsage()).filter(event=>event.runId===runId);
  expect(usage).toHaveLength(1);expect(usage[0].costCny).toBeCloseTo(.00028);
  const rows=analyzeOrganizationRuns([],usage,[]);expect(rows[0].unpricedRequests).toBe(0);expect(rows[0].costCny).toBeCloseTo(.00028);
  const csv=organizationAnalysisCsv(rows);expect(csv).toContain('"0.00028"');
 }finally{Object.assign(price,previous);}
});
