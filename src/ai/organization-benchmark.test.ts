import {expect,it} from "vitest";
import {parseAnalysisCsv,summarizeAnalysisCsv,compareBenchmarks} from "./organization-benchmark.mjs";
import {analyzeOrganizationRuns,organizationAnalysisCsv} from "./usage-analysis";
import type {AIUsageEvent} from "../shared/types";

it("round trips exported CSV and compares requests, stages, tokens and all failure origins",()=>{
 const events:AIUsageEvent[]=["local","model","provider","network"].map((failureOrigin,index)=>({id:String(index),createdAt:1,taskType:"focus_session",stage:"reading",providerId:"fixture",modelId:"fixture",conversationIds:[],inputTokens:100,outputTokens:10,cachedInputTokens:20,tokenSource:"provider",status:"failed",failureOrigin:failureOrigin as AIUsageEvent["failureOrigin"],attempt:1}));
 const before=summarizeAnalysisCsv(organizationAnalysisCsv(analyzeOrganizationRuns([],events,[]))),after=summarizeAnalysisCsv(organizationAnalysisCsv(analyzeOrganizationRuns([],events.slice(1),[])));
 expect(before.failuresByOrigin).toEqual({local:1,model:1,provider:1,network:1,unknown:0});
 expect(compareBenchmarks(before,after)).toContainEqual({metric:"requests",before:4,after:3,delta:-1,percent:-25});
 expect(before.stages.reading).toBe(4);expect(before.firstReadableMs).toBeUndefined();
});
it("handles BOM, quoted commas/newlines/quotes and distinguishes missing metrics from zero",()=>{
 const csv='\uFEFFrequests,input_tokens,output_tokens,failed_requests,label\r\n1,0,2,0,"a,b\n""quoted"""\r\n';
 expect(parseAnalysisCsv(csv)[0].label).toBe('a,b\n"quoted"');
 const summary=summarizeAnalysisCsv(csv);expect(summary.cachedInputTokens).toBeUndefined();expect(summary.inputTokens).toBe(0);
 expect(compareBenchmarks(summary,summary).find(row=>row.metric==="cachedInputTokens")?.delta).toBeUndefined();
});
it.each(['bad csv','requests,input_tokens,output_tokens,failed_requests\n1,2,3','requests,input_tokens,output_tokens,failed_requests\n1,2,3,"unclosed','requests,input_tokens,output_tokens,failed_requests\nNaN,2,3,0'])("rejects malformed data: %s",csv=>{
 expect(()=>summarizeAnalysisCsv(csv)).toThrow();
});
